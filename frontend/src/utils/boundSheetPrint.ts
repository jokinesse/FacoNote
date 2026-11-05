// Feuille A4 « pièces par borne », à imprimer derrière la feuille de commande.
// Mise en page seulement : toutes les valeurs viennent du backend (pieces-summary).
// L'impression passe par la boîte d'impression du navigateur (imprimante ou « Enregistrer au format PDF »).
import { PiecesSummaryResponse } from '../api';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const num = (n: number, digits = 2) =>
  n.toLocaleString('fr-BE', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function buildBoundSheetHtml(summary: PiecesSummaryResponse, orderNumber: string): string {
  const now = new Date();
  const date = now.toLocaleDateString('fr-BE');
  const time = now.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
  const title = `Pièces par borne${orderNumber ? ` ${orderNumber}` : ''} ${now.toISOString().slice(0, 10)}`;

  const sections = summary.materials
    .map((m) => {
      const rows = summary.bound_rows.filter((r) => !r.is_empty && r.material === m.material);
      const body = rows
        .map((r) => {
          const cuts = r.cuts
            .map(
              (c) =>
                `<span class="cut">Dév ${c.dev} : <b>${c.quantity}</b> × ${num(c.unit_length_m)} m</span>`
            )
            .join('');
          return `<tr>
            <td class="bound">DEV${r.bound}</td>
            <td class="cuts">${cuts}</td>
            <td class="n">${r.quantity}</td>
            <td class="n">${num(r.length_m)}</td>
          </tr>`;
        })
        .join('');
      return `<section>
        <h2>${esc(m.material)}</h2>
        <table>
          <thead><tr><th>Borne</th><th>Pièces (développé : quantité × longueur)</th><th class="n">Pcs</th><th class="n">Mètres</th></tr></thead>
          <tbody>${body}</tbody>
          <tfoot><tr><td colspan="2">Total ${esc(m.material)}</td><td class="n">${m.quantity}</td><td class="n">${num(m.length_m)}</td></tr></tfoot>
        </table>
      </section>`;
    })
    .join('');

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; color: #000; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #000; padding-bottom: 4px; margin-bottom: 8px; }
  h1 { font-size: 14pt; margin: 0; }
  .order { font-size: 13pt; font-weight: bold; font-family: "Courier New", monospace; }
  .meta { font-size: 9pt; text-align: right; }
  section { margin-bottom: 10px; break-inside: avoid; }
  h2 { font-size: 11.5pt; margin: 8px 0 3px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #000; padding: 3px 5px; vertical-align: top; }
  th { background: #e6e6e6; text-align: left; font-size: 9.5pt; }
  tr { break-inside: avoid; }
  td.bound { font-weight: bold; white-space: nowrap; width: 18mm; }
  td.cuts { line-height: 1.5; }
  .cut { display: inline-block; margin-right: 12px; white-space: nowrap; }
  .n { text-align: right; white-space: nowrap; width: 16mm; }
  tfoot td { font-weight: bold; background: #f2f2f2; }
  .grand { margin-top: 6px; border-top: 2px solid #000; padding-top: 4px; font-weight: bold; text-align: right; }
</style></head>
<body>
  <header>
    <div><h1>Pièces par borne</h1>${orderNumber ? `<div class="order">${esc(orderNumber)}</div>` : ''}</div>
    <div class="meta">Façonote · ${esc(date)} ${esc(time)}</div>
  </header>
  ${sections}
  <div class="grand">Total général : ${summary.totals.quantity} pcs · ${num(summary.totals.length_m)} m</div>
</body></html>`;
}

// Imprime via un cadre caché (pas de fenêtre pop-up bloquée).
export function printBoundSheet(summary: PiecesSummaryResponse, orderNumber: string): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    throw new Error("Impression impossible dans ce navigateur.");
  }
  doc.open();
  doc.write(buildBoundSheetHtml(summary, orderNumber));
  doc.close();
  // Le titre du document parent sert de nom de fichier PDF dans Edge
  const previousTitle = document.title;
  document.title = doc.title;
  const cleanup = () => {
    document.title = previousTitle;
    window.setTimeout(() => frame.remove(), 1000);
  };
  win.addEventListener('afterprint', cleanup, { once: true });
  window.setTimeout(() => {
    win.focus();
    win.print();
  }, 150);
  window.setTimeout(() => {
    if (frame.isConnected) cleanup();
  }, 120000);
}
