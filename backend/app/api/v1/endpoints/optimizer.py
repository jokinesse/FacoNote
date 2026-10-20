"""
Routes API pour l'optimisation, calepinage et encodage rapide.
Spécification technique : Section 4.3 du Cahier des Charges.
"""

from fastapi import APIRouter, HTTPException, Response, status
from app.models.optimizer import (
    AutoBreakdownRequest,
    AutoPieceBreakdownResponse,
    OptimizationRequest,
    OptimizationResponse,
)
from app.models.pieces import FastEncoderEntryResponse, FastEncoderInputRequest
from app.services.breakdown_engine import resolve_auto_piece_breakdown
from app.services.encoder_engine import parse_composite_input
from app.services.nesting_engine import run_nesting_optimization
from app.services.sheet_generator import generate_workshop_sheet_html

router = APIRouter(prefix="/optimizer", tags=["Optimiseur & Calepinage"])


@router.post(
    "/auto-breakdown",
    response_model=AutoPieceBreakdownResponse,
    status_code=status.HTTP_200_OK,
    summary="Auto-calepinage du métrage linéaire sans quantité",
)
def auto_breakdown_endpoint(request: AutoBreakdownRequest) -> AutoPieceBreakdownResponse:
    """
    Exécute l'algorithme d'auto-métrage (Section 3.2) pour proposer les découpages
    d'atelier optimaux (0 chute / standards plieuse / alignement pièces existantes).
    """
    try:
        return resolve_auto_piece_breakdown(
            total_meters=request.total_meters,
            current_pieces=request.current_pieces,
            target_material=request.target_material,
            forced_length=request.forced_length,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Erreur lors du calcul d'auto-calepinage : {exc}",
        ) from exc


@router.post(
    "/calculate",
    response_model=OptimizationResponse,
    status_code=status.HTTP_200_OK,
    summary="Calcul d'imbrication et refente longitudinale (Nesting 1D/2D)",
)
def calculate_nesting_endpoint(request: OptimizationRequest) -> OptimizationResponse:
    """
    Exécute le moteur de refente sur tôles mères et chutes de rack (Section 3.3).
    Garantit la ségrégation par matière et calcule les métriques de synthèse d'atelier.
    """
    if not request.pieces:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La liste des pièces à usiner ne peut pas être vide.",
        )

    try:
        return run_nesting_optimization(request)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erreur lors de l'optimisation de refente : {exc}",
        ) from exc


@router.post(
    "/quick-encode",
    response_model=FastEncoderEntryResponse,
    status_code=status.HTTP_200_OK,
    summary="Analyse et validation d'une saisie rapide atelier (FastEncoder)",
)
def quick_encode_endpoint(request: FastEncoderInputRequest) -> FastEncoderEntryResponse:
    """
    Décode une expression d'atelier (ex: '175/8*3' ou '250/3*2+1.5') et affecte
    sur la première borne standard B >= dev.
    """
    try:
        item = parse_composite_input(
            input_str=request.raw_input,
            material_name=request.material,
            length_unit=request.length_unit,
            preset=request.preset,
        )
        return FastEncoderEntryResponse(
            raw_input=item.raw_input,
            dev=item.dev,
            unit_length_m=item.unit_length_m,
            quantity=item.quantity,
            total_length_m=item.total_length_m,
            matched_bound=item.matched_bound,
            is_chute=item.is_chute,
            is_auto_breakdown=item.is_auto_breakdown,
            surface_net_m2=item.surface_net_m2,
            weight_net_kg=item.weight_net_kg,
            material=item.material,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except ZeroDivisionError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Division par zéro dans l'expression arithmétique",
        ) from exc


@router.post(
    "/print-sheet",
    response_class=Response,
    status_code=status.HTTP_200_OK,
    summary="Génère la fiche de débit atelier A4 normalisée (HTML/Print)",
)
def print_sheet_endpoint(request: OptimizationRequest) -> Response:
    """
    Génère la fiche de débit d'atelier A4 (Section 2.5) prête pour l'impression
    au massicot et à la plieuse avec nomenclature, bon de sortie et récapitulatif.
    """
    if not request.pieces:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La liste des pièces ne peut pas être vide pour générer la fiche de débit.",
        )

    try:
        opt_result = run_nesting_optimization(request)
        html_sheet = generate_workshop_sheet_html(
            client_name=request.client_name,
            chantier_ref=request.chantier_ref,
            pieces=request.pieces,
            optimization=opt_result,
        )
        return Response(content=html_sheet, media_type="text/html")
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erreur lors de la génération de la fiche de débit : {exc}",
        ) from exc
