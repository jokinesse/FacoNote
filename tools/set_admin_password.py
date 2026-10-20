"""
Outil CLI pour définir ou renouveler le mot de passe Administrateur FacoNote.

Sécurité :
- Le mot de passe saisi n'est jamais affiché à l'écran (`getpass`) ni stocké en clair.
- Seule son empreinte cryptographique irréversible `scrypt` (avec sel aléatoire de 128 bits)
  est écrite dans `backend/.env` (fichier exclu de Git).

Usage :
    .venv\\Scripts\\python tools\\set_admin_password.py
"""

from __future__ import annotations

import argparse
import getpass
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT_DIR / "backend"))

from app.core.admin_security import (  # noqa: E402
    BACKEND_ENV_PATH,
    hash_admin_password,
    save_admin_hash_to_env,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Configure l'empreinte scrypt Admin FacoNote")
    parser.add_argument(
        "--password",
        help="Mot de passe (déconseillé en ligne de commande : préférez la saisie interactive masquée)",
    )
    args = parser.parse_args()

    if args.password:
        pwd = args.password.strip()
    else:
        print("=== Configuration du Coffre-Fort Admin FacoNote ===")
        print("Votre mot de passe ne sera JAMAIS stocké en clair (hachage scrypt + sel 128 bits).\n")
        pwd = getpass.getpass("Nouveau mot de passe Admin (min. 8 caractères) : ").strip()
        confirm = getpass.getpass("Confirmez le mot de passe                      : ").strip()
        if pwd != confirm:
            print("Erreur : les deux mots de passe ne correspondent pas.", file=sys.stderr)
            raise SystemExit(1)

    try:
        scrypt_hash = hash_admin_password(pwd)
    except ValueError as exc:
        print(f"Erreur : {exc}", file=sys.stderr)
        raise SystemExit(1) from exc

    save_admin_hash_to_env(scrypt_hash)
    print(f"\nEmpreinte scrypt enregistrée avec succès dans : {BACKEND_ENV_PATH}")
    print(f"Aperçu de l'empreinte : {scrypt_hash[:32]}... (mot de passe d'origine détruit de la mémoire)")


if __name__ == "__main__":
    main()
