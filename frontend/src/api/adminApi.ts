import { apiRequest, ApiResponse } from './client';

export interface AdminTokenResponse {
  token: string;
  expires_at: number;
  ttl_sec: number;
}

export interface AdminStatusResponse {
  configured: boolean;
  authenticated: boolean;
  expires_in_sec: number;
  locked_out: boolean;
  retry_after_sec: number;
}

export const ADMIN_TOKEN_STORAGE_KEY = 'faconote.admin.token';

export const adminApi = {
  async getStatus(token?: string | null): Promise<ApiResponse<AdminStatusResponse>> {
    const headers: Record<string, string> = {};
    if (token) headers['X-Admin-Token'] = token;
    return apiRequest<AdminStatusResponse>('/api/v1/admin/status', {
      method: 'GET',
      headers,
    });
  },

  async setup(password: string): Promise<ApiResponse<AdminTokenResponse>> {
    return apiRequest<AdminTokenResponse>('/api/v1/admin/setup', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  },

  async login(password: string): Promise<ApiResponse<AdminTokenResponse>> {
    return apiRequest<AdminTokenResponse>('/api/v1/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  },

  async logout(token?: string | null): Promise<ApiResponse<{ revoked: boolean }>> {
    const headers: Record<string, string> = {};
    if (token) headers['X-Admin-Token'] = token;
    return apiRequest<{ revoked: boolean }>('/api/v1/admin/logout', {
      method: 'POST',
      headers,
    });
  },
};
