import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Calculator,
  CheckCircle2,
  Download,
  Filter,
  Layers,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { MATERIAL_GROUPS, STANDARD_MATERIALS } from '../types';
import { DEFAULT_BOBINE_BOUNDS } from '../utils/sheetLogic';
import { ApiError, CoilSummaryResponse, MetalFamily, optimizerApi } from '../api';

// Calculateur Bobine : saisies propres à l'onglet Bobine, séparées du tableau des pièces.
// On saisit la largeur de bobine consommée (0 = chute), la quantité et la longueur.
// Tous les calculs sont faits par le backend :
// - /optimizer/coil-encode valide et calcule chaque saisie,
// - /optimizer/coil-summary calcule le tableau (largeur × matière, totaux, chutes par matière).
// Ce composant garde seulement la liste des saisies et gère l'affichage.

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
  onMaterialChange: (material: string) => void;
}

// Nuances disponibles par largeur standard (affiché sur les lignes vides)
const WIDTH_HINTS: Record<number, string> = {
  600: 'Zinc : Naturel · ATZ · Quartz',
  650: 'Alu 0.7 : RAL 7016 · 9005 · 9010 · 7039',
  670: 'Zinc : Naturel · ATZ · Quartz · Pigmento Rouge',
  750: 'Zinc : Naturel · ATZ · Quartz · Pigmento Rouge',
  1000: 'Zinc & Alu : toutes nuances',
  1100: 'Zinc : Naturel · ATZ · Quartz · Pigmento Rouge',
};

