"""
Service d'extraction OCR multimodale et analyse de plans par IA.
Spécification technique : Section 4.2 du Cahier des Charges.
Intègre le SDK Gemini avec repli déterministe résilient.
"""

import base64
import json
import logging
import os
import re
from typing import Optional

from app.core.constants import resolve_material_spec
from app.models.ai import DocumentParseRequest, DocumentParseResponse
from app.models.pieces import ShapedPieceModel

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """Tu es un métreur et chef d'atelier expert chez Facozinc (spécialiste du pliage et façonnage sur-mesure de zinc, aluminium, cuivre et plomb pour toitures et bardages).
Ta mission est d'analyser l'image, le plan PDF, le croquis manuscrit ou le bon de commande fourni et d'en extraire avec une EXACTITUDE ABSOLUE la liste de TOUTES les pièces de pliage à réaliser.

RÈGLES D'EXTRACTION MÉTIER :
1. Chaque croquis ou schéma géométrique représente une pièce façonnée (bavette, rive, noue, couvertine, chéneau, etc.).
2. DÉVELOPPEMENT TOTAL (dev) :
   - Si les cotes des ailes/pans sont annotées le long des traits (ex: 15, 120, 35, 20), FAIS LA SOMME EXACTE DE TOUTES LES COTES pour obtenir le dev total (ex: 15 + 120 + 35 + 20 = 190 mm).
   - Si le dev est écrit directement (ex: 'Dév 180' ou '333 mm'), prends cette valeur en millimètres.
3. COMPTAGE DES PLIS (bends) : Compte le nombre d'angles de pliage visibles sur le dessin.
4. QUANTITÉ ET LONGUEUR :
   - Extrais la quantité (ex: '8 pcs', 'x6' -> 6). Par défaut 1.
   - Extrais la longueur en mètres (ex: '3m' -> 3.0, '2000 mm' -> 2.0). Si non précisé, utilise la longueur standard indiquée.
5. NUANCES MÉTALLIQUES : Associe la matière reconnue parmi les nuances Facozinc (Zinc Naturel 0.7/0.8, Zinc Noir ATZ, Alu 7016 gris bleu 0.7, etc.).

Renvoie UNIQUEMENT un JSON valide au format :
{
  "client": "Nom du client ou 'Client Toiture SPRL'",
  "chantier": "Chantier Les Pins",
  "detected_finish": "Zinc Quartz 0.7",
  "pieces": [
    {
      "id": "p-1",
      "label": "Bavette d'égout",
      "dev": 190,
      "length": 2.0,
      "quantity": 8,
      "bends": 3,
      "material": "Zinc Quartz 0.7",
      "workshop_split_reason": "15+120+35+20=190mm"
    }
  ],
  "raw_observations": "Observations visuelles",
  "notes": "Remarques éventuelles"
}"""


def _parse_manual_text_fallback(text: str, standard_length: float) -> list[ShapedPieceModel]:
    """
    Extrait les pièces depuis un descriptif textuel simple d'atelier
    (ex: '8 bavettes de 3m', 'Bande de rive dev 250 x6 2m').
    """
    pieces: list[ShapedPieceModel] = []
    lines = [line.strip() for line in text.split("\n") if line.strip()]

    # Pattern : "8 bavettes de 3m" ou "8 bavette dev 190 2m"
    qty_label_len_pattern = re.compile(
        r"(\d+)\s+([a-zA-ZÀ-ÿ\s'-]+?)(?:\s+(?:en|de))?\s+(\d+(?:[.,]\d+)?)\s*m",
        re.IGNORECASE,
    )

    for idx, line in enumerate(lines, start=1):
        match = qty_label_len_pattern.search(line)
        if match:
            qty = int(match.group(1))
            label = match.group(2).strip().capitalize()
            length_val = float(match.group(3).replace(",", "."))

            # Recherche d'un dev explicite dans la ligne (ex: "dev 190" ou "190mm")
            dev_match = re.search(r"(?:dev|dév|d)\s*[:=]?\s*(\d+)", line, re.IGNORECASE)
            dev = int(dev_match.group(1)) if dev_match else 200

            pieces.append(
                ShapedPieceModel(
                    id=f"p-{idx}",
                    label=label if label else "Pièce façonnée",
                    dev=dev,
                    length=length_val,
                    quantity=qty,
                    bends=2,
                    material="Zinc Naturel 0.7",
                )
            )

    return pieces


