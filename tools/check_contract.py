"""
Vérifie que chaque route appelée par le frontend (frontend/src/api/*.ts) existe dans le backend.
Usage : python tools/check_contract.py   (depuis la racine du dépôt)
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app.main import app  # noqa: E402

backend_paths = set(app.openapi()["paths"])
called: set[str] = set()
for ts_file in sorted((ROOT / "frontend" / "src" / "api").glob("*.ts")):
    for match in re.finditer(r"['`](/api/[A-Za-z0-9_/\-${}.]+)['`]", ts_file.read_text(encoding="utf-8")):
        # Paramètres de chemin côté frontend (${id}) -> forme OpenAPI ({...})
        called.add(re.sub(r"\$\{[^}]+\}", "{param}", match.group(1)))


def exists(path: str) -> bool:
    pattern = re.escape(path).replace(re.escape("{param}"), r"\{[^}]+\}")
    return any(re.fullmatch(pattern, p) for p in backend_paths)


missing = sorted(p for p in called if not exists(p))
if missing:
    print("Routes appelées par le frontend mais absentes du backend :")
    for p in missing:
        print(f"  - {p}")
    sys.exit(1)
print(f"Contrat OK : {len(called)} routes appelées par le frontend, toutes présentes dans le backend.")
