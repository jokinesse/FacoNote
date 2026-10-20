import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Calculator as CalcIcon,
  Delete,
  ArrowRight,
  Copy,
  Check,
  RotateCcw,
  Sparkles,
  Layers,
  Hash,
  Ruler,
  PlusCircle,
  HelpCircle,
} from 'lucide-react';
import { evaluateExpression } from '../utils/mathEvaluator';

interface WorkshopCalculatorProps {
  onInsertDev?: (devValue: number) => void;
  onInsertLength?: (lengthValue: number) => void;
  onInsertQty?: (qtyValue: number) => void;
  onDirectAddEntry?: (devValue: number) => void;
}

export const WorkshopCalculator: React.FC<WorkshopCalculatorProps> = ({
  onInsertDev,
  onInsertLength,
  onInsertQty,
  onDirectAddEntry,
}) => {
  const [expression, setExpression] = useState<string>('');
  const [result, setResult] = useState<number | null>(null);
  const [history, setHistory] = useState<{ expr: string; res: number }[]>([]);
  const [copied, setCopied] = useState<boolean>(false);
  const [isFocused, setIsFocused] = useState<boolean>(false);
  const [activeFlashedKey, setActiveFlashedKey] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const flashTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Trigger brief visual feedback on key button
  const flashKey = useCallback((keyToken: string) => {
    setActiveFlashedKey(keyToken);
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = setTimeout(() => {
      setActiveFlashedKey(null);
    }, 180);
  }, []);

  // Evaluate current expression in real-time
  useEffect(() => {
    if (!expression.trim()) {
      setResult(null);
      return;
    }
    const evaluated = evaluateExpression(expression);
    if (!isNaN(evaluated)) {
      setResult(Math.round(evaluated * 1000) / 1000);
    } else {
      setResult(null);
    }
  }, [expression]);

  // Append token to expression
  const appendToken = useCallback((token: string) => {
    setExpression((prev) => prev + token);
    inputRef.current?.focus();
  }, []);

  const handleBackspace = useCallback(() => {
    setExpression((prev) => prev.slice(0, -1));
    inputRef.current?.focus();
  }, []);

  const handleClear = useCallback(() => {
    setExpression('');
    setResult(null);
    inputRef.current?.focus();
  }, []);

  // Handle calculation submission / commit
  const handleCommitCalculation = useCallback(() => {
    if (result !== null && !isNaN(result)) {
      setHistory((prev) => [
        { expr: expression, res: result },
        ...prev.filter((h) => h.expr !== expression).slice(0, 4), // max 5 unique
      ]);
      setExpression(result.toString());
      flashKey('=');
    }
  }, [expression, result, flashKey]);

  // Global & Container Keyboard / Numpad capture
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isAnotherInput =
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.tagName === 'SELECT') &&
        activeEl !== inputRef.current;

      // If user is focused inside another form input (e.g. dev, length, qty box), let them type normally
      if (isAnotherInput) {
        return;
      }

      const key = e.key;
      const code = e.code;
      const isNumpad =
        code.startsWith('Numpad') || code === 'NumpadEnter' || code === 'NumpadDecimal';

      if (/^[0-9]$/.test(key)) {
        e.preventDefault();
        appendToken(key);
        flashKey(key);
      } else if (key === '+' || key === '-' || key === '*' || key === '/') {
        e.preventDefault();
        appendToken(key);
        flashKey(key);
      } else if (key === '.' || key === ',') {
        e.preventDefault();
        appendToken('.');
        flashKey('.');
      } else if (key === 'Enter' || key === '=') {
        e.preventDefault();
        handleCommitCalculation();
      } else if (key === 'Backspace' && activeEl !== inputRef.current) {
        e.preventDefault();
        handleBackspace();
        flashKey('⌫');
      } else if (key === 'Escape') {
        e.preventDefault();
        handleClear();
        flashKey('C');
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [appendToken, handleBackspace, handleClear, handleCommitCalculation, flashKey]);

  // Direct input field keydown
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === '=') {
      e.preventDefault();
      handleCommitCalculation();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleClear();
    }
  };

  const handleCopyResult = async () => {
    const val = result !== null ? result : parseFloat(expression);
    if (!isNaN(val)) {
      try {
        await navigator.clipboard.writeText(val.toString());
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Fallback
      }
    }
  };

  const getActiveNumericValue = (): number | null => {
    if (result !== null && !isNaN(result)) return result;
    const parsed = parseFloat(expression.replace(',', '.'));
    if (!isNaN(parsed)) return parsed;
    return null;
  };

  const handleSendToDev = () => {
    const val = getActiveNumericValue();
    if (val !== null && onInsertDev) {
      onInsertDev(Math.round(val));
    }
  };

  const handleSendToLength = () => {
    const val = getActiveNumericValue();
    if (val !== null && onInsertLength) {
      onInsertLength(Math.round(val * 100) / 100);
    }
  };

  const handleSendToQty = () => {
    const val = getActiveNumericValue();
    if (val !== null && onInsertQty) {
      onInsertQty(Math.max(1, Math.round(val)));
    }
  };

  const handleDirectAdd = () => {
    const val = getActiveNumericValue();
    if (val !== null && onDirectAddEntry) {
      onDirectAddEntry(Math.round(val));
    }
  };

  // Helper button styling
  const getKeyStyle = (keyToken: string, baseColor: string) => {
    const isFlashed = activeFlashedKey === keyToken;
    return `${baseColor} ${
      isFlashed
        ? 'ring-2 ring-amber-400 brightness-150 scale-95 shadow-md shadow-amber-500/30'
        : ''
    } transition-all duration-75 active:scale-95 select-none`;
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onClick={() => inputRef.current?.focus()}
      className={`bg-slate-900 border rounded-2xl p-5 shadow-sm transition-all duration-200 outline-none ${
        isFocused
          ? 'border-amber-400/80 shadow-md shadow-amber-500/10 ring-1 ring-amber-400/40'
          : 'border-slate-800 hover:border-slate-700'
      }`}
    >
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 shrink-0">
            <CalcIcon className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <span>Calculatrice Atelier & Pavé Numérique</span>
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-mono font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                Numpad Actif
              </span>
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Tapez vos cotes directement sur votre pavé numérique physique (ex:{' '}
              <span className="text-amber-300 font-mono font-semibold">15+120+35+20</span>), le
              résultat s'affiche en direct.
            </p>
          </div>
        </div>

        {/* Numpad keyboard hints */}
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-400 bg-slate-950/60 px-2.5 py-1 rounded-lg border border-slate-800 shrink-0">
          <span className="text-slate-500">Pavé :</span>
          <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200">0-9</kbd>
          <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-amber-300">+</kbd>
          <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-amber-300">-</kbd>
          <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-amber-300">*</kbd>
          <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-amber-300">/</kbd>
          <kbd className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
            Entrée =
          </kbd>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 mt-4 items-start">
        {/* Left Column: LCD Screen & Keypad Grid */}
        <div className="lg:col-span-7 space-y-3">
          {/* LCD Screen Display */}
          <div
            onClick={(e) => {
              e.stopPropagation();
              inputRef.current?.focus();
            }}
            className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-2 focus-within:border-amber-400/80 transition-colors shadow-inner"
          >
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
                Calcul en cours :
              </span>
              {result !== null && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-emerald-400 font-medium">
                    Résultat direct :
                  </span>
                  <span className="text-lg font-bold font-mono text-white tabular-nums bg-slate-900 px-2 py-0.5 rounded border border-emerald-500/30">
                    = {result}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopyResult();
                    }}
                    className="p-1 hover:text-white transition-colors text-slate-400"
                    title="Copier le résultat"
                  >
                    {copied ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={expression}
                onChange={(e) => setExpression(e.target.value)}
                onKeyDown={handleInputKeyDown}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                placeholder="Ex: 15+120+35+20 ou 8*2.5"
                className="w-full bg-transparent text-xl font-mono font-bold text-amber-300 focus:outline-none placeholder:text-slate-600 tracking-wider"
              />
              {expression && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClear();
                  }}
                  className="p-1.5 text-slate-500 hover:text-rose-400 transition-colors rounded hover:bg-slate-800"
                  title="Effacer l'expression (Échap)"
                >
                  <Delete className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Virtual Buttons Keypad Grid */}
          <div className="grid grid-cols-5 gap-1.5 font-mono text-sm select-none">
            {/* Row 1 */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleClear();
                flashKey('C');
              }}
              className={getKeyStyle(
                'C',
                'py-2.5 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 font-bold rounded-lg border border-rose-800/50'
              )}
              title="Tout effacer (Échap)"
            >
              C
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                appendToken('(');
                flashKey('(');
              }}
              className={getKeyStyle(
                '(',
                'py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-lg border border-slate-700/80'
              )}
            >
              (
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                appendToken(')');
                flashKey(')');
              }}
              className={getKeyStyle(
                ')',
                'py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-lg border border-slate-700/80'
              )}
            >
              )
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleBackspace();
                flashKey('⌫');
              }}
              className={getKeyStyle(
                '⌫',
                'py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700/80 flex items-center justify-center'
              )}
              title="Retour arrière"
            >
              ⌫
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                appendToken('/');
                flashKey('/');
              }}
              className={getKeyStyle(
                '/',
                'py-2.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-bold rounded-lg border border-amber-500/40 text-base'
              )}
            >
              ÷
            </button>

            {/* Row 2 */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                appendToken('7');
                flashKey('7');
              }}
              className={getKeyStyle(
                '7',
                'py-2.5 bg-slate-800/80 hover:bg-slate-700 text-white font-bold rounded-lg border border-slate-700/60 text-base'
              )}
            >
              7
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                appendToken('8');
                flashKey('8');
              }}
              className={getKeyStyle(
                '8',
                'py-2.5 bg-slate-800/80 hover:bg-slate-700 text-white font-bold rounded-lg border border-slate-700/60 text-base'
              )}
            >
              8
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                appendToken('9');
                flashKey('9');
              }}
              className={getKeyStyle(
                '9',
                'py-2.5 bg-slate-800/80 hover:bg-slate-700 text-white font-bold rounded-lg border border-slate-700/60 text-base'
              )}
            >
              9
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                appendToken('*');
                flashKey('*');
              }}
              className={getKeyStyle(
                '*',
                'py-2.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-bold rounded-lg border border-amber-500/40 text-base'
              )}
            >
              ×
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                appendToken('-');
                flashKey('-');
              }}
              className={getKeyStyle(
                '-',
                'py-2.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-bold rounded-lg border border-amber-500/40 text-base'
              )}
            >
              -
            </button>

            {/* Row 3 */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                appendToken('4');
                flashKey('4');
              }}
              className={getKeyStyle(
                '4',
                'py-2.5 bg-slate-800/80 hover:bg-slate-700 text-white font-bold rounded-lg border border-slate-700/60 text-base'
              )}
            >
              4
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                appendToken('5');
                flashKey('5');
              }}
              className={getKeyStyle(
                '5',
                'py-2.5 bg-slate-800/80 hover:bg-slate-700 text-white font-bold rounded-lg border border-slate-700/60 text-base'
              )}
            >
              5
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                appendToken('6');
                flashKey('6');
              }}
              className={getKeyStyle(
                '6',
                'py-2.5 bg-slate-800/80 hover:bg-slate-700 text-white font-bold rounded-lg border border-slate-700/60 text-base'
              )}
            >
              6
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                appendToken('+');
                flashKey('+');
              }}
              className={getKeyStyle(
                '+',
                'py-2.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-bold rounded-lg border border-amber-500/40 text-base'
              )}
            >
              +
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                appendToken('.');
                flashKey('.');
              }}
              className={getKeyStyle(
                '.',
                'py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-lg border border-slate-700/60 text-base'
              )}
            >
              .
            </button>

            {/* Row 4 */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                appendToken('1');
                flashKey('1');
              }}
              className={getKeyStyle(
                '1',
                'py-2.5 bg-slate-800/80 hover:bg-slate-700 text-white font-bold rounded-lg border border-slate-700/60 text-base'
              )}
            >
              1
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                appendToken('2');
                flashKey('2');
              }}
              className={getKeyStyle(
                '2',
                'py-2.5 bg-slate-800/80 hover:bg-slate-700 text-white font-bold rounded-lg border border-slate-700/60 text-base'
              )}
            >
              2
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                appendToken('3');
                flashKey('3');
              }}
              className={getKeyStyle(
                '3',
                'py-2.5 bg-slate-800/80 hover:bg-slate-700 text-white font-bold rounded-lg border border-slate-700/60 text-base'
              )}
            >
              3
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                appendToken('0');
                flashKey('0');
              }}
              className={getKeyStyle(
                '0',
                'py-2.5 bg-slate-800/80 hover:bg-slate-700 text-white font-bold rounded-lg border border-slate-700/60 text-base col-span-1'
              )}
            >
              0
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleCommitCalculation();
                flashKey('=');
              }}
              className={getKeyStyle(
                '=',
                'py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-black rounded-lg text-base shadow-sm'
              )}
              title="Calculer (Entrée)"
            >
              =
            </button>
          </div>

          {/* Quick Profile Shortcuts */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px] text-slate-400">
            <span className="text-slate-500 font-mono text-[10px]">Exemples de profil :</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpression('15+120+35+20');
              }}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-[10px] border border-slate-700/50"
            >
              Bavette (15+120+35+20)
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpression('20+180+30+20');
              }}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-[10px] border border-slate-700/50"
            >
              Rive (20+180+30+20)
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpression('20+35+200+35+20');
              }}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-[10px] border border-slate-700/50"
            >
              Couvertine (20+35+200+35+20)
            </button>
          </div>
        </div>

        {/* Right Column: Direct Injection & History */}
        <div className="lg:col-span-5 space-y-3">
          <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 space-y-2.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Injecter directement dans l'encodage :
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-2">
              {onInsertDev && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSendToDev();
                  }}
                  disabled={getActiveNumericValue() === null}
                  className="w-full px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 text-amber-300 font-semibold rounded-lg text-xs flex items-center justify-between border border-slate-700 transition-colors shadow-sm"
                >
                  <span className="flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-amber-400" />
                    <span>Vers Dév (mm)</span>
                  </span>
                  <span className="font-mono font-bold text-white">
                    {getActiveNumericValue() !== null
                      ? `${Math.round(getActiveNumericValue()!)} mm`
                      : '-'}
                  </span>
                </button>
              )}

              {onInsertLength && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSendToLength();
                  }}
                  disabled={getActiveNumericValue() === null}
                  className="w-full px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 text-slate-200 font-semibold rounded-lg text-xs flex items-center justify-between border border-slate-700 transition-colors shadow-sm"
                >
                  <span className="flex items-center gap-1.5">
                    <Ruler className="w-3.5 h-3.5 text-amber-400" />
                    <span>Vers Longueur (m)</span>
                  </span>
                  <span className="font-mono font-bold text-white">
                    {getActiveNumericValue() !== null
                      ? `${Math.round(getActiveNumericValue()! * 100) / 100} m`
                      : '-'}
                  </span>
                </button>
              )}

              {onInsertQty && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSendToQty();
                  }}
                  disabled={getActiveNumericValue() === null}
                  className="w-full px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 text-slate-200 font-semibold rounded-lg text-xs flex items-center justify-between border border-slate-700 transition-colors shadow-sm"
                >
                  <span className="flex items-center gap-1.5">
                    <Hash className="w-3.5 h-3.5 text-amber-400" />
                    <span>Vers Quantité</span>
                  </span>
                  <span className="font-mono font-bold text-white">
                    {getActiveNumericValue() !== null
                      ? `${Math.max(1, Math.round(getActiveNumericValue()!))} pcs`
                      : '-'}
                  </span>
                </button>
              )}
            </div>

            {/* Direct 1-click Add Piece Button */}
            {onDirectAddEntry && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDirectAdd();
                }}
                disabled={getActiveNumericValue() === null}
                className="w-full mt-1 px-3 py-2.5 bg-amber-400 hover:bg-amber-300 disabled:opacity-40 disabled:hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs flex items-center justify-center gap-2 transition-colors shadow-sm"
              >
                <PlusCircle className="w-4 h-4" />
                <span>
                  Ajouter directement à l'encodage (Dév{' '}
                  {getActiveNumericValue() !== null
                    ? `${Math.round(getActiveNumericValue()!)}mm`
                    : '...'}
                  )
                </span>
              </button>
            )}
          </div>

          {/* Recent History in this session */}
          {history.length > 0 && (
            <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-3 space-y-1.5">
              <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block">
                Derniers calculs :
              </span>
              <div className="space-y-1">
                {history.map((h, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpression(h.res.toString());
                    }}
                    className="w-full px-2 py-1 rounded bg-slate-900/80 hover:bg-slate-800 text-[11px] font-mono flex items-center justify-between text-slate-300 border border-slate-800/80 text-left transition-colors"
                  >
                    <span className="text-slate-400 truncate max-w-[150px]">{h.expr}</span>
                    <strong className="text-amber-400">= {h.res}</strong>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
