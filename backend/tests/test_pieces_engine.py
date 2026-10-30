"""
Tests du tableau du calculateur Pièce (pieces-summary) et de l'encodage structuré (pieces-encode).
Les règles reproduisent l'interface d'avant la migration : vue par développement et totaux nets,
grille des bornes à la largeur de la borne, surface du pied de tableau aux bornes.
"""

import pytest
from fastapi.testclient import TestClient

from app.core.admin_security import reset_security_state_for_tests
from app.core.constants import DEV_PIECE_BOUNDS
from app.main import app
from app.models.pieces_summary import PieceEncodeItem, PieceSummaryEntry
from app.services.pieces_engine import encode_pieces, summarize_pieces

client = TestClient(app)


def entry(id_: str, dev: int, qty: int, length: float, material: str) -> PieceSummaryEntry:
    return PieceSummaryEntry(id=id_, dev=dev, quantity=qty, unit_length_m=length, material=material)


def test_empty_summary_has_all_bounds() -> None:
    s = summarize_pieces([])
    assert [r.bound for r in s.bound_rows] == list(DEV_PIECE_BOUNDS)
    assert all(r.is_empty for r in s.bound_rows)
    assert s.dev_rows == []
    assert s.totals.length_m == 0.0


def test_dev_rows_net_values_and_percent() -> None:
    s = summarize_pieces([
        entry("a", 180, 2, 3.0, "Zinc Quartz 0.7"),   # 6 m, borne 187
        entry("b", 180, 1, 4.0, "Zinc Quartz 0.7"),   # 4 m
        entry("c", 250, 5, 2.0, "Alu RAL 7016 0.7"),  # 10 m
    ])
    zinc = next(r for r in s.dev_rows if r.dev == 180)
    assert zinc.bound == 187
    assert zinc.quantity == 3
    assert zinc.length_m == 10.0
    assert zinc.surface_m2 == 1.8            # 0.180 × 10
    assert zinc.weight_kg == 9.07            # 1.8 × 5.04 = 9.072
    assert zinc.percent == 50.0
    assert [c.id for c in zinc.cuts] == ["a", "b"]

    alu = next(r for r in s.dev_rows if r.dev == 250)
    assert alu.weight_kg == 4.72             # 2.5 m² × 1.89 = 4.725
    assert s.totals.length_m == 20.0
    assert s.totals.quantity == 8


def test_bound_rows_use_bound_width() -> None:
    s = summarize_pieces([entry("a", 180, 2, 3.0, "Zinc Quartz 0.7")])
    row = next(r for r in s.bound_rows if r.bound == 187)
    assert not row.is_empty
    assert row.surface_m2 == 1.12            # 0.187 × 6 = 1.122
    assert row.weight_kg == 5.65             # 1.122 × 5.04 = 5.655
    assert row.percent == 100.0
    assert s.totals.surface_bound_m2 == 1.12
    assert s.totals.surface_net_m2 == 1.08   # 0.180 × 6
    assert s.totals.weight_net_kg == 5.44    # 1.08 × 5.04


def test_shared_dev_and_multi_material_bound() -> None:
    s = summarize_pieces([
        entry("a", 150, 1, 2.0, "Zinc Quartz 0.7"),
        entry("b", 150, 1, 2.0, "Alu RAL 7016 0.7"),
        entry("c", 120, 1, 2.0, "Zinc Quartz 0.7"),
    ])
    rows_150 = [r for r in s.dev_rows if r.dev == 150]
    assert all(r.is_shared_dev for r in rows_150)
    assert rows_150[0].shared_with_materials == ["Zinc Quartz 0.7"]
    assert not next(r for r in s.dev_rows if r.dev == 120).is_shared_dev

    bound_150 = [r for r in s.bound_rows if r.bound == 150]
    assert len(bound_150) == 2
    assert all(r.is_multi_material_bound and r.has_shared_dev for r in bound_150)
    bound_120 = next(r for r in s.bound_rows if r.bound == 120)
    assert not bound_120.is_multi_material_bound and not bound_120.has_shared_dev


