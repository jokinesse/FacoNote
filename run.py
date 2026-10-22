"""
Script de lancement rapide du serveur FastAPI FacoNote.
Permet de démarrer directement depuis la racine sans souci de PYTHONPATH.
"""

import os
import sys
from pathlib import Path
import uvicorn

# Ajoute automatiquement le dossier backend au chemin d'importation
root_dir = Path(__file__).resolve().parent
backend_dir = root_dir / "backend"
sys.path.insert(0, str(backend_dir))

if __name__ == "__main__":
    # Écoute sur 0.0.0.0 par défaut pour permettre l'accès aussi bien en local que depuis un réseau ou serveur distant
    host = os.environ.get("FACO_HOST", "0.0.0.0")
    port = int(os.environ.get("FACO_PORT", "8000"))
    print(f"Démarrage du serveur Facozinc depuis {backend_dir} sur {host}:{port}...")
    uvicorn.run(
        "app.main:app",
        host=host,
        port=port,
        reload=True,
        app_dir=str(backend_dir),
    )
