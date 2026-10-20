"""
Routes API pour la gestion des sessions mobiles de transfert d'images atelier.
Spécification technique : Section 4.1 du Cahier des Charges.
"""

from fastapi import APIRouter, HTTPException, status
from app.models.mobile import (
    MobileSessionResponse,
    MobileStatusResponse,
    MobileUploadRequest,
)
from app.services.session_store import global_session_store

router = APIRouter(prefix="/mobile", tags=["Sessions Mobiles Atelier"])


@router.post(
    "/session",
    response_model=MobileSessionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Crée une session de transfert sans fil et génère l'URL pour QR Code",
)
def create_mobile_session_endpoint() -> MobileSessionResponse:
    """
    Initialise une session temporaire pour appairer un smartphone d'ouvrier avec le poste PC.
    """
    return global_session_store.create_session()


@router.post(
    "/upload",
    status_code=status.HTTP_200_OK,
    summary="Réception de l'image transmise par le smartphone",
)
def upload_mobile_image_endpoint(request: MobileUploadRequest) -> dict[str, str | bool]:
    """
    Reçoit la photo du croquis ou du plan envoyée depuis l'appareil mobile.
    """
    success = global_session_store.save_upload(
        session_id=request.session_id,
        image_base64=request.image_base64,
        filename=request.filename,
        note=request.note,
    )
    if not success:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="La session a expiré (TTL 45 min) ou est invalide.",
        )

    return {
        "success": True,
        "message": "Photo transmise avec succès au poste de travail",
        "session_id": request.session_id,
    }


@router.get(
    "/status/{session_id}",
    response_model=MobileStatusResponse,
    status_code=status.HTTP_200_OK,
    summary="Consultation / polling du statut de la session par le poste PC",
)
def get_mobile_status_endpoint(session_id: str) -> MobileStatusResponse:
    """
    Vérifie l'arrivée de la photo pour une session donnée.
    """
    status_resp = global_session_store.get_session(session_id)
    if status_resp.status == "not_found":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session introuvable : '{session_id}'",
        )
    if status_resp.status == "expired":
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Cette session a expiré après 45 minutes d'inactivité.",
        )
    return status_resp


@router.post(
    "/reset/{session_id}",
    status_code=status.HTTP_200_OK,
    summary="Réinitialise la session pour écouter une nouvelle prise de vue",
)
def reset_mobile_session_endpoint(session_id: str) -> dict[str, bool]:
    """
    Permet à l'opérateur de scanner un nouveau croquis sur la même session active.
    """
    ok = global_session_store.reset_session(session_id)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session introuvable pour réinitialisation.",
        )
    return {"success": True}
