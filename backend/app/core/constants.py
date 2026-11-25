"""
Constantes physiques et industrielles standardisées de Facozinc.
Spécification technique : Section 1.1 & 1.2 du Cahier des Charges & Catalogue Usine.
"""

import re
from typing import Final, NamedTuple


class MaterialSpec(NamedTuple):
    name: str
    metal_type: str  # ZINC, ALUMINIUM, CUIVRE, PLOMB
    finish: str
    thickness_mm: float
    volumetric_density_kg_m3: float
    surface_density_kg_m2: float
    standard_mother_widths_mm: tuple[int, ...]


# Finitions normalisées
ZINC_FINISHES: Final[tuple[str, ...]] = (
    "Naturel",
    "ATZ",
    "Quartz",
    "Pigmento Rouge",
    "Perforée",
)

ALU_FINISHES: Final[tuple[str, ...]] = (
    "RAL 7016",
    "RAL 9005",
    "RAL 9010",
    "RAL 7039",
    "1.5 Brut",
)

# Liste officielle stricte des matières et finitions Facozinc
OFFICIAL_MATERIALS: Final[tuple[str, ...]] = (
    # Alu épaisseur 0,7
    "Alu RAL 7016 0.7",
    "Alu RAL 9005 0.7",
    "Alu RAL 9010 0.7",
    "Alu RAL 7039 0.7",
    # Alu épaisseur 1.5
    "Alu 1.5 Brut",
    # Zinc épaisseur 0.7
    "Zinc Naturel 0.7",
    "Zinc ATZ 0.7",
    "Zinc Quartz 0.7",
    # Zinc épaisseur 0.8
    "Zinc Naturel 0.8",
    "Zinc ATZ 0.8",
    "Zinc Quartz 0.8",
    "Zinc Pigmento Rouge 0.8",
    # Zinc épaisseur 1
    "Zinc Perforée 1.0",
)

# Libellé du champ « Matières » dans Dynamics 365 F&O (formulaire de commande client),
# donné par l'atelier le 05/11/2026. Matière absente = pas encore connue : l'envoi vers D365 est refusé.
D365_MATIERE_LABELS: Final[dict[str, str]] = {
    "Zinc Naturel 0.7": "ZN",
    "Zinc Naturel 0.8": "ZN",
    "Zinc ATZ 0.7": "ATZ",
    "Zinc ATZ 0.8": "ATZ",
    "Zinc Quartz 0.7": "QZ",
    "Zinc Quartz 0.8": "QZ",
    "Alu RAL 7016 0.7": "ALU 7016",
    "Alu RAL 9010 0.7": "ALU 9010",
    "Alu RAL 9005 0.7": "ALU PREFA 03 NOIR P10",
    "Alu RAL 7039 0.7": "ALU PREFA 47 PATINA GRAU",
    "Alu 1.5 Brut": "ALU BRUT",
}

# Codes article des bobines dans D365 (grille Nomenclature), donnés par l'atelier
# les 18 et 19/11/2026. Matière officielle -> largeur (mm) -> code, au format D365
# (« AR » + 8 chiffres). Zinc Naturel 0.7 : fournisseur EN pour la 1000, VM pour les
# autres largeurs ; Zinc Naturel 0.8 : VM partout. Matière ou largeur absente = pas de
# code : la bobine n'est pas envoyée vers D365 (avertissement).
D365_COIL_ARTICLES: Final[dict[str, dict[int, str]]] = {
    "Zinc Naturel 0.7": {1000: "AR00002875", 750: "AR00002891", 670: "AR00002896", 600: "AR00002904"},
    "Zinc Naturel 0.8": {
        1100: "AR00002869", 1000: "AR00002872", 750: "AR00021070", 670: "AR00002894", 600: "AR00043248",
    },
    "Zinc ATZ 0.7": {1000: "AR00002954", 750: "AR00002957", 670: "AR00002959", 600: "AR00002961"},
    "Zinc ATZ 0.8": {1000: "AR00002953", 750: "AR00002956", 670: "AR00002958", 600: "AR00002960"},
    "Zinc Quartz 0.7": {1000: "AR00002987", 750: "AR00002991", 670: "AR00002993", 600: "AR00002995"},
    "Zinc Quartz 0.8": {1000: "AR00002986", 750: "AR00002990", 670: "AR00002992", 600: "AR00002994"},
    "Alu RAL 9005 0.7": {1000: "AR00112154", 650: "AR00106474"},
    "Alu RAL 7039 0.7": {1000: "AR00120013", 650: "AR00131334"},
    "Alu RAL 7016 0.7": {1000: "AR00102719"},
    "Alu RAL 9010 0.7": {1000: "AR00112108"},
}

