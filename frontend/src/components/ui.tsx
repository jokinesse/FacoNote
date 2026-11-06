import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Camera, CheckCircle2, Layers, Trash2, X } from 'lucide-react';

// Éléments communs à tout le site, pour que les actions se comportent partout pareil :
// - confirmation de suppression (fenêtre Oui / Non) et message après suppression,
// - bouton poubelle,
// - badge « même dév / même largeur dans plusieurs matières ».

type NoticeKind = 'success' | 'error' | 'warning';

interface UiContextValue {
  confirmDelete: (what: string) => Promise<boolean>;
  notify: (message: string, kind?: NoticeKind) => void;
}

const UiContext = createContext<UiContextValue | null>(null);

export const UiProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [pending, setPending] = useState<{ what: string; resolve: (ok: boolean) => void } | null>(null);
  const [toast, setToast] = useState<{ id: number; kind: NoticeKind; message: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const confirmDelete = useCallback(
    (what: string) => new Promise<boolean>((resolve) => setPending({ what, resolve })),
    []
  );

  const notify = useCallback((message: string, kind: NoticeKind = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), kind, message });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const answer = useCallback(
    (ok: boolean) => {
      if (!pending) return;
      pending.resolve(ok);
      setPending(null);
    },
    [pending]
  );

  // Tant que la fenêtre est ouverte, elle capte le clavier (sinon la calculette
  // d'atelier ou d'autres raccourcis réagiraient aussi). Entrée = Oui, Échap = Non.
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') return;
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        const focused = document.activeElement as HTMLElement | null;
        answer(focused?.dataset.confirm !== 'no');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        answer(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pending, answer]);

  return (
    <UiContext.Provider value={{ confirmDelete, notify }}>
      {children}

      {pending && (
        <div
          className="fixed inset-0 z-[300] bg-slate-900/40 flex items-center justify-center p-4"
          onClick={() => answer(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-sm p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-full bg-rose-50 text-rose-600 shrink-0">
                <Trash2 className="w-4 h-4" />
              </div>
              <div className="space-y-1">
                <h2 id="confirm-title" className="text-sm font-bold text-[#282828]">
                  Confirmer la suppression
                </h2>
                <p className="text-xs text-slate-600">
                  Supprimer <strong className="text-[#282828]">{pending.what}</strong> ?
                </p>
                <p className="text-[11px] text-slate-400">Cette action est irréversible.</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-confirm="no"
                onClick={() => answer(false)}
                className={BTN_SECONDARY}
              >
                Non, annuler
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => answer(true)}
                className="px-3 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Oui, supprimer</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="no-print fixed bottom-4 left-1/2 -translate-x-1/2 z-[250] w-[calc(100%-2rem)] max-w-md">
          <Notice key={toast.id} kind={toast.kind} message={toast.message} onClose={() => setToast(null)} shadow />
        </div>
      )}
    </UiContext.Provider>
  );
};

const useUi = (): UiContextValue => {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error('UiProvider manquant');
  return ctx;
};

export const useNotify = () => useUi().notify;

// Toutes les suppressions du site passent par ici : même question, même message après.
export const useDeleteAction = () => {
  const { confirmDelete, notify } = useUi();
  return useCallback(
    async (what: string, action: () => void) => {
      if (!(await confirmDelete(what))) return false;
      action();
      notify(`Supprimé : ${what}`);
      return true;
    },
    [confirmDelete, notify]
  );
};

