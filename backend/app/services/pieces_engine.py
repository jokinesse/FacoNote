"""
Moteur du tableau du calculateur Pièce.
- encode_pieces : valide un lot de pièces déjà décomposées (import IA, auto-métrage).
- summarize_pieces : vue par développement, grille des bornes, totaux par matière
  et par famille, parts en %, repères « même développement ».
Fonctions pures, sans dépendance web.

Règles de calcul (identiques à l'interface avant migration) :
- vue par développement et totaux par matière : au développement réel (net) ;
- grille des bornes : à la largeur de la borne ;
- surface affichée en haut / pied de tableau : aux bornes ; poids affiché : net.
"""

from app.core.constants import (
    DEV_PIECE_BOUNDS,
    calculate_surface_m2,
    calculate_weight_kg,
    resolve_material_spec,
    round_meters,
)
from app.models.coils import MetalFamily
from app.models.pieces import FastEncoderEntryResponse
from app.models.pieces_summary import (
    PieceBoundRow,
    PieceCutDetail,
    PieceDevRow,
    PieceEncodeItem,
    PieceFamilyTotals,
    PieceMaterialSummary,
    PiecesSummaryResponse,
    PieceSummaryEntry,
    PieceTotals,
)
from app.services.encoder_engine import find_matched_bound
from app.services.reference_service import spec_family


def _family(material: str) -> MetalFamily:
    return spec_family(resolve_material_spec(material))


def _percent(length_m: float, total_m: float) -> float:
    return round(length_m / total_m * 100, 1) if total_m > 0 else 0.0


def encode_pieces(items: list[PieceEncodeItem]) -> list[FastEncoderEntryResponse]:
    """Valide et calcule un lot de pièces (même résultat qu'une saisie rapide)."""
    results: list[FastEncoderEntryResponse] = []
    for item in items:
        dev = round(item.dev)
        if dev <= 0:
            raise ValueError(f"Développé invalide ({item.dev} mm) pour '{item.label or 'pièce'}'")
        unit_length_m = round_meters(item.unit_length_m)
        if unit_length_m <= 0:
            raise ValueError(f"Longueur invalide pour '{item.label or 'pièce'}'")
        total_length_m = round_meters(unit_length_m * item.quantity)
        spec = resolve_material_spec(item.material)
        results.append(
            FastEncoderEntryResponse(
                raw_input=item.label or f"{dev}/{item.quantity}*{unit_length_m}",
                dev=dev,
                unit_length_m=unit_length_m,
                quantity=item.quantity,
                total_length_m=total_length_m,
                matched_bound=find_matched_bound(float(dev), DEV_PIECE_BOUNDS),
                is_chute=False,
                is_auto_breakdown=False,
                surface_net_m2=calculate_surface_m2(float(dev), total_length_m),
                weight_net_kg=calculate_weight_kg(float(dev), total_length_m, spec.surface_density_kg_m2),
                material=spec.name,
            )
        )
    return results


