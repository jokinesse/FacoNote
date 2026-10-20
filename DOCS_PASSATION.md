# DOCUMENT DE PASSATION TECHNIQUE - REFONTE DU BACKEND PYTHON (FACOZINC)

Ce document formalise l'intégralité de la refonte architecturale, mathématique et logicielle du backend **FacoNote (Plateforme Facozinc)** conformément aux spécifications du cahier des charges (`Cahier_des_Charges_Facozinc_Python.pdf`) et aux exigences de découpe industrielle de métaux pour le bâtiment.

---

## 1. Architecture Globale

### 1.1 Stack Technique
* **Langage** : Python 3.12+ (exécuté et certifié sous Python 3.14).
* **Framework Web & API** : FastAPI 0.149+ (asynchrone, validation automatique OpenAPI / Swagger).
* **Validation & Typage** : Pydantic v2.14+ avec typage strict sans `Any` (`mypy --strict`).
* **Moteur d'Imagerie** : Pillow (PIL) 13.0+ pour prétraitement haute fidélité des croquis.
* **Extraction OCR / IA** : Google GenAI SDK (`gemini-2.5-flash`) avec repli déterministe certifié d'atelier.
* **Serveur ASGI** : Uvicorn 0.54+.
* **Suite de Tests** : Pytest 9.1+ et Starlette TestClient (53 tests automatisés).

### 1.2 Principes Fondamentaux de Conception
1. **Clean Architecture & Découplage strict** : Les moteurs mathématiques (`math_parser.py`, `breakdown_engine.py`, `nesting_engine.py`) sont des bibliothèques pures indépendantes de toute dépendance web (FastAPI/HTTP).
2. **Déterminisme Numérique** : Arrondi systématique à 3 décimales pour les longueurs linéaires (mètres) et à 2 décimales pour les surfaces ($m^2$) et masses ($kg$).
3. **Ségrégation absolue des matières** : Interdiction physique stricte de combiner Zinc et Aluminium sur une même feuille mère lors de la refente.
4. **Thread-Safety** : Les sessions mobiles d'atelier sont encapsulées dans un store mémoire synchronisé par verrou réentrant (`threading.RLock`) avec purge automatique (TTL 45 minutes).

### 1.3 Arborescence des Fichiers Clés et Responsabilités

