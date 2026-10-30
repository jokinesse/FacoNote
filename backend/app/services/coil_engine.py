"""
Moteur du calculateur Bobine.
- encode_coil_entry : valide et calcule une saisie (largeur / quantité / longueur).
- summarize_coils : regroupe les saisies par largeur × matière, calcule surfaces,
  poids, totaux, résumé ALU/ZINC et chutes par matière (chutes hors totaux).
Fonctions pures, sans dépendance web.
"""

from typing import Literal

from app.core.constants import (
    DEV_BOBINE_BOUNDS,
    calculate_surface_m2,
    calculate_weight_kg,
    resolve_material_spec,
    round_meters,
)
from app.models.coils import (
    CoilChuteModel,
    CoilEncodeResponse,
    CoilFamilyTotals,
    CoilRowModel,
    CoilSheetDetail,
    CoilSummaryEntry,
    CoilSummaryResponse,
    CoilTotalsModel,
    MetalFamily,
)
from app.services.math_parser import evaluate_expression


def metal_family(material: str) -> MetalFamily:
    """Famille de métal d'une matière, selon la table officielle des nuances."""
    metal_type = resolve_material_spec(material).metal_type
    if metal_type == "ALUMINIUM":
        return "ALU"
    if metal_type == "ZINC":
        return "ZINC"
    return "AUTRE"


def encode_coil_entry(
    width_expr: str,
    quantity: int,
    length_expr: str,
    length_unit: Literal["m", "mm"] = "m",
    material_name: str = "Zinc Naturel 0.7",
) -> CoilEncodeResponse:
    """
    Valide une saisie bobine.
    Lève ValueError si la largeur, la quantité ou la longueur est invalide,
    ZeroDivisionError en cas de division par zéro dans une expression.
    """
    try:
        width_value = evaluate_expression(width_expr)
    except ValueError as exc:
        raise ValueError(f"Largeur de bobine invalide : {exc}") from exc
    if width_value < 0:
        raise ValueError("Largeur de bobine invalide (en mm, ou 0 pour une chute)")
    width = round(width_value)

    if quantity < 1:
        raise ValueError("Quantité invalide (1 minimum)")

    try:
        length_value = evaluate_expression(length_expr)
    except ValueError as exc:
        raise ValueError(f"Longueur invalide : {exc}") from exc
    unit_length_m = length_value / 1000.0 if length_unit == "mm" else length_value
    unit_length_m = round_meters(unit_length_m)
    if unit_length_m <= 0:
        raise ValueError("La longueur doit être strictement supérieure à 0")

    return CoilEncodeResponse(
        width=width,
        quantity=quantity,
        unit_length_m=unit_length_m,
        total_length_m=round_meters(unit_length_m * quantity),
        material=resolve_material_spec(material_name).name,
        is_chute=width == 0,
        is_standard=width in DEV_BOBINE_BOUNDS,
    )


def summarize_coils(entries: list[CoilSummaryEntry]) -> CoilSummaryResponse:
    """
    Calcule le tableau du calculateur Bobine.
    Les saisies sont attendues de la plus ancienne à la plus récente ;
    le détail des feuilles garde cet ordre.
    """
    groups: dict[tuple[int, str], list[CoilSummaryEntry]] = {}
    chute_groups: dict[str, list[CoilSummaryEntry]] = {}

    for entry in entries:
        if entry.width == 0:
            chute_groups.setdefault(entry.material, []).append(entry)
        else:
            groups.setdefault((entry.width, entry.material), []).append(entry)

    materials_per_width: dict[int, int] = {}
    for width, _material in groups:
        materials_per_width[width] = materials_per_width.get(width, 0) + 1

    rows: list[CoilRowModel] = []
    for (width, material), group in groups.items():
        length_m = round_meters(sum(e.unit_length_m * e.quantity for e in group))
        density = resolve_material_spec(material).surface_density_kg_m2
        rows.append(
            CoilRowModel(
                width=width,
                material=material,
                family=metal_family(material),
                is_standard=width in DEV_BOBINE_BOUNDS,
                is_empty=False,
                quantity=sum(e.quantity for e in group),
                length_m=length_m,
                surface_m2=calculate_surface_m2(float(width), length_m),
                weight_kg=calculate_weight_kg(float(width), length_m, density),
                materials_in_width=materials_per_width[width],
                sheets=[
                    CoilSheetDetail(id=e.id, quantity=e.quantity, unit_length_m=e.unit_length_m)
                    for e in group
                ],
            )
        )

    # Largeurs standard sans saisie : lignes vides pour garder la grille complète
    for width in DEV_BOBINE_BOUNDS:
        if width not in materials_per_width:
            rows.append(
                CoilRowModel(
                    width=width,
                    material="",
                    family="AUTRE",
                    is_standard=True,
                    is_empty=True,
                    quantity=0,
                    length_m=0.0,
                    surface_m2=0.0,
                    weight_kg=0.0,
                    materials_in_width=0,
                    sheets=[],
                )
            )

    rows.sort(key=lambda r: (r.width, r.material))

    chutes = [
        CoilChuteModel(
            material=material,
            family=metal_family(material),
            quantity=sum(e.quantity for e in group),
            length_m=round_meters(sum(e.unit_length_m * e.quantity for e in group)),
            sheets=[
                CoilSheetDetail(id=e.id, quantity=e.quantity, unit_length_m=e.unit_length_m)
                for e in group
            ],
        )
        for material, group in sorted(chute_groups.items())
    ]

    filled = [r for r in rows if not r.is_empty]

    def family_totals(family: MetalFamily) -> CoilFamilyTotals:
        selected = [r for r in filled if r.family == family]
        return CoilFamilyTotals(
            quantity=sum(r.quantity for r in selected),
            length_m=round_meters(sum(r.length_m for r in selected)),
            weight_kg=round(sum(r.weight_kg for r in selected), 2),
        )

    totals = CoilTotalsModel(
        quantity=sum(r.quantity for r in filled),
        length_m=round_meters(sum(r.length_m for r in filled)),
        surface_m2=round(sum(r.surface_m2 for r in filled), 2),
        weight_kg=round(sum(r.weight_kg for r in filled), 2),
        chutes_quantity=sum(c.quantity for c in chutes),
        chutes_length_m=round_meters(sum(c.length_m for c in chutes)),
    )

    return CoilSummaryResponse(
        rows=rows,
        chutes=chutes,
        totals=totals,
        alu=family_totals("ALU"),
        zinc=family_totals("ZINC"),
        standard_widths=list(DEV_BOBINE_BOUNDS),
    )
