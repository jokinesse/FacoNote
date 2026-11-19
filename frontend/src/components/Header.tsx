import React from 'react';
import { Gauge, Check } from 'lucide-react';

export type AppTab = 'calculator' | 'optimizer' | 'send' | 'stress';

interface HeaderProps {
  activeTab: AppTab;
  onStep: (tab: AppTab) => void;
  isAdminUnlocked?: boolean;
}

// Parcours en 3 étapes : Saisir → Découper → Envoyer vers D365
export const STEPS: { tab: AppTab; label: string }[] = [
  { tab: 'calculator', label: 'Saisir' },
  { tab: 'optimizer', label: 'Découper' },
  { tab: 'send', label: 'Envoyer vers D365' },
];

export const Header: React.FC<HeaderProps> = ({ activeTab, onStep, isAdminUnlocked = false }) => {
  const current = STEPS.findIndex((s) => s.tab === activeTab);
  return (
    <header className="no-print bg-white border-b border-slate-200 sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4 h-14">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 rounded-md bg-[#00478a] flex items-center justify-center font-extrabold text-white text-sm tracking-tight relative">
              FZ
              <span className="w-2 h-2 rounded-full bg-[#e7511f] absolute -bottom-0.5 -right-0.5 border border-white" />
            </div>
            <span className="hidden md:inline text-base font-extrabold tracking-tight text-[#00478a]">
              FACO<span className="text-[#3ca7da]">ZINC</span>
            </span>
          </div>

          <nav aria-label="Étapes" className="flex items-center min-w-0">
            <ol className="flex items-center gap-1 sm:gap-2">
              {STEPS.map((s, i) => {
                const isActive = i === current;
                const isDone = current > i;
                return (
                  <li key={s.tab} className="flex items-center gap-1 sm:gap-2">
                    {i > 0 && <span className="w-4 sm:w-8 h-px bg-slate-300" aria-hidden="true" />}
                    <button
                      type="button"
                      onClick={() => onStep(s.tab)}
                      aria-current={isActive ? 'step' : undefined}
                      className={`flex items-center gap-2 pl-1 pr-3 py-1 rounded-full text-xs font-semibold transition-colors cursor-pointer ${
                        isActive ? 'bg-[#00478a] text-white' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <span
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${
                          isActive
                            ? 'bg-white text-[#00478a]'
                            : isDone
                            ? 'bg-[#3ca7da] text-white'
                            : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {isDone ? <Check className="w-3.5 h-3.5" /> : i + 1}
                      </span>
                      <span className={isActive ? '' : 'hidden sm:inline'}>{s.label}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          <div className="shrink-0 w-8 flex justify-end">
            {isAdminUnlocked && (
              <button
                type="button"
                onClick={() => onStep('stress')}
                title="Admin"
                aria-label="Admin"
                className={`p-1.5 rounded-lg cursor-pointer ${
                  activeTab === 'stress' ? 'bg-[#00478a] text-white' : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                <Gauge className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

// Titre d'étape : une phrase d'aide, pas plus
export const StepIntro: React.FC<{ step: number; title: string; hint: string; children?: React.ReactNode }> = ({
  step,
  title,
  hint,
  children,
}) => (
  <div className="flex flex-wrap items-end justify-between gap-3">
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-[#3ca7da]">Étape {step} sur 3</div>
      <h1 className="text-xl font-bold text-[#282828] leading-tight">{title}</h1>
      <p className="text-sm text-slate-500 mt-0.5">{hint}</p>
    </div>
    {children}
  </div>
);

// Bouton « Suivant » en bas d'une étape
export const NextStep: React.FC<{ label: string; onClick: () => void; secondary?: React.ReactNode }> = ({
  label,
  onClick,
  secondary,
}) => (
  <div className="no-print flex flex-wrap items-center justify-end gap-3 pt-2">
    {secondary}
    <button
      type="button"
      onClick={onClick}
      className="px-5 py-2.5 bg-[#00478a] hover:bg-[#003566] text-white font-semibold rounded-lg text-sm flex items-center gap-2 shadow-xs cursor-pointer"
    >
      <span>{label}</span>
      <span aria-hidden="true">→</span>
    </button>
  </div>
);
