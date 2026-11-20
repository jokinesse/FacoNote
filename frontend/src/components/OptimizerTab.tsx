import React, { useState, useEffect, useMemo } from 'react';
import {
  FileText,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Info,
  RotateCcw,
  Zap,
} from 'lucide-react';
import {
  ShapedPiece,
  OptimizationResult,
  STANDARD_MATERIALS,
  MATERIAL_GROUPS,
} from '../types';
import type { AutoPieceBreakdown } from '../types';
import { WorkshopPrintModal, WorkshopJobData } from './WorkshopPrintModal';
import { cleanWorkshopText } from '../utils/textCleaner';
import { VisualPreEncoderModal } from './VisualPreEncoderModal';
import {
  optimizerApi,
  ApiError,
  mapBackendOptimizationToResult,
  mapShapedPieceToModel,
  mapAutoBreakdown,
  useReference,
  SheetsRecapMaterial,
  SheetsRecapTotals,
  SheetsCumulMaterial,
  CoilSummaryEntry,
} from '../api';
import { CuttingPlan2D } from './CuttingPlan2D';
import { AppTab, NextStep, StepIntro } from './Header';
import { BTN_DANGER, CardTitle, KpiStrip, useDeleteAction } from './ui';
import { OrderLineDraft, OrderLines } from './OrderLines';

interface OptimizerTabProps {
  initialPieces?: ShapedPiece[];
  onStep?: (tab: AppTab) => void;
  // Bobines à sortir calculées par la découpe (envoyées vers D365 s'il n'y a pas de bobine saisie)
  onCutResult?: (r: CutResult | null) => void;
}

export interface CutResult {
  coils: CoilSummaryEntry[];
  totalSheets: number;
}

