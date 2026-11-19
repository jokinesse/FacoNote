import { useCallback, useEffect, useRef, useState } from 'react';
import { CoilEntry, EncodedEntry } from '../types';

// Annuler / rétablir sur plusieurs niveaux pour les lignes de la commande (pièces et bobines).
// Chaque changement des lignes (saisie, correction, suppression, matière, vider) est un niveau.
// Le n° de commande n'en fait pas partie (il se corrige dans son champ).
export interface OrderSnapshot {
  pieces: EncodedEntry[];
  coils: CoilEntry[];
}

const LIMIT = 50;

const same = (a: OrderSnapshot, b: OrderSnapshot) => a.pieces === b.pieces && a.coils === b.coils;

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

// Texte court du changement entre deux états, pour le message « Annulé : … » / « Rétabli : … ».
function describe(from: OrderSnapshot, to: OrderSnapshot): string {
  const parts: string[] = [];
  const dp = to.pieces.length - from.pieces.length;
  const dc = to.coils.length - from.coils.length;
  if (dp > 0) parts.push(`ajout de ${plural(dp, 'ligne pièce', 'lignes pièce')}`);
  if (dp < 0) parts.push(`suppression de ${plural(-dp, 'ligne pièce', 'lignes pièce')}`);
  if (dc > 0) parts.push(`ajout de ${plural(dc, 'ligne bobine', 'lignes bobine')}`);
  if (dc < 0) parts.push(`suppression de ${plural(-dc, 'ligne bobine', 'lignes bobine')}`);
  return parts.length > 0 ? parts.join(', ') : 'correction de ligne';
}

export function useOrderHistory(
  current: OrderSnapshot,
  restore: (snapshot: OrderSnapshot) => void
) {
  const past = useRef<OrderSnapshot[]>([]);
  const future = useRef<OrderSnapshot[]>([]);
  const previous = useRef<OrderSnapshot>(current);
  const restoring = useRef<OrderSnapshot | null>(null);
  const [, setVersion] = useState(0);

  useEffect(() => {
    if (same(previous.current, current)) return;
    if (restoring.current && same(restoring.current, current)) {
      restoring.current = null;
    } else {
      past.current.push(previous.current);
      if (past.current.length > LIMIT) past.current.shift();
      future.current = [];
    }
    previous.current = current;
    setVersion((v) => v + 1);
  }, [current]);

  // Renvoie le texte du changement défait, ou null s'il n'y a rien à annuler.
  const undo = useCallback((): string | null => {
    const target = past.current.pop();
    if (!target) return null;
    future.current.push(previous.current);
    const text = describe(target, previous.current);
    restoring.current = target;
    restore(target);
    return text;
  }, [restore]);

  const redo = useCallback((): string | null => {
    const target = future.current.pop();
    if (!target) return null;
    past.current.push(previous.current);
    const text = describe(previous.current, target);
    restoring.current = target;
    restore(target);
    return text;
  }, [restore]);

  return {
    undo,
    redo,
    undoCount: past.current.length,
    redoCount: future.current.length,
  };
}
