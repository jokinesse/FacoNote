import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, ListOrdered, Pencil, Trash2, X } from 'lucide-react';
import { MATERIAL_GROUPS, STANDARD_MATERIALS } from '../types';
import { DeleteButton } from './ui';

// Une ligne saisie, telle que le backend l'a validée (aucun calcul ici : affichage seulement).
export interface OrderLine {
  id: string;
  main: number; // développé (pièces) ou largeur de bobine (bobines), en mm
  mainLabel?: string; // texte à la place du nombre (ex. « Chute »)
  quantity: number;
  unitLength: number; // m
  totalLength?: number; // m, calculé par le backend (colonne masquée si absent)
  quantityNote?: string; // petit texte sous la quantité (ex. « 12 m auto »)
  material: string;
  time?: string;
  tone?: 'chute' | 'scrap'; // 'scrap' : ligne prise dans les chutes (fond orangé)
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
  // Actions sur plusieurs lignes cochées
  onBulkMaterial: (ids: string[], material: string) => void;
  onBulkDuplicate: (ids: string[]) => void;
  onBulkDelete: (ids: string[]) => void;
  defaultOpen?: boolean;
  emptyText?: string; // sans ligne : le panneau s'affiche avec ce texte (sinon il disparaît)
  headerActions?: React.ReactNode; // boutons en plus dans l'en-tête
  extraColumn?: { header: React.ReactNode; title?: string; render: (line: OrderLine) => React.ReactNode };
  onRowHover?: (id: string | null) => void;
  children?: React.ReactNode; // sous le tableau (ex. formulaire d'ajout)
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
  onBulkMaterial,
  onBulkDuplicate,
  onBulkDelete,
  defaultOpen = false,
  emptyText,
  headerActions,
  extraColumn,
  onRowHover,
  children,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMaterial, setBulkMaterial] = useState(activeMaterial);
  const lastClickedRef = useRef<string | null>(null);
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

  // Les lignes cochées qui ont disparu (supprimées, commande vidée) sortent de la sélection
  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(lines.map((l) => l.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [lines]);

  useEffect(() => {
    setBulkMaterial(activeMaterial);
  }, [activeMaterial]);

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

  // Cocher une ligne ; Maj + clic coche toutes les lignes entre la dernière cliquée et celle-ci
  const toggle = (id: string, shift: boolean) => {
    const from = lastClickedRef.current ? lines.findIndex((l) => l.id === lastClickedRef.current) : -1;
    const to = lines.findIndex((l) => l.id === id);
    setSelected((prev) => {
      const next = new Set(prev);
      const check = !prev.has(id);
      if (shift && from >= 0 && to >= 0) {
        const [a, b] = from < to ? [from, to] : [to, from];
        for (let i = a; i <= b; i++) {
          if (check) next.add(lines[i].id);
          else next.delete(lines[i].id);
        }
      } else if (check) next.add(id);
      else next.delete(id);
      return next;
    });
    lastClickedRef.current = id;
  };

  const allChecked = lines.length > 0 && selected.size === lines.length;
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(lines.map((l) => l.id)));
  // Dans l'ordre du tableau
  const selectedIds = () => lines.filter((l) => selected.has(l.id)).map((l) => l.id);

  if (lines.length === 0 && !emptyText) return null;
  const showTotal = lines.some((l) => l.totalLength !== undefined);
  const columns = 6 + (showTotal ? 1 : 0) + (extraColumn ? 1 : 0);

  return (
    <div className="faco-card bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden">
      <div
        className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 ${isOpen ? 'border-b border-slate-100' : ''}`}
      >
        <button
          type="button"
          onClick={() => setIsOpen((o) => !o)}
          aria-expanded={isOpen}
          className="text-sm font-bold text-[#282828] flex items-center gap-2 cursor-pointer"
        >
          <ListOrdered className="w-4 h-4 text-[#00478a]" />
          <span>
            {title} ({lines.length})
          </span>
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          <span className="text-xs font-semibold text-[#00478a]">{isOpen ? 'Fermer' : 'Ouvrir'}</span>
        </button>
        <div className={`${isOpen ? 'flex' : 'hidden'} flex-wrap items-center gap-3`}>
          <span className="hidden sm:inline text-[11px] text-slate-400">
            Clic sur une ligne = corriger · case = sélectionner (Maj + clic = plusieurs)
          </span>
          <button
            type="button"
            onClick={onApplyActiveMaterialToAll}
            className="px-2.5 py-1 text-[11px] font-medium text-[#00478a] bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer whitespace-nowrap"
          >
            Tout passer en « {activeMaterial} »
          </button>
          {headerActions}
        </div>
      </div>

      {isOpen && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-[#f0f7fc] border-b border-[#3ca7da]/30 text-xs">
          <strong className="text-[#00478a]">
            {selected.size} {selected.size > 1 ? 'lignes sélectionnées' : 'ligne sélectionnée'}
          </strong>
          <span className="text-slate-300">|</span>
          <select
            aria-label="Matière pour les lignes sélectionnées"
            value={bulkMaterial}
            onChange={(e) => setBulkMaterial(e.target.value)}
            className="bg-white border border-slate-300 text-[11px] font-medium text-slate-700 rounded-md px-2 py-1 focus:outline-none focus:border-[#00478a]"
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
          </select>
          <button
            type="button"
            onClick={() => onBulkMaterial(selectedIds(), bulkMaterial)}
            className="px-2.5 py-1 font-medium text-white bg-[#00478a] hover:bg-[#003566] rounded-md cursor-pointer"
          >
            Changer la matière
          </button>
          <button
            type="button"
            onClick={() => onBulkDuplicate(selectedIds())}
            className="px-2.5 py-1 font-medium text-[#00478a] bg-white border border-slate-300 hover:bg-slate-50 rounded-md flex items-center gap-1 cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" />
            Dupliquer
          </button>
          <button
            type="button"
            onClick={() => onBulkDelete(selectedIds())}
            className="px-2.5 py-1 font-medium text-rose-700 bg-white border border-rose-200 hover:bg-rose-50 rounded-md flex items-center gap-1 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Supprimer
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto px-2 py-1 text-slate-500 hover:text-slate-800 cursor-pointer"
          >
            Tout désélectionner
          </button>
        </div>
      )}

      <div
        className={`table-wrapper max-h-96 overflow-y-auto ${isOpen ? '' : 'hidden'}`}
        tabIndex={0}
        role="region"
        aria-label={title}
      >
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px] border-b border-slate-200 whitespace-nowrap">
            <tr>
              <th className="py-2 pl-3 pr-0 w-8">
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={(el) => {
                    if (el) el.indeterminate = selected.size > 0 && !allChecked;
                  }}
                  onChange={toggleAll}
                  aria-label="Tout sélectionner"
                  title="Tout sélectionner"
                  className="w-3.5 h-3.5 accent-[#00478a] cursor-pointer"
                />
              </th>
              <th className="py-2 px-3 w-28">{mainHeader}</th>
              <th className="py-2 px-3 w-24 text-right">Quantité</th>
              <th className="py-2 px-3 w-28 text-right">Longueur (m)</th>
              {showTotal && <th className="py-2 px-3 w-28 text-right">Total</th>}
              <th className="py-2 px-3 pl-6">Matière</th>
              {extraColumn && (
                <th className="py-2 px-3" title={extraColumn.title}>
                  {extraColumn.header}
                </th>
              )}
              <th className="py-2 px-3 w-24 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-mono">
            {lines.length === 0 && (
              <tr>
                <td colSpan={columns} className="py-6 px-4 text-center font-sans text-slate-400">
                  {emptyText}
                </td>
              </tr>
            )}
            {lines.map((line) => {
              const isEditing = line.id === editingId;
              if (isEditing) {
                return (
                  <React.Fragment key={line.id}>
                    <tr className="bg-[#f0f7fc]" onKeyDown={onKeys}>
                      <td className="py-1.5 pl-3 pr-0"></td>
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
                      {showTotal && <td className="py-1.5 px-3 text-right text-slate-400">…</td>}
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
                      {extraColumn && <td className="py-1.5 px-3"></td>}
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
                        <td colSpan={columns} className="py-1.5 px-3 font-sans text-[11px] text-rose-700">
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
                  onMouseEnter={onRowHover && (() => onRowHover(line.id))}
                  onMouseLeave={onRowHover && (() => onRowHover(null))}
                  className={`cursor-pointer transition-colors ${
                    line.id === savedId
                      ? 'bg-emerald-50'
                      : selected.has(line.id)
                      ? 'bg-[#f0f7fc] hover:bg-[#e3f0fa]'
                      : line.tone === 'scrap'
                      ? 'bg-amber-50/40 hover:bg-amber-50'
                      : 'hover:bg-slate-50'
                  }`}
                  title="Cliquer pour corriger cette ligne"
                >
                  <td
                    className="py-2 pl-3 pr-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(line.id, e.shiftKey);
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(line.id)}
                      onChange={() => {}}
                      aria-label="Sélectionner cette ligne"
                      className="w-3.5 h-3.5 accent-[#00478a] cursor-pointer"
                    />
                  </td>
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
                  <td className="py-2 px-3 text-right tabular-nums">
                    {line.quantity}
                    {line.quantityNote && (
                      <span className="block text-[9px] font-sans text-[#00478a] whitespace-nowrap">{line.quantityNote}</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">{line.unitLength}</td>
                  {showTotal && (
                    <td className="py-2 px-3 text-right tabular-nums font-bold text-[#282828] whitespace-nowrap">
                      {line.totalLength !== undefined ? `${line.totalLength.toFixed(2)} m` : ''}
                    </td>
                  )}
                  <td className="py-2 px-3 pl-6 font-sans text-[11px] text-slate-700 whitespace-nowrap">{line.material}</td>
                  {extraColumn && (
                    <td className="py-2 px-3 font-sans" onClick={(e) => e.stopPropagation()}>
                      {extraColumn.render(line)}
                    </td>
                  )}
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
      {isOpen && children}
    </div>
  );
};
