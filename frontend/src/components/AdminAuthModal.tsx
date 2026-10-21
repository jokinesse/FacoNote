import React, { useEffect, useState } from 'react';
import { ShieldCheck, Lock, Eye, EyeOff, AlertTriangle, X, KeyRound } from 'lucide-react';
import { adminApi, ApiError } from '../api';

interface AdminAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthenticated: (token: string, expiresInSec: number) => void;
}

export const AdminAuthModal: React.FC<AdminAuthModalProps> = ({
  isOpen,
  onClose,
  onAuthenticated,
}) => {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lockedSec, setLockedSec] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    setPassword('');
    setErrorMsg(null);
    adminApi
      .getStatus()
      .then((res) => {
        setConfigured(res.data.configured);
        setLockedSec(res.data.retry_after_sec);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Serveur injoignable';
        setErrorMsg(msg);
      });
  }, [isOpen]);

  useEffect(() => {
    if (lockedSec <= 0) return;
    const id = setInterval(() => {
      setLockedSec((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [lockedSec]);

  if (!isOpen) return null;

  const isFirstSetup = configured === false;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!password.trim() || isLoading || lockedSec > 0) return;
    setIsLoading(true);
    setErrorMsg(null);

    try {
      const res = isFirstSetup
        ? await adminApi.setup(password)
        : await adminApi.login(password);
      onAuthenticated(res.data.token, res.data.ttl_sec);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setErrorMsg(err.message);
        if (err.status === 429) {
          adminApi.getStatus().then((s) => setLockedSec(s.data.retry_after_sec)).catch(() => {});
        }
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Erreur d’authentification');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-modal-title"
    >
      <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-[#00478a]/10 border border-[#00478a]/20 text-[#00478a]">
              {isFirstSetup ? <KeyRound className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
            </div>
            <div>
              <h2 id="admin-modal-title" className="text-base font-bold text-[#282828]">
                {isFirstSetup ? 'Initialiser le Coffre-Fort Admin' : 'Accès Restreint — Stress Lab'}
              </h2>
              <p className="text-xs text-slate-500">
                {isFirstSetup
                  ? 'Première ouverture locale : créez votre mot de passe (haché en scrypt salé).'
                  : 'Authentification vérifiée côté serveur (scrypt + jeton éphémère 256 bits).'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer la fenêtre d'authentification"
            className="text-slate-400 hover:text-slate-700 p-1 rounded cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Champ identifiant masqué pour aider le gestionnaire de mots de passe du navigateur */}
          <input
            type="text"
            name="username"
            autoComplete="username"
            defaultValue="admin-faconote"
            readOnly
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
          />

          <div>
            <label
              htmlFor={isFirstSetup ? 'new-password' : 'current-password'}
              className="text-xs font-semibold text-slate-700 block mb-1.5"
            >
              {isFirstSetup ? 'Nouveau mot de passe Admin (min. 8 caractères)' : 'Mot de passe Administrateur'}
            </label>
            <div className="relative">
              <input
                id={isFirstSetup ? 'new-password' : 'current-password'}
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={isFirstSetup ? 'new-password' : 'current-password'}
                enterKeyHint="done"
                minLength={isFirstSetup ? 8 : 1}
                required
                autoFocus
                disabled={lockedSec > 0 || isLoading}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full bg-[#f8fafc] border border-slate-300 rounded-lg pl-3.5 pr-20 py-2.5 text-sm font-mono text-[#282828] focus:outline-none focus:border-[#00478a] focus:bg-white disabled:opacity-50 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-[11px] font-medium text-slate-500 hover:text-slate-800 flex items-center gap-1 rounded bg-white border border-slate-200 cursor-pointer shadow-2xs transition-colors"
              >
                {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span>{showPassword ? 'Masquer' : 'Voir'}</span>
              </button>
            </div>
          </div>

          {(errorMsg || lockedSec > 0) && (
            <div
              role="alert"
              className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-xs text-rose-800 flex items-start gap-2"
            >
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                {lockedSec > 0 ? (
                  <span>
                    Protection anti-bruteforce active : réessayez dans{' '}
                    <strong className="font-mono">{lockedSec} s</strong>.
                  </span>
                ) : (
                  <span>{errorMsg}</span>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-1">
            <span className="text-[11px] text-slate-500 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              Session 30 min · Raccourci <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-slate-700 text-[10px]">Ctrl+Shift+L</kbd>
            </span>

            <button
              type="submit"
              disabled={isLoading || lockedSec > 0 || !password.trim()}
              className="px-4 py-2 bg-[#00478a] hover:bg-[#003870] disabled:opacity-40 text-white font-bold rounded-lg text-xs cursor-pointer transition-colors shadow-2xs"
            >
              {isLoading
                ? 'Vérification...'
                : isFirstSetup
                ? 'Enregistrer & Déverrouiller'
                : 'Déverrouiller Stress Lab'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
