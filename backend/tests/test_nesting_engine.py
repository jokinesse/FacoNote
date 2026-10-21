"""
Tests unitaires pour le moteur de refente et nesting 1D/2D (nesting_engine).
Spécification technique : Section 3.3 du Cahier des Charges.
"""

import pytest
from app.models.optimizer import OptimizationRequest
from app.models.pieces import ShapedPieceModel
from app.services.nesting_engine import run_nesting_optimization


def test_material_segregation() -> None:
    """
    Étape 1 : Ségrégation par matière.
    Les pièces en Zinc et Aluminium ne doivent jamais être découpées sur une même feuille mère.
    """
    pieces = [
        ShapedPieceModel(
            id="p-zinc",
            label="Bavette Zinc",
            dev=250,
            length=2.0,
            quantity=2,
            bends=2,
            material="Zinc Naturel 0.7",
        ),
        ShapedPieceModel(
            id="p-alu",
            label="Bavette Alu",
            dev=250,
            length=2.0,
            quantity=2,
            bends=2,
            material="Alu 7016 gris bleu 0.7",
        ),
    ]

    req = OptimizationRequest(
        client_name="Test Client",
        chantier_ref="Chantier Mixte",
        material="Zinc Naturel 0.7",
        pieces=pieces,
    )

    resp = run_nesting_optimization(req)

    # Vérification que chaque laize mère ne contient qu'une seule matière
    assert len(resp.slits) >= 2
    for slit in resp.slits:
        materials_in_slit = {s.material for s in slit.strips}
        assert len(materials_in_slit) == 1
        # La matière de la laize correspond à la matière des bandes
        assert slit.material in ("Zinc Naturel 0.7", "Alu RAL 7016 0.7", "Alu 7016 gris bleu 0.7")


def test_length_cohort_partitioning() -> None:
    """
    Étape 2 : Cohortes de longueur.
    Les bandes sont partitionnées par longueur unitaire L.
    Une feuille de 2.0m ne peut pas contenir de bandes de 3.0m.
    """
    pieces = [
        ShapedPieceModel(
            id="p-2m",
            label="Pièce 2m",
            dev=200,
            length=2.0,
            quantity=2,
            bends=1,
            material="Zinc Naturel 0.7",
        ),
        ShapedPieceModel(
            id="p-3m",
            label="Pièce 3m",
            dev=200,
            length=3.0,
            quantity=2,
            bends=1,
            material="Zinc Naturel 0.7",
        ),
    ]

    req = OptimizationRequest(
        material="Zinc Naturel 0.7",
        pieces=pieces,
    )

    resp = run_nesting_optimization(req)

    for slit in resp.slits:
        lengths_in_slit = {s.length for s in slit.strips}
        assert len(lengths_in_slit) == 1
        assert slit.mother_length in (2.0, 3.0)


def test_transversal_combination_perfect_fit() -> None:
    """
    Étape 3 : Combinaison transversale (Subset-Sum / Branch & Bound).
    Deux bandes de 250 mm et une bande de 500 mm sur une laize de 1000 mm :
    Développé total = 250 + 250 + 500 = 1000 mm -> Chute = 0 mm.
    """
    pieces = [
        ShapedPieceModel(
            id="p-250",
            label="Couvre-mur 250",
            dev=250,
            length=2.5,
            quantity=2,
            bends=2,
            material="Zinc Naturel 0.7",
        ),
        ShapedPieceModel(
            id="p-500",
            label="Couvre-mur 500",
            dev=500,
            length=2.5,
            quantity=1,
            bends=2,
            material="Zinc Naturel 0.7",
        ),
    ]

    req = OptimizationRequest(
        material="Zinc Naturel 0.7",
        pieces=pieces,
        available_mother_widths=[1000],
    )

    resp = run_nesting_optimization(req)

    assert len(resp.slits) == 1
    slit = resp.slits[0]
    assert slit.mother_width == 1000
    assert slit.used_width == 1000
    assert slit.scrap_width == 0
    assert resp.net_loss_surface_m2 == 0.0
    assert resp.material_efficiency_rate == 100.0


def test_reusable_scrap_qualification() -> None:
    """
    Étape 4 : Qualification des chutes.
    Une chute de largeur >= 100 mm et longueur >= 1.0 m est qualifiée de chute réutilisable
    avec code CHU-MAT-WIDTH-LENM.
    Si largeur < 100 mm, perte sèche.
    """
    # 1 pièce de dev 800 mm sur laize 1000 mm, longueur 2.0 m -> chute de 200 mm >= 100 mm
    pieces = [
        ShapedPieceModel(
            id="p-800",
            label="Bande 800",
            dev=800,
            length=2.0,
            quantity=1,
            bends=1,
            material="Zinc Naturel 0.7",
        )
    ]

    req = OptimizationRequest(
        material="Zinc Naturel 0.7",
        pieces=pieces,
        available_mother_widths=[1000],
    )

    resp = run_nesting_optimization(req)

    assert len(resp.slits) == 1
    slit = resp.slits[0]
    assert slit.scrap_width == 200
    assert slit.is_scrap_reusable is True
    assert slit.suggested_scrap_ref == "CHU-ZN-200-2.0M"
    # Surface chute réutilisable = 0.20 * 2.0 = 0.40 m²
    assert resp.reusable_scrap_surface_m2 == 0.40
    # Perte sèche = 0.0
    assert resp.net_loss_surface_m2 == 0.0


