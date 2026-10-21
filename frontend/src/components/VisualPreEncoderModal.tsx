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
import { ShapedPiece, STANDARD_MATERIALS, MATERIAL_GROUPS } from '../types';
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
  currentDefaultMaterial = 'Zinc Naturel 0.7',
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/40 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-xl overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-[#f0f7fc] border border-[#b9dcf2] text-[#00478a]">
              <Camera className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#282828] flex items-center gap-2">
                <span>Import Croquis &amp; Plans (IA Vision)</span>
              </h2>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200/60 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* Tabs: Photo / Plan vs Saisie Rapide Texte */}
          <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
            <button
              onClick={() => setActiveInputTab('photo')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
                activeInputTab === 'photo'
                  ? 'bg-[#00478a] text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Camera className="w-4 h-4" />
              <span>Photo de Croquis / Plan PDF</span>
            </button>
            <button
              onClick={() => setActiveInputTab('text')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
                activeInputTab === 'text'
                  ? 'bg-[#00478a] text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span>Texte Brut</span>
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
                    className={`px-3 py-2 font-semibold rounded-lg text-xs flex items-center justify-center gap-2 border transition-all cursor-pointer ${
                      isQrModeActive
                        ? 'bg-[#00478a] text-white border-[#00478a]'
                        : 'bg-[#f0f7fc] hover:bg-[#e1effa] text-[#00478a] border-[#b9dcf2]'
                    }`}
                  >
                    <QrCode className="w-4 h-4" />
                    <span>Scanner Mobile (QR)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsQrModeActive(false);
                      fileInputRef.current?.click();
                    }}
                    className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs flex items-center justify-center gap-2 border border-slate-200 transition-colors cursor-pointer"
                  >
                    <Upload className="w-4 h-4 text-[#00478a]" />
                    <span>Choisir Fichier PC</span>
                  </button>
                </div>

                {/* Mobile Transfer Success Banner */}
                {mobileTransferSuccess && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 flex items-center justify-between text-xs text-emerald-800">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>{mobileTransferSuccess}</span>
                    </div>
                    <button
                      type="button"
                      onClick={startQrSession}
                      className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-950 underline cursor-pointer"
                    >
                      Scanner autre
                    </button>
                  </div>
                )}

                {/* QR Code Scanner Mode vs Standard Dropzone / Preview */}
                {isQrModeActive ? (
                  <div className="border border-[#b9dcf2] rounded-xl p-4 bg-[#f8fafc] flex flex-col items-center justify-center text-center space-y-3 relative overflow-hidden">
                    <div className="flex items-center justify-between w-full">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#00478a] flex items-center gap-1.5">
                        <Smartphone className="w-3.5 h-3.5" />
                        <span>Scanner avec votre smartphone</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsQrModeActive(false)}
                        className="text-[11px] text-slate-500 hover:text-slate-800 underline cursor-pointer"
                      >
                        Fermer
                      </button>
                    </div>

                    {/* QR Code Container */}
                    <div className="bg-white p-3 rounded-xl shadow-xs border border-slate-200">
                      {qrCodeDataUrl ? (
                        <img
                          src={qrCodeDataUrl}
                          alt="QR Code Scanner Facozinc"
                          className="w-44 h-44 object-contain mx-auto"
                        />
                      ) : (
                        <div className="w-44 h-44 flex items-center justify-center text-slate-400">
                          <RefreshCw className="w-6 h-6 animate-spin text-slate-400" />
                        </div>
                      )}
                    </div>

                    {/* Live Listening Radar Banner */}
                    <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 w-full flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 text-left">
                        <span className="relative flex h-2.5 w-2.5 shrink-0">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#3ca7da] opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#00478a]"></span>
                        </span>
                        <div>
                          <p className="font-semibold text-slate-800 text-[11px]">En attente de la photo...</p>
                        </div>
                      </div>

                      <span className="font-mono text-[11px] font-bold text-[#00478a] bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
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
                        className="flex-1 py-1.5 px-2.5 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-700 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        {isCopiedLink ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Lien copié !</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5 text-[#00478a]" />
                            <span>Copier le lien mobile</span>
                          </>
                        )}
                      </button>

                      <a
                        href={`/mobile?session=${mobileSessionId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="py-1.5 px-3 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-700 hover:text-[#00478a] flex items-center gap-1.5 transition-colors"
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
                    className="border-2 border-dashed border-slate-300 hover:border-[#00478a] rounded-xl p-3 bg-slate-50 flex flex-col items-center justify-center min-h-[200px] max-h-[320px] relative overflow-hidden group transition-colors"
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
                          className="max-h-[280px] w-auto object-contain rounded-lg shadow-xs"
                        />

                        {/* Image adjustment toolbar overlay */}
                        <div className="absolute bottom-2 left-2 right-2 bg-white/95 backdrop-blur border border-slate-200 rounded-lg p-1.5 flex items-center justify-between text-xs text-slate-700 shadow-xs">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={handleRotate}
                              className="p-1 hover:text-[#00478a] rounded hover:bg-slate-100 cursor-pointer"
                              title="Pivoter 90°"
                            >
                              <RotateCw className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setZoomLevel((z) => Math.min(2.5, z + 0.2))}
                              className="p-1 hover:text-[#00478a] rounded hover:bg-slate-100 cursor-pointer"
                              title="Zoom +"
                            >
                              <ZoomIn className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setZoomLevel((z) => Math.max(0.6, z - 0.2))}
                              className="p-1 hover:text-[#00478a] rounded hover:bg-slate-100 cursor-pointer"
                              title="Zoom -"
                            >
                              <ZoomOut className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setZoomLevel(1)}
                              className="p-1 hover:text-[#00478a] rounded hover:bg-slate-100 cursor-pointer"
                              title="Réinitialiser zoom"
                            >
                              1x
                            </button>
                          </div>
                          <span className="text-[10px] text-slate-500 font-mono truncate max-w-[120px]">
                            {selectedFile?.name}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center p-4 space-y-2">
                        <div className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center mx-auto text-slate-400">
                          <Upload className="w-5 h-5" />
                        </div>
                        <p className="text-xs text-slate-600 font-medium">
                          Glissez une image/PDF ou collez (<kbd className="font-mono bg-white border border-slate-200 px-1 rounded text-[#00478a]">Ctrl+V</kbd>)
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Right Column: Launch Button & Real-time Status */}
              <div className="lg:col-span-7 space-y-3">
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-[#00478a]" />
                      <span>Extraction automatique des cotes</span>
                    </span>
                    {selectedFile && (
                      <span className="text-[10px] font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        Document prêt
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleRunAnalysis}
                    disabled={!selectedFile || isProcessing}
                    className="w-full py-2.5 bg-[#e7511f] hover:bg-[#cf4315] disabled:opacity-40 text-white font-bold rounded-lg text-xs flex items-center justify-center gap-2 transition-colors shadow-xs cursor-pointer"
                  >
                    {isProcessing ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>{processingStep || 'Analyse en cours...'}</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        <span>Analyser le Document</span>
                      </>
                    )}
                  </button>
                </div>

                {errorMessage && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    <div>
                      <strong className="block font-bold">Information :</strong>
                      <span>{errorMessage}</span>
                    </div>
                  </div>
                )}

                {rawAiObservations && (
                  <div className="bg-[#f0f7fc] border border-[#b9dcf2] rounded-xl p-3 text-xs text-slate-700 space-y-1">
                    <strong className="font-semibold block text-[#00478a]">
                      Observations :
                    </strong>
                    <p className="text-[11px] text-slate-600 font-mono whitespace-pre-line">
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
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2.5">
                <label className="text-xs font-bold text-slate-700 block">
                  Notes d'atelier :
                </label>
                <textarea
                  value={manualText}
                  onChange={(e) => setManualText(e.target.value)}
                  placeholder="Exemples :&#10;8 pcs bavette 15+120+35+20 en 2m Zinc Quartz 0.7&#10;Rive 250 6x3m Alu RAL 9005 0.7"
                  rows={5}
                  className="w-full bg-white border border-slate-300 rounded-lg p-3 text-xs font-mono text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#00478a]"
                />
                <button
                  type="button"
                  onClick={handleRunAnalysis}
                  disabled={!manualText.trim() || isProcessing}
                  className="px-4 py-2 bg-[#e7511f] hover:bg-[#cf4315] disabled:opacity-40 text-white font-bold rounded-lg text-xs flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Analyser le Descriptif</span>
                </button>
              </div>
            </div>
          )}

          {/* SECTION: EXTRACTED PIECES VERIFICATION & CORRECTION TABLE */}
          {extractedPieces.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Pièces Détectées ({extractedPieces.length})</span>
                </h3>

                <button
                  type="button"
                  onClick={handleAddEmptyPiece}
                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg flex items-center gap-1.5 border border-slate-200 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-[#00478a]" />
                  <span>Ajouter une pièce</span>
                </button>
              </div>

              {/* Editable Pieces Table */}
              <div
                className="table-wrapper rounded-lg border border-slate-200"
                tabIndex={0}
                role="region"
                aria-label="Pièces détectées par reconnaissance visuelle"
              >
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase font-mono border-b border-slate-200">
                    <tr>
                      <th className="py-2 px-3 w-10 text-center">
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
                          className="rounded border-slate-300 text-[#00478a] focus:ring-0"
                        />
                      </th>
                      <th className="py-2 px-3">Désignation</th>
                      <th className="py-2 px-3 text-right">Dév (mm)</th>
                      <th className="py-2 px-3 text-right">Long. (m)</th>
                      <th className="py-2 px-3 text-right">Qté</th>
                      <th className="py-2 px-3 text-center">Plis</th>
                      <th className="py-2 px-3">Matière</th>
                      <th className="py-2 px-3">Détail</th>
                      <th className="py-2 px-3 text-center"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {extractedPieces.map((p, idx) => {
                      const isSelected = selectedIndices.includes(idx);
                      return (
                        <tr
                          key={p.id}
                          className={`hover:bg-slate-50 transition-colors ${
                            !isSelected ? 'opacity-40' : ''
                          }`}
                        >
                          <td className="py-2 px-3 text-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleSelect(idx)}
                              className="rounded border-slate-300 text-[#00478a] focus:ring-0"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="text"
                              value={p.label}
                              onChange={(e) => handleUpdatePiece(idx, 'label', e.target.value)}
                              className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs text-slate-800 font-medium focus:border-[#00478a] focus:bg-white"
                            />
                          </td>
                          <td className="py-2 px-3 text-right">
                            <input
                              type="number"
                              value={p.dev}
                              onChange={(e) =>
                                handleUpdatePiece(idx, 'dev', Number(e.target.value) || 0)
                              }
                              className="w-20 bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs font-mono font-bold text-[#00478a] text-right focus:border-[#00478a] focus:bg-white"
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
                              className="w-20 bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs font-mono text-slate-800 text-right focus:border-[#00478a] focus:bg-white"
                            />
                          </td>
                          <td className="py-2 px-3 text-right">
                            <input
                              type="number"
                              value={p.quantity}
                              onChange={(e) =>
                                handleUpdatePiece(idx, 'quantity', Number(e.target.value) || 1)
                              }
                              className="w-16 bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs font-mono font-bold text-slate-900 text-right focus:border-[#00478a] focus:bg-white"
                            />
                          </td>
                          <td className="py-2 px-3 text-center">
                            <input
                              type="number"
                              value={p.bends}
                              onChange={(e) =>
                                handleUpdatePiece(idx, 'bends', Number(e.target.value) || 2)
                              }
                              className="w-14 bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs font-mono text-slate-600 text-center focus:border-[#00478a] focus:bg-white"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <select
                              value={p.material || currentDefaultMaterial}
                              onChange={(e) => handleUpdatePiece(idx, 'material', e.target.value)}
                              className="w-44 bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs text-slate-700 focus:border-[#00478a] focus:bg-white font-sans"
                            >
                              {MATERIAL_GROUPS.map((grp) => (
                                <optgroup key={grp.group} label={grp.group}>
                                  {grp.items.map((mat) => (
                                    <option key={mat.value} value={mat.value}>
                                      {mat.value}
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                            </select>
                          </td>
                          <td className="py-2 px-3 text-slate-500 font-mono text-[11px] truncate max-w-[200px]">
                            {p.workshopSplitReason || '-'}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <button
                              type="button"
                              onClick={() => handleDeletePiece(idx)}
                              className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors cursor-pointer"
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
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            {extractedPieces.length > 0 ? (
              <span>
                <strong className="text-slate-800">{selectedIndices.length}</strong> pièce(s)
                sélectionnée(s) sur {extractedPieces.length}
              </span>
            ) : (
              <span>Sélectionnez un document à analyser</span>
            )}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-600 border border-slate-200 font-medium rounded-lg text-xs transition-colors cursor-pointer"
            >
              Annuler
            </button>

            {extractedPieces.length > 0 && (
              <button
                type="button"
                onClick={handleConfirmImport}
                disabled={selectedIndices.length === 0}
                className="px-5 py-2 bg-[#e7511f] hover:bg-[#cf4315] disabled:opacity-40 text-white font-bold rounded-lg text-xs flex items-center gap-2 transition-colors shadow-xs cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>
                  {targetMode === 'calculator'
                    ? 'Valider et Injecter'
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
