"""
Moteur d'encodage rapide atelier (FastEncoder) et affectation sur bornes standards.
Spécification technique : Section 2.1 du Cahier des Charges.
"""

from dataclasses import dataclass
from typing import Literal

from app.core.constants import (
    DEV_BOBINE_BOUNDS,
    DEV_PIECE_BOUNDS,
    calculate_surface_m2,
    calculate_weight_kg,
    resolve_material_spec,
    round_meters,
)
from app.services.math_parser import evaluate_expression


@dataclass(frozen=True)
class FastEncodingItem:
    raw_input: str
    dev: int
    unit_length_m: float
    quantity: int
    total_length_m: float
    matched_bound: int
    is_chute: bool
    is_auto_breakdown: bool  # Déclenché si quantity == 0
    surface_net_m2: float
    weight_net_kg: float
    material: str


def find_matched_bound(dev_mm: float, bounds: tuple[int, ...] = DEV_PIECE_BOUNDS) -> int:
    """
    Règle d'affectation du cahier des charges (Section 2.1) :
    'La pièce est cumulée sur la première borne standard B >= dev.
    Si dev dépasse toutes les bornes, elle est affectée à la borne max.'
    """
    for bound in bounds:
        if bound >= dev_mm:
            return bound
    return bounds[-1]


def parse_composite_input(
    input_str: str,
    material_name: str = "Zinc 0.70",
    length_unit: Literal["m", "mm"] = "m",
    preset: Literal["DEV_PIECE", "DEV_BOBINE"] = "DEV_PIECE",
) -> FastEncodingItem:
    """
    Parse une saisie atelier avec barre oblique :
    Formats supportés :
    - '175/8*3' -> dev = 175, longueur évaluée = 24.0 (ou qty=8, len=3)
    - '250/3*2+1.5' -> dev = 250, expression longueur = 3*2+1.5 -> 7.5 m
    - '15+120+40/2.5' -> dev évalué = 175, longueur = 2.5 m
    - '0/4.5' -> chute de longueur 4.5m (autorisée en DEV_BOBINE)
    """
    clean_input = input_str.strip()
    if "/" not in clean_input:
        raise ValueError("Format attendu avec barre oblique : 'développé / longueur' (ex: '250/3*2+1.5' ou '0/4.5')")

    parts = clean_input.split("/", 1)
    dev_part = parts[0].strip()
    rest_part = parts[1].strip()

    # 1. Évaluation du développé
    evaluated_dev = evaluate_expression(dev_part)
    if evaluated_dev < 0:
        raise ValueError(f"Le développé ne peut pas être négatif ({evaluated_dev})")

    dev_int = round(evaluated_dev)
    is_chute = dev_int == 0

    if is_chute and preset != "DEV_BOBINE":
        raise ValueError("Un développé de 0 (chute) est autorisé uniquement en mode DEV_BOBINE")

    # 2. Détermination des bornes selon le preset
    active_bounds = DEV_BOBINE_BOUNDS if preset == "DEV_BOBINE" else DEV_PIECE_BOUNDS
    matched_bound = find_matched_bound(float(dev_int), active_bounds)

    # 3. Décomposition de la partie longueur / quantité
    # Support des patterns tels que : '8*3' (8 pièces de 3m) ou '3*2+1.5'
    # Si le format est 'quantité * longueur' où quantité est un entier
    quantity = 1
    unit_length_m = 0.0

    # Vérification si on a explicitement 'quantite * longueur'
    if "*" in rest_part and not ("+" in rest_part or "-" in rest_part or "/" in rest_part):
        qty_sub, len_sub = rest_part.split("*", 1)
        try:
            parsed_qty = int(qty_sub.strip())
            parsed_len = evaluate_expression(len_sub.strip())
            if parsed_qty >= 0 and parsed_len > 0:
                quantity = parsed_qty
                unit_length_m = parsed_len
        except (ValueError, ZeroDivisionError):
            quantity = 1
            unit_length_m = evaluate_expression(rest_part)
    else:
        unit_length_m = evaluate_expression(rest_part)

    if length_unit == "mm":
        unit_length_m = unit_length_m / 1000.0

    if unit_length_m <= 0:
        raise ValueError("La longueur doit être strictement supérieure à 0")

    is_auto_breakdown = quantity == 0
    total_length_m = round_meters(unit_length_m if is_auto_breakdown else unit_length_m * quantity)

    # 4. Calculs physiques (masse et surface)
    mat_spec = resolve_material_spec(material_name)
    surface_net = calculate_surface_m2(float(dev_int), total_length_m)
    weight_net = calculate_weight_kg(float(dev_int), total_length_m, mat_spec.surface_density_kg_m2)

    return FastEncodingItem(
        raw_input=clean_input,
        dev=dev_int,
        unit_length_m=round_meters(unit_length_m),
        quantity=quantity,
        total_length_m=total_length_m,
        matched_bound=matched_bound,
        is_chute=is_chute,
        is_auto_breakdown=is_auto_breakdown,
        surface_net_m2=surface_net,
        weight_net_kg=weight_net,
        material=mat_spec.name,
    )
