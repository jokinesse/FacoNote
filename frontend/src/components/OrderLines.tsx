import React, { useEffect, useRef, useState } from 'react';
import { Check, ListOrdered, Pencil, X } from 'lucide-react';
import { MATERIAL_GROUPS, STANDARD_MATERIALS } from '../types';
import { DeleteButton } from './ui';

// Une ligne saisie, telle que le backend l'a validée (aucun calcul ici : affichage seulement).
export interface OrderLine {
  id: string;
  main: number; // développé (pièces) ou largeur de bobine (bobines), en mm
  mainLabel?: string; // texte à la place du nombre (ex. « Chute »)
  quantity: number;
  unitLength: number; // m
  totalLength: number; // m, calculé par le backend
  material: string;
  time?: string;
  tone?: 'chute';
}

export interface OrderLineDraft {
  main: string;
  quantity: string;
  unitLength: string;
  material: string;
}

interface OrderLinesProps {
  title?: string;
  mainHeader: string; // « Dév (mm) » ou « Largeur (mm) »
  mainHint?: string;
  lines: OrderLine[];
  activeMaterial: string;
  // Recalcule la ligne par le backend et la remplace à la même place. Renvoie un message d'erreur ou null.
  onSave: (id: string, draft: OrderLineDraft) => Promise<string | null>;
  onDelete: (id: string) => void;
  onApplyActiveMaterialToAll: () => void;
}

const inputCls =
  'faco-input w-full bg-white border border-slate-300 rounded-md px-2 py-1 text-xs font-mono font-bold text-[#282828] focus:outline-none focus:border-[#00478a]';

