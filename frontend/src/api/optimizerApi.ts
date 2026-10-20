import { apiRequest, apiRequestRaw, ApiResponse } from './client';
import {
  AutoBreakdownRequest,
  AutoPieceBreakdownResponse,
  FastEncoderInputRequest,
  FastEncoderEntryResponse,
  OptimizationRequest,
  OptimizationResponse,
} from './types';

export const optimizerApi = {
  /**
   * Analyse et validation d'une saisie rapide atelier (FastEncoder)
   * Décode l'expression arithmétique et affecte la borne standard.
   */
  async quickEncode(request: FastEncoderInputRequest): Promise<ApiResponse<FastEncoderEntryResponse>> {
    return apiRequest<FastEncoderEntryResponse>('/api/v1/optimizer/quick-encode', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },

  /**
   * Auto-calepinage du métrage linéaire sans quantité (Quantité = 0)
   * Détermine le découpage optimal en tôles d'atelier (0 chute / diviseurs stricts).
   */
  async autoBreakdown(request: AutoBreakdownRequest): Promise<ApiResponse<AutoPieceBreakdownResponse>> {
    return apiRequest<AutoPieceBreakdownResponse>('/api/v1/optimizer/auto-breakdown', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },

  /**
   * Calcul d'imbrication et refente longitudinale (Nesting 1D/2D)
   * Optimise la découpe sur tôles mères et chutes de rack.
   */
  async calculateNesting(request: OptimizationRequest): Promise<ApiResponse<OptimizationResponse>> {
    return apiRequest<OptimizationResponse>('/api/v1/optimizer/calculate', {
      method: 'POST',
      body: JSON.stringify(request),
      timeoutMs: 30000, // 30s max pour les calculs d'imbrication lourds
    });
  },

  /**
   * Génération de la fiche de débit atelier normalisée A4 (HTML5/CSS)
   * Retourne le flux HTML direct prêt pour l'impression massicot/plieuse.
   */
  async getPrintSheetHtml(request: OptimizationRequest): Promise<{ text: string; executionTimeMs: number }> {
    return apiRequestRaw('/api/v1/optimizer/print-sheet', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },
};
