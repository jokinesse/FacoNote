"""
Moteur d'Auto-Calepinage du métrage linéaire sans quantité (resolve_auto_piece_breakdown).
Spécification technique : Section 3.2 du Cahier des Charges.
"""

import math
from typing import Literal, Optional

from app.core.constants import ALL_STANDARD_LENGTHS, STANDARD_FOLDING_LENGTHS, round_meters
from app.models.optimizer import (
    AutoPieceBreakdownAlternative,
    AutoPieceBreakdownResponse,
)
from app.models.pieces import ShapedPieceModel


def resolve_auto_piece_breakdown(
    total_meters: float,
    current_pieces: list[ShapedPieceModel],
    target_material: str,
    forced_length: Optional[float] = None,
) -> AutoPieceBreakdownResponse:
    """
    Détermine le découpage optimal en tôles d'atelier lorsqu'un métrage linéaire est saisi sans quantité.
    Section 3.2 :
    1. Diviseurs mathématiques stricts (N de 1 à 40).
    2. Formats standards testés (2.0m, 2.5m, 3.0m, 4.0m, etc.).
    3. Fonction de scoring : Score = S_exact + S_machine + S_existant - S_chute - S_ergonomie.
    4. Garantie de non-régression : au moins une proposition tombe pile (0 chute) ou au plus proche.
    """
    safe_meters = max(0.1, round_meters(total_meters))

    # 1. Collecte des longueurs de pièces déjà existantes sur le bon (priorité même matière)
    same_mat_pieces = [p for p in current_pieces if not p.material or p.material == target_material]
    pool = same_mat_pieces if same_mat_pieces else current_pieces

    existing_length_counts: dict[float, int] = {}
    for p in pool:
        if p.length > 0 and p.quantity > 0:
            rounded_len = round(p.length, 2)
            existing_length_counts[rounded_len] = existing_length_counts.get(rounded_len, 0) + p.quantity

    # 2. Candidats initiaux : longueurs existantes + formats standards atelier
    candidate_lengths_set: set[float] = set(existing_length_counts.keys())
    candidate_lengths_set.update(ALL_STANDARD_LENGTHS)

    # 3. Recherche des diviseurs stricts ('qui tombe pile', 0 chute) pour N in [1, 40]
    max_n = max(1, min(40, math.ceil(safe_meters / 0.9)))
    for n in range(1, max_n + 1):
        raw_l = safe_meters / n
        if 0.95 <= raw_l <= 4.05:
            # Vérification à 2 décimales (ex: 2.50m, 2.00m)
            l2 = round(raw_l, 2)
            if abs(l2 * n - safe_meters) < 0.005:
                candidate_lengths_set.add(l2)
            else:
                # Vérification à 3 décimales (ex: 2.875m, 2.125m)
                l3 = round(raw_l, 3)
                if abs(l3 * n - safe_meters) < 0.001:
                    candidate_lengths_set.add(l3)

    # Filtrage des longueurs physiquement exploitables sur plieuse d'atelier (0.5m à 6.0m)
    sorted_candidate_lengths = sorted([l for l in candidate_lengths_set if 0.5 <= l <= 6.0])

    # 4. Évaluation et calcul de score pour chaque longueur candidate
    scored_candidates: list[AutoPieceBreakdownAlternative] = []

    for cand_len in sorted_candidate_lengths:
        raw_count = safe_meters / cand_len
        is_exact = (
            abs(round(raw_count) - raw_count) < 0.005
            or abs(round(raw_count) * cand_len - safe_meters) < 0.005
        )

        quantity = round(raw_count) if is_exact else math.ceil(raw_count)
        quantity = max(1, quantity)

        total_produced = safe_meters if is_exact else round(quantity * cand_len, 2)
        excess = 0.0 if is_exact else max(0.0, round(total_produced - safe_meters, 2))

        existing_count = existing_length_counts.get(cand_len, 0)
        is_existing = existing_count > 0

        # Calcul du score métier
        score: float = 0.0

        # a) isExact : +150 pts si 0 chute. Bonus de +35 pts si format standard de plieuse (2, 2.5, 3, 4m)
        is_machine_folding_std = any(abs(cand_len - std) < 0.01 for std in STANDARD_FOLDING_LENGTHS)

        if is_exact:
            score += 150.0
            if is_machine_folding_std:
                score += 35.0
        else:
            # S_chute : pénalité de -(chute en mètres) * 60 points
            score -= excess * 60.0

        # b) isExisting : +85 pts + 10 * nb_pieces si présent sur le bon
        if is_existing:
            score += 85.0 + (existing_count * 10.0)

        # c) Ergonomie atelier
        # +15 pts si 1.8m <= L <= 3.5m (sweet spot de manipulation)
        if 1.8 <= cand_len <= 3.5:
            score += 15.0

        # Bonus de standard de plieuse
        if is_machine_folding_std:
            score += 20.0

        # Pénalité de -(1.7 - L) * 80 si L < 1.7m et métrage >= 3.5m
        if cand_len < 1.7 and safe_meters >= 3.5:
            score -= (1.7 - cand_len) * 80.0

        # Pénalité au-delà de 4m (tôles encombrantes)
        if cand_len > 4.0:
            score -= (cand_len - 4.0) * 80.0

        # Libellé explicatif
        if is_exact:
            label = f"{quantity} pcs × {cand_len}m = {total_produced}m (Tombe pile - 0 chute)"
        elif is_existing:
            label = f"{quantity} pcs × {cand_len}m = {total_produced}m (Même taille débit : {existing_count} pcs)"
        elif excess > 0:
            label = f"{quantity} pcs × {cand_len}m = {total_produced}m (+{excess}m chute)"
        else:
            label = f"{quantity} pcs × {cand_len}m = {total_produced}m"

        scored_candidates.append(
            AutoPieceBreakdownAlternative(
                length=cand_len,
                quantity=quantity,
                total_produced=total_produced,
                excess=excess,
                is_exact=is_exact,
                is_existing=is_existing,
                is_closest=False,
                score=round(score, 1),
                label=label,
            )
        )

    # 5. Identification de l'alternative 'le plus proche' (chute minimale non-nulle)
    non_exact = [s for s in scored_candidates if not s.is_exact and s.excess > 0 and 1.5 <= s.length <= 4.0]
    non_exact.sort(key=lambda s: s.excess)

    closest_candidate: Optional[AutoPieceBreakdownAlternative] = None
    if non_exact:
        closest_candidate = non_exact[0]
    else:
        remaining_non_exact = sorted([s for s in scored_candidates if not s.is_exact], key=lambda s: s.excess)
        if remaining_non_exact:
            closest_candidate = remaining_non_exact[0]

    if closest_candidate:
        closest_candidate.is_closest = True

    # 6. Garantie d'au moins 1 proposition exacte (0 chute)
    has_exact = any(s.is_exact for s in scored_candidates)
    if not has_exact:
        target_len = 2.5 if safe_meters >= 5.0 else 2.0
        target_n = max(1, round(safe_meters / target_len))
        exact_len = round(safe_meters / target_n, 3)
        exact_alt = AutoPieceBreakdownAlternative(
            length=exact_len,
            quantity=target_n,
            total_produced=safe_meters,
            excess=0.0,
            is_exact=True,
            is_existing=(exact_len in existing_length_counts),
            is_closest=False,
            score=180.0,
            label=f"{target_n} pcs × {exact_len}m = {safe_meters}m (Tombe pile exact)",
        )
        scored_candidates.insert(0, exact_alt)

    # Tri par score décroissant
    scored_candidates.sort(key=lambda s: s.score, reverse=True)

    # Sélection de la recommandation principale (ou respect du format forcé)
    chosen = scored_candidates[0]
    if forced_length is not None:
        for cand in scored_candidates:
            if abs(cand.length - forced_length) < 0.01:
                chosen = cand
                break

    # Détermination de l'origine et de la justification
    source: Literal["existing_pieces", "standard_exact", "standard_rounded"]
    if chosen.is_exact and chosen.is_existing:
        source = "existing_pieces"
        reason = (
            f"Aligné sur les feuilles de {chosen.length}m existantes ({chosen.quantity} pcs) · Tombe pile (0 chute)"
        )
    elif chosen.is_exact:
        source = "standard_exact"
        reason = (
            f"Tombe pile : {chosen.quantity} pièces de {chosen.length}m = exactement {chosen.total_produced}m (0 chute)"
        )
    elif chosen.is_existing:
        source = "existing_pieces"
        reason = (
            f"Aligné sur les feuilles de {chosen.length}m existantes ({chosen.quantity} pcs) · Arrondi (+{chosen.excess}m)"
        )
    else:
        source = "standard_rounded"
        reason = (
            f"Découpage optimisé en {chosen.quantity} pièces de {chosen.length}m "
            f"({chosen.total_produced}m pour {safe_meters}m demandés)"
        )

    # Construction de la sélection des meilleures alternatives pour l'interface
    pool_for_alts = (
        [s for s in scored_candidates if s.length >= 1.75]
        if safe_meters >= 3.5 and len([s for s in scored_candidates if s.length >= 1.75]) >= 2
        else scored_candidates
    )

    top_alternatives: list[AutoPieceBreakdownAlternative] = []
    seen_lengths: set[float] = set()

    def add_alt(alt: Optional[AutoPieceBreakdownAlternative]) -> None:
        if alt is None:
            return
        key = round(alt.length, 2)
        if key not in seen_lengths:
            seen_lengths.add(key)
            top_alternatives.append(alt)

    # 1. Proposition retenue
    add_alt(chosen)

    # 2. Meilleure alternative exacte garantie
    best_exact = next((s for s in pool_for_alts if s.is_exact), None) or next(
        (s for s in scored_candidates if s.is_exact), None
    )
    add_alt(best_exact)

    # 3. Alternatives exactes complémentaires (jusqu'à 3 exactes max)
    for alt in pool_for_alts:
        if alt.is_exact:
            add_alt(alt)
            if len([a for a in top_alternatives if a.is_exact]) >= 3:
                break

    # 4. Option la plus proche (chute minimale)
    if closest_candidate:
        add_alt(closest_candidate)

    # 5. Longueur existante si applicable
    existing_alt = next((s for s in scored_candidates if s.is_existing), None)
    if existing_alt:
        add_alt(existing_alt)

    # 6. Formats standards machine plieuse (2.0m, 2.5m, 3.0m)
    for std_len in (2.0, 2.5, 3.0):
        std_match = next((s for s in scored_candidates if abs(s.length - std_len) < 0.01), None)
        if std_match:
            add_alt(std_match)
            if len(top_alternatives) >= 5:
                break

    return AutoPieceBreakdownResponse(
        length=chosen.length,
        quantity=chosen.quantity,
        total_produced=chosen.total_produced,
        requested_meters=safe_meters,
        reason=reason,
        source=source,
        alternatives=top_alternatives,
    )
