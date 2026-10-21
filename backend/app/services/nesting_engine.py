"""
Moteur d'Optimisation de Refente et Nesting 1D/2D (nesting_engine).
Spécification technique : Section 3.3 du Cahier des Charges.
Entièrement découplé du framework Web.
"""

import time
from dataclasses import dataclass
from typing import Optional

from app.core.constants import (
    RACK_SCRAP_WIDTHS,
    calculate_surface_m2,
    calculate_weight_kg,
    resolve_material_spec,
    round_meters,
)
from app.models.optimizer import (
    AppliedWorkshopScrapModel,
    OptimizationRequest,
    OptimizationResponse,
    SlitNestResultModel,
    SlitStripModel,
    WorkshopScrapProposalModel,
)


@dataclass(frozen=True)
class FlattenedCut:
    id: str
    piece_id: str
    label: str
    dev: int
    length: float
    material: str


@dataclass
class BestSlitCombination:
    packed: list[FlattenedCut]
    used_width: int
    scrap_width: int


def _find_best_slit_combination(
    cuts: list[FlattenedCut],
    mother_width: int,
) -> Optional[BestSlitCombination]:
    """
    Algorithme Subset-Sum / Branch & Bound pour trouver la combinaison de développés
    qui maximise la largeur utilisée (minimise la chute transversale W - somme(dev)).
    """
    if not cuts:
        return None

    eligible = [c for c in cuts if c.dev <= mother_width]
    if not eligible:
        return None

    best_packed: list[FlattenedCut] = []
    best_used_width = 0
    best_scrap_width = mother_width

    # Recherche combinatoire exacte par Branch & Bound si <= 18 coupes
    if len(eligible) <= 18:

        def search(idx: int, current_packed: list[FlattenedCut], current_used: int) -> None:
            nonlocal best_used_width, best_scrap_width, best_packed

            if current_used > mother_width:
                return

            current_scrap = mother_width - current_used
            if current_packed and current_scrap < best_scrap_width:
                best_scrap_width = current_scrap
                best_used_width = current_used
                best_packed = list(current_packed)
                if best_scrap_width == 0:
                    return  # Ajustement parfait (0 chute transversale)

            for i in range(idx, len(eligible)):
                next_cut = eligible[i]
                if current_used + next_cut.dev <= mother_width:
                    current_packed.append(next_cut)
                    search(i + 1, current_packed, current_used + next_cut.dev)
                    current_packed.pop()
                    if best_scrap_width == 0:
                        return

        search(0, [], 0)
    else:
        # Fallback Greedy First-Fit Descending pour les cohortes volumineuses (> 18 coupes)
        sorted_cuts = sorted(eligible, key=lambda c: c.dev, reverse=True)
        packed: list[FlattenedCut] = []
        cur_used = 0
        for c in sorted_cuts:
            if cur_used + c.dev <= mother_width:
                packed.append(c)
                cur_used += c.dev

        best_packed = packed
        best_used_width = cur_used
        best_scrap_width = mother_width - cur_used

    if not best_packed:
        return None

    return BestSlitCombination(
        packed=best_packed,
        used_width=best_used_width,
        scrap_width=best_scrap_width,
    )


@dataclass
class AvailableGeneratedOffcut:
    op_index: int  # 1-based index in slits_result
    material: str
    width: int
    length: float
    scrap_ref: Optional[str]
    parent_slit: SlitNestResultModel
    remaining_width: int


