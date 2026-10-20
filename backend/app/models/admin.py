"""
Modèles Pydantic v2 pour l'authentification Administrateur du Stress Lab.
"""

from pydantic import BaseModel, ConfigDict, Field


class AdminAuthRequest(BaseModel):
    """Requête d'authentification ou d'initialisation du mot de passe administrateur."""

    model_config = ConfigDict(extra="forbid")

    password: str = Field(..., min_length=1, max_length=256, description="Mot de passe administrateur")


class AdminTokenResponse(BaseModel):
    """Réponse contenant le jeton signé éphémère 256 bits."""

    model_config = ConfigDict(extra="forbid")

    token: str = Field(..., description="Jeton HMAC-SHA256 à passer dans l'en-tête X-Admin-Token")
    expires_at: float = Field(..., description="Horodatage UNIX d'expiration")
    ttl_sec: int = Field(..., description="Durée de validité restante en secondes")


class AdminStatusResponse(BaseModel):
    """État de configuration et de session du coffre-fort administrateur."""

    model_config = ConfigDict(extra="forbid")

    configured: bool = Field(..., description="True si une empreinte scrypt est présente sur le serveur")
    authenticated: bool = Field(..., description="True si le jeton X-Admin-Token fourni est valide")
    expires_in_sec: int = Field(0, description="Secondes restantes avant expiration de la session")
    locked_out: bool = Field(False, description="True si l'IP est temporairement bannie pour bruteforce")
    retry_after_sec: int = Field(0, description="Secondes restantes avant levée du bannissement IP")
