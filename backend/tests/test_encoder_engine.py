"""
Tests unitaires pour l'encodage rapide atelier (FastEncoder) et affectation sur bornes standards.
Spécification technique : Section 2.1 du Cahier des Charges.
"""

import pytest
from app.core.constants import DEV_BOBINE_BOUNDS, DEV_PIECE_BOUNDS
from app.services.encoder_engine import find_matched_bound, parse_composite_input


def test_find_matched_bound_piece() -> None:
    """
    Règle d'affectation :
    La pièce est cumulée sur la première borne standard B >= dev.
    Si dev dépasse toutes les bornes, elle est affectée à la borne max.
    """
    # 175 est exactement une borne -> 175
    assert find_matched_bound(175, DEV_PIECE_BOUNDS) == 175

    # 180 est entre 175 et 187 -> 187
    assert find_matched_bound(180, DEV_PIECE_BOUNDS) == 187

    # 95 est inférieur à la borne min (100) -> 100
    assert find_matched_bound(95, DEV_PIECE_BOUNDS) == 100

    # 1150 dépasse toutes les bornes -> borne max 1100
    assert find_matched_bound(1150, DEV_PIECE_BOUNDS) == 1100


def test_find_matched_bound_bobine() -> None:
    """Bornes bobines : 600, 650, 670, 750, 1000, 1100."""
    assert find_matched_bound(500, DEV_BOBINE_BOUNDS) == 600
    assert find_matched_bound(650, DEV_BOBINE_BOUNDS) == 650
    assert find_matched_bound(660, DEV_BOBINE_BOUNDS) == 670
    assert find_matched_bound(700, DEV_BOBINE_BOUNDS) == 750
    assert find_matched_bound(1200, DEV_BOBINE_BOUNDS) == 1100


def test_parse_composite_input_standard() -> None:
    """Test du format composite '175/8*3'."""
    item = parse_composite_input("175/8*3", material_name="Zinc 0.70")
    assert item.dev == 175
    assert item.quantity == 8
    assert item.unit_length_m == 3.0
    assert item.total_length_m == 24.0
    assert item.matched_bound == 175
    assert not item.is_chute
    assert not item.is_auto_breakdown

    # Calcul surface et poids pour Zinc 0.70 (5.04 kg/m²) :
    # Surface = (175 / 1000) * 24.0 = 4.20 m²
    # Poids = 4.20 * 5.04 = 21.168 -> 21.17 kg
    assert item.surface_net_m2 == 4.20
    assert item.weight_net_kg == 21.17


def test_parse_composite_input_expression() -> None:
    """Test du format composite '250/3*2+1.5'."""
    item = parse_composite_input("250/3*2+1.5", material_name="Zinc 0.70")
    assert item.dev == 250
    assert item.matched_bound == 250
    # 3*2+1.5 = 7.5
    assert item.unit_length_m == 7.5
    assert item.quantity == 1
    assert item.total_length_m == 7.5


def test_parse_composite_arithmetic_dev() -> None:
    """Développé sous forme d'expression '15+120+40/2.0'."""
    item = parse_composite_input("15+120+40/2.0", material_name="Zinc 0.70")
    assert item.dev == 175
    assert item.matched_bound == 175
    assert item.unit_length_m == 2.0
    assert item.quantity == 1
    assert item.total_length_m == 2.0


def test_parse_composite_chute_bobine() -> None:
    """Développé = 0 (chute) n'est autorisé qu'en DEV_BOBINE."""
    # En DEV_BOBINE : valide
    chute_item = parse_composite_input("0/4.5", preset="DEV_BOBINE")
    assert chute_item.dev == 0
    assert chute_item.is_chute
    assert chute_item.total_length_m == 4.5

    # En DEV_PIECE : interdit
    with pytest.raises(ValueError, match="DEV_BOBINE"):
        parse_composite_input("0/4.5", preset="DEV_PIECE")


def test_parse_composite_mm_unit() -> None:
    """Support de l'unité millimètres."""
    item = parse_composite_input("200/2500", length_unit="mm")
    assert item.dev == 200
    assert item.unit_length_m == 2.5
    assert item.total_length_m == 2.5
