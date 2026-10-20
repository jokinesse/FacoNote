import { mobileApi, ApiError } from '../api';
import React, { useState, useEffect, useRef } from 'react';
import {
  Camera,
  Upload,
  CheckCircle2,
  RefreshCw,
  RotateCw,
  Send,
  Smartphone,
  Laptop,
  ArrowLeft,
  Sparkles,
  AlertCircle,
  HelpCircle,
  ExternalLink,
} from 'lucide-react';

interface MobileScannerAppProps {
  initialSessionId?: string;
  onExitToDesktop?: () => void;
}

export function MobileScannerApp({
  initialSessionId = '',
  onExitToDesktop,
}: MobileScannerAppProps) {
  const [sessionId, setSessionId] = useState<string>(initialSessionId);
  const [sessionInput, setSessionInput] = useState<string>(initialSessionId);
  const [sessionValid, setSessionValid] = useState<boolean>(!!initialSessionId);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imageRotation, setImageRotation] = useState<number>(0);
  const [note, setNote] = useState<string>('');
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadSuccess, setUploadSuccess] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [autoSend, setAutoSend] = useState<boolean>(true);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // Parse session from URL if available
  useEffect(() => {
    if (!sessionId) {
      const params = new URLSearchParams(window.location.search);
      const urlSession = params.get('session');
      if (urlSession) {
        setSessionId(urlSession.trim());
        setSessionInput(urlSession.trim());
        setSessionValid(true);
      }
    }
  }, []);

  // Compress and read image file
  const handleFileProcess = (file: File) => {
    setErrorMessage(null);
    setUploadSuccess(false);

    if (!file.type.startsWith('image/')) {
      setErrorMessage('Veuillez sélectionner un fichier image valide (photo JPEG, PNG, WEBP).');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      // Pre-compress using canvas to ensure instant transfer even on slow mobile networks
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 1800; // Optimal resolution for Gemini OCR & rapid mobile transfer
        let w = img.width;
        let h = img.height;

        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }

        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h);
          const compressed = canvas.toDataURL('image/jpeg', 0.85);
          setSelectedImage(compressed);
          setImageRotation(0);

          if (autoSend && sessionId) {
            uploadPhoto(compressed, 0);
          }
        } else {
          setSelectedImage(dataUrl);
          if (autoSend && sessionId) {
            uploadPhoto(dataUrl, 0);
          }
        }
      };
      img.onerror = () => {
        setSelectedImage(dataUrl);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  // Rotate preview and image
  const handleRotate = () => {
    if (!selectedImage) return;
    const newRotation = (imageRotation + 90) % 360;
    setImageRotation(newRotation);

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      if (newRotation === 90 || newRotation === 270) {
        canvas.width = img.height;
        canvas.height = img.width;
      } else {
        canvas.width = img.width;
        canvas.height = img.height;
      }
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((newRotation * Math.PI) / 180);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
        setSelectedImage(canvas.toDataURL('image/jpeg', 0.85));
        setImageRotation(0);
      }
    };
    img.src = selectedImage;
  };

  // Upload photo to session endpoint
  const uploadPhoto = async (imagePayload?: string, _rotationOverride?: number) => {
    const payload = imagePayload || selectedImage;
    if (!payload) {
      setErrorMessage('Aucune photo à envoyer.');
      return;
    }
    if (!sessionId) {
      setErrorMessage('Session introuvable. Veuillez renseigner le code affiché sur votre PC.');
      return;
    }

    setIsUploading(true);
    setErrorMessage(null);

    try {
      const response = await mobileApi.uploadImage({
        session_id: sessionId,
        image_base64: payload,
        filename: `croquis_mobile_${Date.now()}.jpg`,
        note: note || undefined,
      });

      if (!response.data.success) {
        throw new Error(response.data.message || 'Erreur lors du transfert');
      }
      setUploadSuccess(true);
      // Gentle haptic feedback if supported by smartphone
      if (navigator.vibrate) {
        navigator.vibrate([40, 60, 40]);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Impossible d’envoyer la photo au PC.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleResetForNextPhoto = () => {
    setSelectedImage(null);
    setImageRotation(0);
    setUploadSuccess(false);
    setErrorMessage(null);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none pb-8">
      {/* Hidden file inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFileProcess(file);
          e.target.value = '';
        }}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFileProcess(file);
          e.target.value = '';
        }}
      />

      {/* Header bar */}
      <header className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur border-b border-slate-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
            <Smartphone className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-sm font-black tracking-wider uppercase text-white flex items-center gap-1.5">
              <span>Facozinc</span>
              <span className="text-[10px] bg-amber-400/20 text-amber-300 font-bold px-1.5 py-0.2 rounded border border-amber-400/30">
                Mobile
              </span>
            </h1>
            <p className="text-[10px] text-slate-400">Scanner de croquis atelier</p>
          </div>
        </div>

        {onExitToDesktop && (
          <button
            type="button"
            onClick={onExitToDesktop}
            className="text-xs text-slate-400 hover:text-white flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800/80 border border-slate-700"
          >
            <Laptop className="w-3.5 h-3.5" />
            <span>Vue PC</span>
          </button>
        )}
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-md w-full mx-auto px-4 py-4 space-y-4">
        {/* Session Status Banner */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Session Connectée
              </span>
              <span className="font-mono text-xs font-bold text-amber-300">
                {sessionId || 'Aucune'}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setSessionValid(false)}
            className="text-[11px] text-slate-400 hover:text-amber-300 underline underline-offset-2"
          >
            Modifier
          </button>
        </div>

        {/* Modal/Prompt to enter session if not set or changed */}
        {!sessionValid && (
          <div className="bg-slate-900/90 border border-amber-500/30 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2 text-amber-300">
              <Laptop className="w-4 h-4" />
              <h2 className="text-xs font-bold uppercase tracking-wide">
                Liaison avec l'écran du PC
              </h2>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Scannez le QR Code affiché sur votre PC ou entrez le code de session à 4 chiffres :
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={sessionInput}
                onChange={(e) => setSessionInput(e.target.value.toUpperCase())}
                placeholder="Ex: FAC-4829"
                className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-400"
              />
              <button
                type="button"
                onClick={() => {
                  if (sessionInput.trim()) {
                    setSessionId(sessionInput.trim());
                    setSessionValid(true);
                  }
                }}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg transition-colors"
              >
                Connecter
              </button>
            </div>
          </div>
        )}

        {/* Error Alert */}
        {errorMessage && (
          <div className="bg-rose-950/40 border border-rose-500/50 rounded-xl p-3 flex items-start gap-2.5 text-rose-300 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <p className="flex-1">{errorMessage}</p>
          </div>
        )}

        {/* STEP 1: No image selected yet */}
        {!selectedImage && !uploadSuccess && (
          <div className="space-y-4">
            {/* Primary Action: Direct Camera */}
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="w-full py-8 px-4 rounded-2xl bg-linear-to-b from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black flex flex-col items-center justify-center gap-3 shadow-lg shadow-amber-500/15 border border-amber-400 active:scale-[0.98] transition-all cursor-pointer"
            >
              <div className="w-16 h-16 rounded-full bg-slate-950/15 flex items-center justify-center shadow-inner">
                <Camera className="w-8 h-8 text-slate-950" />
              </div>
              <div className="text-center">
                <span className="text-base font-black uppercase tracking-wider block">
                  Prendre une photo du croquis
                </span>
                <span className="text-xs text-slate-900/80 font-semibold block mt-0.5">
                  Appareil photo smartphone en direct
                </span>
              </div>
            </button>

            {/* Secondary Action: Select from Gallery */}
            <button
              type="button"
              onClick={() => galleryInputRef.current?.click()}
              className="w-full py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 font-semibold text-xs flex items-center justify-center gap-2 border border-slate-700 shadow-sm transition-colors cursor-pointer"
            >
              <Upload className="w-4 h-4 text-amber-400" />
              <span>Choisir depuis la galerie / Fichiers</span>
            </button>

            {/* Quick Auto-Send Option */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 flex items-center justify-between text-xs text-slate-300">
              <label htmlFor="autoSendToggle" className="flex items-center gap-2 cursor-pointer">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span className="font-medium">Transfert automatique immédiat</span>
              </label>
              <input
                id="autoSendToggle"
                type="checkbox"
                checked={autoSend}
                onChange={(e) => setAutoSend(e.target.checked)}
                className="w-4 h-4 rounded text-amber-500 accent-amber-500 bg-slate-950 border-slate-700"
              />
            </div>

            {/* Workshop advice hint */}
            <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-3 space-y-1.5 text-[11px] text-slate-400">
              <div className="flex items-center gap-1.5 text-amber-400 font-semibold">
                <HelpCircle className="w-3.5 h-3.5" />
                <span>Conseil de cadrage atelier</span>
              </div>
              <p>
                Posez la feuille bien à plat et prenez la photo de face. L'IA extrait automatiquement
                les développés, les longueurs (ex: 2m), les quantités et les matières (Zinc/Alu).
              </p>
            </div>
          </div>
        )}

        {/* STEP 2: Image Preview & Confirmation (if not already uploaded) */}
        {selectedImage && !uploadSuccess && (
          <div className="space-y-4">
            <div className="relative bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-md">
              <img
                src={selectedImage}
                alt="Aperçu croquis"
                className="w-full max-h-[360px] object-contain bg-slate-950"
              />

              {/* Quick rotation toolbar */}
              <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-slate-900/90 backdrop-blur border border-slate-700/80 rounded-lg p-1 text-slate-300">
                <button
                  type="button"
                  onClick={handleRotate}
                  className="px-2 py-1 text-xs hover:text-white flex items-center gap-1 font-semibold"
                  title="Pivoter 90°"
                >
                  <RotateCw className="w-3.5 h-3.5 text-amber-400" />
                  <span>Pivoter</span>
                </button>
              </div>
            </div>

            {/* Optional note or profile title */}
            <div>
              <label htmlFor="croquisNote" className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Repère ou référence chantier (optionnel)
              </label>
              <input
                id="croquisNote"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ex: Bavettes côté cour, Chantier Dupont..."
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
              />
            </div>

            {/* Action buttons */}
            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={() => uploadPhoto()}
                disabled={isUploading}
                className="w-full py-3.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-sm flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer"
              >
                {isUploading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Transfert vers le PC en cours...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>Transférer sur l'écran du PC ⚡</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                disabled={isUploading}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 font-semibold text-xs flex items-center justify-center gap-2 border border-slate-700 transition-colors"
              >
                <Camera className="w-3.5 h-3.5 text-amber-400" />
                <span>Reprendre la photo</span>
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: Transfer Success Confirmation */}
        {uploadSuccess && (
          <div className="bg-slate-900/90 border border-emerald-500/40 rounded-2xl p-6 text-center space-y-4 shadow-lg shadow-emerald-950/20">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-10 h-10 animate-bounce" />
            </div>

            <div className="space-y-1">
              <h2 className="text-base font-black text-white uppercase tracking-wider">
                Photo Transmise au PC !
              </h2>
              <p className="text-xs text-slate-300 leading-relaxed">
                Le croquis est immédiatement apparu sur l'écran de votre ordinateur pour l'encodage
                et l'analyse IA.
              </p>
            </div>

            {selectedImage && (
              <div className="w-24 h-24 mx-auto rounded-lg overflow-hidden border border-slate-800 bg-slate-950">
                <img
                  src={selectedImage}
                  alt="Miniature envoyée"
                  className="w-full h-full object-cover"
                />
              </div>
            )}

            <div className="pt-2">
              <button
                type="button"
                onClick={handleResetForNextPhoto}
                className="w-full py-3.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-md transition-colors"
              >
                <Camera className="w-4 h-4" />
                <span>Prendre un autre croquis</span>
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="text-center text-[10px] text-slate-500 px-4 mt-auto">
        <span>Facozinc Atelier · Transmission instantanée en réseau sécurisé</span>
      </footer>
    </div>
  );
}
