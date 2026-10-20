# Spécifications pour la Refonte du Frontend (FacoNote)

## 1. Objectif
Moderniser, fiabiliser et rendre présentable l'interface frontend d'origine (reprise de `legacy/`), en la connectant directement aux endpoints de l'API backend FastAPI récemment développée.

## 2. Contrats & Appels API
- Tous les formulaires doivent consommer les endpoints de l'API FastAPI (`/api/...`).
- Gestion rigoureuse des états réseau :
  - Indicateurs de chargement (spinners/loaders) pendant les requêtes.
  - Gestion explicite des erreurs HTTP (422 validation, 500 serveur) avec messages clairs pour l'opérateur d'atelier.
  - Typage et validation côté client avant soumission.

## 3. Ergonomie & Présentation (Usage Atelier)
- Design moderne, propre et épuré (ex: Tailwind CSS ou CSS moderne structuré).
- Contraste élevé et lisibilité immédiate des résultats clés (pertes, découpes, tôles mères).
- Rendu visuel soigné du plan de calepinage 2D (Canvas / SVG fluide et réactif).
- Adaptabilité écran : utilisable facilement sur tablette ou PC d'atelier.

## 4. Règle d'Exécution
- Ne pas introduire de bibliothèques lourdes inutiles si du JS moderne/Canvas natif suffit.
- Conserver la logique métier validée du backend : le frontend ne fait aucun calcul mathématique de découpe, il envoie les paramètres à l'API et affiche les résultats retournés.