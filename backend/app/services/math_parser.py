"""
Analyseur syntaxique d'expressions arithmétiques basé sur Shunting-Yard (RPN).
Spécification technique : Section 3.1 du Cahier des Charges.
Sécurisé sans recours à eval().
"""

import re
from typing import Final

ALLOWED_PATTERN: Final[re.Pattern[str]] = re.compile(r"^[0-9+\-*/().\s,]+$")
OPERATOR_PRECEDENCE: Final[dict[str, int]] = {
    "+": 1,
    "-": 1,
    "*": 2,
    "/": 2,
}


def evaluate_expression(expr: str) -> float:
    """
    Évalue une expression arithmétique d'atelier (ex: '250/3*2+1.5', '15+120+40', '1.5+1.5')
    en utilisant l'algorithme Shunting-Yard et la Notation Polonaise Inverse (RPN).

    Lève ValueError si l'expression est vide, mal formée, ou contient des caractères non autorisés.
    Lève ZeroDivisionError en cas de division par zéro.
    """
    if not expr or not expr.strip():
        raise ValueError("Expression arithmétique vide")

    # Normalisation : virgules remplacées par des points
    clean = expr.replace(",", ".").strip()

    if not ALLOWED_PATTERN.match(clean):
        raise ValueError(f"Caractères non autorisés dans l'expression : '{expr}'")

    # 1. Tokenisation
    tokens: list[str] = []
    i = 0
    length = len(clean)

    while i < length:
        char = clean[i]
        if char.isspace():
            i += 1
            continue

        if char in "+-*/()":
            tokens.append(char)
            i += 1
        elif char.isdigit() or char == ".":
            start = i
            has_dot = char == "."
            i += 1
            while i < length and (clean[i].isdigit() or clean[i] == "."):
                if clean[i] == ".":
                    if has_dot:
                        raise ValueError(f"Nombre flottant mal formé à la position {i} dans '{expr}'")
                    has_dot = True
                i += 1
            tokens.append(clean[start:i])
        else:
            raise ValueError(f"Caractère inattendu : '{char}'")

    if not tokens:
        raise ValueError("Aucun jeton valide trouvé dans l'expression")

    # 2. Conversion Shunting-Yard vers RPN
    output_queue: list[float | str] = []
    op_stack: list[str] = []

    for idx, token in enumerate(tokens):
        # Vérification si c'est un nombre
        try:
            val = float(token)
            output_queue.append(val)
            continue
        except ValueError:
            pass

        if token == "(":
            op_stack.append(token)
        elif token == ")":
            while op_stack and op_stack[-1] != "(":
                output_queue.append(op_stack.pop())
            if not op_stack:
                raise ValueError(f"Parenthèses non appariées dans '{expr}'")
            op_stack.pop()  # Retirer le '('
        elif token in OPERATOR_PRECEDENCE:
            # Gestion du signe négatif unaire :
            # Détecté si en tête d'expression, après une parenthèse ouvrante ou après un opérateur
            prev = tokens[idx - 1] if idx > 0 else None
            if token == "-" and (idx == 0 or prev == "(" or (prev is not None and prev in OPERATOR_PRECEDENCE)):
                output_queue.append(0.0)

            curr_prec = OPERATOR_PRECEDENCE[token]
            while (
                op_stack
                and op_stack[-1] != "("
                and OPERATOR_PRECEDENCE.get(op_stack[-1], 0) >= curr_prec
            ):
                output_queue.append(op_stack.pop())
            op_stack.append(token)
        else:
            raise ValueError(f"Opérateur inconnu : '{token}'")

    while op_stack:
        op = op_stack.pop()
        if op in ("(", ")"):
            raise ValueError(f"Parenthèses non appariées dans '{expr}'")
        output_queue.append(op)

    # 3. Évaluation de la pile RPN
    eval_stack: list[float] = []

    for item in output_queue:
        if isinstance(item, (int, float)):
            eval_stack.append(float(item))
        else:
            if len(eval_stack) < 2:
                raise ValueError(f"Opérandes insuffisants pour l'opérateur '{item}' dans '{expr}'")
            b = eval_stack.pop()
            a = eval_stack.pop()

            if item == "+":
                eval_stack.append(a + b)
            elif item == "-":
                eval_stack.append(a - b)
            elif item == "*":
                eval_stack.append(a * b)
            elif item == "/":
                if b == 0.0:
                    raise ZeroDivisionError(f"Division par zéro rencontrée dans '{expr}'")
                eval_stack.append(a / b)
            else:
                raise ValueError(f"Opérateur d'évaluation inconnu '{item}'")

    if len(eval_stack) != 1:
        raise ValueError(f"Expression arithmétique mal formée : '{expr}'")

    result = eval_stack[0]
    # Arrondi de sécurité à 4 décimales pour éviter les approximations flottantes IEEE 754
    return round(result, 4)
