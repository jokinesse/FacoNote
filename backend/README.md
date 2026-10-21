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
