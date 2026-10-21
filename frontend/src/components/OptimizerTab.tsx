import React, { useState, useEffect, useMemo } from 'react';
import {
  FileText,
  Upload,
  Plus,
  Trash2,
  RefreshCw,
  Sparkles,
  Layers,
  CheckCircle2,
  AlertTriangle,
  Printer,
  Sliders,
  Scissors,
  ArrowRight,
  Info,
  RotateCcw,
  Zap,
} from 'lucide-react';
import {
  ShapedPiece,
  OptimizationResult,
  MaterialType,
  STANDARD_MATERIALS,
  MATERIAL_GROUPS,
  WorkshopScrapProposal,
} from '../types';
import {
  runOptimization,
  getMaterialDensity,
  getMaterialWeightDetails,
  resolveAutoPieceBreakdown,
  AutoPieceBreakdown,
  STANDARD_WORKSHOP_SCRAP_WIDTHS,
  STANDARD_ZINC_MOTHER_WIDTHS,
  STANDARD_ALU_MOTHER_WIDTHS,
} from '../utils/optimizer';
import { WorkshopPrintModal, WorkshopJobData } from './WorkshopPrintModal';
import { cleanWorkshopText } from '../utils/textCleaner';
import { VisualPreEncoderModal } from './VisualPreEncoderModal';
import {
  optimizerApi,
  aiApi,
  ApiError,
  mapBackendOptimizationToResult,
  mapShapedPieceToModel,
} from '../api';
import { CuttingPlan2D } from './CuttingPlan2D';

interface OptimizerTabProps {
  initialPieces?: ShapedPiece[];
}

