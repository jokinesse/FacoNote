"""
Modèles Pydantic pour l'optimisation de calepinage, refente et décomposition de métrage.
Spécification technique : Section 4.3, 5.1 et 3.2 du Cahier des Charges.
"""

from typing import Literal, Optional
from pydantic import BaseModel, ConfigDict, Field
from app.models.pieces import ShapedPieceModel


class AutoPieceBreakdownAlternative(BaseModel):
    """
    Proposition alternative de découpage pour un métrage linéaire sans quantité.
    """
    model_config = ConfigDict(extra="forbid")

    length: float = Field(..., description="Longueur unitaire de la pièce en mètres")
    quantity: int = Field(..., description="Nombre de pièces résultant du calepinage")
    total_produced: float = Field(..., description="Métrage total produit en mètres")
    excess: float = Field(..., description="Excédent ou chute linéaire en mètres")
    is_exact: bool = Field(..., description="Vrai si 0 chute (tombe pile)")
    is_existing: bool = Field(..., description="Vrai si correspond à une longueur déjà présente sur le bon")
    is_closest: bool = Field(False, description="Vrai si c'est la proposition non-exacte la plus proche")
    score: float = Field(..., description="Score algorithmique de pertinence")
    label: str = Field(..., description="Libellé explicatif pour l'opérateur")


class AutoPieceBreakdownResponse(BaseModel):
    """
    Résultat complet de l'auto-calepinage du métrage linéaire.
    """
    model_config = ConfigDict(extra="forbid")

    length: float = Field(..., description="Longueur unitaire recommandée en mètres")
    quantity: int = Field(..., description="Quantité recommandée de pièces")
    total_produced: float = Field(..., description="Métrage total résultant")
    requested_meters: float = Field(..., description="Métrage demandé par le client")
    reason: str = Field(..., description="Justification de la proposition retenue")
    source: Literal["existing_pieces", "standard_exact", "standard_rounded"] = Field(
        ..., description="Origine de la recommandation principale"
    )
    alternatives: list[AutoPieceBreakdownAlternative] = Field(
        ..., description="Liste ordonnée de toutes les alternatives viables"
    )


class AutoBreakdownRequest(BaseModel):
    """
    Requête d'auto-métrage transmise à l'endpoint /api/v1/optimizer/auto-breakdown.
    """
    model_config = ConfigDict(extra="forbid")

    total_meters: float = Field(..., gt=0.0, le=500.0, description="Métrage linéaire total requis en mètres")
    current_pieces: list[ShapedPieceModel] = Field(
        default_factory=list, description="Pièces déjà existantes sur la commande pour harmonisation de débit"
    )
    target_material: str = Field("Zinc Naturel 0.7", description="Matière ciblée pour la recherche de cohortes")
    forced_length: Optional[float] = Field(None, gt=0.0, description="Longueur forcée manuellement par l'opérateur")


class OptimizationRequest(BaseModel):
    """
    Requête d'optimisation de refente transmise à /api/v1/optimizer/calculate.
    Conforme Section 5.1.
    """
    model_config = ConfigDict(extra="forbid")

    client_name: str = Field("Client Comptoir", description="Nom du client")
    chantier_ref: str = Field("Chantier Standard", description="Référence du chantier")
    material: str = Field("Zinc Naturel 0.7", description="Matière globale par défaut")
    pieces: list[ShapedPieceModel] = Field(..., min_length=1, description="Liste des pièces à imbriquer")
    available_mother_widths: Optional[list[int]] = Field(None, description="Laizes mères en stock autorisées")
    use_workshop_scraps: bool = Field(False, description="Activer la substitution par des bandes de rack")
    accepted_proposal_ids: Optional[list[str]] = Field(None, description="IDs des propositions de substitution acceptées")


class SlitStripModel(BaseModel):
    """Bande de tôle issue de la refente longitudinale."""
    model_config = ConfigDict(extra="forbid")

    piece_id: str
    label: str
    dev: int
    length: float
    qty: int
    material: str


class SlitNestResultModel(BaseModel):
    """Résultat de découpe sur une laize mère."""
    model_config = ConfigDict(extra="forbid")

    mother_width: int
    mother_length: float
    material: str
    strips: list[SlitStripModel]
    used_width: int
    scrap_width: int
    is_scrap_reusable: bool
    suggested_scrap_ref: Optional[str] = None


class WorkshopScrapProposalModel(BaseModel):
    """Proposition de substitution d'une pièce isolée par une chute de rack."""
    model_config = ConfigDict(extra="forbid")

    id: str
    piece_id: str
    piece_label: str
    piece_dev: int
    piece_length: float
    recommended_scrap_dev: int  # 100, 120, 150, 200, 250 mm
    material: str
    reason: str
    mother_width_saved: int
    mother_length_saved: float
    area_saved_m2: float
    weight_saved_kg: float


class AppliedWorkshopScrapModel(BaseModel):
    """Chute de rack appliquée en substitution d'une refente."""
    model_config = ConfigDict(extra="forbid")

    piece_id: str
    piece_label: str
    piece_dev: int
    piece_length: float
    scrap_dev: int
    material: str


class OptimizationResponse(BaseModel):
    """
    Synthèse globale de découpe et de nesting.
    """
    model_config = ConfigDict(extra="forbid")

    order_id: str
    timestamp: float
    material_efficiency_rate: float = Field(..., description="Taux de rendement matière (ex: 94.5%)")
    total_net_surface_m2: float = Field(..., description="Surface nette des pièces en m²")
    total_gross_surface_m2: float = Field(..., description="Surface brute des tôles mères en m²")
    reusable_scrap_surface_m2: float = Field(..., description="Surface des chutes réutilisables d'atelier en m²")
    net_loss_surface_m2: float = Field(..., description="Perte sèche (chutes non réutilisables) en m²")
    net_weight_kg: float = Field(..., description="Poids net des pièces façonnées en kg")
    gross_weight_kg: float = Field(..., description="Poids brut des bobines/feuilles mères débitées en kg")
    slits: list[SlitNestResultModel] = Field(default_factory=list)
    workshop_scrap_proposals: list[WorkshopScrapProposalModel] = Field(default_factory=list)
    applied_workshop_scraps: list[AppliedWorkshopScrapModel] = Field(default_factory=list)
    summary_message: str = Field("", description="Synthèse d'atelier pour l'opérateur")
