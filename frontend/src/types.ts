export type SheetPreset = 'DEV_PIECE' | 'DEV_BOBINE' | 'CUSTOM';

export interface IntervalRow {
  id: string;
  bound: number; // Max dev for this interval in mm
  accumulatedLength: number; // Total length in meters
  count: number;
  label?: string;
}

export interface EncodedEntry {
  id: string;
  rawInput: string;
  dev: number;
  lengthExpression: string;
  unitLength: number; // in meters
  quantity: number; // piece count
  evaluatedLength: number; // total length in meters (unitLength * quantity)
  matchedBound: number;
  isChute: boolean;
  timestamp: string;
  note?: string;
  material?: string; // Matière spécifique de la saisie (ex: Zinc Quartz 0.7, Alu Noir 9005 0.8)
}

export interface MaterialGroup {
  group: string;
  items: { value: string; label: string }[];
}

export const MATERIAL_GROUPS: MaterialGroup[] = [
  {
    group: 'Alu épaisseur 0,7',
    items: [
      { value: 'Alu RAL 7016 0.7', label: 'RAL 7016' },
      { value: 'Alu RAL 9005 0.7', label: 'RAL 9005' },
      { value: 'Alu RAL 9010 0.7', label: 'RAL 9010' },
      { value: 'Alu RAL 7039 0.7', label: 'RAL 7039' },
    ],
  },
  {
    group: 'Alu épaisseur 1.5',
    items: [
      { value: 'Alu 1.5 Brut', label: 'Brut' },
    ],
  },
  {
    group: 'Zinc épaisseur 0.7',
    items: [
      { value: 'Zinc Naturel 0.7', label: 'Naturel' },
      { value: 'Zinc ATZ 0.7', label: 'ATZ' },
      { value: 'Zinc Quartz 0.7', label: 'Quartz' },
    ],
  },
  {
    group: 'Zinc épaisseur 0.8',
    items: [
      { value: 'Zinc Naturel 0.8', label: 'Naturel' },
      { value: 'Zinc ATZ 0.8', label: 'ATZ' },
      { value: 'Zinc Quartz 0.8', label: 'Quartz' },
      { value: 'Zinc Pigmento Rouge 0.8', label: 'Pigmento Rouge' },
    ],
  },
  {
    group: 'Zinc épaisseur 1',
    items: [
      { value: 'Zinc Perforée 1.0', label: 'Perforée' },
    ],
  },
];

export const STANDARD_MATERIALS: string[] = MATERIAL_GROUPS.flatMap((g) =>
  g.items.map((i) => i.value)
);

export type MaterialType = 'ZINC' | 'ALUMINIUM';

export type ZincFinish =
  | 'Zinc Naturel'
  | 'Naturel'
  | 'ATZ'
  | 'ATZ (Anthra-Zinc)'
  | 'Quartz'
  | 'Quartz-Zinc'
  | 'Pigmento Rouge'
  | 'Perforée';

export type AluFinish =
  | 'RAL 7016'
  | 'RAL 9005'
  | 'RAL 9010'
  | 'RAL 7039'
  | '1.5 Brut'
  | 'Brut'
  | 'Alu Anthracite RAL 7016'
  | 'Alu Noir RAL 9005'
  | 'Alu Blanc RAL 9010';

export type ZincThickness = '0.7' | '0.8' | '1.0' | '1';
export type AluThickness = '0.7' | '1.5';

export interface ShapedPiece {
  id: string;
  label: string;
  dev: number; // in mm
  length: number; // in meters
  quantity: number;
  bends: number; // nombre de plis
  material?: string; // Matière & finition spécifique (ex: Zinc Quartz 0.7, Alu 7016...)
  originalTotalLengthRequested?: number; // si le client a donné un métrage total
  workshopSplitReason?: string; // explication du découpage en longueurs atelier
  notes?: string;
  sourceType?: 'BOBINE' | 'RACK_SCRAP'; // Origine atelier : débit bobine mère ou chute de rack
}

