"""
Tests du calculateur Bobine : validation des saisies, tableau largeur × matière,
chutes par matière (hors totaux), résumés ALU/ZINC et routes API.
"""

import pytest
from fastapi.testclient import TestClient

from app.core.constants import DEV_BOBINE_BOUNDS
from app.core.admin_security import reset_security_state_for_tests
from app.main import app
from app.models.coils import CoilSummaryEntry
from app.services.coil_engine import encode_coil_entry, metal_family, summarize_coils

client = TestClient(app)


def entry(id_: str, width: int, qty: int, length: float, material: str) -> CoilSummaryEntry:
    return CoilSummaryEntry(id=id_, width=width, quantity=qty, unit_length_m=length, material=material)


# --- encode_coil_entry ---------------------------------------------------------------

def test_encode_standard_entry() -> None:
    item = encode_coil_entry("1000", 3, "2.5", "m", "Zinc Quartz 0.7")
    assert item.width == 1000
    assert item.quantity == 3
    assert item.unit_length_m == 2.5
    assert item.total_length_m == 7.5
    assert item.material == "Zinc Quartz 0.7"
    assert item.is_chute is False
    assert item.is_standard is True


def test_encode_length_expression_and_comma() -> None:
    item = encode_coil_entry("650", 2, "2*1,5+1", "m", "Alu RAL 7016 0.7")
    assert item.unit_length_m == 4.0
    assert item.total_length_m == 8.0


def test_encode_length_in_mm() -> None:
    item = encode_coil_entry("670", 4, "3500", "mm", "Zinc Naturel 0.7")
    assert item.unit_length_m == 3.5
    assert item.total_length_m == 14.0


def test_encode_chute_and_non_standard_width() -> None:
    chute = encode_coil_entry("0", 1, "4.2", "m", "Zinc Naturel 0.7")
    assert chute.is_chute is True
    assert chute.is_standard is False

    odd = encode_coil_entry("1200", 1, "2", "m", "Zinc Naturel 0.7")
    assert odd.is_chute is False
    assert odd.is_standard is False


def test_encode_normalizes_material() -> None:
    item = encode_coil_entry("1000", 1, "2", "m", "alu 9005")
    assert item.material == "Alu RAL 9005 0.7"


@pytest.mark.parametrize(
    ("width", "qty", "length"),
    [("-5", 1, "2"), ("abc", 1, "2"), ("1000", 0, "2"), ("1000", 1, "0"), ("1000", 1, "")],
)
def test_encode_invalid_inputs(width: str, qty: int, length: str) -> None:
    with pytest.raises(ValueError):
        encode_coil_entry(width, qty, length, "m", "Zinc Naturel 0.7")


def test_encode_error_names_the_field() -> None:
    with pytest.raises(ValueError, match="Largeur"):
        encode_coil_entry("abc", 1, "2", "m", "Zinc Naturel 0.7")
    with pytest.raises(ValueError, match="Longueur"):
        encode_coil_entry("1000", 1, "abc", "m", "Zinc Naturel 0.7")


# --- summarize_coils -----------------------------------------------------------------

def test_summary_empty_has_standard_grid() -> None:
    summary = summarize_coils([])
    assert [r.width for r in summary.rows] == list(DEV_BOBINE_BOUNDS)
    assert all(r.is_empty for r in summary.rows)
    assert summary.totals.length_m == 0.0
    assert summary.chutes == []


def test_summary_groups_by_width_and_material() -> None:
    summary = summarize_coils([
        entry("a", 1000, 3, 2.5, "Zinc Quartz 0.7"),
        entry("b", 1000, 1, 4.0, "Zinc Quartz 0.7"),
        entry("c", 1000, 2, 3.0, "Alu RAL 7016 0.7"),
        entry("d", 650, 1, 2.0, "Alu RAL 7016 0.7"),
    ])
    filled = [r for r in summary.rows if not r.is_empty]
    assert [(r.width, r.material) for r in filled] == [
        (650, "Alu RAL 7016 0.7"),
        (1000, "Alu RAL 7016 0.7"),
        (1000, "Zinc Quartz 0.7"),
    ]

    zinc_1000 = filled[2]
    assert zinc_1000.quantity == 4
    assert zinc_1000.length_m == 11.5
    assert zinc_1000.surface_m2 == 11.5
    assert zinc_1000.weight_kg == 57.96  # 11.5 m² × 5.04 kg/m²
    assert zinc_1000.family == "ZINC"
    assert zinc_1000.materials_in_width == 2
    assert [s.id for s in zinc_1000.sheets] == ["a", "b"]

    alu_650 = filled[0]
    assert alu_650.surface_m2 == 1.3
    assert alu_650.weight_kg == 2.46  # 1.3 m² × 1.89 kg/m² = 2.457
    assert alu_650.materials_in_width == 1
    assert alu_650.family == "ALU"

    # La largeur 650 est occupée : pas de ligne vide en plus ; 1000 non plus
    assert [r.width for r in summary.rows if r.is_empty] == [600, 670, 750, 1100]


