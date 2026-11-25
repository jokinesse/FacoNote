"""
Tests de la commande envoyée vers l'extension D365 (pièces + bobines par matière) :
table des codes AR, normalisation, route /api/v1/optimizer/d365-order et
non-régression du cas « pièces seules » (message version 1 inchangé).
"""

import json
import re
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.admin_security import reset_security_state_for_tests
from app.core.constants import (
    D365_COIL_ARTICLES,
    D365_MATIERE_LABELS,
    D365_SHEET_ARTICLES,
    OFFICIAL_MATERIALS,
    STANDARDIZED_MATERIALS,
    normalize_ar_code,
    resolve_material_spec,
)
from app.main import app
from app.models.coils import CoilSummaryEntry
from app.models.pieces_summary import PieceSummaryEntry
from app.services.coil_engine import encode_coil_entry, summarize_coils
from app.services.d365_order import build_d365_order
from app.services.pieces_engine import summarize_pieces
from app.services.reference_service import build_reference

client = TestClient(app)
ORDER = "CC26000236736"
V1_KEYS = {"material", "matiere", "epaisseur", "lengths"}
V2_KEYS = V1_KEYS | {"has_pieces", "coils", "all_articles", "chute_m"}


def piece(id_: str, dev: int, qty: int, length: float, material: str) -> PieceSummaryEntry:
    return PieceSummaryEntry(id=id_, dev=dev, quantity=qty, unit_length_m=length, material=material)


def coil(id_: str, width: int, qty: int, length: float, material: str) -> CoilSummaryEntry:
    return CoilSummaryEntry(id=id_, width=width, quantity=qty, unit_length_m=length, material=material)


def dump(pieces: list[PieceSummaryEntry], coils: list[CoilSummaryEntry]) -> dict[str, Any]:
    """Réponse telle que la route la rend (clés absentes en version 1)."""
    result: dict[str, Any] = build_d365_order(ORDER, pieces, coils).model_dump(exclude_unset=True)
    return result


# --- Table des codes AR -----------------------------------------------------------------

def test_ar_table_codes_format_and_unique() -> None:
    codes = [code for widths in D365_COIL_ARTICLES.values() for code in widths.values()]
    assert all(re.fullmatch(r"AR\d{8}", c) for c in codes)
    assert len(codes) == len(set(codes))
    assert not set(codes) & set(D365_SHEET_ARTICLES.values())


def test_ar_table_materials_and_widths() -> None:
    assert set(D365_COIL_ARTICLES) <= set(OFFICIAL_MATERIALS)
    for name in ("Zinc Pigmento Rouge 0.8", "Alu 1.5 Brut", "Zinc Perforée 1.0"):
        assert name not in D365_COIL_ARTICLES
    with_1100 = [m for m, widths in D365_COIL_ARTICLES.items() if 1100 in widths]
    assert with_1100 == ["Zinc Naturel 0.8"]
    # Chaque code correspond à une largeur de bobine de la matière
    for material, widths in D365_COIL_ARTICLES.items():
        assert set(widths) <= set(STANDARDIZED_MATERIALS[material].standard_mother_widths_mm), material


def test_ar_table_values() -> None:
    assert D365_COIL_ARTICLES["Zinc Naturel 0.7"][1000] == "AR00002875"  # EN
    assert D365_COIL_ARTICLES["Zinc Naturel 0.8"][1000] == "AR00002872"  # VM
    assert D365_COIL_ARTICLES["Zinc Naturel 0.8"][750] == "AR00021070"
    assert D365_COIL_ARTICLES["Zinc ATZ 0.8"][600] == "AR00002960"
    assert D365_COIL_ARTICLES["Alu RAL 9005 0.7"] == {1000: "AR00112154", 650: "AR00106474"}
    assert D365_COIL_ARTICLES["Alu RAL 7016 0.7"] == {1000: "AR00102719"}
    assert D365_SHEET_ARTICLES == {"Zinc Perforée 1.0": "AR00089875"}


