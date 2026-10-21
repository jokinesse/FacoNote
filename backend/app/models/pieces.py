"""
Modèles Pydantic pour les pièces façonnées et saisies atelier.
Spécification technique : Section 5.1 du Cahier des Charges.
"""

from typing import Literal, Optional
from pydantic import BaseModel, ConfigDict, Field


class ShapedPieceModel(BaseModel):
    """
    Modèle d'une pièce façonnée conforme à la spécification Section 5.1.
    """
    model_config = ConfigDict(extra="forbid")

    id: str = Field(..., description="Identifiant unique de la pièce")
    label: str = Field(..., min_length=1, description="Libellé ou désignation (ex: Bavette d'égout)")
    dev: int = Field(..., ge=20, le=2000, description="Développé en mm")
    length: float = Field(..., ge=0.1, le=14.0, description="Longueur unitaire en mètres")
    quantity: int = Field(..., ge=1, le=1000, description="Nombre de pièces à produire")
    bends: int = Field(2, ge=0, le=20, description="Nombre de plis de la pièce")
    material: str = Field("Zinc Naturel 0.7", description="Matière et finition (ex: Zinc Quartz 0.7, Alu 7016 gris bleu 0.7)")
    workshop_split_reason: Optional[str] = Field(default=None, description="Explication du découpage en longueurs atelier si applicable")
    notes: Optional[str] = Field(default=None, description="Remarques spécifiques atelier")
    original_total_length_requested: Optional[float] = Field(default=None, description="Métrage linéaire total demandé à l'origine si saisie sans quantité")
    source_type: Optional[Literal["BOBINE", "RACK_SCRAP"]] = Field(default="BOBINE", description="Origine atelier de la pièce : bobine mère ou chute de rack")


class FastEncoderInputRequest(BaseModel):
    """
    Saisie rapide composite atelier (FastEncoder).
    """
    model_config = ConfigDict(extra="forbid")

    raw_input: str = Field(..., description="Expression ou saisie avec barre oblique (ex: '175/8*3' ou '250/3*2+1.5')")
    material: str = Field("Zinc Naturel 0.7", description="Nuance de matière sélectionnée")
    length_unit: Literal["m", "mm"] = Field("m", description="Unité de longueur saisie")
    preset: Literal["DEV_PIECE", "DEV_BOBINE"] = Field("DEV_PIECE", description="Preset des bornes actives")


class FastEncoderEntryResponse(BaseModel):
    """
    Résultat d'évaluation d'une ligne d'encodage rapide.
    """
    model_config = ConfigDict(extra="forbid")

    raw_input: str
    dev: int
    unit_length_m: float
    quantity: int
    total_length_m: float
    matched_bound: int
    is_chute: bool
    is_auto_breakdown: bool
    surface_net_m2: float
    weight_net_kg: float
    material: str