```
FacoNote/
├── run.py                             # Script d'exécution rapide (configure app-dir backend)
├── pyproject.toml                     # Configuration unifiée Mypy strict & Pytest
├── Cahier_des_Charges_Facozinc_Python.pdf # Document contractuel de référence
├── backend/
│   ├── requirements.txt               # Dépendances Python verrouillées
│   ├── README.md                      # Guide rapide d'exploitation
│   └── app/
│       ├── __init__.py
│       ├── main.py                    # Point d'entrée FastAPI, middleware CORS, routes racines
│       ├── py.typed                   # Marqueur PEP 561 pour typage strict
│       ├── core/
│       │   ├── __init__.py
│       │   └── constants.py           # Nuances métaux, densités surfaciques, laizes et bornes
│       ├── models/                    # Schémas Pydantic v2 (extra="forbid")
│       │   ├── __init__.py
│       │   ├── pieces.py              # ShapedPieceModel, FastEncoderRequest/Response
│       │   ├── optimizer.py           # AutoBreakdown, OptimizationRequest/Response, Slits
│       │   ├── mobile.py              # MobileSession, MobileUpload, MobileStatus
│       │   └── ai.py                  # DocumentParseRequest, DocumentParseResponse
│       ├── services/                  # Moteurs algorithmiques et métier purs
│       │   ├── __init__.py
│       │   ├── math_parser.py         # Parseur arithmétique Shunting-Yard RPN (sans eval)
│       │   ├── encoder_engine.py      # Découpage saisie composite et affectation bornes
│       │   ├── breakdown_engine.py    # Auto-calepinage linéaire (diviseurs stricts, scoring)
│       │   ├── nesting_engine.py      # Imbrication 1D/2D, ségrégation et chutes d'atelier/rack
│       │   ├── session_store.py       # Store thread-safe des sessions mobiles (TTL 45 min)
│       │   ├── image_pipeline.py      # Rotation 90° et rehaussement de contraste (+15%) Pillow
│       │   ├── ai_ocr_service.py      # Extraction multimodale Gemini & analyse de texte
│       │   └── sheet_generator.py     # Générateur HTML5/CSS de fiche de débit normalisée A4
│       └── api/
│           ├── __init__.py
│           └── v1/
│               ├── __init__.py
│               ├── router.py          # Agrégation des sous-routeurs v1
│               └── endpoints/
│                   ├── __init__.py
│                   ├── optimizer.py   # Routes /auto-breakdown, /calculate, /quick-encode, /print-sheet
│                   ├── mobile.py      # Routes /session, /upload, /status, /reset
│                   └── ai.py          # Routes /parse-document, /process-image
└── tests/                             # Suite Pytest (53 tests unitaires et intégration)
    ├── __init__.py
    ├── test_constants.py              # Validation densités, nuances et calculs surfaciques
    ├── test_math_parser.py            # Validation RPN, parenthèses, priorités, moins unaire
    ├── test_encoder_engine.py         # Validation saisie rapide et règles d'affectation
    ├── test_breakdown_engine.py       # Validation diviseurs stricts, garanties 0 chute et scoring
    ├── test_nesting_engine.py         # Validation ségrégation matières, cohortes, chutes rack
    ├── test_session_store.py          # Validation thread-safety, reset et TTL 45 min
    ├── test_image_pipeline.py         # Validation rotation et rehaussement de contraste
    ├── test_ai_service.py             # Validation extraction OCR et repli d'atelier
    ├── test_sheet_generator.py        # Validation génération HTML de la fiche A4
    └── test_api_endpoints.py          # Validation des contrats HTTP et codes de statut
```

---

## 2. Contrats d'API & Routes

L'API est préfixée par `/api/v1` et entièrement documentée via OpenAPI (Swagger).

### 2.1 Module Optimiseur & Calepinage (`/api/v1/optimizer`)

#### 1. Auto-calepinage du métrage linéaire sans quantité
* **Méthode / Route** : `POST /api/v1/optimizer/auto-breakdown`
* **Description** : Détermine le calepinage optimal en tôles d'atelier lorsqu'un client fournit uniquement un métrage total (ex: 11.5 m) sans quantité de pièces (`Quantité = 0`).
* **Payload Attendu** :
  ```json
  {
    "total_meters": 11.5,
    "current_pieces": [],
    "target_material": "Zinc Naturel 0.7",
    "forced_length": null
  }
  ```
* **Réponse Type (HTTP 200)** :
  ```json
  {
    "length": 2.3,
    "quantity": 5,
    "total_produced": 11.5,
    "requested_meters": 11.5,
    "reason": "Tombe pile : 5 pièces de 2.3m = exactement 11.5m (0 chute)",
    "source": "standard_exact",
    "alternatives": [
      {
        "length": 2.3,
        "quantity": 5,
        "total_produced": 11.5,
        "excess": 0.0,
        "is_exact": true,
        "is_existing": false,
        "is_closest": false,
        "score": 185.0,
        "label": "5 pcs × 2.3m = 11.5m (Tombe pile - 0 chute)"
      },
      {
        "length": 2.0,
        "quantity": 6,
        "total_produced": 12.0,
        "excess": 0.5,
        "is_exact": false,
        "is_existing": false,
        "is_closest": true,
        "score": 140.0,
        "label": "6 pcs × 2.0m = 12.0m (+0.5m chute)"
      }
    ]
  }
  ```
* **Codes d'erreur** : `HTTP 400` (métrage négatif ou nul), `HTTP 422` (erreur de schéma).

