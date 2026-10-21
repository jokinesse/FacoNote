# FacoNote

Plateforme de Calepinage, Encodage Rapide et Optimisation de Refente (Nesting 1D/2D) pour ateliers de façonnage en toiture et bardage.

## Démarrage Rapide

### Prérequis
- Python 3.12+
- Node.js 18+

### 1. Backend (FastAPI)
```bash
python -m venv .venv
.\.venv\Scripts\pip install -r backend/requirements.txt
.\.venv\Scripts\python run.py
```
Le serveur API démarre sur http://127.0.0.1:8000 (documentation Swagger sur `/docs`).

### 2. Frontend (React / Vite / Tailwind)
```bash
cd frontend
npm install
npm run dev
```
L'interface est accessible sur http://localhost:3000.

---

## Tests

```bash
.\.venv\Scripts\pytest backend/tests
cd frontend && npm run lint && npm run build
```