def test_1100_only_in_zinc_naturel_08() -> None:
    with_1100 = sorted({
        spec.name for spec in STANDARDIZED_MATERIALS.values() if 1100 in spec.standard_mother_widths_mm
    })
    assert with_1100 == ["Zinc Naturel 0.8"]


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("AR-2953", "AR00002953"),
        ("AR-21070", "AR00021070"),
        ("AR00112154", "AR00112154"),
        (" ar 2953 ", "AR00002953"),
        ("AR2953", "AR00002953"),
        ("CHUTE", None),
        ("TEMPS_PROD", None),
        ("AR-", None),
        ("AR-123456789", None),
        ("XAR-2953", None),
        ("", None),
    ],
)
def test_normalize_ar_code(text: str, expected: str | None) -> None:
    assert normalize_ar_code(text) == expected


def test_reference_exposes_coil_articles() -> None:
    ref = {m.name: m for m in build_reference().materials}
    assert [(a.width_mm, a.article) for a in ref["Zinc ATZ 0.8"].d365_coil_articles] == [
        (600, "AR00002960"), (670, "AR00002958"), (750, "AR00002956"), (1000, "AR00002953"),
    ]
    assert ref["Zinc Pigmento Rouge 0.8"].d365_coil_articles == []
    assert ref["Zinc Perforée 1.0"].d365_coil_articles == []


def test_coil_summary_d365_article_and_alias() -> None:
    s = summarize_coils([
        coil("1", 1000, 2, 3.0, "Alu Quartz"),
        coil("2", 1000, 1, 1.0, "Alu RAL 7039 0.7"),
        coil("3", 800, 1, 2.0, "Zinc ATZ 0.8"),
    ])
    rows = {(r.width, r.material): r for r in s.rows if not r.is_empty}
    # L'alias rejoint sa matière officielle (une seule ligne)
    assert rows[(1000, "Alu RAL 7039 0.7")].length_m == 7.0
    assert rows[(1000, "Alu RAL 7039 0.7")].d365_article == "AR00120013"
    assert rows[(800, "Zinc ATZ 0.8")].d365_article is None
    assert all(r.d365_article is None for r in s.rows if r.is_empty)


# --- Non-régression : pièces seules -------------------------------------------------------

def legacy_build_d365_groups(pieces: list[PieceSummaryEntry]) -> tuple[list[dict[str, Any]], list[str]]:
    """Copie fidèle de buildD365Groups (frontend/src/utils/d365Bridge.ts) avant la nouvelle route."""
    summary = summarize_pieces(pieces)
    reference = build_reference()
    groups: list[dict[str, Any]] = []
    unknown: list[str] = []
    for m in summary.materials:
        ref = next((r for r in reference.materials if r.name == m.material), None)
        if ref is None or not ref.d365_matiere:
            unknown.append(m.material)
            continue
        lengths: dict[str, float] = {}
        for bound in reference.piece_bounds_mm:
            row = next(
                (r for r in summary.bound_rows if r.bound == bound and r.material == m.material and not r.is_empty),
                None,
            )
            lengths[str(bound)] = row.length_m if row else 0
        groups.append(
            {"material": m.material, "matiere": ref.d365_matiere, "epaisseur": ref.d365_epaisseur, "lengths": lengths}
        )
    return groups, unknown


