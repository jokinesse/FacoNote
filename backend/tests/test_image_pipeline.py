"""
Tests unitaires pour le pipeline d'images Pillow (image_pipeline).
Spécification technique : Section 2.3 & 5.2 du Cahier des Charges.
"""

import io
from PIL import Image
import pytest
from app.services.image_pipeline import (
    decode_base64_image,
    encode_image_to_base64,
    process_image_for_ocr,
)


def _create_sample_base64_image(width: int = 100, height: int = 50) -> str:
    """Crée une image de test simple et retourne sa data URI Base64."""
    img = Image.new("RGB", (width, height), color=(128, 128, 128))
    # Dessine quelques pixels pour le contraste
    img.putpixel((10, 10), (0, 0, 0))
    img.putpixel((20, 20), (255, 255, 255))
    return encode_image_to_base64(img, format_name="JPEG")


def test_decode_and_encode_image() -> None:
    """Vérifie le décodage et l'encodage réversible d'une image en Base64."""
    initial_b64 = _create_sample_base64_image(80, 40)
    img, mime = decode_base64_image(initial_b64)

    assert mime == "image/jpeg"
    assert img.size == (80, 40)

    reencoded = encode_image_to_base64(img)
    assert reencoded.startswith("data:image/jpeg;base64,")


def test_process_image_rotation_90() -> None:
    """
    Vérifie la rotation par pas de 90° :
    Une image 120 x 60 avec rotation 90° doit devenir 60 x 120.
    """
    b64 = _create_sample_base64_image(120, 60)
    res = process_image_for_ocr(b64, rotation_deg=90)

    assert res.width == 60
    assert res.height == 120
    assert res.mime_type == "image/jpeg"


def test_process_image_rotation_180() -> None:
    """Rotation 180° préserve les dimensions."""
    b64 = _create_sample_base64_image(100, 50)
    res = process_image_for_ocr(b64, rotation_deg=180)

    assert res.width == 100
    assert res.height == 50


def test_process_image_contrast_boost() -> None:
    """Vérifie que le rehaussement de contraste s'applique sans erreur."""
    b64 = _create_sample_base64_image(60, 60)
    # Contraste +15% (1.15)
    res = process_image_for_ocr(b64, rotation_deg=0, contrast_boost=1.15)
    assert res.width == 60
    assert res.height == 60
    assert res.data_uri.startswith("data:image/jpeg;base64,")


def test_process_pdf_passthrough() -> None:
    """Vérifie que les documents PDF passent intacts dans le pipeline."""
    pdf_b64 = "data:application/pdf;base64,JVBERi0xLjQKJ..."
    res = process_image_for_ocr(pdf_b64)
    assert res.mime_type == "application/pdf"
    assert res.data_uri == pdf_b64
