"""
Point d'entrée principal de l'API FacoNote (Plateforme Facozinc).
Assistant d'Encodage, Calepinage & Optimisation de Refente.
Spécification technique : Cahier des Charges Facozinc Python.
"""

import os
from collections.abc import Awaitable, Callable
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.api.v1.router import api_v1_router
from app.core.admin_security import check_rate_limit

# Chargement automatique des variables d'environnement depuis backend/.env ou .env
env_candidates = [
    Path(__file__).resolve().parent.parent / ".env",
    Path(".env"),
]
for env_file in env_candidates:
    if env_file.exists():
        load_dotenv(env_file)
        break

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


@app.middleware("http")
async def load_firewall_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    """
    Pare-feu de charge (Pilier 4) :
    Limite la fréquence des requêtes sur `/api/v1/optimizer/*` pour les utilisateurs non authentifiés,
    et débloque le débit illimité uniquement lorsque l'en-tête `X-Admin-Token` est valide.
    """
    if request.method != "OPTIONS":
        client_ip = request.client.host if request.client and request.client.host else "unknown"
        admin_token = request.headers.get("X-Admin-Token")
        allowed, retry_after = check_rate_limit(client_ip, request.url.path, admin_token)
        if not allowed:
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={
                    "detail": (
                        f"Pare-feu de charge : trop de requêtes rapprochées ({retry_after}s d'attente). "
                        "Authentifiez-vous dans le Stress Lab (X-Admin-Token) pour lever la limite."
                    )
                },
                headers={"Retry-After": str(retry_after)},
            )
    return await call_next(request)


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
