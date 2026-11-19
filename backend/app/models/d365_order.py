"""
Modèles Pydantic de la commande envoyée vers l'extension « Façonote → D365 » :
pièces (DEV) et bobines d'une même commande, regroupées par matière.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.coils import CoilSummaryEntry
from app.models.pieces_summary import PieceSummaryEntry


class D365OrderRequest(BaseModel):
    """Saisies pièces et bobines d'une commande, de la plus ancienne à la plus récente."""
    model_config = ConfigDict(extra="forbid")

    order_number: str = Field(..., pattern=r"^CC\d{11}$", description="N° de commande D365 (CC + 11 chiffres)")
    pieces: list[PieceSummaryEntry] = Field(default_factory=list, max_length=5000)
    coils: list[CoilSummaryEntry] = Field(default_factory=list, max_length=2000)


class D365OrderCoil(BaseModel):
    """Une bobine à saisir dans la grille Nomenclature : quantité = longueur totale en mètres."""
    model_config = ConfigDict(extra="forbid")

    width_mm: int
    article: str = Field(..., description="Code article D365 (« AR » + 8 chiffres)")
    quantity_m: float = Field(..., description="Longueur totale en mètres, 2 décimales")


class D365OrderGroup(BaseModel):
    """
    Une matière de la commande (une tâche dans l'extension).
    Message version 1 (pièces seules) : seulement material, matiere, epaisseur, lengths.
    """
    model_config = ConfigDict(extra="forbid")

    material: str
    matiere: str | None = Field(..., description="Champ « Matières » D365 (None si inconnu, bobines seules)")
    epaisseur: str | None = Field(..., description="Champ « Epaisseur » D365 (None si inconnu, bobines seules)")
    lengths: dict[str, float] = Field(..., description="Borne (mm) -> longueur (m), les 19 bornes")
    has_pieces: bool | None = None
    coils: list[D365OrderCoil] | None = None
    all_articles: list[str] | None = Field(
        None, description="Tous les codes AR de la matière (reconnaissance de la grille)"
    )
    chute_m: float | None = Field(None, description="Chutes de la matière en mètres, 2 décimales")


D365OrderIssueCode = Literal["NO_MATIERE_LABEL", "EMPTY", "NO_COIL_ARTICLE", "SHEET_NOT_COIL", "ROUNDS_TO_ZERO"]


class D365OrderIssue(BaseModel):
    """Erreur (envoi refusé) ou avertissement (envoi du reste)."""
    model_config = ConfigDict(extra="forbid")

    material: str | None = Field(..., description="Matière concernée (None si plusieurs ou aucune)")
    code: D365OrderIssueCode
    message: str


class D365OrderResponse(BaseModel):
    """Commande prête pour l'extension. errors non vide = envoi refusé."""
    model_config = ConfigDict(extra="forbid")

    order_number: str
    version: Literal[1, 2] = Field(..., description="1 = pièces seules (message actuel), 2 = avec bobines")
    groups: list[D365OrderGroup]
    errors: list[D365OrderIssue] = Field(default_factory=list)
    warnings: list[D365OrderIssue] = Field(default_factory=list)