def _pack_cuts_into_mother_coils(
    cuts_to_pack: list[FlattenedCut],
    requested_mother_widths: Optional[list[int]],
    use_generated_scraps: bool = True,
) -> tuple[list[SlitNestResultModel], float]:
    """
    Imbrique une liste de coupes sur les laizes mères en respectant :
    - Étape 1 : Ségrégation stricte par matière
    - Étape 2 : Partitionnement par cohortes de longueur unitaire
    - Étape 3 : Réemploi intelligent de chutes inter-longueurs (ex: 3.5m dans chute de 4m) si activé
    - Étape 4 : Combinaison transversale sur laizes mères
    - Étape 5 : Qualification des chutes réutilisables d'atelier (>=100mm et >=1.0m)
    """
    # 1. Regroupement strict par nuance de matière
    material_groups: dict[str, list[FlattenedCut]] = {}
    for cut in cuts_to_pack:
        material_groups.setdefault(cut.material, []).append(cut)

    slits_result: list[SlitNestResultModel] = []
    total_reusable_scrap_area = 0.0

    for mat_name, mat_cuts in material_groups.items():
        spec = resolve_material_spec(mat_name)

        # Détermination des laizes mères candidates pour cette matière
        if requested_mother_widths:
            # Filtrer les laizes demandées compatibles avec la matière
            candidate_widths = [w for w in requested_mother_widths if w in spec.standard_mother_widths_mm]
            if not candidate_widths:
                candidate_widths = list(spec.standard_mother_widths_mm)
        else:
            candidate_widths = list(spec.standard_mother_widths_mm)

        # 2. Partitionnement en cohortes de longueur unitaire L
        cohorts: dict[float, list[FlattenedCut]] = {}
        for c in mat_cuts:
            rounded_len = round_meters(c.length)
            cohorts.setdefault(rounded_len, []).append(c)

        # Découpe des cohortes par longueur décroissante
        sorted_lengths = sorted(cohorts.keys(), reverse=True)

        # Chutes générées par les débits plus longs réutilisables pour les longueurs plus courtes
        available_offcuts: list[AvailableGeneratedOffcut] = []

        for length_m in sorted_lengths:
            remaining_cuts = list(cohorts[length_m])

            # Étape 3 : Réemploi de chutes générées par des cohortes plus longues
            if use_generated_scraps and available_offcuts:
                for offcut in list(available_offcuts):
                    if not remaining_cuts:
                        break
                    if offcut.remaining_width < 50 or offcut.length < length_m:
                        continue

                    comb = _find_best_slit_combination(remaining_cuts, offcut.remaining_width)
                    if comb and comb.packed:
                        # Retrait des pièces imbriquées dans cette chute
                        packed_ids = {p.id for p in comb.packed}
                        remaining_cuts = [c for c in remaining_cuts if c.id not in packed_ids]

                        offcut_cut_len = round_meters(offcut.length - length_m)
                        reused_op_num = len(slits_result) + 1
                        parent_op_idx = offcut.op_index

                        # Regroupement des bandes identiques
                        offcut_strips_by_piece: dict[str, SlitStripModel] = {}
                        for p in comb.packed:
                            if p.piece_id in offcut_strips_by_piece:
                                prev = offcut_strips_by_piece[p.piece_id]
                                offcut_strips_by_piece[p.piece_id] = SlitStripModel(
                                    piece_id=prev.piece_id,
                                    label=prev.label,
                                    dev=prev.dev,
                                    length=prev.length,
                                    qty=prev.qty + 1,
                                    material=prev.material,
                                )
                            else:
                                offcut_strips_by_piece[p.piece_id] = SlitStripModel(
                                    piece_id=p.piece_id,
                                    label=p.label,
                                    dev=p.dev,
                                    length=p.length,
                                    qty=1,
                                    material=p.material,
                                )

                        residual_scrap = offcut.remaining_width - comb.used_width
                        offcut.remaining_width = residual_scrap

                        # Mise à jour de la chute parente : elle est réemployée dans l'atelier
                        offcut.parent_slit.suggested_scrap_ref = (
                            f"{offcut.scrap_ref} (Réemployée dans OP #{reused_op_num})"
                            if offcut.scrap_ref
                            else f"Chute OP #{parent_op_idx} (Réemployée)"
                        )
                        # La chute de l'OP parente est désormais façonnée : elle ne compte plus comme chute libre
                        offcut.parent_slit.is_scrap_reusable = False

                        slits_result.append(
                            SlitNestResultModel(
                                mother_width=offcut.width,
                                mother_length=length_m,
                                material=spec.name,
                                strips=list(offcut_strips_by_piece.values()),
                                used_width=comb.used_width,
                                scrap_width=residual_scrap,
                                is_scrap_reusable=False,
                                suggested_scrap_ref=None,
                                source_type="REUSED_OFFCUT",
                                source_label=f"Chute {offcut.width} mm × {offcut.length:.2f} m (Issue de OP #{parent_op_idx})",
                                source_op_index=parent_op_idx,
                                original_offcut_length=offcut.length,
                                offcut_cut_length=offcut_cut_len,
                                parent_scrap_ref=offcut.scrap_ref,
                            )
                        )

            while remaining_cuts:
                best_res: Optional[tuple[int, BestSlitCombination, float]] = None

                for m_width in candidate_widths:
                    res = _find_best_slit_combination(remaining_cuts, m_width)
                    if res:
                        efficiency = res.used_width / m_width
                        if (
                            best_res is None
                            or efficiency > best_res[2]
                            or (efficiency == best_res[2] and res.scrap_width < best_res[1].scrap_width)
                        ):
                            best_res = (m_width, res, efficiency)

                # Si aucune pièce ne rentre dans les laizes autorisées
                if best_res is None:
                    largest_cut = remaining_cuts[0]
                    actual_width = max(max(candidate_widths), largest_cut.dev)
                    comb = BestSlitCombination(
                        packed=[largest_cut],
                        used_width=largest_cut.dev,
                        scrap_width=max(0, actual_width - largest_cut.dev),
                    )
                    best_res = (actual_width, comb, largest_cut.dev / actual_width)

                chosen_mother_width, combination, _ = best_res

                # Retrait des pièces imbriquées de la cohorte
                packed_ids = {p.id for p in combination.packed}
                remaining_cuts = [c for c in remaining_cuts if c.id not in packed_ids]

                # Étape 4 : Qualification des chutes réutilisables d'atelier (>= 100mm et >= 1.0m)
                is_reusable = combination.scrap_width >= 100 and length_m >= 1.0
                scrap_ref: Optional[str] = None

                if is_reusable:
                    mat_code = "ZN" if spec.metal_type == "ZINC" else ("ALU" if spec.metal_type == "ALUMINIUM" else "MET")
                    scrap_ref = f"CHU-{mat_code}-{combination.scrap_width}-{length_m:.1f}M"
                    total_reusable_scrap_area += calculate_surface_m2(float(combination.scrap_width), length_m)

                # Regroupement des bandes identiques dans le slit pour affichage lisible
                strips_by_piece: dict[str, SlitStripModel] = {}
                for p in combination.packed:
                    if p.piece_id in strips_by_piece:
                        prev = strips_by_piece[p.piece_id]
                        strips_by_piece[p.piece_id] = SlitStripModel(
                            piece_id=prev.piece_id,
                            label=prev.label,
                            dev=prev.dev,
                            length=prev.length,
                            qty=prev.qty + 1,
                            material=prev.material,
                        )
                    else:
                        strips_by_piece[p.piece_id] = SlitStripModel(
                            piece_id=p.piece_id,
                            label=p.label,
                            dev=p.dev,
                            length=p.length,
                            qty=1,
                            material=p.material,
                        )

                new_slit = SlitNestResultModel(
                    mother_width=chosen_mother_width,
                    mother_length=length_m,
                    material=spec.name,
                    strips=list(strips_by_piece.values()),
                    used_width=combination.used_width,
                    scrap_width=combination.scrap_width,
                    is_scrap_reusable=is_reusable,
                    suggested_scrap_ref=scrap_ref,
                    source_type="MOTHER_COIL",
                    source_label=None,
                    source_op_index=None,
                    original_offcut_length=None,
                    offcut_cut_length=None,
                    parent_scrap_ref=None,
                )
                slits_result.append(new_slit)

                # Si cette opération génère une chute réutilisable, on la rend disponible pour les longueurs suivantes
                if is_reusable:
                    available_offcuts.append(
                        AvailableGeneratedOffcut(
                            op_index=len(slits_result),
                            material=spec.name,
                            width=combination.scrap_width,
                            length=length_m,
                            scrap_ref=scrap_ref,
                            parent_slit=new_slit,
                            remaining_width=combination.scrap_width,
                        )
                    )

    return slits_result, total_reusable_scrap_area

    return slits_result, total_reusable_scrap_area


