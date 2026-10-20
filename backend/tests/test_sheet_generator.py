"""
Tests unitaires pour la génération de la fiche de débit atelier A4 (sheet_generator).
Spécification technique : Section 2.5 du Cahier des Charges.
"""

from fastapi.testclient import TestClient
from app.main import app
from app.models.pieces import ShapedPieceModel
from app.services.nesting_engine import run_nesting_optimization
from app.services.sheet_generator import generate_workshop_sheet_html

client = TestClient(app)


def test_generate_workshop_sheet_html_direct() -> None:
    """Vérifie la génération directe du template HTML avec toutes les sections d'atelier."""
    pieces = [
        ShapedPieceModel(
            id="p-1",
            label="Bavette d'égout",
            dev=250,
            length=2.0,
            quantity=4,
            bends=2,
            material="Zinc Naturel 0.7",
            workshop_split_reason="Standard 2.0m",
        )
    ]

    html = generate_workshop_sheet_html(
        client_name="Toitures Dupont SPRL",
        chantier_ref="Chantier Résidence Les Lilas",
        pieces=pieces,
        job_code="FZ-TEST-001",
    )

    assert "<!DOCTYPE html>" in html
    assert "FACOZINC" in html
    assert "Toitures Dupont SPRL" in html
    assert "Chantier Résidence Les Lilas" in html
    assert "Bavette d'égout" in html
    assert "250 mm" in html
    assert "4" in html  # Quantité
    assert "FZ-TEST-001" in html


def test_api_print_sheet_endpoint() -> None:
    """Test d'intégration du endpoint HTTP /api/v1/optimizer/print-sheet."""
    payload = {
        "client_name": "Couvreur Martin",
        "chantier_ref": "Villa Meuse",
        "material": "Alu 7016 gris bleu 0.7",
        "pieces": [
            {
                "id": "p-1",
                "label": "Rive d'acrotère",
                "dev": 200,
                "length": 2.5,
                "quantity": 6,
                "bends": 3,
                "material": "Alu 7016 gris bleu 0.7",
            }
        ],
    }

    resp = client.post("/api/v1/optimizer/print-sheet", json=payload)
    assert resp.status_code == 200
    assert "text/html" in resp.headers["content-type"]
    assert "FACOZINC" in resp.text
    assert "Couvreur Martin" in resp.text
    assert "Villa Meuse" in resp.text
    assert "Rive d&#39;acrotère" in resp.text or "Rive d'acrotère" in resp.text
