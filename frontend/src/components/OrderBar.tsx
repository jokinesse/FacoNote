import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronDown, ClipboardList, Printer, Redo2, Send, Trash2, Undo2 } from 'lucide-react';
import { D365_ORDER_RE } from '../utils/d365Bridge';
import { BTN_SECONDARY } from './ui';

// Barre de commande unique, en haut du Calculateur, identique en mode Pièce et Bobine.
// N° D365, contenu de la commande, envoi (action principale), puis actions secondaires,
// et un menu « Vider… » à part pour les actions qui effacent.
interface OrderBarProps {
  orderNumber: string;
  onOrderChange: (value: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  pieceLines: number;
  coilLines: number;
  coilCount: number; // lignes bobine envoyées (compte du backend)
  chuteCount: number; // chutes envoyées (compte du backend)
  isSending: boolean;
  onSend: () => void;
  onOptimize: () => void;
  onPrint: () => void;
  isPrinting: boolean;
  onClearPieces: () => void;
  onClearCoils: () => void;
  onClearOrder: () => void;
  onUndo: () => void;
  onRedo: () => void;
  undoCount: number;
  redoCount: number;
  children?: React.ReactNode; // message de retour de l'extension
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

export const OrderBar: React.FC<OrderBarProps> = ({
  orderNumber,
  onOrderChange,
  inputRef,
  pieceLines,
  coilLines,
  coilCount,
  chuteCount,
  isSending,
  onSend,
  onOptimize,
  onPrint,
  isPrinting,
  onClearPieces,
  onClearCoils,
  onClearOrder,
  onUndo,
  onRedo,
  undoCount,
  redoCount,
  children,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isEmpty = pieceLines === 0 && coilLines === 0;
  const invalidNumber = orderNumber !== '' && !D365_ORDER_RE.test(orderNumber);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const pick = (action: () => void) => () => {
    setMenuOpen(false);
    action();
  };

  const sendExtra = [
    coilCount > 0 ? plural(coilCount, 'bobine', 'bobines') : '',
    chuteCount > 0 ? plural(chuteCount, 'chute', 'chutes') : '',
  ].filter(Boolean);

  return (
    <div className="no-print sticky top-[var(--faco-header-h,57px)] z-20 faco-card bg-white border border-slate-200 rounded-xl shadow-xs">
      <div className="px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* Commande : n° et contenu */}
        <div className="flex items-center gap-2.5 min-w-0">
          <ClipboardList className="w-4 h-4 text-faco-blue shrink-0" />
          <div className="flex flex-col">
            <input
              ref={inputRef}
              type="text"
              value={orderNumber}
              onChange={(e) => onOrderChange(e.target.value.toUpperCase().replace(/\s+/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onSend();
                }
              }}
              placeholder="N° commande D365"
              aria-label="N° commande D365"
              aria-invalid={invalidNumber}
              title="N° de commande D365 : CC suivi de 11 chiffres (ex. CC26000236736)"
              maxLength={13}
              className={`faco-input w-40 bg-white border rounded-lg px-2.5 py-1.5 text-sm font-mono font-bold focus:outline-none ${
                invalidNumber ? 'border-rose-400 focus:border-rose-500' : 'border-slate-300 focus:border-faco-blue'
              }`}
            />
            {invalidNumber && (
              <span className="text-[10px] text-rose-600 mt-0.5">CC suivi de 11 chiffres</span>
            )}
          </div>
          <span className="text-xs text-slate-500 whitespace-nowrap">
            {isEmpty ? (
              'Commande vide'
            ) : (
              <>
                <strong className="text-faco-text">{plural(pieceLines, 'ligne pièce', 'lignes pièce')}</strong>
                {' · '}
                <strong className="text-faco-text">{plural(coilLines, 'ligne bobine', 'lignes bobine')}</strong>
              </>
            )}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap ml-auto">
          {/* Annuler / rétablir (plusieurs niveaux) */}
          <div className="flex items-center rounded-lg border border-slate-200 overflow-hidden">
            <button
              type="button"
              onClick={onUndo}
              disabled={undoCount === 0}
              className="px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-white hover:bg-slate-100 disabled:opacity-40 flex items-center gap-1 cursor-pointer"
              title="Annuler le dernier changement des lignes (Ctrl+Z)"
              aria-label="Annuler"
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span>Annuler</span>
            </button>
            <button
              type="button"
              onClick={onRedo}
              disabled={redoCount === 0}
              className="px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-white hover:bg-slate-100 disabled:opacity-40 border-l border-slate-200 flex items-center gap-1 cursor-pointer"
              title="Rétablir le changement annulé (Ctrl+Y)"
              aria-label="Rétablir"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Actions secondaires */}
          <button
            type="button"
            onClick={onPrint}
            disabled={isPrinting || pieceLines === 0}
            className={BTN_SECONDARY}
            title="Feuille A4 des pièces par borne, à imprimer ou enregistrer en PDF"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{isPrinting ? 'Préparation…' : 'PDF / Imprimer'}</span>
          </button>

          {/* Action principale */}
          <button
            type="button"
            onClick={onSend}
            disabled={isSending || isEmpty}
            className="px-3.5 py-1.5 bg-faco-blue hover:bg-faco-blue-dark disabled:opacity-40 text-white font-semibold rounded-lg text-xs flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
            title="Envoyer la commande (pièces et bobines) vers l'extension Edge « Façonote → D365 »"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{isSending ? 'Envoi…' : 'Envoyer vers D365'}</span>
            {sendExtra.length > 0 && (
              <span className="ml-0.5 px-1.5 py-0.5 rounded bg-white/20 text-[10px] font-medium">
                + {sendExtra.join(' + ')}
              </span>
            )}
          </button>

          {/* Actions qui effacent : à part, dans un menu */}
          <div className="relative pl-2 ml-1 border-l border-slate-200" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              disabled={isEmpty && !orderNumber}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="px-2.5 py-1.5 text-xs font-medium text-rose-700 bg-white hover:bg-rose-50 disabled:opacity-40 border border-rose-200 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Vider…</span>
              <ChevronDown className="w-3 h-3" />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-1 w-64 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-30"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={pick(onClearPieces)}
                  disabled={pieceLines === 0}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                >
                  <div className="font-semibold text-slate-800">Vider les pièces</div>
                  <div className="text-[11px] text-slate-500">Les bobines et le n° restent</div>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={pick(onClearCoils)}
                  disabled={coilLines === 0}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                >
                  <div className="font-semibold text-slate-800">Vider les bobines</div>
                  <div className="text-[11px] text-slate-500">Les pièces et le n° restent</div>
                </button>
                <div className="my-1 border-t border-slate-100" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={pick(onClearOrder)}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-rose-50 cursor-pointer"
                >
                  <div className="font-semibold text-rose-700">Vider toute la commande</div>
                  <div className="text-[11px] text-slate-500">Pièces, bobines, n°, et la commande dans l'extension</div>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {children && <div className="px-4 pb-2.5">{children}</div>}
    </div>
  );
};