PIECES_ONLY_CASES: dict[str, list[PieceSummaryEntry]] = {
    "une matière": [piece("a", 333, 4, 2.5, "Zinc ATZ 0.7"), piece("b", 120, 2, 3.0, "Zinc ATZ 0.7")],
    "plusieurs matières": [
        piece("a", 333, 4, 2.5, "Zinc ATZ 0.7"),
        piece("b", 250, 3, 1.333, "Zinc Quartz 0.8"),
        piece("c", 1000, 1, 6.0, "Alu RAL 7016 0.7"),
        piece("d", 187, 7, 2.15, "Zinc Naturel 0.7"),
    ],
    "DEV à 0 au milieu": [piece("a", 100, 1, 2.0, "Zinc Naturel 0.8"), piece("b", 1100, 2, 4.0, "Zinc Naturel 0.8")],
    "Alu et Zinc, même borne": [
        piece("a", 300, 2, 2.0, "Alu RAL 9005 0.7"),
        piece("b", 290, 1, 1.25, "Zinc ATZ 0.8"),
        piece("c", 300, 5, 3.1, "Alu RAL 7039 0.7"),
        piece("d", 1150, 1, 2.0, "Alu 1.5 Brut"),
        piece("e", 175, 3, 0.333, "Alu RAL 9010 0.7"),
    ],
    "décimales": [piece("a", 150, 3, 0.3333, "Zinc Quartz 0.7"), piece("b", 150, 7, 1.0007, "Zinc Quartz 0.7")],
}


@pytest.mark.parametrize("case", list(PIECES_ONLY_CASES))
def test_pieces_only_identical_to_legacy(case: str) -> None:
    pieces = PIECES_ONLY_CASES[case]
    legacy_groups, unknown = legacy_build_d365_groups(pieces)
    assert unknown == []
    data = dump(pieces, [])
    assert data["version"] == 1
    assert data["errors"] == []
    assert data["warnings"] == []
    assert data["groups"] == legacy_groups
    for group in data["groups"]:
        assert set(group) == V1_KEYS
        assert list(group["lengths"]) == [str(b) for b in build_reference().piece_bounds_mm]


FIXTURES_V1 = sorted((Path(__file__).parent / "fixtures" / "d365_v1").glob("*.json"))


def test_v1_fixtures_present() -> None:
    assert len(FIXTURES_V1) >= 4


