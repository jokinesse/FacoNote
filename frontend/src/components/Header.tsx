import React from 'react';
import { Calculator, Scissors, Gauge } from 'lucide-react';

export type AppTab = 'calculator' | 'optimizer' | 'stress';

interface HeaderProps {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  isAdminUnlocked?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  isAdminUnlocked = false,
}) => {
  return (
    <header className="no-print bg-white border-b border-slate-200 border-t-4 border-t-[#00478a] sticky top-0 z-30 shadow-2xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-6 h-14">
          {/* Brand wordmark inspired by Facozinc.be */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 rounded-md bg-[#00478a] flex items-center justify-center font-extrabold text-white text-sm tracking-tight relative">
              FZ
              <span className="w-2 h-2 rounded-full bg-[#e7511f] absolute -bottom-0.5 -right-0.5 border border-white" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-base font-extrabold tracking-tight text-[#00478a]">
                FACO<span className="text-[#3ca7da]">ZINC</span>
              </span>
              <span className="text-xs text-slate-400 font-medium hidden sm:inline">
                Atelier
              </span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveTab('calculator')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                activeTab === 'calculator'
                  ? 'bg-[#00478a] text-white shadow-2xs'
                  : 'text-slate-600 hover:text-[#00478a] hover:bg-slate-100'
              }`}
            >
              <Calculator className="w-3.5 h-3.5" />
              <span>Calculateur</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('optimizer')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                activeTab === 'optimizer'
                  ? 'bg-[#00478a] text-white shadow-2xs'
                  : 'text-slate-600 hover:text-[#00478a] hover:bg-slate-100'
              }`}
            >
              <Scissors className="w-3.5 h-3.5" />
              <span>Optimisation & Coupe</span>
            </button>

            {isAdminUnlocked && (
              <button
                type="button"
                onClick={() => setActiveTab('stress')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  activeTab === 'stress'
                    ? 'bg-[#00478a] text-white shadow-2xs'
                    : 'text-slate-600 hover:text-[#00478a] hover:bg-slate-100'
                }`}
              >
                <Gauge className="w-3.5 h-3.5" />
                <span>Admin</span>
              </button>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
};
