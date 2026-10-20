import React from 'react';
import { Calculator, FileSearch, Gauge } from 'lucide-react';

export type AppTab = 'calculator' | 'optimizer' | 'stress';

interface HeaderProps {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
}) => {
  return (
    <header className="no-print bg-slate-950/90 border-b border-slate-800 sticky top-0 z-30 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-8 h-16">
          {/* Zone 1: Brand wordmark */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-9 h-9 rounded bg-amber-500 flex items-center justify-center font-black text-slate-950 text-xl tracking-tighter shadow-sm">
              FZ
            </div>
            <div className="flex flex-col">
              <span className="text-lg font-bold tracking-tight text-white whitespace-nowrap">
                FACOZINC
              </span>
              <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">
                Aide à l'Encodage & Optimisation Atelier
              </span>
            </div>
          </div>

          {/* Zone 2: Navigation Links */}
          <nav className="hidden md:flex items-center gap-2">
            <button
              onClick={() => setActiveTab('calculator')}
              className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                activeTab === 'calculator'
                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Calculator className="w-3.5 h-3.5" />
              <span>Calculateur de Développement</span>
            </button>

            <button
              onClick={() => setActiveTab('optimizer')}
              className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                activeTab === 'optimizer'
                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <FileSearch className="w-3.5 h-3.5" />
              <span>Optimisation Matière & Analyse PDF</span>
            </button>

            <button
              onClick={() => setActiveTab('stress')}
              className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                activeTab === 'stress'
                  ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Gauge className="w-3.5 h-3.5" />
              <span>Stress Lab</span>
            </button>
          </nav>
        </div>

        {/* Mobile Navigation bar */}
        <div className="md:hidden flex items-center justify-around py-2 border-t border-slate-800 text-[11px]">
          <button
            onClick={() => setActiveTab('calculator')}
            className={`py-1 px-4 font-medium ${activeTab === 'calculator' ? 'text-amber-400 border-b-2 border-amber-400' : 'text-slate-400'}`}
          >
            Calculateur
          </button>
          <button
            onClick={() => setActiveTab('optimizer')}
            className={`py-1 px-4 font-medium ${activeTab === 'optimizer' ? 'text-amber-400 border-b-2 border-amber-400' : 'text-slate-400'}`}
          >
            Optimisation Matière
          </button>
          <button
            onClick={() => setActiveTab('stress')}
            className={`py-1 px-4 font-medium ${activeTab === 'stress' ? 'text-sky-300 border-b-2 border-sky-300' : 'text-slate-400'}`}
          >
            Stress Lab
          </button>
        </div>
      </div>
    </header>
  );
};
