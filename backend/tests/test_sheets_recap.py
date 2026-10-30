"""
Tests du récapitulatif des feuilles mères à sortir (sheets_recap de la réponse d'optimisation).
"""

from app.models.optimizer import OptimizationRequest
from app.models.pieces import ShapedPieceModel
from app.services.nesting_engine import run_nesting_optimization


def piece(id_: str, dev: int, length: float, qty: int, material: str) -> ShapedPieceModel:
    return ShapedPieceModel(id=id_, label=f"Pièce {id_}", dev=dev, length=length, quantity=qty, material=material)


def test_recap_matches_new_mother_sheets() -> None:
    resp = run_nesting_optimization(OptimizationRequest(
        material="Zinc Quartz 0.7",
        pieces=[
            piece("a", 333, 2.0, 6, "Zinc Quartz 0.7"),
            piece("b", 250, 3.0, 4, "Alu RAL 9005 0.7"),
        ],
    ))
    new_sheets = [s for s in resp.slits if s.source_type == "MOTHER_COIL"]
    assert resp.sheets_recap_totals.total_sheets == len(new_sheets)

    expected_surface = round(sum(s.mother_width / 1000 * s.mother_length for s in new_sheets), 2)
    assert abs(resp.sheets_recap_totals.total_surface_m2 - expected_surface) <= 0.02

    materials = {m.material for m in resp.sheets_recap}
    assert materials == {"Zinc Quartz 0.7", "Alu RAL 9005 0.7"}
    zinc = next(m for m in resp.sheets_recap if m.material == "Zinc Quartz 0.7")
    assert zinc.surface_density_kg_m2 == 5.04
    assert zinc.total_weight_kg == round(sum(f.total_weight_kg for f in zinc.formats), 2)
    produced = sum(p.count for f in zinc.formats for p in f.pieces)
    assert produced == 6


def test_recap_ignores_reused_offcuts() -> None:
    resp = run_nesting_optimization(OptimizationRequest(
        material="Zinc Naturel 0.7",
        pieces=[
            piece("p4", 280, 4.0, 1, "Zinc Naturel 0.7"),
            piece("p35", 280, 3.5, 1, "Zinc Naturel 0.7"),
        ],
        available_mother_widths=[600],
        use_generated_scraps=True,
    ))
    assert any(s.source_type == "REUSED_OFFCUT" for s in resp.slits)
    assert resp.sheets_recap_totals.total_sheets == 1
    fmt = resp.sheets_recap[0].formats[0]
    assert (fmt.mother_width, fmt.mother_length, fmt.count) == (600, 4.0, 1)
    assert fmt.total_surface_m2 == 2.4
    assert fmt.total_weight_kg == 12.1   # 2.4 m² × 5.04 = 12.096


def test_slit_yield_and_input_totals() -> None:
    resp = run_nesting_optimization(OptimizationRequest(
        material="Zinc Quartz 0.7",
        pieces=[piece("a", 333, 2.0, 6, "Zinc Quartz 0.7"), piece("b", 175, 3.0, 2, "Zinc Quartz 0.7")],
    ))
    for s in resp.slits:
        assert s.yield_percent == round(s.used_width / s.mother_width * 100, 1)
        assert s.mother_surface_m2 == round(s.mother_width / 1000 * s.mother_length, 2)
    assert resp.input_total_pieces == 8
    assert resp.input_total_length_m == 18.0
    assert resp.input_total_surface_m2 == round(0.333 * 12 + 0.175 * 6, 2)
