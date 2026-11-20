// Couleur d'identification de chaque matière, la même partout sur le site
// (badges, boutons de choix, plan de coupe). Purement visuel : aucun lien avec le calcul.
// Les 4 matières des boutons rapides ont les teintes les plus éloignées.
const MATERIAL_COLORS: Record<string, string> = {
  'Alu RAL 7016 0.7': '#1d4ed8', // bleu
  'Alu RAL 9005 0.7': '#7c3aed', // violet
  'Zinc Quartz 0.7': '#db2777', // rose
  'Zinc Naturel 0.7': '#15803d', // vert
  'Alu RAL 9010 0.7': '#0891b2', // cyan
  'Alu RAL 7039 0.7': '#a16207', // ocre
  'Alu 1.5 Brut': '#475569', // ardoise
  'Zinc ATZ 0.7': '#c2410c', // orange brûlé
  'Zinc Naturel 0.8': '#4d7c0f', // vert olive
  'Zinc ATZ 0.8': '#854d0e', // brun
  'Zinc Quartz 0.8': '#9d174d', // framboise
  'Zinc Pigmento Rouge 0.8': '#b91c1c', // rouge
  'Zinc Perforée 1.0': '#0f766e', // sarcelle
};

// Matière libre : une teinte stable tirée de son nom
const FALLBACK = ['#6d28d9', '#0e7490', '#be123c', '#3f6212', '#9a3412', '#1e40af'];

export function materialColor(material: string | undefined | null): string {
  const key = (material || '').trim();
  if (MATERIAL_COLORS[key]) return MATERIAL_COLORS[key];
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK[h % FALLBACK.length];
}

export function materialFamily(material: string): 'ALU' | 'ZINC' | null {
  const m = material.toLowerCase();
  if (m.includes('alu')) return 'ALU';
  if (m.includes('zinc')) return 'ZINC';
  return null;
}
