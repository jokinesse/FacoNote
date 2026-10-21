"""
Tests unitaires pour les constantes physiques et règles de conversion.
Vérifie la conformité avec la liste officielle des nuances Alu et Zinc.
"""

import pytest
from app.core.constants import (
    ALU_FINISHES,
    DEV_BOBINE_BOUNDS,
    DEV_PIECE_BOUNDS,
    OFFICIAL_MATERIALS,
    RACK_SCRAP_WIDTHS,
    STANDARDIZED_MATERIALS,
    ZINC_FINISHES,
    calculate_surface_m2,
    calculate_weight_kg,
    resolve_material_spec,
    round_meters,
)


def test_official_materials_exact_list() -> None:
    """Vérifie que la liste officielle stricte contient exactement les 13 matières demandées."""
    expected_materials = (
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
    assert OFFICIAL_MATERIALS == expected_materials
    assert len(OFFICIAL_MATERIALS) == 13

    for mat in OFFICIAL_MATERIALS:
        assert mat in STANDARDIZED_MATERIALS


def test_zinc_finishes_list() -> None:
    """Vérifie la présence des finitions Zinc demandées."""
    expected_finishes = {"Naturel", "ATZ", "Quartz", "Pigmento Rouge", "Perforée"}
    assert set(ZINC_FINISHES) == expected_finishes

    # Test des densités surfaciques en 0.7mm (5.04 kg/m²), 0.8mm (5.76 kg/m²) et 1.0mm (7.20 kg/m²)
    assert STANDARDIZED_MATERIALS["Zinc Naturel 0.7"].surface_density_kg_m2 == 5.04
    assert STANDARDIZED_MATERIALS["Zinc ATZ 0.7"].surface_density_kg_m2 == 5.04
    assert STANDARDIZED_MATERIALS["Zinc Quartz 0.7"].surface_density_kg_m2 == 5.04

    assert STANDARDIZED_MATERIALS["Zinc Naturel 0.8"].surface_density_kg_m2 == 5.76
    assert STANDARDIZED_MATERIALS["Zinc ATZ 0.8"].surface_density_kg_m2 == 5.76
    assert STANDARDIZED_MATERIALS["Zinc Quartz 0.8"].surface_density_kg_m2 == 5.76
    assert STANDARDIZED_MATERIALS["Zinc Pigmento Rouge 0.8"].surface_density_kg_m2 == 5.76

    assert STANDARDIZED_MATERIALS["Zinc Perforée 1.0"].surface_density_kg_m2 == 7.20
    assert STANDARDIZED_MATERIALS["Zinc Perforée 1.0"].thickness_mm == 1.00


def test_alu_finishes_list() -> None:
    """Vérifie la présence des finitions Alu demandées."""
    expected_finishes = {"RAL 7016", "RAL 9005", "RAL 9010", "RAL 7039", "1.5 Brut"}
    assert set(ALU_FINISHES) == expected_finishes

    # Alu 1.5 Brut spécifique
    spec_brut = STANDARDIZED_MATERIALS["Alu 1.5 Brut"]
    assert spec_brut.thickness_mm == 1.50
    assert spec_brut.surface_density_kg_m2 == 4.05  # 2700 * 0.0015
    assert spec_brut.metal_type == "ALUMINIUM"

    # Nuances laquées 0.7mm
    for finish in ["RAL 7016", "RAL 9005", "RAL 9010", "RAL 7039"]:
        spec = STANDARDIZED_MATERIALS[f"Alu {finish} 0.7"]
        assert spec.surface_density_kg_m2 == 1.89
        assert spec.thickness_mm == 0.70
        assert spec.metal_type == "ALUMINIUM"


def test_standard_bounds_counts() -> None:
    """Vérifie le nombre et les valeurs des bornes industrielles de refente."""
    # Mode DEV PIÈCE : 19 bornes
    assert len(DEV_PIECE_BOUNDS) == 19
    assert DEV_PIECE_BOUNDS == (
        100, 120, 150, 175, 187, 200, 250, 285, 300, 333, 375, 400, 450, 500, 600, 670, 750, 1000, 1100
    )

    # Mode DEV BOBINE : 6 bornes
    assert len(DEV_BOBINE_BOUNDS) == 6
    assert DEV_BOBINE_BOUNDS == (600, 650, 670, 750, 1000, 1100)

    # Chutes de rack : 5 largeurs
    assert len(RACK_SCRAP_WIDTHS) == 5
    assert RACK_SCRAP_WIDTHS == (100, 120, 150, 200, 250)


def test_weight_and_surface_calculation() -> None:
    """
    Vérifie la formule de calcul de masse et surface :
    Poids (kg) = (Développé en mm / 1000) * Longueur (m) * Densité surfacique (kg/m²)
    Arrondi obligatoire à 2 décimales.
    """
    # Exemple 1 : Zinc Naturel 0.70 (5.04 kg/m²), dév 250 mm, longueur 2.0 m
    # Surface = 0.25 * 2.0 = 0.50 m²
    # Poids = 0.50 * 5.04 = 2.52 kg
    surf = calculate_surface_m2(250, 2.0)
    poids = calculate_weight_kg(250, 2.0, 5.04)
    assert surf == 0.50
    assert poids == 2.52

    # Exemple 2 : Aluminium 1.5 Brut (4.05 kg/m²), dév 500 mm, longueur 2.0 m
    # Surface = 0.5 * 2.0 = 1.0 m²
    # Poids = 1.0 * 4.05 = 4.05 kg
    assert calculate_surface_m2(500, 2.0) == 1.00
    assert calculate_weight_kg(500, 2.0, 4.05) == 4.05


def test_round_meters_three_decimals() -> None:
    """Vérifie l'arrondi déterministe à 3 décimales pour les métrages."""
    assert round_meters(1.3333333) == 1.333
    assert round_meters(2.5) == 2.5
    assert round_meters(3.14159) == 3.142


def test_resolve_material_spec_new_nuances() -> None:
    """Vérifie la résolution dynamique des nuances d'atelier selon la liste stricte."""
    # Zinc
    assert resolve_material_spec("Zinc Naturel 0.7").name == "Zinc Naturel 0.7"
    assert resolve_material_spec("Noir ATZ 0.8").name == "Zinc ATZ 0.8"
    assert resolve_material_spec("Zinc ATZ 0.7").name == "Zinc ATZ 0.7"
    assert resolve_material_spec("Quatz 0.7").name == "Zinc Quartz 0.7"
    assert resolve_material_spec("Quartz 0.8").name == "Zinc Quartz 0.8"
    assert resolve_material_spec("Pigmento Rouge").name == "Zinc Pigmento Rouge 0.8"
    assert resolve_material_spec("Zinc Perforée").name == "Zinc Perforée 1.0"
    assert resolve_material_spec("Zinc Perforée 1").name == "Zinc Perforée 1.0"

    # Alu 0.7 (RAL 7016, 9005, 9010, 7039)
    assert resolve_material_spec("7016").name == "Alu RAL 7016 0.7"
    assert resolve_material_spec("Alu 7016").surface_density_kg_m2 == 1.89
    assert resolve_material_spec("9005").name == "Alu RAL 9005 0.7"
    assert resolve_material_spec("Alu 9005 Noir texturé").name == "Alu RAL 9005 0.7"
    assert resolve_material_spec("9010 Blanc").name == "Alu RAL 9010 0.7"
    assert resolve_material_spec("7039").name == "Alu RAL 7039 0.7"
    assert resolve_material_spec("Alu RAL 7039 0.7").surface_density_kg_m2 == 1.89

    # Alu 1.5 Brut
    assert resolve_material_spec("1.5 Brut").name == "Alu 1.5 Brut"
    assert resolve_material_spec("Alu Brut").name == "Alu 1.5 Brut"
    assert resolve_material_spec("Alu 1.5 Brut").surface_density_kg_m2 == 4.05
