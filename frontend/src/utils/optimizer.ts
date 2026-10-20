import {
  Order,
  ShapedPiece,
  StockMotherItem,
  ReusableScrap,
  OptimizationResult,
  SlitNestResult,
  WorkshopScrapProposal,
  AppliedWorkshopScrap,
} from '../types';

// Standard workshop rack offcuts available in sheet metal workshops (Facozinc)
export const STANDARD_WORKSHOP_SCRAP_WIDTHS = [100, 120, 150, 200, 250];

// Standard mother coil / sheet widths available in workshop
export const STANDARD_ZINC_MOTHER_WIDTHS = [600, 650, 670, 750, 1000];
export const STANDARD_ALU_MOTHER_WIDTHS = [600, 650, 670, 750, 1000];

// Density in kg/m2 per mm of thickness
// Zinc ~7.2 kg/m² per 1mm thickness -> 0.7mm is ~5.04 kg/m²
// Alu ~2.7 kg/m² per 1mm thickness -> 0.7mm is ~1.89 kg/m²
export function getMaterialDensity(material: string, thicknessStr?: string): number {
  let thickness = parseFloat(thicknessStr || '');
  const matLower = (material || '').toLowerCase();
  const isAlu = matLower.includes('alu');

  if (isNaN(thickness) || thickness <= 0) {
    if (/0\.7/.test(material)) thickness = 0.7;
    else if (/1\.0/.test(material)) thickness = 1.0;
    else if (/1\.25/.test(material)) thickness = 1.25;
    else if (/0\.6/.test(material)) thickness = 0.6;
    else if (/0\.8/.test(material)) thickness = 0.8;
    else thickness = 0.7; // Standard default chez Facozinc (Zinc & Alu 0.7)
  }

  if (isAlu) {
    return 2.7 * thickness; // kg/m²
  } else if (matLower.includes('cuivre')) {
    return 8.9 * thickness;
  } else if (matLower.includes('plomb')) {
    return 11.3 * thickness;
  } else {
    // Zinc par défaut
    return 7.2 * thickness; // kg/m²
  }
}

export function getMaterialWeightDetails(material: string): {
  densityKgM2: number;
  shortLabel: string;
  materialType: 'ZINC' | 'ALUMINIUM' | 'CUIVRE' | 'PLOMB';
  thickness: number;
} {
  const density = getMaterialDensity(material);
  const matLower = (material || '').toLowerCase();
  let materialType: 'ZINC' | 'ALUMINIUM' | 'CUIVRE' | 'PLOMB' = 'ZINC';
  let thick = 0.7;

  if (matLower.includes('alu')) {
    materialType = 'ALUMINIUM';
    if (matLower.includes('1.0')) thick = 1.0;
    else if (matLower.includes('0.8')) thick = 0.8;
    else thick = 0.7;
  } else if (matLower.includes('cuivre')) {
    materialType = 'CUIVRE';
    thick = 0.6;
  } else if (matLower.includes('plomb')) {
    materialType = 'PLOMB';
    thick = 1.25;
  } else {
    materialType = 'ZINC';
    if (matLower.includes('0.8')) thick = 0.8;
    else thick = 0.7;
  }

  const shortName = materialType === 'ALUMINIUM' ? 'Alu' : materialType === 'ZINC' ? 'Zinc' : materialType;
  const shortLabel = `${shortName} ${thick} (${density.toFixed(2)} kg/m²)`;

  return {
    densityKgM2: density,
    shortLabel,
    materialType,
    thickness: thick,
  };
}

export interface AutoPieceBreakdownAlternative {
  length: number;
  quantity: number;
  totalProduced: number;
  excess: number;
  isExact: boolean;
  isExisting: boolean;
  isClosest?: boolean;
  score: number;
  label: string;
}

