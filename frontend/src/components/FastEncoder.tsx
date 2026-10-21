import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Calculator,
  Plus,
  Trash2,
  RotateCcw,
  Download,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Hash,
  X,
  CornerDownLeft,
  Layers,
  Camera,
} from 'lucide-react';
import {
  IntervalRow,
  EncodedEntry,
  SheetPreset,
  ShapedPiece,
  STANDARD_MATERIALS,
  MATERIAL_GROUPS,
} from '../types';
import {
  createInitialIntervals,
  findMatchingBound,
} from '../utils/sheetLogic';
import { evaluateExpression } from '../utils/mathEvaluator';
import {
  getMaterialDensity,
  getMaterialWeightDetails,
  resolveAutoPieceBreakdown,
} from '../utils/optimizer';
import {
  optimizerApi,
  ApiError,
  BreakdownOption,
  FastEncoderEntryResponse,
} from '../api';
import { WorkshopCalculator } from './WorkshopCalculator';
import { VisualPreEncoderModal } from './VisualPreEncoderModal';

interface FastEncoderProps {
  onTransferToOptimizer: (pieces: ShapedPiece[]) => void;
}

export const FastEncoder: React.FC<FastEncoderProps> = ({ onTransferToOptimizer }) => {
  const [preset, setPreset] = useState<SheetPreset>('DEV_PIECE');
  const [intervals, setIntervals] = useState<IntervalRow[]>(() =>
    createInitialIntervals('DEV_PIECE')
  );
  const [chuteLength, setChuteLength] = useState<number>(0);
  const [chuteCount, setChuteCount] = useState<number>(0);
  const [entriesHistory, setEntriesHistory] = useState<EncodedEntry[]>([]);

  // Active encoding material (retains last used material for all subsequent pieces)
  const [activeMaterial, setActiveMaterial] = useState<string>('Zinc Quartz 0.7');
  const [isCustomMaterial, setIsCustomMaterial] = useState<boolean>(false);

  // 3-case input states
  const [inputDev, setInputDev] = useState<string>('');
  const [inputLength, setInputLength] = useState<string>('2.0');
  const [inputQuantity, setInputQuantity] = useState<string>('1');
  const [lengthUnit, setLengthUnit] = useState<'m' | 'mm'>('m');

  // Inline delete confirmation state (safe in iframe, never uses window.confirm)
  const [isConfirmingClear, setIsConfirmingClear] = useState<boolean>(false);
  const clearTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Visual Pre-Encoder Modal State
  const [isVisualModalOpen, setIsVisualModalOpen] = useState<boolean>(false);

  // Live feedback banner
  const [lastFeedback, setLastFeedback] = useState<{
    success: boolean;
    message: string;
    boundMatched?: number;
    executionTimeMs?: number;
  } | null>(null);

  // API loading & auto-calepinage alternatives
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [breakdownAlternatives, setBreakdownAlternatives] = useState<BreakdownOption[]>([]);

  // Refs for smooth Tab/Enter navigation between the 3 boxes
  const devRef = useRef<HTMLInputElement>(null);
  const lengthRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);

  // Focus Dev input on load
  useEffect(() => {
    devRef.current?.focus();
  }, []);

  // Preset switch
  const handlePresetChange = (newPreset: SheetPreset) => {
    setPreset(newPreset);
    setIntervals(createInitialIntervals(newPreset));
    setLastFeedback(null);
  };

  // Main Submit handler using the 3 cases connected to FastAPI
  const handleSubmitEntry = async (
    overrideDev?: string,
    overrideLen?: string,
    overrideQty?: string
  ) => {
    const devStr = overrideDev !== undefined ? overrideDev : inputDev;
    const lenStr = overrideLen !== undefined ? overrideLen : inputLength;
    const qtyStr = overrideQty !== undefined ? overrideQty : inputQuantity;

    if (!devStr.trim()) {
      setLastFeedback({
        success: false,
        message:
          preset === 'DEV_BOBINE'
            ? 'Veuillez saisir un développement en mm (ou 0 pour les chutes).'
            : 'Veuillez saisir un développement de pièce en mm (ex: 175, 250...).',
      });
      devRef.current?.focus();
      return;
    }

    setIsSubmitting(true);
    setBreakdownAlternatives([]);

    try {
      // Cas 1: Quantité = 0 -> Auto-calepinage du métrage linéaire (Section 3.2 du CDC)
      const parsedQty = parseInt(qtyStr, 10);
      if (parsedQty === 0 && !devStr.includes('/')) {
        const parsedDev = evaluateExpression(devStr);
        if (isNaN(parsedDev) || parsedDev <= 0) {
          throw new Error('Développement de pièce invalide (> 0 mm requis).');
        }

        const evaluatedLen = evaluateExpression(lenStr);
        if (isNaN(evaluatedLen) || evaluatedLen <= 0) {
          throw new Error('Métrage total invalide (> 0 m requis).');
        }

        const currentPiecesForEngine = intervals
          .filter((row) => row.accumulatedLength > 0)
          .map((row, idx) => ({
            id: `p-${idx}`,
            label: `Pièce borne ${row.bound}mm`,
            dev: row.bound,
            length: 2.0,
            quantity: row.count || 1,
            material: activeMaterial,
          }));

        const breakdownResp = await optimizerApi.autoBreakdown({
          total_meters: evaluatedLen,
          current_pieces: currentPiecesForEngine,
          target_material: activeMaterial,
        });

        const breakdown = breakdownResp.data;
        setBreakdownAlternatives(breakdown.alternatives || []);

        const rawExpression = `Dév ${parsedDev} · ${breakdown.quantity} pcs × ${breakdown.length}m (Total ${evaluatedLen}m auto)`;
        processDirectValues(parsedDev, breakdown.length, breakdown.quantity, rawExpression);

        setLastFeedback({
          success: true,
          message: `⚡ Métrage de ${evaluatedLen}m auto-calepiné (${breakdownResp.executionTimeMs}ms) : ${breakdown.quantity} pièces de ${breakdown.length}m (${breakdown.reason})`,
          executionTimeMs: breakdownResp.executionTimeMs,
        });

        setInputDev('');
        setInputLength('2.0');
        setInputQuantity('1');
        devRef.current?.focus();
        return;
      }

      // Cas 2: Expression unifiée pour l'endpoint FastAPI /quick-encode
      let rawExpressionToEncode = devStr.trim();
      if (!rawExpressionToEncode.includes('/')) {
        const cleanLen = lenStr.trim() || '2.0';
        const cleanQty = qtyStr.trim() || '1';
        rawExpressionToEncode = `${devStr}/${cleanQty}*${cleanLen}`;
      }

      const apiResult = await optimizerApi.quickEncode({
        raw_input: rawExpressionToEncode,
        material: activeMaterial,
        length_unit: lengthUnit,
        preset: preset === 'DEV_BOBINE' ? 'DEV_BOBINE' : 'DEV_PIECE',
      });

      const entry = apiResult.data;
      const totalAddedM = entry.total_length_m;
      const isChute = entry.is_chute;
      const matToUse = entry.material;

      if (isChute) {
        setChuteLength((prev) => Math.round((prev + totalAddedM) * 1000) / 1000);
        setChuteCount((prev) => prev + entry.quantity);

        const newEntry: EncodedEntry = {
          id: `entry-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          rawInput: entry.raw_input,
          dev: 0,
          lengthExpression: `${entry.quantity} × ${entry.unit_length_m}m`,
          unitLength: entry.unit_length_m,
          quantity: entry.quantity,
          evaluatedLength: totalAddedM,
          matchedBound: 0,
          isChute: true,
          material: matToUse,
          timestamp: new Date().toLocaleTimeString(),
        };
        setEntriesHistory((prev) => [newEntry, ...prev]);

        setLastFeedback({
          success: true,
          message: `Chute enregistrée (${apiResult.executionTimeMs}ms) : ${entry.quantity} pièce(s) de ${entry.unit_length_m}m = +${totalAddedM}m [${matToUse}] (Total chutes : ${(chuteLength + totalAddedM).toFixed(2)}m)`,
          executionTimeMs: apiResult.executionTimeMs,
        });
      } else {
        const matchedBound = entry.matched_bound;

        setIntervals((prev) =>
          prev.map((item) => {
            if (item.bound === matchedBound) {
              return {
                ...item,
                accumulatedLength:
                  Math.round((item.accumulatedLength + totalAddedM) * 1000) / 1000,
                count: item.count + entry.quantity,
              };
            }
            return item;
          })
        );

        const newEntry: EncodedEntry = {
          id: `entry-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          rawInput: entry.raw_input,
          dev: entry.dev,
          lengthExpression: `${entry.quantity} × ${entry.unit_length_m}m`,
          unitLength: entry.unit_length_m,
          quantity: entry.quantity,
          evaluatedLength: totalAddedM,
          matchedBound,
          isChute: false,
          material: matToUse,
          timestamp: new Date().toLocaleTimeString(),
        };
        setEntriesHistory((prev) => [newEntry, ...prev]);

        setLastFeedback({
          success: true,
          message: `Saisie validée (${apiResult.executionTimeMs}ms) : Dév ${entry.dev}mm (${entry.quantity} pcs × ${entry.unit_length_m}m = ${totalAddedM}m) [${matToUse}] → Borne ≤ ${matchedBound}mm · ${entry.surface_net_m2} m² · ${entry.weight_net_kg} kg`,
          boundMatched: matchedBound,
          executionTimeMs: apiResult.executionTimeMs,
        });
      }

      setInputDev('');
      devRef.current?.focus();
    } catch (err: any) {
      const errorMsg =
        err instanceof ApiError
          ? err.message
          : err.message || 'Erreur lors du traitement de la saisie.';
      setLastFeedback({
        success: false,
        message: errorMsg,
      });
      devRef.current?.focus();
    } finally {
      setIsSubmitting(false);
    }
  };

  const processDirectValues = (
    dev: number,
    unitLengthM: number,
    qty: number,
    rawExpr: string,
    customMat?: string
  ) => {
    const totalAddedM = Math.round(unitLengthM * qty * 1000) / 1000;
    const isChute = dev === 0;
    const matToUse = customMat || activeMaterial;

    if (isChute) {
      setChuteLength((prev) => Math.round((prev + totalAddedM) * 1000) / 1000);
      setChuteCount((prev) => prev + qty);

      const newEntry: EncodedEntry = {
        id: `entry-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        rawInput: rawExpr,
        dev: 0,
        lengthExpression: `${qty} × ${unitLengthM}m`,
        unitLength: unitLengthM,
        quantity: qty,
        evaluatedLength: totalAddedM,
        matchedBound: 0,
        isChute: true,
        material: matToUse,
        timestamp: new Date().toLocaleTimeString(),
      };
      setEntriesHistory((prev) => [newEntry, ...prev]);
    } else {
      const matchedBound = findMatchingBound(dev, intervals);

      if (matchedBound !== null) {
        setIntervals((prev) =>
          prev.map((item) => {
            if (item.bound === matchedBound) {
              return {
                ...item,
                accumulatedLength:
                  Math.round((item.accumulatedLength + totalAddedM) * 1000) / 1000,
                count: item.count + qty,
              };
            }
            return item;
          })
        );

        const newEntry: EncodedEntry = {
          id: `entry-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          rawInput: rawExpr,
          dev,
          lengthExpression: `${qty} × ${unitLengthM}m`,
          unitLength: unitLengthM,
          quantity: qty,
          evaluatedLength: totalAddedM,
          matchedBound,
          isChute: false,
          material: matToUse,
          timestamp: new Date().toLocaleTimeString(),
        };
        setEntriesHistory((prev) => [newEntry, ...prev]);
      }
    }
  };

  // Modify material on an individual history entry
  const handleUpdateEntryMaterial = (entryId: string, newMat: string) => {
    setEntriesHistory((prev) =>
      prev.map((item) =>
        item.id === entryId ? { ...item, material: newMat } : item
      )
    );
    // Keep principle of last material: updates active material for upcoming entries
    setActiveMaterial(newMat);
  };

  // Batch apply a material to all existing history entries
  const handleApplyActiveMaterialToAll = (targetMat?: string) => {
    const matToApply = targetMat || activeMaterial;
    setEntriesHistory((prev) =>
      prev.map((item) => ({ ...item, material: matToApply }))
    );
    setActiveMaterial(matToApply);
    setLastFeedback({
      success: true,
      message: `Toutes les saisies ont été mises à jour avec la matière : ${matToApply}`,
    });
  };

  // Delete a specific history entry
  const handleDeleteHistoryEntry = (entryId: string) => {
    const entry = entriesHistory.find((e) => e.id === entryId);
    if (!entry) return;

    if (entry.isChute) {
      setChuteLength((prev) =>
        Math.max(0, Math.round((prev - entry.evaluatedLength) * 1000) / 1000)
      );
      setChuteCount((prev) => Math.max(0, prev - (entry.quantity || 1)));
    } else {
      setIntervals((prev) =>
        prev.map((item) => {
          if (item.bound === entry.matchedBound) {
            return {
              ...item,
              accumulatedLength: Math.max(
                0,
                Math.round((item.accumulatedLength - entry.evaluatedLength) * 1000) / 1000
              ),
              count: Math.max(0, item.count - (entry.quantity || 1)),
            };
          }
          return item;
        })
      );
    }

    setEntriesHistory((prev) => prev.filter((e) => e.id !== entryId));
    setLastFeedback({
      success: true,
      message: `Entrée supprimée : ${entry.rawInput} (-${entry.evaluatedLength}m, -${entry.quantity || 1} pcs)`,
    });
  };

  // Undo the last entry
  const handleUndoLast = () => {
    if (entriesHistory.length === 0) return;
    const [last] = entriesHistory;
    handleDeleteHistoryEntry(last.id);
  };

  // Clear all with 2-click inline confirmation (works 100% reliably in iframe)
  const handleTriggerClear = () => {
    if (!isConfirmingClear) {
      setIsConfirmingClear(true);
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      clearTimerRef.current = setTimeout(() => {
        setIsConfirmingClear(false);
      }, 5000);
    } else {
      // Confirmed!
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      setIsConfirmingClear(false);
      setIntervals(createInitialIntervals(preset));
      setChuteLength(0);
      setChuteCount(0);
      setEntriesHistory([]);
      setLastFeedback({
        success: true,
        message: 'Tous les cumuls et l\'historique ont été réinitialisés à zéro.',
      });
      devRef.current?.focus();
    }
  };

  const handleCancelClear = () => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    setIsConfirmingClear(false);
  };

  // Zero out a specific interval row (with optional material filter)
  const handleResetIntervalRow = (bound: number, targetMaterial?: string) => {
    if (targetMaterial) {
      setEntriesHistory((prev) =>
        prev.filter(
          (e) =>
            !(e.matchedBound === bound && (e.material || activeMaterial) === targetMaterial)
        )
      );

      setIntervals((prev) =>
        prev.map((item) => {
          if (item.bound === bound) {
            const remainingEntries = entriesHistory.filter(
              (e) =>
                !e.isChute &&
                e.matchedBound === bound &&
                (e.material || activeMaterial) !== targetMaterial
            );
            const remLength =
              Math.round(
                remainingEntries.reduce((acc, e) => acc + e.evaluatedLength, 0) * 1000
              ) / 1000;
            const remCount = remainingEntries.reduce(
              (acc, e) => acc + (e.quantity || 1),
              0
            );
            return { ...item, accumulatedLength: remLength, count: remCount };
          }
          return item;
        })
      );

      setLastFeedback({
        success: true,
        message: `Borne ${bound} mm (${targetMaterial}) remise à zéro.`,
      });
    } else {
      setEntriesHistory((prev) => prev.filter((e) => e.matchedBound !== bound));
      setIntervals((prev) =>
        prev.map((item) => {
          if (item.bound === bound) {
            return { ...item, accumulatedLength: 0, count: 0 };
          }
          return item;
        })
      );
      setLastFeedback({
        success: true,
        message: `Borne ${bound} mm remise à zéro.`,
      });
    }
  };

  // Zero out chutes
  const handleResetChutes = () => {
    setChuteLength(0);
    setChuteCount(0);
    setLastFeedback({
      success: true,
      message: 'Compteur des chutes remis à zéro.',
    });
  };

  // Quick preset button click
  const handleQuickPreset = (dev: number, len: string, qty: string) => {
    setInputDev(dev.toString());
    setInputLength(len);
    setInputQuantity(qty);
    handleSubmitEntry(dev.toString(), len, qty);
  };

  // Export CSV with material breakdown
  const handleExportCSV = () => {
    const headers = [
      'Borne_Dev_mm',
      'Matiere',
      'Longueur_Cumulee_m',
      'Nombre_Pieces',
      'Surface_m2',
      'Poids_Est_kg',
    ];
    const rows = tableIntervalRows
      .filter((r) => r.accumulatedLength > 0)
      .map(
        (r) =>
          `${r.bound};${r.material};${r.accumulatedLength};${r.count};${r.surface.toFixed(2)};${r.weightEst}`
      );

    if (chuteLength > 0) {
      rows.push(`0 (CHUTES);Chutes Atelier;${chuteLength};${chuteCount};-; -`);
    }

    const csvContent =
      'data:text/csv;charset=utf-8,' + [headers.join(';'), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute(
      'download',
      `facozinc_cumuls_${preset.toLowerCase()}_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Transfer to Optimizer
  const handleTransfer = () => {
    const activePieces: ShapedPiece[] = [];

    // 1. If user entered pieces in the history, transfer the exact pieces entered
    const nonChuteEntries = entriesHistory.filter((e) => !e.isChute && e.dev > 0);

    if (nonChuteEntries.length > 0) {
      const pieceMap = new Map<
        string,
        { dev: number; length: number; quantity: number; bound: number; material: string }
      >();

      for (const entry of nonChuteEntries) {
        const entryMat = entry.material || activeMaterial;
        const key = `${entry.dev}-${entry.unitLength}-${entryMat}`;
        const existing = pieceMap.get(key);
        if (existing) {
          existing.quantity += entry.quantity || 1;
        } else {
          pieceMap.set(key, {
            dev: entry.dev,
            length: entry.unitLength,
            quantity: entry.quantity || 1,
            bound: entry.matchedBound,
            material: entryMat,
          });
        }
      }

      let idx = 1;
      pieceMap.forEach((val) => {
        activePieces.push({
          id: `transf-entry-${idx++}-${Date.now()}`,
          label: `Façonnage Dév ${val.dev} mm`,
          dev: val.dev,
          length: Math.round(val.length * 100) / 100,
          quantity: val.quantity,
          bends: 2,
          material: val.material,
          workshopSplitReason: `Saisie Calculateur : ${val.quantity} pcs × ${val.length}m (Borne ≤ ${val.bound} mm)`,
        });
      });
    } else {
      // 2. Otherwise fallback to accumulated intervals
      intervals.forEach((row, idx) => {
        if (row.accumulatedLength > 0) {
          const avgLength = row.count > 0 ? row.accumulatedLength / row.count : 2.0;
          activePieces.push({
            id: `transf-row-${idx}-${Date.now()}`,
            label: `Façonnage Dév ≤ ${row.bound} mm`,
            dev: row.bound,
            length: Math.round(avgLength * 100) / 100,
            quantity: Math.max(1, row.count),
            bends: 2,
            material: activeMaterial,
            workshopSplitReason: `Cumul Calculateur : ${row.accumulatedLength.toFixed(1)}m cumulés sur borne ≤ ${row.bound} mm`,
          });
        }
      });
    }

    if (activePieces.length === 0) {
      setLastFeedback({
        success: false,
        message: "Veuillez d'abord encoder des pièces avant de lancer l'optimisation.",
      });
      return;
    }

    onTransferToOptimizer(activePieces);
  };

  // Totals calculated from all encoded entries (chutes included for global length/count if needed)
  const totalLengthM =
    Math.round(
      intervals.reduce((acc, curr) => acc + curr.accumulatedLength, 0) * 1000
    ) / 1000;
  const totalCount = intervals.reduce((acc, curr) => acc + curr.count, 0);
  const totalSurfaceM2 =
    Math.round(
      intervals.reduce(
        (acc, curr) => acc + (curr.bound / 1000) * curr.accumulatedLength,
        0
      ) * 100
    ) / 100;

  // Active material weight characteristics (e.g. Zinc 0.7 = 5.04 kg/m², Alu 0.7 = 1.89 kg/m², etc.)
  const activeMatDetails = useMemo(
    () => getMaterialWeightDetails(activeMaterial),
    [activeMaterial]
  );

  // Import handler from Visual Pre-Encoder Modal
  const handleImportPiecesFromVisual = (
    pieces: ShapedPiece[],
    metadata?: { client?: string; chantier?: string; detectedMaterial?: string }
  ) => {
    pieces.forEach((p) => {
      processDirectValues(
        p.dev,
        p.length,
        p.quantity,
        `[Vision IA] ${p.label} (Dév ${p.dev}mm) · ${p.quantity} pcs × ${p.length}m`,
        p.material || activeMaterial
      );
    });

    if (metadata?.detectedMaterial && STANDARD_MATERIALS.includes(metadata.detectedMaterial)) {
      setActiveMaterial(metadata.detectedMaterial);
    }

    setLastFeedback({
      success: true,
      message: `${pieces.length} profil(s) importé(s) et injecté(s) avec succès dans le calculateur !`,
    });
  };

  // Build the interval rows where each bound splits by material if pieces have different materials
  const tableIntervalRows = useMemo(() => {
    const rows: {
      id: string;
      bound: number;
      material: string;
      count: number;
      accumulatedLength: number;
      surface: number;
      weightEst: number;
      percent: number;
      isMultiMaterialBound: boolean;
      entries: EncodedEntry[];
    }[] = [];

    intervals.forEach((interval) => {
      const bound = interval.bound;
      const boundEntries = entriesHistory.filter(
        (e) => !e.isChute && e.matchedBound === bound
      );

      if (boundEntries.length === 0) {
        // Empty interval row: shows default activeMaterial discretely
        rows.push({
          id: `bound-${bound}-empty`,
          bound,
          material: activeMaterial,
          count: 0,
          accumulatedLength: 0,
          surface: 0,
          weightEst: 0,
          percent: 0,
          isMultiMaterialBound: false,
          entries: [],
        });
      } else {
        // Group entries for this bound by material
        const materialMap = new Map<string, EncodedEntry[]>();
        for (const entry of boundEntries) {
          const mat = entry.material || activeMaterial;
          if (!materialMap.has(mat)) {
            materialMap.set(mat, []);
          }
          materialMap.get(mat)!.push(entry);
        }

        const distinctMaterials = Array.from(materialMap.keys());
        const isMultiMaterialBound = distinctMaterials.length > 1;

        distinctMaterials.forEach((mat) => {
          const mEntries = materialMap.get(mat)!;
          const count = mEntries.reduce((acc, e) => acc + (e.quantity || 1), 0);
          const accumulatedLength =
            Math.round(
              mEntries.reduce((acc, e) => acc + e.evaluatedLength, 0) * 1000
            ) / 1000;
          const surface = (bound / 1000) * accumulatedLength;
          const density = getMaterialDensity(mat);
          const weightEst = Math.round(surface * density * 10) / 10;
          const percent =
            totalLengthM > 0
              ? Math.round((accumulatedLength / totalLengthM) * 1000) / 10
              : 0;

          rows.push({
            id: `bound-${bound}-${mat}`,
            bound,
            material: mat,
            count,
            accumulatedLength,
            surface,
            weightEst,
            percent,
            isMultiMaterialBound,
            entries: mEntries,
          });
        });
      }
    });

    return rows;
  }, [intervals, entriesHistory, activeMaterial, totalLengthM]);

  // Distinct materials across all encoded entries
  const encodedMaterialsSummary = useMemo(() => {
    const mats = new Set<string>();
    entriesHistory.forEach((e) => {
      if (!e.isChute && e.material) mats.add(e.material);
    });
    return Array.from(mats);
  }, [entriesHistory]);

  // Dynamic estimated weight calculation per material across all interval rows
  const totalWeightEstKg = useMemo(() => {
    return (
      Math.round(
        tableIntervalRows.reduce((acc, row) => acc + row.weightEst, 0) * 10
      ) / 10
    );
  }, [tableIntervalRows]);

  // Discrete material badge helper
  const renderMaterialBadge = (material: string, isRowEmpty = false) => {
    if (isRowEmpty) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-sans text-slate-400 bg-slate-50 border border-slate-200">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0"></span>
          <span className="truncate max-w-[140px]">{material}</span>
        </span>
      );
    }

    const matLower = material.toLowerCase();
    let badgeStyle = 'bg-slate-100 text-slate-700 border-slate-200';
    let dotStyle = 'bg-[#3ca7da]';

    if (matLower.includes('alu') || matLower.includes('aluminium')) {
      badgeStyle = 'bg-[#00478a]/8 text-[#00478a] border-[#00478a]/20';
      dotStyle = 'bg-[#00478a]';
    } else if (matLower.includes('zinc')) {
      if (matLower.includes('rouge')) {
        badgeStyle = 'bg-rose-50 text-rose-800 border-rose-200';
        dotStyle = 'bg-rose-500';
      } else if (matLower.includes('quartz')) {
        badgeStyle = 'bg-[#3ca7da]/10 text-[#00478a] border-[#3ca7da]/30';
        dotStyle = 'bg-[#3ca7da]';
      } else {
        badgeStyle = 'bg-slate-100 text-slate-700 border-slate-300';
        dotStyle = 'bg-slate-500';
      }
    }

    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-sans font-medium border ${badgeStyle}`}
        title={material}
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotStyle}`}></span>
        <span className="truncate max-w-[160px] font-semibold">{material}</span>
      </span>
    );
  };

  return (
    <div className="space-y-4">
      {/* Compact Input & Controls Card */}
      <div className="faco-card bg-white border border-slate-200 rounded-xl p-4 shadow-2xs space-y-3.5">
        {/* Top Toolbar: Material + Mode + Unit + Scan */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-xs font-bold text-[#00478a] flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-[#3ca7da]" />
              <span>Matière :</span>
            </span>

            <select
              aria-label="Sélectionner la matière d'encodage"
              value={STANDARD_MATERIALS.includes(activeMaterial) ? activeMaterial : 'custom'}
              onChange={(e) => {
                if (e.target.value === 'custom') {
                  setIsCustomMaterial(true);
                } else {
                  setIsCustomMaterial(false);
                  setActiveMaterial(e.target.value);
                }
              }}
              className="faco-input bg-[#f8fafc] border border-slate-300 rounded-lg px-3 py-1.5 text-xs font-semibold text-[#282828] focus:outline-none focus:border-[#00478a] cursor-pointer"
            >
              {MATERIAL_GROUPS.map((grp) => (
                <optgroup key={grp.group} label={grp.group}>
                  {grp.items.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.value}
                    </option>
                  ))}
                </optgroup>
              ))}
              {!STANDARD_MATERIALS.includes(activeMaterial) && (
                <option value="custom">Personnalisé : {activeMaterial}</option>
              )}
              {STANDARD_MATERIALS.includes(activeMaterial) && (
                <option value="custom">+ Autre nuance...</option>
              )}
            </select>

            {isCustomMaterial && (
              <input
                type="text"
                autoFocus
                value={activeMaterial}
                onChange={(e) => setActiveMaterial(e.target.value)}
                placeholder="Nuance personnalisée..."
                className="faco-input bg-[#f8fafc] border border-[#00478a] text-[#282828] text-xs rounded-lg px-2.5 py-1 focus:outline-none font-mono w-40"
              />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Unit switch */}
            <div className="flex bg-slate-100 rounded-lg border border-slate-200 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setLengthUnit('m')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  lengthUnit === 'm'
                    ? 'bg-white text-[#00478a] font-semibold shadow-2xs'
                    : 'text-slate-500 hover:text-[#282828]'
                }`}
              >
                m
              </button>
              <button
                type="button"
                onClick={() => setLengthUnit('mm')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  lengthUnit === 'mm'
                    ? 'bg-white text-[#00478a] font-semibold shadow-2xs'
                    : 'text-slate-500 hover:text-[#282828]'
                }`}
              >
                mm
              </button>
            </div>

            {/* Preset switch */}
            <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs">
              <button
                type="button"
                onClick={() => handlePresetChange('DEV_PIECE')}
                className={`px-2.5 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                  preset === 'DEV_PIECE'
                    ? 'bg-[#00478a] text-white shadow-2xs'
                    : 'text-slate-600 hover:text-[#282828]'
                }`}
              >
                Pièce
              </button>
              <button
                type="button"
                onClick={() => handlePresetChange('DEV_BOBINE')}
                className={`px-2.5 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                  preset === 'DEV_BOBINE'
                    ? 'bg-[#00478a] text-white shadow-2xs'
                    : 'text-slate-600 hover:text-[#282828]'
                }`}
              >
                Bobine
              </button>
            </div>

            <button
              type="button"
              onClick={() => setIsVisualModalOpen(true)}
              className="px-3 py-1.5 bg-[#f8fafc] hover:bg-slate-100 text-[#00478a] font-semibold rounded-lg text-xs flex items-center gap-1.5 border border-slate-200 transition-colors cursor-pointer"
              title="Scanner un croquis ou un plan PDF avec l'IA"
            >
              <Camera className="w-3.5 h-3.5 text-[#3ca7da]" />
              <span>Scanner IA</span>
            </button>
          </div>
        </div>

        {/* The 3 Input Fields Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div>
            <label
              htmlFor="caseDev"
              className="text-[11px] font-semibold text-slate-600 block mb-1"
            >
              {preset === 'DEV_BOBINE' ? 'Dév Bobine (mm)' : 'Développement (mm)'}
            </label>
            <input
              id="caseDev"
              ref={devRef}
              type="text"
              value={inputDev}
              onChange={(e) => setInputDev(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (inputDev.includes('/')) {
                    handleSubmitEntry();
                  } else {
                    lengthRef.current?.focus();
                    lengthRef.current?.select();
                  }
                }
              }}
              placeholder={preset === 'DEV_BOBINE' ? 'ex: 650 (0 = chute)' : 'ex: 175'}
              className="faco-input w-full bg-[#f8fafc] border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono font-bold text-[#00478a] placeholder:text-slate-400 focus:outline-none focus:border-[#00478a] focus:bg-white"
            />
          </div>

          <div>
            <label
              htmlFor="caseLength"
              className="text-[11px] font-semibold text-slate-600 block mb-1"
            >
              Longueur ({lengthUnit})
            </label>
            <input
              id="caseLength"
              ref={lengthRef}
              type="text"
              value={inputLength}
              onChange={(e) => setInputLength(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  qtyRef.current?.focus();
                  qtyRef.current?.select();
                }
              }}
              placeholder="ex: 2.0"
              className="faco-input w-full bg-[#f8fafc] border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono font-bold text-[#282828] placeholder:text-slate-400 focus:outline-none focus:border-[#00478a] focus:bg-white"
            />
          </div>

          <div>
            <label
              htmlFor="caseQty"
              className="text-[11px] font-semibold text-slate-600 block mb-1"
            >
              Quantité <span className="text-[10px] font-normal text-slate-400">(0 = métrage auto)</span>
            </label>
            <input
              id="caseQty"
              ref={qtyRef}
              type="number"
              min="0"
              value={inputQuantity}
              onChange={(e) => setInputQuantity(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSubmitEntry();
                }
              }}
              placeholder="ex: 4"
              className="faco-input w-full bg-[#f8fafc] border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono font-bold text-[#282828] placeholder:text-slate-400 focus:outline-none focus:border-[#00478a] focus:bg-white"
            />
          </div>

          <div>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => handleSubmitEntry()}
              className="faco-btn w-full py-2 bg-[#e7511f] hover:bg-[#cf4315] disabled:opacity-50 text-white font-semibold rounded-lg text-sm flex items-center justify-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Calcul...</span>
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  <span>Ajouter</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Live Feedback */}
        {lastFeedback && (
          <div
            className={`px-3 py-2 rounded-lg text-xs flex items-center justify-between gap-2 ${
              lastFeedback.success
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                : 'bg-rose-50 border border-rose-200 text-rose-800'
            }`}
          >
            <div className="flex items-center gap-2">
              {lastFeedback.success ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              )}
              <span>{lastFeedback.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setLastFeedback(null)}
              className="text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {breakdownAlternatives.length > 0 && (
        <div className="bg-white border border-[#3ca7da]/40 rounded-xl p-3 space-y-2 shadow-2xs">
          <div className="text-[11px] font-bold text-[#00478a] uppercase tracking-wider flex items-center justify-between">
            <span>Variantes de calepinage disponibles :</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {breakdownAlternatives.map((alt, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  handleUndoLast();
                  const devToUse = entriesHistory[0]?.dev || 175;
                  processDirectValues(devToUse, alt.length, alt.quantity, `Dév ${devToUse} · ${alt.label}`);
                  setLastFeedback({
                    success: true,
                    message: `Variante appliquée : ${alt.quantity} pcs de ${alt.length}m (Total ${alt.total_produced}m)`,
                  });
                  setBreakdownAlternatives([]);
                }}
                className={`px-2.5 py-1 rounded-md text-xs font-mono transition-all border cursor-pointer ${
                  alt.is_exact
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100'
                    : 'bg-[#f8fafc] border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                {alt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Compact KPI Row */}
      <div
        className={`grid grid-cols-2 ${
          preset === 'DEV_BOBINE' ? 'lg:grid-cols-4' : 'lg:grid-cols-3'
        } gap-3`}
      >
        <div className="faco-card bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            Métrage Total
          </span>
          <div className="mt-0.5 flex items-baseline gap-1">
            <span className="text-xl font-bold font-mono text-[#00478a] tabular-nums">
              {totalLengthM.toFixed(2)}
            </span>
            <span className="text-xs text-slate-500">m</span>
          </div>
        </div>

        <div className="faco-card bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            Pièces
          </span>
          <div className="mt-0.5 flex items-baseline gap-1">
            <span className="text-xl font-bold font-mono text-[#282828] tabular-nums">
              {totalCount}
            </span>
            <span className="text-xs text-slate-500">pcs</span>
          </div>
        </div>

        <div className="faco-card bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs col-span-2 lg:col-span-1">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            Surface & Poids
          </span>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="text-xl font-bold font-mono text-[#282828] tabular-nums">
              {totalSurfaceM2.toFixed(2)} <span className="text-xs font-normal text-slate-500">m²</span>
            </span>
            <span className="text-xs font-mono font-semibold text-[#3ca7da]">
              · {Math.round(totalWeightEstKg * 10) / 10} kg
            </span>
          </div>
        </div>

        {preset === 'DEV_BOBINE' && (
          <div className="faco-card bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              Chutes (Dév 0)
            </span>
            <div className="mt-0.5 flex items-baseline gap-1">
              <span className="text-xl font-bold font-mono text-[#e7511f] tabular-nums">
                {chuteLength.toFixed(2)}
              </span>
              <span className="text-xs text-slate-500">
                m ({chuteCount} pcs)
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Main Table: Accumulated Intervals */}
      <div className="faco-card bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
        <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-[#f8fafc]">
          <div className="flex items-center gap-2">
            <Calculator className="w-4 h-4 text-[#00478a]" />
            <h2 className="text-xs font-bold text-[#00478a] uppercase tracking-wider">
              Cumuls par Borne ({preset === 'DEV_BOBINE' ? 'Bobine' : 'Pièce'})
            </h2>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleUndoLast}
              disabled={entriesHistory.length === 0}
              className="px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-white hover:bg-slate-100 disabled:opacity-40 border border-slate-200 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Annuler</span>
            </button>
            <button
              type="button"
              onClick={handleExportCSV}
              className="px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>CSV</span>
            </button>

            {isConfirmingClear ? (
              <div className="flex items-center gap-1 bg-rose-50 border border-rose-300 rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={handleTriggerClear}
                  className="px-2 py-1 text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 rounded-md transition-colors cursor-pointer"
                >
                  Confirmer
                </button>
                <button
                  type="button"
                  onClick={handleCancelClear}
                  className="p-1 text-slate-500 hover:text-slate-800 cursor-pointer"
                  title="Annuler"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleTriggerClear}
                className="px-2.5 py-1.5 text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Vider</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleTransfer}
              className="px-3.5 py-1.5 bg-[#00478a] hover:bg-[#003566] text-white font-semibold rounded-lg text-xs flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
            >
              <span>Optimiser le Débit</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div
          tabIndex={0}
          role="region"
          aria-label="Cumuls par borne de développement"
          className="table-wrapper"
        >
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 text-slate-600 font-semibold border-b border-slate-200 uppercase tracking-wider text-[11px]">
              <tr>
                <th className="py-2.5 px-4">Borne (mm)</th>
                <th className="py-2.5 px-4">Matière</th>
                <th className="py-2.5 px-4">Détail</th>
                <th className="py-2.5 px-4 text-right">Qté</th>
                <th className="py-2.5 px-4 text-right">Cumul (m)</th>
                <th className="py-2.5 px-4 text-right">Part</th>
                <th className="py-2.5 px-4 text-right">Poids</th>
                <th className="py-2.5 px-4 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {tableIntervalRows.map((row) => {
                const isHighlighted =
                  lastFeedback?.boundMatched === row.bound &&
                  row.accumulatedLength > 0;

                return (
                  <tr
                    key={row.id}
                    className={`transition-colors ${
                      isHighlighted
                        ? 'bg-[#3ca7da]/10 font-semibold'
                        : row.accumulatedLength > 0
                        ? 'bg-white hover:bg-slate-50/80'
                        : 'bg-[#f8fafc]/50 hover:bg-slate-50 text-slate-400'
                    }`}
                  >
                    <td className="py-2 px-4 font-bold text-[#282828]">
                      <div className="flex items-center gap-1.5">
                        <span className="tabular-nums">{row.bound}</span> mm
                      </div>
                    </td>
                    <td className="py-2 px-4">
                      {renderMaterialBadge(row.material, row.count === 0)}
                    </td>
                    <td className="py-2 px-4 text-[11px]">
                      {preset === 'DEV_BOBINE' && row.count === 0 ? (
                        <span className="font-sans text-slate-400">
                          {row.bound === 600 && 'Zinc : Naturel · ATZ · Quartz'}
                          {row.bound === 650 && 'Alu 0.7 : RAL 7016 · 9005 · 9010 · 7039'}
                          {row.bound === 670 && 'Zinc : Naturel · ATZ · Quartz · Pigmento Rouge'}
                          {row.bound === 750 && 'Zinc : Naturel · ATZ · Quartz · Pigmento Rouge'}
                          {row.bound === 1000 && 'Zinc & Alu : toutes nuances'}
                          {row.bound === 1100 && 'Zinc : Naturel · ATZ · Quartz · Pigmento Rouge'}
                        </span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {row.entries.map((entry) => (
                            <span
                              key={entry.id}
                              className="inline-flex items-center gap-1 text-[10px] font-mono text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200"
                            >
                              <span className="font-semibold text-[#00478a]">
                                {entry.dev}mm
                              </span>
                              <span className="text-slate-500">
                                ({entry.quantity}×{entry.unitLength}m)
                              </span>
                            </span>
                          ))}
                          {row.count === 0 && <span className="text-slate-300">-</span>}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums">
                      {row.count > 0 ? (
                        <span className="text-[#282828] font-semibold">{row.count}</span>
                      ) : (
                        <span className="text-slate-300">-</span>
                      )}
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums font-bold text-xs">
                      {row.accumulatedLength > 0 ? (
                        <span className="text-[#00478a]">
                          {row.accumulatedLength.toFixed(2)} m
                        </span>
                      ) : (
                        <span className="text-slate-300">0.00 m</span>
                      )}
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums text-slate-500">
                      {row.accumulatedLength > 0 ? `${row.percent}%` : '-'}
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums text-slate-600 font-medium">
                      {row.accumulatedLength > 0 ? `${row.weightEst} kg` : '-'}
                    </td>
                    <td className="py-2 px-4 text-right">
                      {row.accumulatedLength > 0 && (
                        <button
                          type="button"
                          onClick={() => handleResetIntervalRow(row.bound, row.material)}
                          className="p-1 text-slate-400 hover:text-rose-600 transition-colors rounded cursor-pointer"
                          title="Remettre à zéro"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}

              {preset === 'DEV_BOBINE' && (
                <tr className="bg-amber-50/50 text-amber-900 border-t border-amber-200">
                  <td className="py-2.5 px-4 font-bold">0 (CHUTES)</td>
                  <td className="py-2.5 px-4">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-sans text-amber-800 bg-amber-100 border border-amber-200">
                      Chutes
                    </span>
                  </td>
                  <td className="py-2.5 px-4 font-sans text-slate-500 text-[11px]">
                    Chutes répertoriées
                  </td>
                  <td className="py-2.5 px-4 text-right tabular-nums font-bold">
                    {chuteCount}
                  </td>
                  <td className="py-2.5 px-4 text-right tabular-nums font-bold text-[#e7511f]">
                    {chuteLength.toFixed(2)} m
                  </td>
                  <td className="py-2.5 px-4 text-right">-</td>
                  <td className="py-2.5 px-4 text-right">-</td>
                  <td className="py-2.5 px-4 text-right">
                    {chuteLength > 0 && (
                      <button
                        type="button"
                        onClick={handleResetChutes}
                        className="p-1 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot className="bg-slate-100 text-[#282828] font-bold border-t border-slate-200">
              <tr>
                <td className="py-2.5 px-4 uppercase text-[11px] tracking-wider text-[#00478a]">
                  Total
                </td>
                <td className="py-2.5 px-4 text-slate-500 font-sans text-[11px]">
                  {encodedMaterialsSummary.length > 1
                    ? `${encodedMaterialsSummary.length} matières`
                    : activeMatDetails.shortLabel}
                </td>
                <td className="py-2.5 px-4 text-slate-600 font-mono text-[11px]">
                  {totalSurfaceM2.toFixed(2)} m²
                </td>
                <td className="py-2.5 px-4 text-right font-mono text-[#282828] tabular-nums">
                  {totalCount} pcs
                </td>
                <td className="py-2.5 px-4 text-right font-mono text-[#00478a] tabular-nums text-sm">
                  {totalLengthM.toFixed(2)} m
                </td>
                <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-500">100%</td>
                <td className="py-2.5 px-4 text-right font-mono tabular-nums text-[#00478a]">
                  {Math.round(totalWeightEstKg * 10) / 10} kg
                </td>
                <td className="py-2.5 px-4"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Workshop Numpad Calculator Widget */}
      <WorkshopCalculator
        onInsertDev={(dev) => {
          setInputDev(dev.toString());
          devRef.current?.focus();
        }}
        onInsertLength={(len) => {
          setInputLength(len.toString());
          lengthRef.current?.focus();
        }}
        onInsertQty={(qty) => {
          setInputQuantity(qty.toString());
          qtyRef.current?.focus();
        }}
        onDirectAddEntry={(dev) => {
          handleSubmitEntry(dev.toString(), inputLength || '2.0', inputQuantity || '1');
        }}
      />

      <VisualPreEncoderModal
        isOpen={isVisualModalOpen}
        onClose={() => setIsVisualModalOpen(false)}
        onImportPieces={handleImportPiecesFromVisual}
        targetMode="calculator"
        currentDefaultMaterial={activeMaterial}
      />

      {/* Compact History Log */}
      {entriesHistory.length > 0 && (
        <div className="faco-card bg-white border border-slate-200 rounded-xl p-4 space-y-2.5 shadow-2xs">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#00478a] flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-[#3ca7da]" />
              <span>Historique des Saisies ({entriesHistory.length})</span>
            </h3>

            <button
              type="button"
              onClick={() => handleApplyActiveMaterialToAll()}
              className="px-2.5 py-1 text-[11px] font-medium text-[#00478a] bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer"
            >
              Tout passer en "{activeMaterial}"
            </button>
          </div>

          <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
            {entriesHistory.map((item) => {
              const itemMat = item.material || activeMaterial;
              return (
                <div
                  key={item.id}
                  className="py-1.5 flex items-center justify-between gap-2 text-xs hover:bg-slate-50 px-2 rounded transition-colors"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] text-slate-400 font-mono">
                      {item.timestamp}
                    </span>
                    <span className="font-mono bg-[#f8fafc] px-2 py-0.5 rounded border border-slate-200 text-[#00478a] font-semibold">
                      {item.dev} mm · {item.quantity} × {item.unitLength}m
                    </span>

                    <select
                      aria-label="Modifier la matière de cette ligne"
                      value={STANDARD_MATERIALS.includes(itemMat) ? itemMat : 'custom'}
                      onChange={(e) => {
                        if (e.target.value !== 'custom') {
                          handleUpdateEntryMaterial(item.id, e.target.value);
                        }
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
                      {!STANDARD_MATERIALS.includes(itemMat) && (
                        <option value="custom">{itemMat}</option>
                      )}
                    </select>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[#282828] tabular-nums font-bold">
                      +{item.evaluatedLength.toFixed(2)} m
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDeleteHistoryEntry(item.id)}
                      className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors cursor-pointer"
                      title="Supprimer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
