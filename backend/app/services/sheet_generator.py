"""
Générateur de Fiche de Débit Atelier A4 normalisée pour façonneurs Facozinc.
Spécification technique : Section 2.5 du Cahier des Charges.
Produit un document HTML5/CSS prêt pour l'impression A4 et massicotage.
"""

from datetime import datetime
from typing import Optional
from app.models.optimizer import OptimizationResponse
from app.models.pieces import ShapedPieceModel


def generate_workshop_sheet_html(
    client_name: str,
    chantier_ref: str,
    pieces: list[ShapedPieceModel],
    optimization: Optional[OptimizationResponse] = None,
    job_code: Optional[str] = None,
    order_date: Optional[str] = None,
) -> str:
    """
    Génère le code HTML complet de la fiche de débit d'atelier A4.
    """
    code = job_code or f"FZ-DEBIT-{datetime.now().strftime('%Y%m%d-%H%M')}"
    date_str = order_date or datetime.now().strftime("%d/%m/%Y")

    total_pieces = sum(p.quantity for p in pieces)
    total_linear_meters = round(sum(p.length * p.quantity for p in pieces), 2)
    total_surface_m2 = round(sum((p.dev / 1000.0) * p.length * p.quantity for p in pieces), 2)
    total_bends = sum(p.bends * p.quantity for p in pieces)

    material_summary = pieces[0].material if pieces else "Zinc Naturel 0.7"

    # Construction des lignes du tableau de nomenclature
    pieces_rows_html = []
    for idx, p in enumerate(pieces, start=1):
        line_meters = round(p.length * p.quantity, 2)
        split_reason = p.workshop_split_reason or "Longueur standard"
        row = f"""
        <tr>
            <td style="text-align: center; font-weight: bold;">{idx}</td>
            <td style="font-weight: 600;">{p.label}</td>
            <td style="text-align: right; font-weight: bold;">{p.dev} mm</td>
            <td style="text-align: right;">{p.length:.2f} m</td>
            <td style="text-align: right; font-weight: bold;">{p.quantity}</td>
            <td style="text-align: right;">{line_meters:.2f} m</td>
            <td style="text-align: center;">{p.bends}</td>
            <td style="color: #475569; font-size: 11px;">{split_reason}</td>
        </tr>
        """
        pieces_rows_html.append(row)

    # Bon de sortie des bobines mères
    coils_withdrawal_html = ""
    reusable_scraps_html = ""
    efficiency_badge_html = ""

    if optimization:
        efficiency_badge_html = f"""
        <div class="kpi-box">
            <span class="kpi-title">Rendement Matière</span>
            <span class="kpi-val" style="color: #15803d;">{optimization.material_efficiency_rate}%</span>
            <span class="kpi-sub">{optimization.total_net_surface_m2} m² nets / {optimization.total_gross_surface_m2} m² bruts</span>
        </div>
        <div class="kpi-box">
            <span class="kpi-title">Poids Total Débit</span>
            <span class="kpi-val">{optimization.gross_weight_kg} kg</span>
            <span class="kpi-sub">Net : {optimization.net_weight_kg} kg</span>
        </div>
        <div class="kpi-box">
            <span class="kpi-title">Perte Sèche</span>
            <span class="kpi-val" style="color: #b91c1c;">{optimization.net_loss_surface_m2} m²</span>
            <span class="kpi-sub">Chutes réutilisables : {optimization.reusable_scrap_surface_m2} m²</span>
        </div>
        """

        # Section Bobines mères à sortir
        coil_items = []
        for idx, slit in enumerate(optimization.slits, start=1):
            total_strips = sum(st.qty for st in slit.strips)
            if slit.source_type == "REUSED_OFFCUT":
                cut_info = f", tronçonner {slit.offcut_cut_length}m en tête" if slit.offcut_cut_length else ""
                coil_items.append(
                    f"<li style='color: #0369a1;'><strong>♻️ OP #{idx} : Reprise sur Chute Débit (Issue de OP #{slit.source_op_index})</strong> : "
                    f"Largeur {slit.mother_width} mm × Longueur utile {slit.mother_length} m{cut_info} "
                    f"<span style='color: #64748b;'>(Découpe de {total_strips} bande(s), reste {slit.scrap_width} mm)</span></li>"
                )
            else:
                coil_items.append(
                    f"<li><strong>OP #{idx} : Bobine Laize {slit.mother_width} mm</strong> ({slit.material}) : <strong>{slit.mother_length} m</strong> "
                    f"<span style='color: #64748b;'>(Découpe de {total_strips} bande(s), reste {slit.scrap_width} mm)</span></li>"
                )
        for scrap in optimization.applied_workshop_scraps:
            coil_items.append(
                f"<li style='color: #b45309;'><strong>Chute Atelier Rack ({scrap.piece_label})</strong> : "
                f"Bande Dév {scrap.scrap_dev} mm × {scrap.piece_length} m</li>"
            )

        coils_withdrawal_html = "".join(coil_items) if coil_items else "<li>Débit direct standard</li>"

        # Section Nouvelles chutes réutilisables
        new_scraps = [s for s in optimization.slits if s.is_scrap_reusable and s.suggested_scrap_ref]
        if new_scraps:
            scraps_items = [
                f"<li><strong>{s.suggested_scrap_ref}</strong> : Largeur {s.scrap_width} mm × Longueur {s.mother_length} m</li>"
                for s in new_scraps
            ]
            reusable_scraps_html = "".join(scraps_items)
        else:
            reusable_scraps_html = "<li style='color: #64748b;'>Aucune chute réutilisable (>100mm) générée.</li>"

    html_content = f"""<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <title>Fiche de Débit Facozinc - {code}</title>
    <style>
        @page {{
            size: A4 portrait;
            margin: 10mm;
        }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            color: #0f172a;
            background-color: #ffffff;
            margin: 0;
            padding: 10px;
            font-size: 12px;
            line-height: 1.4;
        }}
        .header {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 3px solid #0f172a;
            padding-bottom: 8px;
            margin-bottom: 12px;
        }}
        .brand {{
            display: flex;
            align-items: center;
            gap: 12px;
        }}
        .logo-box {{
            background: #0f172a;
            color: #f59e0b;
            font-weight: 900;
            font-size: 24px;
            padding: 4px 10px;
            border-radius: 4px;
        }}
        .brand-text h1 {{
            margin: 0;
            font-size: 22px;
            font-weight: 900;
            letter-spacing: -0.5px;
            text-transform: uppercase;
        }}
        .brand-text p {{
            margin: 0;
            font-size: 10px;
            color: #475569;
            font-weight: 600;
            text-transform: uppercase;
        }}
        .header-meta {{
            text-align: right;
        }}
        .header-meta .code {{
            font-family: monospace;
            font-size: 16px;
            font-weight: bold;
            color: #0f172a;
        }}
        .header-meta .date {{
            font-size: 11px;
            color: #64748b;
        }}
        .info-grid {{
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 10px 14px;
            margin-bottom: 14px;
        }}
        .info-item .label {{
            font-size: 9px;
            text-transform: uppercase;
            font-weight: 700;
            color: #64748b;
            margin-bottom: 2px;
        }}
        .info-item .val {{
            font-size: 13px;
            font-weight: 700;
            color: #0f172a;
        }}
        .kpi-row {{
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
            margin-bottom: 14px;
        }}
        .kpi-box {{
            background: #f1f5f9;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            padding: 8px 12px;
            text-align: center;
        }}
        .kpi-title {{
            display: block;
            font-size: 10px;
            text-transform: uppercase;
            font-weight: bold;
            color: #475569;
        }}
        .kpi-val {{
            display: block;
            font-size: 18px;
            font-weight: 900;
            color: #0f172a;
            margin: 2px 0;
        }}
        .kpi-sub {{
            font-size: 10px;
            color: #64748b;
        }}
        h2 {{
            font-size: 12px;
            text-transform: uppercase;
            font-weight: 800;
            color: #1e293b;
            margin: 12px 0 6px 0;
            border-bottom: 1px solid #cbd5e1;
            padding-bottom: 3px;
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
            margin-bottom: 14px;
        }}
        th {{
            background: #e2e8f0;
            color: #0f172a;
            font-weight: 800;
            text-transform: uppercase;
            font-size: 10px;
            padding: 6px 8px;
            border: 1px solid #cbd5e1;
        }}
        td {{
            padding: 5px 8px;
            border: 1px solid #cbd5e1;
        }}
        tr:nth-child(even) td {{
            background: #f8fafc;
        }}
        tfoot tr td {{
            background: #e2e8f0;
            font-weight: bold;
        }}
        .cards-row {{
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
            margin-top: 10px;
        }}
        .card {{
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            padding: 8px 12px;
            background: #fafafa;
        }}
        .card ul {{
            margin: 6px 0 0 0;
            padding-left: 18px;
            font-size: 11px;
            line-height: 1.5;
        }}
        .footer {{
            margin-top: 18px;
            border-top: 1px solid #cbd5e1;
            padding-top: 8px;
            display: flex;
            justify-content: space-between;
            font-size: 9px;
            color: #94a3b8;
        }}
        @media print {{
            body {{
                padding: 0;
            }}
            .no-print {{
                display: none !important;
            }}
        }}
    </style>
</head>
<body>
    <div class="header">
        <div class="brand">
            <div class="logo-box">FZ</div>
            <div class="brand-text">
                <h1>FACOZINC</h1>
                <p>Atelier de Façonnage · Zinc, Aluminium, Cuivre & Plomb</p>
            </div>
        </div>
        <div class="header-meta">
            <div style="font-size: 10px; text-transform: uppercase; font-weight: bold; color: #64748b;">Fiche de Débit Atelier A4</div>
            <div class="code">{code}</div>
            <div class="date">Éditée le : {date_str}</div>
        </div>
    </div>

    <div class="info-grid">
        <div class="info-item">
            <div class="label">Client & Chantier</div>
            <div class="val">{client_name}</div>
            <div style="color: #475569; font-size: 11px; margin-top: 2px;">Chantier : <strong>{chantier_ref}</strong></div>
        </div>
        <div class="info-item">
            <div class="label">Matière Première & Spécification</div>
            <div class="val">{material_summary}</div>
            <div style="color: #475569; font-size: 11px; margin-top: 2px;">Total Pièces : <strong>{total_pieces} pcs</strong> ({total_bends} plis atelier)</div>
        </div>
    </div>

    {f'<div class="kpi-row">{efficiency_badge_html}</div>' if efficiency_badge_html else ''}

    <h2>1. Nomenclature des Pièces à Façonner (Cisaille & Plieuse)</h2>
    <table>
        <thead>
            <tr>
                <th style="width: 30px; text-align: center;">#</th>
                <th>Désignation de la Pièce</th>
                <th style="width: 75px; text-align: right;">Dév (mm)</th>
                <th style="width: 75px; text-align: right;">Longueur</th>
                <th style="width: 55px; text-align: right;">Qté</th>
                <th style="width: 75px; text-align: right;">Total (m)</th>
                <th style="width: 45px; text-align: center;">Plis</th>
                <th>Consigne Atelier / Découpe</th>
            </tr>
        </thead>
        <tbody>
            {"".join(pieces_rows_html)}
        </tbody>
        <tfoot>
            <tr>
                <td colspan="4" style="text-transform: uppercase;">TOTAL FABRICATION</td>
                <td style="text-align: right; font-weight: 900;">{total_pieces}</td>
                <td style="text-align: right; font-weight: 900;">{total_linear_meters:.2f} m</td>
                <td style="text-align: center;">{total_bends}</td>
                <td>Surface : <strong>{total_surface_m2:.2f} m²</strong></td>
            </tr>
        </tfoot>
    </table>

    <div class="cards-row">
        <div class="card">
            <div style="font-weight: 800; font-size: 11px; text-transform: uppercase; color: #1e293b;">
                2. Bon de Sortie Matière (Bobines Mères & Chutes)
            </div>
            <ul>
                {coils_withdrawal_html if coils_withdrawal_html else "<li>Débit conforme nomenclature standard</li>"}
            </ul>
        </div>
        <div class="card">
            <div style="font-weight: 800; font-size: 11px; text-transform: uppercase; color: #1e293b;">
                3. Nouvelles Chutes à Réintégrer au Chutier
            </div>
            <ul>
                {reusable_scraps_html if reusable_scraps_html else "<li>Aucune chute réutilisable conservée.</li>"}
            </ul>
        </div>
    </div>

    <div class="footer">
        <span>Plateforme FACOZINC · Fiche de Débit Normalisée conforme massicotage & pliage</span>
        <span>Visa Chef d'Atelier : ______________________</span>
    </div>
</body>
</html>
"""
    return html_content
