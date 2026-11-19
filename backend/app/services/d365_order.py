"""
Commande envoyée vers l'extension « Façonote → D365 ».
build_d365_order assemble, matière par matière, les longueurs DEV des pièces
(pieces-summary) et les bobines de la grille Nomenclature (coil-summary).
Il ne refait aucun calcul : il lit les tableaux de summarize_pieces et summarize_coils.
Fonction pure, sans dépendance web.

Règles :
- pièces seules : message version 1, identique à celui d'avant (groupes material,
  matiere, epaisseur, lengths) ;
- bobines ou chutes envoyées : version 2 (has_pieces, coils, all_articles, chute_m en plus) ;
- bobine sans code AR : pas envoyée, avertissement, le reste part ;
- chute sans bobine : envoyée (la matière a au moins un code AR pour reconnaître la grille) ;
- bobine ou chute qui vaut 0,00 m une fois arrondie : pas envoyée, avertissement.
"""

from app.core.constants import (
    D365_COIL_ARTICLES,
    D365_MATIERE_LABELS,
    D365_MAX_QUANTITY_M,
    D365_SHEET_ARTICLES,
    DEV_PIECE_BOUNDS,
    d365_coil_article,
    d365_epaisseur_label,
    resolve_material_spec,
)
from app.models.coils import CoilSummaryEntry
from app.models.d365_order import (
    D365OrderCoil,
    D365OrderGroup,
    D365OrderIssue,
    D365OrderResponse,
)
from app.models.pieces_summary import PieceSummaryEntry
from app.services.coil_engine import d365_quantity_m, summarize_coils
from app.services.pieces_engine import summarize_pieces


def _official(material: str) -> str:
    """Nom officiel d'une matière (un alias rejoint sa matière)."""
    return resolve_material_spec(material).name


def _round2(length_m: float) -> float:
    """Arrondi des quantités saisies dans D365 : 2 décimales (même règle que coil-summary)."""
    return d365_quantity_m(length_m)


def _fr(length_m: float) -> str:
    """Longueur pour un message (virgule décimale, ex. 0,004)."""
    return f"{length_m:.3f}".rstrip("0").rstrip(".").replace(".", ",")


