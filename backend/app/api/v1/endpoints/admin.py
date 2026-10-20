"""
Endpoints d'authentification et de gestion du Coffre-Fort Administrateur (Stress Lab).
"""

from typing import Optional
from fastapi import APIRouter, Header, HTTPException, Request, status
from app.core.admin_security import (
    SESSION_TTL_SECONDS,
    check_ip_lockout,
    clear_failed_attempts,
    hash_admin_password,
    is_admin_configured,
    issue_admin_token,
    record_failed_attempt,
    revoke_admin_token,
    save_admin_hash_to_env,
    verify_admin_password,
    verify_admin_token,
)
from app.models.admin import (
    AdminAuthRequest,
    AdminStatusResponse,
    AdminTokenResponse,
)

router = APIRouter(prefix="/admin", tags=["Sécurité Administrateur"])

LOCAL_HOSTS = {"127.0.0.1", "::1", "localhost", "testclient"}


def _get_client_ip(request: Request) -> str:
    """Extrait l'adresse IP du client pour le suivi anti-bruteforce."""
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


@router.get(
    "/status",
    response_model=AdminStatusResponse,
    status_code=status.HTTP_200_OK,
    summary="Consulte l'état du coffre-fort Admin et de la session courante",
)
def admin_status_endpoint(
    request: Request,
    x_admin_token: Optional[str] = Header(default=None, alias="X-Admin-Token"),
) -> AdminStatusResponse:
    client_ip = _get_client_ip(request)
    lock_sec = check_ip_lockout(client_ip)
    remaining = verify_admin_token(x_admin_token)
    return AdminStatusResponse(
        configured=is_admin_configured(),
        authenticated=remaining is not None,
        expires_in_sec=remaining if remaining is not None else 0,
        locked_out=lock_sec > 0,
        retry_after_sec=lock_sec,
    )


@router.post(
    "/setup",
    response_model=AdminTokenResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Initialise l'empreinte scrypt Admin (uniquement au 1er lancement depuis localhost)",
)
def admin_setup_endpoint(
    payload: AdminAuthRequest,
    request: Request,
) -> AdminTokenResponse:
    if is_admin_configured():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "L'empreinte administrateur est déjà configurée. "
                "Pour changer de mot de passe, exécutez : python tools/set_admin_password.py"
            ),
        )

    client_ip = _get_client_ip(request)
    if client_ip not in LOCAL_HOSTS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "L'initialisation initiale n'est autorisée que depuis la machine locale (127.0.0.1) "
                "ou via le script serveur tools/set_admin_password.py."
            ),
        )

    try:
        scrypt_hash = hash_admin_password(payload.password)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    save_admin_hash_to_env(scrypt_hash)
    token, expires_at = issue_admin_token(SESSION_TTL_SECONDS)
    return AdminTokenResponse(
        token=token,
        expires_at=expires_at,
        ttl_sec=SESSION_TTL_SECONDS,
    )


@router.post(
    "/login",
    response_model=AdminTokenResponse,
    status_code=status.HTTP_200_OK,
    summary="Authentifie l'administrateur par vérification scrypt en temps constant",
)
def admin_login_endpoint(
    payload: AdminAuthRequest,
    request: Request,
) -> AdminTokenResponse:
    client_ip = _get_client_ip(request)
    lock_sec = check_ip_lockout(client_ip)
    if lock_sec > 0:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Trop de tentatives échouées. Adresse IP bloquée pendant encore {lock_sec} s.",
        )

    if not is_admin_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Aucun mot de passe Admin n'est configuré sur le serveur. "
                "Initialisez-le depuis localhost ou via : python tools/set_admin_password.py"
            ),
        )

    if not verify_admin_password(payload.password):
        attempts_left, new_lock_sec = record_failed_attempt(client_ip)
        if new_lock_sec > 0:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=(
                    f"5 tentatives échouées. Votre adresse IP est verrouillée pendant "
                    f"{new_lock_sec // 60} minutes."
                ),
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Mot de passe administrateur incorrect ({attempts_left} essai(s) restant(s) avant blocage).",
        )

    clear_failed_attempts(client_ip)
    token, expires_at = issue_admin_token(SESSION_TTL_SECONDS)
    return AdminTokenResponse(
        token=token,
        expires_at=expires_at,
        ttl_sec=SESSION_TTL_SECONDS,
    )


@router.post(
    "/logout",
    status_code=status.HTTP_200_OK,
    summary="Révoque immédiatement le jeton de session administrateur",
)
def admin_logout_endpoint(
    x_admin_token: Optional[str] = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, bool]:
    revoked = revoke_admin_token(x_admin_token)
    return {"revoked": revoked}
