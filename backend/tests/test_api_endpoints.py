"""
Tests d'intégration de bout en bout pour les routes API FastAPI.
Spécification technique : Section 4 du Cahier des Charges.
"""

from fastapi.testclient import TestClient
from app.main import app
from app.services.image_pipeline import encode_image_to_base64
from PIL import Image

client = TestClient(app)


def test_health_and_root() -> None:
    """Vérifie le point de santé et la page d'accueil."""
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "healthy"

    root_resp = client.get("/")
    assert root_resp.status_code == 200
    assert root_resp.json()["status"] == "online"


def test_api_auto_breakdown() -> None:
    """Test de la route /api/v1/optimizer/auto-breakdown."""
    payload = {
        "total_meters": 11.5,
        "current_pieces": [],
        "target_material": "Zinc Naturel 0.7",
    }
    resp = client.post("/api/v1/optimizer/auto-breakdown", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["requested_meters"] == 11.5
    assert len(data["alternatives"]) >= 1
    # Doit contenir l'option exacte de 2.3m
    assert any(alt["is_exact"] and alt["length"] == 2.3 for alt in data["alternatives"])


def test_api_calculate_nesting() -> None:
    """Test de la route /api/v1/optimizer/calculate."""
    payload = {
        "client_name": "Client Toiture SPRL",
        "chantier_ref": "Chantier Les Pins",
        "material": "Zinc Naturel 0.7",
        "pieces": [
            {
                "id": "p-1",
                "label": "Bavette d'égout",
                "dev": 250,
                "length": 2.0,
                "quantity": 4,
                "bends": 2,
                "material": "Zinc Naturel 0.7",
            }
        ],
        "available_mother_widths": [1000],
    }
    resp = client.post("/api/v1/optimizer/calculate", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["material_efficiency_rate"] == 100.0
    assert data["total_net_surface_m2"] == 2.00  # 4 * 0.25 * 2.0 = 2.00
    assert data["total_gross_surface_m2"] == 2.00  # 1 feuille de 1.00m * 2.0m = 2.00
    assert len(data["slits"]) == 1


def test_api_calculate_empty_pieces_rejected() -> None:
    """Une liste de pièces vide doit être rejetée avec erreur 422 ou 400."""
    payload = {
        "client_name": "Client Comptoir",
        "chantier_ref": "Chantier Standard",
        "material": "Zinc Naturel 0.7",
        "pieces": [],
    }
    resp = client.post("/api/v1/optimizer/calculate", json=payload)
    assert resp.status_code in (400, 422)


def test_api_quick_encode() -> None:
    """Test de la route /api/v1/optimizer/quick-encode."""
    payload = {
        "raw_input": "175/8*3",
        "material": "Zinc Naturel 0.7",
        "length_unit": "m",
        "preset": "DEV_PIECE",
    }
    resp = client.post("/api/v1/optimizer/quick-encode", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["dev"] == 175
    assert data["quantity"] == 8
    assert data["unit_length_m"] == 3.0
    assert data["total_length_m"] == 24.0
    assert data["matched_bound"] == 175
    assert data["weight_net_kg"] == 21.17


def test_api_mobile_session_workflow() -> None:
    """Workflow complet de session mobile : création, upload, polling et reset."""
    # 1. Création de session
    create_resp = client.post("/api/v1/mobile/session")
    assert create_resp.status_code == 201
    s_data = create_resp.json()
    session_id = s_data["session_id"]
    assert session_id.startswith("FAC-")

    # 2. Polling initial : statut waiting
    status_resp = client.get(f"/api/v1/mobile/status/{session_id}")
    assert status_resp.status_code == 200
    assert status_resp.json()["status"] == "waiting"

    # 3. Upload smartphone
    upload_payload = {
        "session_id": session_id,
        "image_base64": "data:image/jpeg;base64,samplephoto123",
        "filename": "plan_toiture.jpg",
        "note": "Rive droite",
    }
    upload_resp = client.post("/api/v1/mobile/upload", json=upload_payload)
    assert upload_resp.status_code == 200

    # 4. Polling après upload : statut ready
    ready_resp = client.get(f"/api/v1/mobile/status/{session_id}")
    assert ready_resp.status_code == 200
    ready_data = ready_resp.json()
    assert ready_data["status"] == "ready"
    assert ready_data["filename"] == "plan_toiture.jpg"

    # 5. Reset de la session
    reset_resp = client.post(f"/api/v1/mobile/reset/{session_id}")
    assert reset_resp.status_code == 200
    assert client.get(f"/api/v1/mobile/status/{session_id}").json()["status"] == "waiting"


def test_api_ai_parse_document() -> None:
    """Test de la route /api/v1/ai/parse-document."""
    payload = {
        "file_base64": None,
        "manual_text": "8 bavettes de 3m",
        "standard_length": 2.0,
    }
    resp = client.post("/api/v1/ai/parse-document", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["pieces"]) >= 1
    assert data["pieces"][0]["quantity"] == 8
    assert data["pieces"][0]["length"] == 3.0


def test_api_ai_process_image() -> None:
    """Test du prétraitement d'image (rotation + contraste)."""
    img = Image.new("RGB", (100, 50), color=(150, 150, 150))
    b64 = encode_image_to_base64(img)

    payload = {
        "image_base64": b64,
        "rotation_deg": 90,
        "contrast_boost": 1.15,
    }
    resp = client.post("/api/v1/ai/process-image", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    # Rotation 90° : 100 x 50 devient 50 x 100
    assert data["width"] == 50
    assert data["height"] == 100
    assert data["data_uri"].startswith("data:image/jpeg;base64,")
