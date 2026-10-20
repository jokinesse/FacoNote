"""
Script de lancement rapide du serveur FastAPI FacoNote.
Permet de démarrer directement depuis la racine sans souci de PYTHONPATH.
"""

import sys
from pathlib import Path
import uvicorn

# Ajoute automatiquement le dossier backend au chemin d'importation
root_dir = Path(__file__).resolve().parent
backend_dir = root_dir / "backend"
sys.path.insert(0, str(backend_dir))

if __name__ == "__main__":
    print(f"Démarrage du serveur Facozinc depuis {backend_dir}...")
    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        app_dir=str(backend_dir),
    )
