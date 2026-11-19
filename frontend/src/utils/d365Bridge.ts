// Liaison avec l'extension navigateur « Façonote → D365 » (postMessage dans la page).
import { IS_PREVIEW, PREVIEW_SEND_DISABLED, storageKey } from './preview';
// L'extension range la commande dans le navigateur, puis pré-remplit D365 matière par matière.
// Les groupes envoyés sont rendus tels quels par le backend (route d365-order) : aucun calcul ici.
import { CoilEntry, EncodedEntry } from '../types';

export const D365_ORDER_RE = /^CC\d{11}$/;

export interface ExtensionReply {
  source: 'faconote-ext';
  type: 'ACK' | 'ERROR';
  requestId?: string;
  action?: string;
  orderNumber?: string;
  message?: string;
  error?: string;
}

// Envoie un message à l'extension et attend sa réponse (ACK ou ERROR).
export function postToExtension(
  message: Record<string, unknown>,
  version = 1,
  timeoutMs = 3000
): Promise<ExtensionReply> {
  if (IS_PREVIEW) return Promise.reject(new Error(PREVIEW_SEND_DISABLED));
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
    window.postMessage({ source: 'faconote', version, requestId, ...message }, origin);
  });
}

// --- Sauvegarde de la commande en cours (survit à F5), effacée par « Vider la commande » ---

const ORDER_STORAGE_KEY = storageKey('faconote_commande_v2');
const LEGACY_SHEET_KEY = storageKey('faconote_feuille_dev_piece_v1');

export interface SavedOrder {
  orderNumber: string;
  activeMaterial: string;
  pieces: EncodedEntry[];
  coils: CoilEntry[];
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

const isCoilEntry = (e: unknown): e is CoilEntry => {
  if (!e || typeof e !== 'object') return false;
  const x = e as Record<string, unknown>;
  return (
    typeof x.id === 'string' &&
    typeof x.width === 'number' &&
    typeof x.quantity === 'number' &&
    typeof x.unitLength === 'number' &&
    typeof x.totalLength === 'number' &&
    typeof x.material === 'string' &&
    typeof x.isChute === 'boolean' &&
    typeof x.time === 'string'
  );
};

interface ParsedSave extends SavedOrder {
  savedAtMs: number;
}

// Lit une sauvegarde (v1 : pièces dans « entries », v2 : pièces et bobines). null si absente ou illisible.
function readSave(key: string, version: 1 | 2): ParsedSave | null {
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const list = version === 1 ? data.entries : data.pieces;
    if (data.version !== version || !Array.isArray(list)) return null;
    const savedAtMs = typeof data.savedAt === 'string' ? Date.parse(data.savedAt) : NaN;
    return {
      orderNumber: typeof data.orderNumber === 'string' ? data.orderNumber : '',
      activeMaterial: typeof data.activeMaterial === 'string' ? data.activeMaterial : '',
      pieces: list.filter(isEntry),
      coils: version === 2 && Array.isArray(data.coils) ? data.coils.filter(isCoilEntry) : [],
      savedAtMs: Number.isNaN(savedAtMs) ? 0 : savedAtMs,
    };
  } catch {
    return null;
  }
}

function writeSave(order: SavedOrder): boolean {
  try {
    window.localStorage.setItem(
      ORDER_STORAGE_KEY,
      JSON.stringify({ version: 2, savedAt: new Date().toISOString(), ...order })
    );
    return true;
  } catch {
    return false;
  }
}

// Lit la commande : v2, sinon migration de l'ancienne feuille v1 (sans perte).
// Les deux présentes (un ancien onglet a réécrit v1) : la plus récente par savedAt gagne.
export function loadSavedOrder(): SavedOrder | null {
  try {
    const v2 = readSave(ORDER_STORAGE_KEY, 2);
    const v1 = readSave(LEGACY_SHEET_KEY, 1);
    if (!v1) return v2 ? strip(v2) : null;
    let result: SavedOrder;
    if (v2 && v2.savedAtMs >= v1.savedAtMs) {
      result = strip(v2);
    } else {
      // v1 plus récente : ses pièces et son n° ; les bobines v2 seulement pour le même n°
      result = {
        orderNumber: v1.orderNumber,
        activeMaterial: v1.activeMaterial,
        pieces: v1.pieces,
        coils: v2 && v2.orderNumber === v1.orderNumber ? v2.coils : [],
      };
    }
    // v1 supprimée seulement si l'écriture v2 a réussi
    if (writeSave(result)) window.localStorage.removeItem(LEGACY_SHEET_KEY);
    return result;
  } catch {
    return null;
  }
}

function strip(p: ParsedSave): SavedOrder {
  return { orderNumber: p.orderNumber, activeMaterial: p.activeMaterial, pieces: p.pieces, coils: p.coils };
}

export function saveOrder(order: SavedOrder): void {
  try {
    if (order.pieces.length === 0 && order.coils.length === 0 && !order.orderNumber) {
      window.localStorage.removeItem(ORDER_STORAGE_KEY);
    } else {
      writeSave(order);
    }
  } catch {
    // Stockage indisponible (navigation privée, quota) : la commande reste en mémoire
  }
}

export function clearSavedOrder(): void {
  try {
    window.localStorage.removeItem(ORDER_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_SHEET_KEY);
  } catch {
    // ignoré
  }
}
