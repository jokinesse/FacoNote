import { ApiError, ApiErrorDetail } from './types';

// En environnement de dev local Vite proxie /api vers http://127.0.0.1:8000
const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

export interface ApiResponse<T> {
  data: T;
  executionTimeMs: number;
  status: number;
}

export interface RequestOptions extends RequestInit {
  timeoutMs?: number;
}

/**
 * Formate les erreurs de validation FastAPI (Pydantic v2) en messages clairs pour l'opérateur d'atelier.
 */
function formatErrorMessage(status: number, data: any): { message: string; details?: ApiErrorDetail[] | string } {
  if (!data) {
    if (status === 404) return { message: 'Ressource introuvable sur le serveur (404).' };
    if (status === 410) return { message: 'La session a expiré après 45 minutes d’inactivité (410).' };
    if (status >= 500) return { message: 'Erreur interne du serveur de calcul (500).' };
    return { message: `Erreur réseau ou réponse inattendue (${status}).` };
  }

  // Cas où FastAPI renvoie { detail: "message" }
  if (typeof data.detail === 'string') {
    return { message: data.detail, details: data.detail };
  }

  // Cas des erreurs de validation Pydantic : { detail: [ { loc: [...], msg: "...", type: "..." } ] }
  if (Array.isArray(data.detail)) {
    const details = data.detail as ApiErrorDetail[];
    const formattedList = details.map((err) => {
      const field = err.loc ? err.loc.filter((p) => p !== 'body').join('.') : 'champ';
      const msg = err.msg || 'Valeur invalide';
      return `${field ? `[${field}] ` : ''}${msg}`;
    });

    const summaryMessage = `Erreur de validation : ${formattedList.join(' · ')}`;
    return { message: summaryMessage, details };
  }

  if (typeof data.message === 'string') {
    return { message: data.message, details: data.message };
  }

  return { message: `Erreur ${status}`, details: JSON.stringify(data) };
}

/**
 * Client HTTP centralisé avec mesure du temps d'exécution et gestion robuste des erreurs.
 */
export async function apiRequest<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<ApiResponse<T>> {
  const { timeoutMs = 15000, ...fetchOptions } = options;

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  // Fusion des signaux d'annulation si fourni
  if (fetchOptions.signal) {
    fetchOptions.signal.addEventListener('abort', () => controller.abort());
  }

  const url = `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  const startTime = performance.now();

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...(fetchOptions.headers || {}),
      },
    });

    const endTime = performance.now();
    const executionTimeMs = Math.round(endTime - startTime);

    if (!response.ok) {
      let errorData: any = null;
      try {
        errorData = await response.json();
      } catch {
        try {
          errorData = { detail: await response.text() };
        } catch {
          errorData = null;
        }
      }

      const { message, details } = formatErrorMessage(response.status, errorData);
      throw new ApiError(message, response.status, details, executionTimeMs);
    }

    // Gestion des réponses sans contenu (204)
    if (response.status === 204) {
      return { data: null as unknown as T, executionTimeMs, status: response.status };
    }

    const data = (await response.json()) as T;
    return {
      data,
      executionTimeMs,
      status: response.status,
    };
  } catch (error: any) {
    const endTime = performance.now();
    const executionTimeMs = Math.round(endTime - startTime);

    if (error instanceof ApiError) {
      throw error;
    }

    if (error.name === 'AbortError') {
      throw new ApiError(
        `Le calcul a dépassé le délai imparti (${Math.round(timeoutMs / 1000)}s). Veuillez vérifier la complexité de l'ordre.`,
        408,
        'Délai d’attente dépassé (Timeout)',
        executionTimeMs
      );
    }

    throw new ApiError(
      `Impossible de joindre le serveur Facozinc : ${error.message || 'Erreur réseau inconnue'}. Assurez-vous que le backend FastAPI est démarré.`,
      0,
      error.message,
      executionTimeMs
    );
  } finally {
    clearTimeout(id);
  }
}

/**
 * Récupère du contenu brut (ex: flux HTML pour la fiche d'impression A4).
 */
export async function apiRequestRaw(
  endpoint: string,
  options: RequestOptions = {}
): Promise<{ text: string; executionTimeMs: number; status: number }> {
  const { timeoutMs = 15000, ...fetchOptions } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  const url = `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  const startTime = performance.now();

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        'Accept': 'text/html, text/plain, */*',
        'Content-Type': 'application/json',
        ...(fetchOptions.headers || {}),
      },
    });

    const endTime = performance.now();
    const executionTimeMs = Math.round(endTime - startTime);

    if (!response.ok) {
      const textError = await response.text();
      throw new ApiError(textError || `Erreur ${response.status}`, response.status, textError, executionTimeMs);
    }

    const text = await response.text();
    return { text, executionTimeMs, status: response.status };
  } finally {
    clearTimeout(id);
  }
}
