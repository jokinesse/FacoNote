/**
 * Text formatting & cleaning utility for Facozinc workshop.
 * Cleans any raw LaTeX formatting artifacts like $\le$, \le, $\ge$, etc.
 * and converts them to standard typography (≤, ≥, etc.).
 */
export function cleanWorkshopText(text?: string): string {
  if (!text) return '';
  return text
    .replace(/\$\\le\$/gi, '≤')
    .replace(/\\le\b/gi, '≤')
    .replace(/\$\\leq\$/gi, '≤')
    .replace(/\\leq\b/gi, '≤')
    .replace(/\$\\ge\$/gi, '≥')
    .replace(/\\ge\b/gi, '≥')
    .replace(/\\pm\b/gi, '±')
    .replace(/\$/g, '')
    .trim();
}
