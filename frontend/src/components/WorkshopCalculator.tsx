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
      const activeEl = document.activeElement;
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
  }, [appendToken, handleBackspace, handleClear, handleCommitCalculation, flashKey]);

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
      isFlashed ? 'ring-2 ring-[#00478a] scale-95' : ''
    } transition-all duration-75 active:scale-95 select-none cursor-pointer`;
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onClick={() => inputRef.current?.focus()}
      className={`faco-card bg-white border rounded-xl p-4 shadow-2xs transition-all outline-none ${
        isFocused ? 'border-[#3ca7da] ring-1 ring-[#3ca7da]/30' : 'border-slate-200'
      }`}
    >
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <CalcIcon className="w-4 h-4 text-[#00478a]" />
          <h3 className="text-xs font-bold text-[#00478a] uppercase tracking-wider">
            Calculatrice de Cotes
          </h3>
        </div>
        <span className="text-[11px] text-slate-400">
          Pavé numérique actif
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mt-3 items-start">
        {/* Left: Screen & Keypad */}
        <div className="lg:col-span-7 space-y-2.5">
          <div
            onClick={(e) => {
              e.stopPropagation();
              inputRef.current?.focus();
            }}
            className="bg-[#f8fafc] border border-slate-300 rounded-lg px-3 py-2 flex items-center justify-between gap-2 focus-within:border-[#00478a]"
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
              className="w-full bg-transparent text-base font-mono font-bold text-[#282828] focus:outline-none placeholder:text-slate-400"
            />
            <div className="flex items-center gap-2 shrink-0">
              {result !== null && (
                <span className="text-base font-bold font-mono text-[#00478a] bg-white px-2.5 py-0.5 rounded border border-slate-200 tabular-nums">
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
                  className="p-1 text-slate-400 hover:text-[#00478a] transition-colors"
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
                'py-2 bg-[#00478a]/10 hover:bg-[#00478a]/15 text-[#00478a] font-bold rounded-lg border border-[#00478a]/20'
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
                  'py-2 bg-[#f8fafc] hover:bg-slate-100 text-[#282828] font-semibold rounded-lg border border-slate-200'
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
                'py-2 bg-[#00478a]/10 hover:bg-[#00478a]/15 text-[#00478a] font-bold rounded-lg border border-[#00478a]/20'
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
                'py-2 bg-[#00478a]/10 hover:bg-[#00478a]/15 text-[#00478a] font-bold rounded-lg border border-[#00478a]/20'
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
                  'py-2 bg-[#f8fafc] hover:bg-slate-100 text-[#282828] font-semibold rounded-lg border border-slate-200'
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
                'py-2 bg-[#00478a]/10 hover:bg-[#00478a]/15 text-[#00478a] font-bold rounded-lg border border-[#00478a]/20'
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
                  'py-2 bg-[#f8fafc] hover:bg-slate-100 text-[#282828] font-semibold rounded-lg border border-slate-200'
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
                'py-2 bg-[#00478a] hover:bg-[#003566] text-white font-bold rounded-lg shadow-2xs'
              )}
            >
              =
            </button>
          </div>
        </div>

        {/* Right: Direct Injection & History */}
        <div className="lg:col-span-5 space-y-2.5">
          <div className="bg-[#f8fafc] border border-slate-200 rounded-lg p-3 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-1.5">
              {onInsertDev && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSendToDev();
                  }}
                  disabled={getActiveNumericValue() === null}
                  className="w-full px-3 py-1.5 bg-white hover:bg-slate-50 disabled:opacity-40 text-[#00478a] font-semibold rounded-md text-xs flex items-center justify-between border border-slate-200 transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-[#3ca7da]" />
                    <span>Vers Dév (mm)</span>
                  </span>
                  <span className="font-mono font-bold text-[#282828]">
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
                    <Ruler className="w-3.5 h-3.5 text-[#3ca7da]" />
                    <span>Vers Longueur (m)</span>
                  </span>
                  <span className="font-mono font-bold text-[#282828]">
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
                    <Hash className="w-3.5 h-3.5 text-[#3ca7da]" />
                    <span>Vers Quantité</span>
                  </span>
                  <span className="font-mono font-bold text-[#282828]">
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
                className="w-full px-3 py-2 bg-[#e7511f] hover:bg-[#cf4315] disabled:opacity-40 text-white font-semibold rounded-md text-xs flex items-center justify-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
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
                  <strong className="text-[#00478a]">= {h.res}</strong>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
