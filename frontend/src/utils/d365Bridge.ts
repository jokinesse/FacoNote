// Liaison avec l'extension navigateur « Façonote → D365 » (postMessage dans la page).
// L'extension range la commande dans le navigateur, puis pré-remplit D365 matière par matière.
// Les valeurs envoyées viennent du backend (pieces-summary, reference) : aucun calcul ici.
import { PiecesSummaryResponse, ReferenceResponse } from '../api';
import { EncodedEntry } from '../types';

export const D365_ORDER_RE = /^CC\d{11}$/;

export interface D365Group {
  material: string; // matière Façonote, ex. « Zinc ATZ 0.7 »
  matiere: string; // champ D365 « Matières », ex. « ATZ »
  epaisseur: string; // champ D365 « Epaisseur », ex. « 0.7 mm »
  lengths: Record<string, number>; // borne (mm) -> longueur (m), toutes les bornes présentes
}

export interface ExtensionReply {
  source: 'faconote-ext';
  type: 'ACK' | 'ERROR';
  requestId?: string;
  action?: string;
  orderNumber?: string;
  message?: string;
  error?: string;
}

// Un groupe par matière, à partir du tableau des bornes calculé par le backend.
export function buildD365Groups(
  summary: PiecesSummaryResponse,
  reference: ReferenceResponse
): { groups: D365Group[]; unknown: string[] } {
  // unknown : matières sans libellé D365 connu (l'envoi est alors refusé)
  const groups: D365Group[] = [];
  const unknown: string[] = [];
  for (const m of summary.materials) {
    const ref = reference.materials.find((r) => r.name === m.material);
    if (!ref || !ref.d365_matiere) {
      unknown.push(m.material);
      continue;
    }
    const lengths: Record<string, number> = {};
    for (const bound of reference.piece_bounds_mm) {
      const row = summary.bound_rows.find(
        (r) => r.bound === bound && r.material === m.material && !r.is_empty
      );
      lengths[String(bound)] = row ? row.length_m : 0;
    }
    groups.push({
      material: m.material,
      matiere: ref.d365_matiere,
      epaisseur: ref.d365_epaisseur,
      lengths,
    });
  }
  return { groups, unknown };
}

// Envoie un message à l'extension et attend sa réponse (ACK ou ERROR).
export function postToExtension(message: Record<string, unknown>, timeoutMs = 3000): Promise<ExtensionReply> {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const origin = window.location.origin;
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== origin) return;
      const data = event.data as ExtensionReply | null;
      if (!data || data.source !== 'faconote-ext' || data.requestId !== requestId) return;
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(data);
    };
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(
        new Error(
          "Pas de réponse de l'extension « Façonote → D365 » : est-elle installée et activée dans Edge ? (après installation, actualisez la page)"
        )
      );
    }, timeoutMs);
    window.addEventListener('message', onMessage);
    window.postMessage({ source: 'faconote', version: 1, requestId, ...message }, origin);
  });
}

// --- Sauvegarde de la feuille en cours (survit à F5), effacée par « Vider » ---

const SHEET_STORAGE_KEY = 'faconote_feuille_dev_piece_v1';

export interface SavedSheet {
  orderNumber: string;
  activeMaterial: string;
  entries: EncodedEntry[];
}

const isEntry = (e: unknown): e is EncodedEntry => {
  if (!e || typeof e !== 'object') return false;
  const x = e as Record<string, unknown>;
  return (
    typeof x.id === 'string' &&
    typeof x.dev === 'number' &&
    typeof x.unitLength === 'number' &&
    typeof x.quantity === 'number' &&
    typeof x.evaluatedLength === 'number' &&
    typeof x.matchedBound === 'number' &&
    (x.material === undefined || typeof x.material === 'string')
  );
};

export function loadSavedSheet(): SavedSheet | null {
  try {
    const raw = window.localStorage.getItem(SHEET_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<SavedSheet> & { version?: number };
    if (data.version !== 1 || !Array.isArray(data.entries)) return null;
    return {
      orderNumber: typeof data.orderNumber === 'string' ? data.orderNumber : '',
      activeMaterial: typeof data.activeMaterial === 'string' ? data.activeMaterial : '',
      entries: data.entries.filter(isEntry),
    };
  } catch {
    return null;
  }
}

export function saveSheet(sheet: SavedSheet): void {
  try {
    if (sheet.entries.length === 0 && !sheet.orderNumber) {
      window.localStorage.removeItem(SHEET_STORAGE_KEY);
    } else {
      window.localStorage.setItem(
        SHEET_STORAGE_KEY,
        JSON.stringify({ version: 1, savedAt: new Date().toISOString(), ...sheet })
      );
    }
  } catch {
    // Stockage indisponible (navigation privée, quota) : la feuille reste en mémoire
  }
}

export function clearSavedSheet(): void {
  try {
    window.localStorage.removeItem(SHEET_STORAGE_KEY);
  } catch {
    // ignoré
  }
}
