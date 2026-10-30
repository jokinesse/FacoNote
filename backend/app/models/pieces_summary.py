"""
Modèles Pydantic du tableau du calculateur Pièce (vue par développement et grille des bornes)
et de l'encodage structuré de pièces (import du scan IA, résultat d'auto-métrage).
"""

from pydantic import BaseModel, ConfigDict, Field

from app.models.coils import MetalFamily
from app.models.pieces import FastEncoderEntryResponse


class PieceEncodeItem(BaseModel):
    """Une pièce déjà décomposée (développé, quantité, longueur unitaire en mètres)."""
    model_config = ConfigDict(extra="forbid")

    dev: float = Field(..., gt=0.0, le=5000.0, description="Développé en mm")
    quantity: int = Field(..., ge=1, le=10000, description="Nombre de pièces")
    unit_length_m: float = Field(..., gt=0.0, le=1000.0, description="Longueur unitaire en mètres")
    material: str = Field("Zinc Naturel 0.7", min_length=1, max_length=100)
    label: str = Field("", max_length=200, description="Libellé d'origine (ex: profil détecté par l'IA)")


class PiecesEncodeRequest(BaseModel):
    """Lot de pièces à valider et calculer."""
    model_config = ConfigDict(extra="forbid")

    items: list[PieceEncodeItem] = Field(..., min_length=1, max_length=500)


class PiecesEncodeResponse(BaseModel):
    """Pièces validées (même format qu'une saisie rapide)."""
    model_config = ConfigDict(extra="forbid")

    entries: list[FastEncoderEntryResponse]


class PieceSummaryEntry(BaseModel):
    """Une saisie pièce déjà validée, envoyée pour le calcul du tableau."""
    model_config = ConfigDict(extra="forbid")

    id: str = Field(..., min_length=1, max_length=64)
    dev: int = Field(..., ge=1, le=5000, description="Développé en mm")
    quantity: int = Field(..., ge=1, le=10000)
    unit_length_m: float = Field(..., gt=0.0, le=1000.0)
    material: str = Field(..., min_length=1, max_length=100)


class PiecesSummaryRequest(BaseModel):
    """Liste des saisies pièces, de la plus ancienne à la plus récente."""
    model_config = ConfigDict(extra="forbid")

    entries: list[PieceSummaryEntry] = Field(default_factory=list, max_length=5000)


class PieceCutDetail(BaseModel):
    """Détail d'une saisie dans une ligne du tableau (ex: 3 × 2.5 m)."""
    model_config = ConfigDict(extra="forbid")

    id: str
    dev: int
    quantity: int
    unit_length_m: float
    is_shared_dev: bool = Field(..., description="Ce développement existe aussi dans une autre matière")


class PieceDevRow(BaseModel):
    """Vue par développement : un développement réel dans une matière."""
    model_config = ConfigDict(extra="forbid")

    dev: int
    bound: int = Field(..., description="Borne atelier affectée")
    material: str
    family: MetalFamily
    quantity: int
    length_m: float
    surface_m2: float = Field(..., description="Surface nette (développé × longueur)")
    weight_kg: float = Field(..., description="Poids net (surface nette × densité)")
    percent: float = Field(..., description="Part du métrage total, en %")
    is_shared_dev: bool
    shared_with_materials: list[str]
    cuts: list[PieceCutDetail]


class PieceBoundRow(BaseModel):
    """Grille des bornes : une borne dans une matière (ou borne vide)."""
    model_config = ConfigDict(extra="forbid")

    bound: int
    material: str = Field(..., description="Matière (vide pour une borne sans saisie)")
    family: MetalFamily
    is_empty: bool
    quantity: int
    length_m: float
    surface_m2: float = Field(..., description="Surface à la borne (borne × longueur)")
    weight_kg: float = Field(..., description="Poids à la borne (surface à la borne × densité)")
    percent: float
    is_multi_material_bound: bool
    has_shared_dev: bool
    cuts: list[PieceCutDetail]


class PieceMaterialSummary(BaseModel):
    """Totaux d'une matière (nets : au développement réel)."""
    model_config = ConfigDict(extra="forbid")

    material: str
    family: MetalFamily
    quantity: int
    length_m: float
    surface_m2: float
    weight_kg: float
    percent: float


class PieceFamilyTotals(BaseModel):
    """Totaux d'une famille de métal (ALU ou ZINC), nets."""
    model_config = ConfigDict(extra="forbid")

    quantity: int
    length_m: float
    surface_m2: float
    weight_kg: float


class PieceTotals(BaseModel):
    """Totaux généraux du tableau des pièces."""
    model_config = ConfigDict(extra="forbid")

    quantity: int
    length_m: float
    surface_bound_m2: float = Field(..., description="Surface aux bornes (affichée en haut et en pied de tableau)")
    surface_net_m2: float = Field(..., description="Surface nette au développement réel")
    weight_net_kg: float = Field(..., description="Poids net au développement réel")


class PiecesSummaryResponse(BaseModel):
    """Tableau complet du calculateur Pièce."""
    model_config = ConfigDict(extra="forbid")

    dev_rows: list[PieceDevRow]
    bound_rows: list[PieceBoundRow]
    materials: list[PieceMaterialSummary]
    alu: PieceFamilyTotals
    zinc: PieceFamilyTotals
    totals: PieceTotals