// Tableau des lignes de la commande : chaque ligne se corrige sur place (Entrée = enregistrer, Échap = annuler).
export const OrderLines: React.FC<OrderLinesProps> = ({
  title = 'Lignes de la commande',
  mainHeader,
  mainHint,
  lines,
  activeMaterial,
  onSave,
  onDelete,
  onApplyActiveMaterialToAll,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<OrderLineDraft>({ main: '', quantity: '', unitLength: '', material: '' });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) firstFieldRef.current?.select();
  }, [editingId]);

  // La ligne en cours de correction a disparu (supprimée, commande vidée) : on sort du mode édition
  useEffect(() => {
    if (editingId && !lines.some((l) => l.id === editingId)) setEditingId(null);
  }, [lines, editingId]);

  useEffect(() => {
    if (!savedId) return;
    const t = window.setTimeout(() => setSavedId(null), 1500);
    return () => window.clearTimeout(t);
  }, [savedId]);

  const startEdit = (line: OrderLine) => {
    setEditingId(line.id);
    setError(null);
    setDraft({
      main: line.mainLabel ? '0' : String(line.main),
      quantity: String(line.quantity),
      unitLength: String(line.unitLength),
      material: line.material,
    });
  };

  const cancel = () => {
    setEditingId(null);
    setError(null);
  };

  const save = async () => {
    if (!editingId || saving) return;
    setSaving(true);
    const id = editingId;
    const message = await onSave(id, draft);
    setSaving(false);
    if (message) {
      setError(message);
      return;
    }
    setEditingId(null);
    setError(null);
    setSavedId(id);
  };

  const onKeys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  };

  if (lines.length === 0) return null;

  return (
    <div className="faco-card bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100">
        <h3 className="text-sm font-bold text-[#282828] flex items-center gap-2">
          <ListOrdered className="w-4 h-4 text-[#00478a]" />
          <span>
            {title} ({lines.length})
          </span>
        </h3>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline text-[11px] text-slate-400">
            Cliquez sur une ligne pour la corriger · Entrée = enregistrer · Échap = annuler
          </span>
          <button
            type="button"
            onClick={onApplyActiveMaterialToAll}
            className="px-2.5 py-1 text-[11px] font-medium text-[#00478a] bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer whitespace-nowrap"
          >
            Tout passer en « {activeMaterial} »
          </button>
        </div>
      </div>

      <div className="table-wrapper max-h-96 overflow-y-auto" tabIndex={0} role="region" aria-label={title}>
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px] border-b border-slate-200 whitespace-nowrap">
            <tr>
              <th className="py-2 px-3 w-28">{mainHeader}</th>
              <th className="py-2 px-3 w-24 text-right">Quantité</th>
              <th className="py-2 px-3 w-28 text-right">Longueur (m)</th>
              <th className="py-2 px-3 w-28 text-right">Total</th>
              <th className="py-2 px-3 pl-6">Matière</th>
              <th className="py-2 px-3 w-24 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-mono">
            {lines.map((line) => {
              const isEditing = line.id === editingId;
              if (isEditing) {
                return (
                  <React.Fragment key={line.id}>
                    <tr className="bg-[#f0f7fc]" onKeyDown={onKeys}>
                      <td className="py-1.5 px-3">
                        <input
                          ref={firstFieldRef}
                          aria-label={mainHeader}
                          title={mainHint}
                          value={draft.main}
                          onChange={(e) => setDraft({ ...draft, main: e.target.value })}
                          className={inputCls}
                          inputMode="decimal"
                        />
                      </td>
                      <td className="py-1.5 px-3">
                        <input
                          aria-label="Quantité"
                          value={draft.quantity}
                          onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
                          className={`${inputCls} text-right`}
                          inputMode="numeric"
                        />
                      </td>
                      <td className="py-1.5 px-3">
                        <input
                          aria-label="Longueur (m)"
                          value={draft.unitLength}
                          onChange={(e) => setDraft({ ...draft, unitLength: e.target.value })}
                          className={`${inputCls} text-right`}
                          inputMode="decimal"
                        />
                      </td>
                      <td className="py-1.5 px-3 text-right text-slate-400">…</td>
                      <td className="py-1.5 px-3">
                        <select
                          aria-label="Matière"
                          value={draft.material}
                          onChange={(e) => setDraft({ ...draft, material: e.target.value })}
                          className="bg-white border border-slate-300 text-[11px] font-sans font-medium text-slate-700 rounded-md px-2 py-1 focus:outline-none focus:border-[#00478a]"
                        >
                          {MATERIAL_GROUPS.map((grp) => (
                            <optgroup key={grp.group} label={grp.group}>
                              {grp.items.map((m) => (
                                <option key={m.value} value={m.value}>
                                  {m.value}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                          {!STANDARD_MATERIALS.includes(draft.material) && (
                            <option value={draft.material}>{draft.material}</option>
                          )}
                        </select>
                      </td>
                      <td className="py-1.5 px-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => void save()}
                            disabled={saving}
                            title="Enregistrer (Entrée)"
                            aria-label="Enregistrer la ligne"
                            className="p-1.5 rounded-md bg-[#00478a] text-white hover:bg-[#003a72] disabled:opacity-50 cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={cancel}
                            title="Annuler (Échap)"
                            aria-label="Annuler la correction"
                            className="p-1.5 rounded-md border border-slate-300 text-slate-600 hover:bg-slate-100 cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {error && (
                      <tr className="bg-rose-50">
                        <td colSpan={6} className="py-1.5 px-3 font-sans text-[11px] text-rose-700">
                          {error}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              }

              return (
                <tr
                  key={line.id}
                  onClick={() => startEdit(line)}
                  className={`cursor-pointer transition-colors ${
                    line.id === savedId ? 'bg-emerald-50' : 'hover:bg-slate-50'
                  }`}
                  title="Cliquer pour corriger cette ligne"
                >
                  <td className="py-2 px-3 font-bold whitespace-nowrap">
                    {line.mainLabel ? (
                      <span className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800 font-sans text-[11px]">
                        {line.mainLabel}
                      </span>
                    ) : (
                      <span className="text-[#00478a]">
                        {line.main} <span className="text-[10px] font-normal text-slate-400">mm</span>
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">{line.quantity}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{line.unitLength}</td>
                  <td className="py-2 px-3 text-right tabular-nums font-bold text-[#282828] whitespace-nowrap">
                    {line.totalLength.toFixed(2)} m
                  </td>
                  <td className="py-2 px-3 pl-6 font-sans text-[11px] text-slate-700 whitespace-nowrap">{line.material}</td>
                  <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => startEdit(line)}
                        title="Corriger cette ligne"
                        aria-label="Corriger cette ligne"
                        className="p-1.5 rounded-md text-slate-500 hover:text-[#00478a] hover:bg-slate-100 cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <DeleteButton title="Supprimer cette ligne" onClick={() => onDelete(line.id)} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