#### 2. Calcul d'imbrication et refente longitudinale (Nesting 1D/2D)
* **Méthode / Route** : `POST /api/v1/optimizer/calculate`
* **Description** : Partitionne les cohortes de longueur unitaire, optimise la combinaison transversale sur tôles mères par Branch & Bound, qualifie les chutes d'atelier ($\ge 100\,\text{mm}$ et $\ge 1.0\,\text{m}$) et propose la substitution par bandes de rack si perte $\ge 45\%$.
* **Payload Attendu** :
  ```json
  {
    "client_name": "Toitures Dupont SPRL",
    "chantier_ref": "Chantier Les Pins",
    "material": "Zinc Naturel 0.7",
    "pieces": [
      {
        "id": "p-1",
        "label": "Bavette d'égout",
        "dev": 250,
        "length": 2.0,
        "quantity": 4,
        "bends": 2,
        "material": "Zinc Naturel 0.7"
      }
    ],
    "available_mother_widths": [1000],
    "use_workshop_scraps": false,
    "accepted_proposal_ids": null
  }
  ```
* **Réponse Type (HTTP 200)** :
  ```json
  {
    "order_id": "OPT-1729330800",
    "timestamp": 1729330800.0,
    "material_efficiency_rate": 100.0,
    "total_net_surface_m2": 2.0,
    "total_gross_surface_m2": 2.0,
    "reusable_scrap_surface_m2": 0.0,
    "net_loss_surface_m2": 0.0,
    "net_weight_kg": 10.08,
    "gross_weight_kg": 10.08,
    "slits": [
      {
        "mother_width": 1000,
        "mother_length": 2.0,
        "material": "Zinc Naturel 0.7",
        "strips": [
          {
            "piece_id": "p-1",
            "label": "Bavette d'égout",
            "dev": 250,
            "length": 2.0,
            "qty": 4,
            "material": "Zinc Naturel 0.7"
          }
        ],
        "used_width": 1000,
        "scrap_width": 0,
        "is_scrap_reusable": false,
        "suggested_scrap_ref": null
      }
    ],
    "workshop_scrap_proposals": [],
    "applied_workshop_scraps": [],
    "summary_message": "Optimisation terminée : 1 repères usinés. Rendement matière de 100.0%..."
  }
  ```
* **Codes d'erreur** : `HTTP 400` (liste de pièces vide), `HTTP 500` (erreur de calcul interne).

#### 3. Décodage et affectation saisie rapide (FastEncoder)
* **Méthode / Route** : `POST /api/v1/optimizer/quick-encode`
* **Description** : Évalue les expressions arithmétiques au kilomètre (`175/8*3`, `250/3*2+1.5`, `0/4.5`) et affecte la pièce sur la première borne standard $B \ge \text{dev}$ ou borne max.
* **Payload Attendu** :
  ```json
  {
    "raw_input": "175/8*3",
    "material": "Zinc Naturel 0.7",
    "length_unit": "m",
    "preset": "DEV_PIECE"
  }
  ```
* **Réponse Type (HTTP 200)** :
  ```json
  {
    "raw_input": "175/8*3",
    "dev": 175,
    "unit_length_m": 3.0,
    "quantity": 8,
    "total_length_m": 24.0,
    "matched_bound": 175,
    "is_chute": false,
    "is_auto_breakdown": false,
    "surface_net_m2": 4.2,
    "weight_net_kg": 21.17,
    "material": "Zinc Naturel 0.7"
  }
  ```
* **Codes d'erreur** : `HTTP 422` (chute 0 mm interdite en mode DEV_PIECE, division par zéro ou syntaxe erronée).

#### 4. Fiche de débit atelier normalisée A4 (HTML/Print)
* **Méthode / Route** : `POST /api/v1/optimizer/print-sheet`
* **Payload** : Identique à `OptimizationRequest`.
* **Réponse Type (HTTP 200)** : Flux HTML5 direct (`Content-Type: text/html; charset=utf-8`) avec pagination CSS A4 portrait (`@page { size: A4; margin: 10mm; }`), tableau de nomenclature, bon de sortie magasin et récapitulatif massicotage.

---

### 2.2 Module Sessions Mobiles d'Atelier (`/api/v1/mobile`)