@pytest.mark.parametrize("path", FIXTURES_V1, ids=lambda p: p.stem)
def test_pieces_only_identical_to_captured_v1_message(path: Path) -> None:
    """Message v1 capturé sur le site avant le chantier : la route doit rendre les mêmes groupes."""
    fixture = json.loads(path.read_text(encoding="utf-8"))
    order_number = fixture["saisies"]["orderNumber"]
    reset_security_state_for_tests()
    resp = client.post(
        "/api/v1/optimizer/d365-order",
        json={"order_number": order_number, "pieces": fixture["pieces_summary_request"]["entries"]},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["version"] == 1
    assert data["warnings"] == []
    expected = fixture["message_attendu"]
    if fixture.get("envoi_refuse"):
        assert expected is None
        assert [e["message"] for e in data["errors"]] == fixture["statut_affiche"]
        return
    assert data["errors"] == []
    assert data["order_number"] == expected["orderNumber"]
    assert expected["version"] == data["version"]
    assert data["groups"] == expected["groups"]  # ordre des groupes et des bornes compris
    for group, expected_group in zip(data["groups"], expected["groups"]):
        assert list(group) == list(expected_group)
        assert list(group["lengths"]) == list(expected_group["lengths"])
        assert len(group["lengths"]) == 19


def test_pieces_only_unknown_label_same_message() -> None:
    pieces = [
        piece("a", 333, 1, 2.0, "Zinc ATZ 0.7"),
        piece("b", 333, 1, 2.0, "Zinc Pigmento Rouge 0.8"),
        piece("c", 333, 1, 2.0, "Zinc Perforée 1.0"),
    ]
    legacy_groups, unknown = legacy_build_d365_groups(pieces)
    data = dump(pieces, [])
    assert data["groups"] == legacy_groups
    assert len(data["errors"]) == 1
    error = data["errors"][0]
    assert error["code"] == "NO_MATIERE_LABEL"
    assert error["message"] == (
        f"Envoi refusé : libellé D365 pas encore connu pour {', '.join(unknown)}. "
        "Retirez ces saisies ou demandez l'ajout du libellé."
    )


def test_official_names_resolve_to_themselves() -> None:
    """Normaliser les matières ne change rien pour les noms officiels (base de la non-régression)."""
    for name in OFFICIAL_MATERIALS:
        assert resolve_material_spec(name).name == name


# --- Pièces et bobines ----------------------------------------------------------------------

def test_pieces_and_coils_same_material() -> None:
    data = dump(
        [piece("a", 333, 4, 2.5, "Zinc ATZ 0.8")],
        [
            coil("1", 1000, 3, 2.5, "Zinc ATZ 0.8"),
            coil("2", 600, 2, 1.005, "Zinc ATZ 0.8"),
            coil("3", 1000, 1, 0.004, "Zinc ATZ 0.8"),
            coil("4", 0, 2, 1.6, "Zinc ATZ 0.8"),
        ],
    )
    assert data["version"] == 2
    assert data["errors"] == [] and data["warnings"] == []
    [group] = data["groups"]
    assert set(group) == V2_KEYS
    assert group["matiere"] == "ATZ" and group["epaisseur"] == "0.8 mm"
    assert group["has_pieces"] is True
    assert group["lengths"]["333"] == 10.0
    assert group["coils"] == [
        {"width_mm": 600, "article": "AR00002960", "quantity_m": 2.01, "quantity_kg": None},
        {"width_mm": 1000, "article": "AR00002953", "quantity_m": 7.5, "quantity_kg": None},
    ]
    assert group["all_articles"] == ["AR00002953", "AR00002956", "AR00002958", "AR00002960"]
    assert group["chute_m"] == 3.2


def test_pieces_only_material_in_v2_order() -> None:
    data = dump(
        [piece("a", 333, 1, 2.0, "Zinc Naturel 0.7"), piece("b", 500, 1, 2.0, "Zinc ATZ 0.7")],
        [coil("1", 750, 1, 3.0, "Zinc ATZ 0.7")],
    )
    groups = {g["material"]: g for g in data["groups"]}
    assert [g["material"] for g in data["groups"]] == ["Zinc ATZ 0.7", "Zinc Naturel 0.7"]
    naturel = groups["Zinc Naturel 0.7"]
    assert naturel["coils"] == [] and naturel["chute_m"] == 0.0 and naturel["has_pieces"] is True
    assert naturel["all_articles"] == ["AR00002875", "AR00002891", "AR00002896", "AR00002904"]
    assert groups["Zinc ATZ 0.7"]["coils"] == [{"width_mm": 750, "article": "AR00002957", "quantity_m": 3.0, "quantity_kg": None}]


def test_coils_only() -> None:
    data = dump([], [coil("1", 1100, 2, 4.0, "Zinc Naturel 0.8"), coil("2", 650, 1, 2.5, "Alu RAL 9005 0.7")])
    assert data["version"] == 2 and data["errors"] == []
    groups = {g["material"]: g for g in data["groups"]}
    assert [g["material"] for g in data["groups"]] == ["Alu RAL 9005 0.7", "Zinc Naturel 0.8"]
    for g in data["groups"]:
        assert g["has_pieces"] is False
        assert all(v == 0 for v in g["lengths"].values()) and len(g["lengths"]) == 19
    assert groups["Zinc Naturel 0.8"]["coils"] == [{"width_mm": 1100, "article": "AR00002869", "quantity_m": 8.0, "quantity_kg": None}]
    assert groups["Zinc Naturel 0.8"]["matiere"] == "ZN"
    assert groups["Alu RAL 9005 0.7"]["coils"] == [{"width_mm": 650, "article": "AR00106474", "quantity_m": 2.5, "quantity_kg": None}]


def test_alias_merges_pieces_and_coils() -> None:
    data = dump(
        [piece("a", 400, 1, 2.0, "Alu Quartz"), piece("b", 400, 1, 1.0, "Alu RAL 7039 0.7")],
        [coil("1", 1000, 1, 2.0, "Alu Quartz 0.7"), coil("2", 1000, 1, 1.0, "Alu RAL 7039 0.7")],
    )
    [group] = data["groups"]
    assert group["material"] == "Alu RAL 7039 0.7"
    assert group["matiere"] == "ALU PREFA 47 PATINA GRAU"
    assert group["lengths"]["400"] == 3.0
    assert group["coils"] == [{"width_mm": 1000, "article": "AR00120013", "quantity_m": 3.0, "quantity_kg": None}]


def test_chute_without_coil_is_sent() -> None:
    data = dump([], [coil("1", 0, 3, 1.111, "Zinc Quartz 0.8")])
    assert data["version"] == 2 and data["errors"] == [] and data["warnings"] == []
    [group] = data["groups"]
    assert group["coils"] == [] and group["chute_m"] == 3.33 and group["has_pieces"] is False
    assert group["all_articles"] == ["AR00002986", "AR00002990", "AR00002992", "AR00002994"]


# --- Bobines sans code : avertissement, le reste part -------------------------------------

def test_1100_atz_warning_rest_sent() -> None:
    data = dump(
        [piece("a", 333, 1, 2.0, "Zinc ATZ 0.7")],
        [coil("1", 1100, 1, 2.0, "Zinc ATZ 0.7"), coil("2", 1000, 1, 2.0, "Zinc ATZ 0.7")],
    )
    assert data["errors"] == []
    assert data["warnings"] == [{
        "material": "Zinc ATZ 0.7", "code": "NO_COIL_ARTICLE",
        "message": "Zinc ATZ 0.7 : pas de bobine 1100 dans D365. Non envoyée.",
    }]
    assert data["groups"][0]["coils"] == [{"width_mm": 1000, "article": "AR00002954", "quantity_m": 2.0, "quantity_kg": None}]


@pytest.mark.parametrize(("material", "width"), [("Alu RAL 7016 0.7", 650), ("Alu RAL 9010 0.7", 650)])
def test_alu_650_without_code(material: str, width: int) -> None:
    data = dump([piece("a", 333, 1, 2.0, material)], [coil("1", width, 1, 2.0, material)])
    assert data["errors"] == []
    assert data["version"] == 1  # aucune bobine envoyée : message pièces seules
    assert [w["code"] for w in data["warnings"]] == ["NO_COIL_ARTICLE"]
    assert set(data["groups"][0]) == V1_KEYS


@pytest.mark.parametrize("material", ["Zinc Pigmento Rouge 0.8", "Alu 1.5 Brut", "Cuivre 0.60", "Plomb 1.25"])
def test_material_without_any_code(material: str) -> None:
    data = dump([], [coil("1", 1000, 1, 2.0, material), coil("2", 0, 1, 1.0, material)])
    official = resolve_material_spec(material).name
    assert data["groups"] == []
    assert data["warnings"] == [{
        "material": official, "code": "NO_COIL_ARTICLE",
        "message": f"{official} : pas de bobine dans D365. Bobines et chutes non envoyées.",
    }]
    assert [e["code"] for e in data["errors"]] == ["EMPTY"]


def test_pigmento_pieces_and_coils() -> None:
    data = dump([piece("a", 333, 1, 2.0, "Zinc Pigmento Rouge 0.8")], [coil("1", 670, 1, 2.0, "Zinc Pigmento Rouge 0.8")])
    assert [e["code"] for e in data["errors"]] == ["NO_MATIERE_LABEL"]
    assert [w["code"] for w in data["warnings"]] == ["NO_COIL_ARTICLE"]
    assert data["groups"] == []


def test_alu_brut_pieces_with_coils_elsewhere() -> None:
    data = dump(
        [piece("a", 333, 1, 2.0, "Alu 1.5 Brut")],
        [coil("1", 1000, 1, 2.0, "Alu 1.5 Brut"), coil("2", 1000, 1, 2.0, "Zinc ATZ 0.8")],
    )
    groups = {g["material"]: g for g in data["groups"]}
    assert data["version"] == 2 and data["errors"] == []
    assert groups["Alu 1.5 Brut"]["coils"] == [] and groups["Alu 1.5 Brut"]["all_articles"] == []
    assert groups["Alu 1.5 Brut"]["has_pieces"] is True


def test_perforee_sheet_not_coil() -> None:
    data = dump([piece("a", 333, 1, 2.0, "Zinc ATZ 0.8")], [coil("1", 1000, 2, 2.0, "Zinc Perforée 1.0")])
    assert data["version"] == 1 and data["errors"] == []
    assert data["warnings"] == [{
        "material": "Zinc Perforée 1.0", "code": "SHEET_NOT_COIL",
        "message": "Zinc Perforée 1.0 : comptée en feuilles dans D365 (AR00089875), pas en bobine. "
                   "Non envoyée : à saisir à la main.",
    }]


def test_empty_order() -> None:
    data = dump([], [])
    assert data["groups"] == [] and [e["code"] for e in data["errors"]] == ["EMPTY"]


def test_no_ar_code_in_two_groups() -> None:
    data = dump([], [coil(str(i), w, 1, 1.0, m) for i, (m, widths) in enumerate(D365_COIL_ARTICLES.items()) for w in widths])
    seen: list[str] = [a for g in data["groups"] for a in g["all_articles"]]
    assert len(seen) == len(set(seen))
    assert len(data["groups"]) == len(D365_COIL_ARTICLES)
    assert all(len(g["coils"]) == len(g["all_articles"]) for g in data["groups"])


def test_every_coil_material_has_matiere_label() -> None:
    assert set(D365_COIL_ARTICLES) <= set(D365_MATIERE_LABELS)


# --- Route ---------------------------------------------------------------------------------

def test_api_pieces_only_v1_keys() -> None:
    reset_security_state_for_tests()
    resp = client.post(
        "/api/v1/optimizer/d365-order",
        json={"order_number": ORDER, "pieces": [{"id": "a", "dev": 333, "quantity": 2, "unit_length_m": 2.5,
                                                 "material": "Zinc ATZ 0.7"}]},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert set(data) == {"order_number", "version", "groups", "errors", "warnings"}
    assert data["version"] == 1
    assert set(data["groups"][0]) == V1_KEYS
    assert data["groups"][0]["lengths"]["333"] == 5.0


def test_api_v2_keys_and_nulls() -> None:
    reset_security_state_for_tests()
    resp = client.post(
        "/api/v1/optimizer/d365-order",
        json={"order_number": ORDER, "coils": [{"id": "1", "width": 1000, "quantity": 1, "unit_length_m": 2.0,
                                                "material": "Zinc ATZ 0.8"}]},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["version"] == 2
    assert set(data["groups"][0]) == V2_KEYS


@pytest.mark.parametrize("number", ["CC2600023673", "cc26000236736", "CC260002367360", "", "DD26000236736"])
def test_api_invalid_order_number(number: str) -> None:
    reset_security_state_for_tests()
    resp = client.post("/api/v1/optimizer/d365-order", json={"order_number": number, "pieces": []})
    assert resp.status_code == 422


def test_api_caps_and_extra_fields() -> None:
    reset_security_state_for_tests()
    one = {"id": "a", "dev": 333, "quantity": 1, "unit_length_m": 1.0, "material": "Zinc ATZ 0.7"}
    resp = client.post("/api/v1/optimizer/d365-order", json={"order_number": ORDER, "pieces": [one] * 5001})
    assert resp.status_code == 422
    reset_security_state_for_tests()
    c = {"id": "1", "width": 1000, "quantity": 1, "unit_length_m": 1.0, "material": "Zinc ATZ 0.7"}
    resp = client.post("/api/v1/optimizer/d365-order", json={"order_number": ORDER, "coils": [c] * 2001})
    assert resp.status_code == 422
    reset_security_state_for_tests()
    resp = client.post("/api/v1/optimizer/d365-order", json={"order_number": ORDER, "extra": 1})
    assert resp.status_code == 422


# --- Valeur arrondie à 0,00 m : avertissement, pas envoyée ----------------------------------

def test_coil_rounds_to_zero_not_sent() -> None:
    data = dump(
        [piece("a", 333, 1, 2.0, "Zinc ATZ 0.8")],
        [coil("1", 1000, 1, 0.004, "Zinc ATZ 0.8"), coil("2", 600, 1, 2.0, "Zinc ATZ 0.8")],
    )
    assert data["errors"] == []
    assert data["warnings"] == [{
        "material": "Zinc ATZ 0.8", "code": "ROUNDS_TO_ZERO",
        "message": "Zinc ATZ 0.8 : bobine 1000 de 0,004 m, trop courte, non envoyée.",
    }]
    assert data["groups"][0]["coils"] == [{"width_mm": 600, "article": "AR00002960", "quantity_m": 2.0, "quantity_kg": None}]


def test_chute_rounds_to_zero_not_sent() -> None:
    data = dump(
        [piece("a", 333, 1, 2.0, "Zinc Quartz 0.7")],
        [coil("1", 0, 1, 0.004, "Zinc Quartz 0.7")],
    )
    assert data["errors"] == []
    assert data["version"] == 1  # plus rien de bobine à envoyer : message pièces seules
    assert data["warnings"] == [{
        "material": "Zinc Quartz 0.7", "code": "ROUNDS_TO_ZERO",
        "message": "Zinc Quartz 0.7 : chute de 0,004 m, trop courte, non envoyée.",
    }]
    assert set(data["groups"][0]) == V1_KEYS


def test_coil_rounds_to_zero_only_coil_gives_empty() -> None:
    data = dump([], [coil("1", 1000, 1, 0.004, "Zinc ATZ 0.8")])
    assert data["groups"] == []
    assert [w["code"] for w in data["warnings"]] == ["ROUNDS_TO_ZERO"]
    assert [e["code"] for e in data["errors"]] == ["EMPTY"]


# --- Quantité trop grande pour D365 : envoi refusé ------------------------------------------

def test_coil_quantity_too_large_refused() -> None:
    data = dump([], [coil("1", 1000, 10000, 15.0, "Zinc ATZ 0.8"), coil("2", 600, 1, 2.0, "Zinc ATZ 0.8")])
    assert data["errors"] == [{
        "material": "Zinc ATZ 0.8", "code": "QUANTITY_TOO_LARGE",
        "message": "Envoi refusé : Zinc ATZ 0.8 : bobine 1000 de 150000 m, trop longue (100000 m au plus). "
                   "Vérifiez la saisie.",
    }]


def test_chute_quantity_too_large_refused() -> None:
    data = dump([], [coil("1", 0, 10000, 1000.0, "Zinc Quartz 0.8")])
    assert [(e["material"], e["code"]) for e in data["errors"]] == [("Zinc Quartz 0.8", "QUANTITY_TOO_LARGE")]
    assert "chute de 10000000 m" in data["errors"][0]["message"]


def test_quantity_at_limit_accepted() -> None:
    data = dump([], [coil("1", 1000, 100, 1000.0, "Zinc ATZ 0.8"), coil("2", 0, 100, 1000.0, "Zinc ATZ 0.8")])
    assert data["errors"] == []
    assert data["groups"][0]["coils"][0]["quantity_m"] == 100000.0
    assert data["groups"][0]["chute_m"] == 100000.0


# --- Compte des bobines envoyées (coil-summary) ---------------------------------------------

COUNT_CASES: list[list[CoilSummaryEntry]] = [
    [],
    [coil("1", 1000, 2, 3.0, "Zinc ATZ 0.8"), coil("2", 600, 1, 1.0, "Zinc ATZ 0.8")],
    [coil("1", 1100, 1, 2.0, "Zinc ATZ 0.8"), coil("2", 1100, 1, 2.0, "Zinc Naturel 0.8")],
    [coil("1", 1000, 1, 0.004, "Zinc ATZ 0.8"), coil("2", 0, 1, 0.004, "Zinc ATZ 0.8")],
    [coil("1", 1000, 1, 2.0, "Zinc Perforée 1.0"), coil("2", 670, 1, 2.0, "Zinc Pigmento Rouge 0.8")],
    [coil("1", 0, 1, 2.0, "Zinc Quartz 0.7"), coil("2", 0, 1, 2.0, "Alu 1.5 Brut"), coil("3", 800, 1, 1.0, "Zinc ATZ 0.7")],
    [coil("1", 1000, 1, 2.0, "Alu Quartz"), coil("2", 650, 1, 2.0, "Alu RAL 7039 0.7"), coil("3", 0, 2, 1.0, "Alu Quartz")],
]


@pytest.mark.parametrize("coils", COUNT_CASES)
def test_coil_summary_counts_match_d365_order(coils: list[CoilSummaryEntry]) -> None:
    summary = summarize_coils(coils)
    data = dump([piece("a", 333, 1, 2.0, "Zinc ATZ 0.8")], coils)
    groups = data["groups"]
    sent_coils = sum(len(g.get("coils", [])) for g in groups)
    sent_chutes = sum(1 for g in groups if g.get("chute_m", 0) > 0)
    assert summary.d365_coils_to_send == sent_coils
    assert summary.d365_chutes_to_send == sent_chutes


def test_coil_summary_counts_values() -> None:
    summary = summarize_coils(COUNT_CASES[6])
    assert (summary.d365_coils_to_send, summary.d365_chutes_to_send) == (2, 1)
    reset_security_state_for_tests()
    resp = client.post("/api/v1/optimizer/coil-summary", json={"entries": [
        {"id": "1", "width": 1000, "quantity": 1, "unit_length_m": 2.0, "material": "Zinc ATZ 0.8"},
        {"id": "2", "width": 1100, "quantity": 1, "unit_length_m": 2.0, "material": "Zinc ATZ 0.8"},
    ]})
    assert resp.status_code == 200
    assert resp.json()["d365_coils_to_send"] == 1
    assert resp.json()["d365_chutes_to_send"] == 0


# --- Largeurs standard par matière (1100 seulement en Zinc Naturel 0.8) ---------------------

def test_is_standard_per_material() -> None:
    assert encode_coil_entry("1100", 1, "2", "m", "Zinc ATZ 0.8").is_standard is False
    assert encode_coil_entry("1100", 1, "2", "m", "Zinc Naturel 0.8").is_standard is True
    assert encode_coil_entry("650", 1, "2", "m", "Alu RAL 7016 0.7").is_standard is False
    assert encode_coil_entry("650", 1, "2", "m", "Alu RAL 9005 0.7").is_standard is True
    summary = summarize_coils([coil("1", 1100, 1, 2.0, "Zinc ATZ 0.8"), coil("2", 1100, 1, 2.0, "Zinc Naturel 0.8")])
    rows = {r.material: r for r in summary.rows if r.width == 1100 and not r.is_empty}
    assert rows["Zinc ATZ 0.8"].is_standard is False
    assert rows["Zinc Naturel 0.8"].is_standard is True


def test_reference_coil_widths_per_material() -> None:
    ref = {m.name: m for m in build_reference().materials}
    assert ref["Zinc ATZ 0.8"].coil_widths_mm == [600, 670, 750, 1000]
    assert ref["Zinc Naturel 0.8"].coil_widths_mm == [600, 670, 750, 1000, 1100]


def test_patina_grau_650_sent_in_kilos() -> None:
    # AR00131334 (Alu RAL 7039 0.7, 650) : saisi en kilos dans D365 ; poids = 0,65 m × 10 m × 1,89 kg/m²
    data = dump([], [coil("1", 650, 2, 5.0, "Alu RAL 7039 0.7"), coil("2", 1000, 1, 4.0, "Alu RAL 7039 0.7")])
    [group] = data["groups"]
    assert group["coils"] == [
        {"width_mm": 650, "article": "AR00131334", "quantity_m": 10.0, "quantity_kg": 12.29},
        {"width_mm": 1000, "article": "AR00120013", "quantity_m": 4.0, "quantity_kg": None},
    ]
