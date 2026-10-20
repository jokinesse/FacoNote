"""
Pipeline de traitement d'images d'atelier basé sur Pillow (PIL).
Spécification technique : Section 2.3 & 5.2 du Cahier des Charges.
Fournit la rotation par pas de 90° et le renforcement de contraste (+15%) pour les croquis au crayon.
"""

import base64
import io
import re
from typing import Final, NamedTuple

from PIL import Image, ImageEnhance

DATA_URI_PATTERN: Final[re.Pattern[str]] = re.compile(r"^data:([^;]+);base64,(.+)$", re.DOTALL)


class ProcessedImageResult(NamedTuple):
    data_uri: str
    mime_type: str
    width: int
    height: int


def decode_base64_image(image_base64: str) -> tuple[Image.Image, str]:
    """
    Décode une image depuis une chaîne Base64 (Data URI ou brute) en objet PIL Image.
    Retourne l'objet Image et son type MIME détecté.
    """
    clean_str = image_base64.strip()
    match = DATA_URI_PATTERN.match(clean_str)

    if match:
        mime_type = match.group(1).lower()
        raw_b64 = match.group(2)
    else:
        mime_type = "image/jpeg"
        raw_b64 = clean_str

    try:
        image_bytes = base64.b64decode(raw_b64)
    except Exception as exc:
        raise ValueError(f"Décodage Base64 invalide : {exc}") from exc

    try:
        img = Image.open(io.BytesIO(image_bytes))
        img.load()  # Force le chargement complet des pixels
        return img, mime_type
    except Exception as exc:
        raise ValueError(f"Format d'image non reconnu ou corrompu : {exc}") from exc


def encode_image_to_base64(
    img: Image.Image,
    format_name: str = "JPEG",
    quality: int = 85,
) -> str:
    """
    Encode un objet PIL Image en chaîne Data URI Base64.
    """
    # Si image en RGBA ou palette et format JPEG -> conversion en RGB
    if format_name.upper() in ("JPEG", "JPG"):
        if img.mode in ("RGBA", "P", "LA"):
            background = Image.new("RGB", img.size, (255, 255, 255))
            if img.mode == "RGBA":
                background.paste(img, mask=img.split()[3])
            else:
                background.paste(img.convert("RGBA"))
            img = background
        elif img.mode != "RGB":
            img = img.convert("RGB")

    buffer = io.BytesIO()
    img.save(buffer, format=format_name, quality=quality, optimize=True)
    b64_str = base64.b64encode(buffer.getvalue()).decode("utf-8")
    mime = "image/jpeg" if format_name.upper() in ("JPEG", "JPG") else f"image/{format_name.lower()}"
    return f"data:{mime};base64,{b64_str}"


def process_image_for_ocr(
    image_base64: str,
    rotation_deg: int = 0,
    contrast_boost: float = 1.15,
    max_dimension: int = 2048,
) -> ProcessedImageResult:
    """
    Applique le pipeline standard d'atelier Facozinc :
    1. Rotation orthogonale (par pas de 90° : 0, 90, 180, 270°).
    2. Redimensionnement adaptatif (max 2048px).
    3. Rehaussement de contraste (+15% par défaut) pour révéler les traits de crayon pâles.
    4. Encodage JPEG compressé prêt pour OCR ou API Multimodale.
    """
    # Si c'est un document PDF (application/pdf), pas de traitement Pillow possible directement
    if "application/pdf" in image_base64[:40]:
        return ProcessedImageResult(
            data_uri=image_base64,
            mime_type="application/pdf",
            width=0,
            height=0,
        )

    img, _ = decode_base64_image(image_base64)

    # 1. Rotation par pas de 90°
    norm_rotation = (rotation_deg % 360)
    if norm_rotation == 90:
        img = img.transpose(Image.Transpose.ROTATE_270)  # PIL rotate_270 = horaire 90°
    elif norm_rotation == 180:
        img = img.transpose(Image.Transpose.ROTATE_180)
    elif norm_rotation == 270:
        img = img.transpose(Image.Transpose.ROTATE_90)   # PIL rotate_90 = anti-horaire 90° / horaire 270°

    # 2. Redimensionnement si dépasse max_dimension
    w, h = img.size
    if w > max_dimension or h > max_dimension:
        if w > h:
            new_w = max_dimension
            new_h = int((h * max_dimension) / w)
        else:
            new_h = max_dimension
            new_w = int((w * max_dimension) / h)
        img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
        w, h = new_w, new_h

    # 3. Renforcement de contraste (+15%)
    if contrast_boost != 1.0:
        enhancer = ImageEnhance.Contrast(img)
        img = enhancer.enhance(contrast_boost)

    # 4. Encodage JPEG
    result_data_uri = encode_image_to_base64(img, format_name="JPEG", quality=85)

    return ProcessedImageResult(
        data_uri=result_data_uri,
        mime_type="image/jpeg",
        width=w,
        height=h,
    )