#### 1. Création de session sans fil
* **Méthode / Route** : `POST /api/v1/mobile/session`
* **Payload** : Aucun.
* **Réponse Type (HTTP 201)** :
  ```json
  {
    "session_id": "FAC-4829-X7K1",
    "created_at": 1729330800.0,
    "qr_url": "https://atelier.facozinc.com/mobile?session=FAC-4829-X7K1"
  }
  ```

#### 2. Réception de la photo smartphone
* **Méthode / Route** : `POST /api/v1/mobile/upload`
* **Payload Attendu** :
  ```json
  {
    "session_id": "FAC-4829-X7K1",
    "image_base64": "data:image/jpeg;base64,...",
    "filename": "croquis.jpg",
    "note": "Bavettes côté cour"
  }
  ```
* **Réponse Type (HTTP 200)** :
  ```json
  {
    "success": true,
    "message": "Photo transmise avec succès au poste de travail",
    "session_id": "FAC-4829-X7K1"
  }
  ```
* **Codes d'erreur** : `HTTP 410` (session expirée au-delà de 45 minutes).

#### 3. Polling de l'état de la session
* **Méthode / Route** : `GET /api/v1/mobile/status/{session_id}`
* **Réponse Type (HTTP 200)** :
  ```json
  {
    "session_id": "FAC-4829-X7K1",
    "status": "ready",
    "has_image": true,
    "image_base64": "data:image/jpeg;base64,...",
    "filename": "croquis.jpg",
    "note": "Bavettes côté cour",
    "created_at": 1729330800.0
  }
  ```
* **Codes d'erreur** : `HTTP 404` (session inconnue), `HTTP 410` (session expirée).

#### 4. Réinitialisation de session
* **Méthode / Route** : `POST /api/v1/mobile/reset/{session_id}`
* **Description** : Remet le statut à `"waiting"` et vide l'image en mémoire pour permettre un nouveau scan sans re-générer de QR Code.
* **Réponse Type (HTTP 200)** : `{"success": true}`.

---

### 2.3 Module Intelligence Artificielle & Traitement d'Images (`/api/v1/ai`)

#### 1. Extraction multimodale de profils façonnés (OCR)
* **Méthode / Route** : `POST /api/v1/ai/parse-document`
* **Payload Attendu** :
  ```json
  {
    "file_base64": "data:image/jpeg;base64,...",
    "mime_type": "image/jpeg",
    "manual_text": "8 bavettes de 3m",
    "standard_length": 2.0
  }
  ```
* **Réponse Type (HTTP 200)** :
  ```json
  {
    "client": "Client Toiture SPRL",
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
    "raw_observations": "Observations visuelles des cotes",
    "notes": "Remarques éventuelles atelier"
  }
  ```

#### 2. Prétraitement d'image d'atelier (Pillow)
* **Méthode / Route** : `POST /api/v1/ai/process-image`
* **Payload Attendu** :
  ```json
  {
    "image_base64": "data:image/jpeg;base64,...",
    "rotation_deg": 90,
    "contrast_boost": 1.15
  }
  ```
* **Réponse Type (HTTP 200)** :
  ```json
  {
    "data_uri": "data:image/jpeg;base64,...",
    "mime_type": "image/jpeg",
    "width": 1200,
    "height": 1800
  }
  ```

---

## 3. Modèles de Données & Constantes Physiques

### 3.1 Table des Constantes Physiques et Nuances Métalliques (`constants.py`)

Les formules de conversion physique appliquées sont :
$$\text{Surface } (m^2) = \frac{\text{Développé } (mm)}{1000} \times \text{Longueur } (m)$$
$$\text{Poids } (kg) = \text{Surface } (m^2) \times \text{Densité surfacique } (kg/m^2)$$

