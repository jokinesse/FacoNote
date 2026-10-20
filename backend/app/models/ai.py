"""
Modèles Pydantic pour l'extraction OCR et vision multimodale par IA.
Spécification technique : Section 4.2 du Cahier des Charges.
"""

from typing import Optional
from pydantic import BaseModel, ConfigDict, Field
from app.models.pieces import ShapedPieceModel


class DocumentParseRequest(BaseModel):
    """
    Requête d'extraction multimodale transmise à /api/v1/ai/parse-document.
    """
    model_config = ConfigDict(extra="forbid")

    file_base64: Optional[str] = Field(None, description="Image ou document PDF encodé en Base64")
    mime_type: str = Field("image/jpeg", description="Type MIME du fichier (image/jpeg, image/png, application/pdf)")
    manual_text: Optional[str] = Field(None, description="Descriptif texte complémentaire (ex: '8 bavettes de 3m')")
    standard_length: float = Field(2.0, gt=0.1, le=14.0, description="Longueur par défaut si non spécifiée sur le croquis")


class DocumentParseResponse(BaseModel):
    """
    Nomenclature extraite du plan ou du croquis manuscrit.
    """
    model_config = ConfigDict(extra="forbid")

    client: str = Field("Client Comptoir", description="Nom du client identifié")
    chantier: str = Field("Chantier Standard", description="Référence ou adresse du chantier")
    detected_finish: str = Field("Zinc Quartz 0.7", description="Finition/matière dominante détectée")
    pieces: list[ShapedPieceModel] = Field(default_factory=list, description="Liste des profils extraits avec leurs cotes")
    raw_observations: Optional[str] = Field(None, description="Détails des mesures et cotes lues par l'IA")
    notes: Optional[str] = Field(None, description="Remarques éventuelles de l'atelier")
