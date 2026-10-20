"""
Routeur principal pour l'API v1.
Agrège les endpoints de calepinage/optimisation, de sessions mobiles, d'IA/OCR et de sécurité Admin.
"""

from fastapi import APIRouter
from app.api.v1.endpoints.admin import router as admin_router
from app.api.v1.endpoints.ai import router as ai_router
from app.api.v1.endpoints.mobile import router as mobile_router
from app.api.v1.endpoints.optimizer import router as optimizer_router

api_v1_router = APIRouter(prefix="/api/v1")

api_v1_router.include_router(optimizer_router)
api_v1_router.include_router(mobile_router)
api_v1_router.include_router(ai_router)
api_v1_router.include_router(admin_router)
