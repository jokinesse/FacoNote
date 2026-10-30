"""
Données de référence atelier : matières officielles, largeurs de bobines, bornes.
Tout vient de app.core.constants, la seule source.
"""

from app.core.constants import (
    DEV_BOBINE_BOUNDS,
    DEV_PIECE_BOUNDS,
    OFFICIAL_MATERIALS,
    RACK_SCRAP_WIDTHS,
    MaterialSpec,
    STANDARDIZED_MATERIALS,
)
from app.models.coils import MetalFamily
from app.models.reference import MaterialReference, ReferenceResponse


def spec_family(spec: MaterialSpec) -> MetalFamily:
    """Famille de métal d'une fiche matière."""
    if spec.metal_type == "ALUMINIUM":
        return "ALU"
    if spec.metal_type == "ZINC":
        return "ZINC"
    return "AUTRE"


def official_materials_for_width(width_mm: int) -> list[str]:
    """Matières officielles disponibles dans une largeur de bobine."""
    return [
        name for name in OFFICIAL_MATERIALS
        if width_mm in STANDARDIZED_MATERIALS[name].standard_mother_widths_mm
    ]


def build_reference() -> ReferenceResponse:
    """Construit les données de référence envoyées à l'interface."""
    materials: list[MaterialReference] = []
    for name in OFFICIAL_MATERIALS:
        spec = STANDARDIZED_MATERIALS[name]
        family = spec_family(spec)
        prefix = "Alu" if family == "ALU" else "Zinc" if family == "ZINC" else spec.metal_type.capitalize()
        materials.append(
            MaterialReference(
                name=name,
                group=f"{prefix} épaisseur {spec.thickness_mm:g}",
                finish=spec.finish,
                family=family,
                thickness_mm=spec.thickness_mm,
                surface_density_kg_m2=spec.surface_density_kg_m2,
                coil_widths_mm=list(spec.standard_mother_widths_mm),
            )
        )
    return ReferenceResponse(
        materials=materials,
        piece_bounds_mm=list(DEV_PIECE_BOUNDS),
        coil_widths_mm=list(DEV_BOBINE_BOUNDS),
        scrap_widths_mm=list(RACK_SCRAP_WIDTHS),
    )
