"""
Tests unitaires pour le moteur d'auto-calepinage du métrage linéaire (breakdown_engine).
Spécification technique : Section 3.2 du Cahier des Charges.
"""

import pytest
from app.models.pieces import ShapedPieceModel
from app.services.breakdown_engine import resolve_auto_piece_breakdown


def test_breakdown_10_meters() -> None:
    """
    Test pour un métrage de 10 mètres :
    10m se divise parfaitement en 5 pièces de 2.0m ou 4 pièces de 2.5m.
    Vérifie qu'une solution exacte de plieuse standard est recommandée.
    """
    result = resolve_auto_piece_breakdown(
        total_meters=10.0,
        current_pieces=[],
        target_material="Zinc Naturel 0.7",
    )

    assert result.requested_meters == 10.0
    assert result.total_produced == 10.0
    assert result.source == "standard_exact"
    # Longueur standard recommandée : 2.0m ou 2.5m
    assert result.length in (2.0, 2.5)
    assert result.quantity * result.length == 10.0

    # Au moins 1 alternative exacte garantie
    assert any(alt.is_exact for alt in result.alternatives)


def test_breakdown_11_5_meters() -> None:
    """
    Test pour 11.5 mètres :
    Diviseur exact : 5 pièces de 2.30m = 11.50m (0 chute).
    Standard le plus proche : 6 pièces de 2.0m = 12.0m (+0.50m).
    """
    result = resolve_auto_piece_breakdown(
        total_meters=11.5,
        current_pieces=[],
        target_material="Zinc Naturel 0.7",
    )

    assert result.requested_meters == 11.5
    # Doit contenir l'option exacte de 2.30m
    exact_alt = next((alt for alt in result.alternatives if alt.is_exact), None)
    assert exact_alt is not None
    assert exact_alt.length == 2.3
    assert exact_alt.quantity == 5
    assert exact_alt.total_produced == 11.5
    assert exact_alt.excess == 0.0

    # Doit contenir une option marquée 'is_closest'
    closest_alt = next((alt for alt in result.alternatives if alt.is_closest), None)
    assert closest_alt is not None
    assert closest_alt.excess > 0


def test_breakdown_existing_pieces_bonus() -> None:
    """
    Test du bonus d'alignement sur les pièces existantes de même matière.
    Pour 14m, sans pièces existantes, 7x2.0m peut dominer.
    Avec 10 pièces existantes de 2.8m sur le bon, l'algorithme doit recommander
    d'aligner le débit sur les tôles de 2.8m (5 pièces de 2.8m = 14.0m).
    """
    existing_pieces = [
        ShapedPieceModel(
            id="p-1",
            label="Bande de rive",
            dev=250,
            length=2.8,
            quantity=10,
            bends=2,
            material="Zinc Naturel 0.7",
        )
    ]

    result = resolve_auto_piece_breakdown(
        total_meters=14.0,
        current_pieces=existing_pieces,
        target_material="Zinc Naturel 0.7",
    )

    assert result.length == 2.8
    assert result.quantity == 5
    assert result.total_produced == 14.0
    assert result.source == "existing_pieces"
    assert "Aligné sur les feuilles de 2.8m existantes" in result.reason


def test_breakdown_forced_length() -> None:
    """
    Test du forçage manuel de la longueur par l'opérateur.
    """
    result = resolve_auto_piece_breakdown(
        total_meters=10.0,
        current_pieces=[],
        target_material="Zinc Naturel 0.7",
        forced_length=3.0,
    )

    assert result.length == 3.0
    # Pour 10m en tôles de 3m : 4 pièces de 3m = 12m (+2m chute)
    assert result.quantity == 4
    assert result.total_produced == 12.0


def test_breakdown_small_meterage() -> None:
    """
    Test pour un petit métrage (ex: 2.4m).
    Doit proposer 1 pièce de 2.4m (tombe pile) ou formats standards.
    """
    result = resolve_auto_piece_breakdown(
        total_meters=2.4,
        current_pieces=[],
        target_material="Zinc Naturel 0.7",
    )

    assert result.requested_meters == 2.4
    assert any(alt.is_exact for alt in result.alternatives)
