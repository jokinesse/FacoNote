# FacoNote — Backend (FastAPI)

Mis à jour le 31/10/2026, état du code : commit `618f642` (main, déployé et poussé sur GitHub).

## Règle principale
**Tous les calculs métier sont faits ici** : longueurs, surfaces, poids, bornes, regroupements, totaux, découpe.
Le frontend garde seulement la liste des saisies de la session et affiche les résultats.
Tout nouveau calcul va dans `backend/app/services/`, avec ses tests pytest et une route.

## Où et comment ça tourne
- Code : `/var/www/faconote` (propriétaire `faconote`), dépôt GitHub `jokinesse/FacoNote`.
- Site : https://faconote.jokinesse.be (nginx → socket `/var/www/faconote/faconote.sock`).
- Service systemd `faconote` : utilisateur `faconote`, 4 workers uvicorn,
  `uvicorn app.main:app --uds /var/www/faconote/faconote.sock --workers 4 --app-dir backend`.
- Python dans `/var/www/faconote/.venv` (Python 3.14).
- Santé : `GET /api/health`. Documentation interactive : `/docs`.

## Routes (préfixe `/api/v1`)
| Groupe | Route | Rôle |
|---|---|---|
| optimizer | `GET /optimizer/materials` | Liste des matières |
| | `GET /optimizer/reference` | Matières + largeurs de bobines validées (source unique) |
| | `POST /optimizer/auto-breakdown` | Métrage automatique d'un linéaire |
| | `POST /optimizer/calculate` | Refente / calepinage des feuilles mères |
| | `POST /optimizer/quick-encode` | Saisie rapide (3 champs séparés) |
| | `POST /optimizer/pieces-encode` | Encodage des pièces (import IA, variantes) |
| | `POST /optimizer/pieces-summary` | Tableau des pièces : totaux, surfaces, poids |
| | `POST /optimizer/coil-encode` | Encodage d'une saisie bobine |
| | `POST /optimizer/coil-summary` | Tableau bobines : totaux |
| | `POST /optimizer/print-sheet` | Fiche de débit A4 |
| mobile | `POST /mobile/session`, `POST /mobile/upload`, `GET /mobile/status/{id}`, `POST /mobile/reset/{id}` | Envoi de photos depuis le téléphone (sessions en mémoire, 45 min) |
| ai | `POST /ai/parse-document`, `POST /ai/process-image` | Lecture de croquis (Gemini, avec repli) |
| admin | `GET /admin/status`, `POST /admin/setup`, `/login`, `/logout` | Accès administrateur |

## Organisation du code
```
backend/app/
├── main.py                 # application FastAPI, CORS, /api/health
├── core/constants.py       # matières, finitions, densités, bornes de développé, longueurs standard
├── core/admin_security.py  # mot de passe admin
├── models/                 # schémas Pydantic : pieces, pieces_summary, coils, optimizer, reference, mobile, ai, admin
├── services/               # calculs purs, sans dépendance web
│   ├── math_parser.py      # formules sans eval()
│   ├── encoder_engine.py   # saisie composite, bornes standard
│   ├── pieces_engine.py    # tableau des pièces
│   ├── coil_engine.py      # calculs bobines
│   ├── breakdown_engine.py # métrage automatique
│   ├── nesting_engine.py   # refente, séparation zinc / alu, chutes
│   ├── sheets_recap.py     # récap des feuilles mères, rendement
│   ├── reference_service.py# largeurs validées par matière
│   ├── sheet_generator.py  # fiche de débit
│   ├── session_store.py    # sessions mobiles (TTL 45 min)
│   ├── image_pipeline.py   # préparation des images
│   └── ai_ocr_service.py   # extraction Gemini
└── api/v1/endpoints/       # optimizer, mobile, ai, admin
backend/tests/              # 15 fichiers de tests (101 tests au dernier passage)
```

## Largeurs de bobines validées (atelier)
| Matière | Largeurs (mm) |
|---|---|
| Zinc (toutes finitions) | 600, 670, 750, 1000 |
| Alu RAL 9005 et RAL 7039 | 650, 1000 |
| Alu RAL 9010 et RAL 7016 | 1000 |
| Alu Brut 1.5 | 1000 |

Pour les changer : `services/reference_service.py` / `core/constants.py`, puis tests et publication.

## Vérifier et publier
```bash
cd /var/www/faconote
.venv/bin/pytest                         # tests
.venv/bin/mypy backend/app backend/tests # typage strict
bash tools/publier.sh                    # publication complète
```
`tools/publier.sh` (branche main, tout commité) enchaîne : pytest, mypy, contrôle du contrat
routes frontend/backend (`tools/check_contract.py`), garde « pas de calcul métier dans le frontend »,
tsc, sauvegarde de `frontend/dist`, build, redémarrage du service, contrôles en ligne, push GitHub.
`--sans-push` pour ne pas pousser. Il a besoin de sudo : à lancer depuis `ubuntu`.

Autres outils dans `tools/` : `set_admin_password.py`, `set_gemini_key.py`, `setup_tls.sh`, `stress_test.py`.

## Retour arrière
- Frontend : remettre la sauvegarde `frontend/dist.bak.<date>` créée par la publication.
- Backend : `git checkout <commit précédent>` puis `sudo systemctl restart faconote`.
