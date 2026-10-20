# FacoNote - Backend Python (Plateforme Facozinc)

Assistant d'Encodage Rapide, Calepinage Linéaire & Optimisation de Refente (Nesting 1D/2D) pour façonneurs en toiture et bardage.

## 🚀 Démarrage Rapide

### Prérequis
- Python 3.12+ (testé avec Python 3.14)
- Environnement virtuel `.venv`

### Installation
```bash
python -m venv .venv
.\.venv\Scripts\pip install -r backend/requirements.txt
```

### Lancement du Serveur FastAPI (depuis la racine FacoNote)
```bash
# Option 1 : Via uvicorn avec l'option --app-dir
.\.venv\Scripts\uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload

# Option 2 : Via le script d'entrée direct
.\.venv\Scripts\python run.py
```

- **Documentation Swagger interactive** : [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- **Documentation Redoc** : [http://127.0.0.1:8000/redoc](http://127.0.0.1:8000/redoc)
- **Point de santé** : [http://127.0.0.1:8000/api/health](http://127.0.0.1:8000/api/health)

---

## 🧪 Tests & Typage Strict

### Exécution des tests Pytest (53 tests automatisés)
```bash
.\.venv\Scripts\pytest
```

### Vérification du typage strict Mypy (36 fichiers)
```bash
.\.venv\Scripts\mypy backend/app backend/tests
```

---

## 📐 Architecture & Modules

```
backend/
├── app/
│   ├── core/
│   │   ├── config.py              # Configuration applicative
│   │   └── constants.py           # Table des nuances métaux, densités et bornes de refente
│   ├── models/                    # Schémas Pydantic v2 stricts
│   │   ├── pieces.py              # ShapedPieceModel, FastEncoderRequest/Response
│   │   ├── optimizer.py           # OptimizationRequest/Response, BreakdownResponse
│   │   ├── mobile.py              # MobileSession, MobileUpload, MobileStatus
│   │   └── ai.py                  # DocumentParseRequest/Response
│   ├── services/                  # Moteur métier pur et calculs (découplé du Web)
│   │   ├── math_parser.py         # Shunting-Yard RPN sans eval()
│   │   ├── encoder_engine.py      # Saisie composite et affectation bornes standards
│   │   ├── breakdown_engine.py    # Auto-calepinage du métrage linéaire sans quantité
│   │   ├── nesting_engine.py      # Moteur de refente 1D/2D, ségrégation matières et chutes
│   │   ├── session_store.py       # Store thread-safe en mémoire (TTL 45 min)
│   │   ├── image_pipeline.py      # Pipeline Pillow (+15% contraste, rotations 90°)
│   │   ├── ai_ocr_service.py      # Extraction multimodale Gemini & repli d'atelier
│   │   └── sheet_generator.py     # Génération de fiche de débit A4 normalisée
│   ├── api/v1/                    # Couche transport HTTP FastAPI
│   │   ├── endpoints/
│   │   │   ├── optimizer.py       # Endpoints auto-breakdown, calculate, quick-encode, print-sheet
│   │   │   ├── mobile.py          # Endpoints session, upload, status, reset
│   │   │   └── ai.py              # Endpoints parse-document et process-image
│   │   └── router.py              # Agrégation des routeurs v1
│   └── main.py                    # Point d'entrée de l'application FastAPI
└── tests/                         # Suite de tests Pytest (100% de réussite)
```

---

## 🎯 Synthèse des Nuances Métalliques Normalisées

### 1. Aluminium
- **Finition laquée 0.70 mm standard ($1.89\,\text{kg/m}^2$)** :
  - **Alu 7016 gris bleu** : laizes 500, 600, 650, 750, 1000, 1250 mm
  - **Alu 9010 Blanc** : laizes 650, 1000, 1250 mm
  - **Alu 9005 Noir texturé** : laizes 650, 1000 mm
  - **Alu Quartz** : laizes 650, 1000 mm
- **Alu 1.5 Brut ($4.05\,\text{kg/m}^2$)** :
  - Épaisseur **1.50 mm**, laizes / tôles 1000, 1250, 1500 mm

### 2. Zinc
- **Épaisseurs standard** : **0.70 mm** ($5.04\,\text{kg/m}^2$) et **0.80 mm** ($5.76\,\text{kg/m}^2$)
- **Laizes mères** : 600, 650, 670, 750, 1000, 1100 mm
- **Finitions** : Naturel, Noir ATZ, Quartz, Pigmento Rouge, Perforée
