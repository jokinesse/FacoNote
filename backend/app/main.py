"""
Point d'entrée principal de l'API FacoNote (Plateforme Facozinc).
Assistant d'Encodage, Calepinage & Optimisation de Refente.
Spécification technique : Cahier des Charges Facozinc Python.
"""

from fastapi import FastAPI, status
from fastapi.middleware.cors import CORSMiddleware
from app.api.v1.router import api_v1_router

app = FastAPI(
    title="Plateforme Facozinc API",
    description=(
        "API d'Encodage Rapide, Calepinage Linéaire & Optimisation de Refente (Nesting 1D/2D) "
        "pour façonneurs et métreurs en toiture / bardage."
    ),
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# Configuration CORS pour intégration fluide avec Vite et interfaces mobiles
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Inclusion des routeurs de version 1
app.include_router(api_v1_router)


@app.get(
    "/",
    status_code=status.HTTP_200_OK,
    tags=["Accueil & Documentation"],
)
def root_endpoint() -> dict[str, str]:
    return {
        "service": "Plateforme FACOZINC - Backend Python",
        "status": "online",
        "documentation": "/docs",
        "version": "2.0.0",
    }


@app.get(
    "/api/health",
    status_code=status.HTTP_200_OK,
    tags=["Santé"],
)
def health_endpoint() -> dict[str, str]:
    return {
        "status": "healthy",
        "backend": "FastAPI + Pydantic v2",
    }