# Quantité maximale d'une ligne de la grille Nomenclature (bobine ou chute), en mètres.
# Même plafond que l'extension : au-delà, l'envoi est refusé.
D365_MAX_QUANTITY_M: Final[float] = 100000.0

# Matières comptées en feuilles dans D365 (pas de bobine) : gardé pour mémoire, jamais envoyé.
D365_SHEET_ARTICLES: Final[dict[str, str]] = {"Zinc Perforée 1.0": "AR00089875"}

# Lignes de la grille Nomenclature qui ne sont pas des bobines
D365_CHUTE_ARTICLE: Final[str] = "CHUTE"
D365_IGNORED_ARTICLES: Final[tuple[str, ...]] = ("TEMPS_PROD",)

_AR_CODE_RE: Final[re.Pattern[str]] = re.compile(r"^AR-?(\d{1,8})$")


def normalize_ar_code(text: str) -> str | None:
    """Code article au format D365 (« AR-2953 » -> « AR00002953 ») ; None si ce n'est pas un code AR."""
    match = _AR_CODE_RE.match("".join(text.split()).upper())
    if match is None:
        return None
    return "AR" + match.group(1).zfill(8)


def d365_coil_article(material: str, width_mm: int) -> str | None:
    """Code article D365 d'une bobine (matière officielle, largeur en mm) ; None si pas de code."""
    return D365_COIL_ARTICLES.get(material, {}).get(width_mm)


def d365_epaisseur_label(thickness_mm: float) -> str:
    """Libellé du champ « Epaisseur » dans D365 (ex : 0.7 -> « 0.7 mm »)."""
    return f"{thickness_mm:.1f} mm"


# Table officielle des densités volumétriques
VOLUMETRIC_DENSITIES: Final[dict[str, float]] = {
    "ZINC": 7200.0,
    "ALUMINIUM": 2700.0,
    "CUIVRE": 8960.0,
    "PLOMB": 11340.0,
}

