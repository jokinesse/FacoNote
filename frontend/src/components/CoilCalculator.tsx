import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { evaluateExpression } from '../utils/mathEvaluator';
import { getMaterialDensity } from '../utils/optimizer';
import { DEFAULT_BOBINE_BOUNDS } from '../utils/sheetLogic';

// Calculateur Bobine : saisies propres à l'onglet Bobine, séparées du tableau des pièces.
// On saisit la largeur de bobine consommée (0 = chute), la quantité et la longueur.
// Les totaux sont faits par matière × largeur. Les chutes sont notées par matière,
// à part, sans entrer dans les totaux.

interface CoilEntry {
  id: string;
  width: number; // largeur bobine en mm (0 = chute)
  quantity: number;
  unitLength: number; // m
  totalLength: number; // m
  material: string;
  isChute: boolean;
  time: string;
}

interface CoilCalculatorProps {
  activeMaterial: string;
  lengthUnit: 'm' | 'mm';
}

const round = (value: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
};

const fmt = (value: number, decimals = 2) =>
  value.toLocaleString('fr-BE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

export const CoilCalculator: React.FC<CoilCalculatorProps> = ({ activeMaterial, lengthUnit }) => {
  const [entries, setEntries] = useState<CoilEntry[]>([]);
  const [inputWidth, setInputWidth] = useState<string>('');
  const [inputQuantity, setInputQuantity] = useState<string>('1');
  const [inputLength, setInputLength] = useState<string>('');
  const [feedback, setFeedback] = useState<{ success: boolean; message: string } | null>(null);
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const widthRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const lengthRef = useRef<HTMLInputElement>(null);

  const focus = (ref: React.RefObject<HTMLInputElement | null>) => {
    ref.current?.focus();
    ref.current?.select();
  };

  const handleAdd = () => {
    const width = evaluateExpression(inputWidth.replace(',', '.'));
    if (inputWidth.trim() === '' || isNaN(width) || width < 0) {
      setFeedback({ success: false, message: 'Largeur de bobine invalide (en mm, ou 0 pour une chute).' });
      focus(widthRef);
      return;
    }

    const quantity = parseInt(inputQuantity, 10);
    if (isNaN(quantity) || quantity < 1) {
      setFeedback({ success: false, message: 'Quantité invalide (1 minimum).' });
      focus(qtyRef);
      return;
    }

    const rawLength = evaluateExpression(inputLength.replace(/,/g, '.'));
    if (inputLength.trim() === '' || isNaN(rawLength) || rawLength <= 0) {
      setFeedback({ success: false, message: `Longueur invalide (en ${lengthUnit}, ex : 3.5 ou 2*1.5+4).` });
      focus(lengthRef);
      return;
    }

    const unitLength = round(lengthUnit === 'mm' ? rawLength / 1000 : rawLength, 3);
    const totalLength = round(unitLength * quantity, 3);
    const isChute = width === 0;
    const roundedWidth = Math.round(width);

    const entry: CoilEntry = {
      id: `coil-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      width: roundedWidth,
      quantity,
      unitLength,
      totalLength,
      material: activeMaterial,
      isChute,
      time: new Date().toLocaleTimeString('fr-BE'),
    };
    setEntries((prev) => [entry, ...prev]);

    setFeedback({
      success: true,
      message: isChute
        ? `Chute notée : ${quantity} × ${fmt(unitLength, 3)} m = ${fmt(totalLength, 3)} m [${activeMaterial}]`
        : `Ajouté : bobine ${roundedWidth} mm · ${quantity} × ${fmt(unitLength, 3)} m = ${fmt(totalLength, 3)} m [${activeMaterial}]` +
          (DEFAULT_BOBINE_BOUNDS.includes(roundedWidth) ? '' : ' — largeur hors standard'),
    });

    // On garde la largeur pour enchaîner plusieurs longueurs sur la même bobine
    setInputQuantity('1');
    setInputLength('');
    focus(qtyRef);
  };

  const handleDelete = (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const handleDeleteGroup = (material: string, width: number | null) => {
    setEntries((prev) =>
      prev.filter((e) =>
        width === null
          ? !(e.isChute && e.material === material)
          : !(!e.isChute && e.material === material && e.width === width)
      )
    );
  };

  const handleUndo = () => {
    if (entries.length > 0) handleDelete(entries[0].id);
  };

  const handleClear = () => {
    if (!isConfirmingClear) {
      setIsConfirmingClear(true);
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      clearTimerRef.current = setTimeout(() => setIsConfirmingClear(false), 5000);
      return;
    }
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    setIsConfirmingClear(false);
    setEntries([]);
    setFeedback({ success: true, message: 'Calcul bobines remis à zéro.' });
    focus(widthRef);
  };

  // Regroupement matière → largeur
  const materialGroups = useMemo(() => {
    const byMaterial = new Map<string, Map<number, { quantity: number; length: number }>>();
    for (const e of entries) {
      if (e.isChute) continue;
      if (!byMaterial.has(e.material)) byMaterial.set(e.material, new Map());
      const widths = byMaterial.get(e.material)!;
      const row = widths.get(e.width) || { quantity: 0, length: 0 };
      row.quantity += e.quantity;
      row.length = round(row.length + e.totalLength, 3);
      widths.set(e.width, row);
    }

    return Array.from(byMaterial.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([material, widths]) => {
        const density = getMaterialDensity(material);
        const rows = Array.from(widths.entries())
          .sort(([a], [b]) => a - b)
          .map(([width, r]) => {
            const surface = round((width / 1000) * r.length, 2);
            return {
              width,
              quantity: r.quantity,
              length: r.length,
              surface,
              weight: round(surface * density, 1),
              isStandard: DEFAULT_BOBINE_BOUNDS.includes(width),
            };
          });
        return {
          material,
          density,
          rows,
          length: round(rows.reduce((s, r) => s + r.length, 0), 3),
          surface: round(rows.reduce((s, r) => s + r.surface, 0), 2),
          weight: round(rows.reduce((s, r) => s + r.weight, 0), 1),
        };
      });
  }, [entries]);

  // Chutes par matière (notées à part, hors totaux)
  const chuteGroups = useMemo(() => {
    const map = new Map<string, { quantity: number; length: number }>();
    for (const e of entries) {
      if (!e.isChute) continue;
      const row = map.get(e.material) || { quantity: 0, length: 0 };
      row.quantity += e.quantity;
      row.length = round(row.length + e.totalLength, 3);
      map.set(e.material, row);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([material, r]) => ({ material, ...r }));
  }, [entries]);

  const totals = useMemo(
    () => ({
      length: round(materialGroups.reduce((s, g) => s + g.length, 0), 3),
      surface: round(materialGroups.reduce((s, g) => s + g.surface, 0), 2),
      weight: round(materialGroups.reduce((s, g) => s + g.weight, 0), 1),
      chutes: round(chuteGroups.reduce((s, g) => s + g.length, 0), 3),
    }),
    [materialGroups, chuteGroups]
  );

  const handleExportCSV = () => {
    const lines = ['Matiere;Largeur_bobine_mm;Nombre;Metrage_m;Surface_m2;Poids_kg'];
    for (const g of materialGroups) {
      for (const r of g.rows) {
        lines.push(`${g.material};${r.width};${r.quantity};${r.length};${r.surface};${r.weight}`);
      }
    }
    for (const c of chuteGroups) {
      lines.push(`${c.material};CHUTE;${c.quantity};${c.length};;`);
    }
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `facozinc_bobines_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const inputClass =
    'faco-input w-full bg-[#f8fafc] border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono font-bold placeholder:text-slate-400 focus:outline-none focus:border-[#00478a] focus:bg-white';
  const labelClass = 'text-[11px] font-semibold text-slate-600 block mb-1';
  const hasData = entries.length > 0;

  return (
    <div className="space-y-4">
      {/* Saisie */}
      <div className="faco-card bg-white border border-slate-200 rounded-xl p-4 shadow-2xs space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-[#00478a]">Calcul bobines</span>
          <span className="text-[11px] text-slate-500">
            Matière en cours : <span className="font-semibold text-[#282828]">{activeMaterial}</span>
          </span>
          <div className="flex items-center gap-1 flex-wrap ml-auto">
            {DEFAULT_BOBINE_BOUNDS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => {
                  setInputWidth(String(w));
                  focus(qtyRef);
                }}
                className={`px-2 py-1 rounded-md text-xs font-mono font-bold border transition-colors cursor-pointer ${
                  inputWidth === String(w)
                    ? 'bg-[#00478a] text-white border-[#00478a]'
                    : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
                }`}
                title={`Bobine de ${w} mm`}
              >
                {w}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setInputWidth('0');
                focus(qtyRef);
              }}
              className={`px-2 py-1 rounded-md text-xs font-bold border transition-colors cursor-pointer ${
                inputWidth === '0'
                  ? 'bg-amber-500 text-white border-amber-500'
                  : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
              }`}
              title="Noter une chute (largeur 0)"
            >
              Chute
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div>
            <label htmlFor="coilWidth" className={labelClass}>
              Largeur bobine (mm)
            </label>
            <input
              id="coilWidth"
              ref={widthRef}
              type="text"
              inputMode="decimal"
              value={inputWidth}
              onChange={(e) => setInputWidth(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  focus(qtyRef);
                }
              }}
              placeholder="ex: 1000 (0 = chute)"
              className={`${inputClass} text-[#00478a]`}
            />
          </div>

          <div>
            <label htmlFor="coilQty" className={labelClass}>
              Quantité
            </label>
            <input
              id="coilQty"
              ref={qtyRef}
              type="number"
              min="1"
              value={inputQuantity}
              onChange={(e) => setInputQuantity(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  focus(lengthRef);
                }
              }}
              placeholder="ex: 4"
              className={`${inputClass} text-[#282828]`}
            />
          </div>

          <div>
            <label htmlFor="coilLength" className={labelClass}>
              Longueur ({lengthUnit})
            </label>
            <input
              id="coilLength"
              ref={lengthRef}
              type="text"
              inputMode="decimal"
              value={inputLength}
              onChange={(e) => setInputLength(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAdd();
                }
              }}
              placeholder={lengthUnit === 'mm' ? 'ex: 3500' : 'ex: 3.5'}
              className={`${inputClass} text-[#282828]`}
            />
          </div>

          <div>
            <button
              type="button"
              onClick={handleAdd}
              className="faco-btn w-full py-2 bg-[#e7511f] hover:bg-[#cf4315] text-white font-semibold rounded-lg text-sm flex items-center justify-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Ajouter</span>
            </button>
          </div>
        </div>

        {feedback && (
          <div
            className={`px-3 py-2 rounded-lg text-xs flex items-center justify-between gap-2 ${
              feedback.success
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-rose-50 text-rose-800 border border-rose-200'
            }`}
          >
            <span className="flex items-center gap-1.5">
              {feedback.success ? (
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>{feedback.message}</span>
            </span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="p-0.5 opacity-60 hover:opacity-100 cursor-pointer"
              aria-label="Fermer le message"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Totaux */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="faco-card bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Métrage bobines</span>
          <div className="mt-0.5 flex items-baseline gap-1">
            <span className="text-xl font-bold font-mono text-[#00478a] tabular-nums">{fmt(totals.length)}</span>
            <span className="text-xs text-slate-500">m</span>
          </div>
        </div>
        <div className="faco-card bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Surface</span>
          <div className="mt-0.5 flex items-baseline gap-1">
            <span className="text-xl font-bold font-mono text-[#282828] tabular-nums">{fmt(totals.surface)}</span>
            <span className="text-xs text-slate-500">m²</span>
          </div>
        </div>
        <div className="faco-card bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Poids estimé</span>
          <div className="mt-0.5 flex items-baseline gap-1">
            <span className="text-xl font-bold font-mono text-[#282828] tabular-nums">{fmt(totals.weight, 1)}</span>
            <span className="text-xs text-slate-500">kg</span>
          </div>
        </div>
        <div className="faco-card bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Chutes notées</span>
          <div className="mt-0.5 flex items-baseline gap-1">
            <span className="text-xl font-bold font-mono text-[#e7511f] tabular-nums">{fmt(totals.chutes)}</span>
            <span className="text-xs text-slate-500">m (hors totaux)</span>
          </div>
        </div>
      </div>

      {/* Tableau par matière × largeur */}
      <div className="faco-card bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
        <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-[#f8fafc]">
          <h2 className="text-xs font-bold text-[#00478a] uppercase tracking-wider">Bobines à sortir par matière</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleUndo}
              disabled={!hasData}
              className="px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-white hover:bg-slate-100 disabled:opacity-40 border border-slate-200 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Annuler</span>
            </button>
            <button
              type="button"
              onClick={handleExportCSV}
              disabled={!hasData}
              className="px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-white hover:bg-slate-100 disabled:opacity-40 border border-slate-200 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>CSV</span>
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={!hasData}
              className={`px-2.5 py-1.5 text-xs font-medium border rounded-lg transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-40 ${
                isConfirmingClear
                  ? 'bg-rose-600 text-white border-rose-600'
                  : 'text-rose-600 bg-white hover:bg-rose-50 border-slate-200'
              }`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{isConfirmingClear ? 'Confirmer la remise à zéro' : 'Tout effacer'}</span>
            </button>
          </div>
        </div>

        {materialGroups.length === 0 && chuteGroups.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-slate-500">
            Aucune bobine saisie. Choisis la matière, tape la largeur, la quantité et la longueur, puis Entrée.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-600 font-semibold border-b border-slate-200 uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-2.5 px-4">Largeur bobine</th>
                  <th className="py-2.5 px-4 text-right">Qté</th>
                  <th className="py-2.5 px-4 text-right">Métrage (m)</th>
                  <th className="py-2.5 px-4 text-right">Surface (m²)</th>
                  <th className="py-2.5 px-4 text-right">Poids (kg)</th>
                  <th className="py-2.5 px-4 w-10"></th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {materialGroups.map((g) => (
                  <React.Fragment key={g.material}>
                    <tr className="bg-[#00478a]/5 border-t border-slate-200">
                      <td className="py-2 px-4 font-sans font-bold text-[#00478a]" colSpan={2}>
                        {g.material}
                        <span className="ml-2 font-normal text-[10px] text-slate-500">{g.density} kg/m²</span>
                      </td>
                      <td className="py-2 px-4 text-right font-bold text-[#00478a] tabular-nums">{fmt(g.length, 3)}</td>
                      <td className="py-2 px-4 text-right font-bold tabular-nums">{fmt(g.surface)}</td>
                      <td className="py-2 px-4 text-right font-bold tabular-nums">{fmt(g.weight, 1)}</td>
                      <td></td>
                    </tr>
                    {g.rows.map((r) => (
                      <tr key={`${g.material}-${r.width}`} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="py-2 px-4 pl-8">
                          <span className="font-bold">{r.width} mm</span>
                          {!r.isStandard && (
                            <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-sans text-amber-800 bg-amber-100 border border-amber-200">
                              hors standard
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-4 text-right tabular-nums">{r.quantity}</td>
                        <td className="py-2 px-4 text-right tabular-nums font-bold">{fmt(r.length, 3)}</td>
                        <td className="py-2 px-4 text-right tabular-nums">{fmt(r.surface)}</td>
                        <td className="py-2 px-4 text-right tabular-nums">{fmt(r.weight, 1)}</td>
                        <td className="py-2 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => handleDeleteGroup(g.material, r.width)}
                            className="p-1 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                            title={`Supprimer toutes les saisies ${r.width} mm en ${g.material}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}

                {chuteGroups.length > 0 && (
                  <>
                    <tr className="bg-amber-50 border-t-2 border-amber-200">
                      <td className="py-2 px-4 font-sans font-bold text-amber-900" colSpan={6}>
                        Chutes notées (hors totaux)
                      </td>
                    </tr>
                    {chuteGroups.map((c) => (
                      <tr key={`chute-${c.material}`} className="bg-amber-50/40 text-amber-900 border-t border-amber-100">
                        <td className="py-2 px-4 pl-8 font-sans font-semibold">{c.material}</td>
                        <td className="py-2 px-4 text-right tabular-nums">{c.quantity}</td>
                        <td className="py-2 px-4 text-right tabular-nums font-bold text-[#e7511f]">{fmt(c.length, 3)}</td>
                        <td className="py-2 px-4 text-right">-</td>
                        <td className="py-2 px-4 text-right">-</td>
                        <td className="py-2 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => handleDeleteGroup(c.material, null)}
                            className="p-1 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                            title={`Supprimer les chutes ${c.material}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Historique des saisies */}
      {hasData && (
        <div className="faco-card bg-white border border-slate-200 rounded-xl p-4 space-y-2 shadow-2xs">
          <h3 className="text-xs font-bold text-[#00478a] uppercase tracking-wider">
            Historique des saisies bobines ({entries.length})
          </h3>
          <ul className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
            {entries.map((e) => (
              <li key={e.id} className="py-1.5 flex items-center justify-between gap-2 text-xs">
                <span className="font-mono">
                  <span className="text-slate-400 mr-2">{e.time}</span>
                  {e.isChute ? (
                    <span className="font-bold text-amber-700">Chute</span>
                  ) : (
                    <span className="font-bold text-[#00478a]">{e.width} mm</span>
                  )}{' '}
                  · {e.quantity} × {fmt(e.unitLength, 3)} m = <span className="font-bold">{fmt(e.totalLength, 3)} m</span>
                  <span className="ml-2 font-sans text-slate-500">[{e.material}]</span>
                </span>
                <button
                  type="button"
                  onClick={() => handleDelete(e.id)}
                  className="p-1 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer shrink-0"
                  title="Supprimer cette saisie"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