// Message (succès, erreur, alerte), même rendu partout.
export const Notice: React.FC<{
  kind: NoticeKind;
  message: React.ReactNode;
  onClose?: () => void;
  shadow?: boolean;
}> = ({ kind, message, onClose, shadow }) => {
  const style =
    kind === 'success'
      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
      : kind === 'warning'
      ? 'bg-amber-50 border-amber-300 text-amber-900'
      : 'bg-rose-50 border-rose-200 text-rose-800';
  const Icon = kind === 'success' ? CheckCircle2 : AlertTriangle;
  return (
    <div
      role={kind === 'success' ? 'status' : 'alert'}
      className={`px-3 py-2 rounded-lg border text-xs flex items-center justify-between gap-2 ${style} ${
        shadow ? 'shadow-lg' : ''
      }`}
    >
      <span className="flex items-center gap-2">
        <Icon className="w-4 h-4 shrink-0" />
        <span>{message}</span>
      </span>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="p-0.5 opacity-60 hover:opacity-100 cursor-pointer"
          aria-label="Fermer le message"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};

// Bouton poubelle des lignes de tableau et d'historique.
export const DeleteButton: React.FC<{ title: string; onClick: () => void }> = ({ title, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer"
    title={title}
    aria-label={title}
  >
    <Trash2 className="w-3.5 h-3.5" />
  </button>
);

// Alerte « même dév / même largeur présente dans plusieurs matières ».
export const SharedBadge: React.FC<{ label: string; materials: string[] }> = ({ label, materials }) => (
  <span
    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold font-sans bg-amber-100 text-amber-900 border border-amber-300"
    title={materials.length > 0 ? `Aussi en : ${materials.join(', ')}` : 'Présent dans plusieurs matières'}
  >
    <Layers className="w-3 h-3 text-amber-600 shrink-0" />
    <span>{label}</span>
  </span>
);

// Bouton d'analyse IA (croquis, photo, PDF) : même libellé, même style dans le Calculateur et l'Optimiseur.
// Placé en dernier dans la barre du haut de la première carte de chaque onglet.
export const AiScanButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="px-3 py-1.5 bg-[#f8fafc] hover:bg-slate-100 text-[#00478a] font-semibold rounded-lg text-xs flex items-center gap-1.5 border border-slate-200 transition-colors cursor-pointer"
    title="Scanner un croquis, une photo ou un plan PDF avec l'IA"
  >
    <Camera className="w-3.5 h-3.5 text-[#3ca7da]" />
    <span>Scanner IA</span>
  </button>
);

// Classes communes
export const BTN_SECONDARY =
  'px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-white hover:bg-slate-100 disabled:opacity-40 border border-slate-200 rounded-lg transition-colors flex items-center gap-1 cursor-pointer';
export const BTN_DANGER =
  'px-2.5 py-1.5 text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 disabled:opacity-40 border border-rose-200 rounded-lg transition-colors flex items-center gap-1 cursor-pointer';
// Ligne de tableau dont le dév / la largeur existe dans plusieurs matières
export const ROW_SHARED = 'bg-amber-50/30 hover:bg-amber-50/60';
export const CELL_SHARED_EDGE = 'shadow-[inset_4px_0_0_#fbbf24]';

// Boutons de filtre par matière précise (ex : Zinc Naturel 0.7 et Zinc ATZ 0.7 séparés).
// Les totaux affichés viennent du backend.
export interface MaterialFilterItem {
  material: string;
  family: string;
  lengthM: number;
  count: number;
}

export const MaterialFilterButtons: React.FC<{
  items: MaterialFilterItem[];
  selected: string;
  onSelect: (material: string) => void;
}> = ({ items, selected, onSelect }) => (
  <>
    {items.map((m) => {
      const isActive = selected === m.material;
      const isAlu = m.family === 'ALU';
      const isRouge = /rouge/i.test(m.material);
      const active = isAlu
        ? 'bg-[#00478a] text-white border-[#00478a]'
        : isRouge
        ? 'bg-rose-600 text-white border-rose-600'
        : 'bg-slate-700 text-white border-slate-700';
      const idle = isAlu
        ? 'bg-white text-[#00478a] border-sky-200 hover:bg-sky-50'
        : isRouge
        ? 'bg-white text-rose-700 border-rose-200 hover:bg-rose-50'
        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100';
      return (
        <button
          key={m.material}
          type="button"
          onClick={() => onSelect(isActive ? 'ALL' : m.material)}
          className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-all cursor-pointer ${
            isActive ? `${active} shadow-2xs` : idle
          }`}
          title={`Afficher seulement ${m.material}`}
        >
          {m.material} ({m.lengthM.toFixed(1)}m · {m.count} pcs)
        </button>
      );
    })}
  </>
);