export interface DocumentAnalysisResult {
  fileName?: string;
  client?: string;
  chantier?: string;
  detectedMaterial?: MaterialType;
  detectedFinish?: string;
  detectedThickness?: string;
  pieces: ShapedPiece[];
  notes?: string;
  standardLengthUsed: number;
}

export interface Order {
  id: string;
  code: string;
  client: string;
  chantier: string;
  date: string;
  material: MaterialType;
  finish: string;
  thickness: string;
  pieces: ShapedPiece[];
  status: 'Brouillon' | 'Optimisé' | 'En cours' | 'Terminé';
  notes?: string;
}

export interface StockMotherItem {
  id: string;
  material: MaterialType;
  finish: string;
  thickness: string;
  width: number; // standard width in mm: 600, 670, 750, 1000 for zinc; 650, 1000 for alu
  lengthAvailable: number; // in meters
  weightKg?: number;
  coilOrSheet: 'bobine' | 'feuille';
  location: string;
  minAlert: number;
}

export interface ReusableScrap {
  id: string;
  refCode: string;
  material: MaterialType;
  finish: string;
  thickness: string;
  dev: number; // width in mm
  length: number; // length in meters
  weightKg: number;
  location: string;
  dateAdded: string;
  sourceOrderId?: string;
  isUsed: boolean;
  notes?: string;
}

export interface SlitNestResult {
  motherWidth: number;
  motherLength: number;
  material?: string;
  strips: {
    pieceId: string;
    label: string;
    dev: number;
    length: number;
    qty: number;
    material?: string;
  }[];
  usedWidth: number;
  scrapWidth: number;
  isScrapReusable: boolean;
  suggestedScrapRef?: string;
  sourceType?: 'MOTHER_COIL' | 'REUSED_OFFCUT';
  sourceLabel?: string;
  sourceOpIndex?: number;
  originalOffcutLength?: number;
  offcutCutLength?: number;
  parentScrapRef?: string;
}

export interface WorkshopScrapProposal {
  id: string;
  pieceId: string;
  pieceLabel: string;
  pieceDev: number;
  pieceLength: number;
  recommendedScrapDev: number; // 100, 120, 150, 200, 250 mm
  material?: string;
  reason: string;
  motherWidthSaved: number;
  motherLengthSaved: number;
  areaSavedM2: number;
  weightSavedKg: number;
}

export interface AppliedWorkshopScrap {
  pieceId?: string;
  pieceLabel: string;
  pieceDev: number;
  pieceLength: number;
  scrapDev: number;
  material?: string;
}

export interface OptimizationResult {
  orderId: string;
  timestamp: string;
  piecesRequired: ShapedPiece[];
  // Proposals for rack scraps (100, 120, 150, 200, 250 mm)
  workshopScrapProposals?: WorkshopScrapProposal[];
  // Scraps accepted from workshop rack
  appliedWorkshopScraps?: AppliedWorkshopScrap[];
  // Legacy / stock compatibility
  usedScrapsFromStock: {
    scrap: ReusableScrap;
    pieceLabel: string;
    pieceDev: number;
    pieceLength: number;
    residualScrap?: ReusableScrap;
  }[];
  // Mother coils/sheets needed
  motherItemsNeeded: {
    motherWidth: number;
    motherLength: number;
    material?: string;
    slits: SlitNestResult[];
  }[];
  // New reusable scraps produced
  newReusableScrapsCreated: ReusableScrap[];
  // Metrics
  totalNetSurfaceM2: number;
  totalGrossSurfaceM2: number;
  reusableScrapSurfaceM2: number;
  netLossSurfaceM2: number;
  materialEfficiencyRate: number; // e.g. 94.5%
  netWeightKg: number;
  grossWeightKg: number;
  aiInsights?: {
    summary?: string;
    workshopTips?: string[];
    reuseStrategy?: string;
    safetyNotice?: string;
  };
}