def test_rack_scrap_detection_and_substitution() -> None:
    """
    Étape 5 : Détection des chutes de rack.
    Si une tôle isolée génère une perte >= 45%, émettre une proposition de rack scrap.
    Si use_workshop_scraps est True, substituer et éviter le débit de la tôle mère.
    """
    # 1 pièce isolée de dev 120 mm, longueur 2.0m
    # Sur laize min Zinc (600 mm) : chute = 480 mm -> 480/600 = 80% de perte (> 45%)
    pieces = [
        ShapedPieceModel(
            id="p-iso",
            label="Profilé isolé",
            dev=120,
            length=2.0,
            quantity=1,
            bends=2,
            material="Zinc Naturel 0.7",
        )
    ]

    # Sans substitution (baseline)
    req_baseline = OptimizationRequest(
        material="Zinc Naturel 0.7",
        pieces=pieces,
        use_workshop_scraps=False,
    )
    resp_baseline = run_nesting_optimization(req_baseline)

    assert len(resp_baseline.workshop_scrap_proposals) >= 1
    prop = resp_baseline.workshop_scrap_proposals[0]
    assert prop.piece_id == "p-iso"
    assert prop.recommended_scrap_dev == 120  # Trouve la bande de 120 mm dans [100, 120, 150, 200, 250]
    assert prop.area_saved_m2 > 0

    # Avec substitution activée
    req_with_scraps = OptimizationRequest(
        material="Zinc Naturel 0.7",
        pieces=pieces,
        use_workshop_scraps=True,
    )
    resp_scraps = run_nesting_optimization(req_with_scraps)

    # La pièce a été substituée par une chute de rack -> aucune bobine mère débitée
    assert len(resp_scraps.slits) == 0
    assert len(resp_scraps.applied_workshop_scraps) == 1
    assert resp_scraps.applied_workshop_scraps[0].scrap_dev == 120
    # Surface brute = 0.12 * 2.0 = 0.24 m² (au lieu de 0.60 * 2.0 = 1.20 m²)
    assert resp_scraps.total_gross_surface_m2 == 0.24


def test_cross_length_generated_chute_reuse() -> None:
    """
    Test du cas réel utilisateur :
    Pièce 1 : dev 280 mm, longueur 4.0 m
    Pièce 2 : dev 280 mm, longueur 3.5 m
    Sur laize 600 mm (Alu 7016) :
    - Sans réemploi de chute générée : 2 tôles mères de 600 mm (4.0m et 3.5m) -> brute = 4.50 m², rendement = 46.7%
    - Avec réemploi de chute générée : Pièce 2 débitée dans la chute 320 mm x 4.0 m de l'OP #1 !
      -> 1 seule tôle mère de 600 mm x 4.0m débitée (brute = 2.40 m² au lieu de 4.50 m²)
      -> rendement matière = 87.5% !
    """
    pieces = [
        ShapedPieceModel(
            id="p-4m",
            label="Façonnage Dév 280 mm (4m)",
            dev=280,
            length=4.0,
            quantity=1,
            material="Alu 7016 gris bleu 0.7",
        ),
        ShapedPieceModel(
            id="p-3m50",
            label="Façonnage Dév 280 mm (3.5m)",
            dev=280,
            length=3.5,
            quantity=1,
            material="Alu 7016 gris bleu 0.7",
        ),
    ]

    # 1. Avec réemploi actif (par défaut)
    req_optimized = OptimizationRequest(
        material="Alu 7016 gris bleu 0.7",
        pieces=pieces,
        available_mother_widths=[600],
        use_generated_scraps=True,
    )
    resp_opt = run_nesting_optimization(req_optimized)

    assert len(resp_opt.slits) == 2
    op1 = resp_opt.slits[0]
    op2 = resp_opt.slits[1]

    # OP #1 est sur bobine mère neuve
    assert op1.source_type == "MOTHER_COIL"
    assert op1.mother_width == 600
    assert op1.mother_length == 4.0
    assert op1.used_width == 280
    assert op1.scrap_width == 320

    # OP #2 est une reprise sur la chute issue de OP #1
    assert op2.source_type == "REUSED_OFFCUT"
    assert op2.source_op_index == 1
    assert op2.mother_width == 320  # largeur de la chute
    assert op2.mother_length == 3.5  # longueur utile
    assert op2.original_offcut_length == 4.0
    assert op2.offcut_cut_length == 0.5  # tronçonnage en bout (4.0 - 3.5)
    assert op2.used_width == 280
    assert op2.scrap_width == 40  # 320 - 280

    # Surface brute ne compte que la tôle mère d'origine de 4.0 m
    assert resp_opt.total_gross_surface_m2 == 2.40
    # Rendement = 2.10 / 2.40 = 87.5%
    assert resp_opt.material_efficiency_rate == 87.5

    # 2. Sans réemploi (calcul traditionnel en cohortes étanches)
    req_disabled = OptimizationRequest(
        material="Alu 7016 gris bleu 0.7",
        pieces=pieces,
        available_mother_widths=[600],
        use_generated_scraps=False,
    )
    resp_dis = run_nesting_optimization(req_disabled)

    assert len(resp_dis.slits) == 2
    assert resp_dis.slits[0].source_type == "MOTHER_COIL"
    assert resp_dis.slits[1].source_type == "MOTHER_COIL"
    assert resp_dis.total_gross_surface_m2 == 4.50  # 2 tôles mères complètes (2.40 + 2.10)
    # L'OP #2 consomme une pleine laize de 600 mm au lieu de la chute de 320 mm
    assert resp_dis.slits[1].mother_width == 600


