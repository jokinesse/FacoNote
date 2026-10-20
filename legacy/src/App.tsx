import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { FastEncoder } from './components/FastEncoder';
import { OptimizerTab } from './components/OptimizerTab';
import { MobileScannerApp } from './components/MobileScannerApp';
import { ShapedPiece } from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState<'calculator' | 'optimizer'>('calculator');
  const [isMobileMode, setIsMobileMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const path = window.location.pathname;
    const search = window.location.search;
    return path.startsWith('/mobile') || search.includes('session=') || search.includes('view=mobile');
  });

  // Pieces transferred from Calculator to Optimizer
  const [transferredPieces, setTransferredPieces] = useState<ShapedPiece[]>([]);

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
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Persistent tab views: preserving state when switching between pages */}
        <div className={activeTab === 'calculator' ? 'block' : 'hidden'}>
          <FastEncoder onTransferToOptimizer={handleTransferToOptimizer} />
        </div>

        <div className={activeTab === 'optimizer' ? 'block' : 'hidden'}>
          <OptimizerTab initialPieces={transferredPieces} />
        </div>
      </main>

      {/* Footer */}
      <footer className="no-print border-t border-slate-900 bg-slate-950/90 py-4 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-2">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-400">FACOZINC</span>
            <span>·</span>
            <span>Assistant d'Encodage & Optimisation de Façonnage Atelier</span>
          </div>
          <div>
            <span>Spécialiste Zinc 0.7mm & Aluminium 0.7mm · Optimisation de Refente de Bobines</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
