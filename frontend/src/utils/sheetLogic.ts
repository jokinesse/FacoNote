import { evaluateExpression } from './mathEvaluator';
import { IntervalRow, EncodedEntry, SheetPreset } from '../types';

// Default intervals for "DEV PIÈCE" matching Google Sheet D3:D21 (19 standard intervals)
export const DEFAULT_PIECE_BOUNDS = [
  100, 120, 150, 175, 187, 200, 250, 285, 300, 333, 375, 400, 450, 500, 600, 670, 750, 1000, 1100
];

// Default intervals for "DEV BOBINE" strictly limited to Facozinc standard mother widths:
// Zinc (ZN, QZ, ATZ) : 600, 670, 750, 1000, 1100 mm
// Alu (Noir, Blanc, 7016, QZ) : 650, 1000 mm
export const DEFAULT_BOBINE_BOUNDS = [
  600, 650, 670, 750, 1000, 1100
];

export function createInitialIntervals(preset: SheetPreset, customBounds?: number[]): IntervalRow[] {
  let bounds: number[] = [];
  if (preset === 'DEV_PIECE') {
    bounds = DEFAULT_PIECE_BOUNDS;
  } else if (preset === 'DEV_BOBINE') {
    bounds = DEFAULT_BOBINE_BOUNDS;
  } else {
    bounds = customBounds && customBounds.length > 0 ? customBounds : DEFAULT_PIECE_BOUNDS;
  }

  // Sort ascending
  const sorted = [...bounds].sort((a, b) => a - b);

  return sorted.map((bound, index) => ({
    id: `bound-${index}-${bound}`,
    bound,
    accumulatedLength: 0,
    count: 0,
    label: `Dév ≤ ${bound} mm`,
  }));
}

export interface ParseResult {
  valid: boolean;
  dev: number;
  rawDev: string;
  expression: string;
  length: number; // in meters (or converted)
  isChute: boolean;
  matchedBound?: number;
  error?: string;
}

/**
 * Parses user input in the format "dev/longueur" or "dev / expr"
 * Examples:
 * - "250/3*2+1.5" -> dev=250, length=7.5
 * - "180/1200+850" -> dev=180, length=2050 (or in m if unit selected)
 * - "0/4.5" -> dev=0 (chute), length=4.5
 */
export function parseQuickInput(input: string, lengthUnit: 'm' | 'mm' = 'm'): ParseResult {
  if (!input || !input.trim()) {
    return { valid: false, dev: 0, rawDev: '', expression: '', length: 0, isChute: false, error: 'Saisie vide' };
  }

  const slashIndex = input.indexOf('/');
  if (slashIndex === -1) {
    return {
      valid: false,
      dev: 0,
      rawDev: '',
      expression: '',
      length: 0,
      isChute: false,
      error: 'Format attendu : "développement / longueur" (ex: 250/3*2+1.5 ou 0/4.2)',
    };
  }

  const devText = input.substring(0, slashIndex).replace(',', '.').trim();
  const exprLength = input.substring(slashIndex + 1).replace(',', '.').trim();

  const dev = parseFloat(devText);
  if (isNaN(dev) || dev < 0) {
    return {
      valid: false,
      dev: 0,
      rawDev: devText,
      expression: exprLength,
      length: 0,
      isChute: false,
      error: 'Développement invalide (nombre positif ou 0 pour chute)',
    };
  }

  const evaluated = evaluateExpression(exprLength);
  if (isNaN(evaluated) || evaluated <= 0) {
    return {
      valid: false,
      dev,
      rawDev: devText,
      expression: exprLength,
      length: 0,
      isChute: false,
      error: 'Expression de longueur invalide',
    };
  }

  // Convert to meters if input was in mm
  const finalLength = lengthUnit === 'mm' ? evaluated / 1000 : evaluated;

  return {
    valid: true,
    dev,
    rawDev: devText,
    expression: exprLength,
    length: Math.round(finalLength * 1000) / 1000,
    isChute: dev === 0,
  };
}

/**
 * Port of Google Apps Script traiterSaisie logic:
 * Finds the first interval bound >= dev.
 * If dev > all bounds, selects the largest bound.
 */
export function findMatchingBound(dev: number, intervals: IntervalRow[]): number | null {
  if (intervals.length === 0) return null;

  const sorted = [...intervals].sort((a, b) => a.bound - b.bound);

  for (const row of sorted) {
    if (row.bound >= dev) {
      return row.bound;
    }
  }

  // If dev exceeds all bounds, use the largest bound (matching Google Sheet script)
  return sorted[sorted.length - 1].bound;
}
