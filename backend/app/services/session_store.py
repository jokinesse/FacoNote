"""
Store en mémoire thread-safe pour les sessions éphémères de transfert mobile d'atelier.
Spécification technique : Section 4.1 & 5.2 du Cahier des Charges (TTL 45 minutes).
"""

import random
import string
import threading
import time
from dataclasses import dataclass
from typing import Optional

from app.models.mobile import MobileSessionResponse, MobileStatusResponse


@dataclass
class _InternalSession:
    id: str
    created_at: float
    last_accessed_at: float
    status: str  # "waiting" | "ready"
    image_base64: Optional[str] = None
    filename: Optional[str] = None
    note: Optional[str] = None


class MobileSessionStore:
    """
    Gestionnaire thread-safe des sessions de téléversement photo mobile.
    Chaque session expire automatiquement après un TTL de 45 minutes.
    """

    DEFAULT_TTL_SECONDS: float = 45.0 * 60.0  # 45 minutes

    def __init__(self, ttl_seconds: float = DEFAULT_TTL_SECONDS) -> None:
        self._lock = threading.RLock()
        self._sessions: dict[str, _InternalSession] = {}
        self._ttl_seconds = ttl_seconds

    def _generate_session_id(self) -> str:
        """Génère un identifiant lisible de type FAC-4829-X7K1."""
        num = random.randint(1000, 9999)
        chars = "".join(random.choices(string.ascii_uppercase + string.digits, k=4))
        return f"FAC-{num}-{chars}"

    def create_session(
        self,
        base_qr_url: str = "https://atelier.facozinc.com/mobile",
    ) -> MobileSessionResponse:
        """Crée une nouvelle session de couplage smartphone et génère l'URL pour QR code."""
        now = time.time()
        self.cleanup_expired()

        with self._lock:
            session_id = self._generate_session_id()
            while session_id in self._sessions:
                session_id = self._generate_session_id()

            session = _InternalSession(
                id=session_id,
                created_at=now,
                last_accessed_at=now,
                status="waiting",
            )
            self._sessions[session_id] = session

            qr_url = f"{base_qr_url}?session={session_id}"
            return MobileSessionResponse(
                session_id=session_id,
                created_at=now,
                qr_url=qr_url,
            )

    def save_upload(
        self,
        session_id: str,
        image_base64: str,
        filename: str = "croquis.jpg",
        note: Optional[str] = None,
    ) -> bool:
        """Enregistre l'image transmise par le smartphone."""
        now = time.time()
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                # Création à la volée si URL valide scannée directement
                session = _InternalSession(
                    id=session_id,
                    created_at=now,
                    last_accessed_at=now,
                    status="ready",
                )
                self._sessions[session_id] = session

            # Vérification expiration
            if now - session.created_at > self._ttl_seconds:
                del self._sessions[session_id]
                return False

            session.status = "ready"
            session.image_base64 = image_base64
            session.filename = filename
            session.note = note or ""
            session.last_accessed_at = now
            return True

    def get_session(self, session_id: str) -> MobileStatusResponse:
        """Consulte l'état de la session (polling du poste de travail)."""
        now = time.time()
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                return MobileStatusResponse(
                    session_id=session_id,
                    status="not_found",
                    has_image=False,
                )

            if now - session.created_at > self._ttl_seconds:
                del self._sessions[session_id]
                return MobileStatusResponse(
                    session_id=session_id,
                    status="expired",
                    has_image=False,
                )

            session.last_accessed_at = now
            return MobileStatusResponse(
                session_id=session.id,
                status="ready" if session.image_base64 else "waiting",
                has_image=bool(session.image_base64),
                image_base64=session.image_base64,
                filename=session.filename,
                note=session.note,
                created_at=session.created_at,
            )

    def reset_session(self, session_id: str) -> bool:
        """Réinitialise une session après récupération de l'image pour écouter une nouvelle photo."""
        with self._lock:
            session = self._sessions.get(session_id)
            if session:
                session.status = "waiting"
                session.image_base64 = None
                session.filename = None
                session.note = None
                return True
            return False

    def cleanup_expired(self) -> int:
        """Supprime les sessions dont la durée de vie a dépassé le TTL (45 min)."""
        now = time.time()
        deleted_count = 0
        with self._lock:
            expired_keys = [
                s_id for s_id, s in self._sessions.items() if (now - s.created_at) > self._ttl_seconds
            ]
            for s_id in expired_keys:
                del self._sessions[s_id]
                deleted_count += 1
        return deleted_count


# Instance singleton globale pour l'application
global_session_store = MobileSessionStore()