def build_d365_order(
    order_number: str,
    pieces: list[PieceSummaryEntry],
    coils: list[CoilSummaryEntry],
) -> D365OrderResponse:
    """Assemble la commande pour l'extension (groupes par matière, erreurs, avertissements)."""
    errors: list[D365OrderIssue] = []
    warnings: list[D365OrderIssue] = []

    if not pieces and not coils:
        errors.append(D365OrderIssue(material=None, code="EMPTY", message="Rien à envoyer : ni pièce ni bobine."))
        return D365OrderResponse(
            order_number=order_number, version=1, groups=[], errors=errors, warnings=warnings
        )

    # --- Pièces : tableau des bornes du calculateur Pièce, par matière officielle
    normalized_pieces = [p.model_copy(update={"material": _official(p.material)}) for p in pieces]
    piece_summary = summarize_pieces(normalized_pieces) if normalized_pieces else None
    piece_materials = [m.material for m in piece_summary.materials] if piece_summary else []

    lengths_by_material: dict[str, dict[str, float]] = {}
    unknown_labels: list[str] = []
    for material in piece_materials:
        if D365_MATIERE_LABELS.get(material) is None:
            unknown_labels.append(material)
            continue
        assert piece_summary is not None
        lengths: dict[str, float] = {}
        for bound in DEV_PIECE_BOUNDS:
            bound_row = next(
                (
                    r for r in piece_summary.bound_rows
                    if r.bound == bound and r.material == material and not r.is_empty
                ),
                None,
            )
            # Longueur brute du tableau des bornes (pas d'arrondi : message v1 inchangé)
            lengths[str(bound)] = bound_row.length_m if bound_row else 0
        lengths_by_material[material] = lengths

    if unknown_labels:
        errors.append(
            D365OrderIssue(
                material=None,
                code="NO_MATIERE_LABEL",
                message=(
                    f"Envoi refusé : libellé D365 pas encore connu pour {', '.join(unknown_labels)}. "
                    "Retirez ces saisies ou demandez l'ajout du libellé."
                ),
            )
        )

    # --- Bobines et chutes : tableau du calculateur Bobine (déjà par matière officielle)
    coils_by_material: dict[str, list[D365OrderCoil]] = {}
    chute_by_material: dict[str, float] = {}
    if coils:
        coil_summary = summarize_coils(coils)
        skipped_widths: dict[str, list[int]] = {}
        for row in sorted((r for r in coil_summary.rows if not r.is_empty), key=lambda r: (r.material, r.width)):
            article = d365_coil_article(row.material, row.width)
            if article is None:
                skipped_widths.setdefault(row.material, []).append(row.width)
                continue
            quantity_m = _round2(row.length_m)
            if quantity_m <= 0:
                warnings.append(
                    D365OrderIssue(
                        material=row.material,
                        code="ROUNDS_TO_ZERO",
                        message=(
                            f"{row.material} : bobine {row.width} de {_fr(row.length_m)} m, "
                            "trop courte, non envoyée."
                        ),
                    )
                )
                continue
            if quantity_m > D365_MAX_QUANTITY_M:
                errors.append(
                    D365OrderIssue(
                        material=row.material,
                        code="QUANTITY_TOO_LARGE",
                        message=(
                            f"Envoi refusé : {row.material} : bobine {row.width} de {_fr(quantity_m)} m, "
                            f"trop longue ({_fr(D365_MAX_QUANTITY_M)} m au plus). Vérifiez la saisie."
                        ),
                    )
                )
            coils_by_material.setdefault(row.material, []).append(
                D365OrderCoil(width_mm=row.width, article=article, quantity_m=quantity_m)
            )
        skipped_chutes: list[str] = []
        for chute in coil_summary.chutes:
            if chute.material in D365_COIL_ARTICLES:
                chute_m = _round2(chute.length_m)
                if chute_m <= 0:
                    warnings.append(
                        D365OrderIssue(
                            material=chute.material,
                            code="ROUNDS_TO_ZERO",
                            message=f"{chute.material} : chute de {_fr(chute.length_m)} m, trop courte, non envoyée.",
                        )
                    )
                    continue
                if chute_m > D365_MAX_QUANTITY_M:
                    errors.append(
                        D365OrderIssue(
                            material=chute.material,
                            code="QUANTITY_TOO_LARGE",
                            message=(
                                f"Envoi refusé : {chute.material} : chute de {_fr(chute_m)} m, "
                                f"trop longue ({_fr(D365_MAX_QUANTITY_M)} m au plus). Vérifiez la saisie."
                            ),
                        )
                    )
                chute_by_material[chute.material] = chute_m
            else:
                skipped_chutes.append(chute.material)

        for material in sorted(set(skipped_widths) | set(skipped_chutes)):
            widths = skipped_widths.get(material, [])
            has_chute = material in skipped_chutes
            if material in D365_SHEET_ARTICLES:
                warnings.append(
                    D365OrderIssue(
                        material=material,
                        code="SHEET_NOT_COIL",
                        message=(
                            f"{material} : comptée en feuilles dans D365 ({D365_SHEET_ARTICLES[material]}), "
                            "pas en bobine. Non envoyée : à saisir à la main."
                        ),
                    )
                )
            elif material not in D365_COIL_ARTICLES:
                what = "bobines et chutes" if widths and has_chute else "chutes" if has_chute else "bobines"
                warnings.append(
                    D365OrderIssue(
                        material=material,
                        code="NO_COIL_ARTICLE",
                        message=f"{material} : pas de bobine dans D365. {what.capitalize()} non envoyées.",
                    )
                )
            else:
                for width in widths:
                    warnings.append(
                        D365OrderIssue(
                            material=material,
                            code="NO_COIL_ARTICLE",
                            message=f"{material} : pas de bobine {width} dans D365. Non envoyée.",
                        )
                    )

    sends_coils = bool(coils_by_material) or bool(chute_by_material)
    version: int = 2 if sends_coils else 1

    # --- Groupes : une matière avec pièces (libellé connu) ou bobines / chutes envoyées
    group_materials = sorted(set(lengths_by_material) | set(coils_by_material) | set(chute_by_material))
    if not group_materials and not errors:
        errors.append(
            D365OrderIssue(
                material=None,
                code="EMPTY",
                message="Rien à envoyer : aucune pièce ni bobine avec un code D365.",
            )
        )

    groups: list[D365OrderGroup] = []
    for material in group_materials:
        has_pieces = material in lengths_by_material
        label = D365_MATIERE_LABELS.get(material)
        matiere = label
        epaisseur = d365_epaisseur_label(resolve_material_spec(material).thickness_mm) if label else None
        lengths = lengths_by_material.get(material) or {str(b): 0 for b in DEV_PIECE_BOUNDS}
        if version == 1:
            groups.append(D365OrderGroup(material=material, matiere=matiere, epaisseur=epaisseur, lengths=lengths))
            continue
        groups.append(
            D365OrderGroup(
                material=material,
                matiere=matiere,
                epaisseur=epaisseur,
                lengths=lengths,
                has_pieces=has_pieces,
                coils=sorted(coils_by_material.get(material, []), key=lambda c: c.width_mm),
                all_articles=sorted(D365_COIL_ARTICLES.get(material, {}).values()),
                chute_m=chute_by_material.get(material, 0.0),
            )
        )

    return D365OrderResponse(
        order_number=order_number,
        version=2 if version == 2 else 1,
        groups=groups,
        errors=errors,
        warnings=warnings,
    )
