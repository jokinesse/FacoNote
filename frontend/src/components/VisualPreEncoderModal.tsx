import React, { useState, useRef, useEffect } from 'react';
import QRCode from 'qrcode';
import {
  Camera,
  Upload,
  FileText,
  X,
  RotateCw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  CheckCircle2,
  AlertCircle,
  Plus,
  Trash2,
  Layers,
  ArrowRight,
  Eye,
  Sparkles,
  Clipboard,
  HelpCircle,
  Check,
  QrCode,
  Smartphone,
  Copy,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { ShapedPiece, STANDARD_MATERIALS } from '../types';
import { mobileApi, aiApi, ApiError } from '../api';
import { optimizeImageForOcr } from '../utils/imageOptimizer';

interface VisualPreEncoderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportPieces: (pieces: ShapedPiece[], metadata?: { client?: string; chantier?: string; detectedMaterial?: string }) => void;
  targetMode?: 'calculator' | 'optimizer';
  currentDefaultMaterial?: string;
}

export const VisualPreEncoderModal: React.FC<VisualPreEncoderModalProps> = ({
  isOpen,
  onClose,
  onImportPieces,
  targetMode = 'calculator',
  currentDefaultMaterial = 'Zinc Quartz 0.7',
}) => {
  const [activeInputTab, setActiveInputTab] = useState<'photo' | 'text'>('photo');

  // Image & File States
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [rotationDeg, setRotationDeg] = useState<number>(0);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [contrastBoost, setContrastBoost] = useState<boolean>(true);

  // Manual Text / Shorthand input state
  const [manualText, setManualText] = useState<string>('');

  // Processing States
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processingStep, setProcessingStep] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rawAiObservations, setRawAiObservations] = useState<string | null>(null);

  // Extracted Pieces for Review & Correction
  const [extractedPieces, setExtractedPieces] = useState<ShapedPiece[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [clientInfo, setClientInfo] = useState<{ client?: string; chantier?: string; finish?: string }>({});

  // Smartphone QR Pairing & Live Transfer States
  const [mobileSessionId, setMobileSessionId] = useState<string>('');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [isQrModeActive, setIsQrModeActive] = useState<boolean>(false);
  const [isWaitingForMobile, setIsWaitingForMobile] = useState<boolean>(false);
  const [mobileTransferSuccess, setMobileTransferSuccess] = useState<string | null>(null);
  const [isCopiedLink, setIsCopiedLink] = useState<boolean>(false);
  const pollingIntervalRef = useRef<any>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const stopPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    setIsWaitingForMobile(false);
  };

  // Reset state and cleanup when opening/closing
  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
    } else {
      stopPolling();
      setIsQrModeActive(false);
      setMobileTransferSuccess(null);
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, []);

  // Support Ctrl+V paste of images from clipboard
  useEffect(() => {
    if (!isOpen) return;

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            handleFileSelected(file);
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleFileSelected = async (file: File) => {
    setSelectedFile(file);
    setRotationDeg(0);
    setZoomLevel(1);
    setErrorMessage(null);
    setExtractedPieces([]);

    try {
      const { previewUrl } = await optimizeImageForOcr(file, 0);
      setImagePreviewUrl(previewUrl || null);
    } catch {
      setImagePreviewUrl(null);
    }
  };

  const handleRotate = async () => {
    if (!selectedFile) return;
    const newRotation = (rotationDeg + 90) % 360;
    setRotationDeg(newRotation);
    try {
      const { previewUrl } = await optimizeImageForOcr(selectedFile, newRotation);
      setImagePreviewUrl(previewUrl || null);
    } catch {
      // ignore
    }
  };

  // Start or refresh a QR Pairing Session for Smartphone Camera Transfer
  const startQrSession = async () => {
    stopPolling();
    setIsQrModeActive(true);
    setMobileTransferSuccess(null);
    setIsWaitingForMobile(true);
    setErrorMessage(null);

    try {
      let currentSession = mobileSessionId;
      if (!currentSession) {
        const sessionRes = await mobileApi.createSession();
        currentSession = sessionRes.data.session_id;
        setMobileSessionId(currentSession);
      }

      if (currentSession) {
        const origin = window.location.origin;
        const targetUrl = `${origin}/mobile?session=${currentSession}`;
        const qr = await QRCode.toDataURL(targetUrl, {
          width: 260,
          margin: 1,
          color: {
            dark: '#020617',
            light: '#ffffff',
          },
        });
        setQrCodeDataUrl(qr);

        // Start polling every 1200ms
        pollingIntervalRef.current = setInterval(async () => {
          try {
            const statusRes = await mobileApi.getStatus(currentSession);
            const statusData = statusRes.data;
            if (statusData.status === 'ready' && statusData.image_base64) {
              stopPolling();
              setMobileTransferSuccess(
                `Photo reçue depuis votre smartphone (${statusData.filename || 'croquis.jpg'})`
              );

              // Convert base64 data URL to File object
              const blobRes = await fetch(statusData.image_base64);
              const blob = await blobRes.blob();
              const file = new File(
                [blob],
                statusData.filename || `croquis_mobile_${Date.now()}.jpg`,
                { type: 'image/jpeg' }
              );
              await handleFileSelected(file);
              if (statusData.note && !manualText) {
                setManualText(`Note mobile : ${statusData.note}`);
              }
              setIsQrModeActive(false);
            }
          } catch (e) {
            console.warn('Mobile status polling error:', e);
          }
        }, 1200);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Impossible de générer la session QR code.');
      setIsWaitingForMobile(false);
    }
  };

  // Launch AI Vision Parsing
  const handleRunAnalysis = async () => {
    if (!selectedFile && !manualText.trim()) {
      setErrorMessage('Veuillez sélectionner une image/photo ou saisir un descriptif de commande.');
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);
    setRawAiObservations(null);
    setProcessingStep("Traitement haute netteté de l'image...");

    try {
      let fileBase64: string | undefined;
      let mimeType: string | undefined;

      if (selectedFile) {
        const optimized = await optimizeImageForOcr(selectedFile, rotationDeg);
        fileBase64 = optimized.base64;
        mimeType = optimized.mimeType;
      }

      setProcessingStep('Analyse multimodale IA par Gemini Vision (détection des profils, cotes des ailes, plis)...');

      const response = await aiApi.parseDocument({
        file_base64: fileBase64 || null,
        mime_type: mimeType,
        manual_text: manualText.trim() || null,
        standard_length: 2.0,
      });

      const data = response.data;

      if (data.raw_observations) {
        setRawAiObservations(data.raw_observations);
      } else if (data.notes) {
        setRawAiObservations(data.notes);
      }

      if (data.client || data.chantier || data.detected_finish) {
        setClientInfo({
          client: data.client,
          chantier: data.chantier,
          finish: data.detected_finish,
        });
      }

      if (data.pieces && data.pieces.length > 0) {
        const formatted: ShapedPiece[] = data.pieces.map((p: any, idx: number) => ({
          id: p.id || `p-ocr-${Date.now()}-${idx}`,
          label: p.label || 'Pièce façonnée',
          dev: Math.max(20, Math.round(Number(p.dev) || 180)),
          length: Math.max(0.1, Math.round((Number(p.length) || 2.0) * 100) / 100),
          quantity: Math.max(1, Math.round(Number(p.quantity) || 1)),
          bends: Math.max(1, Math.round(Number(p.bends) || 2)),
          material: p.material || currentDefaultMaterial,
          workshopSplitReason: p.workshopSplitReason || `Reconnu par Vision`,
        }));

        setExtractedPieces(formatted);
        setSelectedIndices(formatted.map((_, i) => i)); // select all by default
      } else {
        setErrorMessage(
          data.notes ||
            'Aucun profil de pliage exploitable détecté. Assurez-vous que les cotes ou les dessins sont bien lisibles, ou saisissez-les dans l’onglet texte.'
        );
      }
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err?.message || "Échec de l'analyse visuelle. Veuillez vérifier votre document.");
    } finally {
      setIsProcessing(false);
      setProcessingStep('');
    }
  };

  // Edit piece field in table
  const handleUpdatePiece = (index: number, field: keyof ShapedPiece, value: any) => {
    setExtractedPieces((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, [field]: value } : item))
    );
  };

  // Toggle selection
  const handleToggleSelect = (index: number) => {
    setSelectedIndices((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
    );
  };

  // Delete piece
  const handleDeletePiece = (index: number) => {
    setExtractedPieces((prev) => prev.filter((_, idx) => idx !== index));
    setSelectedIndices((prev) =>
      prev.filter((i) => i !== index).map((i) => (i > index ? i - 1 : i))
    );
  };

  // Add piece manually to verification list
  const handleAddEmptyPiece = () => {
    const newP: ShapedPiece = {
      id: `p-manual-${Date.now()}`,
      label: 'Nouveau profil',
      dev: 200,
      length: 2.0,
      quantity: 1,
      bends: 2,
      material: currentDefaultMaterial,
      workshopSplitReason: 'Ajout manuel',
    };
    setExtractedPieces((prev) => [...prev, newP]);
    setSelectedIndices((prev) => [...prev, prev.length]);
  };

  // Confirm and push pieces
  const handleConfirmImport = () => {
    const piecesToImport = extractedPieces.filter((_, idx) => selectedIndices.includes(idx));
    if (piecesToImport.length === 0) {
      setErrorMessage('Veuillez sélectionner au moins une pièce à importer.');
      return;
    }

    onImportPieces(piecesToImport, {
      client: clientInfo.client,
      chantier: clientInfo.chantier,
      detectedMaterial: clientInfo.finish,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      <div className="bg-slate-900 border border-amber-500/30 rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/70">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>Assistant Reconnaissance Visuelle & Pré-Encodage</span>
                <span className="text-[10px] text-amber-300 font-mono px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 font-normal">
                  IA Gemini Vision
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Photographiez vos croquis de pliage, schémas manuscrits ou plans PDF. L'IA extrait
                les cotes, ailes, plis et quantités avec contrôle visuel direct.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
          {/* Tabs: Photo / Plan vs Saisie Rapide Texte */}
          <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
            <button
              onClick={() => setActiveInputTab('photo')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all ${
                activeInputTab === 'photo'
                  ? 'bg-amber-400 text-slate-950 shadow-sm'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <Camera className="w-4 h-4" />
              <span>Photo de Croquis / Plan PDF</span>
            </button>
            <button
              onClick={() => setActiveInputTab('text')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all ${
                activeInputTab === 'text'
                  ? 'bg-amber-400 text-slate-950 shadow-sm'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span>Saisie Rapide Manuscrite (Texte brut)</span>
            </button>
          </div>

          {/* TAB 1: Photo & Image Input */}
          {activeInputTab === 'photo' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              {/* Left Column: Image Upload & Controls */}
              <div className="lg:col-span-5 space-y-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelected(file);
                  }}
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelected(file);
                  }}
                />

                {/* Upload Buttons */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (!isQrModeActive) {
                        startQrSession();
                      } else {
                        setIsQrModeActive(false);
                      }
                    }}
                    className={`px-3 py-2.5 font-bold rounded-xl text-xs flex items-center justify-center gap-2 border transition-all shadow-sm ${
                      isQrModeActive
                        ? 'bg-amber-500 text-slate-950 border-amber-400'
                        : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 hover:text-white border-amber-500/40'
                    }`}
                  >
                    <QrCode className="w-4 h-4 text-amber-400" />
                    <span>Scanner Smartphone (QR)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsQrModeActive(false);
                      fileInputRef.current?.click();
                    }}
                    className="px-3 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-xl text-xs flex items-center justify-center gap-2 border border-slate-700 transition-colors shadow-sm"
                  >
                    <Upload className="w-4 h-4 text-amber-400" />
                    <span>Choisir Fichier PC</span>
                  </button>
                </div>

                {/* Mobile Transfer Success Banner */}
                {mobileTransferSuccess && (
                  <div className="bg-emerald-950/40 border border-emerald-500/40 rounded-xl p-2.5 flex items-center justify-between text-xs text-emerald-300 shadow-xs">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>{mobileTransferSuccess}</span>
                    </div>
                    <button
                      type="button"
                      onClick={startQrSession}
                      className="text-[11px] font-semibold text-emerald-300 hover:text-white underline"
                    >
                      Scanner autre
                    </button>
                  </div>
                )}

                {/* QR Code Scanner Mode vs Standard Dropzone / Preview */}
                {isQrModeActive ? (
                  <div className="border border-amber-500/40 rounded-2xl p-4 bg-slate-950/80 flex flex-col items-center justify-center text-center space-y-3 relative overflow-hidden shadow-lg shadow-amber-950/20">
                    <div className="flex items-center justify-between w-full">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                        <Smartphone className="w-3.5 h-3.5" />
                        <span>Scanner avec votre smartphone</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsQrModeActive(false)}
                        className="text-[11px] text-slate-400 hover:text-white underline"
                      >
                        Fermer le QR
                      </button>
                    </div>

                    {/* QR Code Container */}
                    <div className="bg-white p-3 rounded-2xl shadow-xl border border-slate-700">
                      {qrCodeDataUrl ? (
                        <img
                          src={qrCodeDataUrl}
                          alt="QR Code Scanner Facozinc"
                          className="w-44 h-44 object-contain mx-auto"
                        />
                      ) : (
                        <div className="w-44 h-44 flex items-center justify-center text-slate-400">
                          <RefreshCw className="w-6 h-6 animate-spin text-slate-600" />
                        </div>
                      )}
                    </div>

                    {/* Live Listening Radar Banner */}
                    <div className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 w-full flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 text-left">
                        <span className="relative flex h-2.5 w-2.5 shrink-0">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
                        </span>
                        <div>
                          <p className="font-semibold text-white text-[11px]">En attente de la photo...</p>
                          <p className="text-[10px] text-slate-400">Prenez la photo avec votre téléphone</p>
                        </div>
                      </div>

                      <span className="font-mono text-[11px] font-bold text-amber-300 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                        {mobileSessionId}
                      </span>
                    </div>

                    {/* Helper actions (Copy link & Test in new tab) */}
                    <div className="flex items-center gap-2 w-full pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          const url = `${window.location.origin}/mobile?session=${mobileSessionId}`;
                          navigator.clipboard.writeText(url);
                          setIsCopiedLink(true);
                          setTimeout(() => setIsCopiedLink(false), 2000);
                        }}
                        className="flex-1 py-1.5 px-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg text-[11px] text-slate-300 hover:text-white flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        {isCopiedLink ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Lien copié !</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5 text-amber-400" />
                            <span>Copier le lien mobile</span>
                          </>
                        )}
                      </button>

                      <a
                        href={`/mobile?session=${mobileSessionId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="py-1.5 px-3 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg text-[11px] text-slate-300 hover:text-amber-300 flex items-center gap-1.5 transition-colors"
                        title="Tester le scanner mobile dans un nouvel onglet"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Tester</span>
                      </a>
                    </div>
                  </div>
                ) : (
                  /* Dropzone / Preview Area */
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const file = e.dataTransfer.files?.[0];
                      if (file) handleFileSelected(file);
                    }}
                    className="border-2 border-dashed border-slate-700 hover:border-amber-400/50 rounded-xl p-3 bg-slate-950/50 flex flex-col items-center justify-center min-h-[220px] max-h-[340px] relative overflow-hidden group transition-colors"
                  >
                    {imagePreviewUrl ? (
                      <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
                        <img
                          src={imagePreviewUrl}
                          alt="Aperçu croquis"
                          style={{
                            transform: `scale(${zoomLevel})`,
                            transition: 'transform 0.15s ease',
                          }}
                          className="max-h-[300px] w-auto object-contain rounded-lg shadow"
                        />

                        {/* Image adjustment toolbar overlay */}
                        <div className="absolute bottom-2 left-2 right-2 bg-slate-900/90 backdrop-blur border border-slate-700/80 rounded-lg p-1.5 flex items-center justify-between text-xs text-slate-300">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={handleRotate}
                              className="p-1 hover:text-white rounded hover:bg-slate-800"
                              title="Pivoter 90°"
                            >
                              <RotateCw className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setZoomLevel((z) => Math.min(2.5, z + 0.2))}
                              className="p-1 hover:text-white rounded hover:bg-slate-800"
                              title="Zoom +"
                            >
                              <ZoomIn className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setZoomLevel((z) => Math.max(0.6, z - 0.2))}
                              className="p-1 hover:text-white rounded hover:bg-slate-800"
                              title="Zoom -"
                            >
                              <ZoomOut className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setZoomLevel(1)}
                              className="p-1 hover:text-white rounded hover:bg-slate-800"
                              title="Réinitialiser zoom"
                            >
                              1x
                            </button>
                          </div>
                          <span className="text-[10px] text-slate-400 font-mono truncate max-w-[120px]">
                            {selectedFile?.name}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center p-4 space-y-2">
                        <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
                          <Upload className="w-5 h-5" />
                        </div>
                        <p className="text-xs text-slate-300 font-medium">
                          Glissez une photo ici ou collez depuis le presse-papier (<kbd className="font-mono bg-slate-800 px-1 rounded text-amber-300">Ctrl+V</kbd>)
                        </p>
                        <p className="text-[11px] text-slate-500">
                          Croquis papier, calepinage, photos d'atelier, PDF de devis
                        </p>
                        <div className="pt-2">
                          <button
                            type="button"
                            onClick={startQrSession}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-semibold transition-colors"
                          >
                            <QrCode className="w-3.5 h-3.5" />
                            <span>Ou scanner avec votre smartphone</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Optional Note or Hint */}
                <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-2.5 text-[11px] text-slate-400 flex items-start gap-2">
                  <HelpCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Astuce Atelier :</strong> Vous pouvez photographier vos croquis
                    directement depuis votre téléphone via le QR Code ci-dessus, ou glisser vos plans PDF
                    depuis votre PC.
                  </span>
                </div>
              </div>

              {/* Right Column: Launch Button & Real-time Status */}
              <div className="lg:col-span-7 space-y-3">
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-amber-400" />
                      <span>Lancement de l'Analyse Visuelle</span>
                    </span>
                    {selectedFile && (
                      <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                        Document prêt
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-slate-400">
                    L'IA va automatiquement sommer les segments de profil (ex: 15+120+35+20 =
                    190mm), compter les plis et extraire les quantités. Vous pourrez vérifier et
                    modifier chaque pièce ci-dessous avant validation.
                  </p>

                  <button
                    type="button"
                    onClick={handleRunAnalysis}
                    disabled={!selectedFile || isProcessing}
                    className="w-full py-3 bg-amber-400 hover:bg-amber-300 disabled:opacity-40 disabled:hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-sm flex items-center justify-center gap-2 transition-colors shadow-sm"
                  >
                    {isProcessing ? (
                      <>
                        <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></div>
                        <span>{processingStep || 'Analyse en cours...'}</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        <span>Analyser le Croquis / Document</span>
                      </>
                    )}
                  </button>
                </div>

                {errorMessage && (
                  <div className="bg-rose-950/40 border border-rose-800/60 rounded-xl p-3.5 text-xs text-rose-300 flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <div>
                      <strong className="block font-bold">Information de reconnaissance :</strong>
                      <span>{errorMessage}</span>
                    </div>
                  </div>
                )}

                {rawAiObservations && (
                  <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 text-xs text-amber-300 space-y-1">
                    <strong className="font-semibold block text-amber-400">
                      Observations visuelles de l'IA :
                    </strong>
                    <p className="text-[11px] text-slate-300 font-mono whitespace-pre-line">
                      {rawAiObservations}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: Text / Shorthand Input */}
          {activeInputTab === 'text' && (
            <div className="space-y-3">
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                  Collez ou écrivez vos notes d'atelier brutes :
                </label>
                <textarea
                  value={manualText}
                  onChange={(e) => setManualText(e.target.value)}
                  placeholder="Exemples :&#10;8 pcs bavette 15+120+35+20 en 2m zinc quartz 0.7&#10;Rive 250 6x3m Alu Noir 9005&#10;4 couvertines dev 350 lg 2.5m 4 plis"
                  rows={5}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-xs font-mono text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-400"
                />
                <button
                  type="button"
                  onClick={handleRunAnalysis}
                  disabled={!manualText.trim() || isProcessing}
                  className="px-5 py-2.5 bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-slate-950 font-bold rounded-lg text-xs flex items-center gap-2 transition-colors"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Analyser le Descriptif</span>
                </button>
              </div>
            </div>
          )}

          {/* SECTION: EXTRACTED PIECES VERIFICATION & CORRECTION TABLE */}
          {extractedPieces.length > 0 && (
            <div className="bg-slate-950 border border-amber-500/30 rounded-xl p-4 space-y-3">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                <div>
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>Pièces Détectées ({extractedPieces.length}) - Contrôle & Validation</span>
                  </h3>
                  <span className="text-[11px] text-slate-400">
                    Vérifiez les cotes avant insertion. Vous pouvez modifier n'importe quelle valeur en direct.
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleAddEmptyPiece}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg flex items-center gap-1.5 border border-slate-700"
                  >
                    <Plus className="w-3.5 h-3.5 text-amber-400" />
                    <span>Ajouter une pièce</span>
                  </button>
                </div>
              </div>

              {/* Editable Pieces Table */}
              <div className="overflow-x-auto rounded-lg border border-slate-800">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-900 text-slate-400 text-[11px] uppercase font-mono">
                    <tr>
                      <th className="py-2.5 px-3 w-10 text-center">
                        <input
                          type="checkbox"
                          checked={
                            selectedIndices.length === extractedPieces.length &&
                            extractedPieces.length > 0
                          }
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedIndices(extractedPieces.map((_, i) => i));
                            } else {
                              setSelectedIndices([]);
                            }
                          }}
                          className="rounded border-slate-700 text-amber-400 focus:ring-0"
                        />
                      </th>
                      <th className="py-2.5 px-3">Désignation</th>
                      <th className="py-2.5 px-3 text-right">Dév (mm)</th>
                      <th className="py-2.5 px-3 text-right">Longueur (m)</th>
                      <th className="py-2.5 px-3 text-right">Qté</th>
                      <th className="py-2.5 px-3 text-center">Plis</th>
                      <th className="py-2.5 px-3">Matière</th>
                      <th className="py-2.5 px-3">Détail des Ailes / Calcul</th>
                      <th className="py-2.5 px-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 bg-slate-950">
                    {extractedPieces.map((p, idx) => {
                      const isSelected = selectedIndices.includes(idx);
                      return (
                        <tr
                          key={p.id}
                          className={`hover:bg-slate-900/60 transition-colors ${
                            !isSelected ? 'opacity-40' : ''
                          }`}
                        >
                          <td className="py-2 px-3 text-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleSelect(idx)}
                              className="rounded border-slate-700 text-amber-400 focus:ring-0"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="text"
                              value={p.label}
                              onChange={(e) => handleUpdatePiece(idx, 'label', e.target.value)}
                              className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-slate-100 font-medium focus:border-amber-400"
                            />
                          </td>
                          <td className="py-2 px-3 text-right">
                            <input
                              type="number"
                              value={p.dev}
                              onChange={(e) =>
                                handleUpdatePiece(idx, 'dev', Number(e.target.value) || 0)
                              }
                              className="w-20 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono font-bold text-amber-400 text-right focus:border-amber-400"
                            />
                          </td>
                          <td className="py-2 px-3 text-right">
                            <input
                              type="number"
                              step="0.1"
                              value={p.length}
                              onChange={(e) =>
                                handleUpdatePiece(idx, 'length', Number(e.target.value) || 2.0)
                              }
                              className="w-20 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-100 text-right focus:border-amber-400"
                            />
                          </td>
                          <td className="py-2 px-3 text-right">
                            <input
                              type="number"
                              value={p.quantity}
                              onChange={(e) =>
                                handleUpdatePiece(idx, 'quantity', Number(e.target.value) || 1)
                              }
                              className="w-16 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono font-bold text-white text-right focus:border-amber-400"
                            />
                          </td>
                          <td className="py-2 px-3 text-center">
                            <input
                              type="number"
                              value={p.bends}
                              onChange={(e) =>
                                handleUpdatePiece(idx, 'bends', Number(e.target.value) || 2)
                              }
                              className="w-14 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-300 text-center focus:border-amber-400"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <select
                              value={p.material || currentDefaultMaterial}
                              onChange={(e) => handleUpdatePiece(idx, 'material', e.target.value)}
                              className="w-44 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-slate-200 focus:border-amber-400 font-sans"
                            >
                              {STANDARD_MATERIALS.map((mat) => (
                                <option key={mat} value={mat}>
                                  {mat}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2 px-3 text-slate-400 font-mono text-[11px] truncate max-w-[200px]">
                            {p.workshopSplitReason || '-'}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <button
                              type="button"
                              onClick={() => handleDeletePiece(idx)}
                              className="p-1 text-slate-500 hover:text-rose-400 rounded transition-colors"
                              title="Supprimer cette ligne"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 sm:p-5 border-t border-slate-800 bg-slate-950/80 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs text-slate-400">
            {extractedPieces.length > 0 ? (
              <span>
                <strong className="text-white">{selectedIndices.length}</strong> pièce(s)
                sélectionnée(s) sur {extractedPieces.length} détectée(s)
              </span>
            ) : (
              <span>En attente de chargement d'un croquis</span>
            )}
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-lg text-xs transition-colors"
            >
              Annuler
            </button>

            {extractedPieces.length > 0 && (
              <button
                type="button"
                onClick={handleConfirmImport}
                disabled={selectedIndices.length === 0}
                className="px-5 py-2 bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-slate-950 font-bold rounded-lg text-xs flex items-center gap-2 transition-colors shadow-sm"
              >
                <Check className="w-4 h-4" />
                <span>
                  {targetMode === 'calculator'
                    ? "Valider et Injecter dans le Calculateur"
                    : "Valider et Ajouter à l'Optimiseur"}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
