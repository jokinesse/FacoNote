import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Calculator,
  Plus,
  Trash2,
  RotateCcw,
  Download,
  ArrowRight,
  Hash,
  CornerDownLeft,
  Layers,
  Camera,
  Filter,
  Sparkles,
  Send,
} from 'lucide-react';
import {
  EncodedEntry,
  SheetPreset,
  ShapedPiece,
  STANDARD_MATERIALS,
  MATERIAL_GROUPS,
} from '../types';
import {
  optimizerApi,
  ApiError,
  BreakdownOption,
  FastEncoderEntryResponse,
  PieceCutDetail,
  PiecesSummaryResponse,
  loadReference,
} from '../api';
import {
  D365_ORDER_RE,
  buildD365Groups,
  clearSavedSheet,
  loadSavedSheet,
  postToExtension,
  saveSheet,
} from '../utils/d365Bridge';
import { WorkshopCalculator } from './WorkshopCalculator';
import { VisualPreEncoderModal } from './VisualPreEncoderModal';
import { CoilCalculator } from './CoilCalculator';
import {
  BTN_DANGER,
  CELL_SHARED_EDGE,
  DeleteButton,
  MaterialFilterButtons,
  Notice,
  ROW_SHARED,
  SharedBadge,
  useDeleteAction,
  useNotify,
} from './ui';

interface FastEncoderProps {
  onTransferToOptimizer: (pieces: ShapedPiece[]) => void;
}

