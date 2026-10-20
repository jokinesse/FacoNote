import { apiRequest, ApiResponse } from './client';
import {
  MobileSessionResponse,
  MobileStatusResponse,
  MobileUploadRequest,
} from './types';

export const mobileApi = {
  /**
   * Crée une session temporaire de transfert sans fil et génère l'URL pour QR Code
   */
  async createSession(): Promise<ApiResponse<MobileSessionResponse>> {
    return apiRequest<MobileSessionResponse>('/api/v1/mobile/session', {
      method: 'POST',
    });
  },

  /**
   * Envoi d'une photo depuis l'appareil mobile
   */
  async uploadImage(request: MobileUploadRequest): Promise<ApiResponse<{ success: boolean; message: string; session_id: string }>> {
    return apiRequest<{ success: boolean; message: string; session_id: string }>('/api/v1/mobile/upload', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },

  /**
   * Consultation / polling du statut de la session par le poste PC
   */
  async getStatus(sessionId: string): Promise<ApiResponse<MobileStatusResponse>> {
    return apiRequest<MobileStatusResponse>(`/api/v1/mobile/status/${encodeURIComponent(sessionId)}`, {
      method: 'GET',
    });
  },

  /**
   * Réinitialise la session pour capturer un nouveau croquis sans re-générer de QR code
   */
  async resetSession(sessionId: string): Promise<ApiResponse<{ success: boolean }>> {
    return apiRequest<{ success: boolean }>(`/api/v1/mobile/reset/${encodeURIComponent(sessionId)}`, {
      method: 'POST',
    });
  },
};
