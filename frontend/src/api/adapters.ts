import {
  OptimizationResponse,
  ShapedPieceModel,
} from './types';
import {
  OptimizationResult,
  ShapedPiece,
  MaterialType,
} from '../types';

/**
 * Convertit la réponse de calcul du backend FastAPI (OptimizationResponse)
 * vers la structure de vue attendue par les composants UI (OptimizationResult).
 * Aucune logique mathématique n'est recalculée : toutes les valeurs proviennent du moteur FastAPI.
 */
export function mapBackendOptimizationToResult(
  backendData: OptimizationResponse,
  sourcePieces: ShapedPiece[]
): OptimizationResult {
  const motherItemsNeeded = backendData.slits.map((s) => ({
    motherWidth: s.mother_width,
    motherLength: s.mother_length,
    material: s.material,
    slits: [
      {
        motherWidth: s.mother_width,
        motherLength: s.mother_length,
        material: s.material,
        strips: s.strips.map((st) => ({
          pieceId: st.piece_id,
          label: st.label,
          dev: st.dev,
          length: st.length,
          qty: st.qty,
          material: st.material,
        })),
        usedWidth: s.used_width,
        scrapWidth: s.scrap_width,
        isScrapReusable: s.is_scrap_reusable,
        suggestedScrapRef: s.suggested_scrap_ref || undefined,
      },
    ],
  }));

  const newReusableScrapsCreated = backendData.slits
    .filter((s) => s.is_scrap_reusable && s.scrap_width > 0)
    .map((s, idx) => ({
      id: `scrap-${idx}-${backendData.order_id}`,
      refCode: s.suggested_scrap_ref || `CHUTE-${s.scrap_width}x${s.mother_length}m`,
      material: (s.material.toLowerCase().includes('alu') ? 'ALUMINIUM' : 'ZINC') as MaterialType,
      finish: s.material,
      thickness: '0.7',
      dev: s.scrap_width,
      length: s.mother_length,
      weightKg: 0,
      location: 'RACK_ATELIER',
      dateAdded: new Date(backendData.timestamp * 1000).toISOString(),
      isUsed: false,
    }));

  const workshopScrapProposals = (backendData.workshop_scrap_proposals || []).map((p) => ({
    id: p.proposal_id,
    pieceId: p.piece_id,
    pieceLabel: p.label,
    pieceDev: p.dev,
    pieceLength: p.length,
    recommendedScrapDev: p.rack_scrap_width,
    material: p.rack_scrap_ref,
    reason: p.reason,
    motherWidthSaved: p.rack_scrap_width,
    motherLengthSaved: p.length,
    areaSavedM2: Math.round(((p.rack_scrap_width / 1000) * p.length) * 100) / 100,
    weightSavedKg: 0,
  }));

  const appliedWorkshopScraps = (backendData.applied_workshop_scraps || []).map((desc) => ({
    pieceLabel: desc,
    pieceDev: 0,
    pieceLength: 0,
    scrapDev: 0,
  }));

  return {
    orderId: backendData.order_id,
    timestamp: new Date(backendData.timestamp * 1000).toLocaleString('fr-FR'),
    piecesRequired: sourcePieces,
    workshopScrapProposals,
    appliedWorkshopScraps,
    usedScrapsFromStock: [],
    motherItemsNeeded,
    newReusableScrapsCreated,
    totalNetSurfaceM2: backendData.total_net_surface_m2,
    totalGrossSurfaceM2: backendData.total_gross_surface_m2,
    reusableScrapSurfaceM2: backendData.reusable_scrap_surface_m2,
    netLossSurfaceM2: backendData.net_loss_surface_m2,
    materialEfficiencyRate: backendData.material_efficiency_rate,
    netWeightKg: backendData.net_weight_kg,
    grossWeightKg: backendData.gross_weight_kg,
  };
}

/**
 * Convertit un ShapedPiece UI en ShapedPieceModel attendu par l'API FastAPI.
 */
export function mapShapedPieceToModel(p: ShapedPiece): ShapedPieceModel {
  return {
    id: p.id,
    label: p.label || `Pièce ${p.dev}mm`,
    dev: p.dev,
    length: p.length,
    quantity: p.quantity,
    bends: p.bends !== undefined ? p.bends : 2,
    material: p.material || 'Zinc Naturel 0.7',
    workshop_split_reason: p.workshopSplitReason || null,
    notes: p.notes || null,
    original_total_length_requested: p.originalTotalLengthRequested || null,
  };
}
