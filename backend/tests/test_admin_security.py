"""
Tests unitaires et d'intégration des 5 piliers de sécurité Admin (Stress Lab).
"""

import os
from fastapi.testclient import TestClient
from app.core.admin_security import (
    ENV_VAR_NAME,
    HEAVY_ROUTE_LIMIT_PER_WINDOW,
    hash_admin_password,
    issue_admin_token,
    reset_security_state_for_tests,
    revoke_admin_token,
    verify_admin_password,
    verify_admin_token,
)
from app.main import app

client = TestClient(app)


def test_scrypt_hash_and_constant_time_verification() -> None:
    """Pilier 1 : Hachage scrypt salé irréversible et vérification en temps constant."""
    h1 = hash_admin_password("SuperSecretAtelier2026!")
    h2 = hash_admin_password("SuperSecretAtelier2026!")
    assert h1.startswith("scrypt$")
    # Deux sels aléatoires produisent deux empreintes distinctes
    assert h1 != h2
    assert verify_admin_password("SuperSecretAtelier2026!", h1) is True
    assert verify_admin_password("MauvaisMotDePasse", h1) is False


def test_ephemeral_token_and_revocation() -> None:
    """Pilier 2 : Jeton signé HMAC-SHA256 256 bits, expiration et révocation immédiate."""
    reset_security_state_for_tests()
    token, _ = issue_admin_token(ttl_sec=600)
    remaining = verify_admin_token(token)
    assert remaining is not None and remaining > 500

    # Falsification de la signature rejetée
    tampered = token[:-4] + "0000"
    assert verify_admin_token(tampered) is None

    # Révocation côté serveur
    assert revoke_admin_token(token) is True
    assert verify_admin_token(token) is None


def test_bruteforce_ip_lockout() -> None:
    """Pilier 3 : Blocage IP pendant 15 min après 5 tentatives échouées."""
    reset_security_state_for_tests()
    os.environ[ENV_VAR_NAME] = hash_admin_password("AtelierAdmin#2026")

    for attempt in range(1, 5):
        resp = client.post("/api/v1/admin/login", json={"password": "wrong-password"})
        assert resp.status_code == 401
        assert f"{5 - attempt} essai(s) restant(s)" in resp.json()["detail"]

    # 5e échec -> déclenche le verrouillage HTTP 429
    resp5 = client.post("/api/v1/admin/login", json={"password": "wrong-password"})
    assert resp5.status_code == 429

    # Même avec le bon mot de passe, l'IP bannie reste rejetée en 429
    resp_locked = client.post("/api/v1/admin/login", json={"password": "AtelierAdmin#2026"})
    assert resp_locked.status_code == 429
    reset_security_state_for_tests()


def test_load_firewall_blocks_unauthenticated_flood_and_allows_admin() -> None:
    """Pilier 4 : Pare-feu de charge bloque les rafales sans jeton et débloque l'Admin."""
    reset_security_state_for_tests()
    os.environ[ENV_VAR_NAME] = hash_admin_password("AtelierAdmin#2026")

    payload = {
        "client_name": "Test Firewall",
        "chantier_ref": "Chantier",
        "material": "Zinc Naturel 0.7",
        "pieces": [
            {
                "id": "p-1",
                "label": "Bavette",
                "dev": 250,
                "length": 2.0,
                "quantity": 2,
                "bends": 2,
                "material": "Zinc Naturel 0.7",
            }
        ],
        "available_mother_widths": [1000],
    }

    # Sans jeton : les 40 premières passent, la 41e est bloquée en HTTP 429
    for _ in range(HEAVY_ROUTE_LIMIT_PER_WINDOW):
        r = client.post("/api/v1/optimizer/calculate", json=payload)
        assert r.status_code == 200

    blocked = client.post("/api/v1/optimizer/calculate", json=payload)
    assert blocked.status_code == 429

    # Connexion Admin -> obtient X-Admin-Token -> le pare-feu laisse passer immédiatement
    login_resp = client.post("/api/v1/admin/login", json={"password": "AtelierAdmin#2026"})
    assert login_resp.status_code == 200
    token = login_resp.json()["token"]

    unlocked = client.post(
        "/api/v1/optimizer/calculate",
        json=payload,
        headers={"X-Admin-Token": token},
    )
    assert unlocked.status_code == 200
    reset_security_state_for_tests()