def test_summary_totals_and_family_split() -> None:
    summary = summarize_coils([
        entry("a", 1000, 3, 2.5, "Zinc Quartz 0.7"),
        entry("b", 1000, 2, 3.0, "Alu RAL 7016 0.7"),
    ])
    assert summary.totals.quantity == 5
    assert summary.totals.length_m == 13.5
    assert summary.totals.surface_m2 == 13.5
    assert summary.totals.weight_kg == round(37.8 + 11.34, 2)
    assert summary.zinc.quantity == 3 and summary.zinc.length_m == 7.5
    assert summary.alu.quantity == 2 and summary.alu.length_m == 6.0


def test_summary_chutes_by_material_out_of_totals() -> None:
    summary = summarize_coils([
        entry("a", 1000, 1, 2.0, "Zinc Naturel 0.7"),
        entry("c1", 0, 2, 1.5, "Zinc Naturel 0.7"),
        entry("c2", 0, 1, 0.8, "Alu RAL 9005 0.7"),
        entry("c3", 0, 1, 1.0, "Zinc Naturel 0.7"),
    ])
    assert summary.totals.length_m == 2.0
    assert summary.totals.quantity == 1
    assert summary.totals.chutes_quantity == 4
    assert summary.totals.chutes_length_m == 4.8
    assert [(c.material, c.quantity, c.length_m) for c in summary.chutes] == [
        ("Alu RAL 9005 0.7", 1, 0.8),
        ("Zinc Naturel 0.7", 3, 4.0),
    ]
    assert [s.id for s in summary.chutes[1].sheets] == ["c1", "c3"]


def test_summary_non_standard_width() -> None:
    summary = summarize_coils([entry("a", 820, 1, 2.0, "Zinc Naturel 0.7")])
    row = next(r for r in summary.rows if r.width == 820)
    assert row.is_standard is False
    assert row.is_empty is False


def test_summary_lists_available_materials_per_width() -> None:
    summary = summarize_coils([])
    by_width = {r.width: r.available_materials for r in summary.rows}
    assert by_width[650] == [
        "Alu RAL 7016 0.7", "Alu RAL 9005 0.7", "Alu RAL 9010 0.7", "Alu RAL 7039 0.7",
    ]
    assert "Zinc Pigmento Rouge 0.8" not in by_width[600]
    assert "Zinc Pigmento Rouge 0.8" in by_width[670]
    assert "Zinc Perforée 1.0" not in by_width[1100]
    assert "Zinc Quartz 0.7" in by_width[600]
    assert not any(m.startswith("Alu") for m in by_width[600])
    assert len(by_width[1000]) == 13  # toutes les matières officielles


def test_metal_family() -> None:
    assert metal_family("Alu RAL 7016 0.7") == "ALU"
    assert metal_family("Zinc Quartz 0.8") == "ZINC"
    assert metal_family("Cuivre 0.60") == "AUTRE"


# --- Routes API ------------------------------------------------------------------------

def test_api_coil_encode() -> None:
    reset_security_state_for_tests()
    resp = client.post(
        "/api/v1/optimizer/coil-encode",
        json={"width": "1000", "quantity": 2, "length": "2*1.5", "length_unit": "m", "material": "Zinc Quartz 0.7"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["unit_length_m"] == 3.0
    assert data["total_length_m"] == 6.0
    assert data["is_standard"] is True


def test_api_coil_encode_errors() -> None:
    reset_security_state_for_tests()
    bad_len = client.post(
        "/api/v1/optimizer/coil-encode",
        json={"width": "1000", "quantity": 1, "length": "0", "material": "Zinc Quartz 0.7"},
    )
    assert bad_len.status_code == 422

    div_zero = client.post(
        "/api/v1/optimizer/coil-encode",
        json={"width": "1000", "quantity": 1, "length": "2/0", "material": "Zinc Quartz 0.7"},
    )
    assert div_zero.status_code == 422

    bad_qty = client.post(
        "/api/v1/optimizer/coil-encode",
        json={"width": "1000", "quantity": 0, "length": "2", "material": "Zinc Quartz 0.7"},
    )
    assert bad_qty.status_code == 422


def test_api_coil_summary() -> None:
    reset_security_state_for_tests()
    resp = client.post(
        "/api/v1/optimizer/coil-summary",
        json={"entries": [
            {"id": "a", "width": 1000, "quantity": 3, "unit_length_m": 2.5, "material": "Zinc Quartz 0.7"},
            {"id": "b", "width": 0, "quantity": 1, "unit_length_m": 1.2, "material": "Zinc Quartz 0.7"},
        ]},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["totals"]["length_m"] == 7.5
    assert data["totals"]["chutes_length_m"] == 1.2
    assert data["standard_widths"] == list(DEV_BOBINE_BOUNDS)
    assert len(data["chutes"]) == 1
