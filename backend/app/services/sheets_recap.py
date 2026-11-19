"""
Récapitulatif des feuilles / bobines mères à sortir du magasin, par matière et par format.
Calculé à partir des opérations de refente du moteur d'imbrication.
Les reprises sur chutes déjà sorties (REUSED_OFFCUT) ne demandent pas de nouvelle feuille.
"""

from app.core.constants import calculate_surface_m2, resolve_material_spec, round_meters
from app.models.optimizer import (
    SheetFormatRecapModel,
    SheetPieceCountModel,
    SheetsCumulMaterialModel,
    SheetsCumulWidthModel,
    SheetsRecapMaterialModel,
    SheetsRecapTotalsModel,
    SlitNestResultModel,
)


def build_sheets_recap(
    slits: list[SlitNestResultModel],
) -> tuple[list[SheetsRecapMaterialModel], SheetsRecapTotalsModel]:
    """Regroupe les feuilles mères neuves par matière puis par format (largeur × longueur)."""
    by_material: dict[str, dict[tuple[int, float], list[SlitNestResultModel]]] = {}
    for slit in slits:
        if slit.source_type == "REUSED_OFFCUT":
            continue
        formats = by_material.setdefault(slit.material, {})
        formats.setdefault((slit.mother_width, slit.mother_length), []).append(slit)

    materials: list[SheetsRecapMaterialModel] = []
    for material, formats in by_material.items():
        density = resolve_material_spec(material).surface_density_kg_m2
        format_models: list[SheetFormatRecapModel] = []
        # Du plus grand au plus petit : largeur, puis longueur
        for (width, length), sheets in sorted(formats.items(), key=lambda kv: (-kv[0][0], -kv[0][1])):
            count = len(sheets)
            total_length = round_meters(length * count)
            surface = calculate_surface_m2(float(width), total_length)
            pieces: dict[tuple[str, int], int] = {}
            for sheet in sheets:
                for strip in sheet.strips:
                    key = (strip.label, strip.dev)
                    pieces[key] = pieces.get(key, 0) + (strip.qty or 1)
            format_models.append(
                SheetFormatRecapModel(
                    mother_width=width,
                    mother_length=length,
                    count=count,
                    total_length_m=total_length,
                    total_surface_m2=surface,
                    total_weight_kg=round(surface * density, 2),
                    pieces=[
                        SheetPieceCountModel(label=label, dev=dev, count=n)
                        for (label, dev), n in pieces.items()
                    ],
                )
            )
        materials.append(
            SheetsRecapMaterialModel(
                material=material,
                surface_density_kg_m2=density,
                total_sheets=sum(f.count for f in format_models),
                total_length_m=round_meters(sum(f.total_length_m for f in format_models)),
                total_surface_m2=round(sum(f.total_surface_m2 for f in format_models), 2),
                total_weight_kg=round(sum(f.total_weight_kg for f in format_models), 2),
                formats=format_models,
            )
        )

    totals = SheetsRecapTotalsModel(
        total_sheets=sum(m.total_sheets for m in materials),
        total_length_m=round_meters(sum(m.total_length_m for m in materials)),
        total_surface_m2=round(sum(m.total_surface_m2 for m in materials), 2),
        total_weight_kg=round(sum(m.total_weight_kg for m in materials), 2),
    )
    return materials, totals



def build_sheets_cumul(materials: list[SheetsRecapMaterialModel]) -> list[SheetsCumulMaterialModel]:
    """Cumule les longueurs de toutes les feuilles par matière puis par borne, de la plus large à la plus étroite."""
    result: list[SheetsCumulMaterialModel] = []
    for mat in materials:
        by_width: dict[int, list[SheetFormatRecapModel]] = {}
        for fmt in mat.formats:
            by_width.setdefault(fmt.mother_width, []).append(fmt)
        widths = [
            SheetsCumulWidthModel(
                mother_width=width,
                total_length_m=round_meters(sum(f.total_length_m for f in fmts)),
                total_sheets=sum(f.count for f in fmts),
                total_weight_kg=round(sum(f.total_weight_kg for f in fmts), 2),
            )
            for width, fmts in sorted(by_width.items(), key=lambda kv: -kv[0])
        ]
        result.append(
            SheetsCumulMaterialModel(
                material=mat.material,
                total_length_m=mat.total_length_m,
                total_sheets=mat.total_sheets,
                total_weight_kg=mat.total_weight_kg,
                widths=widths,
            )
        )
    return result
