"""
Modèles Pydantic des données de référence atelier (matières, largeurs, bornes).
Le frontend lit ces données au lieu d'avoir ses propres listes : une seule source.
"""

from pydantic import BaseModel, ConfigDict, Field

from app.models.coils import MetalFamily


class MaterialReference(BaseModel):
    """Une matière officielle et ses caractéristiques."""
    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., description="Libellé officiel (ex: 'Zinc Quartz 0.7')")
    group: str = Field(..., description="Groupe d'affichage (ex: 'Zinc épaisseur 0.7')")
    finish: str = Field(..., description="Finition (ex: 'Quartz', 'RAL 7016')")
    family: MetalFamily
    thickness_mm: float
    surface_density_kg_m2: float
    coil_widths_mm: list[int] = Field(..., description="Largeurs de bobines disponibles pour cette matière")
    d365_matiere: str | None = Field(None, description="Champ « Matières » dans D365 (None = pas encore connu)")
    d365_epaisseur: str = Field(..., description="Champ « Epaisseur » dans D365 (ex: '0.7 mm')")


class ReferenceResponse(BaseModel):
    """Toutes les données de référence utilisées par l'interface."""
    model_config = ConfigDict(extra="forbid")

    materials: list[MaterialReference]
    piece_bounds_mm: list[int] = Field(..., description="Bornes du calculateur Pièce")
    coil_widths_mm: list[int] = Field(..., description="Grille du calculateur Bobine (toutes largeurs confondues)")
    scrap_widths_mm: list[int] = Field(..., description="Largeurs des chutes de rack pré-coupées")
