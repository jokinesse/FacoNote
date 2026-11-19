import React from 'react';
import { Send, Trash2 } from 'lucide-react';
import { D365_ORDER_RE } from '../utils/d365Bridge';
import { BTN_DANGER } from './ui';

// N° de commande D365, envoi vers l'extension et « Vider la commande » :
// même bloc dans l'onglet Pièce et dans l'onglet Bobine (un seul n° partagé).
interface OrderBarProps {
  orderNumber: string;
  onOrderChange: (value: string) => void;
  onSend: () => void;
  onClearOrder: () => void;
  isSending: boolean;
  canClear: boolean;
  coilCount: number; // saisies bobine qui partiront avec la commande
  inputRef: React.RefObject<HTMLInputElement | null>;
}

export const OrderBar: React.FC<OrderBarProps> = ({
  orderNumber,
  onOrderChange,
  onSend,
  onClearOrder,
  isSending,
  canClear,
  coilCount,
  inputRef,
}) => (
  <>
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
      title="N° de commande D365 : CC suivi de 11 chiffres (ex. CC26000236736)"
      maxLength={13}
      className={`faco-input w-36 bg-white border rounded-lg px-2 py-1.5 text-xs font-mono focus:outline-none ${
        orderNumber && !D365_ORDER_RE.test(orderNumber)
          ? 'border-rose-400 focus:border-rose-500'
          : 'border-slate-300 focus:border-[#00478a]'
      }`}
    />
    <button
      type="button"
      onClick={onSend}
      disabled={isSending}
      className="px-2.5 py-1.5 text-xs font-semibold text-[#00478a] bg-white hover:bg-sky-50 disabled:opacity-40 border border-sky-300 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
      title="Envoyer la commande (pièces et bobines) vers l'extension Edge « Façonote → D365 »"
    >
      <Send className="w-3.5 h-3.5" />
      <span>{isSending ? 'Envoi…' : "Envoyer vers l'extension"}</span>
    </button>
    {coilCount > 0 && (
      <span className="text-xs font-medium text-amber-800">
        {coilCount === 1 ? '1 saisie bobine sera envoyée aussi' : `${coilCount} saisies bobine seront envoyées aussi`}
      </span>
    )}
    <button
      type="button"
      onClick={onClearOrder}
      disabled={!canClear}
      className={BTN_DANGER}
      title="Vide toute la commande : pièces, bobines et n° de commande, et la retire de l'extension"
    >
      <Trash2 className="w-3.5 h-3.5" />
      <span>Vider la commande</span>
    </button>
  </>
);
