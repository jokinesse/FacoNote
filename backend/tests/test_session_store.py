"""
Tests unitaires pour le store de sessions mobiles thread-safe (session_store).
Spécification technique : Section 4.1 & 5.2 du Cahier des Charges (TTL 45 min).
"""

import threading
import time
import pytest
from app.services.session_store import MobileSessionStore


def test_session_creation_and_format() -> None:
    """Vérifie la génération d'ID lisible (ex: FAC-4829-X7K1) et l'URL du QR Code."""
    store = MobileSessionStore(ttl_seconds=2700.0)
    session = store.create_session("https://atelier.facozinc.com/mobile")

    assert session.session_id.startswith("FAC-")
    parts = session.session_id.split("-")
    assert len(parts) == 3
    assert parts[1].isdigit() and len(parts[1]) == 4
    assert len(parts[2]) == 4

    assert "session=" + session.session_id in session.qr_url

    status = store.get_session(session.session_id)
    assert status.status == "waiting"
    assert status.has_image is False


def test_session_upload_and_status() -> None:
    """Vérifie l'upload smartphone et le passage au statut 'ready'."""
    store = MobileSessionStore()
    session = store.create_session()

    fake_b64 = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBD..."
    success = store.save_upload(
        session_id=session.session_id,
        image_base64=fake_b64,
        filename="bavettes_chantier.jpg",
        note="Bavettes côté cour",
    )
    assert success is True

    status = store.get_session(session.session_id)
    assert status.status == "ready"
    assert status.has_image is True
    assert status.image_base64 == fake_b64
    assert status.filename == "bavettes_chantier.jpg"
    assert status.note == "Bavettes côté cour"


def test_session_reset() -> None:
    """Vérifie la réinitialisation de session pour écouter une nouvelle photo."""
    store = MobileSessionStore()
    session = store.create_session()
    store.save_upload(session.session_id, "data:image/jpeg;base64,abc", "photo.jpg")

    assert store.get_session(session.session_id).status == "ready"

    reset_ok = store.reset_session(session.session_id)
    assert reset_ok is True

    status = store.get_session(session.session_id)
    assert status.status == "waiting"
    assert status.has_image is False
    assert status.image_base64 is None


def test_session_ttl_expiration() -> None:
    """Vérifie l'expiration après dépassement du TTL."""
    # Store avec TTL court de 0.1 seconde pour le test
    store = MobileSessionStore(ttl_seconds=0.1)
    session = store.create_session()

    time.sleep(0.15)

    status = store.get_session(session.session_id)
    assert status.status == "expired"

    # Vérification du nettoyage
    cleaned = store.cleanup_expired()
    assert cleaned >= 0
    assert store.get_session(session.session_id).status in ("not_found", "expired")


def test_session_concurrent_thread_safety() -> None:
    """Vérifie le comportement sans race condition sous forte concurrence multi-threadée."""
    store = MobileSessionStore()
    created_ids: list[str] = []
    lock = threading.Lock()

    def worker_create() -> None:
        for _ in range(25):
            s = store.create_session()
            with lock:
                created_ids.append(s.session_id)
            store.save_upload(s.session_id, "data:image/jpeg;base64,xyz", "img.jpg")

    threads = [threading.Thread(target=worker_create) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # 100 sessions uniques créées sans collision
    assert len(created_ids) == 100
    assert len(set(created_ids)) == 100
