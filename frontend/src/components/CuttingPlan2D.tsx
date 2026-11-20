import React, { useState } from 'react';
import {
  Scissors,
  AlertTriangle,
  Layers,
  Ruler,
  PackageCheck,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { SlitNestResult } from '../types';
import { CardTitle, MaterialDot } from './ui';

interface CuttingPlan2DProps {
  motherItems: {
    motherWidth: number;
    motherLength: number;
    material?: string;
    slits: SlitNestResult[];
  }[];
  selectedMaterial: string;
  onMovePieceToScrap?: (pieceId: string, count?: number) => void;
}

// Toutes les pièces ont la même couleur, toutes les chutes aussi, et toutes les tôles le même cadre.
// Seules changent : la pastille de la matière, et la couleur d'une reprise de chute, propre à la
// feuille d'origine (on suit d'un coup d'œil quelle chute repart de quelle feuille).
const PIECE = { bg: 'bg-faco-blue/10', border: 'border-faco-blue/40', text: 'text-faco-blue' };
const REPRISE_COLORS = ['#d97706', '#7c3aed', '#db2777', '#0891b2', '#65a30d', '#92400e', '#be123c', '#4338ca'];

export const CuttingPlan2D: React.FC<CuttingPlan2DProps> = ({
  motherItems,
  selectedMaterial,
  onMovePieceToScrap,
}) => {
  const [activeStripId, setActiveStripId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'detailed' | 'compact'>('detailed');
  const [expandedOps, setExpandedOps] = useState<Record<number, boolean>>({});

  const toggleOp = (idx: number) => {
    setExpandedOps((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  if (!motherItems || motherItems.length === 0) {
    return null;
  }

  // Chute reprise : largeurs des tôles d'où elle vient, de la feuille d'origine à elle-même
  // (ex. 1000 → 690 → 345). Lecture des liens du plan rendu par le backend, aucun calcul.
  const widthChain = (opIdx: number): number[] => {
    const chain: number[] = [];
    const seen = new Set<number>();
    let i: number | undefined = opIdx;
    while (i !== undefined && i >= 0 && i < motherItems.length && !seen.has(i)) {
      seen.add(i);
      chain.unshift(motherItems[i].motherWidth);
      const s: (typeof motherItems)[number]['slits'][number] | undefined = motherItems[i].slits[0];
      i = s?.sourceType === 'REUSED_OFFCUT' && s.sourceOpIndex ? s.sourceOpIndex - 1 : undefined;
    }
    return chain;
  };

  // Feuille d'origine d'une tôle (elle-même si ce n'est pas une reprise), lue dans les liens du backend
  const rootOf = (opIdx: number): number => {
    const seen = new Set<number>();
    let i = opIdx;
    while (!seen.has(i)) {
      seen.add(i);
      const s = motherItems[i]?.slits[0];
      if (s?.sourceType === 'REUSED_OFFCUT' && s.sourceOpIndex && s.sourceOpIndex - 1 < motherItems.length) {
        i = s.sourceOpIndex - 1;
      } else break;
    }
    return i;
  };
  // Une couleur par feuille d'origine dont la chute est reprise
  const repriseColor = new Map<number, string>();
  motherItems.forEach((_, i) => {
    const s = motherItems[i].slits[0];
    if (s?.sourceType !== 'REUSED_OFFCUT') return;
    const root = rootOf(i);
    if (!repriseColor.has(root)) repriseColor.set(root, REPRISE_COLORS[repriseColor.size % REPRISE_COLORS.length]);
  });

  return (
    <div className="faco-card bg-white border border-slate-200 rounded-xl p-4 shadow-2xs space-y-4">
      {/* Header épuré */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <CardTitle icon={Scissors} as="h3">
          Plan de coupe 2D ({motherItems.length} tôle{motherItems.length > 1 ? 's' : ''})
        </CardTitle>

        <div className="bg-slate-100 p-0.5 rounded-lg border border-slate-200 flex text-xs">
          <button
            type="button"
            onClick={() => setViewMode('detailed')}
            className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
              viewMode === 'detailed'
                ? 'bg-faco-blue text-white font-semibold'
                : 'text-slate-600 hover:text-faco-text'
            }`}
          >
            Détaillé
          </button>
          <button
            type="button"
            onClick={() => setViewMode('compact')}
            className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
              viewMode === 'compact'
                ? 'bg-faco-blue text-white font-semibold'
                : 'text-slate-600 hover:text-faco-text'
            }`}
          >
            Compact
          </button>
        </div>
      </div>

      {/* Opérations de refente */}
      <div className="space-y-4">
        {motherItems.map((mItem, opIdx) => {
          const slit = mItem.slits[0];
          if (!slit) return null;

          const isExpanded = expandedOps[opIdx] !== false;
          const motherWidth = mItem.motherWidth;
          const motherLength = mItem.motherLength;
          const yieldPercent = slit.yieldPercent ?? 0;
          const scrapWidth = slit.scrapWidth;
          const isReusedOffcut = slit.sourceType === 'REUSED_OFFCUT';
          const isParentReused = slit.suggestedScrapRef?.includes('Réemployée');
          const chainColor = isReusedOffcut || isParentReused ? repriseColor.get(rootOf(opIdx)) : undefined;

          let accumulatedX = 0;
          const cutPositions: {
            passNumber: number;
            instanceIdx: number;
            totalInstances: number;
            xStartMm: number;
            xMm: number;
            strip: typeof slit.strips[0];
            color: typeof PIECE;
          }[] = [];

          slit.strips.forEach((st) => {
            const color = PIECE;
            const count = Math.max(1, st.qty || 1);
            for (let q = 0; q < count; q++) {
              const xStartMm = accumulatedX;
              accumulatedX += st.dev;
              cutPositions.push({
                passNumber: cutPositions.length + 1,
                instanceIdx: q + 1,
                totalInstances: count,
                xStartMm,
                xMm: accumulatedX,
                strip: st,
                color,
              });
            }
          });

          return (
            <div
              key={opIdx}
              className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden transition-all"
            >
              {/* En-tête de la tôle */}
              <div
                className="px-3.5 py-2.5 border-b flex flex-col md:flex-row md:items-center justify-between gap-2.5 bg-slate-100/80 border-slate-200"
              >
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-faco-blue text-white">
                    #{opIdx + 1}
                  </span>

                  {isReusedOffcut && (
                    <span
                      className="text-xs font-semibold px-2 py-0.5 rounded text-white flex items-center gap-1"
                      style={{ backgroundColor: chainColor }}
                    >
                      <Layers className="w-3 h-3" />
                      <span>Reprise Chute #{slit.sourceOpIndex}</span>
                    </span>
                  )}

                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-700 inline-flex items-center gap-1.5">
                    <MaterialDot material={mItem.material || selectedMaterial} />
                    {mItem.material || selectedMaterial}
                  </span>

                  <strong className="text-xs font-mono text-faco-text bg-white px-2 py-0.5 rounded border border-slate-200">
                    {isReusedOffcut
                      ? `Chute ${widthChain(opIdx).join(' → ')} mm × ${slit.originalOffcutLength || motherLength} m`
                      : `${motherWidth} mm × ${motherLength} m`}
                  </strong>

                  <span className="text-xs text-slate-500 font-mono">
                    ({(slit.motherSurfaceM2 ?? 0).toFixed(2)} m²)
                  </span>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {!isReusedOffcut && onMovePieceToScrap && (() => {
                    const isolableStrip = slit.strips.find(
                      (s) => s.dev <= 250 && (cutPositions.length === 1 || yieldPercent < 85 || scrapWidth >= 150)
                    );
                    if (!isolableStrip) return null;
                    const sheetQty = Math.max(1, isolableStrip.qty || 1);
                    return (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onMovePieceToScrap(isolableStrip.pieceId, 1);
                          }}
                          className="px-2.5 py-1 bg-faco-orange hover:bg-faco-orange-hover text-white rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
                          title={`Retirer 1 seul exemplaire (${isolableStrip.dev} mm) de la bobine et le prendre en chute rack`}
                        >
                          <Scissors className="w-3 h-3" />
                          <span>1x en chute ({isolableStrip.dev} mm)</span>
                        </button>
                        {sheetQty > 1 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onMovePieceToScrap(isolableStrip.pieceId, sheetQty);
                            }}
                            className="px-2 py-1 bg-white hover:bg-slate-50 text-faco-blue border border-faco-blue/30 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-all cursor-pointer"
                            title={`Prendre uniquement les ${sheetQty} exemplaires présents sur cette feuille en chute rack`}
                          >
                            <span>Les {sheetQty}x de cette tôle</span>
                          </button>
                        )}
                      </div>
                    );
                  })()}

                  <div className="flex items-center gap-1.5 text-xs font-mono">
                    <span
                      className={`font-semibold px-2 py-0.5 rounded text-xs border ${
                        yieldPercent >= 90
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : yieldPercent >= 75
                          ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : 'bg-rose-50 text-rose-800 border-rose-200'
                      }`}
                    >
                      {yieldPercent}%
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => toggleOp(opIdx)}
                    className="p-1 rounded hover:bg-slate-200/70 text-slate-500 hover:text-faco-text transition-colors cursor-pointer"
                    title={isExpanded ? 'Réduire' : 'Développer'}
                  >
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className="p-3.5 space-y-3">
                  {/* Règle graduée discrète */}
                  <div className="relative w-full h-4 text-[10px] font-mono text-slate-400 select-none flex justify-between items-end">
                    <span>0 mm</span>
                    <span>{Math.round(motherWidth * 0.5)} mm</span>
                    <span className="font-semibold text-faco-blue">{motherWidth} mm</span>
                  </div>

                  {/* Bar 2D proportionnelle */}
                  <div
                    className="relative w-full rounded-lg overflow-hidden border border-slate-300 bg-white flex"
                    style={{ height: viewMode === 'detailed' ? '76px' : '46px' }}
                  >
                    {cutPositions.map((cut, sIdx) => {
                      const { strip, color, passNumber, xStartMm, xMm } = cut;
                      const widthPct = (strip.dev / motherWidth) * 100;
                      const isHovered = activeStripId === strip.pieceId;

                      return (
                        <div
                          key={`${strip.pieceId}-${sIdx}`}
                          style={{
                            width: `${widthPct}%`,
                            flexBasis: `${widthPct}%`,
                            flexGrow: strip.dev,
                            containerType: 'inline-size',
                          }}
                          onMouseEnter={() => setActiveStripId(strip.pieceId)}
                          onMouseLeave={() => setActiveStripId(null)}
                          title={`Passe #${passNumber} · ${strip.label} — Dév ${strip.dev} mm × ${strip.length} m (${xStartMm} → ${xMm} mm)`}
                          className={`@container relative h-full min-w-0 flex flex-col justify-center items-center px-1 transition-all border-r ${
                            color.border
                          } ${color.bg} ${
                            isHovered ? 'ring-2 ring-inset ring-faco-blue/50 z-10' : ''
                          }`}
                        >
                          <div className="text-center w-full truncate">
                            <span
                              className={`block font-mono font-bold text-[11px] @[72px]:text-xs ${color.text} truncate`}
                            >
                              {strip.dev} <span className="hidden @[56px]:inline">mm</span>
                            </span>

                            {viewMode === 'detailed' && (
                              <span className="hidden @[64px]:block text-[10px] text-slate-600 font-medium truncate">
                                {strip.label} ({strip.length}m)
                              </span>
                            )}
                          </div>

                          <span className="hidden @[80px]:block absolute top-1 left-1.5 text-[9px] font-mono text-slate-500">
                            {xMm}mm
                          </span>
                          <span className="hidden @[38px]:block absolute bottom-1 right-1.5 text-[9px] font-mono text-slate-400">
                            #{passNumber}
                          </span>
                          {!isReusedOffcut && onMovePieceToScrap && isHovered && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onMovePieceToScrap(strip.pieceId, 1);
                              }}
                              className="absolute top-1 right-1.5 z-20 px-1.5 py-0.5 rounded bg-faco-orange text-white font-sans font-semibold text-[9px] flex items-center gap-0.5 shadow-xs hover:bg-faco-orange-hover cursor-pointer"
                              title={`Prendre uniquement cette bande (1x ${strip.label} · ${strip.dev} mm) en chute rack`}
                            >
                              <Scissors className="w-2.5 h-2.5" />
                              <span>1x chute</span>
                            </button>
                          )}
                        </div>
                      );
                    })}

                    {/* Zone de chute résiduelle */}
                    {scrapWidth > 0 && (
                      <div
                        style={{
                          width: `${(scrapWidth / motherWidth) * 100}%`,
                          flexBasis: `${(scrapWidth / motherWidth) * 100}%`,
                          flexGrow: scrapWidth,
                          containerType: 'inline-size',
                          ...(isParentReused && chainColor
                            ? { backgroundColor: `${chainColor}1f`, color: chainColor, borderColor: `${chainColor}66` }
                            : {}),
                        }}
                        className={`@container h-full min-w-0 flex flex-col items-center justify-center px-1 text-center relative overflow-hidden ${
                          isParentReused
                            ? 'border-l'
                            : slit.isScrapReusable
                            ? 'bg-emerald-50/80 text-emerald-800 border-l border-emerald-200'
                            : 'bg-slate-100 text-slate-500 border-l border-slate-200'
                        }`}
                        title={
                          isParentReused
                            ? `Réemployée dans une tôle suivante : ${scrapWidth} mm`
                            : slit.isScrapReusable
                            ? `Chute réutilisable : ${scrapWidth} mm × ${motherLength} m`
                            : `Perte : ${scrapWidth} mm`
                        }
                      >
                        <span className="relative font-mono font-semibold text-[10px] @[56px]:text-xs truncate w-full">
                          {scrapWidth} <span className="hidden @[48px]:inline">mm</span>
                        </span>

                        <span className="hidden @[42px]:inline-block relative text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded mt-0.5 truncate max-w-full">
                          {isParentReused ? 'Réemployée' : slit.isScrapReusable ? 'Chute' : 'Perte'}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Séquence des passes */}
                  <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs pt-0.5">
                    <span className="text-[11px] font-sans font-semibold text-slate-500 flex items-center gap-1 mr-1">
                      <Ruler className="w-3.5 h-3.5 text-faco-blue" />
                      <span>Butées :</span>
                    </span>

                    {cutPositions.map((cut, cIdx) => (
                      <div
                        key={cIdx}
                        className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md border bg-white border-slate-200 text-faco-text`}
                      >
                        <span className="text-slate-400 text-[10px]">#{cIdx + 1}</span>
                        <strong className="text-faco-blue">{cut.strip.dev}mm</strong>
                        <span className="text-[10px] text-slate-500">({cut.xMm}mm)</span>
                        {!isReusedOffcut && onMovePieceToScrap && (
                          <button
                            type="button"
                            onClick={() => onMovePieceToScrap(cut.strip.pieceId, 1)}
                            className="ml-0.5 px-1.5 py-0.5 rounded bg-slate-100 hover:bg-faco-orange text-slate-600 hover:text-white text-[10px] font-sans font-semibold inline-flex items-center gap-0.5 transition-colors cursor-pointer"
                            title={`Retirer uniquement cette passe (1x ${cut.strip.label} · ${cut.strip.dev} mm) de la bobine et la prendre en chute rack`}
                          >
                            <Scissors className="w-2.5 h-2.5" />
                            <span>1x chute</span>
                          </button>
                        )}
                      </div>
                    ))}

                    {slit.isScrapReusable && (
                      <div className="flex items-center gap-1 px-2 py-0.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 text-[11px]">
                        <PackageCheck className="w-3 h-3 text-emerald-600" />
                        <span>Reste : <strong>{scrapWidth} mm</strong></span>
                      </div>
                    )}

                    {isParentReused && (
                      <div
                        className="flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px]"
                        style={chainColor ? { backgroundColor: `${chainColor}1f`, color: chainColor, borderColor: `${chainColor}66` } : undefined}
                      >
                        <PackageCheck className="w-3 h-3" />
                        <span>Réemployée : <strong>{scrapWidth} mm</strong></span>
                      </div>
                    )}

                    {!slit.isScrapReusable && !isParentReused && scrapWidth > 0 && (
                      <div className="flex items-center gap-1 px-2 py-0.5 rounded-md border border-slate-200 bg-slate-100 text-slate-500 text-[11px]">
                        <AlertTriangle className="w-3 h-3 text-slate-400" />
                        <span>Perte : {scrapWidth} mm</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