def run_nesting_optimization(request: OptimizationRequest) -> OptimizationResponse:
    """
    Exécute l'optimisation complète de refente et calepinage selon Section 3.3.
    """
    timestamp = time.time()
    order_id = f"OPT-{int(timestamp)}"

    # Aplatissement des pièces : séparation bobine mère vs chute de rack directe
    manual_rack_scraps: list[AppliedWorkshopScrapModel] = []
    all_cuts: list[FlattenedCut] = []
    cut_counter = 1

    for p in request.pieces:
        p_mat_spec = resolve_material_spec(p.material if p.material else request.material)
        if p.source_type == "RACK_SCRAP":
            matching_rack_scrap = next(
                (w for w in RACK_SCRAP_WIDTHS if w >= p.dev),
                max(250, p.dev),
            )
            for _ in range(p.quantity):
                manual_rack_scraps.append(
                    AppliedWorkshopScrapModel(
                        piece_id=p.id,
                        piece_label=p.label,
                        piece_dev=p.dev,
                        piece_length=round_meters(p.length),
                        scrap_dev=matching_rack_scrap,
                        material=p_mat_spec.name,
                    )
                )
        else:
            for _ in range(p.quantity):
                all_cuts.append(
                    FlattenedCut(
                        id=f"cut-{cut_counter}",
                        piece_id=p.id,
                        label=p.label,
                        dev=p.dev,
                        length=round_meters(p.length),
                        material=p_mat_spec.name,
                    )
                )
                cut_counter += 1

    # 1. Calcul de base ("baseline" sur tôles mères pour les pièces non passées en chute)
    if all_cuts:
        baseline_slits, _ = _pack_cuts_into_mother_coils(
            cuts_to_pack=all_cuts,
            requested_mother_widths=request.available_mother_widths,
            use_generated_scraps=request.use_generated_scraps,
        )
    else:
        baseline_slits = []

    # 2. Étape 5 : Détection des opportunités de substitution par chutes de rack
    # Si une tôle mère entière est débitée pour une seule bande isolée, si perte >= 35%,
    # ou si toutes les bandes sont de largeur <= 250 mm avec chute
    proposals: list[WorkshopScrapProposalModel] = []

    for idx, slit in enumerate(baseline_slits):
        total_strips_count = sum(s.qty for s in slit.strips)
        is_single_strip = total_strips_count == 1
        is_high_waste = slit.scrap_width >= (slit.mother_width * 0.35)
        all_strips_small = all(s.dev <= 250 for s in slit.strips) and slit.scrap_width > 0

        if is_single_strip or is_high_waste or all_strips_small:
            for strip in slit.strips:
                if strip.dev <= 250:
                    matching_rack_scrap = next(
                        (w for w in RACK_SCRAP_WIDTHS if w >= strip.dev),
                        250,
                    )
                    spec = resolve_material_spec(strip.material)
                    area_saved = calculate_surface_m2(float(slit.mother_width), slit.mother_length)
                    weight_saved = calculate_weight_kg(
                        float(slit.mother_width), slit.mother_length, spec.surface_density_kg_m2
                    )

                    for q in range(strip.qty):
                        prop_label = f"{strip.label} (#{q+1})" if strip.qty > 1 else strip.label
                        proposals.append(
                            WorkshopScrapProposalModel(
                                id=f"prop-{strip.piece_id}-{idx}-{q}",
                                piece_id=strip.piece_id,
                                piece_label=prop_label,
                                piece_dev=strip.dev,
                                piece_length=strip.length,
                                recommended_scrap_dev=matching_rack_scrap,
                                material=strip.material,
                                reason=(
                                    f"Évite de débiter une feuille mère complète de {slit.mother_width} mm × "
                                    f"{slit.mother_length} m ({strip.material}) pour cette pièce "
                                    f"(perte évitée de {slit.scrap_width} mm)."
                                ),
                                mother_width_saved=slit.mother_width,
                                mother_length_saved=slit.mother_length,
                                area_saved_m2=area_saved,
                                weight_saved_kg=weight_saved,
                            )
                        )

    # 3. Application des substitutions de chutes de rack si activée
    applied_scraps: list[AppliedWorkshopScrapModel] = list(manual_rack_scraps)
    final_slits = baseline_slits
    accepted_ids = set(request.accepted_proposal_ids or [])

    if request.use_workshop_scraps and proposals:
        cuts_fulfilled_by_rack: set[str] = set()

        for prop in proposals:
            if not accepted_ids or prop.id in accepted_ids:
                # Chercher une coupe correspondante non encore affectée
                match_cut = next(
                    (c for c in all_cuts if c.piece_id == prop.piece_id and c.id not in cuts_fulfilled_by_rack),
                    None,
                )
                if match_cut:
                    cuts_fulfilled_by_rack.add(match_cut.id)
                    applied_scraps.append(
                        AppliedWorkshopScrapModel(
                            piece_id=prop.piece_id,
                            piece_label=prop.piece_label,
                            piece_dev=prop.piece_dev,
                            piece_length=prop.piece_length,
                            scrap_dev=prop.recommended_scrap_dev,
                            material=prop.material,
                        )
                    )

        if cuts_fulfilled_by_rack:
            remaining_cuts = [c for c in all_cuts if c.id not in cuts_fulfilled_by_rack]
            final_slits, _ = _pack_cuts_into_mother_coils(
                cuts_to_pack=remaining_cuts,
                requested_mother_widths=request.available_mother_widths,
                use_generated_scraps=request.use_generated_scraps,
            )

    # Déterminer la liste des propositions à renvoyer à l'opérateur
    if not request.use_workshop_scraps:
        returned_proposals = proposals
    else:
        # Vérifier si des pièces résiduelles <= 250 mm sont encore seules sur une tôle mère
        returned_proposals = []
        for f_idx, f_slit in enumerate(final_slits):
            f_total_strips = sum(s.qty for s in f_slit.strips)
            f_is_single = f_total_strips == 1
            f_is_high_waste = f_slit.scrap_width >= (f_slit.mother_width * 0.35)
            f_all_small = all(s.dev <= 250 for s in f_slit.strips) and f_slit.scrap_width > 0

            if f_is_single or f_is_high_waste or f_all_small:
                for strip in f_slit.strips:
                    if strip.dev <= 250:
                        matching_rack_scrap = next(
                            (w for w in RACK_SCRAP_WIDTHS if w >= strip.dev),
                            250,
                        )
                        spec = resolve_material_spec(strip.material)
                        area_saved = calculate_surface_m2(float(f_slit.mother_width), f_slit.mother_length)
                        weight_saved = calculate_weight_kg(
                            float(f_slit.mother_width), f_slit.mother_length, spec.surface_density_kg_m2
                        )
                        for q in range(strip.qty):
                            prop_label = f"{strip.label} (#{q+1})" if strip.qty > 1 else strip.label
                            returned_proposals.append(
                                WorkshopScrapProposalModel(
                                    id=f"prop-res-{strip.piece_id}-{f_idx}-{q}",
                                    piece_id=strip.piece_id,
                                    piece_label=prop_label,
                                    piece_dev=strip.dev,
                                    piece_length=strip.length,
                                    recommended_scrap_dev=matching_rack_scrap,
                                    material=strip.material,
                                    reason=(
                                        f"Pièce résiduelle de {strip.dev} mm : peut être prélevée en chute de rack de "
                                        f"{matching_rack_scrap} mm pour éviter de débiter une tôle mère entière de "
                                        f"{f_slit.mother_width} mm (perte résiduelle de {f_slit.scrap_width} mm)."
                                    ),
                                    mother_width_saved=f_slit.mother_width,
                                    mother_length_saved=f_slit.mother_length,
                                    area_saved_m2=area_saved,
                                    weight_saved_kg=weight_saved,
                                )
                            )

    # 4. Calculs des métriques de synthèse avec déterminisme numérique
    total_net_surface = 0.0
    net_weight_acc = 0.0

    for p in request.pieces:
        p_spec = resolve_material_spec(p.material if p.material else request.material)
        p_surf = (p.dev / 1000.0) * p.length * p.quantity
        total_net_surface += p_surf
        net_weight_acc += p_surf * p_spec.surface_density_kg_m2

    total_gross_surface = 0.0
    gross_weight_acc = 0.0
    reused_offcuts_count = 0

    for slit in final_slits:
        if slit.source_type == "REUSED_OFFCUT":
            reused_offcuts_count += 1
            continue  # Ne pas recompter la surface brute : issue d'une tôle mère déjà comptée
        s_spec = resolve_material_spec(slit.material)
        slit_surf = (slit.mother_width / 1000.0) * slit.mother_length
        total_gross_surface += slit_surf
        gross_weight_acc += slit_surf * s_spec.surface_density_kg_m2

    for scrap in applied_scraps:
        scrap_spec = resolve_material_spec(scrap.material)
        sc_surf = (scrap.scrap_dev / 1000.0) * scrap.piece_length
        total_gross_surface += sc_surf
        gross_weight_acc += sc_surf * scrap_spec.surface_density_kg_m2

    reusable_scrap_surface = 0.0
    for slit in final_slits:
        if slit.is_scrap_reusable and slit.source_type != "REUSED_OFFCUT":
            reusable_scrap_surface += (slit.scrap_width / 1000.0) * slit.mother_length

    net_loss_surface = max(0.0, total_gross_surface - total_net_surface - reusable_scrap_surface)

    # Taux de rendement matière (%) : (Surface nette + Chutes réutilisables) / Surface brute
    if total_gross_surface > 0:
        efficiency_rate = round(
            ((total_net_surface + reusable_scrap_surface) / total_gross_surface) * 100.0,
            1,
        )
    else:
        efficiency_rate = 100.0

    reused_note = (
        f" · {reused_offcuts_count} pièce(s) façonnée(s) directement dans les chutes de débits plus longs."
        if reused_offcuts_count > 0
        else ""
    )
    summary_msg = (
        f"Optimisation terminée : {len(request.pieces)} repères usinés. "
        f"Rendement matière de {efficiency_rate}% "
        f"({round(total_net_surface, 2)} m² nets sur {round(total_gross_surface, 2)} m² bruts). "
        f"Poids total de débit : {round(gross_weight_acc, 2)} kg.{reused_note}"
    )

    return OptimizationResponse(
        order_id=order_id,
        timestamp=timestamp,
        material_efficiency_rate=efficiency_rate,
        total_net_surface_m2=round(total_net_surface, 2),
        total_gross_surface_m2=round(total_gross_surface, 2),
        reusable_scrap_surface_m2=round(reusable_scrap_surface, 2),
        net_loss_surface_m2=round(net_loss_surface, 2),
        net_weight_kg=round(net_weight_acc, 2),
        gross_weight_kg=round(gross_weight_acc, 2),
        slits=final_slits,
        workshop_scrap_proposals=returned_proposals,
        applied_workshop_scraps=applied_scraps,
        summary_message=summary_msg,
    )
