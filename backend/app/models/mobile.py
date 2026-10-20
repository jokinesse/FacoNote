"""
Modèles Pydantic pour la gestion des sessions mobiles de numérisation d'atelier.
Spécification technique : Section 4.1 du Cahier des Charges.
"""

from typing import Literal, Optional
from pydantic import BaseModel, ConfigDict, Field


class MobileSessionResponse(BaseModel):
    """
    Réponse à la création d'une session mobile (QR Code).
    """
    model_config = ConfigDict(extra="forbid")

    session_id: str = Field(..., description="Identifiant unique de la session (ex: FAC-4829-X7K1)")
    created_at: float = Field(..., description="Horodatage UNIX de création")
    qr_url: str = Field(..., description="URL cible encodée dans le QR Code pour le smartphone")


class MobileUploadRequest(BaseModel):
    """
    Requête d'envoi de photo depuis le smartphone atelier.
    """
    model_config = ConfigDict(extra="forbid")

    session_id: str = Field(..., description="Identifiant de la session active")
    image_base64: str = Field(..., min_length=10, description="Image encodée en Base64 (data URI ou brut)")
    filename: str = Field("croquis.jpg", description="Nom du fichier uploadé")
    note: Optional[str] = Field("", description="Remarque ou instruction vocale/texte de l'opérateur mobile")


class MobileStatusResponse(BaseModel):
    """
    État actuel d'une session pour le polling par le poste PC.
    """
    model_config = ConfigDict(extra="forbid")

    session_id: str
    status: Literal["waiting", "ready", "not_found", "expired"]
    has_image: bool = False
    image_base64: Optional[str] = None
    filename: Optional[str] = None
    note: Optional[str] = None
    created_at: Optional[float] = None
