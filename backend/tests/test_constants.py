"""
Tests unitaires pour les constantes physiques et règles de conversion.
Vérifie la conformité avec la liste officielle des nuances Alu et Zinc.
"""

import pytest
from app.core.constants import (
    ALU_FINISHES,
    DEV_BOBINE_BOUNDS,
    DEV_PIECE_BOUNDS,
    RACK_SCRAP_WIDTHS,
    STANDARDIZED_MATERIALS,
    ZINC_FINISHES,
    calculate_surface_m2,
    calculate_weight_kg,
    resolve_material_spec,
    round_meters,
)


def test_zinc_finishes_list() -> None:
    """Vérifie la présence des finitions Zinc demandées."""
    expected_finishes = {"Naturel", "Noir ATZ", "Quartz", "Pigmento Rouge", "Perforée"}
    assert set(ZINC_FINISHES) == expected_finishes

    # Test des densités surfaciques en 0.7mm (5.04 kg/m²) et 0.8mm (5.76 kg/m²)
    for finish in expected_finishes:
        key_07 = f"Zinc {finish} 0.7"
        key_08 = f"Zinc {finish} 0.8"
        assert key_07 in STANDARDIZED_MATERIALS
        assert key_08 in STANDARDIZED_MATERIALS

        spec_07 = STANDARDIZED_MATERIALS[key_07]
        spec_08 = STANDARDIZED_MATERIALS[key_08]

        assert spec_07.surface_density_kg_m2 == 5.04
        assert spec_07.thickness_mm == 0.70
        assert spec_07.metal_type == "ZINC"
        assert spec_07.standard_mother_widths_mm == (600, 650, 670, 750, 1000, 1100)

        assert spec_08.surface_density_kg_m2 == 5.76
        assert spec_08.thickness_mm == 0.80
        assert spec_08.metal_type == "ZINC"


def test_alu_finishes_list() -> None:
    """Vérifie la présence des finitions Alu demandées."""
    expected_finishes = {"7016 gris bleu", "9005 Noir texturé", "9010 Blanc", "Quartz", "1.5 Brut"}
    assert set(ALU_FINISHES) == expected_finishes

    # Alu 1.5 Brut spécifique
    spec_brut = STANDARDIZED_MATERIALS["Alu 1.5 Brut"]
    assert spec_brut.thickness_mm == 1.50
    assert spec_brut.surface_density_kg_m2 == 4.05  # 2700 * 0.0015
    assert spec_brut.metal_type == "ALUMINIUM"

    # Vérification des nuances laquées en 0.8mm et 0.7mm
    for finish in ["7016 gris bleu", "9005 Noir texturé", "9010 Blanc", "Quartz"]:
        spec_08 = STANDARDIZED_MATERIALS[f"Alu {finish} 0.8"]
        spec_07 = STANDARDIZED_MATERIALS[f"Alu {finish} 0.7"]
        assert spec_08.surface_density_kg_m2 == 2.16
        assert spec_07.surface_density_kg_m2 == 1.89
        assert spec_08.metal_type == "ALUMINIUM"


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
    """Vérifie la résolution dynamique des nouvelles nuances d'atelier."""
    # Zinc
    assert resolve_material_spec("Zinc Naturel 0.7").name == "Zinc Naturel 0.7"
    assert resolve_material_spec("Noir ATZ 0.8").name == "Zinc Noir ATZ 0.8"
    assert resolve_material_spec("Quatz 0.7").name == "Zinc Quartz 0.7"
    assert resolve_material_spec("Pigemento Rouge 0.8").name == "Zinc Pigmento Rouge 0.8"
    assert resolve_material_spec("Zinc Perforée 0.7").name == "Zinc Perforée 0.7"

    # Alu (0.7 mm standard par défaut, sauf 1.5 Brut)
    assert resolve_material_spec("7016 gris bleu").name == "Alu 7016 gris bleu 0.7"
    assert resolve_material_spec("7016 gris bleu").surface_density_kg_m2 == 1.89
    assert resolve_material_spec("Alu 7016 0.8").name == "Alu 7016 gris bleu 0.8"
    assert resolve_material_spec("Alu 7016 0.8").surface_density_kg_m2 == 2.16
    assert resolve_material_spec("9005 Noir texturé").name == "Alu 9005 Noir texturé 0.7"
    assert resolve_material_spec("9005 Noir texturé").surface_density_kg_m2 == 1.89
    assert resolve_material_spec("9010 Blanc").name == "Alu 9010 Blanc 0.7"
    assert resolve_material_spec("9010 Blanc").surface_density_kg_m2 == 1.89
    assert resolve_material_spec("Alu Quarz").name == "Alu Quartz 0.7"
    assert resolve_material_spec("Alu Quarz").surface_density_kg_m2 == 1.89
    assert resolve_material_spec("1.5 Brut").name == "Alu 1.5 Brut"
    assert resolve_material_spec("Alu 1.5 Brut").surface_density_kg_m2 == 4.05
