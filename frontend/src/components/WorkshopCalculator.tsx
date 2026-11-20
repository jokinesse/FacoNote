import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Calculator as CalcIcon,
  Delete,
  Copy,
  Check,
  Layers,
  Hash,
  Ruler,
  PlusCircle,
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
  // Repliée par défaut : ouverte seulement quand on en a besoin
  const [isOpen, setIsOpen] = useState<boolean>(true);
  const [activeFlashedKey, setActiveFlashedKey] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const flashTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const flashKey = useCallback((keyToken: string) => {
    setActiveFlashedKey(keyToken);
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = setTimeout(() => {
      setActiveFlashedKey(null);
    }, 150);
  }, []);

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

  const handleCommitCalculation = useCallback(() => {
    if (result !== null && !isNaN(result)) {
      setHistory((prev) => [
        { expr: expression, res: result },
        ...prev.filter((h) => h.expr !== expression).slice(0, 4),
      ]);
      setExpression(result.toString());
      flashKey('=');
    }
  }, [expression, result, flashKey]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Calculatrice repliée : aucun raccourci. Un bouton ou un lien garde sa touche Entrée.
      if (!isOpen) return;
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'BUTTON' || activeEl.tagName === 'A')) return;
      const isAnotherInput =
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.tagName === 'SELECT') &&
        activeEl !== inputRef.current;

      if (isAnotherInput) return;

      const key = e.key;
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
  }, [isOpen, appendToken, handleBackspace, handleClear, handleCommitCalculation, flashKey]);

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
    if (val !== null && onInsertDev) onInsertDev(Math.round(val));
  };

  const handleSendToLength = () => {
    const val = getActiveNumericValue();
    if (val !== null && onInsertLength) onInsertLength(Math.round(val * 100) / 100);
  };

  const handleSendToQty = () => {
    const val = getActiveNumericValue();
    if (val !== null && onInsertQty) onInsertQty(Math.max(1, Math.round(val)));
  };

  const handleDirectAdd = () => {
    const val = getActiveNumericValue();
    if (val !== null && onDirectAddEntry) onDirectAddEntry(Math.round(val));
  };

  const getKeyStyle = (keyToken: string, baseColor: string) => {
    const isFlashed = activeFlashedKey === keyToken;
    return `${baseColor} ${
      isFlashed ? 'ring-2 ring-faco-blue scale-95' : ''
    } transition-all duration-75 active:scale-95 select-none cursor-pointer`;
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onClick={() => isOpen && inputRef.current?.focus()}
      className={`faco-card bg-white border rounded-xl p-4 shadow-2xs transition-all outline-none ${
        isFocused ? 'border-faco-sky ring-1 ring-faco-sky/30' : 'border-slate-200'
      }`}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen((o) => !o);
        }}
        aria-expanded={isOpen}
        className={`w-full flex items-center justify-between gap-3 cursor-pointer ${isOpen ? 'pb-3 border-b border-slate-100' : ''}`}
      >
        <span className="flex items-center gap-2">
          <CalcIcon className="w-4 h-4 text-faco-blue" />
          <span className="text-sm font-bold text-faco-text">Calculatrice de cotes</span>
          <span className="text-xs text-slate-400 font-normal hidden sm:inline">pour additionner des cotes (ex. 15+120+35)</span>
        </span>
        <span className="text-xs text-faco-blue font-semibold">{isOpen ? 'Replier' : 'Ouvrir'}</span>
      </button>

      <div className={`${isOpen ? 'grid' : 'hidden'} grid-cols-1 lg:grid-cols-12 gap-4 mt-3 items-start`}>
        {/* Left: Screen & Keypad */}
        <div className="lg:col-span-7 space-y-2.5">
          <div
            onClick={(e) => {
              e.stopPropagation();
              inputRef.current?.focus();
            }}
            className="bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 flex items-center justify-between gap-2 focus-within:border-faco-blue"
          >
            <input
              ref={inputRef}
              type="text"
              value={expression}
              onChange={(e) => setExpression(e.target.value)}
              onKeyDown={handleInputKeyDown}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              placeholder="Ex: 15+120+35+20"
              className="w-full bg-transparent text-base font-mono font-bold text-faco-text focus:outline-none placeholder:text-slate-400"
            />
            <div className="flex items-center gap-2 shrink-0">
              {result !== null && (
                <span className="text-base font-bold font-mono text-faco-blue bg-white px-2.5 py-0.5 rounded border border-slate-200 tabular-nums">
                  = {result}
                </span>
              )}
              {expression && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClear();
                  }}
                  className="p-1 text-slate-400 hover:text-rose-600 transition-colors rounded"
                  title="Effacer"
                >
                  <Delete className="w-4 h-4" />
                </button>
              )}
              {result !== null && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopyResult();
                  }}
                  className="p-1 text-slate-400 hover:text-faco-blue transition-colors"
                  title="Copier"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Keypad Grid */}
          <div className="grid grid-cols-5 gap-1.5 font-mono text-sm select-none">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleClear();
                flashKey('C');
              }}
              className={getKeyStyle(
                'C',
                'py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold rounded-lg border border-rose-200'
              )}
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
                'py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg border border-slate-200'
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
                'py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg border border-slate-200'
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
                'py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg border border-slate-200 flex items-center justify-center'
              )}
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
                'py-2 bg-faco-blue/10 hover:bg-faco-blue/15 text-faco-blue font-bold rounded-lg border border-faco-blue/20'
              )}
            >
              ÷
            </button>

            {['7', '8', '9'].map((n) => (
              <button
                key={n}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  appendToken(n);
                  flashKey(n);
                }}
                className={getKeyStyle(
                  n,
                  'py-2 bg-slate-50 hover:bg-slate-100 text-faco-text font-semibold rounded-lg border border-slate-200'
                )}
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                appendToken('*');
                flashKey('*');
              }}
              className={getKeyStyle(
                '*',
                'py-2 bg-faco-blue/10 hover:bg-faco-blue/15 text-faco-blue font-bold rounded-lg border border-faco-blue/20'
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
                'py-2 bg-faco-blue/10 hover:bg-faco-blue/15 text-faco-blue font-bold rounded-lg border border-faco-blue/20'
              )}
            >
              -
            </button>

            {['4', '5', '6'].map((n) => (
              <button
                key={n}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  appendToken(n);
                  flashKey(n);
                }}
                className={getKeyStyle(
                  n,
                  'py-2 bg-slate-50 hover:bg-slate-100 text-faco-text font-semibold rounded-lg border border-slate-200'
                )}
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                appendToken('+');
                flashKey('+');
              }}
              className={getKeyStyle(
                '+',
                'py-2 bg-faco-blue/10 hover:bg-faco-blue/15 text-faco-blue font-bold rounded-lg border border-faco-blue/20'
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
                'py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg border border-slate-200'
              )}
            >
              .
            </button>

            {['1', '2', '3', '0'].map((n) => (
              <button
                key={n}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  appendToken(n);
                  flashKey(n);
                }}
                className={getKeyStyle(
                  n,
                  'py-2 bg-slate-50 hover:bg-slate-100 text-faco-text font-semibold rounded-lg border border-slate-200'
                )}
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleCommitCalculation();
                flashKey('=');
              }}
              className={getKeyStyle(
                '=',
                'py-2 bg-faco-blue hover:bg-faco-blue-dark text-white font-bold rounded-lg shadow-2xs'
              )}
            >
              =
            </button>
          </div>
        </div>

        {/* Right: Direct Injection & History */}
        <div className="lg:col-span-5 space-y-2.5">
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-1.5">
              {onInsertDev && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSendToDev();
                  }}
                  disabled={getActiveNumericValue() === null}
                  className="w-full px-3 py-1.5 bg-white hover:bg-slate-50 disabled:opacity-40 text-faco-blue font-semibold rounded-md text-xs flex items-center justify-between border border-slate-200 transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-faco-sky" />
                    <span>Vers Dév (mm)</span>
                  </span>
                  <span className="font-mono font-bold text-faco-text">
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
                  className="w-full px-3 py-1.5 bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-700 font-semibold rounded-md text-xs flex items-center justify-between border border-slate-200 transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-1.5">
                    <Ruler className="w-3.5 h-3.5 text-faco-sky" />
                    <span>Vers Longueur (m)</span>
                  </span>
                  <span className="font-mono font-bold text-faco-text">
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
                  className="w-full px-3 py-1.5 bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-700 font-semibold rounded-md text-xs flex items-center justify-between border border-slate-200 transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-1.5">
                    <Hash className="w-3.5 h-3.5 text-faco-sky" />
                    <span>Vers Quantité</span>
                  </span>
                  <span className="font-mono font-bold text-faco-text">
                    {getActiveNumericValue() !== null
                      ? `${Math.max(1, Math.round(getActiveNumericValue()!))} pcs`
                      : '-'}
                  </span>
                </button>
              )}
            </div>

            {onDirectAddEntry && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDirectAdd();
                }}
                disabled={getActiveNumericValue() === null}
                className="w-full px-3 py-2 bg-faco-orange hover:bg-faco-orange-hover disabled:opacity-40 text-white font-semibold rounded-md text-xs flex items-center justify-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>
                  Ajouter directement{' '}
                  {getActiveNumericValue() !== null
                    ? `(${Math.round(getActiveNumericValue()!)} mm)`
                    : ''}
                </span>
              </button>
            )}
          </div>

          {history.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {history.map((h, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpression(h.res.toString());
                  }}
                  className="px-2 py-1 rounded bg-white hover:bg-slate-50 text-[11px] font-mono flex items-center gap-1.5 text-slate-600 border border-slate-200 transition-colors cursor-pointer"
                >
                  <span className="text-slate-400">{h.expr}</span>
                  <strong className="text-faco-blue">= {h.res}</strong>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
