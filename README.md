# FacoNote

FacoNote est un outil web pour les ateliers de façonnage zinc et alu (toiture, bardage). On y encode les pièces d'une commande, il calcule les surfaces et les poids, prépare la refente des bobines et sort une fiche de débit à imprimer.

Il tourne sur [faconote.jokinesse.be](https://faconote.jokinesse.be).

## Encodage

Une pièce se saisit en trois champs : quantité, développé, longueur. Entrée ajoute la ligne, donc on peut enchaîner toute une commande au clavier. Les bobines ont leur propre écran, sur le même principe.

Pour un croquis papier, on peut aussi le prendre en photo avec un téléphone. FacoNote le lit avec Gemini et pré-remplit les pièces, qu'il reste à vérifier.

## Calculs et refente

FacoNote donne les surfaces, les poids et les totaux par matière et par finition, regroupés par bornes de développé. Il répartit ensuite les pièces sur les largeurs de bobines de l'atelier, zinc et alu séparés, et affiche les chutes et le rendement. Une calculette d'atelier qui accepte les formules est aussi intégrée.

Le résultat sort sur une fiche de débit A4, à imprimer ou à enregistrer en PDF.

## Envoi vers Dynamics 365

Le dossier `extension-d365` contient une extension Chrome et Edge. Elle reprend les longueurs par borne calculées dans FacoNote et les reporte dans la commande Dynamics 365 Finance & Operations, matière par matière, ce qui évite de tout ressaisir dans l'ERP.

## Matières et largeurs de bobines

| Matière | Largeurs (mm) |
|---|---|
| Zinc, toutes finitions | 600, 670, 750, 1000 |
| Alu RAL 9005 et RAL 7039 | 650, 1000 |
| Alu RAL 9010 et RAL 7016 | 1000 |
| Alu brut 1.5 | 1000 |

## Technique

L'interface est écrite en React et TypeScript, le serveur en Python avec FastAPI. Tous les calculs se font sur le serveur et sont couverts par des tests. Le détail est dans [backend/README.md](backend/README.md) et [frontend/README.md](frontend/README.md).