export const OptimizerTab: React.FC<OptimizerTabProps> = ({ initialPieces = [], onStep, onCutResult }) => {
  // Visual Pre-Encoder Modal State
  const [isVisualModalOpen, setIsVisualModalOpen] = useState<boolean>(false);

  // Client and job metadata
  const [clientName, setClientName] = useState<string>('Client Comptoir Facozinc');
  const [chantierRef, setChantierRef] = useState<string>('Chantier Standard');

  // Pieces to optimize
  const [pieces, setPieces] = useState<ShapedPiece[]>([]);
  // Suppressions : confirmation Oui / Non et message communs à tout le site
  const deleteAction = useDeleteAction();

  // Selected default material for optimization
  const [selectedMaterial, setSelectedMaterial] = useState<string>('Zinc Naturel 0.7');

  // Largeurs de bobines : données de référence du backend. L'opérateur peut en désactiver.
  const reference = useReference();
  // Largeurs désactivées, propres à chaque matière (clé = nom de matière)
  const [disabledWidthsByMat, setDisabledWidthsByMat] = useState<Record<string, number[]>>({});

  // Mode: baseline is pure calculation without scraps (100% mother sheets)
  const [useWorkshopScraps, setUseWorkshopScraps] = useState<boolean>(false);
  const [acceptedProposalIds, setAcceptedProposalIds] = useState<string[]>([]);
  // Réemploi intelligent des chutes générées dans le même débit (ex: pièce 3.5m découpée dans chute 4m)
  const [useGeneratedScraps, setUseGeneratedScraps] = useState<boolean>(true);
  const [hoveredPieceId, setHoveredPieceId] = useState<string | null>(null);

  const handleMovePieceUnits = (
    pieceId: string,
    targetSource: 'RACK_SCRAP' | 'BOBINE',
    requestedCount: number = 1
  ) => {
    setPieces((prev) => {
      const idx = prev.findIndex((p) => p.id === pieceId);
      if (idx === -1) return prev;

      const targetPiece = prev[idx];
      const currentSource = targetPiece.sourceType || 'BOBINE';
      if (currentSource === targetSource) return prev;

      const moveQty = Math.min(targetPiece.quantity, Math.max(1, requestedCount));
      const remainingQty = targetPiece.quantity - moveQty;
      const targetMat = targetPiece.material || selectedMaterial;

      // Chercher une ligne "sœur" existante (même dév, longueur, matière, libellé, plis) dans la destination
      const sisterIdx = prev.findIndex(
        (item, i) =>
          i !== idx &&
          (item.sourceType || 'BOBINE') === targetSource &&
          item.dev === targetPiece.dev &&
          Math.abs(item.length - targetPiece.length) < 0.001 &&
          (item.material || selectedMaterial) === targetMat &&
          item.label === targetPiece.label &&
          (item.bends ?? 2) === (targetPiece.bends ?? 2)
      );

      const next = [...prev];

      if (remainingQty === 0) {
        if (sisterIdx !== -1) {
          const sister = next[sisterIdx];
          const newTotal = sister.quantity + moveQty;
          next[sisterIdx] = {
            ...sister,
            quantity: newTotal,
            workshopSplitReason:
              targetSource === 'RACK_SCRAP'
                ? `Prélèvement sur chute rack (${newTotal} pc${newTotal > 1 ? 's' : ''})`
                : `Débit sur bobine mère (${newTotal} pc${newTotal > 1 ? 's' : ''})`,
          };
          next.splice(idx, 1);
        } else {
          next[idx] = {
            ...targetPiece,
            sourceType: targetSource,
            workshopSplitReason:
              targetSource === 'RACK_SCRAP'
                ? `Prélèvement sur chute rack (${moveQty} pc${moveQty > 1 ? 's' : ''})`
                : `Débit sur bobine mère (${moveQty} pc${moveQty > 1 ? 's' : ''})`,
          };
        }
      } else {
        // Scission partielle : on décrémente la ligne d'origine de moveQty
        next[idx] = {
          ...targetPiece,
          quantity: remainingQty,
          originalTotalLengthRequested: undefined,
          workshopSplitReason:
            currentSource === 'BOBINE'
              ? `Débit sur bobine mère (${remainingQty} pc${remainingQty > 1 ? 's' : ''})`
              : `Prélèvement sur chute rack (${remainingQty} pc${remainingQty > 1 ? 's' : ''})`,
        };

        if (sisterIdx !== -1) {
          const sister = next[sisterIdx];
          const newTotal = sister.quantity + moveQty;
          next[sisterIdx] = {
            ...sister,
            quantity: newTotal,
            workshopSplitReason:
              targetSource === 'RACK_SCRAP'
                ? `Prélèvement sur chute rack (${newTotal} pc${newTotal > 1 ? 's' : ''})`
                : `Débit sur bobine mère (${newTotal} pc${newTotal > 1 ? 's' : ''})`,
          };
        } else {
          const newSister: ShapedPiece = {
            ...targetPiece,
            id: `${targetPiece.id}-${targetSource === 'RACK_SCRAP' ? 'chute' : 'bobine'}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            quantity: moveQty,
            sourceType: targetSource,
            originalTotalLengthRequested: undefined,
            workshopSplitReason:
              targetSource === 'RACK_SCRAP'
                ? `Prélèvement individuel sur chute rack (${moveQty} pc${moveQty > 1 ? 's' : ''})`
                : `Débit sur bobine mère (${moveQty} pc${moveQty > 1 ? 's' : ''})`,
          };
          const insertPos = targetSource === 'RACK_SCRAP' ? idx + 1 : idx;
          next.splice(insertPos, 0, newSister);
        }
      }

      return next;
    });

    const pObj = pieces.find((p) => p.id === pieceId);
    if (pObj) {
      const actualMoved = Math.min(pObj.quantity, Math.max(1, requestedCount));
      if (targetSource === 'RACK_SCRAP') {
        setActionNotice(
          `✂️ ${actualMoved} pièce(s) "${pObj.label}" (${pObj.dev} mm) passée(s) en chute rack atelier.`
        );
      } else {
        setActionNotice(
          `↩ ${actualMoved} pièce(s) "${pObj.label}" (${pObj.dev} mm) remise(s) sur bobine mère.`
        );
      }
    }
  };

  const handleMovePieceToScrap = (pieceId: string, count: number = 1) => {
    handleMovePieceUnits(pieceId, 'RACK_SCRAP', count);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if ((e.key === 'c' || e.key === 'C') && hoveredPieceId) {
        e.preventDefault();
        const hovered = pieces.find((p) => p.id === hoveredPieceId);
        if (!hovered) return;
        const target = hovered.sourceType === 'RACK_SCRAP' ? 'BOBINE' : 'RACK_SCRAP';
        const qtyToMove = e.shiftKey ? hovered.quantity : 1;
        handleMovePieceUnits(hoveredPieceId, target, qtyToMove);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hoveredPieceId, pieces, selectedMaterial]);

  // Optimization Result
  const [optimizationResult, setOptimizationResult] = useState<OptimizationResult | null>(null);
  const [isCalculating, setIsCalculating] = useState<boolean>(false);
  const [calculationError, setCalculationError] = useState<string | null>(null);

  // Manual piece entry form
  const [newLabel, setNewLabel] = useState<string>('');
  const [newDev, setNewDev] = useState<string>('150');
  const [newLength, setNewLength] = useState<string>('2.0');
  const [newQty, setNewQty] = useState<string>('1');
  const [newMat, setNewMat] = useState<string>('Zinc Naturel 0.7');
  const [selectedForcedLength, setSelectedForcedLength] = useState<number | undefined>(undefined);

  // Notice and feedback message (replaces alert)
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Workshop Print Modal
  const [isPrintModalOpen, setIsPrintModalOpen] = useState<boolean>(false);

  // Auto-dismiss notice
  useEffect(() => {
    if (actionNotice) {
      const timer = setTimeout(() => setActionNotice(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [actionNotice]);

  // Sync initial pieces when transferred from Calculator
  useEffect(() => {
    if (initialPieces && initialPieces.length > 0) {
      const cleaned = initialPieces.map((p) => ({
        ...p,
        label: cleanWorkshopText(p.label),
        workshopSplitReason: cleanWorkshopText(p.workshopSplitReason),
      }));
      setPieces(cleaned);

      if (cleaned[0]?.material) {
        setSelectedMaterial(cleaned[0].material);
        setNewMat(cleaned[0].material);
      }

      setActionNotice(`${cleaned.length > 1 ? `${cleaned.length} lignes reprises` : "1 ligne reprise"} de la saisie.`);
    }
  }, [initialPieces]);

  const isAlu = useMemo(() => /alu/i.test(selectedMaterial), [selectedMaterial]);

  // Matières présentes dans la liste (matière par défaut si la liste est vide)
  const usedMaterials = useMemo(() => {
    const names = Array.from(new Set(pieces.map((p) => p.material || selectedMaterial)));
    return names.length > 0 ? names : [selectedMaterial];
  }, [pieces, selectedMaterial]);

  // Largeurs disponibles pour chaque matière utilisée (toute la grille si matière hors liste)
  const widthsByMaterial = useMemo(() => {
    if (!reference) return [] as { material: string; widths: number[] }[];
    return usedMaterials.map((name) => {
      const mat = reference.materials.find((m) => m.name === name);
      return { material: name, widths: mat ? mat.coil_widths_mm : reference.coil_widths_mm };
    });
  }, [reference, usedMaterials]);

  // Largeurs envoyées au moteur, matière par matière, sauf celles désactivées.
  // Tant que la référence n'est pas chargée : aucune liste, le moteur prend ses largeurs par défaut.
  const motherWidthsByMaterial = useMemo(() => {
    if (!reference) return undefined;
    const out: Record<string, number[]> = {};
    for (const { material, widths } of widthsByMaterial) {
      const disabled = disabledWidthsByMat[material] ?? [];
      out[material] = widths.filter((w) => !disabled.includes(w));
    }
    return out;
  }, [reference, widthsByMaterial, disabledWidthsByMat]);

  // Mode Auto-Métrage (activé quand Quantité = 0) : aperçu calculé par le backend (auto-breakdown)
  const isAutoMeterMode = newQty.trim() === '0';
  const [autoBreakdown, setAutoBreakdown] = useState<AutoPieceBreakdown | null>(null);
  useEffect(() => {
    const meters = parseFloat(newLength);
    if (!isAutoMeterMode || isNaN(meters) || meters <= 0 || meters > 500) {
      setAutoBreakdown(null);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      optimizerApi
        .autoBreakdown({
          total_meters: meters,
          current_pieces: pieces.map(mapShapedPieceToModel),
          target_material: newMat || selectedMaterial,
          forced_length: selectedForcedLength ?? null,
        })
        .then((res) => {
          if (active) setAutoBreakdown(mapAutoBreakdown(res.data));
        })
        .catch(() => {
          if (active) setAutoBreakdown(null);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [isAutoMeterMode, newLength, pieces, newMat, selectedMaterial, selectedForcedLength]);

  // Core calculation function connectée à l'API FastAPI (/api/v1/optimizer/calculate)
  const calculateOptimization = async (
    currentPieces = pieces,
    withScraps = useWorkshopScraps,
    propIds = acceptedProposalIds,
    withGeneratedScraps = useGeneratedScraps
  ) => {
    if (currentPieces.length === 0) {
      setOptimizationResult(null);
      setCalculationError(null);
      return;
    }

    setIsCalculating(true);
    setCalculationError(null);

    try {
      const response = await optimizerApi.calculateNesting({
        client_name: clientName || 'Client Comptoir',
        chantier_ref: chantierRef || 'Chantier Standard',
        material: selectedMaterial,
        pieces: currentPieces.map(mapShapedPieceToModel),
        mother_widths_by_material: motherWidthsByMaterial,
        use_workshop_scraps: withScraps,
        use_generated_scraps: withGeneratedScraps,
        accepted_proposal_ids: propIds,
      });

      const res = mapBackendOptimizationToResult(response.data, currentPieces);
      setOptimizationResult(res);
      setSheetsRecap({
        materials: response.data.sheets_recap ?? [],
        totals: response.data.sheets_recap_totals ?? {
          total_sheets: 0, total_length_m: 0, total_surface_m2: 0, total_weight_kg: 0,
        },
        cumul: response.data.sheets_cumul ?? [],
      });
    } catch (err: any) {
      console.error('Erreur optimisation API:', err);
      const msg = err instanceof ApiError ? err.message : err.message || "Erreur lors du calcul d'imbrication";
      setCalculationError(msg);
    } finally {
      setIsCalculating(false);
    }
  };

  // Re-run optimization when pieces or widths change
  useEffect(() => {
    calculateOptimization(pieces, useWorkshopScraps, acceptedProposalIds, useGeneratedScraps);
  }, [pieces, motherWidthsByMaterial, selectedMaterial, useWorkshopScraps, acceptedProposalIds, useGeneratedScraps]);

  // Toggle Mother Width
  const handleToggleMotherWidth = (material: string, width: number) => {
    setDisabledWidthsByMat((prev) => {
      const current = prev[material] ?? [];
      const next = current.includes(width) ? current.filter((w) => w !== width) : [...current, width];
      return { ...prev, [material]: next };
    });
  };

  // Feuilles / bobines mères à sortir : calculé par le moteur d'imbrication (sheets_recap)
  const [sheetsRecap, setSheetsRecap] = useState<{
    materials: SheetsRecapMaterial[];
    totals: SheetsRecapTotals;
    cumul: SheetsCumulMaterial[];
  } | null>(null);
  const sheetsCumul = optimizationResult ? sheetsRecap?.cumul ?? [] : [];

  // Feuilles mères neuves du résultat (backend), au format des bobines de la commande
  useEffect(() => {
    if (!onCutResult) return;
    const mats = optimizationResult && pieces.length > 0 ? sheetsRecap?.materials ?? [] : [];
    if (mats.length === 0) {
      onCutResult(null);
      return;
    }
    onCutResult({
      coils: mats.flatMap((m) =>
        m.formats.map((f, i) => ({
          id: `cut-${m.material}-${f.mother_width}-${f.mother_length}-${i}`,
          width: f.mother_width,
          quantity: f.count,
          unit_length_m: f.mother_length,
          material: m.material,
        }))
      ),
      totalSheets: sheetsRecap?.totals.total_sheets ?? 0,
    });
  }, [optimizationResult, sheetsRecap, pieces.length, onCutResult]);

  const sheetsRecapByMaterial = (optimizationResult ? sheetsRecap?.materials ?? [] : []).map((m) => ({
    material: m.material,
    density: m.surface_density_kg_m2,
    totalSheets: m.total_sheets,
    totalLengthM: m.total_length_m,
    totalSurfaceM2: m.total_surface_m2,
    totalWeightKg: m.total_weight_kg,
    formatList: m.formats.map((f) => ({
      motherWidth: f.mother_width,
      motherLength: f.mother_length,
      count: f.count,
      totalLengthM: f.total_length_m,
      totalSurfaceM2: f.total_surface_m2,
      totalWeightKg: f.total_weight_kg,
      piecesProduced: f.pieces,
    })),
  }));

  const recapTotals = optimizationResult ? sheetsRecap?.totals : undefined;
  const grandTotalSheets = recapTotals?.total_sheets ?? 0;
  const grandTotalMeters = recapTotals?.total_length_m ?? 0;
  const grandTotalWeight = recapTotals?.total_weight_kg ?? 0;

  // Add piece manually (supports Quantité = 0 for auto meterage sizing)
  const handleAddPiece = async (e: React.FormEvent) => {
    e.preventDefault();
    const devNum = parseFloat(newDev);
    const lenNum = parseFloat(newLength);
    const qtyNum = parseInt(newQty, 10);

    if (isNaN(devNum) || devNum <= 0 || isNaN(lenNum) || lenNum <= 0 || isNaN(qtyNum) || qtyNum < 0) {
      setActionNotice('Veuillez saisir un développement et une longueur/métrage valides.');
      return;
    }

    let finalLength = lenNum;
    let finalQty = qtyNum;
    let originalRequested: number | undefined = undefined;
    let splitReason = `Saisie manuelle : ${qtyNum} pcs × ${lenNum}m`;

    if (qtyNum === 0) {
      // Auto-métrage calculé par le backend
      try {
        const res = await optimizerApi.autoBreakdown({
          total_meters: lenNum,
          current_pieces: pieces.map(mapShapedPieceToModel),
          target_material: newMat || selectedMaterial,
          forced_length: selectedForcedLength ?? null,
        });
        finalLength = res.data.length;
        finalQty = res.data.quantity;
        originalRequested = lenNum;
        splitReason = res.data.reason;
      } catch (err: any) {
        setActionNotice(`Auto-métrage impossible : ${err?.message || 'erreur du calcul'}`);
        return;
      }
    }

    const newPiece: ShapedPiece = {
      id: `p-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      label: newLabel.trim() || `Façonnage Dév ${devNum} mm`,
      dev: devNum,
      length: finalLength,
      quantity: finalQty,
      bends: 2,
      material: newMat || selectedMaterial,
      originalTotalLengthRequested: originalRequested,
      workshopSplitReason: splitReason,
    };

    setPieces((prev) => [...prev, newPiece]);
    setNewLabel('');
    setSelectedForcedLength(undefined);

    if (qtyNum === 0) {
      setActionNotice(
        `⚡ Métrage total de ${lenNum}m converti en ${finalQty} pièce(s) de ${finalLength}m (${splitReason}).`
      );
    } else {
      setActionNotice(`Pièce Dév ${devNum}mm (${newMat || selectedMaterial}) ajoutée au calcul.`);
    }
  };

  // Remove a piece
  const handleRemovePiece = (id: string) => {
    const piece = pieces.find((p) => p.id === id);
    if (!piece) return;
    deleteAction(`la pièce ${piece.label} (Dév ${piece.dev} mm)`, () =>
      setPieces((prev) => prev.filter((p) => p.id !== id))
    );
  };

  // Correction d'une pièce sur place : le backend relit dév, quantité, longueur et matière.
  const handleSavePiece = async (id: string, draft: OrderLineDraft): Promise<string | null> => {
    const qty = parseInt(draft.quantity, 10);
    if (!draft.main.trim() || isNaN(qty) || qty < 1) return 'Développé et quantité (1 ou plus) obligatoires.';
    try {
      const { data: e } = await optimizerApi.quickEncode({
        dev_expr: draft.main.trim(),
        quantity: qty,
        length_expr: draft.unitLength.trim() || '2.0',
        material: draft.material,
        length_unit: 'm',
      });
      setPieces((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
                ...p,
                dev: e.dev,
                quantity: e.quantity,
                length: e.unit_length_m,
                material: e.material,
                originalTotalLengthRequested: undefined,
              }
            : p
        )
      );
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Correction refusée par le calcul.';
    }
  };

  // Actions sur plusieurs pièces cochées
  const handleBulkMaterial = (ids: string[], material: string) => {
    const set = new Set(ids);
    setPieces((prev) => prev.map((p) => (set.has(p.id) ? { ...p, material } : p)));
    setActionNotice(`${ids.length} ${ids.length > 1 ? 'pièces passent' : 'pièce passe'} en : ${material}`);
  };

  // Chaque copie se place juste au-dessus de sa pièce d'origine
  const handleBulkDuplicate = (ids: string[]) => {
    const set = new Set(ids);
    const stamp = Date.now();
    setPieces((prev) =>
      prev.flatMap((p, i) => (set.has(p.id) ? [{ ...p, id: `p-${stamp}-d${i}-${Math.floor(Math.random() * 1000)}` }, p] : [p]))
    );
    setActionNotice(`${ids.length} ${ids.length > 1 ? 'pièces dupliquées' : 'pièce dupliquée'}`);
  };

  const handleBulkDelete = (ids: string[]) => {
    const set = new Set(ids);
    deleteAction(`${ids.length} ${ids.length > 1 ? 'pièces' : 'pièce'}`, () =>
      setPieces((prev) => prev.filter((p) => !set.has(p.id)))
    );
  };

  // Clear all pieces
  const handleClearPieces = () => {
    deleteAction("toutes les pièces de l'optimiseur", () => {
      setPieces([]);
      setOptimizationResult(null);
      setAcceptedProposalIds([]);
      setUseWorkshopScraps(false);
    });
  };

  // Totaux de la liste : calculés par le moteur avec l'optimisation
  const totalPiecesCount = optimizationResult?.inputTotals?.pieces ?? 0;
  const totalLinearMeters = optimizationResult?.inputTotals?.lengthM ?? 0;

  const printableJob: WorkshopJobData = {
    code: `FZ-DEBIT-${new Date().getFullYear()}`,
    client: '',
    chantier: '',
    date: new Date().toISOString().split('T')[0],
    material: isAlu ? 'ALUMINIUM' : 'ZINC',
    finish: selectedMaterial,
    thickness: /0\.7/.test(selectedMaterial) ? '0.7' : '0.8',
    pieces,
  };

  return (
    <div className="space-y-5">
      {/* Message court (transfert depuis le Calculateur, import) */}
      {actionNotice && (
        <div className="bg-faco-blue-50 border border-faco-blue-200 text-faco-blue px-4 py-2 rounded-lg flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 shrink-0" />
            <span className="font-medium">{actionNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionNotice(null)}
            aria-label="Fermer"
            className="text-slate-400 hover:text-slate-700 font-bold ml-3 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      <StepIntro
        step={2}
        title="Découper"
        hint="Les feuilles à sortir du stock et le plan de coupe sont calculés automatiquement. Étape facultative."
      />

      {/* 1. Réglages : largeurs de bobine, réemploi des chutes, impression */}
      <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-xs flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          {isCalculating && (
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
              <RefreshCw className="w-3 h-3 animate-spin text-faco-blue" />
              Calcul…
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Largeurs de bobine</span>
          {widthsByMaterial.map(({ material, widths }) => (
            <div key={material} className="flex items-center gap-1.5">
              {widthsByMaterial.length > 1 && (
                <span className="text-[11px] font-semibold text-slate-600 whitespace-nowrap">{material}</span>
              )}
              <div className="flex flex-wrap gap-1">
                {widths.map((w) => {
                  const isActive = !(disabledWidthsByMat[material] ?? []).includes(w);
                  return (
                    <button
                      key={w}
                      type="button"
                      onClick={() => handleToggleMotherWidth(material, w)}
                      aria-pressed={isActive}
                      className={`px-2 py-1 rounded text-[11px] font-mono font-semibold transition-colors cursor-pointer border ${
                        isActive
                          ? 'bg-faco-blue text-white border-faco-blue'
                          : 'bg-white text-slate-400 border-slate-200 line-through hover:text-slate-700'
                      }`}
                      title={`${material} : ${isActive ? 'ne plus utiliser' : 'utiliser'} la bobine de ${w} mm`}
                    >
                      {w}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <label
            className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none"
            title="Réutilise les chutes des feuilles plus longues pour d'autres pièces"
          >
            <input
              type="checkbox"
              checked={useGeneratedScraps}
              onChange={() => setUseGeneratedScraps(!useGeneratedScraps)}
              className="rounded border-slate-300 text-faco-blue focus:ring-0 cursor-pointer"
            />
            <span>Réutiliser les chutes</span>
          </label>
          <button
            type="button"
            onClick={() => setIsPrintModalOpen(true)}
            disabled={pieces.length === 0}
            className="px-3 py-1.5 bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 border border-slate-200 transition-colors cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Imprimer</span>
          </button>
        </div>
      </div>

      {calculationError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center justify-between gap-3 text-red-700 text-xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{calculationError}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => calculateOptimization()}
              className="text-red-700 text-xs px-2 py-1 rounded bg-white border border-red-200 cursor-pointer"
            >
              Recalculer
            </button>
            <button
              type="button"
              onClick={() => setCalculationError(null)}
              aria-label="Fermer"
              className="text-red-600 hover:text-red-800 text-xs px-2 py-1 cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* 2. Pièces à débiter : même tableau que « Lignes de la commande » de l'étape Saisir */}
      <OrderLines
        title="Pièces à débiter"
        mainHeader="Dév (mm)"
        lines={pieces.map((p) => ({
          id: p.id,
          main: p.dev,
          quantity: p.quantity,
          quantityNote: p.originalTotalLengthRequested ? `(${p.originalTotalLengthRequested} m auto)` : undefined,
          unitLength: p.length,
          material: p.material || selectedMaterial,
          tone: p.sourceType === 'RACK_SCRAP' ? 'scrap' : undefined,
        }))}
        activeMaterial={selectedMaterial}
        onSave={handleSavePiece}
        onDelete={handleRemovePiece}
        onApplyActiveMaterialToAll={() => handleBulkMaterial(pieces.map((p) => p.id), selectedMaterial)}
        onBulkMaterial={handleBulkMaterial}
        onBulkDuplicate={handleBulkDuplicate}
        onBulkDelete={handleBulkDelete}
        defaultOpen
        emptyText="Aucune pièce. Ajoutez-les ci-dessous, ou reprenez-les de l'étape Saisir."
        onRowHover={setHoveredPieceId}
        headerActions={
          pieces.length > 0 && (
            <>
              <span className="text-xs font-mono text-slate-500 whitespace-nowrap">
                {totalPiecesCount} pièces · {totalLinearMeters.toFixed(2)} m
              </span>
              <button type="button" onClick={handleClearPieces} className={BTN_DANGER} title="Vider la liste des pièces">
                <Trash2 className="w-3.5 h-3.5" />
                <span>Vider la liste</span>
              </button>
            </>
          )
        }
        extraColumn={{
          header: 'Débit sur',
          title: "Débiter sur une bobine neuve ou prendre une chute de l'atelier (raccourci : touche C)",
          render: (line) => {
            const p = pieces.find((x) => x.id === line.id);
            if (!p) return null;
            const onScrap = p.sourceType === 'RACK_SCRAP';
            return (
            <div className="inline-flex items-center gap-1.5">
              <div className="inline-flex rounded-md border border-slate-200 overflow-hidden text-[11px] font-semibold">
                <button
                  type="button"
                  onClick={() => onScrap && handleMovePieceUnits(p.id, 'BOBINE', p.quantity)}
                  aria-pressed={!onScrap}
                  className={`px-2 py-0.5 cursor-pointer ${
                    !onScrap ? 'bg-faco-blue text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
                  }`}
                  title="Débiter sur une bobine neuve"
                >
                  Bobine
                </button>
                <button
                  type="button"
                  onClick={() => !onScrap && handleMovePieceUnits(p.id, 'RACK_SCRAP', p.quantity)}
                  aria-pressed={onScrap}
                  className={`px-2 py-0.5 border-l border-slate-200 cursor-pointer ${
                    onScrap ? 'bg-amber-500 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
                  }`}
                  title="Prendre dans les chutes de l'atelier"
                >
                  Chute
                </button>
              </div>
              {p.quantity > 1 && (
                <button
                  type="button"
                  onClick={() => handleMovePieceUnits(p.id, onScrap ? 'BOBINE' : 'RACK_SCRAP', 1)}
                  className="px-1.5 py-0.5 rounded text-[10px] text-slate-500 hover:text-faco-blue hover:bg-slate-100 cursor-pointer"
                  title={onScrap ? 'Remettre 1 pièce sur bobine (C)' : 'Passer 1 seule pièce en chute (C)'}
                >
                  {onScrap ? '1 sur bobine' : '1 en chute'}
                </button>
              )}
            </div>
            );
          },
        }}
      >
        {/* Ajout rapide : même ordre que les colonnes */}
        <form onSubmit={handleAddPiece} className="border-t border-slate-200 bg-slate-50">
          <div className="flex flex-wrap items-end gap-3 px-4 py-2.5">
            <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Dév (mm)
              <input
                type="number"
                value={newDev}
                onChange={(e) => setNewDev(e.target.value)}
                min="20"
                max="2000"
                required
                aria-label="Développé (mm)"
                placeholder="Dév"
                className="w-24 bg-white border border-slate-300 rounded-md px-2 py-1 font-mono text-xs focus:outline-none focus:border-faco-blue"
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Quantité
              <input
                type="number"
                value={newQty}
                onChange={(e) => {
                  setNewQty(e.target.value);
                  if (e.target.value !== '0') setSelectedForcedLength(undefined);
                }}
                min="0"
                required
                aria-label="Quantité (0 = métrage auto)"
                title="0 = métrage auto : la longueur devient le métrage total"
                className={`w-16 border rounded-md px-2 py-1 font-mono text-xs text-right focus:outline-none ${
                  isAutoMeterMode
                    ? 'border-faco-blue text-faco-blue font-bold bg-faco-blue-50'
                    : 'bg-white border-slate-300 focus:border-faco-blue'
                }`}
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {isAutoMeterMode ? 'Métrage total (m)' : 'Longueur (m)'}
              <input
                type="number"
                step="0.05"
                value={newLength}
                onChange={(e) => setNewLength(e.target.value)}
                min="0.2"
                required
                aria-label={isAutoMeterMode ? 'Métrage total (m)' : 'Longueur (m)'}
                placeholder={isAutoMeterMode ? 'Total m' : 'Long.'}
                className={`w-24 border rounded-md px-2 py-1 font-mono text-xs text-right focus:outline-none ${
                  isAutoMeterMode
                    ? 'border-faco-blue text-faco-blue font-bold bg-faco-blue-50'
                    : 'bg-white border-slate-300 focus:border-faco-blue'
                }`}
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Matière
              <select
                value={newMat}
                onChange={(e) => {
                  setNewMat(e.target.value);
                  setSelectedMaterial(e.target.value);
                }}
                aria-label="Matière"
                className="bg-white border border-slate-300 rounded-md px-1.5 py-1 text-xs focus:outline-none focus:border-faco-blue cursor-pointer"
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
            </label>
            <button
              type="submit"
              className="px-3 py-1.5 bg-faco-orange hover:bg-faco-orange-hover text-white font-semibold rounded-md text-xs flex items-center gap-1 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isAutoMeterMode ? 'Ajouter (auto)' : 'Ajouter'}</span>
            </button>
          </div>
          {/* Métrage auto (Qté = 0) : découpage proposé par le backend */}
          {isAutoMeterMode && autoBreakdown && (
            <div className="mx-4 my-3 bg-faco-blue-50 border border-faco-blue-200 rounded-lg p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Zap className="w-3.5 h-3.5 text-faco-blue shrink-0" />
                <span className="font-semibold text-slate-700">Métrage auto ({autoBreakdown.requestedMeters} m) :</span>
                <span className="font-mono text-faco-blue font-bold bg-white px-2 py-0.5 rounded border border-faco-blue-200">
                  {autoBreakdown.quantity} × {autoBreakdown.length} m = {autoBreakdown.totalProduced} m
                </span>
                <span className="text-[11px] text-slate-500">{autoBreakdown.reason}</span>
              </div>
              {autoBreakdown.alternatives.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {autoBreakdown.alternatives.map((alt) => {
                    const isSelected = Math.abs(alt.length - autoBreakdown.length) < 0.01;
                    return (
                      <button
                        key={alt.length}
                        type="button"
                        onClick={() => setSelectedForcedLength(alt.length)}
                        className={`px-2.5 py-1 rounded-md font-mono text-xs font-semibold cursor-pointer border ${
                          isSelected
                            ? 'bg-faco-blue text-white border-faco-blue'
                            : 'bg-white text-slate-700 hover:bg-slate-50 border-slate-200'
                        }`}
                        title={alt.label}
                      >
                        {alt.quantity} × {alt.length} m{alt.isExact ? ' · pile' : ''}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </form>
      </OrderLines>

      {/* 3. Résultat du débit */}
      {optimizationResult && (
        <div className="space-y-4">
          {/* L'essentiel en une ligne (valeurs du backend) */}
          <KpiStrip
            items={[
              {
                label: 'À sortir du stock',
                value: String(grandTotalSheets),
                unit: grandTotalSheets > 1 ? 'feuilles' : 'feuille',
                sub: `${grandTotalMeters.toFixed(2)} m · ${grandTotalWeight} kg brut`,
                tone: 'blue',
              },
              {
                label: 'Rendement matière',
                value: optimizationResult.materialEfficiencyRate.toFixed(1),
                unit: '%',
                sub: `${optimizationResult.totalNetSurfaceM2.toFixed(2)} m² utiles sur ${optimizationResult.totalGrossSurfaceM2.toFixed(2)} m²`,
              },
              {
                label: 'Chutes à ranger (≥ 100 mm)',
                value: String(optimizationResult.newReusableScrapsCreated.length),
                unit: optimizationResult.newReusableScrapsCreated.length > 1 ? 'bandes' : 'bande',
                sub: `${optimizationResult.reusableScrapSurfaceM2.toFixed(2)} m²`,
                tone: 'green',
              },
              {
                label: 'Perte (< 100 mm)',
                value: optimizationResult.netLossSurfaceM2.toFixed(2),
                unit: 'm²',
                tone: 'muted',
              },
            ]}
          />

          {/* Pièces prises dans les chutes de l'atelier */}
          {optimizationResult.appliedWorkshopScraps && optimizationResult.appliedWorkshopScraps.length > 0 && (
            <div className="bg-amber-50/60 border border-amber-200 rounded-xl px-4 py-3 space-y-2">
              <div className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-amber-700" />
                <span>Pris dans les chutes de l'atelier ({optimizationResult.appliedWorkshopScraps.length})</span>
              </div>
              <div className="flex flex-wrap gap-2 text-xs font-mono">
                {optimizationResult.appliedWorkshopScraps.map((s, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-1 rounded-md bg-white border border-amber-200 text-slate-700 flex items-center gap-1.5"
                    title={s.pieceLabel}
                  >
                    <span className="font-bold text-faco-blue">{s.pieceDev} mm</span>
                    <span className="text-slate-500">× {s.pieceLength} m</span>
                    <span className="text-amber-800">→ chute {s.scrapDev} mm</span>
                    {s.pieceId && (
                      <button
                        type="button"
                        onClick={() => handleMovePieceUnits(s.pieceId!, 'BOBINE', 1)}
                        className="ml-1 px-1.5 py-0.5 rounded bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 text-[10px] font-sans cursor-pointer"
                        title="Remettre cette pièce sur bobine"
                      >
                        <RotateCcw className="w-2.5 h-2.5 inline -mt-0.5" /> bobine
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* RÉCAPITULATIF DES FEUILLES SORTIES & LEUR MATIÈRE */}
          {sheetsRecapByMaterial.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3.5">
              <CardTitle icon={FileText} as="h3">Feuilles à sortir du stock</CardTitle>

              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3 items-start">
              <div className="space-y-3 min-w-0">
                <h5 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Détail, de la plus grande à la plus petite
                </h5>
                {sheetsRecapByMaterial.map((matGroup, mIdx) => {
                  const isGroupAlu = /alu/i.test(matGroup.material);
                  return (
                    <div
                      key={mIdx}
                      className="bg-white border border-slate-200 rounded-lg overflow-hidden"
                    >
                      <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2.5 h-2.5 rounded-full ${
                              isGroupAlu ? 'bg-faco-sky' : 'bg-faco-blue'
                            }`}
                          />
                          <span className="font-bold text-xs text-slate-900">
                            {matGroup.material}
                          </span>
                          <span className="text-[11px] font-mono text-slate-400">
                            ({matGroup.density.toFixed(2)} kg/m²)
                          </span>
                        </div>

                        <div className="flex items-center gap-2.5 text-xs font-mono text-slate-600 flex-wrap">
                          <span>
                            <strong className="text-faco-blue">{matGroup.totalSheets}</strong>{' '}
                            {matGroup.totalSheets > 1 ? 'feuilles' : 'feuille'}
                          </span>
                          <span>·</span>
                          <span>
                            <strong className="text-slate-800">{matGroup.totalLengthM.toFixed(2)} m</strong>
                          </span>
                          <span>·</span>
                          <span>
                            <strong className="text-slate-800">{matGroup.totalSurfaceM2.toFixed(2)} m²</strong>
                          </span>
                          <span>·</span>
                          <span className="text-faco-blue font-bold">
                            {matGroup.totalWeightKg.toFixed(1)} kg
                          </span>
                        </div>
                      </div>

                      <div
                        className="table-wrapper"
                        tabIndex={0}
                        role="region"
                        aria-label={`Feuilles mères ${matGroup.material}`}
                      >
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-50/60 text-slate-500 uppercase tracking-wider text-[10px] border-b border-slate-200 whitespace-nowrap">
                            <tr>
                              <th className="py-2 px-3">Feuille (largeur × longueur)</th>
                              <th className="py-2 px-3 text-right">Quantité</th>
                              <th className="py-2 px-3 text-right">Métrage</th>
                              <th className="py-2 px-3 text-right">Poids</th>
                              <th className="py-2 px-3 min-w-[12rem]">Pièces débitées</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                            {matGroup.formatList.map((f, fIdx) => (
                              <tr key={fIdx} className="hover:bg-slate-50/80 transition-colors">
                                <td className="py-2 px-3 whitespace-nowrap">
                                  <span className="font-bold text-faco-blue">{f.motherWidth}</span>
                                  <span className="text-slate-400"> × </span>
                                  <span className="font-bold text-slate-800">{f.motherLength.toFixed(2)} m</span>
                                </td>
                                <td className="py-2 px-3 text-right whitespace-nowrap">
                                  <span className="inline-block min-w-[2rem] px-2 py-0.5 rounded bg-faco-blue-50 text-faco-blue border border-faco-blue-200 font-bold text-center">
                                    {f.count}
                                  </span>
                                </td>
                                <td className="py-2 px-3 text-right text-slate-700 whitespace-nowrap">
                                  {f.totalLengthM.toFixed(2)} m
                                </td>
                                <td className="py-2 px-3 text-right text-slate-600 whitespace-nowrap">
                                  {f.totalWeightKg.toFixed(1)} kg
                                </td>
                                <td className="py-2 px-3">
                                  <div className="flex flex-wrap gap-1">
                                    {f.piecesProduced.map((pc, pIdx) => (
                                      <span
                                        key={pIdx}
                                        className="bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded text-[10px] text-slate-700 whitespace-nowrap"
                                        title={pc.label}
                                      >
                                        {pc.dev} mm × {pc.count}
                                      </span>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-3 min-w-0">
                <h5 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Cumul par matière et par borne
                </h5>
                {sheetsCumul.map((c) => (
                  <div
                    key={c.material}
                    className="table-wrapper bg-white border border-slate-200 rounded-lg overflow-hidden"
                    tabIndex={0}
                    role="region"
                    aria-label={`Cumul ${c.material}`}
                  >
                    <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 font-bold text-xs text-slate-900">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            /alu/i.test(c.material) ? 'bg-faco-sky' : 'bg-faco-blue'
                          }`}
                        />
                        {c.material}
                      </span>
                      <span className="font-mono text-xs font-bold text-faco-blue whitespace-nowrap">
                        {c.total_length_m.toFixed(2)} m
                      </span>
                    </div>
                    <table className="w-full text-left text-xs">
                      <thead className="text-slate-500 uppercase tracking-wider text-[10px] border-b border-slate-200 whitespace-nowrap">
                        <tr>
                          <th className="py-1.5 px-3">Borne</th>
                          <th className="py-1.5 px-3 text-right">Métrage cumulé</th>
                          <th className="py-1.5 px-3 text-right">Feuilles</th>
                          <th className="py-1.5 px-3 text-right">Poids</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono text-[11px] whitespace-nowrap">
                        {c.widths.map((w) => (
                          <tr key={w.mother_width} className="hover:bg-slate-50/80 transition-colors">
                            <td className="py-1.5 px-3 font-bold text-faco-blue">{w.mother_width} mm</td>
                            <td className="py-1.5 px-3 text-right font-bold text-slate-800">
                              {w.total_length_m.toFixed(2)} m
                            </td>
                            <td className="py-1.5 px-3 text-right text-slate-700">{w.total_sheets}</td>
                            <td className="py-1.5 px-3 text-right text-slate-600">
                              {w.total_weight_kg.toFixed(1)} kg
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
              </div>
            </div>
          )}

          {/* Visualiseur de Calepinage 2D */}
          <CuttingPlan2D
            motherItems={optimizationResult.motherItemsNeeded}
            selectedMaterial={selectedMaterial}
            onMovePieceToScrap={handleMovePieceToScrap}
          />

        </div>
      )}

      {/* Workshop Print Modal */}
      {isPrintModalOpen && (
        <WorkshopPrintModal
          job={printableJob}
          optimizationResult={optimizationResult}
          onClose={() => setIsPrintModalOpen(false)}
        />
      )}

      {/* Visual Pre-Encoder Modal */}
      <VisualPreEncoderModal
        isOpen={isVisualModalOpen}
        onClose={() => setIsVisualModalOpen(false)}
        onImportPieces={(importedPieces, metadata) => {
          setPieces((prev) => [...prev, ...importedPieces]);
          if (metadata?.client) setClientName(cleanWorkshopText(metadata.client));
          if (metadata?.chantier) setChantierRef(cleanWorkshopText(metadata.chantier));
          if (
            metadata?.detectedMaterial &&
            STANDARD_MATERIALS.includes(metadata.detectedMaterial)
          ) {
            setSelectedMaterial(metadata.detectedMaterial);
            setNewMat(metadata.detectedMaterial);
          }
          setActionNotice(`${importedPieces.length} pièce(s) importée(s) avec succès.`);
        }}
        targetMode="optimizer"
        currentDefaultMaterial={selectedMaterial}
      />
      {onStep && (
        <NextStep
          label="Suivant : envoyer vers D365"
          onClick={() => onStep('send')}
          secondary={
            <button
              type="button"
              onClick={() => onStep('calculator')}
              className="text-sm text-slate-600 hover:text-faco-blue cursor-pointer"
            >
              ← Revenir à la saisie
            </button>
          }
        />
      )}
    </div>
  );
};
