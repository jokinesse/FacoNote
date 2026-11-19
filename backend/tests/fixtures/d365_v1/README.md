# Références du message v1 « pièces seules »

Message que le site envoie aujourd'hui à l'extension « Façonote → D365 » quand on clique
« Envoyer vers l'extension » avec des pièces seulement (version 1 du message).
Ces fichiers servent de référence : la nouvelle route doit produire exactement les mêmes groupes.

## Contenu d'un fichier

- `saisies` : ce qui a été tapé dans l'écran Calculateur (matière, développement en mm,
  quantité, longueur en m) et le n° de commande.
- `pieces_summary_request` : la requête envoyée à `/api/v1/optimizer/pieces-summary` au
  moment de l'envoi (les `id` sont tirés au hasard par le navigateur).
- `message_attendu` : le message exact envoyé par `window.postMessage`
  (`source: "faconote"`, `version: 1`, `type: "SEND"`). `requestId` et `sentAt` changent à
  chaque envoi : ils sont remplacés par `<variable>`.
- `statut_affiche` : le texte affiché sous la barre d'envoi.
- `envoi_refuse: true` : aucun message n'est parti (matière sans libellé D365).

## Cas

| Fichier | Cas |
|---|---|
| `01_une_matiere.json` | une matière (Zinc Quartz 0.7), plusieurs bornes, deux saisies dans la même borne |
| `02_trois_matieres.json` | Zinc ATZ 0.8, Alu RAL 9005 0.7, Zinc Naturel 0.7, bornes vides entre les bornes remplies |
| `03_alu_zinc_decimales.json` | Alu RAL 7016 0.7, Zinc ATZ 0.8, Alu RAL 9005 0.7, longueurs à décimales, borne 1100 |
| `04_pigmento_refuse.json` | Zinc Pigmento Rouge 0.8 sans libellé D365 : envoi refusé |

Toutes les données sont fictives.

## Comment elles ont été produites

- Code du commit `83435aa` (avant le chantier « commande commune »).
- Frontend construit avec `vite build`, backend lancé en local avec `uvicorn`, `/api` relayé
  vers ce backend. Aucun service en ligne utilisé.
- Navigateur Chromium piloté par Playwright, sans l'extension : un petit script dans la page
  enregistre le message `source: "faconote"` et répond `ACK` à la place de l'extension.
- Ordre des groupes : celui de `pieces-summary` (ordre alphabétique des matières), pas l'ordre
  de saisie. Chaque groupe contient toutes les bornes de `reference.piece_bounds_mm`, à 0 si vide.
- Les longueurs ne sont pas arrondies par le site : le cas 03 envoie `11.665` pour la borne 285.
