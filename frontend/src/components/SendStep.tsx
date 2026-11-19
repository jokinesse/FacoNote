import React from 'react';
import { Send } from 'lucide-react';
import { D365_ORDER_RE } from '../utils/d365Bridge';
import { StepIntro } from './Header';

// Étape 3 : envoyer la commande vers l'extension D365, puis ce qu'il reste à faire dans D365.
interface SendStepProps {
  orderNumber: string;
  onOrderChange: (value: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  pieceLines: number;
  coilLines: number;
  coilCount: number; // comptes du backend
  chuteCount: number;
  isSending: boolean;
  onSend: () => void;
  onBack: () => void;
  cutSheets?: number; // feuilles de la découpe envoyées comme bobines (backend)
  children?: React.ReactNode; // message de retour de l'extension
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

export const SendStep: React.FC<SendStepProps> = ({
  orderNumber,
  onOrderChange,
  inputRef,
  pieceLines,
  coilLines,
  coilCount,
  chuteCount,
  isSending,
  onSend,
  onBack,
  cutSheets = 0,
  children,
}) => {
  const isEmpty = pieceLines === 0 && coilLines === 0;
  const invalid = orderNumber !== '' && !D365_ORDER_RE.test(orderNumber);
  return (
    <div className="space-y-4">
      <StepIntro
        step={3}
        title="Envoyer vers D365"
        hint="Indiquez le n° de la commande D365 et envoyez. Le pré-remplissage se fait ensuite dans D365."
      />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4 items-start">
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
          <div>
            <label htmlFor="send-order" className="block text-xs font-semibold text-slate-600 mb-1">
              N° de commande D365
            </label>
            <input
              id="send-order"
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
              placeholder="CC26000000000"
              maxLength={13}
              aria-invalid={invalid}
              className={`faco-input w-full max-w-xs bg-white border-2 rounded-lg px-3 py-2 text-lg font-mono font-bold focus:outline-none ${
                invalid ? 'border-rose-400' : 'border-slate-300 focus:border-[#00478a]'
              }`}
            />
            <p className={`text-xs mt-1 ${invalid ? 'text-rose-600' : 'text-slate-400'}`}>
              CC suivi de 11 chiffres
            </p>
          </div>

          <div className="text-sm text-slate-700">
            {isEmpty ? (
              <span className="text-slate-400">La commande est vide : revenez à l'étape 1 pour la saisir.</span>
            ) : (
              <>
                À envoyer : <strong>{plural(pieceLines, 'ligne pièce', 'lignes pièce')}</strong>
                {cutSheets > 0 && (
                  <>
                    {' '}et{' '}
                    <strong>les bobines de la découpe ({plural(cutSheets, 'feuille', 'feuilles')})</strong>
                  </>
                )}
                {coilCount + chuteCount > 0 && (
                  <>
                    {' '}et{' '}
                    <strong>
                      {[
                        coilCount > 0 ? plural(coilCount, 'bobine', 'bobines') : '',
                        chuteCount > 0 ? plural(chuteCount, 'chute', 'chutes') : '',
                      ]
                        .filter(Boolean)
                        .join(' + ')}
                    </strong>
                  </>
                )}
                .
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onSend}
              disabled={isSending || isEmpty}
              className="px-5 py-2.5 bg-[#00478a] hover:bg-[#003566] disabled:opacity-40 text-white font-semibold rounded-lg text-sm flex items-center gap-2 shadow-xs cursor-pointer"
            >
              <Send className="w-4 h-4" />
              <span>{isSending ? 'Envoi…' : 'Envoyer vers D365'}</span>
            </button>
            <button
              type="button"
              onClick={onBack}
              className="px-3 py-2 text-sm text-slate-600 hover:text-[#00478a] cursor-pointer"
            >
              ← Revenir à la saisie
            </button>
          </div>

          {children}
        </div>

        <div className="bg-[#f0f7fc] border border-[#b9dcf2] rounded-xl p-5 text-sm text-slate-700">
          <h2 className="font-bold text-[#00478a] mb-2">Ensuite, dans D365</h2>
          <ol className="list-decimal pl-5 space-y-1.5">
            <li>Ouvrez la commande, en mode Modifier.</li>
            <li>
              Dans le panneau Façonote, cliquez sur <strong>Pré-remplir</strong>, matière par matière.
            </li>
            <li>Pour les bobines : ouvrez la Nomenclature, puis <strong>Pré-remplir les bobines</strong>.</li>
            <li>Vérifiez, puis enregistrez dans D365.</li>
          </ol>
          <p className="text-xs text-slate-500 mt-3">
            Renvoyer une commande corrigée remplace la précédente dans l'extension.
          </p>
        </div>
      </div>
    </div>
  );
};
