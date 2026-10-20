"""
Constantes physiques et industrielles standardisées de Facozinc.
Spécification technique : Section 1.1 & 1.2 du Cahier des Charges & Catalogue Usine.
"""

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
    "Noir ATZ",
    "Quartz",
    "Pigmento Rouge",
    "Perforée",
)

ALU_FINISHES: Final[tuple[str, ...]] = (
    "7016 gris bleu",
    "9005 Noir texturé",
    "9010 Blanc",
    "Quartz",
    "1.5 Brut",
)

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
        standard_mother_widths_mm=(600, 650, 670, 750, 1000, 1100),
    ),
    "Zinc Noir ATZ 0.7": MaterialSpec(
        name="Zinc Noir ATZ 0.7",
        metal_type="ZINC",
        finish="Noir ATZ",
        thickness_mm=0.70,
        volumetric_density_kg_m3=7200.0,
        surface_density_kg_m2=5.04,
        standard_mother_widths_mm=(600, 650, 670, 750, 1000, 1100),
    ),
    "Zinc Quartz 0.7": MaterialSpec(
        name="Zinc Quartz 0.7",
        metal_type="ZINC",
        finish="Quartz",
        thickness_mm=0.70,
        volumetric_density_kg_m3=7200.0,
        surface_density_kg_m2=5.04,
        standard_mother_widths_mm=(600, 650, 670, 750, 1000, 1100),
    ),
    "Zinc Pigmento Rouge 0.7": MaterialSpec(
        name="Zinc Pigmento Rouge 0.7",
        metal_type="ZINC",
        finish="Pigmento Rouge",
        thickness_mm=0.70,
        volumetric_density_kg_m3=7200.0,
        surface_density_kg_m2=5.04,
        standard_mother_widths_mm=(600, 650, 670, 750, 1000, 1100),
    ),
    "Zinc Perforée 0.7": MaterialSpec(
        name="Zinc Perforée 0.7",
        metal_type="ZINC",
        finish="Perforée",
        thickness_mm=0.70,
        volumetric_density_kg_m3=7200.0,
        surface_density_kg_m2=5.04,
        standard_mother_widths_mm=(600, 650, 670, 750, 1000, 1100),
    ),

    # --- ZINC 0.80 mm (5.76 kg/m²) ---
    "Zinc Naturel 0.8": MaterialSpec(
        name="Zinc Naturel 0.8",
        metal_type="ZINC",
        finish="Naturel",
        thickness_mm=0.80,
        volumetric_density_kg_m3=7200.0,
        surface_density_kg_m2=5.76,
        standard_mother_widths_mm=(600, 650, 670, 750, 1000, 1100),
    ),
    "Zinc Noir ATZ 0.8": MaterialSpec(
        name="Zinc Noir ATZ 0.8",
        metal_type="ZINC",
        finish="Noir ATZ",
        thickness_mm=0.80,
        volumetric_density_kg_m3=7200.0,
        surface_density_kg_m2=5.76,
        standard_mother_widths_mm=(600, 650, 670, 750, 1000, 1100),
    ),
    "Zinc Quartz 0.8": MaterialSpec(
        name="Zinc Quartz 0.8",
        metal_type="ZINC",
        finish="Quartz",
        thickness_mm=0.80,
        volumetric_density_kg_m3=7200.0,
        surface_density_kg_m2=5.76,
        standard_mother_widths_mm=(600, 650, 670, 750, 1000, 1100),
    ),
    "Zinc Pigmento Rouge 0.8": MaterialSpec(
        name="Zinc Pigmento Rouge 0.8",
        metal_type="ZINC",
        finish="Pigmento Rouge",
        thickness_mm=0.80,
        volumetric_density_kg_m3=7200.0,
        surface_density_kg_m2=5.76,
        standard_mother_widths_mm=(600, 650, 670, 750, 1000, 1100),
    ),
    "Zinc Perforée 0.8": MaterialSpec(
        name="Zinc Perforée 0.8",
        metal_type="ZINC",
        finish="Perforée",
        thickness_mm=0.80,
        volumetric_density_kg_m3=7200.0,
        surface_density_kg_m2=5.76,
        standard_mother_widths_mm=(600, 650, 670, 750, 1000, 1100),
    ),

    # --- ALUMINIUM LAQUÉ & BRUT ---
    # Alu 1.5 Brut (4.05 kg/m²)
    "Alu 1.5 Brut": MaterialSpec(
        name="Alu 1.5 Brut",
        metal_type="ALUMINIUM",
        finish="1.5 Brut",
        thickness_mm=1.50,
        volumetric_density_kg_m3=2700.0,
        surface_density_kg_m2=4.05,
        standard_mother_widths_mm=(1000, 1250, 1500),
    ),
    # 7016 gris bleu (0.70 mm standard -> 1.89 kg/m²)
    "Alu 7016 gris bleu": MaterialSpec(
        name="Alu 7016 gris bleu 0.7",
        metal_type="ALUMINIUM",
        finish="7016 gris bleu",
        thickness_mm=0.70,
        volumetric_density_kg_m3=2700.0,
        surface_density_kg_m2=1.89,
        standard_mother_widths_mm=(500, 600, 650, 750, 1000, 1250),
    ),
    "Alu 7016 gris bleu 0.7": MaterialSpec(
        name="Alu 7016 gris bleu 0.7",
        metal_type="ALUMINIUM",
        finish="7016 gris bleu",
        thickness_mm=0.70,
        volumetric_density_kg_m3=2700.0,
        surface_density_kg_m2=1.89,
        standard_mother_widths_mm=(500, 600, 650, 750, 1000, 1250),
    ),
    "Alu 7016 gris bleu 0.8": MaterialSpec(
        name="Alu 7016 gris bleu 0.8",
        metal_type="ALUMINIUM",
        finish="7016 gris bleu",
        thickness_mm=0.80,
        volumetric_density_kg_m3=2700.0,
        surface_density_kg_m2=2.16,
        standard_mother_widths_mm=(500, 600, 650, 750, 1000, 1250),
    ),
    # 9005 Noir texturé (0.70 mm standard -> 1.89 kg/m², laizes 650 et 1000)
    "Alu 9005 Noir texturé": MaterialSpec(
        name="Alu 9005 Noir texturé 0.7",
        metal_type="ALUMINIUM",
        finish="9005 Noir texturé",
        thickness_mm=0.70,
        volumetric_density_kg_m3=2700.0,
        surface_density_kg_m2=1.89,
        standard_mother_widths_mm=(650, 1000),
    ),
    "Alu 9005 Noir texturé 0.7": MaterialSpec(
        name="Alu 9005 Noir texturé 0.7",
        metal_type="ALUMINIUM",
        finish="9005 Noir texturé",
        thickness_mm=0.70,
        volumetric_density_kg_m3=2700.0,
        surface_density_kg_m2=1.89,
        standard_mother_widths_mm=(650, 1000),
    ),
    "Alu 9005 Noir texturé 0.8": MaterialSpec(
        name="Alu 9005 Noir texturé 0.8",
        metal_type="ALUMINIUM",
        finish="9005 Noir texturé",
        thickness_mm=0.80,
        volumetric_density_kg_m3=2700.0,
        surface_density_kg_m2=2.16,
        standard_mother_widths_mm=(650, 1000),
    ),
    # 9010 Blanc (0.70 mm standard -> 1.89 kg/m²)
    "Alu 9010 Blanc": MaterialSpec(
        name="Alu 9010 Blanc 0.7",
        metal_type="ALUMINIUM",
        finish="9010 Blanc",
        thickness_mm=0.70,
        volumetric_density_kg_m3=2700.0,
        surface_density_kg_m2=1.89,
        standard_mother_widths_mm=(650, 1000, 1250),
    ),
    "Alu 9010 Blanc 0.7": MaterialSpec(
        name="Alu 9010 Blanc 0.7",
        metal_type="ALUMINIUM",
        finish="9010 Blanc",
        thickness_mm=0.70,
        volumetric_density_kg_m3=2700.0,
        surface_density_kg_m2=1.89,
        standard_mother_widths_mm=(650, 1000, 1250),
    ),
    "Alu 9010 Blanc 0.8": MaterialSpec(
        name="Alu 9010 Blanc 0.8",
        metal_type="ALUMINIUM",
        finish="9010 Blanc",
        thickness_mm=0.80,
        volumetric_density_kg_m3=2700.0,
        surface_density_kg_m2=2.16,
        standard_mother_widths_mm=(650, 1000, 1250),
    ),
    # Quartz (0.70 mm standard -> 1.89 kg/m², laizes 650 et 1000)
    "Alu Quartz": MaterialSpec(
        name="Alu Quartz 0.7",
        metal_type="ALUMINIUM",
        finish="Quartz",
        thickness_mm=0.70,
        volumetric_density_kg_m3=2700.0,
        surface_density_kg_m2=1.89,
        standard_mother_widths_mm=(650, 1000),
    ),
    "Alu Quartz 0.7": MaterialSpec(
        name="Alu Quartz 0.7",
        metal_type="ALUMINIUM",
        finish="Quartz",
        thickness_mm=0.70,
        volumetric_density_kg_m3=2700.0,
        surface_density_kg_m2=1.89,
        standard_mother_widths_mm=(650, 1000),
    ),
    "Alu Quartz 0.8": MaterialSpec(
        name="Alu Quartz 0.8",
        metal_type="ALUMINIUM",
        finish="Quartz",
        thickness_mm=0.80,
        volumetric_density_kg_m3=2700.0,
        surface_density_kg_m2=2.16,
        standard_mother_widths_mm=(650, 1000),
    ),

    # --- AUTRES MÉTAUX HISTORIQUES ---
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