def parse_document_multimodal(request: DocumentParseRequest) -> DocumentParseResponse:
    """
    Exécute l'analyse OCR et extraction des profils par IA.
    Si la clé API Gemini est disponible et le SDK installé, appelle le modèle de vision.
    Sinon, applique le parseur textuel ou le jeu de données d'exemple certifié du cahier des charges.
    """
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    gemini_error: Optional[str] = None

    if api_key:
        try:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=api_key)

            parts: list[types.Part] = []
            if request.file_base64:
                clean_b64 = re.sub(r"^data:[^;]+;base64,", "", request.file_base64.strip())
                try:
                    raw_bytes = base64.b64decode(clean_b64)
                    parts.append(
                        types.Part.from_bytes(
                            data=raw_bytes,
                            mime_type=request.mime_type or "image/jpeg",
                        )
                    )
                except Exception as b64_err:
                    logger.warning(f"Erreur décodage base64 : {b64_err}")

            user_instruction = (
                f"Analyse ce document avec longueur standard = {request.standard_length}m.\n"
                f"Instructions complémentaires : {request.manual_text or 'Aucune'}"
            )
            parts.append(types.Part.from_text(text=user_instruction))

            model_name = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")

            response = client.models.generate_content(
                model=model_name,
                contents=types.Content(parts=parts),
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    response_mime_type="application/json",
                    temperature=0.1,
                ),
            )

            if response.text:
                data = json.loads(response.text)
                pieces = [
                    ShapedPieceModel(
                        id=p.get("id", f"p-{i+1}"),
                        label=p.get("label", "Profilé plié"),
                        dev=int(p.get("dev", 200)),
                        length=float(p.get("length", request.standard_length)),
                        quantity=int(p.get("quantity", 1)),
                        bends=int(p.get("bends", 2)),
                        material=resolve_material_spec(p.get("material", "Zinc Naturel 0.7")).name,
                        workshop_split_reason=p.get("workshop_split_reason"),
                        notes=p.get("notes"),
                    )
                    for i, p in enumerate(data.get("pieces", []))
                ]

                return DocumentParseResponse(
                    client=data.get("client", "Client Toiture SPRL"),
                    chantier=data.get("chantier", "Chantier Les Pins"),
                    detected_finish=data.get("detected_finish", "Zinc Quartz 0.7"),
                    pieces=pieces,
                    raw_observations=data.get("raw_observations", "Analyse Gemini effectuée avec succès"),
                    notes=data.get("notes"),
                )
        except Exception as exc:
            logger.error(f"Échec de l'appel Gemini Vision : {exc}", exc_info=True)
            gemini_error = str(exc)

    # Repli déterministe conforme à la Section 4.2 du Cahier des Charges
    if request.manual_text and request.manual_text.strip():
        parsed_pieces = _parse_manual_text_fallback(request.manual_text, request.standard_length)
        if parsed_pieces:
            return DocumentParseResponse(
                client="Client Toiture SPRL",
                chantier="Chantier Les Pins",
                detected_finish="Zinc Quartz 0.7",
                pieces=parsed_pieces,
                raw_observations=f"Pièces extraites du descriptif texte : '{request.manual_text}'",
                notes="Mode extraction texte d'atelier",
            )

    # Message informatif précis pour l'opérateur sur l'état de l'IA
    if not api_key:
        diag_msg = (
            "⚠️ Clé GEMINI_API_KEY non configurée dans backend/.env. "
            "Pour activer la reconnaissance de vos photos et croquis par IA, "
            "renseignez votre clé API Google Gemini (GEMINI_API_KEY=...) dans backend/.env."
        )
    else:
        diag_msg = f"⚠️ Échec de l'appel à l'API Gemini : {gemini_error}. Vérifiez votre clé API ou votre quota."

    # Réponse type normalisée de Section 4.2 pour ne pas bloquer l'application
    standard_piece = ShapedPieceModel(
        id="p-1",
        label="Bavette d'égout",
        dev=190,
        length=request.standard_length,
        quantity=8,
        bends=3,
        material="Zinc Quartz 0.7",
        workshop_split_reason="15+120+35+20 = 190 mm",
    )

    return DocumentParseResponse(
        client="Client Toiture SPRL",
        chantier="Chantier Les Pins",
        detected_finish="Zinc Quartz 0.7",
        pieces=[standard_piece],
        raw_observations=diag_msg,
        notes=diag_msg,
    )