export const FastEncoder: React.FC<FastEncoderProps> = ({ onTransferToOptimizer }) => {
  const [preset, setPreset] = useState<SheetPreset>('DEV_PIECE');
  // Feuille en cours sauvegardée dans le navigateur (survit à F5), effacée par « Vider »
  const [savedSheet] = useState(() => loadSavedSheet());
  const [entriesHistory, setEntriesHistory] = useState<EncodedEntry[]>(() => savedSheet?.entries ?? []);

  // Active encoding material (retains last used material for all subsequent pieces)
  const [activeMaterial, setActiveMaterial] = useState<string>(
    () => savedSheet?.activeMaterial || 'Zinc Quartz 0.7'
  );

  // N° de commande D365 et envoi vers l'extension « Façonote → D365 »
  const [orderNumber, setOrderNumber] = useState<string>(() => savedSheet?.orderNumber ?? '');
  const [isSendingToExt, setIsSendingToExt] = useState<boolean>(false);
  const [extStatus, setExtStatus] = useState<{ kind: 'success' | 'error' | 'warning'; message: string } | null>(null);
  const orderInputRef = useRef<HTMLInputElement>(null);
  const notify = useNotify();
  const [isCustomMaterial, setIsCustomMaterial] = useState<boolean>(false);

  // 3-case input states
  const [inputDev, setInputDev] = useState<string>('');
  const [inputLength, setInputLength] = useState<string>('2.0');
  const [inputQuantity, setInputQuantity] = useState<string>('1');
  const [lengthUnit, setLengthUnit] = useState<'m' | 'mm'>('m');

  // Suppressions : confirmation Oui / Non et message communs à tout le site
  const deleteAction = useDeleteAction();

  // Alerte « même dév dans une autre matière » après une saisie
  const [sharedWarning, setSharedWarning] = useState<string | null>(null);
  const pendingSharedCheckRef = useRef<{ dev: number; material: string } | null>(null);

  // Visual Pre-Encoder Modal State
  const [isVisualModalOpen, setIsVisualModalOpen] = useState<boolean>(false);

  // Live feedback banner
  const [lastFeedback, setLastFeedback] = useState<{
    success: boolean;
    message: string;
    boundMatched?: number;
    executionTimeMs?: number;
  } | null>(() =>
    savedSheet && savedSheet.entries.length > 0
      ? { success: true, message: `Feuille restaurée : ${savedSheet.entries.length} saisie(s) retrouvée(s) après rechargement.` }
      : null
  );

  // API loading & auto-calepinage alternatives
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [breakdownAlternatives, setBreakdownAlternatives] = useState<BreakdownOption[]>([]);

  // Multi-material & view mode states
  const [selectedMaterialFilter, setSelectedMaterialFilter] = useState<string>('ALL');
  const [tableViewMode, setTableViewMode] = useState<'DEV' | 'BOUNDS'>('BOUNDS');
  const [hideEmptyBounds, setHideEmptyBounds] = useState<boolean>(false);

  // Refs for smooth Tab/Enter navigation between the 3 boxes
  const devRef = useRef<HTMLInputElement>(null);
  const lengthRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);

  // Navigation clavier entre les 3 cases (Dév → Quantité → Longueur) :
  // Entrée = case suivante, et sur Longueur : ajout direct. Maj+Entrée = case précédente.
  // Flèches gauche/droite au bord du texte = case voisine. Le bouton Ajouter : Tab ou souris.
  const pieceFields = [devRef, qtyRef, lengthRef];
  const focusField = (ref: React.RefObject<HTMLInputElement | null>) => {
    ref.current?.focus();
    ref.current?.select();
  };
  const handlePieceFieldKeys = (index: number) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const len = input.value.length;
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
    const atEnd = input.selectionStart === len && input.selectionEnd === len;

    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        if (index > 0) focusField(pieceFields[index - 1]);
      } else if (index === 0 && inputDev.includes('/')) {
        // Saisie rapide "dév/longueur" : validation directe
        handleSubmitEntry();
      } else if (index < pieceFields.length - 1) {
        focusField(pieceFields[index + 1]);
      } else {
        handleSubmitEntry();
      }
    } else if (e.key === 'ArrowRight' && atEnd && index < pieceFields.length - 1) {
      e.preventDefault();
      focusField(pieceFields[index + 1]);
    } else if (e.key === 'ArrowLeft' && atStart && index > 0) {
      e.preventDefault();
      focusField(pieceFields[index - 1]);
    }
  };

  // Focus Dev input on load
  useEffect(() => {
    devRef.current?.focus();
  }, []);

  // Preset switch
  const handlePresetChange = (newPreset: SheetPreset) => {
    setPreset(newPreset);
    setLastFeedback(null);
  };
  const isCoilMode = preset === 'DEV_BOBINE';

  // Ajoute à l'historique des saisies déjà calculées par le backend
  const addEncodedEntries = (encoded: FastEncoderEntryResponse[]) => {
    const now = new Date().toLocaleTimeString();
    const stamp = Date.now();
    const newEntries: EncodedEntry[] = encoded.map((entry, i) => ({
      id: `entry-${stamp}-${i}-${Math.random().toString(36).substring(2, 6)}`,
      rawInput: entry.raw_input,
      dev: entry.dev,
      lengthExpression: `${entry.quantity} × ${entry.unit_length_m}m`,
      unitLength: entry.unit_length_m,
      quantity: entry.quantity,
      evaluatedLength: entry.total_length_m,
      matchedBound: entry.matched_bound,
      isChute: false,
      material: entry.material,
      timestamp: now,
    }));
    // L'historique est affiché du plus récent au plus ancien
    setEntriesHistory((prev) => [...newEntries.reverse(), ...prev]);
    // Vérifié quand le backend a recalculé le tableau
    const last = encoded[encoded.length - 1];
    pendingSharedCheckRef.current = last ? { dev: last.dev, material: last.material } : null;
  };

  // Saisie : tous les calculs sont faits par le backend.
  // - 3 cases : quick-encode lit chaque case séparément (développé, quantité, longueur)
  // - format rapide "dév/longueur" dans la 1re case : quick-encode avec l'expression complète
  // - quantité 0 : auto-métrage (quick-encode pour lire les cases, auto-breakdown, pieces-encode)
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
        message: 'Veuillez saisir un développement de pièce en mm (ex: 175, 250...).',
      });
      devRef.current?.focus();
      return;
    }

    const isQuickFormat = devStr.includes('/');
    const parsedQty = qtyStr.trim() === '' ? 1 : parseInt(qtyStr, 10);
    if (!isQuickFormat && (isNaN(parsedQty) || parsedQty < 0)) {
      setLastFeedback({ success: false, message: 'Quantité invalide (nombre entier, 0 = métrage auto).' });
      qtyRef.current?.focus();
      return;
    }

    setIsSubmitting(true);
    setBreakdownAlternatives([]);

    try {
      // Cas 1 : quantité 0 -> auto-métrage du métrage linéaire (Section 3.2 du CDC)
      if (!isQuickFormat && parsedQty === 0) {
        const check = await optimizerApi.quickEncode({
          dev_expr: devStr.trim(),
          quantity: 0,
          length_expr: lenStr.trim(),
          material: activeMaterial,
          length_unit: lengthUnit,
        });
        const dev = check.data.dev;
        const totalMeters = check.data.unit_length_m;

        const currentPiecesForEngine = (summary?.bound_rows ?? [])
          .filter((row) => !row.is_empty)
          .map((row, idx) => ({
            id: `p-${idx}`,
            label: `Pièce borne ${row.bound}mm`,
            dev: row.bound,
            length: 2.0,
            quantity: Math.min(row.quantity || 1, 1000),
            material: row.material,
          }));

        const breakdownResp = await optimizerApi.autoBreakdown({
          total_meters: totalMeters,
          current_pieces: currentPiecesForEngine,
          target_material: activeMaterial,
        });
        const breakdown = breakdownResp.data;
        setBreakdownAlternatives(breakdown.alternatives || []);

        const encoded = await optimizerApi.piecesEncode({
          items: [
            {
              dev,
              quantity: breakdown.quantity,
              unit_length_m: breakdown.length,
              material: activeMaterial,
              label: `Dév ${dev} · ${breakdown.quantity} pcs × ${breakdown.length}m (Total ${totalMeters}m auto)`,
            },
          ],
        });
        addEncodedEntries(encoded.data.entries);

        setLastFeedback({
          success: true,
          message: `⚡ Métrage de ${totalMeters}m auto-calepiné (${breakdownResp.executionTimeMs}ms) : ${breakdown.quantity} pièces de ${breakdown.length}m (${breakdown.reason})`,
          executionTimeMs: breakdownResp.executionTimeMs,
        });

        setInputDev('');
        setInputLength('2.0');
        setInputQuantity('1');
        devRef.current?.focus();
        return;
      }

      // Cas 2 : saisie normale
      const apiResult = await optimizerApi.quickEncode(
        isQuickFormat
          ? { raw_input: devStr.trim(), material: activeMaterial, length_unit: lengthUnit, preset: 'DEV_PIECE' }
          : {
              dev_expr: devStr.trim(),
              quantity: parsedQty,
              length_expr: lenStr.trim() || '2.0',
              material: activeMaterial,
              length_unit: lengthUnit,
            }
      );

      const entry = apiResult.data;
      addEncodedEntries([entry]);

      setLastFeedback({
        success: true,
        message: `Saisie validée (${apiResult.executionTimeMs}ms) : Dév ${entry.dev}mm (${entry.quantity} pcs × ${entry.unit_length_m}m = ${entry.total_length_m}m) [${entry.material}] → Borne ≤ ${entry.matched_bound}mm · ${entry.surface_net_m2} m² · ${entry.weight_net_kg} kg`,
        boundMatched: entry.matched_bound,
        executionTimeMs: apiResult.executionTimeMs,
      });

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

  // Variante d'auto-métrage : remplace la dernière saisie, recalculée par le backend
  const handleApplyAlternative = async (alt: BreakdownOption) => {
    const last = entriesHistory[0];
    const devToUse = last?.dev || 175;
    const material = last?.material || activeMaterial;
    try {
      const res = await optimizerApi.piecesEncode({
        items: [
          {
            dev: devToUse,
            quantity: alt.quantity,
            unit_length_m: alt.length,
            material,
            label: `Dév ${devToUse} · ${alt.label}`,
          },
        ],
      });
      if (last) setEntriesHistory((prev) => prev.filter((e) => e.id !== last.id));
      addEncodedEntries(res.data.entries);
      setLastFeedback({
        success: true,
        message: `Variante appliquée : ${alt.quantity} pcs de ${alt.length}m (Total ${alt.total_produced}m)`,
      });
      setBreakdownAlternatives([]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'erreur inconnue';
      setLastFeedback({ success: false, message: `Variante refusée par le calcul : ${message}` });
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

  // Suppression d'une saisie de l'historique (le tableau est recalculé par le backend)
  const handleDeleteHistoryEntry = (entryId: string) => {
    const entry = entriesHistory.find((e) => e.id === entryId);
    if (!entry) return;
    deleteAction(`la saisie Dév ${entry.dev} mm · ${entry.quantity || 1} × ${entry.unitLength} m`, () =>
      setEntriesHistory((prev) => prev.filter((e) => e.id !== entryId))
    );
  };

  // Annuler la dernière saisie (sans confirmation, pour garder la saisie rapide)
  const handleUndoLast = () => {
    if (entriesHistory.length === 0) return;
    const [last] = entriesHistory;
    setEntriesHistory((prev) => prev.filter((e) => e.id !== last.id));
    setLastFeedback({
      success: true,
      message: `Dernière saisie annulée : Dév ${last.dev} mm · ${last.quantity || 1} × ${last.unitLength} m`,
    });
  };

  // Vide la feuille (saisies, n° de commande, sauvegarde du navigateur)
  const clearSheet = () => {
    setEntriesHistory([]);
    setOrderNumber('');
    clearSavedSheet();
    setLastFeedback(null);
    setSharedWarning(null);
    devRef.current?.focus();
  };

  // Vider tout le tableau. Avec un n° de commande valide, la commande est aussi retirée de l'extension.
  const handleClearAll = () => {
    if (entriesHistory.length === 0 && !orderNumber) return;
    const order = D365_ORDER_RE.test(orderNumber) ? orderNumber : null;
    const what = order
      ? `toutes les saisies Dév pièce et la commande ${order} dans l'extension D365`
      : 'toutes les saisies Dév pièce';
    deleteAction(what, () => {
      clearSheet();
      setExtStatus(null);
      if (order) {
        postToExtension({ type: 'CLEAR', orderNumber: order })
          .then((reply) =>
            setExtStatus(
              reply.type === 'ACK'
                ? { kind: 'success', message: reply.message || `Commande ${order} retirée de l'extension.` }
                : { kind: 'error', message: `Extension : ${reply.error || 'erreur inconnue'}` }
            )
          )
          .catch((err: Error) => setExtStatus({ kind: 'warning', message: err.message }));
      }
    });
  };

  // Envoi vers l'extension : un groupe par matière, toutes les bornes, longueurs du backend
  const handleSendToExtension = async () => {
    const order = orderNumber.trim();
    if (!D365_ORDER_RE.test(order)) {
      setExtStatus({ kind: 'error', message: 'N° de commande D365 invalide : CC suivi de 11 chiffres (ex. CC26000236736).' });
      orderInputRef.current?.focus();
      return;
    }
    if (entriesHistory.filter((e) => !e.isChute && e.dev > 0).length === 0) {
      setExtStatus({ kind: 'error', message: 'Aucune pièce à envoyer : encodez d’abord les pièces.' });
      return;
    }
    setIsSendingToExt(true);
    setExtStatus(null);
    try {
      // Tableau recalculé à l'instant par le backend, pour envoyer exactement l'état affiché
      const [fresh, reference] = await Promise.all([
        optimizerApi.piecesSummary(buildSummaryPayload()),
        loadReference(),
      ]);
      const { groups, unknown } = buildD365Groups(fresh.data, reference);
      if (unknown.length > 0) {
        setExtStatus({
          kind: 'error',
          message: `Envoi refusé : libellé D365 pas encore connu pour ${unknown.join(', ')}. Retirez ces saisies ou demandez l'ajout du libellé.`,
        });
        return;
      }
      if (groups.length === 0) {
        setExtStatus({ kind: 'error', message: 'Aucune matière à envoyer.' });
        return;
      }
      const reply = await postToExtension({
        type: 'SEND',
        sentAt: new Date().toISOString(),
        orderNumber: order,
        groups,
      });
      if (reply.type !== 'ACK') {
        setExtStatus({ kind: 'error', message: `Extension : ${reply.error || 'envoi refusé'}` });
        return;
      }
      const ok = reply.message || `Commande ${order} reçue par l'extension.`;
      setExtStatus({ kind: 'success', message: `${ok} Pré-remplissez maintenant dans D365, matière par matière.` });
      notify(ok);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'erreur inconnue';
      setExtStatus({ kind: 'error', message });
    } finally {
      setIsSendingToExt(false);
    }
  };

  // Supprimer une ligne Dév × matière du tableau
  const handleResetDevMaterialRow = (targetDev: number, targetMaterial: string) => {
    deleteAction(`Dév ${targetDev} mm (${targetMaterial})`, () =>
      setEntriesHistory((prev) =>
        prev.filter(
          (e) => !(e.dev === targetDev && (e.material || activeMaterial) === targetMaterial)
        )
      )
    );
  };

  // Supprimer une ligne Borne × matière du tableau
  const handleResetIntervalRow = (bound: number, targetMaterial?: string) => {
    deleteAction(
      targetMaterial ? `Borne ${bound} mm (${targetMaterial})` : `Borne ${bound} mm`,
      () =>
        setEntriesHistory((prev) =>
          prev.filter(
            (e) =>
              !(
                e.matchedBound === bound &&
                (!targetMaterial || (e.material || activeMaterial) === targetMaterial)
              )
          )
        )
    );
  };

  // Quick preset button click
  const handleQuickPreset = (dev: number, len: string, qty: string) => {
    setInputDev(dev.toString());
    setInputLength(len);
    setInputQuantity(qty);
    handleSubmitEntry(dev.toString(), len, qty);
  };

  // Export CSV (valeurs calculées par le backend)
  const handleExportCSV = () => {
    const headers = [
      'Borne_Dev_mm',
      'Matiere',
      'Longueur_Cumulee_m',
      'Nombre_Pieces',
      'Surface_m2',
      'Poids_Est_kg',
    ];
    const rows = (summary?.bound_rows ?? [])
      .filter((r) => !r.is_empty)
      .map(
        (r) =>
          `${r.bound};${r.material};${r.length_m};${r.quantity};${r.surface_m2.toFixed(2)};${r.weight_kg}`
      );

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

  // Transfer to Optimizer : les pièces saisies, regroupées si identiques (même dév, longueur, matière)
  const handleTransfer = () => {
    const activePieces: ShapedPiece[] = [];
    const nonChuteEntries = entriesHistory.filter((e) => !e.isChute && e.dev > 0);

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
        length: val.length,
        quantity: val.quantity,
        bends: 2,
        material: val.material,
        workshopSplitReason: `Saisie Calculateur : ${val.quantity} pcs × ${val.length}m (Borne ≤ ${val.bound} mm)`,
      });
    });

    if (activePieces.length === 0) {
      setLastFeedback({
        success: false,
        message: "Veuillez d'abord encoder des pièces avant de lancer l'optimisation.",
      });
      return;
    }

    onTransferToOptimizer(activePieces);
  };

  // Tableau recalculé par le backend (pieces-summary) à chaque changement des saisies.
  // On ignore les réponses d'une requête dépassée par une plus récente.
  const [summary, setSummary] = useState<PiecesSummaryResponse | null>(null);
  const summaryRequestRef = useRef(0);
  const buildSummaryPayload = () => ({
    entries: [...entriesHistory]
      .reverse()
      .filter((e) => !e.isChute && e.dev > 0)
      .map((e) => ({
        id: e.id,
        dev: e.dev,
        quantity: e.quantity || 1,
        unit_length_m: e.unitLength,
        material: e.material || activeMaterial,
      })),
  });
  useEffect(() => {
    const requestId = ++summaryRequestRef.current;
    const payload = buildSummaryPayload();
    optimizerApi
      .piecesSummary(payload)
      .then((res) => {
        if (requestId === summaryRequestRef.current) setSummary(res.data);
      })
      .catch((err) => {
        if (requestId !== summaryRequestRef.current) return;
        const message = err instanceof Error ? err.message : 'erreur inconnue';
        setLastFeedback({ success: false, message: `Calcul du tableau impossible : ${message}` });
      });
  }, [entriesHistory, activeMaterial]);

  // Sauvegarde de la feuille en cours dans le navigateur
  useEffect(() => {
    saveSheet({ orderNumber, activeMaterial, entries: entriesHistory });
  }, [entriesHistory, orderNumber, activeMaterial]);

  // Totaux (backend). Surface : aux bornes ; poids : au développement réel.
  const totalLengthM = summary?.totals.length_m ?? 0;
  const totalCount = summary?.totals.quantity ?? 0;
  const totalSurfaceM2 = summary?.totals.surface_bound_m2 ?? 0;
  const totalWeightEstKg = summary?.totals.weight_net_kg ?? 0;

  // Import du scan IA : les pièces sont validées et calculées par le backend (pieces-encode)
  const handleImportPiecesFromVisual = async (
    pieces: ShapedPiece[],
    metadata?: { client?: string; chantier?: string; detectedMaterial?: string }
  ) => {
    const usable = pieces.filter((p) => p.dev > 0 && p.quantity > 0 && p.length > 0);
    const skipped = pieces.length - usable.length;
    if (usable.length === 0) {
      setLastFeedback({
        success: false,
        message: "Aucun profil exploitable dans l'import (développé, quantité ou longueur manquant).",
      });
      return;
    }

    try {
      const res = await optimizerApi.piecesEncode({
        items: usable.map((p) => ({
          dev: p.dev,
          quantity: p.quantity,
          unit_length_m: p.length,
          material: p.material || activeMaterial,
          label: `[Vision IA] ${p.label} (Dév ${p.dev}mm) · ${p.quantity} pcs × ${p.length}m`,
        })),
      });
      addEncodedEntries(res.data.entries);

      if (metadata?.detectedMaterial && STANDARD_MATERIALS.includes(metadata.detectedMaterial)) {
        setActiveMaterial(metadata.detectedMaterial);
      }

      setLastFeedback({
        success: true,
        message:
          `${usable.length} profil(s) importé(s) et injecté(s) avec succès dans le calculateur !` +
          (skipped > 0 ? ` (${skipped} ignoré(s) : développé, quantité ou longueur manquant)` : ''),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'erreur inconnue';
      setLastFeedback({ success: false, message: `Import IA refusé par le calcul : ${message}` });
    }
  };

  // Lignes du tableau (backend), au format attendu par l'affichage
  const toCuts = (cuts: PieceCutDetail[]) =>
    [...cuts].reverse().map((c) => ({
      id: c.id,
      dev: c.dev,
      quantity: c.quantity,
      unitLength: c.unit_length_m,
      isShared: c.is_shared_dev,
    }));

  const tableDevRows = (summary?.dev_rows ?? []).map((r) => ({
    id: `dev-${r.dev}-${r.material}`,
    dev: r.dev,
    bound: r.bound,
    material: r.material,
    metalFamily: r.family,
    count: r.quantity,
    accumulatedLength: r.length_m,
    surface: r.surface_m2,
    weightEst: r.weight_kg,
    percent: r.percent,
    isSharedDev: r.is_shared_dev,
    sharedWithMaterials: r.shared_with_materials,
    entries: toCuts(r.cuts),
  }));

  // Après une saisie : si le même dév existe dans une autre matière, on prévient
  // (l'information vient du backend : is_shared_dev / shared_with_materials).
  useEffect(() => {
    const pending = pendingSharedCheckRef.current;
    if (!pending || !summary) return;
    const row = summary.dev_rows.find((r) => r.dev === pending.dev && r.material === pending.material);
    if (!row) return;
    pendingSharedCheckRef.current = null;
    setSharedWarning(
      row.is_shared_dev
        ? `Attention : le Dév ${row.dev} mm existe aussi en ${row.shared_with_materials.join(', ')}. Vérifiez la matière avant de continuer.`
        : null
    );
  }, [summary]);

  const tableIntervalRows = (summary?.bound_rows ?? []).map((r) => ({
    id: `bound-${r.bound}-${r.material || 'vide'}`,
    bound: r.bound,
    // Ligne vide : affichée (grisée) avec la matière en cours
    material: r.is_empty ? activeMaterial : r.material,
    metalFamily: r.family,
    count: r.quantity,
    accumulatedLength: r.length_m,
    surface: r.surface_m2,
    weightEst: r.weight_kg,
    percent: r.percent,
    isMultiMaterialBound: r.is_multi_material_bound,
    hasSharedDev: r.has_shared_dev,
    entries: toCuts(r.cuts),
  }));

  const materialsSummary = (summary?.materials ?? []).map((m) => ({
    material: m.material,
    metalFamily: m.family,
    count: m.quantity,
    lengthM: m.length_m,
    surfaceM2: m.surface_m2,
    weightKg: m.weight_kg,
    percent: m.percent,
  }));

  const toFamily = (f?: { quantity: number; length_m: number; surface_m2: number; weight_kg: number }) => ({
    count: f?.quantity ?? 0,
    lengthM: f?.length_m ?? 0,
    surfaceM2: f?.surface_m2 ?? 0,
    weightKg: f?.weight_kg ?? 0,
  });
  const aluSummary = toFamily(summary?.alu);
  const zincSummary = toFamily(summary?.zinc);

  // Filtres d'affichage (pas de calcul)
  // Matière filtrée qui n'existe plus dans le tableau (lignes supprimées) : retour à « Toutes »
  useEffect(() => {
    if (
      !['ALL', 'ALU', 'ZINC'].includes(selectedMaterialFilter) &&
      summary &&
      !summary.materials.some((m) => m.material === selectedMaterialFilter)
    ) {
      setSelectedMaterialFilter('ALL');
    }
  }, [summary, selectedMaterialFilter]);

  const matchesFilter = (family: string, material: string) =>
    selectedMaterialFilter === 'ALL' ||
    (selectedMaterialFilter === 'ALU' && family === 'ALU') ||
    (selectedMaterialFilter === 'ZINC' && family === 'ZINC') ||
    material === selectedMaterialFilter;

  const filteredDevRows = tableDevRows.filter((r) => matchesFilter(r.metalFamily, r.material));

  const filteredIntervalRows = tableIntervalRows.filter((r) => {
    if (hideEmptyBounds && r.accumulatedLength <= 0) return false;
    if (r.count === 0) return selectedMaterialFilter === 'ALL';
    return matchesFilter(r.metalFamily, r.material);
  });

  // Discrete material badge helper with prominent ALU vs ZINC identification
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
    const isAlu = matLower.includes('alu') || matLower.includes('aluminium');
    const isZinc = matLower.includes('zinc');

    if (isAlu) {
      return (
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-sans font-medium border bg-[#00478a]/10 text-[#00478a] border-[#00478a]/25 shadow-2xs"
          title={material}
        >
          <span className="px-1.5 py-0.2 rounded text-[9px] font-black bg-[#00478a] text-white tracking-wider">
            ALU
          </span>
          <span className="truncate max-w-[150px] font-bold">
            {material.replace(/^Alu\s*/i, '')}
          </span>
        </span>
      );
    }

    if (isZinc) {
      const isRouge = matLower.includes('rouge');
      return (
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-sans font-medium border shadow-2xs ${
            isRouge
              ? 'bg-rose-50 text-rose-800 border-rose-200'
              : 'bg-slate-100 text-slate-800 border-slate-300'
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
          <span className="truncate max-w-[150px] font-bold">
            {material.replace(/^Zinc\s*/i, '')}
          </span>
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

            {/* Quick access pills for the most common workshop nuances */}
            <div className="flex items-center gap-1 flex-wrap">
              {[
                { label: 'Alu 7016', value: 'Alu RAL 7016 0.7', family: 'ALU' },
                { label: 'Alu 9005', value: 'Alu RAL 9005 0.7', family: 'ALU' },
                { label: 'Zinc Quartz', value: 'Zinc Quartz 0.7', family: 'ZINC' },
                { label: 'Zinc Naturel', value: 'Zinc Naturel 0.7', family: 'ZINC' },
              ].map((pill) => {
                const isSelected = activeMaterial === pill.value && !isCustomMaterial;
                return (
                  <button
                    key={pill.value}
                    type="button"
                    onClick={() => {
                      setIsCustomMaterial(false);
                      setActiveMaterial(pill.value);
                    }}
                    className={`px-2 py-1 rounded-md text-xs font-bold border transition-all cursor-pointer flex items-center gap-1 ${
                      isSelected
                        ? pill.family === 'ALU'
                          ? 'bg-[#00478a] text-white border-[#00478a] shadow-2xs'
                          : 'bg-slate-700 text-white border-slate-700 shadow-2xs'
                        : pill.family === 'ALU'
                        ? 'bg-sky-50 text-[#00478a] border-sky-200 hover:bg-sky-100'
                        : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
                    }`}
                  >
                    <span className="text-[9px] px-1 py-0.2 rounded font-black opacity-80">
                      {pill.family}
                    </span>
                    <span>{pill.label}</span>
                  </button>
                );
              })}
            </div>

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
              className="faco-input bg-[#f8fafc] border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-semibold text-[#282828] focus:outline-none focus:border-[#00478a] cursor-pointer"
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

        <div className={isCoilMode ? 'hidden' : 'space-y-3.5'}>
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
              onKeyDown={handlePieceFieldKeys(0)}
              placeholder={preset === 'DEV_BOBINE' ? 'ex: 650 (0 = chute)' : 'ex: 175'}
              className="faco-input w-full bg-[#f8fafc] border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono font-bold text-[#00478a] placeholder:text-slate-400 focus:outline-none focus:border-[#00478a] focus:bg-white"
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
              type="text"
              inputMode="numeric"
              value={inputQuantity}
              onChange={(e) => setInputQuantity(e.target.value)}
              onKeyDown={handlePieceFieldKeys(1)}
              placeholder="ex: 4"
              className="faco-input w-full bg-[#f8fafc] border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono font-bold text-[#282828] placeholder:text-slate-400 focus:outline-none focus:border-[#00478a] focus:bg-white"
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
              onKeyDown={handlePieceFieldKeys(2)}
              placeholder="ex: 2.0"
              className="faco-input w-full bg-[#f8fafc] border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono font-bold text-[#282828] placeholder:text-slate-400 focus:outline-none focus:border-[#00478a] focus:bg-white"
            />
          </div>

          <div>
            <button
              ref={addBtnRef}
              type="button"
              disabled={isSubmitting}
              onClick={() => handleSubmitEntry()}
              onKeyDown={(e) => {
                // Entrée = Ajouter. On bloque la propagation, sinon la calculette d'atelier
                // (raccourcis clavier globaux) intercepte Entrée et annule le clic.
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!isSubmitting) handleSubmitEntry();
                } else if ((e.key === 'Enter' && e.shiftKey) || e.key === 'ArrowLeft') {
                  e.preventDefault();
                  e.stopPropagation();
                  focusField(lengthRef);
                }
              }}
              className="faco-btn w-full py-2 bg-[#e7511f] hover:bg-[#cf4315] focus:bg-[#cf4315] disabled:opacity-50 text-white font-semibold rounded-lg text-sm flex items-center justify-center gap-1.5 transition-colors shadow-2xs cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#00478a] focus:ring-offset-2"
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
          <Notice
            kind={lastFeedback.success ? 'success' : 'error'}
            message={lastFeedback.message}
            onClose={() => setLastFeedback(null)}
          />
        )}
        {sharedWarning && (
          <Notice kind="warning" message={sharedWarning} onClose={() => setSharedWarning(null)} />
        )}
        </div>
      </div>

      {/* Calculateur Bobine (séparé du tableau des pièces) */}
      <div className={isCoilMode ? '' : 'hidden'}>
        <CoilCalculator
          activeMaterial={activeMaterial}
          lengthUnit={lengthUnit}
          onMaterialChange={setActiveMaterial}
        />
      </div>

      <div className={isCoilMode ? 'hidden' : 'space-y-4'}>
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
                onClick={() => handleApplyAlternative(alt)}
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

      </div>

      {/* Main Table: Accumulated Intervals & Multi-Material Management */}
      <div className="faco-card bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
        {/* Table Top Controls Bar */}
        <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-[#f8fafc]">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Calculator className="w-4 h-4 text-[#00478a]" />
              <h2 className="text-xs font-bold text-[#00478a] uppercase tracking-wider">
                Tableau de Calcul & Débits
              </h2>
            </div>

            {/* View Mode Toggle: Real Pieces (Dév) vs Theoretical Bounds Grid */}
            <div className="flex items-center bg-slate-200/80 p-0.5 rounded-lg border border-slate-300 text-xs">
              <button
                type="button"
                onClick={() => setTableViewMode('DEV')}
                className={`px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer ${
                  tableViewMode === 'DEV'
                    ? 'bg-white text-[#00478a] shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-[#282828]'
                }`}
                title="Afficher par développement réel saisi (ex: 150 mm Alu, 150 mm Zinc...)"
              >
                Vue Dév & Pièces
              </button>
              <button
                type="button"
                onClick={() => setTableViewMode('BOUNDS')}
                className={`px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer ${
                  tableViewMode === 'BOUNDS'
                    ? 'bg-white text-[#00478a] shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-[#282828]'
                }`}
                title="Afficher selon les bornes standards d'atelier (100, 125, 166...)"
              >
                Grille Bornes Atelier
              </button>
            </div>
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

            <input
              ref={orderInputRef}
              type="text"
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value.toUpperCase().replace(/\s+/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSendToExtension();
                }
              }}
              placeholder="N° commande D365"
              aria-label="N° commande D365"
              title="N° de commande D365 : CC suivi de 11 chiffres (ex. CC26000236736)"
              maxLength={13}
              className={`faco-input w-36 bg-white border rounded-lg px-2 py-1.5 text-xs font-mono focus:outline-none ${
                orderNumber && !D365_ORDER_RE.test(orderNumber)
                  ? 'border-rose-400 focus:border-rose-500'
                  : 'border-slate-300 focus:border-[#00478a]'
              }`}
            />
            <button
              type="button"
              onClick={handleSendToExtension}
              disabled={isSendingToExt}
              className="px-2.5 py-1.5 text-xs font-semibold text-[#00478a] bg-white hover:bg-sky-50 disabled:opacity-40 border border-sky-300 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
              title="Envoyer les longueurs par borne, matière par matière, vers l'extension Edge « Façonote → D365 »"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isSendingToExt ? 'Envoi…' : "Envoyer vers l'extension"}</span>
            </button>

            <button
              type="button"
              onClick={handleClearAll}
              disabled={entriesHistory.length === 0 && !orderNumber}
              className={BTN_DANGER}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Vider</span>
            </button>

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

        {extStatus && (
          <div className="px-4 py-2 border-b border-slate-200">
            <Notice kind={extStatus.kind} message={extStatus.message} onClose={() => setExtStatus(null)} />
          </div>
        )}

        {/* Multi-Material Filter & Distribution Toolbar */}
        {materialsSummary.length > 0 && (
          <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                <Filter className="w-3 h-3 text-slate-400" />
                <span>Filtrer :</span>
              </span>

              <button
                type="button"
                onClick={() => setSelectedMaterialFilter('ALL')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-all cursor-pointer ${
                  selectedMaterialFilter === 'ALL'
                    ? 'bg-[#00478a] text-white border-[#00478a] shadow-2xs'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                Toutes ({totalLengthM.toFixed(1)}m · {totalCount} pcs)
              </button>

              {aluSummary.count > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedMaterialFilter('ALU')}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-all cursor-pointer flex items-center gap-1.5 ${
                    selectedMaterialFilter === 'ALU'
                      ? 'bg-[#00478a] text-white border-[#00478a] shadow-2xs'
                      : 'bg-sky-50 text-[#00478a] border-sky-200 hover:bg-sky-100'
                  }`}
                >
                  <span className="px-1.5 py-0.2 bg-[#00478a] text-white rounded text-[9px] font-black">
                    ALU
                  </span>
                  <span>
                    {aluSummary.lengthM.toFixed(1)}m ({aluSummary.count} pcs · {aluSummary.weightKg.toFixed(1)} kg)
                  </span>
                </button>
              )}

              {zincSummary.count > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedMaterialFilter('ZINC')}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-all cursor-pointer flex items-center gap-1.5 ${
                    selectedMaterialFilter === 'ZINC'
                      ? 'bg-slate-700 text-white border-slate-700 shadow-2xs'
                      : 'bg-slate-100 text-slate-800 border-slate-300 hover:bg-slate-200'
                  }`}
                >
                  <span className="px-1.5 py-0.2 bg-slate-700 text-white rounded text-[9px] font-black">
                    ZINC
                  </span>
                  <span>
                    {zincSummary.lengthM.toFixed(1)}m ({zincSummary.count} pcs · {zincSummary.weightKg.toFixed(1)} kg)
                  </span>
                </button>
              )}

              {/* Filtre par matière précise (Naturel, ATZ, Quartz… et épaisseur séparés) */}
              {materialsSummary.length > 1 && (
                <MaterialFilterButtons
                  items={materialsSummary.map((m) => ({
                    material: m.material,
                    family: m.metalFamily,
                    lengthM: m.lengthM,
                    count: m.count,
                  }))}
                  selected={selectedMaterialFilter}
                  onSelect={setSelectedMaterialFilter}
                />
              )}
            </div>

            {/* Proportional visual split-bar */}
            {materialsSummary.length > 1 && (
              <div className="flex items-center gap-2 text-xs font-mono text-slate-600">
                <div
                  className="w-32 h-2.5 rounded-full overflow-hidden bg-slate-200 flex border border-slate-300 shrink-0"
                  title="Répartition par matière"
                >
                  {materialsSummary.map((m) => (
                    <div
                      key={m.material}
                      style={{ width: `${m.percent}%` }}
                      title={`${m.material}: ${m.lengthM}m (${m.percent}%)`}
                      className={`h-full ${
                        m.metalFamily === 'ALU'
                          ? 'bg-[#00478a]'
                          : m.material.includes('Rouge')
                          ? 'bg-rose-500'
                          : 'bg-slate-600'
                      }`}
                    />
                  ))}
                </div>
                <span className="text-[11px] font-bold text-slate-500">
                  {materialsSummary.length} matières actives
                </span>
              </div>
            )}
          </div>
        )}

        {/* BOUNDS Mode extra option: Hide empty rows */}
        {tableViewMode === 'BOUNDS' && (
          <div className="px-4 py-1.5 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span className="text-[11px]">Grille standard des laizes et développements de refente</span>
            <label className="flex items-center gap-1.5 cursor-pointer text-[11px] font-medium text-slate-600 hover:text-slate-900 select-none">
              <input
                type="checkbox"
                checked={hideEmptyBounds}
                onChange={(e) => setHideEmptyBounds(e.target.checked)}
                className="rounded border-slate-300 text-[#00478a] focus:ring-0 cursor-pointer"
              />
              <span>Masquer les bornes vides (0m)</span>
            </label>
          </div>
        )}

        <div
          tabIndex={0}
          role="region"
          aria-label="Tableau de calcul multi-matière"
          className="table-wrapper"
        >
          {tableViewMode === 'DEV' ? (
            /* ========================================================
               MODE 1 : VUE DÉVELOPPEMENTS & PIÈCES RÉELLES ENCODÉES
               ======================================================== */
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-600 font-semibold border-b border-slate-200 uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-2.5 px-4">Développement</th>
                  <th className="py-2.5 px-4">Matière</th>
                  <th className="py-2.5 px-4">Borne Atelier</th>
                  <th className="py-2.5 px-4">Longueurs & Détail</th>
                  <th className="py-2.5 px-4 text-right">Qté</th>
                  <th className="py-2.5 px-4 text-right">Cumul (m)</th>
                  <th className="py-2.5 px-4 text-right">Surface</th>
                  <th className="py-2.5 px-4 text-right">Poids Est.</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {filteredDevRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 px-4 text-center text-slate-400 font-sans">
                      <div className="max-w-md mx-auto space-y-2">
                        <Calculator className="w-8 h-8 text-slate-300 mx-auto" />
                        <p className="text-xs font-semibold text-slate-600">
                          Aucune pièce encodée pour le moment.
                        </p>
                        <p className="text-[11px] text-slate-400">
                          Saisissez vos développements ci-dessus (ex: <span className="font-mono text-[#00478a] font-bold">150</span> en Alu, puis <span className="font-mono text-[#00478a] font-bold">150</span> en Zinc) pour les comparer et optimiser le débit.
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredDevRows.map((row) => {
                    const isAlu = row.metalFamily === 'ALU';
                    const isZinc = row.metalFamily === 'ZINC';

                    return (
                      <tr
                        key={row.id}
                        className={`transition-colors border-b border-slate-100 ${
                          row.isSharedDev ? ROW_SHARED : 'bg-white hover:bg-slate-50/80'
                        }`}
                      >
                        {/* 1. Dév Réel (Gros et lisible) + Badge Même Dév si partagé */}
                        <td className={`py-2.5 px-4 ${row.isSharedDev ? CELL_SHARED_EDGE : ''}`}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-black font-mono text-[#282828] tabular-nums">
                              {row.dev} <span className="text-xs font-normal text-slate-500">mm</span>
                            </span>
                            {row.isSharedDev && (
                              <SharedBadge label="Même dév" materials={row.sharedWithMaterials} />
                            )}
                          </div>
                        </td>

                        {/* 2. Badge Matière à fort contraste (ALU vs ZINC) */}
                        <td className="py-2.5 px-4">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-black tracking-wider ${
                                isAlu
                                  ? 'bg-[#00478a] text-white shadow-2xs'
                                  : isZinc
                                  ? row.material.includes('Rouge')
                                    ? 'bg-rose-600 text-white shadow-2xs'
                                    : 'bg-slate-700 text-white shadow-2xs'
                                  : 'bg-emerald-700 text-white'
                              }`}
                            >
                              {isAlu ? 'ALU' : isZinc ? 'ZINC' : 'MÉTAL'}
                            </span>
                            <span className="font-semibold text-xs text-slate-800">
                              {row.material.replace(/^(Alu|Zinc)\s*/i, '')}
                            </span>
                          </div>
                        </td>

                        {/* 3. Borne de Refente Atelier */}
                        <td className="py-2.5 px-4 font-mono text-xs text-slate-500">
                          <span className="inline-flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                            Borne ≤ <strong className="text-[#00478a]">{row.bound}</strong> mm
                          </span>
                        </td>

                        {/* 4. Détail des coupes */}
                        <td className="py-2.5 px-4 text-xs font-mono">
                          <div className="flex flex-wrap items-center gap-1">
                            {row.entries.map((e) => (
                              <span
                                key={e.id}
                                className="px-1.5 py-0.5 bg-[#f8fafc] text-slate-700 rounded border border-slate-200 text-[11px]"
                              >
                                {e.quantity} × {e.unitLength}m
                              </span>
                            ))}
                          </div>
                        </td>

                        {/* 5. Quantité */}
                        <td className="py-2.5 px-4 text-right tabular-nums font-bold text-xs text-[#282828]">
                          {row.count} pcs
                        </td>

                        {/* 6. Cumul en mètres */}
                        <td className="py-2.5 px-4 text-right tabular-nums font-bold text-xs text-[#00478a]">
                          {row.accumulatedLength.toFixed(2)} m
                        </td>

                        {/* 7. Surface nette m² */}
                        <td className="py-2.5 px-4 text-right tabular-nums text-xs text-slate-600">
                          {row.surface.toFixed(2)} m²
                        </td>

                        {/* 8. Poids calculé selon densité physique réelle */}
                        <td className="py-2.5 px-4 text-right tabular-nums font-bold text-xs text-[#282828]">
                          <span
                            className={
                              isAlu
                                ? 'text-[#00478a]'
                                : isZinc
                                ? 'text-slate-800'
                                : 'text-slate-700'
                            }
                          >
                            {row.weightEst} kg
                          </span>
                        </td>

                        {/* 9. Action Supprimer cette pièce */}
                        <td className="py-2.5 px-4 text-right">
                          <DeleteButton
                            title={`Supprimer Dév ${row.dev} mm (${row.material})`}
                            onClick={() => handleResetDevMaterialRow(row.dev, row.material)}
                          />
                        </td>
                      </tr>
                    );
                  })
                )}

              </tbody>
            </table>
          ) : (
            /* ========================================================
               MODE 2 : VUE GRILLE DES BORNES STANDARDS D'ATELIER
               ======================================================== */
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-600 font-semibold border-b border-slate-200 uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-2.5 px-4">Borne (mm)</th>
                  <th className="py-2.5 px-4">Matière</th>
                  <th className="py-2.5 px-4">Détail des pièces</th>
                  <th className="py-2.5 px-4 text-right">Qté</th>
                  <th className="py-2.5 px-4 text-right">Cumul (m)</th>
                  <th className="py-2.5 px-4 text-right">Part</th>
                  <th className="py-2.5 px-4 text-right">Poids</th>
                  <th className="py-2.5 px-4 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {filteredIntervalRows.map((row) => {
                  const isHighlighted =
                    lastFeedback?.boundMatched === row.bound &&
                    row.accumulatedLength > 0;
                  const hasSharedDev = row.hasSharedDev;

                  return (
                    <tr
                      key={row.id}
                      className={`transition-colors ${
                        hasSharedDev
                          ? ROW_SHARED
                          : isHighlighted
                          ? 'bg-[#3ca7da]/10 font-semibold'
                          : row.accumulatedLength > 0
                          ? 'bg-white hover:bg-slate-50/80'
                          : 'bg-[#f8fafc]/50 hover:bg-slate-50 text-slate-400'
                      }`}
                    >
                      <td className={`py-2 px-4 font-bold text-[#282828] ${hasSharedDev ? CELL_SHARED_EDGE : ''}`}>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="tabular-nums font-mono text-sm">{row.bound}</span> mm
                          {hasSharedDev && <SharedBadge label="Même dév" materials={[]} />}
                        </div>
                      </td>
                      <td className="py-2 px-4">
                        {renderMaterialBadge(row.material, row.count === 0)}
                      </td>
                      <td className="py-2 px-4 text-[11px]">
                        {preset === 'DEV_BOBINE' && row.count === 0 ? (
                          <span className="font-sans text-slate-400">
                            {row.bound === 600 && 'Zinc : Naturel · ATZ · Quartz'}
                            {row.bound === 650 && 'Alu 0.7 : RAL 9005 · 7039'}
                            {row.bound === 670 && 'Zinc : Naturel · ATZ · Quartz · Pigmento Rouge'}
                            {row.bound === 750 && 'Zinc : Naturel · ATZ · Quartz'}
                            {row.bound === 1000 && 'Zinc & Alu : toutes nuances'}
                            {row.bound === 1100 && 'Zinc 0.7 / 0.8 : Naturel · ATZ · Quartz'}
                          </span>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {row.entries.map((entry) => {
                              const isEntryShared = entry.isShared;
                              return (
                                <span
                                  key={entry.id}
                                  className={`inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border ${
                                    isEntryShared
                                      ? 'bg-amber-100/80 text-amber-900 border-amber-300 font-bold'
                                      : 'bg-slate-100 text-slate-700 border-slate-200'
                                  }`}
                                  title={
                                    isEntryShared
                                      ? `Dév ${entry.dev} mm également présent dans d'autres matières !`
                                      : undefined
                                  }
                                >
                                  <span className="font-bold text-[#00478a]">
                                    {entry.dev}mm
                                  </span>
                                  {isEntryShared && (
                                    <span className="text-[9px] px-1 py-0.2 bg-amber-200 rounded font-black text-amber-900">
                                      Même Dév
                                    </span>
                                  )}
                                  <span className="text-slate-500 font-normal">
                                    ({entry.quantity}×{entry.unitLength}m)
                                  </span>
                                </span>
                              );
                            })}
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
                          <DeleteButton
                            title={`Supprimer Borne ${row.bound} mm (${row.material})`}
                            onClick={() => handleResetIntervalRow(row.bound, row.material)}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}

              </tbody>
            </table>
          )}

          {/* Unified Table Footer */}
          <table className="w-full text-left text-xs">
            <tfoot className="bg-slate-100 text-[#282828] font-bold border-t border-slate-200">
              <tr>
                <td className="py-2.5 px-4 uppercase text-[11px] tracking-wider text-[#00478a] w-1/4">
                  <div>
                    <span>Total Général</span>
                    {materialsSummary.length > 1 && (
                      <div className="text-[10px] font-normal text-slate-500 font-sans mt-0.5">
                        {aluSummary.count > 0 && `Alu: ${aluSummary.lengthM}m (${aluSummary.weightKg}kg)`}
                        {aluSummary.count > 0 && zincSummary.count > 0 && ' · '}
                        {zincSummary.count > 0 && `Zinc: ${zincSummary.lengthM}m (${zincSummary.weightKg}kg)`}
                      </div>
                    )}
                  </div>
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
                <td className="py-2.5 px-4 w-12"></td>
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

      </div>

      <VisualPreEncoderModal
        isOpen={isVisualModalOpen}
        onClose={() => setIsVisualModalOpen(false)}
        onImportPieces={handleImportPiecesFromVisual}
        targetMode="calculator"
        currentDefaultMaterial={activeMaterial}
      />

      {/* Compact History Log */}
      {!isCoilMode && entriesHistory.length > 0 && (
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
                    <DeleteButton title="Supprimer cette saisie" onClick={() => handleDeleteHistoryEntry(item.id)} />
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
