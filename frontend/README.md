# FacoNote — Frontend

Mis à jour le 31/10/2026, état du code : commit `618f642` (main, déployé).

## Règle principale
**Le frontend ne calcule rien.** Il garde la liste des saisies de la session, envoie les données
à l'API (`/api/v1/...`) et affiche les résultats. Les anciens moteurs de calcul du navigateur
(`utils/optimizer.ts`, `utils/sheetLogic.ts`, `mockStock.ts`) ont été supprimés le 30/10/2026.
`tools/publier.sh` refuse de publier si un calcul métier réapparaît dans le frontend.
Exceptions autorisées : la calculette d'atelier (`utils/mathEvaluator.ts`) et le Stress Lab (`utils/stressEngine.ts`).

## Technique
- React 19, TypeScript, Vite, Tailwind CSS 4.
- Code : `/var/www/faconote/frontend`, compilé dans `frontend/dist` (servi par nginx).
- Les largeurs de bobines et les matières viennent de `GET /api/v1/optimizer/reference` : jamais codées en dur.

## Organisation du code
```
frontend/src/
├── App.tsx, main.tsx, index.css, types.ts
├── api/                        # appels à l'API, un fichier par groupe
│   ├── client.ts, index.ts, types.ts, adapters.ts
│   ├── optimizerApi.ts         # encode, summary, calculate, auto-breakdown, print-sheet
│   ├── reference.ts            # matières et largeurs validées
│   ├── mobileApi.ts, aiApi.ts, adminApi.ts
├── components/
│   ├── FastEncoder.tsx         # calculateur de pièces (saisie rapide au clavier)
│   ├── CoilCalculator.tsx      # calculateur bobines
│   ├── OptimizerTab.tsx        # optimiseur : métrage auto, récap feuilles mères, totaux
│   ├── CuttingPlan2D.tsx       # plan de découpe
│   ├── WorkshopCalculator.tsx  # calculette d'atelier
│   ├── WorkshopPrintModal.tsx  # impression fiche de débit
│   ├── VisualPreEncoderModal.tsx, MobileScannerApp.tsx  # import photo / IA
│   ├── AdminAuthModal.tsx, Header.tsx, StressLab.tsx
└── utils/                      # mathEvaluator, stressEngine, imageOptimizer, textCleaner (aucun calcul métier)
```

## Saisie
- Pièces : 3 champs séparés (quantité, développé, longueur). Entrée sur « Longueur » ajoute la ligne.
- Bobines : même logique ; le champ largeur est vidé après chaque saisie ; les messages d'erreur nomment la case fautive.

## Exigences d'interface (inchangées)
- Indicateur de chargement pendant les requêtes, erreurs 422/500 affichées clairement.
- Lisible sur tablette et PC d'atelier, contraste élevé.
- Pas de bibliothèque lourde si du code natif suffit.

## Développement local
```bash
npm install
npm run dev      # serveur de développement Vite
npm run build    # compilation dans dist/
node node_modules/typescript/bin/tsc --noEmit   # vérification du typage
```

## Publier en production
Ne pas compiler à la main sur le serveur : passer par `bash /var/www/faconote/tools/publier.sh`
(tests, garde « pas de calcul dans le frontend », build, redémarrage, contrôles, push). Voir `backend/README.md`.
