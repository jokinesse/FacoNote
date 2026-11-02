"""
Modèles Pydantic du calculateur Bobine (onglet Bobine du calculateur atelier).
On saisit la largeur de bobine consommée (0 = chute), la quantité et la longueur.
Le backend valide chaque saisie et calcule le tableau récapitulatif.
"""

from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

MetalFamily = Literal["ALU", "ZINC", "AUTRE"]


class CoilEncodeRequest(BaseModel):
    """Saisie brute d'une ligne bobine, telle que tapée par l'opérateur."""
    model_config = ConfigDict(extra="forbid")

    width: str = Field(
        ..., min_length=1, max_length=64,
        description="Largeur de bobine en mm, expression autorisée (ex: '1000'). 0 = chute",
    )
    quantity: int = Field(..., ge=1, le=10000, description="Nombre de feuilles")
    length: str = Field(
        ..., min_length=1, max_length=128,
        description="Longueur d'une feuille, expression autorisée (ex: '3.5' ou '2*1.5+4')",
    )
    length_unit: Literal["m", "mm"] = Field("m", description="Unité de la longueur saisie")
    material: str = Field("Zinc Naturel 0.7", min_length=1, max_length=100, description="Matière")


class CoilEncodeResponse(BaseModel):
    """Saisie bobine validée et calculée."""
    model_config = ConfigDict(extra="forbid")

    width: int = Field(..., description="Largeur de bobine en mm (0 = chute)")
    quantity: int = Field(..., description="Nombre de feuilles")
    unit_length_m: float = Field(..., description="Longueur d'une feuille en mètres")
    total_length_m: float = Field(..., description="Métrage total de la saisie en mètres")
    material: str = Field(..., description="Matière normalisée")
    is_chute: bool = Field(..., description="Vrai si largeur 0 (chute notée hors totaux)")
    is_standard: bool = Field(..., description="Vrai si la largeur est une largeur de bobine standard")


class CoilSummaryEntry(BaseModel):
    """Une saisie bobine déjà validée, envoyée pour le calcul du tableau."""
    model_config = ConfigDict(extra="forbid")

    id: str = Field(..., min_length=1, max_length=64, description="Identifiant de la saisie côté interface")
    width: int = Field(..., ge=0, le=5000, description="Largeur de bobine en mm (0 = chute)")
    quantity: int = Field(..., ge=1, le=10000, description="Nombre de feuilles")
    unit_length_m: float = Field(..., gt=0.0, le=1000.0, description="Longueur d'une feuille en mètres")
    material: str = Field(..., min_length=1, max_length=100, description="Matière")


class CoilSummaryRequest(BaseModel):
    """Liste des saisies bobines, de la plus ancienne à la plus récente."""
    model_config = ConfigDict(extra="forbid")

    entries: list[CoilSummaryEntry] = Field(default_factory=list, max_length=2000)


class CoilSheetDetail(BaseModel):
    """Détail d'une saisie dans une ligne du tableau (ex: 3 × 2.5 m)."""
    model_config = ConfigDict(extra="forbid")

    id: str
    quantity: int
    unit_length_m: float


class CoilRowModel(BaseModel):
    """Ligne du tableau : une largeur de bobine dans une matière (ou largeur standard vide)."""
    model_config = ConfigDict(extra="forbid")

    width: int
    material: str = Field(..., description="Matière (vide pour une largeur standard sans saisie)")
    family: MetalFamily
    is_standard: bool
    is_empty: bool
    quantity: int
    length_m: float
    surface_m2: float
    weight_kg: float
    materials_in_width: int = Field(..., description="Nombre de matières utilisant cette largeur")
    available_materials: list[str] = Field(
        default_factory=list, description="Matières officielles disponibles dans cette largeur"
    )
    sheets: list[CoilSheetDetail]


class CoilChuteModel(BaseModel):
    """Chutes notées pour une matière (hors totaux)."""
    model_config = ConfigDict(extra="forbid")

    material: str
    family: MetalFamily
    quantity: int
    length_m: float
    sheets: list[CoilSheetDetail]


class CoilFamilyTotals(BaseModel):
    """Totaux d'une famille de métal (ALU ou ZINC)."""
    model_config = ConfigDict(extra="forbid")

    quantity: int
    length_m: float
    weight_kg: float


class CoilMaterialTotals(BaseModel):
    """Totaux d'une matière précise (ex : Zinc ATZ 0.7), pour le filtre par matière."""
    model_config = ConfigDict(extra="forbid")

    material: str
    family: MetalFamily
    quantity: int
    length_m: float
    weight_kg: float


class CoilTotalsModel(BaseModel):
    """Totaux généraux du calcul bobines (chutes exclues)."""
    model_config = ConfigDict(extra="forbid")

    quantity: int
    length_m: float
    surface_m2: float
    weight_kg: float
    chutes_quantity: int
    chutes_length_m: float


class CoilSummaryResponse(BaseModel):
    """Tableau récapitulatif complet du calculateur Bobine."""
    model_config = ConfigDict(extra="forbid")

    rows: list[CoilRowModel]
    chutes: list[CoilChuteModel]
    totals: CoilTotalsModel
    alu: CoilFamilyTotals
    zinc: CoilFamilyTotals
    materials: list[CoilMaterialTotals] = Field(default_factory=list)
    standard_widths: list[int]