# 6 bornes DEV BOBINE (formats mères purs)
DEV_BOBINE_BOUNDS: Final[tuple[int, ...]] = (
    600, 650, 670, 750, 1000, 1100
)

# Largeurs de chutes de rack pré-coupées prêtes au réemploi
RACK_SCRAP_WIDTHS: Final[tuple[int, ...]] = (
    100, 120, 150, 200, 250
)

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
    Résout intelligemment la nuance de métal exacte selon le libellé utilisateur.
    Prend en compte les listes Alu et Zinc mises à jour.
    """
    clean = material_name.lower().strip()

    # Cuivre & Plomb
    if "cuivre" in clean:
        return STANDARDIZED_MATERIALS["Cuivre 0.60"]
    if "plomb" in clean:
        return STANDARDIZED_MATERIALS["Plomb 1.25"]

    # 1.5 Brut Aluminium
    if ("1.5" in clean and "brut" in clean) or ("brut" in clean and "alu" in clean):
        return STANDARDIZED_MATERIALS["Alu 1.5 Brut"]

    # Analyse de l'épaisseur demandée (0.7 mm par défaut pour Alu et Zinc, 1.5 mm pour Alu Brut)
    is_07 = "0.7" in clean or "0,7" in clean
    is_08 = "0.8" in clean or "0,8" in clean

    # ALUMINIUM
    is_explicit_alu = "alu" in clean or "aluminium" in clean
    has_alu_code = any(k in clean for k in ("7016", "9005", "9010", "gris bleu", "texturé", "textur"))

    if is_explicit_alu or has_alu_code:
        # L'Aluminium laqué est en 0.7 mm par défaut
        thick_suffix = "0.8" if is_08 else "0.7"
        if "7016" in clean or "gris bleu" in clean:
            return STANDARDIZED_MATERIALS[f"Alu 7016 gris bleu {thick_suffix}"]
        if "9005" in clean or "noir" in clean or "textur" in clean:
            return STANDARDIZED_MATERIALS[f"Alu 9005 Noir texturé {thick_suffix}"]
        if "9010" in clean or "blanc" in clean:
            return STANDARDIZED_MATERIALS[f"Alu 9010 Blanc {thick_suffix}"]
        if "quarz" in clean or "quartz" in clean or "quatz" in clean or "qz" in clean:
            return STANDARDIZED_MATERIALS[f"Alu Quartz {thick_suffix}"]
        # Par défaut Alu
        return STANDARDIZED_MATERIALS[f"Alu 7016 gris bleu {thick_suffix}"]

    # ZINC (par défaut ou explicite)
    zinc_thick = "0.8" if is_08 else "0.7"

    if "quarz" in clean or "quartz" in clean or "quatz" in clean or "qz" in clean:
        return STANDARDIZED_MATERIALS[f"Zinc Quartz {zinc_thick}"]
    if "atz" in clean or "noir" in clean:
        return STANDARDIZED_MATERIALS[f"Zinc Noir ATZ {zinc_thick}"]
    if "pigmento" in clean or "rouge" in clean:
        return STANDARDIZED_MATERIALS[f"Zinc Pigmento Rouge {zinc_thick}"]
    if "perfor" in clean:
        return STANDARDIZED_MATERIALS[f"Zinc Perforée {zinc_thick}"]
    if "naturel" in clean or "nat" in clean:
        return STANDARDIZED_MATERIALS[f"Zinc Naturel {zinc_thick}"]

    # Repli par défaut
    return STANDARDIZED_MATERIALS[f"Zinc Naturel {zinc_thick}"]


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
