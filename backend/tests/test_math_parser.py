"""
Tests unitaires pour l'analyseur syntaxique Shunting-Yard RPN.
Spécification technique : Section 3.1 du Cahier des Charges.
"""

import pytest
from app.services.math_parser import evaluate_expression


def test_basic_arithmetic() -> None:
    """Opérations élémentaires +, -, *, /."""
    assert evaluate_expression("10 + 5") == 15.0
    assert evaluate_expression("20 - 8") == 12.0
    assert evaluate_expression("4 * 2.5") == 10.0
    assert evaluate_expression("15 / 3") == 5.0


def test_comma_replacement() -> None:
    """Remplacement automatique des virgules françaises en points."""
    assert evaluate_expression("1,5 + 2,5") == 4.0
    assert evaluate_expression("3,2 * 2") == 6.4


def test_operator_precedence() -> None:
    """Respect strict de la priorité des opérateurs (* et / avant + et -)."""
    assert evaluate_expression("3 * 2 + 1.5") == 7.5
    assert evaluate_expression("1.5 + 3 * 2") == 7.5
    assert evaluate_expression("10 + 20 / 4") == 15.0
    assert evaluate_expression("20 / 4 + 10") == 15.0


def test_parentheses() -> None:
    """Gestion des parenthèses ouvrantes et fermantes."""
    assert evaluate_expression("(10 + 20) * 3") == 90.0
    assert evaluate_expression("4 * (2 + 1)") == 12.0
    assert evaluate_expression("((2 + 3) * 2) + 5") == 15.0


def test_unary_minus() -> None:
    """Gestion du signe moins unaire (en tête ou après parenthèse/opérateur)."""
    assert evaluate_expression("-5 + 10") == 5.0
    assert evaluate_expression("10 + -2") == 8.0
    assert evaluate_expression("10 * (-2 + 5)") == 30.0
    assert evaluate_expression("-(3 + 2)") == -5.0


def test_workshop_typical_inputs() -> None:
    """Expressions typiques d'atelier citées dans le cahier des charges."""
    # "15+120+40" -> 175
    assert evaluate_expression("15+120+40") == 175.0
    # "1.5+1.5" -> 3.0
    assert evaluate_expression("1.5+1.5") == 3.0
    # "3*2+1.5" -> 7.5
    assert evaluate_expression("3*2+1.5") == 7.5
    # "2*1+2*2" -> 6.0
    assert evaluate_expression("2*1+2*2") == 6.0


def test_division_by_zero_error() -> None:
    """Division par zéro lève ZeroDivisionError."""
    with pytest.raises(ZeroDivisionError):
        evaluate_expression("10 / 0")

    with pytest.raises(ZeroDivisionError):
        evaluate_expression("5 / (2 - 2)")


def test_invalid_syntax_and_characters() -> None:
    """Détection et rejet d'injections ou d'expressions mal formées."""
    with pytest.raises(ValueError):
        evaluate_expression("")

    with pytest.raises(ValueError):
        evaluate_expression("   ")

    with pytest.raises(ValueError):
        evaluate_expression("import os; os.system('ls')")

    with pytest.raises(ValueError):
        evaluate_expression("10 + abc")

    with pytest.raises(ValueError):
        evaluate_expression("(10 + 20")

    with pytest.raises(ValueError):
        evaluate_expression("10 + 20)")

    with pytest.raises(ValueError):
        evaluate_expression("1.2.3 + 4")