export const OptimizerTab: React.FC<OptimizerTabProps> = ({ initialPieces = [] }) => {
  // Visual Pre-Encoder Modal State
  const [isVisualModalOpen, setIsVisualModalOpen] = useState<boolean>(false);

  // Client and job metadata
  const [clientName, setClientName] = useState<string>('Client Comptoir Facozinc');
  const [chantierRef, setChantierRef] = useState<string>('Chantier Standard');

  // Pieces to optimize
  const [pieces, setPieces] = useState<ShapedPiece[]>([]);

  // Selected default material for optimization
  const [selectedMaterial, setSelectedMaterial] = useState<string>('Zinc Naturel 0.7');

  // Candidate mother widths for optimization
  const [selectedZincWidths, setSelectedZincWidths] = useState<number[]>([600, 650, 670, 750, 1000]);
  const [selectedAluWidths, setSelectedAluWidths] = useState<number[]>([600, 650, 670, 750, 1000]);

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
  const [calculationTimeMs, setCalculationTimeMs] = useState<number | null>(null);
  const [calculationError, setCalculationError] = useState<string | null>(null);
  const [isPrintingSheet, setIsPrintingSheet] = useState<boolean>(false);

  // Manual piece entry form
  const [newLabel, setNewLabel] = useState<string>('');
  const [newDev, setNewDev] = useState<string>('150');
  const [newLength, setNewLength] = useState<string>('2.0');
  const [newQty, setNewQty] = useState<string>('1');
  const [newBends, setNewBends] = useState<string>('2');
  const [newMat, setNewMat] = useState<string>('Zinc Naturel 0.7');
  const [selectedForcedLength, setSelectedForcedLength] = useState<number | undefined>(undefined);

  // Notice and feedback message (replaces alert)
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // PDF / Document Analysis State
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [uploadedFilePreview, setUploadedFilePreview] = useState<string | null>(null);
  const [analyzingStep, setAnalyzingStep] = useState<string>('');
  const [aiObservations, setAiObservations] = useState<string | null>(null);

  // Gemini AI Advisory State
  const [isAiAdvisoryLoading, setIsAiAdvisoryLoading] = useState<boolean>(false);
  const [aiAdvisory, setAiAdvisory] = useState<string | null>(null);

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

      setActionNotice(`${cleaned.length} pièce(s) transférée(s) avec succès depuis le Calculateur.`);
    }
  }, [initialPieces]);

  const isAlu = useMemo(() => /alu/i.test(selectedMaterial), [selectedMaterial]);

  // Active mother widths
  const activeMotherWidths = useMemo(() => {
    return isAlu ? selectedAluWidths : selectedZincWidths;
  }, [isAlu, selectedAluWidths, selectedZincWidths]);

  // Mode Auto-Métrage (activé quand Quantité = 0)
  const isAutoMeterMode = newQty.trim() === '0';
  const autoBreakdown = useMemo(() => {
    if (!isAutoMeterMode) return null;
    const meters = parseFloat(newLength);
    if (isNaN(meters) || meters <= 0) return null;
    return resolveAutoPieceBreakdown(meters, pieces, newMat || selectedMaterial, selectedForcedLength);
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
        available_mother_widths: activeMotherWidths,
        use_workshop_scraps: withScraps,
        use_generated_scraps: withGeneratedScraps,
        accepted_proposal_ids: propIds,
      });

      setCalculationTimeMs(response.executionTimeMs);
      const res = mapBackendOptimizationToResult(response.data, currentPieces);
      setOptimizationResult(res);
    } catch (err: any) {
      console.error('Erreur optimisation API:', err);
      const msg = err instanceof ApiError ? err.message : err.message || "Erreur lors du calcul d'imbrication";
      setCalculationError(msg);
    } finally {
      setIsCalculating(false);
    }
  };

  const handlePrintOfficialA4Sheet = async () => {
    if (pieces.length === 0) return;
    setIsPrintingSheet(true);
    try {
      const { text: htmlContent } = await optimizerApi.getPrintSheetHtml({
        client_name: clientName || 'Client Comptoir',
        chantier_ref: chantierRef || 'Chantier Standard',
        material: selectedMaterial,
        pieces: pieces.map(mapShapedPieceToModel),
        available_mother_widths: activeMotherWidths,
        use_workshop_scraps: useWorkshopScraps,
        use_generated_scraps: useGeneratedScraps,
        accepted_proposal_ids: acceptedProposalIds,
      });

      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.open();
        printWindow.document.write(htmlContent);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => {
          printWindow.print();
        }, 300);
      }
    } catch (err: any) {
      setActionNotice(`Erreur lors de la génération de la fiche d'impression : ${err.message}`);
    } finally {
      setIsPrintingSheet(false);
    }
  };

  // Re-run optimization when pieces or widths change
  useEffect(() => {
    calculateOptimization(pieces, useWorkshopScraps, acceptedProposalIds, useGeneratedScraps);
  }, [pieces, activeMotherWidths, selectedMaterial, useWorkshopScraps, acceptedProposalIds, useGeneratedScraps]);

  // Toggle Mother Width
  const handleToggleMotherWidth = (width: number) => {
    if (isAlu) {
      setSelectedAluWidths((prev) =>
        prev.includes(width) ? prev.filter((w) => w !== width) : [...prev, width].sort((a, b) => a - b)
      );
    } else {
      setSelectedZincWidths((prev) =>
        prev.includes(width) ? prev.filter((w) => w !== width) : [...prev, width].sort((a, b) => a - b)
      );
    }
  };

  // Aggregated summary of mother sheets to pull from stock, grouped by material and dimensions
  const sheetsRecapByMaterial = useMemo(() => {
    if (
      !optimizationResult ||
      !optimizationResult.motherItemsNeeded ||
      optimizationResult.motherItemsNeeded.length === 0
    ) {
      return [];
    }

    const matMap = new Map<
      string,
      {
        material: string;
        density: number;
        formats: Map<
          string,
          {
            motherWidth: number;
            motherLength: number;
            count: number;
            totalLengthM: number;
            totalSurfaceM2: number;
            totalWeightKg: number;
            piecesProduced: { label: string; dev: number; count: number }[];
          }
        >;
        totalSheets: number;
        totalLengthM: number;
        totalSurfaceM2: number;
        totalWeightKg: number;
      }
    >();

    for (const mItem of optimizationResult.motherItemsNeeded) {
      // Les reprises sur chutes déjà sorties (REUSED_OFFCUT) ne nécessitent pas de sortir une nouvelle feuille au magasin
      if (mItem.slits[0]?.sourceType === 'REUSED_OFFCUT') {
        continue;
      }

      const mat = mItem.material || selectedMaterial || 'Zinc Quartz 0.7';
      const density = getMaterialDensity(mat);

      if (!matMap.has(mat)) {
        matMap.set(mat, {
          material: mat,
          density,
          formats: new Map(),
          totalSheets: 0,
          totalLengthM: 0,
          totalSurfaceM2: 0,
          totalWeightKg: 0,
        });
      }

      const matEntry = matMap.get(mat)!;
      matEntry.totalSheets += 1;
      matEntry.totalLengthM += mItem.motherLength;
      const sheetSurf = (mItem.motherWidth / 1000) * mItem.motherLength;
      matEntry.totalSurfaceM2 += sheetSurf;
      matEntry.totalWeightKg += sheetSurf * density;

      const formatKey = `${mItem.motherWidth}__${mItem.motherLength}`;
      if (!matEntry.formats.has(formatKey)) {
        matEntry.formats.set(formatKey, {
          motherWidth: mItem.motherWidth,
          motherLength: mItem.motherLength,
          count: 0,
          totalLengthM: 0,
          totalSurfaceM2: 0,
          totalWeightKg: 0,
          piecesProduced: [],
        });
      }

      const formatEntry = matEntry.formats.get(formatKey)!;
      formatEntry.count += 1;
      formatEntry.totalLengthM += mItem.motherLength;
      formatEntry.totalSurfaceM2 += sheetSurf;
      formatEntry.totalWeightKg += sheetSurf * density;

      for (const slit of mItem.slits) {
        for (const strip of slit.strips) {
          const existing = formatEntry.piecesProduced.find(
            (p) => p.label === strip.label && p.dev === strip.dev
          );
          if (existing) {
            existing.count += strip.qty || 1;
          } else {
            formatEntry.piecesProduced.push({
              label: strip.label,
              dev: strip.dev,
              count: strip.qty || 1,
            });
          }
        }
      }
    }

    return Array.from(matMap.values()).map((matGroup) => ({
      ...matGroup,
      totalSurfaceM2: Math.round(matGroup.totalSurfaceM2 * 100) / 100,
      totalLengthM: Math.round(matGroup.totalLengthM * 100) / 100,
      totalWeightKg: Math.round(matGroup.totalWeightKg * 10) / 10,
      formatList: Array.from(matGroup.formats.values()).map((f) => ({
        ...f,
        totalSurfaceM2: Math.round(f.totalSurfaceM2 * 100) / 100,
        totalLengthM: Math.round(f.totalLengthM * 100) / 100,
        totalWeightKg: Math.round(f.totalWeightKg * 10) / 10,
      })),
    }));
  }, [optimizationResult, selectedMaterial]);

  const grandTotalSheets = useMemo(
    () => sheetsRecapByMaterial.reduce((acc, m) => acc + m.totalSheets, 0),
    [sheetsRecapByMaterial]
  );
  const grandTotalMeters = useMemo(
    () =>
      Math.round(
        sheetsRecapByMaterial.reduce((acc, m) => acc + m.totalLengthM, 0) * 100
      ) / 100,
    [sheetsRecapByMaterial]
  );
  const grandTotalSurface = useMemo(
    () =>
      Math.round(
        sheetsRecapByMaterial.reduce((acc, m) => acc + m.totalSurfaceM2, 0) * 100
      ) / 100,
    [sheetsRecapByMaterial]
  );
  const grandTotalWeight = useMemo(
    () =>
      Math.round(
        sheetsRecapByMaterial.reduce((acc, m) => acc + m.totalWeightKg, 0) * 10
      ) / 10,
    [sheetsRecapByMaterial]
  );

  // Add piece manually (supports Quantité = 0 for auto meterage sizing)
  const handleAddPiece = (e: React.FormEvent) => {
    e.preventDefault();
    const devNum = parseFloat(newDev);
    const lenNum = parseFloat(newLength);
    const qtyNum = parseInt(newQty, 10);
    const bendsNum = parseInt(newBends, 10) || 2;

    if (isNaN(devNum) || devNum <= 0 || isNaN(lenNum) || lenNum <= 0 || isNaN(qtyNum) || qtyNum < 0) {
      setActionNotice('Veuillez saisir un développement et une longueur/métrage valides.');
      return;
    }

    let finalLength = lenNum;
    let finalQty = qtyNum;
    let originalRequested: number | undefined = undefined;
    let splitReason = `Saisie manuelle : ${qtyNum} pcs × ${lenNum}m`;

    if (qtyNum === 0) {
      // Auto meterage breakdown mode
      const breakdown = resolveAutoPieceBreakdown(
        lenNum,
        pieces,
        newMat || selectedMaterial,
        selectedForcedLength
      );
      finalLength = breakdown.length;
      finalQty = breakdown.quantity;
      originalRequested = lenNum;
      splitReason = breakdown.reason;
    }

    const newPiece: ShapedPiece = {
      id: `p-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      label: newLabel.trim() || `Façonnage Dév ${devNum} mm`,
      dev: devNum,
      length: finalLength,
      quantity: finalQty,
      bends: bendsNum,
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
    setPieces((prev) => prev.filter((p) => p.id !== id));
  };

  // Clear all pieces
  const handleClearPieces = () => {
    setPieces([]);
    setOptimizationResult(null);
    setAcceptedProposalIds([]);
    setUseWorkshopScraps(false);
    setActionNotice('Toutes les pièces ont été réinitialisées.');
  };

  // Toggle Scrap Proposal
  const handleToggleProposal = (propId: string) => {
    if (acceptedProposalIds.includes(propId)) {
      setAcceptedProposalIds((prev) => prev.filter((id) => id !== propId));
    } else {
      setAcceptedProposalIds((prev) => [...prev, propId]);
      setUseWorkshopScraps(true);
    }
  };

  // Accept all scrap proposals
  const handleAcceptAllProposals = () => {
    if (!optimizationResult?.workshopScrapProposals) return;
    const allIds = optimizationResult.workshopScrapProposals.map((p) => p.id);
    setAcceptedProposalIds(allIds);
    setUseWorkshopScraps(true);
    setActionNotice('Toutes les suggestions de chutes d\'atelier ont été appliquées.');
  };

  // Reset to 100% calculation without scraps
  const handleResetToWithoutScraps = () => {
    setUseWorkshopScraps(false);
    setAcceptedProposalIds([]);
    setActionNotice('Calcul réinitialisé 100% sur feuilles et bobines neuves (Sans chute).');
  };

// Helper: optimize and scale down enormous camera photos in browser for rapid, crystal-clear Gemini OCR
async function optimizeImageForOcr(file: File): Promise<{ base64: string; mimeType: string; previewUrl: string }> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (isPdf) {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    return { base64, mimeType: 'application/pdf', previewUrl: '' };
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const rawUrl = e.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const MAX_DIM = 2048;
        let { width, height } = img;
        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          } else {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({ base64: rawUrl, mimeType: file.type || 'image/jpeg', previewUrl: rawUrl });
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const optimized = canvas.toDataURL('image/jpeg', 0.92);
        resolve({ base64: optimized, mimeType: 'image/jpeg', previewUrl: optimized });
      };
      img.onerror = () => {
        resolve({ base64: rawUrl, mimeType: file.type || 'image/jpeg', previewUrl: rawUrl });
      };
      img.src = rawUrl;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

  // PDF Plan & Photo upload & AI extraction (supports camera, photos, PDFs)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsAnalyzing(true);
    setAnalysisError(null);
    setAiObservations(null);
    setUploadedFileName(file.name);
    setAnalyzingStep("Optimisation de l'image / lecture du document...");

    try {
      const { base64, mimeType, previewUrl } = await optimizeImageForOcr(file);
      setUploadedFilePreview(previewUrl || null);

      setAnalyzingStep("Analyse multimodale IA par Gemini (détection des profils, cotes et plis)...");

      const response = await aiApi.parseDocument({
        file_base64: base64,
        mime_type: mimeType,
        standard_length: 2.0,
      });

      const data = response.data;

      if (data.raw_observations) {
        setAiObservations(data.raw_observations);
      } else if (data.notes) {
        setAiObservations(data.notes);
      }

      if (data.pieces && data.pieces.length > 0) {
        const cleaned: ShapedPiece[] = data.pieces.map((p: any, idx: number) => ({
          id: p.id || `p-${Date.now()}-${idx}`,
          label: cleanWorkshopText(p.label || 'Pièce façonnée'),
          dev: Number(p.dev) || 150,
          length: Number(p.length) || 2.0,
          quantity: Number(p.quantity) || 1,
          bends: Number(p.bends) || 2,
          material: p.material || selectedMaterial,
          workshopSplitReason: cleanWorkshopText(p.workshopSplitReason || `Importé depuis ${file.name}`),
        }));
        setPieces((prev) => [...prev, ...cleaned]);
        if (data.client) setClientName(cleanWorkshopText(data.client));
        if (data.chantier) setChantierRef(cleanWorkshopText(data.chantier));
        if (data.detected_finish && STANDARD_MATERIALS.includes(data.detected_finish)) {
          setSelectedMaterial(data.detected_finish);
          setNewMat(data.detected_finish);
        }
        setActionNotice(`${cleaned.length} pièce(s) détectée(s) et importée(s) avec succès depuis ${file.name}.`);
      } else {
        setAnalysisError(
          data.notes ||
            'Aucune pièce exploitable n\'a été détectée. Veuillez fournir une photo bien nette, éclairée et contrastée de vos profils ou croquis.'
        );
      }
    } catch (err: any) {
      console.error(err);
      setAnalysisError(err?.message || 'Échec de l\'analyse du document ou de la photo. Vérifiez le format.');
    } finally {
      setIsAnalyzing(false);
      setAnalyzingStep('');
      e.target.value = '';
    }
  };

  // Ask Gemini Workshop Advisor
  const handleRequestAiAdvisory = async () => {
    if (!optimizationResult) return;
    setIsAiAdvisoryLoading(true);

    try {
      const prompt = `Tu es le chef d'atelier de pliage et façonnage zinc et alu chez Facozinc.
Voici les détails du plan de débit optimisé :
Matière : ${selectedMaterial}
Nombre de pièces : ${pieces.length}
Surfaces : Nette ${optimizationResult.totalNetSurfaceM2} m² / Brute ${optimizationResult.totalGrossSurfaceM2} m²
Rendement : ${optimizationResult.materialEfficiencyRate}%
Bobines débitées : ${optimizationResult.motherItemsNeeded.length} opérations.
Suggestions de chutes rack atelier (100, 120, 150, 200, 250 mm) : ${optimizationResult.workshopScrapProposals?.length || 0} proposition(s).

Donne 3 à 4 consignes concrètes et précises pour l'opérateur de la refendeuse et de la plieuse :
1. Ordre de refente conseillé
2. Précautions machine (sens de laminage, pression des molettes, bavures)
3. Gestion des chutes de rives
Sois direct, pro et concis en français.`;

      const response = await fetch('/api/gemini-advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });

      if (response.ok) {
        const result = await response.json();
        setAiAdvisory(result.text || 'Conseil atelier généré.');
      } else {
        setAiAdvisory(
          `Conseils Atelier :
• Refendre en premier les largeurs les plus importantes pour stabiliser la bande dans la cisaille.
• Température atelier minimum 10°C pour éviter les micro-fissures sur le zinc.
• Vérifier le jeu de refente : molettes affûtées pour éviter toute amorce de déchirure sur les plis serrés.`
        );
      }
    } catch (err) {
      setAiAdvisory(
        `Conseils Atelier :
• Refendre en premier les largeurs les plus importantes pour stabiliser la bande dans la cisaille.
• Température atelier minimum 10°C pour éviter les micro-fissures sur le zinc.
• Vérifier le jeu de refente : molettes affûtées pour éviter toute amorce de déchirure sur les plis serrés.`
      );
    } finally {
      setIsAiAdvisoryLoading(false);
    }
  };

  const totalPiecesCount = useMemo(() => {
    return pieces.reduce((sum, p) => sum + p.quantity, 0);
  }, [pieces]);

  const totalLinearMeters = useMemo(() => {
    return pieces.reduce((sum, p) => sum + p.length * p.quantity, 0);
  }, [pieces]);

  const printableJob: WorkshopJobData = {
    code: `FZ-DEBIT-${new Date().getFullYear()}`,
    client: clientName,
    chantier: chantierRef,
    date: new Date().toISOString().split('T')[0],
    material: isAlu ? 'ALUMINIUM' : 'ZINC',
    finish: selectedMaterial,
    thickness: /0\.7/.test(selectedMaterial) ? '0.7' : '0.8',
    pieces,
  };

  return (
    <div className="space-y-5">
      {/* Top Notice */}
      {actionNotice && (
        <div className="bg-[#f0f7fc] border border-[#b9dcf2] text-[#00478a] px-4 py-2.5 rounded-lg flex items-center justify-between text-xs shadow-xs animate-in fade-in">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-[#00478a] shrink-0" />
            <span className="font-medium">{actionNotice}</span>
          </div>
          <button
            onClick={() => setActionNotice(null)}
            className="text-slate-400 hover:text-slate-700 font-bold ml-3 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Header / Job Controls (Compact Single Card) */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3.5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#00478a]" />
            <h2 className="text-base font-bold text-[#282828] tracking-tight">
              Optimiseur de Refente &amp; Feuilles Mères
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => calculateOptimization()}
              disabled={isCalculating || pieces.length === 0}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 border border-slate-200 transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#00478a] ${isCalculating ? 'animate-spin' : ''}`} />
              <span>{isCalculating ? 'Calcul...' : 'Recalculer'}</span>
              {calculationTimeMs !== null && !isCalculating && (
                <span className="text-[10px] text-slate-400 font-mono">({calculationTimeMs}ms)</span>
              )}
            </button>

            <button
              type="button"
              onClick={handlePrintOfficialA4Sheet}
              disabled={isPrintingSheet || pieces.length === 0}
              className="px-3.5 py-1.5 bg-[#e7511f] hover:bg-[#cf4315] disabled:opacity-40 text-white font-bold text-xs rounded-lg flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
              title="Génère et imprime la fiche d'atelier A4 officielle"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>{isPrintingSheet ? 'Génération A4...' : 'Imprimer Fiche A4'}</span>
            </button>

            <button
              type="button"
              onClick={() => setIsPrintModalOpen(true)}
              disabled={pieces.length === 0}
              className="px-3 py-1.5 bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-600 hover:text-slate-900 rounded-lg text-xs font-semibold flex items-center gap-1.5 border border-slate-200 transition-colors cursor-pointer"
            >
              <span>Aperçu</span>
            </button>
          </div>
        </div>

        {/* Client, Chantier & Mother Widths */}
        <div className="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
          <div>
            <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1 tracking-wider">
              Client
            </label>
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-[#00478a] focus:bg-white"
            />
          </div>

          <div>
            <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1 tracking-wider">
              Référence Chantier
            </label>
            <input
              type="text"
              value={chantierRef}
              onChange={(e) => setChantierRef(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-[#00478a] focus:bg-white"
            />
          </div>

          <div>
            <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1 tracking-wider">
              Largeurs Bobines Atelier
            </label>
            <div className="flex flex-wrap gap-1">
              {(isAlu ? STANDARD_ALU_MOTHER_WIDTHS : STANDARD_ZINC_MOTHER_WIDTHS).map((w) => {
                const isActive = activeMotherWidths.includes(w);
                return (
                  <button
                    key={w}
                    type="button"
                    onClick={() => handleToggleMotherWidth(w)}
                    className={`px-2 py-1 rounded text-[11px] font-mono font-semibold transition-colors cursor-pointer border ${
                      isActive
                        ? 'bg-[#00478a] text-white border-[#00478a]'
                        : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100 hover:text-slate-800'
                    }`}
                    title={isActive ? 'Désactiver cette largeur' : 'Activer cette largeur'}
                  >
                    {w}mm
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {calculationError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 flex items-center justify-between gap-3 text-red-700 text-xs">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <div>
              <strong className="font-bold mr-1">Erreur :</strong>
              <span>{calculationError}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCalculationError(null)}
            className="text-red-600 hover:text-red-800 text-xs px-2 py-1 rounded bg-white border border-red-200 cursor-pointer"
          >
            Fermer
          </button>
        </div>
      )}

      {/* SECTION 1: Pièces à Débiter */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <Layers className="w-4 h-4 text-[#00478a]" />
            <h3 className="text-sm font-bold text-[#282828]">
              Pièces à Débiter
            </h3>
            <span className="text-xs font-mono text-[#00478a] font-semibold px-2 py-0.5 rounded bg-[#f0f7fc] border border-[#b9dcf2]">
              {totalPiecesCount} pc · {totalLinearMeters.toFixed(2)} ml
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsVisualModalOpen(true)}
              className="px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg flex items-center gap-1.5 border border-slate-200 transition-colors cursor-pointer"
              title="Importer un plan PDF ou une photo de croquis"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#00478a]" />
              <span>Importer PDF / Photo</span>
            </button>

            {pieces.length > 0 && (
              <button
                type="button"
                onClick={handleClearPieces}
                className="px-2.5 py-1.5 bg-white hover:bg-red-50 text-slate-500 hover:text-red-600 border border-slate-200 hover:border-red-200 text-xs font-semibold rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                title="Vider la liste des pièces"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Vider</span>
              </button>
            )}
          </div>
        </div>

        {analysisError && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{analysisError}</span>
          </div>
        )}

        {/* Piece Table */}
        {pieces.length === 0 ? (
          <div className="p-6 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-lg bg-slate-50/50">
            Aucune pièce encodée. Ajoutez vos pièces ci-dessous ou transférez-les depuis le Calculateur.
          </div>
        ) : (
          <div
            className="table-wrapper border border-slate-200 rounded-lg"
            tabIndex={0}
            role="region"
            aria-label="Liste des pièces à débiter"
          >
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px] border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3">Désignation</th>
                  <th className="py-2.5 px-3 text-right">Dév (mm)</th>
                  <th className="py-2.5 px-3 text-right">Long. (m)</th>
                  <th className="py-2.5 px-3 text-right">Qté</th>
                  <th className="py-2.5 px-3">Matière</th>
                  <th className="py-2.5 px-3 text-center" title="Débit sur bobine mère ou prélèvement sur chute rack (raccourci : touche C)">
                    Origine Atelier
                  </th>
                  <th className="py-2.5 px-3 text-right">Métrage</th>
                  <th className="py-2.5 px-3 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {pieces.map((p) => (
                  <tr
                    key={p.id}
                    onMouseEnter={() => setHoveredPieceId(p.id)}
                    onMouseLeave={() => setHoveredPieceId(null)}
                    className="hover:bg-slate-50/80 transition-colors"
                  >
                    <td className="py-2 px-3 font-sans text-slate-800 font-medium">
                      {p.label}
                      {p.workshopSplitReason && (
                        <span className="block text-[10px] text-slate-400 font-normal">
                          {p.workshopSplitReason}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right text-[#00478a] font-bold">{p.dev} mm</td>
                    <td className="py-2 px-3 text-right text-slate-600">{p.length} m</td>
                    <td className="py-2 px-3 text-right text-slate-900 font-bold">
                      <div>{p.quantity}</div>
                      {p.originalTotalLengthRequested && (
                        <span
                          className="block text-[9px] font-sans font-normal text-[#00478a] whitespace-nowrap"
                          title={`Métrage total initialement demandé : ${p.originalTotalLengthRequested}m`}
                        >
                          ({p.originalTotalLengthRequested}m auto)
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 font-sans text-[11px]">
                      <select
                        value={p.material || selectedMaterial}
                        onChange={(e) => {
                          const updatedMat = e.target.value;
                          setPieces((prev) =>
                            prev.map((item) => (item.id === p.id ? { ...item, material: updatedMat } : item))
                          );
                        }}
                        className="bg-white border border-slate-200 rounded px-1.5 py-0.5 text-slate-700 text-xs focus:outline-none focus:border-[#00478a] cursor-pointer"
                        title="Modifier la matière de cette pièce"
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
                    </td>
                    <td className="py-2 px-3 text-center">
                      {p.sourceType === 'RACK_SCRAP' ? (
                        <div className="inline-flex items-center justify-center gap-1.5 flex-wrap">
                          <span className="px-2 py-0.5 rounded text-[11px] font-sans font-semibold bg-amber-50 text-amber-800 border border-amber-200 inline-flex items-center gap-1">
                            <Scissors className="w-3 h-3 text-amber-700" />
                            <span>
                              Chute Rack ({[100, 120, 150, 200, 250].find((w) => w >= p.dev) || Math.max(250, p.dev)} mm)
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => handleMovePieceUnits(p.id, 'BOBINE', 1)}
                            className="px-2 py-0.5 rounded text-[10px] font-sans font-semibold bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 inline-flex items-center gap-1 transition-colors cursor-pointer"
                            title={
                              p.quantity > 1
                                ? 'Remettre 1 seul exemplaire sur bobine mère (raccourci : C)'
                                : 'Remettre cette pièce sur bobine mère (raccourci : C)'
                            }
                          >
                            <RotateCcw className="w-2.5 h-2.5 text-[#00478a]" />
                            <span>{p.quantity > 1 ? '1x bobine' : '↩ Bobine'}</span>
                          </button>
                          {p.quantity > 1 && (
                            <button
                              type="button"
                              onClick={() => handleMovePieceUnits(p.id, 'BOBINE', p.quantity)}
                              className="px-1.5 py-0.5 rounded text-[10px] font-sans font-medium bg-slate-50 hover:bg-slate-100 text-slate-500 hover:text-slate-800 border border-slate-200 transition-colors cursor-pointer"
                              title={`Remettre les ${p.quantity} exemplaires sur bobine mère (raccourci : Shift+C)`}
                            >
                              Tout ({p.quantity})
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="inline-flex items-center justify-center gap-1.5 flex-wrap">
                          <span className="px-2 py-0.5 rounded text-[11px] font-sans font-medium bg-slate-50 text-slate-600 border border-slate-200 inline-flex items-center gap-1">
                            <Layers className="w-3 h-3 text-slate-400" />
                            <span>Bobine mère</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => handleMovePieceUnits(p.id, 'RACK_SCRAP', 1)}
                            className="px-2 py-0.5 rounded text-[10px] font-sans font-semibold bg-[#f0f7fc] hover:bg-[#00478a] text-[#00478a] hover:text-white border border-[#b9dcf2] hover:border-[#00478a] inline-flex items-center gap-1 transition-all cursor-pointer"
                            title={
                              p.quantity > 1
                                ? `Prendre uniquement 1 pièce en chute rack et laisser ${p.quantity - 1} sur bobine (raccourci : C)`
                                : 'Prendre cette pièce en chute de rack atelier (raccourci : C)'
                            }
                          >
                            <Scissors className="w-2.5 h-2.5" />
                            <span>{p.quantity > 1 ? '+1 en chute' : 'En chute'}</span>
                          </button>
                          {p.quantity > 1 && (
                            <button
                              type="button"
                              onClick={() => handleMovePieceUnits(p.id, 'RACK_SCRAP', p.quantity)}
                              className="px-1.5 py-0.5 rounded text-[10px] font-sans font-medium bg-slate-50 hover:bg-slate-100 text-slate-500 hover:text-[#00478a] border border-slate-200 transition-colors cursor-pointer"
                              title={`Passer les ${p.quantity} exemplaires en chute rack (raccourci : Shift+C)`}
                            >
                              Tout ({p.quantity})
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right text-slate-600">
                      {(p.length * p.quantity).toFixed(2)} m
                    </td>
                    <td className="py-2 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleRemovePiece(p.id)}
                        className="text-slate-400 hover:text-red-600 p-1 transition-colors cursor-pointer"
                        title="Supprimer cette pièce"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Quick Add Form */}
        <form
          onSubmit={handleAddPiece}
          className="bg-slate-50 border border-slate-200 rounded-lg p-3 grid grid-cols-2 sm:grid-cols-6 lg:grid-cols-7 gap-2.5 items-end text-xs"
        >
          <div className="col-span-2">
            <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">
              Libellé pièce
            </label>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Ex: Bavette, Rehausse..."
              className="w-full bg-white border border-slate-300 rounded-md px-2.5 py-1.5 text-slate-800 text-xs focus:outline-none focus:border-[#00478a]"
            />
          </div>

          <div>
            <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">
              Dév (mm)
            </label>
            <input
              type="number"
              value={newDev}
              onChange={(e) => setNewDev(e.target.value)}
              min="20"
              max="2000"
              required
              className="w-full bg-white border border-slate-300 rounded-md px-2.5 py-1.5 text-slate-800 font-mono text-xs focus:outline-none focus:border-[#00478a]"
            />
          </div>

          <div>
            <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">
              {isAutoMeterMode ? 'Métrage total (m)' : 'Longueur (m)'}
            </label>
            <input
              type="number"
              step="0.05"
              value={newLength}
              onChange={(e) => setNewLength(e.target.value)}
              min="0.2"
              placeholder={isAutoMeterMode ? 'Ex: 15.0m' : '2.0'}
              required
              className={`w-full bg-white border rounded-md px-2.5 py-1.5 font-mono text-xs focus:outline-none transition-colors ${
                isAutoMeterMode
                  ? 'border-[#00478a] text-[#00478a] font-bold bg-[#f0f7fc]'
                  : 'border-slate-300 text-slate-800 focus:border-[#00478a]'
              }`}
            />
          </div>

          <div>
            <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">
              Qté <span className="text-[9px] font-normal text-slate-400">(0=auto)</span>
            </label>
            <input
              type="number"
              value={newQty}
              onChange={(e) => {
                setNewQty(e.target.value);
                if (e.target.value !== '0') {
                  setSelectedForcedLength(undefined);
                }
              }}
              min="0"
              placeholder="1 (ou 0)"
              required
              className={`w-full bg-white border rounded-md px-2.5 py-1.5 font-mono text-xs focus:outline-none transition-colors ${
                isAutoMeterMode
                  ? 'border-[#00478a] text-[#00478a] font-bold bg-[#f0f7fc]'
                  : 'border-slate-300 text-slate-800 focus:border-[#00478a]'
              }`}
            />
          </div>

          <div className="col-span-2 sm:col-span-2 lg:col-span-1">
            <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">
              Matière
            </label>
            <select
              value={newMat}
              onChange={(e) => {
                setNewMat(e.target.value);
                setSelectedMaterial(e.target.value);
              }}
              className="w-full bg-white border border-slate-300 rounded-md px-2 py-1.5 text-slate-800 text-xs focus:outline-none focus:border-[#00478a] cursor-pointer"
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
          </div>

          <div className="col-span-2 sm:col-span-6 lg:col-span-1">
            <button
              type="submit"
              className="w-full py-1.5 bg-[#00478a] hover:bg-[#003566] text-white font-semibold rounded-md text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isAutoMeterMode ? 'Ajouter (Auto)' : 'Ajouter'}</span>
            </button>
          </div>

          {/* Interactive Live Auto-Meterage Breakdown */}
          {isAutoMeterMode && autoBreakdown && (
            <div className="col-span-2 sm:col-span-6 lg:col-span-7 bg-[#f0f7fc] border border-[#b9dcf2] rounded-lg p-3 space-y-2 animate-in fade-in">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <Zap className="w-3.5 h-3.5 text-[#00478a] shrink-0" />
                  <span className="font-semibold text-slate-700">
                    Calepinage auto ({autoBreakdown.requestedMeters}m) :
                  </span>
                  <span className="font-mono text-[#00478a] font-bold bg-white px-2 py-0.5 rounded border border-[#b9dcf2]">
                    {autoBreakdown.quantity} × {autoBreakdown.length}m = {autoBreakdown.totalProduced}m
                  </span>
                </div>
                <span className="text-[11px] text-slate-500">
                  {autoBreakdown.reason}
                </span>
              </div>

              {autoBreakdown.alternatives.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-[#d5eaf7]">
                  {autoBreakdown.alternatives.map((alt) => {
                    const isSelected = Math.abs(alt.length - autoBreakdown.length) < 0.01;
                    return (
                      <button
                        key={alt.length}
                        type="button"
                        onClick={() => setSelectedForcedLength(alt.length)}
                        className={`px-2.5 py-1 rounded-md font-mono text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 border ${
                          isSelected
                            ? 'bg-[#00478a] text-white border-[#00478a] shadow-xs'
                            : 'bg-white text-slate-700 hover:bg-slate-50 border-slate-200'
                        }`}
                        title={alt.label}
                      >
                        <span>
                          {alt.quantity} × {alt.length}m
                        </span>
                        <span className="text-[10px] opacity-75">
                          ({alt.totalProduced}m)
                        </span>
                        {alt.isExact && (
                          <span
                            className={`text-[9px] px-1 rounded font-bold ${
                              isSelected ? 'bg-white/20 text-white' : 'bg-emerald-50 text-emerald-700'
                            }`}
                          >
                            Pile
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </form>
      </div>

      {/* SECTION 2: Résultat du Débit & Plan de Refente */}
      {optimizationResult && (
        <div className="space-y-4">
          {/* KPI & Controls Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <h3 className="text-sm font-bold text-[#282828] flex items-center gap-2">
                <Scissors className="w-4 h-4 text-[#00478a]" />
                <span>Synthèse du Débit</span>
              </h3>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setUseGeneratedScraps(!useGeneratedScraps)}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 border transition-all cursor-pointer ${
                    useGeneratedScraps
                      ? 'bg-[#f0f7fc] text-[#00478a] border-[#b9dcf2]'
                      : 'bg-slate-50 text-slate-500 border-slate-200 hover:text-slate-800'
                  }`}
                  title="Réutilise automatiquement les chutes d'opérations plus longues"
                >
                  <Scissors className="w-3 h-3" />
                  <span>
                    {useGeneratedScraps
                      ? 'Réemploi chutes inter-longueurs : Actif'
                      : 'Réemploi chutes inter-longueurs : Inactif'}
                  </span>
                </button>
              </div>
            </div>

            {/* KPI STATS CARDS */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
              <div className="bg-slate-50 border border-slate-200/80 rounded-lg p-3">
                <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                  Feuilles Mères
                </span>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-lg font-bold font-mono text-slate-900">
                    {optimizationResult.motherItemsNeeded.length}
                  </span>
                  <span className="text-xs text-slate-500">bandes</span>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200/80 rounded-lg p-3">
                <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                  Surface Nette
                </span>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-lg font-bold font-mono text-[#00478a]">
                    {optimizationResult.totalNetSurfaceM2.toFixed(2)}
                  </span>
                  <span className="text-xs text-slate-500">m²</span>
                </div>
                <span className="text-[10px] text-slate-400 font-mono block">
                  {optimizationResult.netWeightKg} kg utiles
                </span>
              </div>

              <div className="bg-slate-50 border border-slate-200/80 rounded-lg p-3">
                <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                  Surface Brute
                </span>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-lg font-bold font-mono text-slate-800">
                    {optimizationResult.totalGrossSurfaceM2.toFixed(2)}
                  </span>
                  <span className="text-xs text-slate-500">m²</span>
                </div>
                <span className="text-[10px] text-slate-400 font-mono block">
                  {optimizationResult.grossWeightKg} kg à sortir
                </span>
              </div>

              <div className="bg-slate-50 border border-slate-200/80 rounded-lg p-3">
                <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                  Chutes Rack &ge;100mm
                </span>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-lg font-bold font-mono text-emerald-700">
                    {optimizationResult.reusableScrapSurfaceM2.toFixed(2)}
                  </span>
                  <span className="text-xs text-slate-500">m²</span>
                </div>
                <span className="text-[10px] text-slate-400 font-mono block">
                  {optimizationResult.newReusableScrapsCreated.length} bande(s)
                </span>
              </div>

              <div className="bg-slate-50 border border-slate-200/80 rounded-lg p-3">
                <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                  Perte &lt;100mm
                </span>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-lg font-bold font-mono text-slate-600">
                    {optimizationResult.netLossSurfaceM2.toFixed(2)}
                  </span>
                  <span className="text-xs text-slate-500">m²</span>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200/80 rounded-lg p-3">
                <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                  Rendement
                </span>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-lg font-bold font-mono text-[#00478a]">
                    {optimizationResult.materialEfficiencyRate.toFixed(1)}
                  </span>
                  <span className="text-xs text-slate-500">%</span>
                </div>
              </div>
            </div>

            {/* PIÈCES PRÉLEVÉES SUR CHUTES RACK ATELIER (SI APPLIQUÉ) */}
            {optimizationResult.appliedWorkshopScraps &&
              optimizationResult.appliedWorkshopScraps.length > 0 && (
                <div className="pt-2 border-t border-slate-100 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span>
                        Pièces prélevées sur Chutes Rack ({optimizationResult.appliedWorkshopScraps.length})
                      </span>
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs font-mono">
                    {optimizationResult.appliedWorkshopScraps.map((s, idx) => (
                      <span
                        key={idx}
                        className="px-2.5 py-1 rounded-md bg-amber-50/80 border border-amber-200 text-slate-700 flex items-center gap-1.5"
                      >
                        <span className="font-sans font-semibold text-slate-900">{s.pieceLabel}</span>
                        <span className="text-slate-500">({s.pieceDev}mm · {s.pieceLength}m)</span>
                        <span className="text-amber-800 font-bold">→ Chute {s.scrapDev}mm</span>
                        {s.pieceId && (
                          <button
                            type="button"
                            onClick={() => handleMovePieceUnits(s.pieceId!, 'BOBINE', 1)}
                            className="ml-1 px-1.5 py-0.5 rounded bg-white hover:bg-slate-100 text-slate-600 hover:text-slate-900 border border-slate-200 text-[10px] font-sans font-semibold inline-flex items-center gap-0.5 transition-colors cursor-pointer"
                            title="Remettre uniquement cette pièce (1x) sur bobine mère"
                          >
                            <RotateCcw className="w-2.5 h-2.5 text-[#00478a]" />
                            <span>Remettre 1x sur bobine</span>
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              )}
          </div>

          {/* RÉCAPITULATIF DES FEUILLES SORTIES & LEUR MATIÈRE */}
          {sheetsRecapByMaterial.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <h4 className="text-sm font-bold text-[#282828] flex items-center gap-2">
                  <FileText className="w-4 h-4 text-[#00478a]" />
                  <span>Feuilles / Bobines Mères à Sortir</span>
                </h4>

                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2.5 py-1 bg-[#00478a] text-white font-semibold text-xs rounded-md">
                    {grandTotalSheets} feuille(s)
                  </span>
                  <span className="px-2.5 py-1 bg-slate-100 text-slate-700 font-mono font-semibold text-xs rounded-md border border-slate-200">
                    {grandTotalMeters.toFixed(2)} ml · {grandTotalWeight} kg brut
                  </span>
                </div>
              </div>

              <div className="space-y-3">
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
                              isGroupAlu ? 'bg-[#3ca7da]' : 'bg-[#00478a]'
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
                            <strong className="text-[#00478a]">{matGroup.totalSheets}</strong>{' '}
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
                          <span className="text-[#00478a] font-bold">
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
                          <thead className="bg-slate-50/60 text-slate-500 uppercase tracking-wider text-[10px] border-b border-slate-200">
                            <tr>
                              <th className="py-2 px-3">Format Bobine</th>
                              <th className="py-2 px-3 text-right">Long. Unitaire</th>
                              <th className="py-2 px-3 text-right">Quantité</th>
                              <th className="py-2 px-3 text-right">Métrage</th>
                              <th className="py-2 px-3 text-right">Surface</th>
                              <th className="py-2 px-3 text-right">Poids Brut</th>
                              <th className="py-2 px-3">Pièces Débitées</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                            {matGroup.formatList.map((f, fIdx) => (
                              <tr key={fIdx} className="hover:bg-slate-50/80 transition-colors">
                                <td className="py-2 px-3 font-bold text-[#00478a]">
                                  {f.motherWidth} mm
                                </td>
                                <td className="py-2 px-3 text-right text-slate-600">
                                  {f.motherLength.toFixed(2)} m
                                </td>
                                <td className="py-2 px-3 text-right font-bold">
                                  <span className="px-2 py-0.5 rounded bg-[#f0f7fc] text-[#00478a] border border-[#b9dcf2]">
                                    {f.count} {f.count > 1 ? 'feuilles' : 'feuille'}
                                  </span>
                                </td>
                                <td className="py-2 px-3 text-right text-slate-700">
                                  {f.totalLengthM.toFixed(2)} m
                                </td>
                                <td className="py-2 px-3 text-right text-slate-600">
                                  {f.totalSurfaceM2.toFixed(2)} m²
                                </td>
                                <td className="py-2 px-3 text-right font-bold text-slate-800">
                                  {f.totalWeightKg.toFixed(1)} kg
                                </td>
                                <td className="py-2 px-3 font-sans text-[11px]">
                                  <div className="flex flex-wrap gap-1">
                                    {f.piecesProduced.map((p, pIdx) => (
                                      <span
                                        key={pIdx}
                                        className="bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded text-[10px] text-slate-700"
                                      >
                                        {p.label} ({p.dev}mm) × {p.count}
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
            </div>
          )}

          {/* Visualiseur de Calepinage 2D */}
          <CuttingPlan2D
            motherItems={optimizationResult.motherItemsNeeded}
            selectedMaterial={selectedMaterial}
            onMovePieceToScrap={handleMovePieceToScrap}
          />

          {/* AI ADVISORY PANEL (Compact) */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#00478a]" />
                <h4 className="text-xs font-bold text-slate-700">
                  Conseil Atelier IA
                </h4>
              </div>

              <button
                type="button"
                onClick={handleRequestAiAdvisory}
                disabled={isAiAdvisoryLoading}
                className="px-3 py-1 bg-slate-50 hover:bg-slate-100 text-[#00478a] border border-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Sparkles className="w-3 h-3" />
                <span>{isAiAdvisoryLoading ? 'Analyse...' : 'Analyser le débit'}</span>
              </button>
            </div>

            {aiAdvisory && (
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 space-y-1.5 leading-relaxed font-sans whitespace-pre-line">
                {aiAdvisory}
              </div>
            )}
          </div>
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
    </div>
  );
};