# Table exhaustive des nuances et matériaux standardisés Facozinc
STANDARDIZED_MATERIALS: Final[dict[str, MaterialSpec]] = {
    # --- ZINC 0.70 mm (5.04 kg/m²) ---
    "Zinc Naturel 0.7": MaterialSpec(
        name="Zinc Naturel 0.7",
        metal_type="ZINC",
        finish="Naturel",
        thickness_mm=0.70,
        volumetric_density_kg_m3=7200.0,
        surface_density_kg_m2=5.04,
        standard_mother_widths_mm=(600, 670, 750, 1000),
    ),
    "Zinc ATZ 0.7": MaterialSpec(
        name="Zinc ATZ 0.7",
        metal_type="ZINC",
        finish="ATZ",
        thickness_mm=0.70,
        volumetric_density_kg_m3=7200.0,
        surface_density_kg_m2=5.04,
        standard_mother_widths_mm=(600, 670, 750, 1000),
    ),
    "Zinc Noir ATZ 0.7": MaterialSpec(
        name="Zinc ATZ 0.7",
        metal_type="ZINC",
        finish="ATZ",
        thickness_mm=0.70,
        volumetric_density_kg_m3=7200.0,
        surface_density_kg_m2=5.04,
        standard_mother_widths_mm=(600, 670, 750, 1000),
    ),
    "Zinc Quartz 0.7": MaterialSpec(
        name="Zinc Quartz 0.7",
        metal_type="ZINC",
        finish="Quartz",
        thickness_mm=0.70,
        volumetric_density_kg_m3=7200.0,
        surface_density_kg_m2=5.04,
        standard_mother_widths_mm=(600, 670, 750, 1000),
    ),

    # --- ZINC 0.80 mm (5.76 kg/m²) ---
    "Zinc Naturel 0.8": MaterialSpec(
        name="Zinc Naturel 0.8",
        metal_type="ZINC",
        finish="Naturel",
        thickness_mm=0.80,
        volumetric_density_kg_m3=7200.0,
        surface_density_kg_m2=5.76,
        # 1100 : seulement en Zinc Naturel 0.8 (seule bobine 1100 dans D365, atelier 19/11/2026)
        standard_mother_widths_mm=(600, 670, 750, 1000, 1100),
    ),
    "Zinc ATZ 0.8": MaterialSpec(
        name="Zinc ATZ 0.8",
        metal_type="ZINC",
        finish="ATZ",
        thickness_mm=0.80,
        volumetric_density_kg_m3=7200.0,
        surface_density_kg_m2=5.76,
        standard_mother_widths_mm=(600, 670, 750, 1000),
    ),
    "Zinc Noir ATZ 0.8": MaterialSpec(
        name="Zinc ATZ 0.8",
        metal_type="ZINC",
        finish="ATZ",
        thickness_mm=0.80,
        volumetric_density_kg_m3=7200.0,
        surface_density_kg_m2=5.76,
        standard_mother_widths_mm=(600, 670, 750, 1000),
    ),
    "Zinc Quartz 0.8": MaterialSpec(
        name="Zinc Quartz 0.8",
        metal_type="ZINC",
        finish="Quartz",
        thickness_mm=0.80,
        volumetric_density_kg_m3=7200.0,
        surface_density_kg_m2=5.76,
        standard_mother_widths_mm=(600, 670, 750, 1000),
    ),
    "Zinc Pigmento Rouge 0.8": MaterialSpec(
        name="Zinc Pigmento Rouge 0.8",
        metal_type="ZINC",
        finish="Pigmento Rouge",
        thickness_mm=0.80,
        volumetric_density_kg_m3=7200.0,
        surface_density_kg_m2=5.76,
        standard_mother_widths_mm=(670, 1000),
    ),

    # --- ZINC 1.00 mm (7.20 kg/m²) ---
    "Zinc Perforée 1.0": MaterialSpec(
        name="Zinc Perforée 1.0",
        metal_type="ZINC",
        finish="Perforée",
        thickness_mm=1.00,
        volumetric_density_kg_m3=7200.0,
        surface_density_kg_m2=7.20,
        standard_mother_widths_mm=(1000,),  # Perforée : feuilles de 1000 uniquement
    ),
    "Zinc Perforée 1": MaterialSpec(
        name="Zinc Perforée 1.0",
        metal_type="ZINC",
        finish="Perforée",
        thickness_mm=1.00,
        volumetric_density_kg_m3=7200.0,
        surface_density_kg_m2=7.20,
        standard_mother_widths_mm=(1000,),  # Perforée : feuilles de 1000 uniquement
    ),
    "Zinc Perforée 0.7": MaterialSpec(
        name="Zinc Perforée 1.0",
        metal_type="ZINC",
        finish="Perforée",
        thickness_mm=1.00,
        volumetric_density_kg_m3=7200.0,
        surface_density_kg_m2=7.20,
        standard_mother_widths_mm=(1000,),  # Perforée : feuilles de 1000 uniquement
    ),
    "Zinc Perforée 0.8": MaterialSpec(
        name="Zinc Perforée 1.0",
        metal_type="ZINC",
        finish="Perforée",
        thickness_mm=1.00,
        volumetric_density_kg_m3=7200.0,
        surface_density_kg_m2=7.20,
        standard_mother_widths_mm=(1000,),  # Perforée : feuilles de 1000 uniquement
    ),
    "Zinc Pigmento Rouge 0.7": MaterialSpec(
        name="Zinc Pigmento Rouge 0.8",
        metal_type="ZINC",
        finish="Pigmento Rouge",
        thickness_mm=0.80,
        volumetric_density_kg_m3=7200.0,
        surface_density_kg_m2=5.76,
        standard_mother_widths_mm=(670, 1000),
    ),

    # --- ALUMINIUM LAQUÉ (0.70 mm -> 1.89 kg/m²) ---
    "Alu RAL 7016 0.7": MaterialSpec(
        name="Alu RAL 7016 0.7",
        metal_type="ALUMINIUM",
        finish="RAL 7016",
        thickness_mm=0.70,
        volumetric_density_kg_m3=2700.0,
        surface_density_kg_m2=1.89,
        standard_mother_widths_mm=(1000,),
    ),
    "Alu 7016 gris bleu 0.7": MaterialSpec(
        name="Alu RAL 7016 0.7",
        metal_type="ALUMINIUM",
        finish="RAL 7016",
        thickness_mm=0.70,
        volumetric_density_kg_m3=2700.0,
        surface_density_kg_m2=1.89,
        standard_mother_widths_mm=(1000,),
    ),
    "Alu 7016 gris bleu": MaterialSpec(
        name="Alu RAL 7016 0.7",
        metal_type="ALUMINIUM",
        finish="RAL 7016",
        thickness_mm=0.70,
        volumetric_density_kg_m3=2700.0,
        surface_density_kg_m2=1.89,
        standard_mother_widths_mm=(1000,),
    ),
    "Alu 7016 gris bleu 0.8": MaterialSpec(
        name="Alu RAL 7016 0.7",
        metal_type="ALUMINIUM",
        finish="RAL 7016",
        thickness_mm=0.70,
        volumetric_density_kg_m3=2700.0,
        surface_density_kg_m2=1.89,
        standard_mother_widths_mm=(1000,),
    ),

    "Alu RAL 9005 0.7": MaterialSpec(
        name="Alu RAL 9005 0.7",
        metal_type="ALUMINIUM",
        finish="RAL 9005",
        thickness_mm=0.70,
        volumetric_density_kg_m3=2700.0,
        surface_density_kg_m2=1.89,
        standard_mother_widths_mm=(650, 1000),
    ),
    "Alu 9005 Noir texturé 0.7": MaterialSpec(
        name="Alu RAL 9005 0.7",
        metal_type="ALUMINIUM",
        finish="RAL 9005",
        thickness_mm=0.70,
        volumetric_density_kg_m3=2700.0,
        surface_density_kg_m2=1.89,
        standard_mother_widths_mm=(650, 1000),
    ),
    "Alu 9005 Noir texturé": MaterialSpec(
        name="Alu RAL 9005 0.7",
        metal_type="ALUMINIUM",
        finish="RAL 9005",
        thickness_mm=0.70,
        volumetric_density_kg_m3=2700.0,
        surface_density_kg_m2=1.89,
        standard_mother_widths_mm=(650, 1000),
    ),
    "Alu 9005 Noir texturé 0.8": MaterialSpec(
        name="Alu RAL 9005 0.7",
        metal_type="ALUMINIUM",
        finish="RAL 9005",
        thickness_mm=0.70,
        volumetric_density_kg_m3=2700.0,
        surface_density_kg_m2=1.89,
        standard_mother_widths_mm=(650, 1000),
    ),

    "Alu RAL 9010 0.7": MaterialSpec(
        name="Alu RAL 9010 0.7",
        metal_type="ALUMINIUM",
        finish="RAL 9010",
        thickness_mm=0.70,
        volumetric_density_kg_m3=2700.0,
        surface_density_kg_m2=1.89,
        standard_mother_widths_mm=(1000,),
    ),
    "Alu 9010 Blanc 0.7": MaterialSpec(
        name="Alu RAL 9010 0.7",
        metal_type="ALUMINIUM",
        finish="RAL 9010",
        thickness_mm=0.70,
        volumetric_density_kg_m3=2700.0,
        surface_density_kg_m2=1.89,
        standard_mother_widths_mm=(1000,),
    ),
    "Alu 9010 Blanc": MaterialSpec(
        name="Alu RAL 9010 0.7",
        metal_type="ALUMINIUM",
        finish="RAL 9010",
        thickness_mm=0.70,
        volumetric_density_kg_m3=2700.0,
        surface_density_kg_m2=1.89,
        standard_mother_widths_mm=(1000,),
    ),
    "Alu 9010 Blanc 0.8": MaterialSpec(
        name="Alu RAL 9010 0.7",
        metal_type="ALUMINIUM",
        finish="RAL 9010",
        thickness_mm=0.70,
        volumetric_density_kg_m3=2700.0,
        surface_density_kg_m2=1.89,
        standard_mother_widths_mm=(1000,),
    ),

    "Alu RAL 7039 0.7": MaterialSpec(
        name="Alu RAL 7039 0.7",
        metal_type="ALUMINIUM",
        finish="RAL 7039",
        thickness_mm=0.70,
        volumetric_density_kg_m3=2700.0,
        surface_density_kg_m2=1.89,
        standard_mother_widths_mm=(650, 1000),
    ),
    "Alu Quartz 0.7": MaterialSpec(
        name="Alu RAL 7039 0.7",
        metal_type="ALUMINIUM",
        finish="RAL 7039",
        thickness_mm=0.70,
        volumetric_density_kg_m3=2700.0,
        surface_density_kg_m2=1.89,
        standard_mother_widths_mm=(650, 1000),
    ),
    "Alu Quartz": MaterialSpec(
        name="Alu RAL 7039 0.7",
        metal_type="ALUMINIUM",
        finish="RAL 7039",
        thickness_mm=0.70,
        volumetric_density_kg_m3=2700.0,
        surface_density_kg_m2=1.89,
        standard_mother_widths_mm=(650, 1000),
    ),
    "Alu Quartz 0.8": MaterialSpec(
        name="Alu RAL 7039 0.7",
        metal_type="ALUMINIUM",
        finish="RAL 7039",
        thickness_mm=0.70,
        volumetric_density_kg_m3=2700.0,
        surface_density_kg_m2=1.89,
        standard_mother_widths_mm=(650, 1000),
    ),

    # --- ALUMINIUM 1.5 BRUT (4.05 kg/m²) ---
    "Alu 1.5 Brut": MaterialSpec(
        name="Alu 1.5 Brut",
        metal_type="ALUMINIUM",
        finish="1.5 Brut",
        thickness_mm=1.50,
        volumetric_density_kg_m3=2700.0,
        surface_density_kg_m2=4.05,
        standard_mother_widths_mm=(1000,),
    ),

    # --- MÉTAUX HISTORIQUES (REPLI UNIQUEMENT) ---
    "Cuivre 0.60": MaterialSpec(
        name="Cuivre 0.60mm",
        metal_type="CUIVRE",
        finish="Naturel",
        thickness_mm=0.60,
        volumetric_density_kg_m3=8960.0,
        surface_density_kg_m2=5.38,
        standard_mother_widths_mm=(600, 670, 1000),
    ),
    "Plomb 1.25": MaterialSpec(
        name="Plomb 1.25mm",
        metal_type="PLOMB",
        finish="Naturel",
        thickness_mm=1.25,
        volumetric_density_kg_m3=11340.0,
        surface_density_kg_m2=14.18,
        standard_mother_widths_mm=(1000,),
    ),
}

