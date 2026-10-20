"""
Sécurité Administrateur & Pare-feu de Charge (5 Piliers) :
1. Zéro mot de passe en clair : hachage irréversible `scrypt` salé (16 octets aléatoires).
2. Jetons de session HMAC-SHA256 signés par clé éphémère 256 bits en RAM (TTL 30 min) + révocation.
3. Bouclier anti-bruteforce : comparaison en temps constant (`secrets.compare_digest`) et bannissement IP (5 essais -> 15 min).
4. Pare-feu de charge (Rate Limiter) : bloque les rafales non autorisées (HTTP 429) sauf si `X-Admin-Token` valide.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import threading
import time
from pathlib import Path
from typing import Optional

# Paramètres cryptographiques scrypt (OWASP / NIST)
SCRYPT_N: int = 16384
SCRYPT_R: int = 8
SCRYPT_P: int = 1
SCRYPT_DKLEN: int = 32
SALT_BYTES: int = 16

# Durée de vie des sessions Admin (30 minutes)
SESSION_TTL_SECONDS: int = 1800

# Politique Anti-Bruteforce
MAX_FAILED_ATTEMPTS: int = 5
ATTEMPT_WINDOW_SECONDS: int = 900  # 15 minutes
LOCKOUT_DURATION_SECONDS: int = 900  # 15 minutes

# Pare-feu de charge (fenêtre glissante de 10 secondes pour les clients sans X-Admin-Token)
RATE_LIMIT_WINDOW_SECONDS: float = 10.0
HEAVY_ROUTE_LIMIT_PER_WINDOW: int = 40
LIGHT_ROUTE_LIMIT_PER_WINDOW: int = 120

ENV_VAR_NAME: str = "FACONOTE_ADMIN_HASH"
BACKEND_ENV_PATH: Path = Path(__file__).resolve().parents[2] / ".env"

# Clé de signature éphémère 256 bits en mémoire vive (régénérée à chaque redémarrage serveur)
_SIGNING_KEY: bytes = secrets.token_bytes(32)
_SECURITY_LOCK: threading.RLock = threading.RLock()
_REVOKED_JTIS: set[str] = set()
_FAILED_LOGINS: dict[str, list[float]] = {}
_LOCKED_IPS: dict[str, float] = {}
_RATE_BUCKETS: dict[tuple[str, str], list[float]] = {}


def _read_hash_from_env_file(env_path: Path = BACKEND_ENV_PATH) -> Optional[str]:
    """Lit FACONOTE_ADMIN_HASH depuis backend/.env si présent."""
    if not env_path.is_file():
        return None
    try:
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            if key.strip() == ENV_VAR_NAME:
                cleaned = val.strip().strip('"').strip("'")
                if cleaned.startswith("scrypt$"):
                    return cleaned
    except OSError:
        return None
    return None


def get_configured_admin_hash() -> Optional[str]:
    """Retourne l'empreinte scrypt configurée (variable d'environnement ou fichier backend/.env)."""
    env_val = os.environ.get(ENV_VAR_NAME, "").strip()
    if env_val.startswith("scrypt$"):
        return env_val
    file_val = _read_hash_from_env_file()
    if file_val:
        os.environ[ENV_VAR_NAME] = file_val
        return file_val
    return None


def is_admin_configured() -> bool:
    """Indique si une empreinte administrateur scrypt est configurée sur le serveur."""
    return get_configured_admin_hash() is not None


def hash_admin_password(password: str) -> str:
    """
    Calcule l'empreinte irréversible `scrypt` salée d'un mot de passe.
    Format retourné : `scrypt$<salt_hex>$<digest_hex>`
    """
    clean = password.strip()
    if len(clean) < 8:
        raise ValueError("Le mot de passe administrateur doit contenir au moins 8 caractères.")
    salt = secrets.token_bytes(SALT_BYTES)
    digest = hashlib.scrypt(
        clean.encode("utf-8"),
        salt=salt,
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
        dklen=SCRYPT_DKLEN,
    )
    return f"scrypt${salt.hex()}${digest.hex()}"


def save_admin_hash_to_env(password_hash: str, env_path: Path = BACKEND_ENV_PATH) -> None:
    """Enregistre l'empreinte scrypt dans backend/.env et met à jour l'environnement en mémoire."""
    with _SECURITY_LOCK:
        lines: list[str] = []
        replaced = False
        if env_path.is_file():
            for raw_line in env_path.read_text(encoding="utf-8").splitlines():
                if raw_line.strip().startswith(f"{ENV_VAR_NAME}="):
                    lines.append(f"{ENV_VAR_NAME}={password_hash}")
                    replaced = True
                else:
                    lines.append(raw_line)
        if not replaced:
            if not lines:
                lines.append("# Empreinte cryptographique scrypt Admin FacoNote (aucun mot de passe en clair)")
            lines.append(f"{ENV_VAR_NAME}={password_hash}")
        env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        os.environ[ENV_VAR_NAME] = password_hash


def verify_admin_password(password: str, stored_hash: Optional[str] = None) -> bool:
    """
    Vérifie un mot de passe contre l'empreinte scrypt en temps constant (`secrets.compare_digest`).
    """
    target_hash = stored_hash if stored_hash is not None else get_configured_admin_hash()
    if not target_hash or not target_hash.startswith("scrypt$"):
        return False
    parts = target_hash.split("$")
    if len(parts) != 3:
        return False
    try:
        salt = bytes.fromhex(parts[1])
        expected_digest = bytes.fromhex(parts[2])
    except ValueError:
        return False

    computed_digest = hashlib.scrypt(
        password.strip().encode("utf-8"),
        salt=salt,
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
        dklen=len(expected_digest),
    )
    return secrets.compare_digest(computed_digest, expected_digest)


def issue_admin_token(ttl_sec: int = SESSION_TTL_SECONDS) -> tuple[str, float]:
    """Génère un jeton signé HMAC-SHA256 avec identifiant unique révocable."""
    exp = int(time.time()) + ttl_sec
    jti = secrets.token_hex(16)
    payload = f"{exp}.{jti}"
    sig = hmac.new(_SIGNING_KEY, payload.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}", float(exp)


def verify_admin_token(token: Optional[str]) -> Optional[int]:
    """
    Vérifie la signature HMAC-SHA256, l'expiration et la non-révocation du jeton.
    Retourne le nombre de secondes restantes si valide, ou None.
    """
    if not token:
        return None
    parts = token.strip().split(".")
    if len(parts) != 3:
        return None
    exp_str, jti, sig = parts
    try:
        exp = int(exp_str)
    except ValueError:
        return None

    with _SECURITY_LOCK:
        if jti in _REVOKED_JTIS:
            return None

    payload = f"{exp}.{jti}"
    expected_sig = hmac.new(_SIGNING_KEY, payload.encode("ascii"), hashlib.sha256).hexdigest()
    if not secrets.compare_digest(sig, expected_sig):
        return None

    remaining = exp - int(time.time())
    if remaining <= 0:
        return None
    return remaining


def revoke_admin_token(token: Optional[str]) -> bool:
    """Révoque immédiatement un jeton administrateur en mémoire."""
    if not token:
        return False
    parts = token.strip().split(".")
    if len(parts) != 3:
        return False
    with _SECURITY_LOCK:
        _REVOKED_JTIS.add(parts[1])
    return True


def check_ip_lockout(client_ip: str) -> int:
    """Retourne le temps de blocage restant en secondes pour une IP (0 si non bloquée)."""
    now = time.time()
    with _SECURITY_LOCK:
        until = _LOCKED_IPS.get(client_ip, 0.0)
        if until > now:
            return int(until - now) + 1
        if client_ip in _LOCKED_IPS:
            del _LOCKED_IPS[client_ip]
        return 0


def record_failed_attempt(client_ip: str) -> tuple[int, int]:
    """
    Enregistre un échec d'authentification pour une IP.
    Retourne `(essais_restants, secondes_de_blocage)`.
    """
    now = time.time()
    with _SECURITY_LOCK:
        recent = [t for t in _FAILED_LOGINS.get(client_ip, []) if now - t < ATTEMPT_WINDOW_SECONDS]
        recent.append(now)
        _FAILED_LOGINS[client_ip] = recent
        if len(recent) >= MAX_FAILED_ATTEMPTS:
            _LOCKED_IPS[client_ip] = now + LOCKOUT_DURATION_SECONDS
            _FAILED_LOGINS.pop(client_ip, None)
            return 0, LOCKOUT_DURATION_SECONDS
        return MAX_FAILED_ATTEMPTS - len(recent), 0


def clear_failed_attempts(client_ip: str) -> None:
    """Réinitialise le compteur d'échecs d'une IP après une connexion réussie."""
    with _SECURITY_LOCK:
        _FAILED_LOGINS.pop(client_ip, None)
        _LOCKED_IPS.pop(client_ip, None)


def check_rate_limit(client_ip: str, path: str, admin_token: Optional[str]) -> tuple[bool, int]:
    """
    Pare-feu de charge (Pilier 4) :
    - Si `admin_token` est valide : aucune limite (autorise le Stress Lab à pleine puissance).
    - Sinon : applique une limite par fenêtre glissante pour bloquer tout stress-test non autorisé.
    Retourne `(autorisé, retry_after_seconds)`.
    """
    if verify_admin_token(admin_token) is not None:
        return True, 0

    if not path.startswith("/api/v1/optimizer/"):
        return True, 0

    is_heavy = path.endswith("/calculate") or path.endswith("/print-sheet")
    bucket_name = "heavy" if is_heavy else "light"
    max_requests = HEAVY_ROUTE_LIMIT_PER_WINDOW if is_heavy else LIGHT_ROUTE_LIMIT_PER_WINDOW

    now = time.time()
    key = (client_ip, bucket_name)
    with _SECURITY_LOCK:
        timestamps = [t for t in _RATE_BUCKETS.get(key, []) if now - t < RATE_LIMIT_WINDOW_SECONDS]
        if len(timestamps) >= max_requests:
            retry_after = max(1, int(RATE_LIMIT_WINDOW_SECONDS - (now - timestamps[0])) + 1)
            _RATE_BUCKETS[key] = timestamps
            return False, retry_after
        timestamps.append(now)
        _RATE_BUCKETS[key] = timestamps
        return True, 0


def reset_security_state_for_tests() -> None:
    """Réinitialise les compteurs mémoire pour l'isolation des tests unitaires."""
    with _SECURITY_LOCK:
        _REVOKED_JTIS.clear()
        _FAILED_LOGINS.clear()
        _LOCKED_IPS.clear()
        _RATE_BUCKETS.clear()
