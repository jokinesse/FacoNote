"""
Outil CLI pour configurer la clé API Google Gemini dans backend/.env.

Permet d'activer l'analyse multimodale IA (reconnaissance de plans PDF,
croquis manuscrits, cotes et profils façonnés).

Usage :
    .venv\\Scripts\\python tools\\set_gemini_key.py
    .venv\\Scripts\\python tools\\set_gemini_key.py --key "AIzaSy..."
"""

from __future__ import annotations

import argparse
import getpass
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
BACKEND_ENV_PATH = ROOT_DIR / "backend" / ".env"


def save_gemini_key_to_env(key: str) -> None:
    content = ""
    if BACKEND_ENV_PATH.exists():
        content = BACKEND_ENV_PATH.read_text(encoding="utf-8")

    lines = content.splitlines()
    key_line = f"GEMINI_API_KEY={key.strip()}"
    found = False
    new_lines = []

    for line in lines:
        if line.strip().startswith("GEMINI_API_KEY="):
            new_lines.append(key_line)
            found = True
        else:
            new_lines.append(line)

    if not found:
        if new_lines and new_lines[-1] != "":
            new_lines.append("")
        new_lines.append("# Clé API Google Gemini pour vision multimodale et OCR")
        new_lines.append(key_line)

    BACKEND_ENV_PATH.parent.mkdir(parents=True, exist_ok=True)
    BACKEND_ENV_PATH.write_text("\n".join(new_lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Configure la clé API Google Gemini pour FacoNote")
    parser.add_argument(
        "--key",
        help="Clé API Gemini (ex: AIzaSy...)",
    )
    args = parser.parse_args()

    if args.key:
        api_key = args.key.strip()
    else:
        print("=== Configuration de l'IA Vision Gemini FacoNote ===")
        print("Obtenez une clé gratuite sur : https://aistudio.google.com/app/apikey\n")
        api_key = getpass.getpass("Collez votre clé API Gemini (GEMINI_API_KEY) : ").strip()

    if not api_key:
        print("Erreur : la clé API ne peut pas être vide.", file=sys.stderr)
        raise SystemExit(1)

    save_gemini_key_to_env(api_key)
    print(f"\nClé GEMINI_API_KEY enregistrée avec succès dans : {BACKEND_ENV_PATH}")
    print(f"Aperçu : {api_key[:8]}...{api_key[-4:] if len(api_key) > 12 else ''}")
    print("La reconnaissance d'image est désormais active !")


if __name__ == "__main__":
    main()
