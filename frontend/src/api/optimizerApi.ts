import { apiRequest, apiRequestRaw, ApiResponse } from './client';
import {
  AutoBreakdownRequest,
  AutoPieceBreakdownResponse,
  CoilEncodeRequest,
  CoilEncodeResponse,
  CoilSummaryRequest,
  CoilSummaryResponse,
  PieceEncodeItem,
  PiecesEncodeResponse,
  PieceSummaryEntry,
  PiecesSummaryResponse,
  ReferenceResponse,
  FastEncoderInputRequest,
  FastEncoderEntryResponse,
  OptimizationRequest,
  OptimizationResponse,
} from './types';

export const optimizerApi = {
  /**
   * Données de référence atelier : matières (famille, épaisseur, densité, largeurs de bobines),
   * bornes du calculateur Pièce, grille Bobine, largeurs de chutes de rack.
   */
  async getReference(): Promise<ApiResponse<ReferenceResponse>> {
    return apiRequest<ReferenceResponse>('/api/v1/optimizer/reference', { method: 'GET' });
  },

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
   * Calculateur Pièce : validation et calcul d'un lot de pièces déjà décomposées
   * (import du scan IA, résultat d'auto-métrage, variante choisie).
   */
  async piecesEncode(request: { items: PieceEncodeItem[] }): Promise<ApiResponse<PiecesEncodeResponse>> {
    return apiRequest<PiecesEncodeResponse>('/api/v1/optimizer/pieces-encode', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },

  /**
   * Calculateur Pièce : vue par développement, grille des bornes, totaux, parts en %.
   */
  async piecesSummary(request: { entries: PieceSummaryEntry[] }): Promise<ApiResponse<PiecesSummaryResponse>> {
    return apiRequest<PiecesSummaryResponse>('/api/v1/optimizer/pieces-summary', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },

  /**
   * Calculateur Bobine : validation et calcul d'une saisie (largeur / quantité / longueur).
   */
  async coilEncode(request: CoilEncodeRequest): Promise<ApiResponse<CoilEncodeResponse>> {
    return apiRequest<CoilEncodeResponse>('/api/v1/optimizer/coil-encode', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },

  /**
   * Calculateur Bobine : tableau largeur × matière, totaux et chutes par matière.
   */
  async coilSummary(request: CoilSummaryRequest): Promise<ApiResponse<CoilSummaryResponse>> {
    return apiRequest<CoilSummaryResponse>('/api/v1/optimizer/coil-summary', {
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