def test_material_and_family_totals() -> None:
    s = summarize_pieces([
        entry("a", 200, 2, 3.0, "Zinc Quartz 0.7"),
        entry("b", 200, 1, 3.0, "Zinc Naturel 0.8"),
        entry("c", 300, 1, 4.0, "Alu RAL 9005 0.7"),
    ])
    assert [m.material for m in s.materials] == ["Alu RAL 9005 0.7", "Zinc Naturel 0.8", "Zinc Quartz 0.7"]
    assert s.zinc.quantity == 3 and s.zinc.length_m == 9.0
    assert s.zinc.weight_kg == round(6.05 + 3.46, 2)   # 1.2 m² × 5.04 + 0.6 m² × 5.76
    assert s.alu.length_m == 4.0
    assert s.alu.weight_kg == 2.27                     # 1.2 m² × 1.89
    assert sum(m.percent for m in s.materials) == pytest.approx(100.0, abs=0.2)


def test_dev_above_all_bounds_goes_to_max_bound() -> None:
    s = summarize_pieces([entry("a", 1250, 1, 2.0, "Zinc Naturel 0.7")])
    assert next(r for r in s.dev_rows).bound == 1100


def test_encode_pieces() -> None:
    out = encode_pieces([
        PieceEncodeItem(dev=179.6, quantity=4, unit_length_m=2.5, material="zinc quartz", label="Bavette"),
    ])
    assert len(out) == 1
    e = out[0]
    assert e.dev == 180
    assert e.matched_bound == 187
    assert e.total_length_m == 10.0
    assert e.material == "Zinc Quartz 0.7"
    assert e.surface_net_m2 == 1.8
    assert e.raw_input == "Bavette"


def test_api_pieces_routes() -> None:
    reset_security_state_for_tests()
    enc = client.post(
        "/api/v1/optimizer/pieces-encode",
        json={"items": [{"dev": 250, "quantity": 2, "unit_length_m": 3, "material": "Zinc Quartz 0.7"}]},
    )
    assert enc.status_code == 200
    assert enc.json()["entries"][0]["matched_bound"] == 250

    bad = client.post(
        "/api/v1/optimizer/pieces-encode",
        json={"items": [{"dev": 0, "quantity": 1, "unit_length_m": 3}]},
    )
    assert bad.status_code == 422

    summ = client.post(
        "/api/v1/optimizer/pieces-summary",
        json={"entries": [{"id": "a", "dev": 250, "quantity": 2, "unit_length_m": 3, "material": "Zinc Quartz 0.7"}]},
    )
    assert summ.status_code == 200
    data = summ.json()
    assert data["totals"]["length_m"] == 6.0
    assert len(data["bound_rows"]) == len(DEV_PIECE_BOUNDS)


# --- Saisie en 3 cases (quick-encode avec dev_expr / quantity / length_expr) -------------

def test_three_fields_length_formula_applies_per_piece() -> None:
    from app.services.encoder_engine import encode_three_fields

    item = encode_three_fields("175", 4, "2+1", "Zinc Quartz 0.7", "m")
    assert item.quantity == 4
    assert item.unit_length_m == 3.0
    assert item.total_length_m == 12.0     # et non 9 m comme avec '175/4*2+1'
    assert item.matched_bound == 175


def test_three_fields_auto_breakdown_and_units() -> None:
    from app.services.encoder_engine import encode_three_fields

    auto = encode_three_fields("15+120+40", 0, "11.5", "Zinc Naturel 0.7", "m")
    assert auto.dev == 175
    assert auto.is_auto_breakdown is True
    assert auto.unit_length_m == 11.5

    mm = encode_three_fields("250", 2, "3500", "Zinc Naturel 0.7", "mm")
    assert mm.unit_length_m == 3.5 and mm.total_length_m == 7.0

    with pytest.raises(ValueError, match="Développement"):
        encode_three_fields("0", 1, "2", "Zinc Naturel 0.7", "m")
    with pytest.raises(ValueError, match="Longueur"):
        encode_three_fields("175", 1, "abc", "Zinc Naturel 0.7", "m")


def test_api_quick_encode_three_fields() -> None:
    reset_security_state_for_tests()
    resp = client.post(
        "/api/v1/optimizer/quick-encode",
        json={"dev_expr": "175", "quantity": 4, "length_expr": "2+1", "material": "Zinc Quartz 0.7"},
    )
    assert resp.status_code == 200
    assert resp.json()["total_length_m"] == 12.0
    # L'ancien format reste accepté
    old = client.post("/api/v1/optimizer/quick-encode", json={"raw_input": "175/2*3"})
    assert old.status_code == 200 and old.json()["total_length_m"] == 6.0
