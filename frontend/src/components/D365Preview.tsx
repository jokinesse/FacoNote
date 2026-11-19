import React, { useEffect, useRef } from 'react';
import { AlertTriangle, Send, X, XCircle } from 'lucide-react';
import { D365OrderResponse } from '../api';

// Aperçu avant l'envoi vers D365 : affiche exactement ce que le backend a préparé (route d365-order),
// matière par matière. Aucun calcul ici. Entrée = envoyer, Échap = revenir corriger.
interface D365PreviewProps {
  preview: D365OrderResponse;
  isSending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

const fmtM = (v: number) => `${v.toFixed(2)} m`;

export const D365Preview: React.FC<D365PreviewProps> = ({ preview, isSending, onConfirm, onClose }) => {
  const sendRef = useRef<HTMLButtonElement>(null);
  const hasErrors = preview.errors.length > 0;

  useEffect(() => {
    sendRef.current?.focus();
  }, []);

  // Clavier de la fenêtre, avant les raccourcis globaux de la page (calculette d'atelier)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!hasErrors && !isSending) onConfirm();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, onConfirm, hasErrors, isSending]);

  return (
    <div
      className="no-print fixed inset-0 z-[200] bg-slate-900/40 flex items-start sm:items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="d365-preview-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3">
          <div>
            <h2 id="d365-preview-title" className="text-sm font-bold text-[#282828]">
              Vérifier avant l'envoi vers D365
            </h2>
            <div className="text-xs text-slate-500">
              Commande <span className="font-mono font-bold text-[#00478a]">{preview.order_number}</span> ·{' '}
              {preview.groups.length} {preview.groups.length > 1 ? 'matières' : 'matière'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          {preview.errors.map((e, i) => (
            <div
              key={`e${i}`}
              className="flex items-start gap-2 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800"
            >
              <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{e.message}</span>
            </div>
          ))}
          {preview.warnings.map((w, i) => (
            <div
              key={`w${i}`}
              className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900"
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{w.message}</span>
            </div>
          ))}

          {preview.groups.map((g) => {
            const devs = Object.entries(g.lengths).filter(([, m]) => m > 0);
            const coils = g.coils ?? [];
            const chute = g.chute_m ?? 0;
            return (
              <div key={g.material} className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-xs text-slate-900">{g.material}</span>
                  <span className="text-[11px] text-slate-500">
                    D365 :{' '}
                    {g.matiere ? (
                      <span className="font-mono font-semibold text-slate-700">
                        {g.matiere} · {g.epaisseur}
                      </span>
                    ) : (
                      <span className="font-semibold text-rose-700">libellé inconnu</span>
                    )}
                  </span>
                </div>
                <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-1">
                      Pièces (DEV)
                    </div>
                    {devs.length === 0 ? (
                      <div className="text-slate-400">Aucune</div>
                    ) : (
                      <table className="w-full font-mono">
                        <tbody className="divide-y divide-slate-100">
                          {devs.map(([dev, m]) => (
                            <tr key={dev}>
                              <td className="py-1 text-[#00478a] font-bold">DEV {dev}</td>
                              <td className="py-1 text-right font-bold text-slate-800">{fmtM(m)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                  <div>
                    <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-1">
                      Bobines
                    </div>
                    {coils.length === 0 && chute <= 0 ? (
                      <div className="text-slate-400">Aucune</div>
                    ) : (
                      <table className="w-full font-mono">
                        <tbody className="divide-y divide-slate-100">
                          {coils.map((c) => (
                            <tr key={c.article}>
                              <td className="py-1">
                                <span className="font-bold text-[#00478a]">{c.width_mm} mm</span>{' '}
                                <span className="text-[10px] text-slate-400">{c.article}</span>
                              </td>
                              <td className="py-1 text-right font-bold text-slate-800">{fmtM(c.quantity_m)}</td>
                            </tr>
                          ))}
                          {chute > 0 && (
                            <tr>
                              <td className="py-1 font-sans font-semibold text-amber-800">Chute</td>
                              <td className="py-1 text-right font-bold text-slate-800">{fmtM(chute)}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-slate-500">
            {hasErrors
              ? 'Corrigez les erreurs ci-dessus avant d’envoyer.'
              : 'Entrée = envoyer · Échap = revenir corriger'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg cursor-pointer"
            >
              Revenir corriger
            </button>
            <button
              ref={sendRef}
              type="button"
              onClick={onConfirm}
              disabled={hasErrors || isSending}
              className="px-3.5 py-1.5 bg-[#00478a] hover:bg-[#003566] disabled:opacity-40 text-white font-semibold rounded-lg text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isSending ? 'Envoi…' : 'Envoyer vers D365'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