def summarize_pieces(entries: list[PieceSummaryEntry]) -> PiecesSummaryResponse:
    """Calcule le tableau du calculateur Pièce (saisies de la plus ancienne à la plus récente)."""
    total_length = round_meters(sum(e.unit_length_m * e.quantity for e in entries))

    # Développements présents dans plusieurs matières
    materials_by_dev: dict[int, list[str]] = {}
    for e in entries:
        mats = materials_by_dev.setdefault(e.dev, [])
        if e.material not in mats:
            mats.append(e.material)

    def cut(e: PieceSummaryEntry) -> PieceCutDetail:
        return PieceCutDetail(
            id=e.id,
            dev=e.dev,
            quantity=e.quantity,
            unit_length_m=e.unit_length_m,
            is_shared_dev=len(materials_by_dev[e.dev]) > 1,
        )

    def length_of(group: list[PieceSummaryEntry]) -> float:
        return round_meters(sum(e.unit_length_m * e.quantity for e in group))

    # --- Vue par développement réel
    dev_groups: dict[tuple[int, str], list[PieceSummaryEntry]] = {}
    for e in entries:
        dev_groups.setdefault((e.dev, e.material), []).append(e)

    dev_rows: list[PieceDevRow] = []
    for (dev, material), group in sorted(dev_groups.items()):
        length_m = length_of(group)
        density = resolve_material_spec(material).surface_density_kg_m2
        others = [m for m in materials_by_dev[dev] if m != material]
        dev_rows.append(
            PieceDevRow(
                dev=dev,
                bound=find_matched_bound(float(dev), DEV_PIECE_BOUNDS),
                material=material,
                family=_family(material),
                quantity=sum(e.quantity for e in group),
                length_m=length_m,
                surface_m2=calculate_surface_m2(float(dev), length_m),
                weight_kg=calculate_weight_kg(float(dev), length_m, density),
                percent=_percent(length_m, total_length),
                is_shared_dev=len(others) > 0,
                shared_with_materials=others,
                cuts=[cut(e) for e in group],
            )
        )

    # --- Grille des bornes (une ligne par borne et par matière, bornes vides comprises)
    bound_groups: dict[int, dict[str, list[PieceSummaryEntry]]] = {b: {} for b in DEV_PIECE_BOUNDS}
    for e in entries:
        bound = find_matched_bound(float(e.dev), DEV_PIECE_BOUNDS)
        bound_groups[bound].setdefault(e.material, []).append(e)

    bound_rows: list[PieceBoundRow] = []
    for bound in DEV_PIECE_BOUNDS:
        by_material = bound_groups[bound]
        if not by_material:
            bound_rows.append(
                PieceBoundRow(
                    bound=bound, material="", family="AUTRE", is_empty=True, quantity=0,
                    length_m=0.0, surface_m2=0.0, weight_kg=0.0, percent=0.0,
                    is_multi_material_bound=False, has_shared_dev=False, cuts=[],
                )
            )
            continue
        for material, group in sorted(by_material.items()):
            length_m = length_of(group)
            density = resolve_material_spec(material).surface_density_kg_m2
            cuts = [cut(e) for e in group]
            bound_rows.append(
                PieceBoundRow(
                    bound=bound,
                    material=material,
                    family=_family(material),
                    is_empty=False,
                    quantity=sum(e.quantity for e in group),
                    length_m=length_m,
                    surface_m2=calculate_surface_m2(float(bound), length_m),
                    weight_kg=calculate_weight_kg(float(bound), length_m, density),
                    percent=_percent(length_m, total_length),
                    is_multi_material_bound=len(by_material) > 1,
                    has_shared_dev=any(c.is_shared_dev for c in cuts),
                    cuts=cuts,
                )
            )

    # --- Totaux par matière et par famille (nets)
    materials: list[PieceMaterialSummary] = []
    for material in sorted({e.material for e in entries}):
        rows = [r for r in dev_rows if r.material == material]
        length_m = round_meters(sum(r.length_m for r in rows))
        materials.append(
            PieceMaterialSummary(
                material=material,
                family=_family(material),
                quantity=sum(r.quantity for r in rows),
                length_m=length_m,
                surface_m2=round(sum(r.surface_m2 for r in rows), 2),
                weight_kg=round(sum(r.weight_kg for r in rows), 2),
                percent=_percent(length_m, total_length),
            )
        )

    def family_totals(family: MetalFamily) -> PieceFamilyTotals:
        rows = [m for m in materials if m.family == family]
        return PieceFamilyTotals(
            quantity=sum(m.quantity for m in rows),
            length_m=round_meters(sum(m.length_m for m in rows)),
            surface_m2=round(sum(m.surface_m2 for m in rows), 2),
            weight_kg=round(sum(m.weight_kg for m in rows), 2),
        )

    filled_bounds = [r for r in bound_rows if not r.is_empty]
    totals = PieceTotals(
        quantity=sum(e.quantity for e in entries),
        length_m=total_length,
        surface_bound_m2=round(sum(r.surface_m2 for r in filled_bounds), 2),
        surface_net_m2=round(sum(r.surface_m2 for r in dev_rows), 2),
        weight_net_kg=round(sum(r.weight_kg for r in dev_rows), 2),
    )

    return PiecesSummaryResponse(
        dev_rows=dev_rows,
        bound_rows=bound_rows,
        materials=materials,
        alu=family_totals("ALU"),
        zinc=family_totals("ZINC"),
        totals=totals,
    )