def test_manual_rack_scrap_piece_exclusion() -> None:
    """
    Vérifie qu'une pièce marquée explicitement source_type='RACK_SCRAP'
    est exclue du calcul de refente sur bobine mère et directement assignée
    aux chutes d'atelier (manual_rack_scraps).
    """
    pieces = [
        ShapedPieceModel(
            id="p-standard",
            label="Gouttière",
            dev=450,
            length=3.0,
            quantity=1,
            bends=3,
            material="Zinc Naturel 0.7",
            source_type="BOBINE",
        ),
        ShapedPieceModel(
            id="p-chute",
            label="Petite pièce 150mm",
            dev=150,
            length=2.0,
            quantity=1,
            bends=1,
            material="Zinc Naturel 0.7",
            source_type="RACK_SCRAP",
        ),
    ]

    req = OptimizationRequest(
        material="Zinc Naturel 0.7",
        pieces=pieces,
        available_mother_widths=[500, 600],
    )

    resp = run_nesting_optimization(req)

    # La pièce en chute manuelle doit figurer dans applied_workshop_scraps
    assert len(resp.applied_workshop_scraps) == 1
    assert resp.applied_workshop_scraps[0].piece_label == "Petite pièce 150mm"
    assert resp.applied_workshop_scraps[0].piece_dev == 150
    assert resp.applied_workshop_scraps[0].piece_length == 2.0
    assert resp.applied_workshop_scraps[0].scrap_dev >= 150

    # Seule la pièce 'p-standard' doit être refendue sur bobine
    all_strips_pieces = [
        strip.label
        for slit in resp.slits
        for strip in slit.strips
    ]
    assert "Petite pièce 150mm" not in all_strips_pieces
    assert "Gouttière" in all_strips_pieces


def test_partial_piece_split_155mm_individual_scrap() -> None:
    """
    Cas réel : 4 pièces de 155 mm sur bobine de 600 mm (3 rentrent sur la 1ère feuille = 465 mm,
    la 4ème déborde seule sur une 2ème feuille).
    Lorsque l'opérateur bascule uniquement 1 pièce sur les 4 en RACK_SCRAP (3 sur BOBINE + 1 en RACK_SCRAP),
    la 2ème feuille disparaît et les 3 premières pièces restent sur la 1ère feuille mère.
    """
    # Avant scission : 4 pièces de 155 mm sur BOBINE -> nécessite 2 feuilles de 600 mm
    req_before = OptimizationRequest(
        material="Zinc Naturel 0.7",
        pieces=[
            ShapedPieceModel(
                id="p-155",
                label="Façonnage Dév 155 mm",
                dev=155,
                length=2.0,
                quantity=4,
                bends=2,
                material="Zinc Naturel 0.7",
                source_type="BOBINE",
            )
        ],
        available_mother_widths=[600],
    )
    resp_before = run_nesting_optimization(req_before)
    assert len(resp_before.slits) == 2

    # Après scission unitaire : 3 pièces sur BOBINE + 1 pièce en RACK_SCRAP
    req_after = OptimizationRequest(
        material="Zinc Naturel 0.7",
        pieces=[
            ShapedPieceModel(
                id="p-155",
                label="Façonnage Dév 155 mm",
                dev=155,
                length=2.0,
                quantity=3,
                bends=2,
                material="Zinc Naturel 0.7",
                source_type="BOBINE",
            ),
            ShapedPieceModel(
                id="p-155-chute",
                label="Façonnage Dév 155 mm",
                dev=155,
                length=2.0,
                quantity=1,
                bends=2,
                material="Zinc Naturel 0.7",
                source_type="RACK_SCRAP",
            ),
        ],
        available_mother_widths=[600],
    )
    resp_after = run_nesting_optimization(req_after)

    # Une seule feuille mère de 600 mm contient les 3 pièces (3 x 155 = 465 mm)
    assert len(resp_after.slits) == 1
    assert resp_after.slits[0].used_width == 465
    assert resp_after.slits[0].strips[0].qty == 3

    # Et 1 seule pièce est prélevée en chute rack (200 mm)
    assert len(resp_after.applied_workshop_scraps) == 1
    assert resp_after.applied_workshop_scraps[0].piece_dev == 155
    assert resp_after.applied_workshop_scraps[0].scrap_dev == 200


