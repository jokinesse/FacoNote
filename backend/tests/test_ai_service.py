"""
Tests unitaires pour le service d'extraction OCR multimodale IA (ai_ocr_service).
Spécification technique : Section 4.2 du Cahier des Charges.
"""

import pytest
from app.models.ai import DocumentParseRequest
from app.services.ai_ocr_service import parse_document_multimodal


def test_ai_ocr_standard_fallback_response() -> None:
    """
    Vérifie la conformité du contrat d'interface Section 4.2 :
    {
      "client": "Client Toiture SPRL",
      "chantier": "Chantier Les Pins",
      "detected_finish": "Zinc Quartz 0.7",
      "pieces": [
        { "id": "p-1", "label": "Bavette d'égout", "dev": 190, "length": 2.0, "quantity": 8, "bends": 3, "material": "Zinc Quartz 0.7" }
      ]
    }
    """
    req = DocumentParseRequest(
        file_base64=None,
        manual_text=None,
        standard_length=2.0,
    )
    resp = parse_document_multimodal(req)

    assert resp.client == "Client Toiture SPRL"
    assert resp.chantier == "Chantier Les Pins"
    assert "Zinc Quartz" in resp.detected_finish
    assert len(resp.pieces) == 1

    p = resp.pieces[0]
    assert p.id == "p-1"
    assert p.label == "Bavette d'égout"
    assert p.dev == 190
    assert p.length == 2.0
    assert p.quantity == 8
    assert p.bends == 3
    assert p.material == "Zinc Quartz 0.7"


def test_ai_ocr_manual_text_extraction() -> None:
    """
    Vérifie l'extraction directe depuis une commande atelier textuelle :
    '8 bavettes de 3m'
    """
    req = DocumentParseRequest(
        file_base64=None,
        manual_text="8 bavettes de 3m",
        standard_length=2.0,
    )
    resp = parse_document_multimodal(req)

    assert len(resp.pieces) >= 1
    p = resp.pieces[0]
    assert p.quantity == 8
    assert p.length == 3.0
    assert "Bavette" in p.label