export interface AutoPieceBreakdown {
  length: number;
  quantity: number;
  totalProduced: number;
  requestedMeters: number;
  reason: string;
  source: 'existing_pieces' | 'standard_exact' | 'standard_rounded';
  alternatives: AutoPieceBreakdownAlternative[];
}

/**
 * Intelligent Piece Sizing for Total Meterage Input (when Quantity = 0):
 * If the user only has total linear meters (e.g. 10m, 11.5m, 15m, 23m) without a fixed piece size:
 * 1. Proposes sheet lengths that divide evenly ("qui tombe pile", 0 chute).
 * 2. At least 1 proposed option is ALWAYS guaranteed to fall exact (0 chute), or the closest possible (minimal chute).
 * 3. Also proposes the closest standard workshop sheets (2.0m, 2.5m, 3.0m, 4.0m) with minimal excess ("le plus proche").
 * 4. Checks existing pieces in the job to align on the exact same sheet length when beneficial.
 */
export function resolveAutoPieceBreakdown(
  totalMeters: number,
  currentPieces: ShapedPiece[],
  targetMaterial: string,
  forcedLength?: number
): AutoPieceBreakdown {
  const safeMeters = Math.max(0.1, totalMeters);

  // 1. Collect existing piece lengths (prioritize same material, then overall)
  const sameMatPieces = currentPieces.filter((p) => !p.material || p.material === targetMaterial);
  const pool = sameMatPieces.length > 0 ? sameMatPieces : currentPieces;

  const existingLengthCounts = new Map<number, number>();
  for (const p of pool) {
    if (p.length > 0 && p.quantity > 0) {
      const roundedL = Math.round(p.length * 100) / 100;
      existingLengthCounts.set(roundedL, (existingLengthCounts.get(roundedL) || 0) + p.quantity);
    }
  }

  // 2. Candidate workshop sheet lengths:
  // - Standard machine folding lengths in sheet metal workshops: 2.0m, 2.5m, 3.0m, 4.0m
  // - Other common coil-slit standards: 1.5m, 2.20m, 2.30m, 2.40m, 2.60m, 2.80m, 3.20m, 3.50m
  // - Existing piece lengths in the job
  const standardWorkshopLengths = [2.0, 2.5, 3.0, 4.0, 1.5, 2.20, 2.30, 2.40, 2.60, 2.80, 3.20, 3.50];
  const candidateLengthSet = new Set<number>([
    ...Array.from(existingLengthCounts.keys()),
    ...standardWorkshopLengths,
  ]);

  // 3. Search exact mathematical divisors ("qui tombe pile", 0 chute):
  // For integer piece counts N (e.g. 1 to 40), check if safeMeters / N yields a practical sheet length (0.95m to 4.05m)
  const maxN = Math.max(1, Math.min(40, Math.ceil(safeMeters / 0.9)));
  for (let n = 1; n <= maxN; n++) {
    const rawL = safeMeters / n;
    if (rawL >= 0.95 && rawL <= 4.05) {
      // 2 decimal places check (e.g. 2.00m, 2.50m, 2.40m, 2.60m, etc.)
      const l2 = Math.round(rawL * 100) / 100;
      if (Math.abs(l2 * n - safeMeters) < 0.005) {
        candidateLengthSet.add(l2);
      } else {
        // 3 decimal places check (e.g. 2.875m, 2.125m, 2.375m, 2.457m)
        const l3 = Math.round(rawL * 1000) / 1000;
        if (Math.abs(l3 * n - safeMeters) < 0.001) {
          candidateLengthSet.add(l3);
        }
      }
    }
  }

  // Filter sensible bounds
  const rawCandidateLengths = Array.from(candidateLengthSet)
    .filter((len) => len >= 0.5 && len <= 6.0)
    .sort((a, b) => a - b);

  // Evaluate every candidate length
  const scored: AutoPieceBreakdownAlternative[] = rawCandidateLengths.map((candLength) => {
    const rawCount = safeMeters / candLength;
    const isExact =
      Math.abs(Math.round(rawCount) - rawCount) < 0.005 ||
      Math.abs(Math.round(rawCount) * candLength - safeMeters) < 0.005;

    const quantity = isExact ? Math.round(rawCount) : Math.ceil(rawCount);
    const totalProduced = isExact ? safeMeters : Math.round(quantity * candLength * 100) / 100;
    const excess = isExact ? 0 : Math.max(0, Math.round((totalProduced - safeMeters) * 100) / 100);
    const existingCount = existingLengthCounts.get(candLength) || 0;
    const isExisting = existingCount > 0;

    let score = 0;

    // 1. High priority for exact division ("tombe pile" / 0 chute)
    if (isExact) {
      score += 150;
      // Extra bonus if this exact length is also a classic machine standard (2.0, 2.5, 3.0, 4.0)
      if ([2.0, 2.5, 3.0, 4.0].some((std) => Math.abs(candLength - std) < 0.01)) {
        score += 35;
      }
    } else {
      // Penalize excess heavily so "le plus proche" (minimal excess/chute) ranks highest among non-exact
      score -= excess * 60;
    }

    // 2. Bonus for matching existing sheet sizes in the order (atelier débit commun)
    if (isExisting) {
      score += 85 + existingCount * 10;
    }

    // 3. Ergonomic preference for workshop handling (sweet spot: 1.8m to 3.5m)
    if (candLength >= 1.8 && candLength <= 3.5) {
      score += 15;
    }
    // Natural slight preference for standard machine lengths (2.0m, 2.5m, 3.0m, 4.0m)
    if ([2.0, 2.5, 3.0, 4.0].some((std) => Math.abs(candLength - std) < 0.01)) {
      score += 20;
    }

    // Disfavor micro-sheets when total length allows standard folding sheets
    if (candLength < 1.7 && safeMeters >= 3.5) {
      score -= (1.7 - candLength) * 80;
    }
    if (candLength > 4.0) {
      score -= (candLength - 4.0) * 80;
    }

    let label = `${quantity} pcs × ${candLength}m = ${totalProduced}m`;
    if (isExact) label += ' (Tombe pile - 0 chute)';
    else if (isExisting) label += ` (Même taille débit : ${existingCount} pcs)`;
    else if (excess > 0) label += ` (+${excess}m chute)`;

    return {
      length: candLength,
      quantity: Math.max(1, quantity),
      totalProduced,
      excess,
      isExact,
      isExisting,
      score,
      label,
    };
  });

  // Identify the candidate that is "le plus proche" (minimal excess > 0)
  const nonExactCandidates = scored
    .filter((s) => !s.isExact && s.excess > 0 && s.length >= 1.5 && s.length <= 4.0)
    .sort((a, b) => a.excess - b.excess);

  const closestCand = nonExactCandidates[0] || scored.filter((s) => !s.isExact).sort((a, b) => a.excess - b.excess)[0];
  if (closestCand) {
    closestCand.isClosest = true;
  }

  // Guarantee: There must ALWAYS be at least 1 version that is always exact!
  const hasExact = scored.some((s) => s.isExact);
  if (!hasExact) {
    // Generate the closest exact division (targeting standard folding lengths ~2.0m or ~2.5m)
    const targetLength = safeMeters >= 5.0 ? 2.5 : 2.0;
    const targetN = Math.max(1, Math.round(safeMeters / targetLength));
    const exactLength = Math.round((safeMeters / targetN) * 1000) / 1000;
    const exactAlt: AutoPieceBreakdownAlternative = {
      length: exactLength,
      quantity: targetN,
      totalProduced: safeMeters,
      excess: 0,
      isExact: true,
      isExisting: (existingLengthCounts.get(exactLength) || 0) > 0,
      score: 180,
      label: `${targetN} pcs × ${exactLength}m = ${safeMeters}m (Tombe pile exact)`,
    };
    scored.unshift(exactAlt);
  }

  // Sort candidates by score descending
  scored.sort((a, b) => b.score - a.score);

  // If a forced length is requested (user clicked an alternative chip)
  let chosen = scored[0];
  if (forcedLength) {
    const match = scored.find((s) => Math.abs(s.length - forcedLength) < 0.01);
    if (match) chosen = match;
  }

  let reason = '';
  let source: 'existing_pieces' | 'standard_exact' | 'standard_rounded' = 'standard_rounded';

  if (chosen.isExact && chosen.isExisting) {
    source = 'existing_pieces';
    reason = `Aligné sur les feuilles de ${chosen.length}m existantes (${chosen.quantity} pcs) · Tombe pile (0 chute)`;
  } else if (chosen.isExact) {
    source = 'standard_exact';
    reason = `Tombe pile : ${chosen.quantity} pièces de ${chosen.length}m = exactement ${chosen.totalProduced}m (0 chute)`;
  } else if (chosen.isExisting) {
    source = 'existing_pieces';
    reason = `Aligné sur les feuilles de ${chosen.length}m existantes (${chosen.quantity} pcs) · Arrondi (+${chosen.excess}m)`;
  } else {
    source = 'standard_rounded';
    reason = `Découpage optimisé en ${chosen.quantity} pièces de ${chosen.length}m (${chosen.totalProduced}m pour ${safeMeters}m demandés)`;
  }

  // Build top alternatives ensuring:
  // 1. At least 1 EXACT option ("Tombe pile ! 0 chute")
  // 2. The CLOSEST option ("Le plus proche", minimal excess/chute)
  // 3. Existing piece length if present
  // 4. Standard machine formats (2.0m, 2.5m, 3.0m)
  const poolForAlts =
    safeMeters >= 3.5 && scored.filter((s) => s.length >= 1.75).length >= 2
      ? scored.filter((s) => s.length >= 1.75)
      : scored;

  const topAlternatives: AutoPieceBreakdownAlternative[] = [];
  const seenLengths = new Set<number>();

  const addAlt = (alt?: AutoPieceBreakdownAlternative) => {
    if (!alt) return;
    const key = Math.round(alt.length * 100) / 100;
    if (!seenLengths.has(key)) {
      seenLengths.add(key);
      topAlternatives.push(alt);
    }
  };

  // 1. Add chosen recommendation
  addAlt(chosen);

  // 2. Add best exact alternative (guaranteed at least 1 exact)
  const bestExact = poolForAlts.find((s) => s.isExact) || scored.find((s) => s.isExact);
  addAlt(bestExact);

  // 3. Add other exact alternatives (up to 2 additional exact options if they exist)
  for (const alt of poolForAlts) {
    if (alt.isExact) {
      addAlt(alt);
      if (topAlternatives.filter((a) => a.isExact).length >= 3) break;
    }
  }

  // 4. Add the closest standard option ("le plus proche", minimal excess chute)
  if (closestCand) {
    addAlt(closestCand);
  }

  // 5. Add matching existing piece length if present in order
  const existingAlt = scored.find((s) => s.isExisting);
  if (existingAlt) {
    addAlt(existingAlt);
  }

  // 6. Add classic standard machine sizes (2.0m, 2.5m, 3.0m) if not yet added
  for (const stdLen of [2.0, 2.5, 3.0]) {
    const stdAlt = scored.find((s) => Math.abs(s.length - stdLen) < 0.01);
    if (stdAlt) {
      addAlt(stdAlt);
      if (topAlternatives.length >= 5) break;
    }
  }

  // 7. Fill any remaining slots with highest scoring options (up to 6 max)
  for (const alt of poolForAlts) {
    addAlt(alt);
    if (topAlternatives.length >= 6) break;
  }
  if (topAlternatives.length < 4) {
    for (const alt of scored) {
      addAlt(alt);
      if (topAlternatives.length >= 6) break;
    }
  }

  // Sort alternatives by length ascending for clear ergonomic display in the UI
  topAlternatives.sort((a, b) => a.length - b.length);

  return {
    length: chosen.length,
    quantity: chosen.quantity,
    totalProduced: chosen.totalProduced,
    requestedMeters: safeMeters,
    reason,
    source,
    alternatives: topAlternatives,
  };
}

