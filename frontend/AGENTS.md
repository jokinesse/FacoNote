# Instructions du Projet de Refonte

## Objectif
Refondre l'application de calcul de calepinage et gestion des tôles/pièces pour façonneurs en Python, en suivant scrupuleusement les spécifications du document `specifications.pdf`.

## Contraintes Techniques
- Langage : Python 3.12 ou + avec typage strict (mypy / type hints).
- Framework API : FastAPI avec schémas Pydantic pour chaque requête/réponse.
- Tests : Pytest pour valider tous les calculs mathématiques et algorithmes de découpe.
- Architecture : Séparer strictement le moteur mathématique (services/calculs) des routes HTTP (routers).

## Méthodologie de travail
Ne génère pas l'application complète d'un coup. Procède par phases modulaires validées étape par étape.