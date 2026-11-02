"""
Tests des données de référence : largeurs de bobines par matière (liste atelier
validée le 30/10/2026) et route /api/v1/optimizer/reference.
"""

from fastapi.testclient import TestClient

from app.core.constants import OFFICIAL_MATERIALS, STANDARDIZED_MATERIALS, resolve_material_spec
from app.main import app
from app.services.reference_service import build_reference, official_materials_for_width

client = TestClient(app)

ZINC_WIDTHS = (600, 670, 750, 1000, 1100)

# Liste atelier validée : largeurs de bobines disponibles par matière
EXPECTED_WIDTHS: dict[str, tuple[int, ...]] = {
    "Zinc Naturel 0.7": ZINC_WIDTHS,
    "Zinc Naturel 0.8": ZINC_WIDTHS,
    "Zinc ATZ 0.7": ZINC_WIDTHS,
    "Zinc ATZ 0.8": ZINC_WIDTHS,
    "Zinc Quartz 0.7": ZINC_WIDTHS,
    "Zinc Quartz 0.8": ZINC_WIDTHS,
    "Zinc Pigmento Rouge 0.8": (670, 1000),
    "Zinc Perforée 1.0": (1000,),
    "Alu RAL 9005 0.7": (650, 1000),
    "Alu RAL 9010 0.7": (1000,),
    "Alu RAL 7016 0.7": (1000,),
    "Alu RAL 7039 0.7": (650, 1000),
    "Alu 1.5 Brut": (1000,),
}


def test_official_materials_have_validated_widths() -> None:
    assert set(EXPECTED_WIDTHS) == set(OFFICIAL_MATERIALS)
    for name, widths in EXPECTED_WIDTHS.items():
        assert STANDARDIZED_MATERIALS[name].standard_mother_widths_mm == widths, name


def test_aliases_follow_their_base_material() -> None:
    for alias, spec in STANDARDIZED_MATERIALS.items():
        if spec.name in EXPECTED_WIDTHS:
            assert spec.standard_mother_widths_mm == EXPECTED_WIDTHS[spec.name], alias
    assert resolve_material_spec("Alu 9010 Blanc").standard_mother_widths_mm == (1000,)


def test_materials_for_width() -> None:
    assert official_materials_for_width(650) == ["Alu RAL 9005 0.7", "Alu RAL 7039 0.7"]
    assert official_materials_for_width(1100) == [
        "Zinc Naturel 0.7", "Zinc ATZ 0.7", "Zinc Quartz 0.7",
        "Zinc Naturel 0.8", "Zinc ATZ 0.8", "Zinc Quartz 0.8",
    ]
    assert official_materials_for_width(1200) == []


def test_build_reference() -> None:
    ref = build_reference()
    assert [m.name for m in ref.materials] == list(OFFICIAL_MATERIALS)
    assert ref.coil_widths_mm == [600, 650, 670, 750, 1000, 1100]
    brut = next(m for m in ref.materials if m.name == "Alu 1.5 Brut")
    assert brut.family == "ALU"
    assert brut.group == "Alu épaisseur 1.5"
    assert brut.surface_density_kg_m2 == 4.05
    quartz = next(m for m in ref.materials if m.name == "Zinc Quartz 0.7")
    assert quartz.group == "Zinc épaisseur 0.7"
    assert quartz.coil_widths_mm == list(ZINC_WIDTHS)


def test_api_reference() -> None:
    resp = client.get("/api/v1/optimizer/reference")
    assert resp.status_code == 200
    data = resp.json()
    assert data["coil_widths_mm"] == [600, 650, 670, 750, 1000, 1100]
    assert len(data["materials"]) == len(OFFICIAL_MATERIALS)
    assert len(data["piece_bounds_mm"]) == 19
