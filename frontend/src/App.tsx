import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { Header, AppTab } from './components/Header';
import { FastEncoder } from './components/FastEncoder';
import { OptimizerTab } from './components/OptimizerTab';
import { MobileScannerApp } from './components/MobileScannerApp';
import { AdminAuthModal } from './components/AdminAuthModal';
import { ADMIN_TOKEN_STORAGE_KEY, adminApi } from './api';
import { ShapedPiece } from './types';

// Code-splitting : le bundle de StressLab n'est téléchargé qu'une fois l'Admin authentifié
const LazyStressLab = React.lazy(() =>
  import('./components/StressLab').then((m) => ({ default: m.StressLab }))
);

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('calculator');
  const [isMobileMode, setIsMobileMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const path = window.location.pathname;
    const search = window.location.search;
    return path.startsWith('/mobile') || search.includes('session=') || search.includes('view=mobile');
  });

  // Pieces transferred from Calculator to Optimizer
  const [transferredPieces, setTransferredPieces] = useState<ShapedPiece[]>([]);

  // État d'authentification Admin (Coffre-Fort 5 piliers)
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [adminExpiresIn, setAdminExpiresIn] = useState<number>(0);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState<boolean>(false);

  // Vérification initiale d'un éventuel jeton déjà présent en sessionStorage
  useEffect(() => {
    const saved = sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
    const hasAdminQuery = new URLSearchParams(window.location.search).get('admin') === '1';

    if (saved) {
      adminApi
        .getStatus(saved)
        .then((res) => {
          if (res.data.authenticated && res.data.expires_in_sec > 0) {
            setAdminToken(saved);
            setAdminExpiresIn(res.data.expires_in_sec);
            if (hasAdminQuery) setActiveTab('stress');
          } else {
            sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
            if (hasAdminQuery) setIsAdminModalOpen(true);
          }
        })
        .catch(() => {
          if (hasAdminQuery) setIsAdminModalOpen(true);
        });
    } else if (hasAdminQuery) {
      setIsAdminModalOpen(true);
    }
  }, []);

  // Décompte du temps restant de la session Admin (30 min max)
  useEffect(() => {
    if (!adminToken) return;
    const id = setInterval(() => {
      setAdminExpiresIn((prev) => {
        if (prev <= 1) {
          sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
          setAdminToken(null);
          setActiveTab((tab) => (tab === 'stress' ? 'calculator' : tab));
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [adminToken]);

  // Raccourci clavier furtif : Ctrl + Shift + L pour ouvrir / rejoindre le Stress Lab
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        if (adminToken) {
          setActiveTab('stress');
        } else {
          setIsAdminModalOpen(true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [adminToken]);

  const handleLockAdmin = useCallback(() => {
    const token = adminToken;
    sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    setAdminToken(null);
    setAdminExpiresIn(0);
    setActiveTab('calculator');
    if (token) {
      adminApi.logout(token).catch(() => {});
    }
  }, [adminToken]);

  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      const search = window.location.search;
      setIsMobileMode(path.startsWith('/mobile') || search.includes('session=') || search.includes('view=mobile'));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Bridge from FastEncoder to Optimizer
  const handleTransferToOptimizer = (pieces: ShapedPiece[]) => {
    setTransferredPieces(pieces);
    setActiveTab('optimizer');
  };

  if (isMobileMode) {
    const urlParams = new URLSearchParams(window.location.search);
    const initialSession = urlParams.get('session') || '';
    return (
      <MobileScannerApp
        initialSessionId={initialSession}
        onExitToDesktop={() => {
          setIsMobileMode(false);
          window.history.pushState({}, '', '/');
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#f3f4f6] text-[#282828] flex flex-col font-sans">
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isAdminUnlocked={Boolean(adminToken)}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-5">
        {/* Persistent tab views: preserving state when switching between pages */}
        <div className={activeTab === 'calculator' ? 'block' : 'hidden'}>
          <FastEncoder onTransferToOptimizer={handleTransferToOptimizer} />
        </div>

        <div className={activeTab === 'optimizer' ? 'block' : 'hidden'}>
          <OptimizerTab initialPieces={transferredPieces} />
        </div>

        {adminToken && (
          <div className={activeTab === 'stress' ? 'block' : 'hidden'}>
            <Suspense
              fallback={
                <div className="p-8 text-center text-xs text-slate-500">
                  Chargement du Stress Lab...
                </div>
              }
            >
              <LazyStressLab
                adminToken={adminToken}
                expiresInSec={adminExpiresIn}
                onLock={handleLockAdmin}
              />
            </Suspense>
          </div>
        )}
      </main>

      <AdminAuthModal
        isOpen={isAdminModalOpen}
        onClose={() => setIsAdminModalOpen(false)}
        onAuthenticated={(token, ttlSec) => {
          sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
          setAdminToken(token);
          setAdminExpiresIn(ttlSec);
          setIsAdminModalOpen(false);
          setActiveTab('stress');
        }}
      />

      {/* Minimal Footer */}
      <footer className="no-print border-t border-slate-200 bg-white py-3 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between text-xs text-slate-500">
          <span className="font-semibold text-[#00478a]">FACOZINC</span>
          <span>Atelier Pliage & Façonnage</span>
        </div>
      </footer>
    </div>
  );
}
