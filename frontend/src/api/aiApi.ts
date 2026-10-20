import { apiRequest, ApiResponse } from './client';
import {
  DocumentParseRequest,
  DocumentParseResponse,
  ImageProcessRequest,
  ImageProcessResponse,
} from './types';

export const aiApi = {
  /**
   * Extraction OCR multimodale de pièces depuis un croquis, plan ou descriptif d'atelier
   */
  async parseDocument(request: DocumentParseRequest): Promise<ApiResponse<DocumentParseResponse>> {
    return apiRequest<DocumentParseResponse>('/api/v1/ai/parse-document', {
      method: 'POST',
      body: JSON.stringify(request),
      timeoutMs: 45000, // L'appel Gemini OCR peut prendre plusieurs secondes
    });
  },

  /**
   * Prétraitement d'image Pillow (rotation orthogonale 90° et rehaussement de contraste +15%)
   */
  async processImage(request: ImageProcessRequest): Promise<ApiResponse<ImageProcessResponse>> {
    return apiRequest<ImageProcessResponse>('/api/v1/ai/process-image', {
      method: 'POST',
      body: JSON.stringify(request),
      timeoutMs: 15000,
    });
  },
};