# 1.2 Bornes industrielles de refente standard
# 19 bornes DEV PIÈCE
DEV_PIECE_BOUNDS: Final[tuple[int, ...]] = (
    100, 120, 150, 175, 187, 200, 250, 285, 300, 333, 375, 400, 450, 500, 600, 670, 750, 1000, 1100
)

# Grille DEV BOBINE (formats mères purs) : toutes les largeurs de bobine des matières officielles.
# Calculée depuis la table des matières pour n'avoir qu'une seule liste à tenir à jour.
DEV_BOBINE_BOUNDS: Final[tuple[int, ...]] = tuple(
    sorted({w for name in OFFICIAL_MATERIALS for w in STANDARDIZED_MATERIALS[name].standard_mother_widths_mm})
)

# Largeurs de chutes de rack pré-coupées prêtes au réemploi
RACK_SCRAP_WIDTHS: Final[tuple[int, ...]] = (
    100, 120, 150, 200, 250
)

# Longueur maximale d'une feuille sortie de bobine (atelier, 02/11/2026).
# Une pièce plus longue est coupée en parts égales de 6 m maximum.
MAX_SHEET_LENGTH_M: Final[float] = 6.0

# Longueurs standards de plieuse et formats machine
STANDARD_FOLDING_LENGTHS: Final[tuple[float, ...]] = (
    2.0, 2.5, 3.0, 4.0
)

