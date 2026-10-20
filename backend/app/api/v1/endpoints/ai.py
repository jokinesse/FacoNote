"""
Routes API pour l'intelligence artificielle, l'OCR et le traitement d'images d'atelier.
Spécification technique : Section 4.2 & 2.3 du Cahier des Charges.
"""

from typing import Optional
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field
from app.models.ai import DocumentParseRequest, DocumentParseResponse
from app.services.ai_ocr_service import parse_document_multimodal
from app.services.image_pipeline import process_image_for_ocr

router = APIRouter(prefix="/ai", tags=["Intelligence Artificielle & OCR"])


class ImageProcessRequest(BaseModel):
    image_base64: str = Field(..., description="Image en base64 à prétraiter")
    rotation_deg: int = Field(0, description="Angle de rotation (0, 90, 180, 270)")
    contrast_boost: float = Field(1.15, description="Facteur de contraste (+15% par défaut)")


class ImageProcessResponse(BaseModel):
    data_uri: str
    mime_type: str
    width: int
    height: int


@router.post(
    "/parse-document",
    response_model=DocumentParseResponse,
    status_code=status.HTTP_200_OK,
    summary="Extraction OCR multimodale de pièces depuis un croquis ou plan",
)
def parse_document_endpoint(request: DocumentParseRequest) -> DocumentParseResponse:
    """
    Extrait automatiquement la nomenclature des profils depuis un plan PDF ou un croquis
    tracé à main levée, avec comptage des plis et calcul du développé total.
    """
    if not request.file_base64 and not (request.manual_text and request.manual_text.strip()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Veuillez fournir un document image/PDF ou un descriptif textuel d'atelier.",
        )

    try:
        return parse_document_multimodal(request)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erreur lors de l'extraction par IA : {exc}",
        ) from exc


@router.post(
    "/process-image",
    response_model=ImageProcessResponse,
    status_code=status.HTTP_200_OK,
    summary="Prétraitement d'image Pillow (rotation orthogonale et contraste +15%)",
)
def process_image_endpoint(request: ImageProcessRequest) -> ImageProcessResponse:
    """
    Applique la rotation orthogonale et le rehaussement de contraste sur le croquis
    pour révéler les traits de crayon avant injection dans l'OCR.
    """
    try:
        result = process_image_for_ocr(
            image_base64=request.image_base64,
            rotation_deg=request.rotation_deg,
            contrast_boost=request.contrast_boost,
        )
        return ImageProcessResponse(
            data_uri=result.data_uri,
            mime_type=result.mime_type,
            width=result.width,
            height=result.height,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