// Badge matière, même rendu que dans le calculateur des pièces
const MaterialBadge: React.FC<{ material: string; family: MetalFamily }> = ({ material, family }) => {
  if (family === 'ALU') {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-sans font-medium border bg-[#00478a]/10 text-[#00478a] border-[#00478a]/25 shadow-2xs"
        title={material}
      >
        <span className="px-1.5 py-0.2 rounded text-[9px] font-black bg-[#00478a] text-white tracking-wider">ALU</span>
        <span className="truncate max-w-[150px] font-bold">{material.replace(/^Alu\s*/i, '')}</span>
      </span>
    );
  }
  if (family === 'ZINC') {
    const isRouge = /rouge/i.test(material);
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-sans font-medium border shadow-2xs ${
          isRouge ? 'bg-rose-50 text-rose-800 border-rose-200' : 'bg-slate-100 text-slate-800 border-slate-300'
        }`}
        title={material}
      >
        <span
          className={`px-1.5 py-0.2 rounded text-[9px] font-black text-white tracking-wider ${
            isRouge ? 'bg-rose-600' : 'bg-slate-700'
          }`}
        >
          ZINC
        </span>
        <span className="truncate max-w-[150px] font-bold">{material.replace(/^Zinc\s*/i, '')}</span>
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-sans font-medium border bg-slate-100 text-slate-700 border-slate-200"
      title={material}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-[#3ca7da] shrink-0"></span>
      <span className="truncate max-w-[150px] font-semibold">{material}</span>
    </span>
  );
};

const fmt = (value: number, decimals = 2) =>
  value.toLocaleString('fr-BE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

export const CoilCalculator: React.FC<CoilCalculatorProps> = ({ activeMaterial, lengthUnit, onMaterialChange }) => {
  const [entries, setEntries] = useState<CoilEntry[]>([]);
  const [inputWidth, setInputWidth] = useState<string>('');
  const [inputQuantity, setInputQuantity] = useState<string>('1');
  const [inputLength, setInputLength] = useState<string>('');
  const [feedback, setFeedback] = useState<{ success: boolean; message: string } | null>(null);
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const [materialFilter, setMaterialFilter] = useState<'ALL' | 'ALU' | 'ZINC'>('ALL');
  const [hideEmpty, setHideEmpty] = useState(false);
  const [summary, setSummary] = useState<CoilSummaryResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const summaryRequestRef = useRef(0);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const widthRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const lengthRef = useRef<HTMLInputElement>(null);

  const addRef = useRef<HTMLButtonElement>(null);
  const fields = [widthRef, qtyRef, lengthRef];

  const focus = (ref: React.RefObject<HTMLInputElement | null>) => {
    ref.current?.focus();
    ref.current?.select();
  };

  // Navigation clavier entre les 3 cases :
  // Entrée = case suivante, et sur Longueur : ajout direct. Maj+Entrée = case précédente.
  // Flèches gauche/droite = case voisine quand le curseur est au bord du texte.
  // Le bouton Ajouter ne s'atteint qu'avec Tab ou la souris.
  const handleFieldKeys = (index: number) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const len = input.value.length;
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
    const atEnd = input.selectionStart === len && input.selectionEnd === len;

    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        if (index > 0) focus(fields[index - 1]);
      } else if (index < fields.length - 1) {
        focus(fields[index + 1]);
      } else {
        handleAdd();
      }
    } else if (e.key === 'ArrowRight' && atEnd && index < fields.length - 1) {
      e.preventDefault();
      focus(fields[index + 1]);
    } else if (e.key === 'ArrowLeft' && atStart && index > 0) {
      e.preventDefault();
      focus(fields[index - 1]);
    }
  };

  const handleAdd = async () => {
    if (isSubmitting) return;
    if (inputWidth.trim() === '') {
      setFeedback({ success: false, message: 'Largeur de bobine manquante (en mm, ou 0 pour une chute).' });
      focus(widthRef);
      return;
    }
    if (inputLength.trim() === '') {
      setFeedback({ success: false, message: `Longueur manquante (en ${lengthUnit}, ex : 3.5 ou 2*1.5+4).` });
      focus(lengthRef);
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await optimizerApi.coilEncode({
        width: inputWidth.trim(),
        quantity: parseInt(inputQuantity, 10) || 0,
        length: inputLength.trim(),
        length_unit: lengthUnit,
        material: activeMaterial,
      });
      const d = res.data;
      const entry: CoilEntry = {
        id: `coil-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        width: d.width,
        quantity: d.quantity,
        unitLength: d.unit_length_m,
        totalLength: d.total_length_m,
        material: d.material,
        isChute: d.is_chute,
        time: new Date().toLocaleTimeString('fr-BE'),
      };
      setEntries((prev) => [entry, ...prev]);

      setFeedback({
        success: true,
        message: d.is_chute
          ? `Chute notée (${res.executionTimeMs}ms) : ${d.quantity} × ${fmt(d.unit_length_m, 3)} m = ${fmt(d.total_length_m, 3)} m [${d.material}]`
          : `Ajouté (${res.executionTimeMs}ms) : bobine ${d.width} mm · ${d.quantity} × ${fmt(d.unit_length_m, 3)} m = ${fmt(d.total_length_m, 3)} m [${d.material}]` +
            (d.is_standard ? '' : ' — largeur hors standard'),
      });

      // Retour sur la case Largeur, vidée comme dans le calculateur des pièces
      setInputWidth('');
      setInputQuantity('1');
      setInputLength('');
      focus(widthRef);
    } catch (err) {
      const message = err instanceof ApiError || err instanceof Error ? err.message : 'Erreur lors du calcul de la saisie.';
      setFeedback({ success: false, message });
      // Remet le curseur sur la case en cause
      if (/largeur|width/i.test(message)) focus(widthRef);
      else if (/quantit/i.test(message)) focus(qtyRef);
      else focus(lengthRef);
    } finally {
      setIsSubmitting(false);
    }
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

  // Matière d'une ligne d'historique (correction en cas d'erreur).
  // Comme pour les pièces, la matière choisie devient la matière en cours.
  const handleUpdateEntryMaterial = (id: string, material: string) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, material } : e)));
    onMaterialChange(material);
  };

  const handleApplyActiveMaterialToAll = () => {
    setEntries((prev) => prev.map((e) => ({ ...e, material: activeMaterial })));
    setFeedback({ success: true, message: `Toutes les saisies bobines passent en : ${activeMaterial}` });
  };

  // Tableau recalculé par le backend à chaque changement des saisies.
  // On ignore les réponses d'une requête dépassée par une plus récente.
  useEffect(() => {
    const requestId = ++summaryRequestRef.current;
    const payload = {
      entries: [...entries].reverse().map((e) => ({
        id: e.id,
        width: e.width,
        quantity: e.quantity,
        unit_length_m: e.unitLength,
        material: e.material,
      })),
    };
    optimizerApi
      .coilSummary(payload)
      .then((res) => {
        if (requestId === summaryRequestRef.current) setSummary(res.data);
      })
      .catch((err) => {
        if (requestId !== summaryRequestRef.current) return;
        const message = err instanceof Error ? err.message : 'erreur inconnue';
        setFeedback({ success: false, message: `Calcul du tableau bobines impossible : ${message}` });
      });
  }, [entries]);

  const rows = summary?.rows ?? [];
  const chutes = summary?.chutes ?? [];
  const totals = summary?.totals ?? {
    quantity: 0, length_m: 0, surface_m2: 0, weight_kg: 0, chutes_quantity: 0, chutes_length_m: 0,
  };
  const aluSummary = summary?.alu ?? { quantity: 0, length_m: 0, weight_kg: 0 };
  const zincSummary = summary?.zinc ?? { quantity: 0, length_m: 0, weight_kg: 0 };

  // Filtres d'affichage (pas de calcul)
  const filteredRows = rows.filter((r) => {
    if (r.is_empty) return !hideEmpty && materialFilter === 'ALL';
    return materialFilter === 'ALL' || r.family === materialFilter;
  });
  // Nombre de lignes affichées par largeur, pour fusionner la case Largeur
  const visibleRowsPerWidth = new Map<number, number>();
  for (const r of filteredRows) {
    visibleRowsPerWidth.set(r.width, (visibleRowsPerWidth.get(r.width) || 0) + 1);
  }
  const filteredChutes = chutes.filter((c) => materialFilter === 'ALL' || c.family === materialFilter);

  const handleExportCSV = () => {
    const lines = ['Largeur_bobine_mm;Matiere;Nombre;Metrage_m;Surface_m2;Poids_kg'];
    for (const r of rows) {
      if (!r.is_empty) lines.push(`${r.width};${r.material};${r.quantity};${r.length_m};${r.surface_m2};${r.weight_kg}`);
    }
    for (const c of chutes) {
      lines.push(`CHUTE;${c.material};${c.quantity};${c.length_m};;`);
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
              onKeyDown={handleFieldKeys(0)}
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
              type="text"
              inputMode="numeric"
              value={inputQuantity}
              onChange={(e) => setInputQuantity(e.target.value)}
              onKeyDown={handleFieldKeys(1)}
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
              onKeyDown={handleFieldKeys(2)}
              placeholder={lengthUnit === 'mm' ? 'ex: 3500' : 'ex: 3.5'}
              className={`${inputClass} text-[#282828]`}
            />
          </div>

          <div>
            <button
              ref={addRef}
              type="button"
              disabled={isSubmitting}
              onClick={handleAdd}
              onKeyDown={(e) => {
                // Entrée = Ajouter. On bloque la propagation, sinon la calculette d'atelier
                // (raccourcis clavier globaux) intercepte Entrée et annule le clic.
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  e.stopPropagation();
                  handleAdd();
                } else if ((e.key === 'Enter' && e.shiftKey) || e.key === 'ArrowLeft') {
                  e.preventDefault();
                  e.stopPropagation();
                  focus(lengthRef);
                }
              }}
              className="faco-btn w-full py-2 bg-[#e7511f] hover:bg-[#cf4315] focus:bg-[#cf4315] text-white font-semibold rounded-lg text-sm flex items-center justify-center gap-1.5 transition-colors shadow-2xs cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#00478a] focus:ring-offset-2"
            >
              <Plus className="w-4 h-4" />
              <span>Ajouter</span>
            </button>
          </div>
        </div>

        <p className="text-[10px] text-slate-400">
          Entrée : case suivante · Entrée sur Longueur : ajouter · Maj+Entrée ou ← : revenir en arrière · → : avancer
        </p>

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
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Métrage Total</span>
          <div className="mt-0.5 flex items-baseline gap-1">
            <span className="text-xl font-bold font-mono text-[#00478a] tabular-nums">{totals.length_m.toFixed(2)}</span>
            <span className="text-xs text-slate-500">m</span>
          </div>
        </div>
        <div className="faco-card bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Feuilles</span>
          <div className="mt-0.5 flex items-baseline gap-1">
            <span className="text-xl font-bold font-mono text-[#282828] tabular-nums">{totals.quantity}</span>
            <span className="text-xs text-slate-500">pcs</span>
          </div>
        </div>
        <div className="faco-card bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Surface & Poids</span>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="text-xl font-bold font-mono text-[#282828] tabular-nums">
              {totals.surface_m2.toFixed(2)} <span className="text-xs font-normal text-slate-500">m²</span>
            </span>
            <span className="text-xs font-mono font-semibold text-[#3ca7da]">· {totals.weight_kg.toFixed(1)} kg</span>
          </div>
        </div>
        <div className="faco-card bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Chutes (hors totaux)</span>
          <div className="mt-0.5 flex items-baseline gap-1">
            <span className="text-xl font-bold font-mono text-[#e7511f] tabular-nums">{totals.chutes_length_m.toFixed(2)}</span>
            <span className="text-xs text-slate-500">m</span>
          </div>
        </div>
      </div>

      {/* Tableau des bobines */}
      <div className="faco-card bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
        <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-[#f8fafc]">
          <div className="flex items-center gap-2">
            <Calculator className="w-4 h-4 text-[#00478a]" />
            <h2 className="text-xs font-bold text-[#00478a] uppercase tracking-wider">Tableau des Bobines & Feuilles Sorties</h2>
          </div>
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

        {/* Filtre matière */}
        {totals.quantity + totals.chutes_quantity > 0 && (
          <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
              <Filter className="w-3 h-3 text-slate-400" />
              <span>Filtrer :</span>
            </span>
            <button
              type="button"
              onClick={() => setMaterialFilter('ALL')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-all cursor-pointer ${
                materialFilter === 'ALL'
                  ? 'bg-[#00478a] text-white border-[#00478a] shadow-2xs'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              Toutes ({totals.length_m.toFixed(1)}m · {totals.quantity} pcs)
            </button>
            {aluSummary.quantity > 0 && (
              <button
                type="button"
                onClick={() => setMaterialFilter('ALU')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-all cursor-pointer flex items-center gap-1.5 ${
                  materialFilter === 'ALU'
                    ? 'bg-[#00478a] text-white border-[#00478a] shadow-2xs'
                    : 'bg-sky-50 text-[#00478a] border-sky-200 hover:bg-sky-100'
                }`}
              >
                <span className="px-1.5 py-0.2 bg-[#00478a] text-white rounded text-[9px] font-black">ALU</span>
                <span>
                  {aluSummary.length_m.toFixed(1)}m ({aluSummary.quantity} pcs · {aluSummary.weight_kg.toFixed(1)} kg)
                </span>
              </button>
            )}
            {zincSummary.quantity > 0 && (
              <button
                type="button"
                onClick={() => setMaterialFilter('ZINC')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-all cursor-pointer flex items-center gap-1.5 ${
                  materialFilter === 'ZINC'
                    ? 'bg-slate-700 text-white border-slate-700 shadow-2xs'
                    : 'bg-slate-100 text-slate-800 border-slate-300 hover:bg-slate-200'
                }`}
              >
                <span className="px-1.5 py-0.2 bg-slate-700 text-white rounded text-[9px] font-black">ZINC</span>
                <span>
                  {zincSummary.length_m.toFixed(1)}m ({zincSummary.quantity} pcs · {zincSummary.weight_kg.toFixed(1)} kg)
                </span>
              </button>
            )}
          </div>
        )}

        <div className="px-4 py-1.5 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <span className="text-[11px]">Grille des largeurs de bobines standard</span>
          <label className="flex items-center gap-1.5 cursor-pointer text-[11px] font-medium text-slate-600 hover:text-slate-900 select-none">
            <input
              type="checkbox"
              checked={hideEmpty}
              onChange={(e) => setHideEmpty(e.target.checked)}
              className="rounded border-slate-300 text-[#00478a] focus:ring-0 cursor-pointer"
            />
            <span>Masquer les largeurs vides (0m)</span>
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 text-slate-600 font-semibold border-b border-slate-200 uppercase tracking-wider text-[11px]">
              <tr>
                <th className="py-2.5 px-4">Largeur (mm)</th>
                <th className="py-2.5 px-4">Matière</th>
                <th className="py-2.5 px-4">Détail des feuilles sorties</th>
                <th className="py-2.5 px-4 text-right">Qté</th>
                <th className="py-2.5 px-4 text-right">Cumul (m)</th>
                <th className="py-2.5 px-4 text-right">Surface</th>
                <th className="py-2.5 px-4 text-right">Poids</th>
                <th className="py-2.5 px-4 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {filteredRows.map((row, index) => {
                const isEmpty = row.is_empty;
                const sharedCount = row.materials_in_width;
                const isShared = !isEmpty && sharedCount > 1;
                const isFirstOfWidth = index === 0 || filteredRows[index - 1].width !== row.width;
                const span = visibleRowsPerWidth.get(row.width) || 1;
                return (
                  <tr
                    key={`${row.width}-${row.material || 'vide'}`}
                    className={`transition-colors ${
                      isEmpty
                        ? 'bg-[#f8fafc]/50 hover:bg-slate-50 text-slate-400'
                        : isShared
                        ? 'bg-sky-50/40 hover:bg-sky-50/80'
                        : 'bg-white hover:bg-slate-50/80'
                    }`}
                  >
                    {isFirstOfWidth && (
                      <td
                        rowSpan={span}
                        className={`py-2 px-4 font-bold text-[#282828] align-top ${
                          isShared ? 'border-l-4 border-l-[#3ca7da] bg-sky-50/60' : ''
                        }`}
                      >
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`tabular-nums font-mono text-sm ${isEmpty ? 'text-slate-400' : ''}`}>{row.width}</span>
                          <span className={isEmpty ? 'text-slate-400' : ''}>mm</span>
                          {!row.is_standard && (
                            <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold font-sans bg-amber-100 text-amber-900 border border-amber-300">
                              hors standard
                            </span>
                          )}
                        </div>
                        {isShared && (
                          <span
                            className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold font-sans bg-[#3ca7da]/15 text-[#00478a] border border-[#3ca7da]/40"
                            title={`Largeur ${row.width} mm utilisée dans ${sharedCount} matières : ${sharedCount} bobines différentes à sortir`}
                          >
                            <Layers className="w-2.5 h-2.5 shrink-0" />
                            <span>{sharedCount} matières</span>
                          </span>
                        )}
                      </td>
                    )}
                    <td className="py-2 px-4">{isEmpty ? <span className="text-slate-300">-</span> : <MaterialBadge material={row.material} family={row.family} />}</td>
                    <td className="py-2 px-4 text-[11px]">
                      {isEmpty ? (
                        <span className="font-sans text-slate-400">{WIDTH_HINTS[row.width] || '-'}</span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {[...row.sheets].reverse().map((e) => (
                            <span
                              key={e.id}
                              className="inline-flex items-center text-[10px] font-mono px-2 py-0.5 rounded border bg-slate-100 text-slate-700 border-slate-200"
                            >
                              {e.quantity}×{e.unit_length_m}m
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums">
                      {isEmpty ? <span className="text-slate-300">-</span> : <span className="text-[#282828] font-semibold">{row.quantity}</span>}
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums font-bold text-xs">
                      {isEmpty ? <span className="text-slate-300">0.00 m</span> : <span className="text-[#00478a]">{row.length_m.toFixed(2)} m</span>}
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums">
                      {isEmpty ? <span className="text-slate-300">-</span> : `${row.surface_m2.toFixed(2)} m²`}
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums">
                      {isEmpty ? <span className="text-slate-300">-</span> : `${row.weight_kg.toFixed(1)} kg`}
                    </td>
                    <td className="py-2 px-4 text-right">
                      {!isEmpty && (
                        <button
                          type="button"
                          onClick={() => handleDeleteGroup(row.material, row.width)}
                          className="p-1 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                          title={`Supprimer toutes les feuilles ${row.width} mm en ${row.material}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}

              {filteredChutes.map((c) => (
                <tr key={`chute-${c.material}`} className="bg-amber-50/50 text-amber-900 border-t border-amber-200">
                  <td className="py-2 px-4 font-bold">0 (CHUTES)</td>
                  <td className="py-2 px-4"><MaterialBadge material={c.material} family={c.family} /></td>
                  <td className="py-2 px-4 text-[11px]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {[...c.sheets].reverse().map((e) => (
                        <span
                          key={e.id}
                          className="inline-flex items-center text-[10px] font-mono px-2 py-0.5 rounded border bg-amber-100/80 text-amber-900 border-amber-200"
                        >
                          {e.quantity}×{e.unit_length_m}m
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-2 px-4 text-right tabular-nums font-bold">{c.quantity}</td>
                  <td className="py-2 px-4 text-right tabular-nums font-bold text-[#e7511f]">{c.length_m.toFixed(2)} m</td>
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
            </tbody>
          </table>
        </div>
      </div>

      {/* Historique des saisies */}
      {hasData && (
        <div className="faco-card bg-white border border-slate-200 rounded-xl p-4 space-y-2.5 shadow-2xs">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#00478a] flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-[#3ca7da]" />
              <span>Historique des Saisies ({entries.length})</span>
            </h3>
            <button
              type="button"
              onClick={handleApplyActiveMaterialToAll}
              className="px-2.5 py-1 text-[11px] font-medium text-[#00478a] bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer"
            >
              Tout passer en "{activeMaterial}"
            </button>
          </div>

          <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
            {entries.map((item) => (
              <div
                key={item.id}
                className="py-1.5 flex items-center justify-between gap-2 text-xs hover:bg-slate-50 px-2 rounded transition-colors"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-slate-400 font-mono">{item.time}</span>
                  <span
                    className={`font-mono px-2 py-0.5 rounded border font-semibold ${
                      item.isChute
                        ? 'bg-amber-50 border-amber-200 text-amber-800'
                        : 'bg-[#f8fafc] border-slate-200 text-[#00478a]'
                    }`}
                  >
                    {item.isChute ? 'Chute' : `${item.width} mm`} · {item.quantity} × {item.unitLength}m
                  </span>
                  <select
                    aria-label="Modifier la matière de cette ligne"
                    value={STANDARD_MATERIALS.includes(item.material) ? item.material : 'custom'}
                    onChange={(e) => {
                      if (e.target.value !== 'custom') handleUpdateEntryMaterial(item.id, e.target.value);
                    }}
                    className="bg-white border border-slate-200 text-[11px] font-medium text-slate-700 rounded px-2 py-0.5 focus:outline-none focus:border-[#00478a]"
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
                    {!STANDARD_MATERIALS.includes(item.material) && <option value="custom">{item.material}</option>}
                  </select>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[#282828] tabular-nums font-bold">+{item.totalLength.toFixed(2)} m</span>
                  <button
                    type="button"
                    onClick={() => handleDelete(item.id)}
                    className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors cursor-pointer"
                    title="Supprimer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