interface FlattenedCut {
  id: string;
  pieceId: string;
  label: string;
  dev: number;
  length: number;
  material: string;
}

export interface OptimizationOptions {
  availableMotherWidths?: number[];
  useWorkshopScraps?: boolean; // false = baseline "calcul sans chute"
  acceptedProposalIds?: string[]; // IDs of specific scrap proposals accepted by user
}

/**
 * Find the optimal combination of cuts that fit across a mother width W
 * using exact branch search / subset-sum optimization to minimize scrap width (W - sum(dev)).
 */
function findBestSlitCombination(
  cuts: FlattenedCut[],
  motherWidth: number
): { packed: FlattenedCut[]; usedWidth: number; scrapWidth: number } | null {
  if (cuts.length === 0) return null;

  // Filter cuts that individually fit in motherWidth
  const eligible = cuts.filter((c) => c.dev <= motherWidth);
  if (eligible.length === 0) return null;

  let bestPacked: FlattenedCut[] = [];
  let bestUsedWidth = 0;
  let bestScrapWidth = motherWidth;

  if (eligible.length <= 18) {
    function search(idx: number, currentPacked: FlattenedCut[], currentUsed: number) {
      if (currentUsed > motherWidth) return;

      const currentScrap = motherWidth - currentUsed;
      if (currentPacked.length > 0 && currentScrap < bestScrapWidth) {
        bestScrapWidth = currentScrap;
        bestUsedWidth = currentUsed;
        bestPacked = [...currentPacked];
        if (bestScrapWidth === 0) return; // Perfect fit
      }

      for (let i = idx; i < eligible.length; i++) {
        const next = eligible[i];
        if (currentUsed + next.dev <= motherWidth) {
          currentPacked.push(next);
          search(i + 1, currentPacked, currentUsed + next.dev);
          currentPacked.pop();
          if (bestScrapWidth === 0) return;
        }
      }
    }

    search(0, [], 0);
  } else {
    const sorted = [...eligible].sort((a, b) => b.dev - a.dev);
    const packed: FlattenedCut[] = [];
    let curUsed = 0;

    for (const c of sorted) {
      if (curUsed + c.dev <= motherWidth) {
        packed.push(c);
        curUsed += c.dev;
      }
    }

    bestPacked = packed;
    bestUsedWidth = curUsed;
    bestScrapWidth = motherWidth - curUsed;
  }

  if (bestPacked.length === 0) return null;

  return {
    packed: bestPacked,
    usedWidth: bestUsedWidth,
    scrapWidth: bestScrapWidth,
  };
}