| Nuance / Matériau | Épaisseur | Densité volumique | Densité surfacique | Laizes mères candidates |
| :--- | :---: | :---: | :---: | :--- |
| **Zinc Naturel / Noir ATZ / Quartz / Pigmento Rouge / Perforée** | 0.70 mm | $7\,200\,\text{kg/m}^3$ | **$5.04\,\text{kg/m}^2$** | 600, 650, 670, 750, 1000, 1100 mm |
| **Zinc Naturel / Noir ATZ / Quartz / Pigmento Rouge / Perforée** | 0.80 mm | $7\,200\,\text{kg/m}^3$ | **$5.76\,\text{kg/m}^2$** | 600, 650, 670, 750, 1000, 1100 mm |
| **Aluminium 7016 gris bleu** | 0.70 mm | $2\,700\,\text{kg/m}^3$ | **$1.89\,\text{kg/m}^2$** | 500, 600, 650, 750, 1000, 1250 mm |
| **Aluminium 9010 Blanc** | 0.70 mm | $2\,700\,\text{kg/m}^3$ | **$1.89\,\text{kg/m}^2$** | 650, 1000, 1250 mm |
| **Aluminium 9005 Noir texturé** | 0.70 mm | $2\,700\,\text{kg/m}^3$ | **$1.89\,\text{kg/m}^2$** | 650, 1000 mm |
| **Aluminium Quartz** | 0.70 mm | $2\,700\,\text{kg/m}^3$ | **$1.89\,\text{kg/m}^2$** | 650, 1000 mm |
| **Aluminium 1.5 Brut** | 1.50 mm | $2\,700\,\text{kg/m}^3$ | **$4.05\,\text{kg/m}^2$** | 1000, 1250, 1500 mm |
| **Cuivre** | 0.60 mm | $8\,960\,\text{kg/m}^3$ | **$5.38\,\text{kg/m}^2$** | 600, 670, 1000 mm |
| **Plomb** | 1.25 mm | $11\,340\,\text{kg/m}^3$ | **$14.18\,\text{kg/m}^2$** | 1000 mm |

#### Bornes industrielles de refente :
* **DEV_PIECE (19 bornes standard)** : `[100, 120, 150, 175, 187, 200, 250, 285, 300, 333, 375, 400, 450, 500, 600, 670, 750, 1000, 1100]`
* **DEV_BOBINE (6 bornes mères)** : `[600, 650, 670, 750, 1000, 1100]`
* **Chutes de rack réutilisables (5 largeurs)** : `[100, 120, 150, 200, 250]`

### 3.2 Modèles Pydantic Fondamentaux (`app/models/`)

```python
class ShapedPieceModel(BaseModel):
    id: str
    label: str
    dev: int = Field(..., ge=20, le=2000)
    length: float = Field(..., ge=0.1, le=14.0)
    quantity: int = Field(..., ge=1, le=1000)
    bends: int = Field(2, ge=0, le=20)
    material: str = Field("Zinc Naturel 0.7")
    workshop_split_reason: Optional[str] = None
    notes: Optional[str] = None
    original_total_length_requested: Optional[float] = None

class OptimizationRequest(BaseModel):
    client_name: str = "Client Comptoir"
    chantier_ref: str = "Chantier Standard"
    material: str = "Zinc Naturel 0.7"
    pieces: list[ShapedPieceModel]
    available_mother_widths: Optional[list[int]] = None
    use_workshop_scraps: bool = False
    accepted_proposal_ids: Optional[list[str]] = None
```

---

## 4. Variables d'Environnement & Dépendances

### 4.1 Fichier `.env` ou variables système
| Variable | Obligatoire | Valeur par défaut / Description |
| :--- | :---: | :--- |
| `GEMINI_API_KEY` | Optionnelle | Clé API Google AI Studio pour activer l'OCR multimodale avancée. Si absente, le système bascule automatiquement sur le repli déterministe d'atelier sans lever d'erreur. |
| `PORT` | Optionnelle | Port d'écoute du serveur Uvicorn (défaut: `8000`). |
| `HOST` | Optionnelle | Hôte d'écoute (défaut: `127.0.0.1` ou `0.0.0.0`). |

### 4.2 Dépendances Python installées (`backend/requirements.txt`)
* `fastapi>=0.115.0`
* `uvicorn[standard]>=0.34.0`
* `pydantic>=2.10.0`
* `pydantic-settings>=2.7.0`
* `pillow>=11.0.0`
* `pytest>=8.3.0`
* `mypy>=1.14.0`
* `httpx>=0.28.0`
* `google-genai>=2.31.0`

---