# Formats secondaires testés en atelier
ALL_STANDARD_LENGTHS: Final[tuple[float, ...]] = (
    2.0, 2.5, 3.0, 4.0, 1.5, 2.2, 2.3, 2.4, 2.6, 2.8, 3.2, 3.5
)


def resolve_material_spec(material_name: str) -> MaterialSpec:
    """
    Résout la nuance de métal exacte selon le libellé utilisateur ou atelier.
    Conforme à la liste stricte Facozinc :
    - Alu 0.7 (RAL 7016, RAL 9005, RAL 9010, RAL 7039)
    - Alu 1.5 Brut
    - Zinc 0.7 (Naturel, ATZ, Quartz)
    - Zinc 0.8 (Naturel, ATZ, Quartz, Pigmento Rouge)
    - Zinc 1.0 (Perforée)
    """
    clean = material_name.lower().strip()

    # 1.5 Brut Aluminium
    if ("1.5" in clean and "brut" in clean) or ("brut" in clean and "alu" in clean) or clean == "brut" or clean == "1.5 brut":
        return STANDARDIZED_MATERIALS["Alu 1.5 Brut"]

    # Zinc Perforée (épaisseur 1)
    if "perfor" in clean:
        return STANDARDIZED_MATERIALS["Zinc Perforée 1.0"]

    # Alu 0.7 RAL
    if "7016" in clean or "gris bleu" in clean:
        return STANDARDIZED_MATERIALS["Alu RAL 7016 0.7"]
    if "9005" in clean or (("noir" in clean or "textur" in clean) and "alu" in clean):
        return STANDARDIZED_MATERIALS["Alu RAL 9005 0.7"]
    if "9010" in clean or ("blanc" in clean and "alu" in clean):
        return STANDARDIZED_MATERIALS["Alu RAL 9010 0.7"]
    if "7039" in clean:
        return STANDARDIZED_MATERIALS["Alu RAL 7039 0.7"]

    # Zinc Pigmento Rouge (épaisseur 0.8)
    if "pigment" in clean or "rouge" in clean:
        return STANDARDIZED_MATERIALS["Zinc Pigmento Rouge 0.8"]

    # Détection épaisseur Zinc (0.8 vs 0.7)
    is_08 = "0.8" in clean or "0,8" in clean
    thick = "0.8" if is_08 else "0.7"

    # Quartz (Zinc ou Alu si précisé)
    if "quarz" in clean or "quartz" in clean or "quatz" in clean or "qz" in clean:
        if "alu" in clean:
            return STANDARDIZED_MATERIALS["Alu RAL 7039 0.7"]
        return STANDARDIZED_MATERIALS[f"Zinc Quartz {thick}"]

    # ATZ Zinc
    if "atz" in clean or "anthra" in clean or ("noir" in clean and "zinc" in clean):
        return STANDARDIZED_MATERIALS[f"Zinc ATZ {thick}"]

    # Zinc Naturel
    if "naturel" in clean or "nat" in clean:
        return STANDARDIZED_MATERIALS[f"Zinc Naturel {thick}"]

    # Cuivre & Plomb (historique)
    if "cuivre" in clean:
        return STANDARDIZED_MATERIALS["Cuivre 0.60"]
    if "plomb" in clean:
        return STANDARDIZED_MATERIALS["Plomb 1.25"]

    # Si explicitement Alu sans code
    if "alu" in clean or "aluminium" in clean:
        return STANDARDIZED_MATERIALS["Alu RAL 7016 0.7"]

    # Repli par défaut
    return STANDARDIZED_MATERIALS[f"Zinc Naturel {thick}"]


def calculate_weight_kg(dev_mm: float, length_m: float, surface_density_kg_m2: float) -> float:
    """
    Calcule la masse exacte selon la relation surfacique :
    Poids (kg) = (Développé en mm / 1000) * Longueur (m) * Densité surfacique (kg/m²)
    Arrondi obligatoire à 2 décimales.
    """
    weight = (dev_mm / 1000.0) * length_m * surface_density_kg_m2
    return round(weight, 2)


def calculate_surface_m2(dev_mm: float, length_m: float) -> float:
    """
    Calcule la surface géométrique :
    Surface (m²) = (Développé en mm / 1000) * Longueur (m)
    Arrondi obligatoire à 2 décimales.
    """
    surface = (dev_mm / 1000.0) * length_m
    return round(surface, 2)


def round_meters(length_m: float) -> float:
    """
    Arrondi déterministe pour les métrages : 3 décimales.
    """
    return round(length_m, 3)