/**
 * Rebuilt Coil & Sheet Slitting Optimizer:
 * 1. Groups by Material and Length cohort (pieces with different materials are cut on dedicated mother coils)
 * 2. Minimizes scrap across candidate mother widths
 * 3. Proposes workshop rack offcuts (100, 120, 150, 200, 250 mm) for isolated strips
 * 4. Exact density calculation per material for true workshop weights
 */
export function runOptimization(
  order: Order,
  _stockItems?: StockMotherItem[],
  _availableScraps?: ReusableScrap[],
  options?: OptimizationOptions
): OptimizationResult {
  const timestamp = new Date().toISOString();

  // 1. Flatten all cuts from pieces with their specific material
  const allCuts: FlattenedCut[] = [];
  let cutId = 1;
  for (const p of order.pieces) {
    const pieceMat = p.material || order.finish || order.material || 'Zinc Quartz 0.7';
    for (let q = 0; q < p.quantity; q++) {
      allCuts.push({
        id: `cut-${cutId++}-${p.id}`,
        pieceId: p.id,
        label: p.label,
        dev: p.dev,
        length: p.length,
        material: pieceMat,
      });
    }
  }

  // 2. Helper to pack cuts into mother coils grouped by material and length
  function packCutsIntoMotherCoils(cutsToPack: FlattenedCut[]) {
    // Group cuts first by material so different materials are never slit together!
    const materialGroups = new Map<string, FlattenedCut[]>();
    for (const c of cutsToPack) {
      const mat = c.material || order.finish || 'Zinc Quartz 0.7';
      const list = materialGroups.get(mat) || [];
      list.push(c);
      materialGroups.set(mat, list);
    }

    const motherItems: OptimizationResult['motherItemsNeeded'] = [];
    const createdScraps: ReusableScrap[] = [];

    // Process each material group independently
    for (const [mat, cutsForMat] of materialGroups.entries()) {
      const isMatAlu = /alu/i.test(mat);
      const matDensity = getMaterialDensity(mat);
      const defaultMotherWidths = isMatAlu ? STANDARD_ALU_MOTHER_WIDTHS : STANDARD_ZINC_MOTHER_WIDTHS;
      const candidateMotherWidths =
        options?.availableMotherWidths && options.availableMotherWidths.length > 0
          ? options.availableMotherWidths
          : defaultMotherWidths;

      // Group cuts by length cohort
      const cohorts = new Map<number, FlattenedCut[]>();
      for (const c of cutsForMat) {
        const roundedLen = Math.round(c.length * 100) / 100;
        const list = cohorts.get(roundedLen) || [];
        list.push(c);
        cohorts.set(roundedLen, list);
      }

      // Sort cohorts by length descending
      const sortedLengths = Array.from(cohorts.keys()).sort((a, b) => b - a);

      for (const len of sortedLengths) {
        let remainingCuts = [...(cohorts.get(len) || [])];

        while (remainingCuts.length > 0) {
          let bestResult: {
            motherWidth: number;
            packed: FlattenedCut[];
            usedWidth: number;
            scrapWidth: number;
            efficiency: number;
          } | null = null;

          for (const mWidth of candidateMotherWidths) {
            const res = findBestSlitCombination(remainingCuts, mWidth);
            if (res) {
              const efficiency = res.usedWidth / mWidth;
              if (
                !bestResult ||
                efficiency > bestResult.efficiency ||
                (efficiency === bestResult.efficiency && res.scrapWidth < bestResult.scrapWidth)
              ) {
                bestResult = {
                  motherWidth: mWidth,
                  ...res,
                  efficiency,
                };
              }
            }
          }

          // Fallback if no combination fits
          if (!bestResult) {
            const largestCut = remainingCuts[0];
            const maxMother = Math.max(...candidateMotherWidths);
            const actualMother = Math.max(maxMother, largestCut.dev);
            bestResult = {
              motherWidth: actualMother,
              packed: [largestCut],
              usedWidth: largestCut.dev,
              scrapWidth: Math.max(0, actualMother - largestCut.dev),
              efficiency: largestCut.dev / actualMother,
            };
          }

          // Deduct packed cuts
          const packedIds = new Set(bestResult.packed.map((p) => p.id));
          remainingCuts = remainingCuts.filter((c) => !packedIds.has(c.id));

          // Evaluate if scrap width is reusable (>= 100mm and length >= 1.0m)
          const isScrapReusable = bestResult.scrapWidth >= 100 && len >= 1.0;
          let scrapRef: string | undefined = undefined;

          if (isScrapReusable) {
            const scrapCodeMat = isMatAlu ? 'ALU' : 'ZN';
            scrapRef = `CHU-${scrapCodeMat}-${bestResult.scrapWidth}-${len.toFixed(1)}M`;
            createdScraps.push({
              id: `scrap-gen-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
              refCode: scrapRef,
              material: isMatAlu ? 'ALUMINIUM' : 'ZINC',
              finish: mat,
              thickness: /0\.8/.test(mat) ? '0.8' : /1\.0/.test(mat) ? '1.0' : '0.7',
              dev: bestResult.scrapWidth,
              length: len,
              weightKg:
                Math.round(((bestResult.scrapWidth / 1000) * len * matDensity) * 100) / 100,
              location: 'Rack Chutes Atelier (Conservée)',
              dateAdded: new Date().toISOString().split('T')[0],
              sourceOrderId: order.id,
              isUsed: false,
              notes: `Chute réutilisable générée lors de la refente (${bestResult.scrapWidth} mm × ${len} m · ${mat})`,
            });
          }

          const slit: SlitNestResult = {
            motherWidth: bestResult.motherWidth,
            motherLength: len,
            material: mat,
            strips: bestResult.packed.map((p) => ({
              pieceId: p.pieceId,
              label: p.label,
              dev: p.dev,
              length: p.length,
              qty: 1,
              material: p.material,
            })),
            usedWidth: bestResult.usedWidth,
            scrapWidth: bestResult.scrapWidth,
            isScrapReusable,
            suggestedScrapRef: scrapRef,
          };

          motherItems.push({
            motherWidth: bestResult.motherWidth,
            motherLength: len,
            material: mat,
            slits: [slit],
          });
        }
      }
    }

    return { motherItems, createdScraps };
  }

  // 3. Compute baseline "sans chute" solution first to find candidate suggestions
  const baseline = packCutsIntoMotherCoils(allCuts);

  // 4. Detect workshop rack scrap opportunities:
  const proposals: WorkshopScrapProposal[] = [];

  baseline.motherItems.forEach((mItem, idx) => {
    const slit = mItem.slits[0];
    if (!slit) return;

    const isSingleStrip = slit.strips.length === 1;
    const isHighWaste = slit.scrapWidth >= mItem.motherWidth * 0.45;

    if (isSingleStrip || isHighWaste) {
      for (const strip of slit.strips) {
        if (strip.dev <= 250) {
          const matchingScrapDev =
            STANDARD_WORKSHOP_SCRAP_WIDTHS.find((w) => w >= strip.dev) || 250;
          const stripMat = strip.material || mItem.material || order.finish || 'Zinc Quartz 0.7';
          const stripDensity = getMaterialDensity(stripMat);
          const areaSaved = (mItem.motherWidth / 1000) * mItem.motherLength;
          const weightSaved = Math.round(areaSaved * stripDensity * 100) / 100;

          proposals.push({
            id: `prop-${strip.pieceId}-${idx}`,
            pieceId: strip.pieceId,
            pieceLabel: strip.label,
            pieceDev: strip.dev,
            pieceLength: strip.length,
            recommendedScrapDev: matchingScrapDev,
            material: stripMat,
            reason: `Évite de débiter une feuille mère complète de ${mItem.motherWidth} mm × ${mItem.motherLength} m (${stripMat}) pour 1 seule pièce (perte évitée de ${slit.scrapWidth} mm)`,
            motherWidthSaved: mItem.motherWidth,
            motherLengthSaved: mItem.motherLength,
            areaSavedM2: Math.round(areaSaved * 100) / 100,
            weightSavedKg: weightSaved,
          });
          break;
        }
      }
    }
  });

  // 5. Check if user activated scrap suggestions
  const useScraps = options?.useWorkshopScraps || false;
  const acceptedIds = new Set(options?.acceptedProposalIds || []);

  const appliedWorkshopScraps: AppliedWorkshopScrap[] = [];
  let finalMotherItems = baseline.motherItems;
  let finalCreatedScraps = baseline.createdScraps;

  if (useScraps && proposals.length > 0) {
    const cutsFulfilledByScraps = new Set<string>();

    for (const prop of proposals) {
      if (acceptedIds.size === 0 || acceptedIds.has(prop.id)) {
        const matchIdx = allCuts.findIndex(
          (c) => c.pieceId === prop.pieceId && !cutsFulfilledByScraps.has(c.id)
        );
        if (matchIdx !== -1) {
          cutsFulfilledByScraps.add(allCuts[matchIdx].id);
          appliedWorkshopScraps.push({
            pieceLabel: prop.pieceLabel,
            pieceDev: prop.pieceDev,
            pieceLength: prop.pieceLength,
            scrapDev: prop.recommendedScrapDev,
            material: prop.material,
          });
        }
      }
    }

    if (cutsFulfilledByScraps.size > 0) {
      const remainingCuts = allCuts.filter((c) => !cutsFulfilledByScraps.has(c.id));
      const recomputed = packCutsIntoMotherCoils(remainingCuts);
      finalMotherItems = recomputed.motherItems;
      finalCreatedScraps = recomputed.createdScraps;
    }
  }

  // 6. Calculate aggregate statistics with exact per-material density
  let totalNetSurfaceM2 = 0;
  let netWeightKgAcc = 0;
  for (const p of order.pieces) {
    const pMat = p.material || order.finish || 'Zinc Quartz 0.7';
    const surf = (p.dev / 1000) * p.length * p.quantity;
    totalNetSurfaceM2 += surf;
    netWeightKgAcc += surf * getMaterialDensity(pMat);
  }

  let totalGrossSurfaceM2 = 0;
  let grossWeightKgAcc = 0;
  for (const m of finalMotherItems) {
    const mMat = m.material || order.finish || 'Zinc Quartz 0.7';
    const surf = (m.motherWidth / 1000) * m.motherLength;
    totalGrossSurfaceM2 += surf;
    grossWeightKgAcc += surf * getMaterialDensity(mMat);
  }
  for (const s of appliedWorkshopScraps) {
    const sMat = s.material || order.finish || 'Zinc Quartz 0.7';
    const surf = (s.scrapDev / 1000) * s.pieceLength;
    totalGrossSurfaceM2 += surf;
    grossWeightKgAcc += surf * getMaterialDensity(sMat);
  }

  let reusableScrapSurfaceM2 = 0;
  for (const s of finalCreatedScraps) {
    reusableScrapSurfaceM2 += (s.dev / 1000) * s.length;
  }

  const netLossSurfaceM2 = Math.max(
    0,
    totalGrossSurfaceM2 - totalNetSurfaceM2 - reusableScrapSurfaceM2
  );

  const materialEfficiencyRate =
    totalGrossSurfaceM2 > 0
      ? Math.round(
          ((totalNetSurfaceM2 + reusableScrapSurfaceM2) / totalGrossSurfaceM2) *
            1000
        ) / 10
      : 100;

  const netWeightKg = Math.round(netWeightKgAcc * 10) / 10;
  const grossWeightKg = Math.round(grossWeightKgAcc * 10) / 10;

  return {
    orderId: order.id,
    timestamp,
    piecesRequired: order.pieces,
    workshopScrapProposals: proposals,
    appliedWorkshopScraps,
    usedScrapsFromStock: [],
    motherItemsNeeded: finalMotherItems,
    newReusableScrapsCreated: finalCreatedScraps,
    totalNetSurfaceM2: Math.round(totalNetSurfaceM2 * 100) / 100,
    totalGrossSurfaceM2: Math.round(totalGrossSurfaceM2 * 100) / 100,
    reusableScrapSurfaceM2: Math.round(reusableScrapSurfaceM2 * 100) / 100,
    netLossSurfaceM2: Math.round(netLossSurfaceM2 * 100) / 100,
    materialEfficiencyRate,
    netWeightKg,
    grossWeightKg,
  };
}

