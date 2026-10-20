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
  const [selectedMaterial, setSelectedMaterial] = useState<string>('Zinc Quartz 0.7');

  // Candidate mother widths for optimization
  const [selectedZincWidths, setSelectedZincWidths] = useState<number[]>([600, 650, 670, 750, 1000]);
  const [selectedAluWidths, setSelectedAluWidths] = useState<number[]>([600, 650, 670, 750, 1000]);

  // Mode: baseline is pure calculation without scraps (100% mother sheets)
  const [useWorkshopScraps, setUseWorkshopScraps] = useState<boolean>(false);
  const [acceptedProposalIds, setAcceptedProposalIds] = useState<string[]>([]);

  // Optimization Result
  const [optimizationResult, setOptimizationResult] = useState<OptimizationResult | null>(null);

  // Manual piece entry form
  const [newLabel, setNewLabel] = useState<string>('');
  const [newDev, setNewDev] = useState<string>('150');
  const [newLength, setNewLength] = useState<string>('2.0');
  const [newQty, setNewQty] = useState<string>('1');
  const [newBends, setNewBends] = useState<string>('2');
  const [newMat, setNewMat] = useState<string>('Zinc Quartz 0.7');
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

  // Core calculation function
  const calculateOptimization = (
    currentPieces = pieces,
    withScraps = useWorkshopScraps,
    propIds = acceptedProposalIds
  ) => {
    if (currentPieces.length === 0) {
      setOptimizationResult(null);
      return;
    }

    const orderMat: MaterialType = isAlu ? 'ALUMINIUM' : 'ZINC';
    const synthThick = /0\.7/i.test(selectedMaterial)
      ? '0.7'
      : /1\.0/i.test(selectedMaterial)
      ? '1.0'
      : '0.8';

    const order = {
      id: `ord-${Date.now()}`,
      code: `FZ-DEBIT-${Date.now().toString().slice(-4)}`,
      client: clientName,
      chantier: chantierRef,
      date: new Date().toISOString().split('T')[0],
      material: orderMat,
      finish: selectedMaterial,
      thickness: synthThick,
      pieces: currentPieces,
      status: 'Brouillon' as const,
    };

    const res = runOptimization(order, undefined, undefined, {
      availableMotherWidths: activeMotherWidths,
      useWorkshopScraps: withScraps,
      acceptedProposalIds: propIds,
    });

    setOptimizationResult(res);
  };

  // Re-run optimization when pieces or widths change
  useEffect(() => {
    calculateOptimization(pieces, useWorkshopScraps, acceptedProposalIds);
  }, [pieces, activeMotherWidths, selectedMaterial, useWorkshopScraps, acceptedProposalIds]);

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

      const response = await fetch('/api/ai/parse-document', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileBase64: base64,
          mimeType,
          fileName: file.name,
          standardLength: 2.0,
        }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        throw new Error(errJson?.error || `Erreur serveur HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.rawObservations) {
        setAiObservations(data.rawObservations);
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
        if (data.detectedFinish && STANDARD_MATERIALS.includes(data.detectedFinish)) {
          setSelectedMaterial(data.detectedFinish);
          setNewMat(data.detectedFinish);
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
    <div className="space-y-6">
      {/* Top Banner / Notice */}
      {actionNotice && (
        <div className="bg-amber-500/15 border border-amber-500/30 text-amber-200 px-4 py-3 rounded-xl flex items-center justify-between text-xs animate-in fade-in">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{actionNotice}</span>
          </div>
          <button
            onClick={() => setActionNotice(null)}
            className="text-amber-400 hover:text-amber-300 font-bold ml-3"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Header / Job Controls */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
              <h2 className="text-lg font-bold text-white tracking-tight">
                Optimiseur de Refente & Feuilles de Bobines
              </h2>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                Zéro Gestion de Stock · Débit Pur
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Optimisation au millimètre du plan de coupe pour minimiser les chutes · Suggestions de chutes d'atelier usuelles (100, 120, 150, 200, 250 mm)
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => calculateOptimization()}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold flex items-center gap-2 border border-slate-700 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5 text-amber-400" />
              <span>Recalculer le Débit</span>
            </button>

            <button
              type="button"
              onClick={() => setIsPrintModalOpen(true)}
              disabled={pieces.length === 0}
              className="px-4 py-2 bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-slate-950 font-bold text-xs rounded-lg flex items-center gap-2 transition-colors shadow-sm"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Imprimer Bon Atelier (A4)</span>
            </button>
          </div>
        </div>

        {/* Client & Chantier Metadata */}
        <div className="mt-4 pt-4 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
          <div>
            <label className="text-[11px] font-semibold text-slate-400 block mb-1">
              Client :
            </label>
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-amber-400"
            />
          </div>

          <div>
            <label className="text-[11px] font-semibold text-slate-400 block mb-1">
              Référence Chantier :
            </label>
            <input
              type="text"
              value={chantierRef}
              onChange={(e) => setChantierRef(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-amber-400"
            />
          </div>

          <div>
            <label className="text-[11px] font-semibold text-slate-400 block mb-1">
              Largeurs de Bobines Atelier :
            </label>
            <div className="flex flex-wrap gap-1">
              {(isAlu ? STANDARD_ALU_MOTHER_WIDTHS : STANDARD_ZINC_MOTHER_WIDTHS).map((w) => {
                const isActive = activeMotherWidths.includes(w);
                return (
                  <button
                    key={w}
                    type="button"
                    onClick={() => handleToggleMotherWidth(w)}
                    className={`px-2 py-1 rounded text-[11px] font-mono font-semibold transition-colors ${
                      isActive
                        ? 'bg-amber-400 text-slate-950 font-bold'
                        : 'bg-slate-800 text-slate-400 hover:text-slate-200'
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

      {/* SECTION 1: Pièces à Façonner (Transférées du Calculateur ou Saisies) */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <Layers className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              1. Pièces à Débiter & Façonner
            </h3>
            <span className="text-xs font-mono text-amber-300 font-bold px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
              {totalPiecesCount} pièce(s) · {totalLinearMeters.toFixed(2)} m linéaires
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsVisualModalOpen(true)}
              className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg flex items-center gap-1.5 border border-slate-700 transition-colors shadow-sm"
              title="Importer un plan PDF ou une photo de croquis avec l'IA Vision"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>Importer Plan PDF / Photo (IA Vision)</span>
            </button>

            {pieces.length > 0 && (
              <button
                type="button"
                onClick={handleClearPieces}
                className="px-3 py-1.5 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/50 text-xs font-semibold rounded-lg flex items-center gap-1 transition-colors"
                title="Vider la liste des pièces"
              >
                <Trash2 className="w-3 h-3" />
                <span>Vider</span>
              </button>
            )}
          </div>
        </div>

        {analysisError && (
          <div className="p-3 bg-rose-950/30 border border-rose-800/40 text-rose-200 text-xs rounded-lg flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{analysisError}</span>
          </div>
        )}

        {/* Piece Table */}
        {pieces.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs border border-dashed border-slate-800 rounded-xl space-y-2">
            <Layers className="w-8 h-8 text-slate-600 mx-auto" />
            <p className="font-semibold text-slate-300">Aucune pièce encodée pour le moment.</p>
            <p className="text-[11px]">
              Allez dans le <strong>Calculateur de Développement</strong> et cliquez sur{' '}
              <span className="text-amber-400">"Transférer vers l'optimiseur"</span>, ou ajoutez vos pièces manuellement ci-dessous.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto border border-slate-800 rounded-xl">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">Désignation</th>
                  <th className="py-2.5 px-3 text-right">Dév (mm)</th>
                  <th className="py-2.5 px-3 text-right">Longueur (m)</th>
                  <th className="py-2.5 px-3 text-right">Quantité</th>
                  <th className="py-2.5 px-3">Matière</th>
                  <th className="py-2.5 px-3 text-right">Métrage Cumulé</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 font-mono">
                {pieces.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-2 px-3 font-sans text-white font-medium">
                      {p.label}
                      {p.workshopSplitReason && (
                        <span className="block text-[10px] text-slate-500 font-normal">
                          {p.workshopSplitReason}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right text-amber-300 font-bold">{p.dev} mm</td>
                    <td className="py-2 px-3 text-right text-slate-200">{p.length} m</td>
                    <td className="py-2 px-3 text-right text-white font-bold">
                      <div>{p.quantity}</div>
                      {p.originalTotalLengthRequested && (
                        <span
                          className="block text-[9px] font-sans font-normal text-amber-300 whitespace-nowrap"
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
                        className="bg-slate-900 border border-slate-700/80 rounded px-1.5 py-0.5 text-slate-200 text-xs focus:outline-none focus:border-amber-400 cursor-pointer"
                        title="Modifier la matière de cette pièce"
                      >
                        {STANDARD_MATERIALS.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 px-3 text-right text-slate-300">
                      {(p.length * p.quantity).toFixed(2)} m
                    </td>
                    <td className="py-2 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleRemovePiece(p.id)}
                        className="text-slate-500 hover:text-rose-400 p-1 transition-colors"
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
          className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 grid grid-cols-2 sm:grid-cols-6 lg:grid-cols-7 gap-2.5 items-end text-xs"
        >
          <div className="col-span-2">
            <label className="text-[10px] uppercase font-semibold text-slate-400 block mb-1">
              Libellé pièce :
            </label>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Ex: Bavette, Rehausse..."
              className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white text-xs focus:outline-none focus:border-amber-400"
            />
          </div>

          <div>
            <label className="text-[10px] uppercase font-semibold text-slate-400 block mb-1">
              Dév (mm) :
            </label>
            <input
              type="number"
              value={newDev}
              onChange={(e) => setNewDev(e.target.value)}
              min="20"
              max="2000"
              required
              className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-amber-400"
            />
          </div>

          <div>
            <label className="text-[10px] uppercase font-semibold text-slate-400 block mb-1">
              {isAutoMeterMode ? 'Métrage total (m) :' : 'Longueur (m) :'}
              {isAutoMeterMode && (
                <span className="text-[9px] text-amber-300 font-bold ml-1 lowercase">(total)</span>
              )}
            </label>
            <input
              type="number"
              step="0.05"
              value={newLength}
              onChange={(e) => setNewLength(e.target.value)}
              min="0.2"
              placeholder={isAutoMeterMode ? 'Ex: 15.0m' : '2.0'}
              required
              className={`w-full bg-slate-900 border rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none transition-colors ${
                isAutoMeterMode
                  ? 'border-amber-400 text-amber-300 font-bold bg-amber-950/20'
                  : 'border-slate-700 focus:border-amber-400'
              }`}
            />
          </div>

          <div>
            <label className="text-[10px] uppercase font-semibold text-slate-400 block mb-1">
              Quantité :
              {isAutoMeterMode && (
                <span className="text-[9px] text-amber-300 font-bold ml-1 lowercase">(0 = auto)</span>
              )}
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
              className={`w-full bg-slate-900 border rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none transition-colors ${
                isAutoMeterMode
                  ? 'border-amber-400 text-amber-300 font-bold bg-amber-950/20'
                  : 'border-slate-700 focus:border-amber-400'
              }`}
            />
          </div>

          <div className="col-span-2 sm:col-span-2 lg:col-span-1">
            <label className="text-[10px] uppercase font-semibold text-slate-400 block mb-1">
              Matière :
            </label>
            <select
              value={newMat}
              onChange={(e) => {
                setNewMat(e.target.value);
                setSelectedMaterial(e.target.value);
              }}
              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-white text-xs focus:outline-none focus:border-amber-400 cursor-pointer"
            >
              {STANDARD_MATERIALS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className="col-span-2 sm:col-span-6 lg:col-span-1">
            <button
              type="submit"
              className="w-full py-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold rounded text-xs flex items-center justify-center gap-1.5 transition-colors shadow-sm cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isAutoMeterMode ? 'Ajouter (Auto)' : 'Ajouter'}</span>
            </button>
          </div>

          {/* Interactive Live Auto-Meterage Breakdown Banner */}
          {isAutoMeterMode && autoBreakdown && (
            <div className="col-span-2 sm:col-span-6 lg:col-span-7 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3.5 space-y-2.5 animate-in fade-in">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <Zap className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="font-bold text-white">
                    Auto-calepinage du métrage ({autoBreakdown.requestedMeters}m demandés) :
                  </span>
                  <span className="font-mono text-amber-300 font-black bg-slate-950 px-2.5 py-0.5 rounded border border-amber-500/40 text-xs shadow-xs">
                    {autoBreakdown.quantity} pièces × {autoBreakdown.length}m = {autoBreakdown.totalProduced}m
                  </span>
                  {autoBreakdown.totalProduced === autoBreakdown.requestedMeters ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Tombe pile juste (0 chute)</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                      <span>Arrondi supérieur (+{(autoBreakdown.totalProduced - autoBreakdown.requestedMeters).toFixed(2)}m)</span>
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-amber-200/90 font-medium">
                  {autoBreakdown.reason}
                </span>
              </div>

              {/* Proposal boxes ("Cases avec les propositions") */}
              {autoBreakdown.alternatives.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-amber-500/20">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-300 text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5">
                      <span>Propositions de formats atelier :</span>
                      <span className="text-slate-500 font-normal lowercase">(cliquez sur une case pour changer)</span>
                    </span>
                    <span className="text-[10px] text-emerald-400 font-medium">
                      ✓ Au moins 1 version tombe pile (0 chute) ou au plus proche
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {autoBreakdown.alternatives.map((alt) => {
                      const isSelected = Math.abs(alt.length - autoBreakdown.length) < 0.01;
                      return (
                        <button
                          key={alt.length}
                          type="button"
                          onClick={() => setSelectedForcedLength(alt.length)}
                          className={`px-3 py-1.5 rounded-lg font-mono text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 border shadow-xs ${
                            isSelected
                              ? 'bg-amber-400 text-slate-950 font-bold border-amber-300 ring-2 ring-amber-400/40 shadow-sm'
                              : alt.isExact
                              ? 'bg-emerald-950/50 text-emerald-200 hover:bg-emerald-900/60 border-emerald-600/50 hover:border-emerald-400'
                              : alt.isClosest
                              ? 'bg-blue-950/50 text-blue-200 hover:bg-blue-900/60 border-blue-500/50 hover:border-blue-400'
                              : alt.isExisting
                              ? 'bg-sky-950/40 text-sky-200 hover:bg-sky-900/60 border-sky-600/50 hover:border-sky-400'
                              : 'bg-slate-900 text-slate-300 hover:text-white hover:bg-slate-800 border-slate-700/80'
                          }`}
                          title={alt.label}
                        >
                          <span className={isSelected ? 'text-slate-950 font-bold' : 'text-white'}>
                            {alt.quantity} × {alt.length}m
                          </span>
                          <span className="text-[10px] opacity-80">
                            ({alt.totalProduced}m)
                          </span>

                          {alt.isExact ? (
                            <span
                              className={`text-[9px] px-1.5 py-0.2 rounded font-bold uppercase tracking-wider ${
                                isSelected
                                  ? 'bg-slate-950 text-emerald-400'
                                  : 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/30'
                              }`}
                            >
                              ✓ Pile
                            </span>
                          ) : alt.isClosest ? (
                            <span
                              className={`text-[9px] px-1.5 py-0.2 rounded font-bold ${
                                isSelected
                                  ? 'bg-slate-950 text-blue-400'
                                  : 'bg-blue-500/25 text-blue-300 border border-blue-500/30'
                              }`}
                            >
                              🎯 Le + proche (+{alt.excess}m)
                            </span>
                          ) : alt.isExisting ? (
                            <span
                              className={`text-[9px] px-1.5 py-0.2 rounded font-bold ${
                                isSelected
                                  ? 'bg-slate-950 text-sky-400'
                                  : 'bg-sky-500/25 text-sky-300 border border-sky-500/30'
                              }`}
                            >
                              ⭐ Débit ({alt.excess > 0 ? `+${alt.excess}m` : '0'})
                            </span>
                          ) : (
                            alt.excess > 0 && (
                              <span
                                className={`text-[9px] px-1.5 py-0.2 rounded ${
                                  isSelected ? 'bg-slate-950/40 text-slate-900' : 'text-slate-400'
                                }`}
                              >
                                +{alt.excess}m chute
                              </span>
                            )
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </form>
      </div>

      {/* SECTION 2: Résultat du Débit & Plan de Refente */}
      {optimizationResult && (
        <div className="space-y-5">
          {/* Section 2 Header & Chute Suggestion Controls */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Scissors className="w-4 h-4 text-amber-400" />
                  <span>Plan de Débit & Refente Optimisé</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Algorithme combinatoire de minimisation de perte sur bobines mères
                </p>
              </div>

              {/* Mode indicator */}
              <div className="flex items-center gap-2">
                <span
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border ${
                    useWorkshopScraps
                      ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800/50'
                      : 'bg-amber-950/40 text-amber-300 border-amber-800/50'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>
                    {useWorkshopScraps
                      ? 'Suggestions Chutes Rack Atelier Actives'
                      : 'Calcul 100% sur Feuilles Neuves (Sans Chute)'}
                  </span>
                </span>
              </div>
            </div>

            {/* SUGGESTION DE CHUTES ATELIER BANNER (100, 120, 150, 200, 250 mm) */}
            {optimizationResult.workshopScrapProposals &&
            optimizationResult.workshopScrapProposals.length > 0 ? (
              <div className="bg-amber-950/30 border border-amber-700/50 rounded-xl p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start sm:items-center gap-2.5">
                    <Zap className="w-5 h-5 text-amber-400 shrink-0 mt-0.5 sm:mt-0" />
                    <div>
                      <h4 className="text-xs font-bold text-amber-200 uppercase tracking-wide">
                        💡 Suggestion Chutes Rack Atelier ({optimizationResult.workshopScrapProposals.length} opportunité(s))
                      </h4>
                      <p className="text-xs text-slate-300 mt-0.5">
                        Certaines pièces isolées risquent d'imposer de dérouler une feuille mère entière.
                        Vous pouvez les réaliser dans une chute usuelle du rack (100, 120, 150, 200 ou 250 mm) pour éviter d'entamer une nouvelle feuille !
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {useWorkshopScraps ? (
                      <button
                        type="button"
                        onClick={handleResetToWithoutScraps}
                        className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                      >
                        <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                        <span>Calculer 100% sans chute</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleAcceptAllProposals}
                        className="px-3.5 py-1.5 bg-amber-400 hover:bg-amber-300 active:bg-amber-500 text-slate-950 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        <span>Appliquer les chutes suggérées</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Table of Scrap Proposals */}
                <div className="overflow-x-auto border border-amber-800/40 rounded-lg bg-slate-950/60">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-amber-950/40 text-amber-300 uppercase tracking-wider text-[10px] border-b border-amber-800/30">
                      <tr>
                        <th className="py-2 px-3">Pièce Isolée</th>
                        <th className="py-2 px-3">Cote Requise</th>
                        <th className="py-2 px-3">Chute Atelier Proposée</th>
                        <th className="py-2 px-3">Économie de Bobine Mère</th>
                        <th className="py-2 px-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-amber-900/30 font-mono">
                      {optimizationResult.workshopScrapProposals.map((prop) => {
                        const isAccepted = acceptedProposalIds.includes(prop.id);
                        return (
                          <tr key={prop.id} className="hover:bg-amber-950/20">
                            <td className="py-2 px-3 font-sans text-white font-medium">
                              {prop.pieceLabel}
                            </td>
                            <td className="py-2 px-3 text-slate-300">
                              Dév {prop.pieceDev} mm × {prop.pieceLength} m
                            </td>
                            <td className="py-2 px-3 text-amber-300 font-bold">
                              Chute Rack {prop.recommendedScrapDev} mm
                            </td>
                            <td className="py-2 px-3 font-sans text-emerald-400 text-[11px]">
                              {prop.reason}
                            </td>
                            <td className="py-2 px-3 text-right">
                              <button
                                type="button"
                                onClick={() => handleToggleProposal(prop.id)}
                                className={`px-2.5 py-1 rounded text-xs font-bold transition-colors ${
                                  isAccepted
                                    ? 'bg-emerald-500 text-slate-950'
                                    : 'bg-amber-400/20 hover:bg-amber-400/30 text-amber-300 border border-amber-400/40'
                                }`}
                              >
                                {isAccepted ? '✓ Chute Utilisée' : 'Utiliser cette chute'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {/* KPI STATS CARDS */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                  Coupes Mères
                </span>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-xl font-bold font-mono text-white">
                    {optimizationResult.motherItemsNeeded.length}
                  </span>
                  <span className="text-xs text-slate-400">bandes</span>
                </div>
              </div>

              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                  Surface Nette
                </span>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-xl font-bold font-mono text-amber-300">
                    {optimizationResult.totalNetSurfaceM2.toFixed(2)}
                  </span>
                  <span className="text-xs text-slate-400">m²</span>
                </div>
                <span className="text-[10px] text-slate-500 font-mono block mt-0.5">
                  {optimizationResult.netWeightKg} kg utiles
                </span>
              </div>

              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                  Surface Brute
                </span>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-xl font-bold font-mono text-white">
                    {optimizationResult.totalGrossSurfaceM2.toFixed(2)}
                  </span>
                  <span className="text-xs text-slate-400">m²</span>
                </div>
                <span className="text-[10px] text-slate-500 font-mono block mt-0.5">
                  {optimizationResult.grossWeightKg} kg à sortir
                </span>
              </div>

              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                  Chutes Rack Générées
                </span>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-xl font-bold font-mono text-emerald-400">
                    {optimizationResult.reusableScrapSurfaceM2.toFixed(2)}
                  </span>
                  <span className="text-xs text-slate-400">m²</span>
                </div>
                <span className="text-[10px] text-slate-500 font-mono block mt-0.5">
                  {optimizationResult.newReusableScrapsCreated.length} bande(s) &ge;100mm
                </span>
              </div>

              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                  Rebut / Rive Perdue
                </span>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-xl font-bold font-mono text-rose-400">
                    {optimizationResult.netLossSurfaceM2.toFixed(2)}
                  </span>
                  <span className="text-xs text-slate-400">m²</span>
                </div>
                <span className="text-[10px] text-slate-500 font-mono block mt-0.5">
                  chutes &lt; 100mm
                </span>
              </div>

              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                  Rendement Matière
                </span>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-xl font-bold font-mono text-amber-400">
                    {optimizationResult.materialEfficiencyRate.toFixed(1)}
                  </span>
                  <span className="text-xs text-slate-400">%</span>
                </div>
                <span className="text-[10px] text-emerald-400 font-medium block mt-0.5">
                  haute valorisation
                </span>
              </div>
            </div>
          </div>

          {/* PIECES FINIES SUR CHUTES D'ATELIER (SI APPLIQUÉ) */}
          {optimizationResult.appliedWorkshopScraps &&
            optimizationResult.appliedWorkshopScraps.length > 0 && (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>Pièces Terminées sur Chutes d'Atelier Usuelles</span>
                  </h4>
                  <span className="text-xs font-mono text-emerald-400 font-bold">
                    {optimizationResult.appliedWorkshopScraps.length} pièce(s)
                  </span>
                </div>

                <div className="overflow-x-auto border border-slate-800 rounded-xl">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-950/50 text-slate-400 uppercase tracking-wider text-[10px] border-b border-slate-800">
                      <tr>
                        <th className="py-2.5 px-3">Pièce Réalisée</th>
                        <th className="py-2.5 px-3">Dév Pièce</th>
                        <th className="py-2.5 px-3">Longueur</th>
                        <th className="py-2.5 px-3">Chute du Rack Utilisée</th>
                        <th className="py-2.5 px-3">Avantage</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 font-mono">
                      {optimizationResult.appliedWorkshopScraps.map((s, idx) => (
                        <tr key={idx}>
                          <td className="py-2 px-3 font-sans text-white font-medium">
                            {s.pieceLabel}
                          </td>
                          <td className="py-2 px-3 text-slate-300">{s.pieceDev} mm</td>
                          <td className="py-2 px-3 text-slate-300">{s.pieceLength} m</td>
                          <td className="py-2 px-3 text-amber-300 font-bold">
                            Chute Dév {s.scrapDev} mm
                          </td>
                          <td className="py-2 px-3 font-sans text-emerald-400 text-[11px]">
                            Évite de refendre une feuille mère complète
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          {/* RÉCAPITULATIF DES FEUILLES SORTIES & LEUR MATIÈRE */}
          {sheetsRecapByMaterial.length > 0 && (
            <div className="bg-slate-900 border border-amber-500/30 rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded">
                      Sortie Magasin Atelier
                    </span>
                    <span className="text-slate-500">·</span>
                    <span className="text-xs text-slate-400">
                      Selon les pièces & matières du tableau ci-dessus
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-white uppercase tracking-wider mt-1 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-amber-400" />
                    <span>Récapitulatif des Feuilles / Bobines Mères à Sortir</span>
                  </h4>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-3 py-1 bg-amber-400 text-slate-950 font-bold text-xs rounded-lg shadow-sm">
                    {grandTotalSheets} feuille(s) / bobine(s) au total
                  </span>
                  <span className="px-3 py-1 bg-slate-800 text-amber-300 font-mono font-bold text-xs rounded-lg border border-slate-700">
                    {grandTotalWeight} kg brut à sortir
                  </span>
                </div>
              </div>

              {/* Cards / Tables for each Material Group */}
              <div className="space-y-4">
                {sheetsRecapByMaterial.map((matGroup, mIdx) => {
                  const isGroupAlu = /alu/i.test(matGroup.material);
                  return (
                    <div
                      key={mIdx}
                      className="bg-slate-950/80 border border-slate-800 rounded-xl overflow-hidden shadow-sm"
                    >
                      {/* Material Header Strip */}
                      <div className="px-4 py-3 bg-slate-950 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-2.5">
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`w-3 h-3 rounded-full ${
                              isGroupAlu ? 'bg-cyan-400' : 'bg-amber-400'
                            }`}
                          />
                          <span className="font-bold text-sm text-white">
                            {matGroup.material}
                          </span>
                          <span className="text-[11px] font-mono text-slate-400">
                            (densité : {matGroup.density.toFixed(2)} kg/m²)
                          </span>
                        </div>

                        <div className="flex items-center gap-3 text-xs font-mono text-slate-300 flex-wrap">
                          <span>
                            <strong className="text-amber-300">{matGroup.totalSheets}</strong>{' '}
                            {matGroup.totalSheets > 1 ? 'feuilles' : 'feuille'}
                          </span>
                          <span>·</span>
                          <span>
                            <strong className="text-white">{matGroup.totalLengthM.toFixed(2)} m</strong>{' '}
                            déroulés
                          </span>
                          <span>·</span>
                          <span>
                            <strong className="text-white">{matGroup.totalSurfaceM2.toFixed(2)} m²</strong>
                          </span>
                          <span>·</span>
                          <span className="text-amber-300 font-bold">
                            {matGroup.totalWeightKg.toFixed(1)} kg brut
                          </span>
                        </div>
                      </div>

                      {/* Format Table */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-900/60 text-slate-400 uppercase tracking-wider text-[10px] border-b border-slate-800/60">
                            <tr>
                              <th className="py-2.5 px-3">Format Bobine Mère</th>
                              <th className="py-2.5 px-3 text-right">Longueur Unitaire</th>
                              <th className="py-2.5 px-3 text-right">Nb Feuilles à Sortir</th>
                              <th className="py-2.5 px-3 text-right">Métrage Cumulé</th>
                              <th className="py-2.5 px-3 text-right">Surface Brute</th>
                              <th className="py-2.5 px-3 text-right">Poids Brut Matière</th>
                              <th className="py-2.5 px-3">Pièces Débitées</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                            {matGroup.formatList.map((f, fIdx) => (
                              <tr key={fIdx} className="hover:bg-slate-900/40 transition-colors">
                                <td className="py-2 px-3 font-bold text-white">
                                  <span className="text-amber-300">{f.motherWidth} mm</span>
                                </td>
                                <td className="py-2 px-3 text-right text-slate-300">
                                  {f.motherLength.toFixed(2)} m
                                </td>
                                <td className="py-2 px-3 text-right font-bold text-white">
                                  <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                                    {f.count} {f.count > 1 ? 'feuilles' : 'feuille'}
                                  </span>
                                </td>
                                <td className="py-2 px-3 text-right text-slate-200">
                                  {f.totalLengthM.toFixed(2)} m
                                </td>
                                <td className="py-2 px-3 text-right text-slate-300">
                                  {f.totalSurfaceM2.toFixed(2)} m²
                                </td>
                                <td className="py-2 px-3 text-right font-bold text-amber-300">
                                  {f.totalWeightKg.toFixed(1)} kg
                                </td>
                                <td className="py-2 px-3 font-sans text-[11px]">
                                  <div className="flex flex-wrap gap-1">
                                    {f.piecesProduced.map((p, pIdx) => (
                                      <span
                                        key={pIdx}
                                        className="bg-slate-900 border border-slate-700/80 px-1.5 py-0.5 rounded text-[10px] text-slate-200"
                                      >
                                        {p.label} (Dév {p.dev}mm) × {p.count}
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

              {/* Warehouse Operator Summary Bottom Banner */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-slate-300 uppercase text-[11px] tracking-wider">
                    Synthèse Magasinier :
                  </span>
                  {sheetsRecapByMaterial.map((m, idx) => (
                    <span
                      key={idx}
                      className="px-2.5 py-1 rounded-md bg-slate-900 border border-slate-700 text-slate-200 font-mono text-[11px]"
                    >
                      <strong>{m.material}</strong> : {m.totalSheets} f. ({m.totalLengthM.toFixed(1)}m · {m.totalWeightKg.toFixed(1)}kg)
                    </span>
                  ))}
                </div>

                <div className="font-mono text-xs text-right shrink-0">
                  <span className="text-slate-400">Total Sortie : </span>
                  <strong className="text-amber-400 text-sm">{grandTotalSheets} feuilles</strong>
                  <span className="text-slate-400"> · </span>
                  <strong className="text-white">{grandTotalMeters.toFixed(2)} m</strong>
                  <span className="text-slate-400"> · </span>
                  <strong className="text-white">{grandTotalSurface.toFixed(2)} m²</strong>
                  <span className="text-slate-400"> · </span>
                  <strong className="text-amber-300 text-sm">{grandTotalWeight.toFixed(1)} kg</strong>
                </div>
              </div>
            </div>
          )}

          {/* DÉTAIL DES FEUILLES / BOBINES MÈRES À SORTIR & DIAGRAMMES VISUELS */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                  Détail des Feuilles / Bobines Mères à Débiter ({optimizationResult.motherItemsNeeded.length} opérations)
                </h4>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Plan de refente longitudinal : découpe des largeurs en parallèle
                </p>
              </div>
            </div>

            <div className="space-y-4">
              {optimizationResult.motherItemsNeeded.map((mItem, idx) => {
                const slit = mItem.slits[0];
                if (!slit) return null;

                return (
                  <div
                    key={idx}
                    className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-3"
                  >
                    {/* Header of cut */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 font-mono text-xs border-b border-slate-800/80 pb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-white px-2 py-0.5 rounded bg-slate-800 text-[11px]">
                          Opération #{idx + 1}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[11px] font-sans font-bold bg-amber-500/10 text-amber-300 border border-amber-500/20">
                          {mItem.material || selectedMaterial}
                        </span>
                        <span className="font-bold text-amber-300">
                          Bobine mère : {mItem.motherWidth} mm
                        </span>
                        <span className="text-slate-600">·</span>
                        <span className="text-slate-300">
                          Longueur à dérouler : <strong>{mItem.motherLength} m</strong>
                        </span>
                      </div>
                      <div className="text-slate-400 text-[11px]">
                        Surface : {((mItem.motherWidth / 1000) * mItem.motherLength).toFixed(2)} m²
                        {' · '}
                        Perte : <span className={slit.scrapWidth > 100 ? 'text-emerald-400' : 'text-rose-400 font-bold'}>{slit.scrapWidth} mm</span>
                      </div>
                    </div>

                    {/* Diagramme de refente proportionnel */}
                    <div className="h-10 w-full bg-slate-900 rounded-lg overflow-hidden flex border border-slate-700 text-[11px] font-mono select-none shadow-inner">
                      {slit.strips.map((s, stripIdx) => {
                        const widthPct = (s.dev / mItem.motherWidth) * 100;
                        return (
                          <div
                            key={stripIdx}
                            style={{ width: `${widthPct}%` }}
                            className="bg-amber-500/20 border-r border-amber-500/40 text-amber-200 flex flex-col items-center justify-center px-1 truncate hover:bg-amber-500/30 transition-colors"
                            title={`${s.label} : Dév ${s.dev}mm × ${s.length}m`}
                          >
                            <span className="font-bold truncate text-[11px]">{s.dev} mm</span>
                            <span className="text-[9px] text-amber-400/80 truncate">
                              {s.label}
                            </span>
                          </div>
                        );
                      })}

                      {slit.scrapWidth > 0 && (
                        <div
                          style={{ width: `${(slit.scrapWidth / mItem.motherWidth) * 100}%` }}
                          className={`flex flex-col items-center justify-center px-1 truncate ${
                            slit.isScrapReusable
                              ? 'bg-emerald-950/40 text-emerald-300 border-l border-emerald-700/60'
                              : 'bg-rose-950/50 text-rose-300 border-l border-rose-700/60'
                          }`}
                          title={
                            slit.isScrapReusable
                              ? `Chute réutilisable à conserver (${slit.scrapWidth} mm)`
                              : `Rebut / Perte (${slit.scrapWidth} mm)`
                          }
                        >
                          <span className="font-bold truncate text-[11px]">{slit.scrapWidth} mm</span>
                          <span className="text-[8px] uppercase tracking-wider truncate">
                            {slit.isScrapReusable ? 'Chute Rack' : 'Rebut'}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* List of strips in this sheet */}
                    <div className="flex flex-wrap gap-2 text-[11px] font-mono text-slate-400 pt-1">
                      <span className="font-sans font-semibold text-slate-500">Bandes :</span>
                      {slit.strips.map((s, sIdx) => (
                        <span key={sIdx} className="bg-slate-900 px-2 py-0.5 rounded border border-slate-800 text-slate-300">
                          {s.label} (Dév {s.dev}mm)
                        </span>
                      ))}
                      {slit.isScrapReusable && (
                        <span className="bg-emerald-950/30 text-emerald-300 px-2 py-0.5 rounded border border-emerald-800/40">
                          Chute générée : {slit.scrapWidth} mm × {mItem.motherLength} m
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* AI ADVISORY PANEL */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                  Expert Façonnage & Refente Atelier (Gemini)
                </h4>
              </div>

              <button
                type="button"
                onClick={handleRequestAiAdvisory}
                disabled={isAiAdvisoryLoading}
                className="px-3.5 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{isAiAdvisoryLoading ? 'Analyse en cours...' : 'Consulter l\'Expert Atelier'}</span>
              </button>
            </div>

            {aiAdvisory && (
              <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl text-xs text-slate-300 space-y-1.5 leading-relaxed font-sans whitespace-pre-line">
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