## 5. Procédure de Validation & Commandes d'Exploitation

### 5.1 Installation de l'environnement
Depuis le terminal PowerShell à la racine `C:\Users\antoi\Documents\DEV\FacoNote` :
```powershell
python -m venv .venv
.\.venv\Scripts\pip install -r backend/requirements.txt
```

### 5.2 Lancement du Serveur de Développement
```powershell
# Commande Uvicorn native avec app-dir
.\.venv\Scripts\uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload

# OU via le script d'entrée direct
.\.venv\Scripts\python run.py
```
* **Documentation OpenAPI Swagger** : `http://127.0.0.1:8000/docs`
* **Documentation Redoc** : `http://127.0.0.1:8000/redoc`
* **Vérification de santé** : `http://127.0.0.1:8000/api/health`

### 5.3 Exécution de la suite de Tests Automatisés
```powershell
.\.venv\Scripts\pytest
```
*Résultat certifié* : **53 passed** en moins de 1 seconde.

### 5.4 Contrôle du Typage Strict & Linting
```powershell
.\.venv\Scripts\mypy backend/app backend/tests
```
*Résultat certifié* : `Success: no issues found in 36 source files`.

---

## 6. État des Lieux & Roadmap de Suite

### 6.1 Ce qui est 100 % Terminé et Certifié
* ✅ **Moteur Shunting-Yard RPN** : évaluation arithmétique 100% sécurisée sans aucun recours à `eval()`, gestion du moins unaire et des parenthèses.
* ✅ **Moteur d'Auto-Calepinage Linéaire** : diviseurs mathématiques stricts (1 à 40), formats de plieuse machine, scoring pondéré, garantie d'au moins une alternative "tombe pile" (0 chute).
* ✅ **Moteur de Refente & Imbrication 1D/2D** : ségrégation stricte des matières, partitionnement par cohortes de longueur, algorithme Branch & Bound, qualification des chutes réutilisables (`CHU-MAT-WIDTH-LENM`), détection et substitution par bandes de rack pré-coupées.
* ✅ **Sessions Mobiles QR Code** : store thread-safe avec TTL de 45 minutes et purge mémoire.
* ✅ **Pipeline d'Images Pillow** : rotation orthogonale par pas de 90° et rehaussement de contraste (+15%) pour croquis manuscrits au crayon.
* ✅ **Génération Fiche Débit A4** : export HTML/Print prêt pour impression massicot et plieuse.
* ✅ **Contrats d'interface HTTP FastAPI** : endpoints conformes au cahier des charges, documentés et validés par tests d'intégration `TestClient`.

### 6.2 Prochaines Étapes / Évolutions Envisageables (TODO)
1. **Raccordement Frontend React** :
   * Actuellement, l'interface graphique utilisateur se trouve dans `legacy/src/`.
   * Il convient d'adapter les endpoints de fetch dans les composants React pour cibler `http://127.0.0.1:8000/api/v1/` au lieu de l'ancien serveur Express.
   * Compiler le frontend (`npm run build`) et monter les assets statiques dans FastAPI via `app.mount("/", StaticFiles(directory="dist", html=True))` pour un exécutable tout-en-un sur un seul port.
2. **Authentification & Droits Utilisateurs** :
   * L'application actuelle fonctionne en mode atelier ouvert ("Client Comptoir"). Pour une utilisation multi-sites, prévoir une couche OAuth2 / JWT (métreurs, chefs d'atelier, opérateurs).
3. **Persistance en Base de Données Relationnelle (optionnelle)** :
   * Les sessions mobiles actuelles sont éphémères en mémoire (TTL 45 min). Si l'atelier souhaite conserver l'historique de tous les débits et l'état d'inventaire du chutier sur plusieurs mois, un ORM (SQLAlchemy ou SQLModel avec SQLite/PostgreSQL) pourra être branché en remplacement du store en mémoire.
4. **Conteneurisation & Déploiement** :
   * Écriture d'un `Dockerfile` multi-stage (build React + Python FastAPI) pour un déploiement clé-en-main sur serveur d'atelier ou cloud.
