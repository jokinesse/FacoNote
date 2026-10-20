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
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-sans text-slate-500 bg-slate-950/40 border border-slate-800/80">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-600 shrink-0"></span>
          <span className="truncate max-w-[140px]">{material}</span>
        </span>
      );
    }

    const matLower = material.toLowerCase();
    let badgeStyle = 'bg-slate-800 text-slate-200 border-slate-700';
    let dotStyle = 'bg-cyan-400';

    if (matLower.includes('alu') || matLower.includes('aluminium')) {
      if (matLower.includes('noir') || matLower.includes('9005')) {
        badgeStyle = 'bg-black/80 text-amber-200 border-slate-700';
        dotStyle = 'bg-amber-400';
      } else if (matLower.includes('7016') || matLower.includes('anthracite')) {
        badgeStyle = 'bg-slate-900 text-slate-200 border-slate-600';
        dotStyle = 'bg-slate-400';
      } else if (matLower.includes('9010') || matLower.includes('blanc')) {
        badgeStyle = 'bg-slate-800 text-white border-slate-500';
        dotStyle = 'bg-white';
      } else {
        badgeStyle = 'bg-slate-900 text-amber-300 border-amber-500/30';
        dotStyle = 'bg-amber-400';
      }
    } else if (matLower.includes('cuivre')) {
      badgeStyle = 'bg-orange-950/50 text-orange-200 border-orange-800/60';
      dotStyle = 'bg-orange-400';
    } else if (matLower.includes('plomb')) {
      badgeStyle = 'bg-slate-800/90 text-slate-300 border-slate-600';
      dotStyle = 'bg-slate-400';
    } else if (matLower.includes('zinc')) {
      if (matLower.includes('quartz')) {
        badgeStyle = 'bg-slate-800 text-cyan-200 border-cyan-800/50';
        dotStyle = 'bg-cyan-400';
      } else if (matLower.includes('atz') || matLower.includes('anthra')) {
        badgeStyle = 'bg-slate-900 text-slate-300 border-slate-700';
        dotStyle = 'bg-zinc-400';
      } else {
        badgeStyle = 'bg-slate-800 text-slate-200 border-slate-700';
        dotStyle = 'bg-slate-300';
      }
    }

    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-sans font-medium border shadow-xs ${badgeStyle}`}
        title={`Matière pour cette ligne : ${material}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotStyle}`}></span>
        <span className="truncate max-w-[160px] font-semibold">{material}</span>
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Explanation */}
      <div className="bg-slate-800/80 border border-slate-700/80 rounded-xl p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
                Portage Google Sheet Atelier Facozinc
              </span>
              <span className="text-slate-500">·</span>
              <span className="text-xs text-slate-400">Calcul & Accumulation Directe</span>
            </div>
            <h1 className="text-xl font-bold text-white mt-1">
              Calculateur & Accumulateur de Développement
            </h1>
            <p className="text-xs text-slate-300 mt-1 max-w-2xl">
              Renseignez les <strong className="text-amber-300">3 cases</strong> ci-dessous :{' '}
              <span className="text-amber-300">Développement</span>,{' '}
              <span className="text-amber-300">Longueur</span> et{' '}
              <span className="text-amber-300">Nombre de pièces</span> (ex:{' '}
              <code className="bg-slate-900 px-1 py-0.5 rounded text-amber-400 font-mono">
                175 mm · 3.0 m · 8 pièces = 24.0 m
              </code>
              ). Les métrages sont automatiquement cumulés dans la borne standard correspondante.
            </p>
          </div>

          {/* Segmented Control Presets & Visual Scanner */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsVisualModalOpen(true)}
              className="px-3.5 py-1.5 bg-gradient-to-r from-amber-500/20 to-amber-500/10 hover:from-amber-500/30 text-amber-300 hover:text-white font-bold rounded-lg text-xs flex items-center gap-2 border border-amber-500/40 transition-colors shadow-sm whitespace-nowrap"
              title="Photographier un croquis ou un plan PDF pour extraire automatiquement les pièces"
            >
              <Camera className="w-4 h-4 text-amber-400" />
              <span>Scanner Croquis / Photo (IA)</span>
            </button>

            <div className="flex items-center gap-1.5 bg-slate-900/90 p-1.5 rounded-lg border border-slate-700">
              <button
                onClick={() => handlePresetChange('DEV_PIECE')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  preset === 'DEV_PIECE'
                    ? 'bg-amber-500 text-slate-950 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                DEV PIÈCE
              </button>
              <button
                onClick={() => handlePresetChange('DEV_BOBINE')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  preset === 'DEV_BOBINE'
                    ? 'bg-amber-500 text-slate-950 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                DEV BOBINE
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 3-Box Fast Input Card (Dév / Longueur / Nombre de pièces) */}
      <div className="bg-slate-900 border border-slate-700/80 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <Hash className="w-3.5 h-3.5 text-amber-400" />
            <span>Saisie en 3 Cases (Dév · Longueur · Nombre de Pièces)</span>
          </label>

          <div className="flex items-center gap-3 text-xs">
            <span className="text-slate-400">Unité longueur :</span>
            <div className="flex bg-slate-950 rounded border border-slate-700 p-0.5">
              <button
                type="button"
                onClick={() => setLengthUnit('m')}
                className={`px-2.5 py-0.5 rounded text-xs font-medium transition-colors ${
                  lengthUnit === 'm'
                    ? 'bg-slate-800 text-amber-400 font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Mètres (m)
              </button>
              <button
                type="button"
                onClick={() => setLengthUnit('mm')}
                className={`px-2.5 py-0.5 rounded text-xs font-medium transition-colors ${
                  lengthUnit === 'mm'
                    ? 'bg-slate-800 text-amber-400 font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Millimètres (mm)
              </button>
            </div>
          </div>
        </div>

        {/* Simplified Material Selector */}
        <div className="bg-slate-950/70 border border-slate-800 rounded-lg px-3.5 py-2 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-amber-400" />
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
              className="bg-slate-900 border border-slate-700 rounded-md px-3 py-1 text-xs font-mono font-bold text-amber-300 focus:outline-none focus:border-amber-400 shadow-sm"
            >
              <optgroup label="Zinc">
                <option value="Zinc Quartz 0.7">Zinc Quartz 0.7</option>
                <option value="Zinc Naturel 0.7">Zinc Naturel 0.7</option>
                <option value="Zinc ATZ (Anthra) 0.7">Zinc ATZ 0.7</option>
                <option value="Zinc Quartz 0.8">Zinc Quartz 0.8</option>
                <option value="Zinc Naturel 0.8">Zinc Naturel 0.8</option>
                <option value="Zinc ATZ 0.8">Zinc ATZ 0.8</option>
              </optgroup>
              <optgroup label="Aluminium (0.7 mm)">
                <option value="Alu Anthracite RAL 7016 0.7">Alu Anthracite 7016 (0.7 mm)</option>
                <option value="Alu Noir RAL 9005 0.7">Alu Noir 9005 (0.7 mm)</option>
                <option value="Alu Blanc RAL 9010 0.7">Alu Blanc 9010 (0.7 mm)</option>
                <option value="Alu QZ (Quartz) 0.7">Alu Quartz QZ (0.7 mm)</option>
              </optgroup>
              <optgroup label="Autres métaux">
                <option value="Cuivre 0.6">Cuivre 0.6</option>
                <option value="Plomb 1.25">Plomb 1.25</option>
              </optgroup>
              {!STANDARD_MATERIALS.includes(activeMaterial) && (
                <option value="custom">Personnalisé : {activeMaterial}</option>
              )}
              {STANDARD_MATERIALS.includes(activeMaterial) && (
                <option value="custom">+ Autre nuance personnalisée...</option>
              )}
            </select>

            {isCustomMaterial && (
              <input
                type="text"
                autoFocus
                value={activeMaterial}
                onChange={(e) => setActiveMaterial(e.target.value)}
                placeholder="ex: Inox 0.8, Zinc Prépatiné..."
                className="bg-slate-900 border border-amber-500/70 text-amber-300 text-xs rounded-md px-2.5 py-1 focus:outline-none focus:border-amber-400 font-mono w-44"
              />
            )}
          </div>

          {/* Quick 1-click pills for direct switching */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-[11px] text-slate-400 hidden sm:inline">Accès rapide :</span>
            {[
              { label: 'Zinc Quartz 0.7', val: 'Zinc Quartz 0.7' },
              { label: 'Zinc Naturel 0.7', val: 'Zinc Naturel 0.7' },
              { label: 'Alu 7016 (0.7)', val: 'Alu Anthracite RAL 7016 0.7' },
              { label: 'Alu Noir (0.7)', val: 'Alu Noir RAL 9005 0.7' },
            ].map(({ label, val }) => (
              <button
                key={val}
                type="button"
                onClick={() => {
                  setIsCustomMaterial(false);
                  setActiveMaterial(val);
                }}
                className={`px-2 py-0.5 rounded text-[11px] font-mono transition-all ${
                  activeMaterial === val
                    ? 'bg-amber-400 text-slate-950 font-bold shadow-sm'
                    : 'bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/80'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* The 3 Input Fields Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          {/* Case 1: Dév (mm) */}
          <div className="sm:col-span-1">
            <label
              htmlFor="caseDev"
              className="text-[11px] font-bold text-amber-300 uppercase tracking-wider block mb-1.5"
            >
              {preset === 'DEV_BOBINE' ? '1. Dév Bobine (mm)' : '1. Dév Pièce (mm)'}
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
              placeholder={preset === 'DEV_BOBINE' ? 'ex: 650 (ou 0 = chute)' : 'ex: 175 (ou 200, 250...)'}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-base font-mono font-bold text-amber-300 placeholder:text-slate-600 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
            />
            <span className="text-[10px] text-slate-500 mt-1 block">
              {preset === 'DEV_BOBINE'
                ? 'Largeur de fente ou 0 pour les chutes'
                : 'Largeur développée à plat (mm)'}
            </span>
          </div>

          {/* Case 2: Longueur */}
          <div className="sm:col-span-1">
            <label
              htmlFor="caseLength"
              className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block mb-1.5"
            >
              2. Longueur ({lengthUnit})
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
              placeholder="ex: 3 ou 2.5 ou 1.5+1.5"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-base font-mono font-bold text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
            />
            <span className="text-[10px] text-slate-500 mt-1 block">
              Longueur d'une pièce
            </span>
          </div>

          {/* Case 3: Nombre de pièces */}
          <div className="sm:col-span-1">
            <label
              htmlFor="caseQty"
              className="text-[11px] font-bold text-amber-400 uppercase tracking-wider block mb-1.5"
            >
              3. Nombre de Pièces
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
              placeholder="ex: 8 (ou 0 = auto)"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-base font-mono font-bold text-amber-400 placeholder:text-slate-600 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
            />
            <span className="text-[10px] text-slate-500 mt-1 block">
              Quantité (0 = auto-calepinage du métrage)
            </span>
          </div>

          {/* Action Button: Valider */}
          <div className="sm:col-span-1">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => handleSubmitEntry()}
              className="w-full py-2.5 bg-amber-400 hover:bg-amber-300 active:bg-amber-500 disabled:opacity-50 text-slate-950 font-bold rounded-lg text-sm flex items-center justify-center gap-2 transition-colors shadow-sm cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  <span>Calcul API...</span>
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  <span>Valider [Entrée]</span>
                </>
              )}
            </button>
            <span className="text-[10px] text-slate-500 mt-1 block text-center">
              Total : {((parseFloat(inputLength) || 0) * (parseInt(inputQuantity, 10) || 0)).toFixed(2)}m
            </span>
          </div>
        </div>

        {/* Quick Shortcut Buttons */}
        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
          <span className="text-slate-400 text-[11px] font-medium">
            Raccourcis rapides :
          </span>
          {preset === 'DEV_BOBINE' ? (
            <>
              <button
                type="button"
                onClick={() => handleQuickPreset(600, '12.0', '1')}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-amber-300 rounded font-mono border border-slate-700/60"
                title="Zinc ZN, QZ, ATZ : 600 mm"
              >
                600mm (Zinc ZN/QZ/ATZ)
              </button>
              <button
                type="button"
                onClick={() => handleQuickPreset(650, '10.0', '1')}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-amber-300 rounded font-mono border border-slate-700/60"
                title="Alu Noir, Blanc, 7016, QZ : 650 mm"
              >
                650mm (Alu Noir/Blanc/7016/QZ)
              </button>
              <button
                type="button"
                onClick={() => handleQuickPreset(670, '12.0', '1')}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-amber-300 rounded font-mono border border-slate-700/60"
                title="Zinc ZN, QZ, ATZ : 670 mm"
              >
                670mm (Zinc ZN/QZ/ATZ)
              </button>
              <button
                type="button"
                onClick={() => handleQuickPreset(750, '12.0', '1')}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-amber-300 rounded font-mono border border-slate-700/60"
                title="Zinc ZN, QZ, ATZ : 750 mm"
              >
                750mm (Zinc ZN/QZ/ATZ)
              </button>
              <button
                type="button"
                onClick={() => handleQuickPreset(1000, '6.0', '1')}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-amber-300 rounded font-mono border border-slate-700/60"
                title="Zinc ZN/QZ/ATZ & Alu : 1000 mm"
              >
                1000mm (Zinc & Alu)
              </button>
              <button
                type="button"
                onClick={() => handleQuickPreset(1100, '6.0', '1')}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-amber-300 rounded font-mono border border-slate-700/60"
                title="Zinc ZN, QZ, ATZ : 1100 mm"
              >
                1100mm (Zinc ZN/QZ/ATZ)
              </button>
              <button
                type="button"
                onClick={() => handleQuickPreset(0, '3.5', '1')}
                className="px-2.5 py-1 bg-amber-950/40 hover:bg-amber-900/50 text-amber-300 rounded font-mono border border-amber-800/40"
              >
                0mm (Chute)
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => handleQuickPreset(175, '3.0', '8')}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-amber-300 rounded font-mono border border-slate-700/60"
                title="Dév 175mm · 8 pcs × 3m = 24m"
              >
                175mm · 8 pcs × 3m (24m)
              </button>
              <button
                type="button"
                onClick={() => handleQuickPreset(250, '2.0', '6')}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-amber-300 rounded font-mono border border-slate-700/60"
              >
                250mm · 6 pcs × 2m (12m)
              </button>
              <button
                type="button"
                onClick={() => handleQuickPreset(333, '2.0', '10')}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-amber-300 rounded font-mono border border-slate-700/60"
              >
                333mm · 10 pcs × 2m (20m)
              </button>
              <button
                type="button"
                onClick={() => handleQuickPreset(500, '3.0', '4')}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-amber-300 rounded font-mono border border-slate-700/60"
              >
                500mm · 4 pcs × 3m (12m)
              </button>
              <button
                type="button"
                onClick={() => handleQuickPreset(600, '2.0', '4')}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-amber-300 rounded font-mono border border-slate-700/60"
              >
                600mm · 4 pcs × 2m (8m)
              </button>
            </>
          )}
        </div>

        {/* Live Feedback Banner */}
        {lastFeedback && (
          <div
            className={`p-3 rounded-lg text-xs flex items-center justify-between gap-2.5 transition-all ${
              lastFeedback.success
                ? 'bg-emerald-950/40 border border-emerald-800/50 text-emerald-300'
                : 'bg-rose-950/40 border border-rose-800/50 text-rose-300'
            }`}
          >
            <div className="flex items-center gap-2">
              {lastFeedback.success ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              )}
              <span>{lastFeedback.message}</span>
            </div>
            <button
              onClick={() => setLastFeedback(null)}
              className="text-slate-400 hover:text-white"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {breakdownAlternatives.length > 0 && (
          <div className="bg-slate-950/80 border border-amber-500/30 rounded-lg p-3 space-y-2">
            <div className="text-[11px] font-bold text-amber-300 uppercase tracking-wider flex items-center justify-between">
              <span>Variantes d'auto-calepinage calculées par l'API FastAPI :</span>
              <span className="text-[10px] text-slate-400 font-normal">Cliquez sur une variante pour l'appliquer</span>
            </div>
            <div className="flex flex-wrap gap-2">
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
                  className={`px-2.5 py-1 rounded text-xs font-mono transition-all border cursor-pointer ${
                    alt.is_exact
                      ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300 hover:bg-emerald-900/60'
                      : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {alt.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {/* Summary KPI Strip */}
      <div
        className={`grid grid-cols-1 sm:grid-cols-2 ${
          preset === 'DEV_BOBINE' ? 'lg:grid-cols-4' : 'lg:grid-cols-3'
        } gap-4`}
      >
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
            Longueur Totale Pièces
          </span>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold font-mono text-white tabular-nums">
              {totalLengthM.toFixed(2)}
            </span>
            <span className="text-xs text-slate-400">m</span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
            Nombre de Pièces Façonnées
          </span>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold font-mono text-amber-400 tabular-nums">
              {totalCount}
            </span>
            <span className="text-xs text-slate-400">pièces</span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
            Surface Utile Développée
          </span>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold font-mono text-white tabular-nums">
              {totalSurfaceM2.toFixed(2)}
            </span>
            <span className="text-xs text-slate-400">m²</span>
          </div>
          <span className="text-[10px] text-amber-300 font-mono block mt-1">
            Poids est. {activeMatDetails.shortLabel} : {Math.round(totalWeightEstKg * 10) / 10} kg
          </span>
        </div>

        {/* 4th box ONLY in DEV_BOBINE mode */}
        {preset === 'DEV_BOBINE' && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
              Chutes Répertoriées (Dév 0)
            </span>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-2xl font-bold font-mono text-amber-300 tabular-nums">
                {chuteLength.toFixed(2)}
              </span>
              <span className="text-xs text-slate-400">
                m ({chuteCount} pcs)
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Main Table: Accumulated Intervals */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-950/50">
          <div>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Calculator className="w-4 h-4 text-amber-400" />
              <span>
                Tableau des Cumuls par Borne de Développement ({preset})
              </span>
            </h2>
            <span className="text-xs text-slate-400">
              Additionne automatiquement les pièces dans leur intervalle standard
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleUndoLast}
              disabled={entriesHistory.length === 0}
              className="px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 rounded-md transition-colors flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Annuler dernier</span>
            </button>
            <button
              onClick={handleExportCSV}
              className="px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-md transition-colors flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>

            {/* Clear All Button with Inline Confirmation (Never fails in iframe) */}
            {isConfirmingClear ? (
              <div className="flex items-center gap-1.5 bg-rose-950/60 border border-rose-600 rounded-md p-1">
                <button
                  type="button"
                  onClick={handleTriggerClear}
                  className="px-2.5 py-1 text-xs font-bold text-white bg-rose-600 hover:bg-rose-500 rounded transition-colors"
                >
                  Confirmer le vidage ?
                </button>
                <button
                  type="button"
                  onClick={handleCancelClear}
                  className="p-1 text-slate-400 hover:text-white"
                  title="Annuler"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleTriggerClear}
                className="px-3 py-1.5 text-xs font-medium text-rose-300 bg-rose-950/30 hover:bg-rose-900/40 border border-rose-800/40 rounded-md transition-colors flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Vider le tableau</span>
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 text-slate-400 font-semibold border-b border-slate-800 uppercase tracking-wider text-[11px]">
              <tr>
                <th className="py-3 px-4">Borne Dév (mm)</th>
                <th className="py-3 px-4">Matière</th>
                <th className="py-3 px-4">
                  {preset === 'DEV_BOBINE' ? 'Nuances / Pièces' : 'Détail Pièces & Surface'}
                </th>
                <th className="py-3 px-4 text-right">Nb Pièces</th>
                <th className="py-3 px-4 text-right">Longueur Cumulée (m)</th>
                <th className="py-3 px-4 text-right">Part (%)</th>
                <th className="py-3 px-4 text-right">Poids Est. (kg)</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {tableIntervalRows.map((row) => {
                const isHighlighted =
                  lastFeedback?.boundMatched === row.bound &&
                  row.accumulatedLength > 0;

                return (
                  <tr
                    key={row.id}
                    className={`transition-colors ${
                      isHighlighted
                        ? 'bg-amber-950/30 font-semibold'
                        : row.accumulatedLength > 0
                        ? 'bg-slate-800/30 hover:bg-slate-800/50'
                        : 'hover:bg-slate-950/30 text-slate-400'
                    }`}
                  >
                    <td className="py-2.5 px-4 font-bold text-white">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="tabular-nums">{row.bound}</span> mm
                        {row.isMultiMaterialBound && (
                          <span
                            className="text-[9px] font-sans font-medium text-amber-300 bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 rounded"
                            title="Cet intervalle contient des pièces de matières différentes découpées sur des feuilles/bobines distinctes"
                          >
                            multi-matière
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-4">
                      {renderMaterialBadge(row.material, row.count === 0)}
                    </td>
                    <td className="py-2.5 px-4 text-[11px]">
                      {preset === 'DEV_BOBINE' && row.count === 0 ? (
                        <span className="font-sans font-medium text-amber-300/80">
                          {row.bound === 600 && 'Zinc : ZN · QZ · ATZ'}
                          {row.bound === 650 && 'Alu : Noir · Blanc · RAL 7016 · QZ'}
                          {row.bound === 670 && 'Zinc : ZN · QZ · ATZ'}
                          {row.bound === 750 && 'Zinc : ZN · QZ · ATZ'}
                          {row.bound === 1000 && 'Zinc & Alu : ZN · QZ · ATZ · Noir · Blanc · 7016'}
                          {row.bound === 1100 && 'Zinc : ZN · QZ · ATZ'}
                        </span>
                      ) : (
                        <div className="space-y-1">
                          {row.accumulatedLength > 0 && (
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-slate-200 font-bold">
                                {row.surface.toFixed(2)} m²
                              </span>
                              <span className="text-[10px] text-slate-500 font-sans">
                                (surface développée brute)
                              </span>
                            </div>
                          )}
                          {row.entries.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5">
                              {row.entries.map((entry) => {
                                const entryMat = entry.material || row.material;
                                return (
                                  <span
                                    key={entry.id}
                                    className="inline-flex items-center gap-1.5 text-[10px] font-mono text-slate-200 bg-slate-950 px-2 py-0.5 rounded border border-slate-800 shadow-xs"
                                    title={`${entry.rawInput} · Matière : ${entryMat}`}
                                  >
                                    <span className="font-semibold text-amber-300">
                                      Dév {entry.dev}mm
                                    </span>
                                    <span className="text-slate-400">
                                      ({entry.quantity}×{entry.unitLength}m)
                                    </span>
                                  </span>
                                );
                              })}
                            </div>
                          )}
                          {row.count === 0 && (
                            <span className="font-mono text-slate-600">-</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right tabular-nums">
                      {row.count > 0 ? (
                        <span className="text-amber-400 font-semibold">{row.count}</span>
                      ) : (
                        <span className="text-slate-600">-</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right tabular-nums font-bold text-white text-sm">
                      {row.accumulatedLength > 0 ? (
                        <span className="text-amber-300">
                          {row.accumulatedLength.toFixed(2)} m
                        </span>
                      ) : (
                        <span className="text-slate-600">0.00 m</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right tabular-nums text-slate-400">
                      {row.accumulatedLength > 0 ? `${row.percent}%` : '-'}
                    </td>
                    <td className="py-2.5 px-4 text-right tabular-nums text-slate-300 font-medium">
                      {row.accumulatedLength > 0 ? `${row.weightEst} kg` : '-'}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      {row.accumulatedLength > 0 && (
                        <button
                          type="button"
                          onClick={() => handleResetIntervalRow(row.bound, row.material)}
                          className="p-1 text-slate-500 hover:text-rose-400 transition-colors rounded"
                          title={`Remettre la borne ${row.bound}mm (${row.material}) à zéro`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}

              {/* Special Chutes Row (Only rendered in DEV_BOBINE mode) */}
              {preset === 'DEV_BOBINE' && (
                <tr className="bg-amber-950/20 text-amber-200 border-t-2 border-amber-800/40">
                  <td className="py-3 px-4 font-bold">0 (CHUTES / REBUTS)</td>
                  <td className="py-3 px-4">
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-sans text-amber-300/80 bg-amber-500/10 border border-amber-500/20">
                      Chutes Atelier
                    </span>
                  </td>
                  <td className="py-3 px-4 font-sans text-amber-300/80 text-[11px]">
                    Accumulation des morceaux perdus ou chutes (dev = 0)
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums font-bold">
                    {chuteCount}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums font-bold text-amber-400 text-sm">
                    {chuteLength.toFixed(2)} m
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums text-amber-400/80">
                    -
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums text-amber-400/80">
                    -
                  </td>
                  <td className="py-3 px-4 text-right">
                    {chuteLength > 0 && (
                      <button
                        type="button"
                        onClick={handleResetChutes}
                        className="p-1 text-slate-500 hover:text-rose-400 transition-colors"
                        title="Remettre les chutes à zéro"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot className="bg-slate-950 text-white font-bold border-t border-slate-700">
              <tr>
                <td className="py-3 px-4 uppercase text-[11px] tracking-wider">
                  Total Cumulé
                </td>
                <td className="py-3 px-4 text-slate-400 font-sans text-[11px]">
                  {encodedMaterialsSummary.length > 1 ? (
                    <span className="text-amber-300 font-medium">
                      {encodedMaterialsSummary.length} matières
                    </span>
                  ) : (
                    activeMatDetails.shortLabel
                  )}
                </td>
                <td className="py-3 px-4 text-slate-300 font-mono text-[11px]">
                  {totalSurfaceM2.toFixed(2)} m²
                </td>
                <td className="py-3 px-4 text-right font-mono text-amber-400 tabular-nums">
                  {totalCount} pièces
                </td>
                <td className="py-3 px-4 text-right font-mono text-amber-300 tabular-nums text-base">
                  {totalLengthM.toFixed(2)} m
                </td>
                <td className="py-3 px-4 text-right font-mono tabular-nums">100%</td>
                <td className="py-3 px-4 text-right font-mono tabular-nums text-amber-300 font-bold">
                  {Math.round(totalWeightEstKg * 10) / 10} kg
                </td>
                <td className="py-3 px-4"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Workshop Numpad Calculator Widget (Under the Table) */}
      <WorkshopCalculator
        onInsertDev={(dev) => {
          setInputDev(dev.toString());
          devRef.current?.focus();
          setLastFeedback({
            success: true,
            message: `Développement mis à jour depuis la calculatrice : ${dev} mm`,
          });
        }}
        onInsertLength={(len) => {
          setInputLength(len.toString());
          lengthRef.current?.focus();
          setLastFeedback({
            success: true,
            message: `Longueur mise à jour depuis la calculatrice : ${len} m`,
          });
        }}
        onInsertQty={(qty) => {
          setInputQuantity(qty.toString());
          qtyRef.current?.focus();
          setLastFeedback({
            success: true,
            message: `Quantité mise à jour depuis la calculatrice : ${qty} pcs`,
          });
        }}
        onDirectAddEntry={(dev) => {
          handleSubmitEntry(dev.toString(), inputLength || '2.0', inputQuantity || '1');
        }}
      />

      {/* Visual Pre-Encoder Modal */}
      <VisualPreEncoderModal
        isOpen={isVisualModalOpen}
        onClose={() => setIsVisualModalOpen(false)}
        onImportPieces={handleImportPiecesFromVisual}
        targetMode="calculator"
        currentDefaultMaterial={activeMaterial}
      />


      {/* Bottom Action: Push to Optimize */}
      <div className="bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/30 rounded-xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-white">
            Prêt à lancer l'optimisation de débit ?
          </h3>
          <p className="text-xs text-slate-300 mt-0.5">
            Transférez directement toutes ces longueurs encodées vers l'optimiseur
            pour calculer le plan de refente, la matière brute nécessaire et la valorisation des chutes.
          </p>
        </div>

        <button
          onClick={handleTransfer}
          className="px-5 py-2.5 bg-amber-400 hover:bg-amber-300 active:bg-amber-500 text-slate-950 font-bold rounded-lg text-xs flex items-center gap-2 transition-colors whitespace-nowrap shadow-sm shrink-0"
        >
          <span>Lancer l'Optimisation Matière</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* History Log with Individual Material Change & Delete */}
      {entriesHistory.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-amber-400" />
                <span>Journal des Saisies Directes ({entriesHistory.length})</span>
              </h3>
              <span className="text-[11px] text-slate-500">
                Vous pouvez modifier la matière de chaque ligne en direct ou ajuster l'ensemble de la commande
              </span>
            </div>

            <button
              type="button"
              onClick={() => handleApplyActiveMaterialToAll()}
              className="px-2.5 py-1 text-xs font-medium text-amber-300 bg-amber-950/40 hover:bg-amber-900/50 border border-amber-800/40 rounded transition-colors whitespace-nowrap"
              title={`Attribuer "${activeMaterial}" à toutes les pièces déjà saisies`}
            >
              Appliquer "{activeMaterial}" à tout le journal
            </button>
          </div>

          <div className="divide-y divide-slate-800/80 max-h-72 overflow-y-auto">
            {entriesHistory.map((item) => {
              const itemMat = item.material || activeMaterial;
              return (
                <div
                  key={item.id}
                  className="py-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs hover:bg-slate-950/40 px-2 rounded transition-colors"
                >
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="text-[11px] text-slate-500 font-mono">
                      {item.timestamp}
                    </span>
                    <span className="font-mono bg-slate-950 px-2.5 py-0.5 rounded border border-slate-800 text-amber-300 font-semibold">
                      Dév {item.dev} mm · {item.quantity} pcs × {item.unitLength}m
                    </span>

                    {/* Inline Material Selector on the entry */}
                    <select
                      aria-label="Modifier la matière de cette ligne"
                      value={STANDARD_MATERIALS.includes(itemMat) ? itemMat : 'custom'}
                      onChange={(e) => {
                        if (e.target.value !== 'custom') {
                          handleUpdateEntryMaterial(item.id, e.target.value);
                        }
                      }}
                      className="bg-slate-950 border border-slate-700 text-[11px] font-mono text-amber-400 rounded px-2 py-0.5 focus:outline-none focus:border-amber-400 font-medium"
                    >
                      {STANDARD_MATERIALS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                      {!STANDARD_MATERIALS.includes(itemMat) && (
                        <option value="custom">{itemMat}</option>
                      )}
                    </select>

                    <span className="text-slate-400 text-[11px]">
                      {item.isChute
                        ? 'Affecté aux Chutes'
                        : `→ Borne ${item.matchedBound} mm`}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 self-end sm:self-auto">
                    <span className="font-mono text-white tabular-nums font-bold text-sm">
                      +{item.evaluatedLength.toFixed(2)} m
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDeleteHistoryEntry(item.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 rounded transition-colors"
                      title="Supprimer cette saisie et déduire son métrage"
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
