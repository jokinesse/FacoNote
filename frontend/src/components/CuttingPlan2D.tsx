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

// Palette douce et faible contraste inspirée de Facozinc.be (bleus acier, ardoise, terre cuite)
const STRIP_COLORS = [
  { bg: 'bg-[#00478a]/10', border: 'border-[#00478a]/40', text: 'text-[#00478a]', tag: 'bg-[#00478a]/15 text-[#00478a]' },
  { bg: 'bg-[#3ca7da]/15', border: 'border-[#3ca7da]/50', text: 'text-[#003566]', tag: 'bg-[#3ca7da]/20 text-[#003566]' },
  { bg: 'bg-[#e7511f]/10', border: 'border-[#e7511f]/40', text: 'text-[#b83b11]', tag: 'bg-[#e7511f]/15 text-[#b83b11]' },
  { bg: 'bg-emerald-600/10', border: 'border-emerald-600/40', text: 'text-emerald-900', tag: 'bg-emerald-600/15 text-emerald-900' },
  { bg: 'bg-slate-500/12', border: 'border-slate-400', text: 'text-slate-800', tag: 'bg-slate-200 text-slate-800' },
  { bg: 'bg-indigo-600/10', border: 'border-indigo-500/40', text: 'text-indigo-900', tag: 'bg-indigo-600/15 text-indigo-900' },
  { bg: 'bg-amber-600/10', border: 'border-amber-500/40', text: 'text-amber-900', tag: 'bg-amber-600/15 text-amber-900' },
];

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

  const colorMap = new Map<string, typeof STRIP_COLORS[0]>();
  let colorIndex = 0;

  motherItems.forEach((mItem) => {
    const slit = mItem.slits[0];
    if (slit) {
      slit.strips.forEach((st) => {
        if (!colorMap.has(st.pieceId)) {
          colorMap.set(st.pieceId, STRIP_COLORS[colorIndex % STRIP_COLORS.length]);
          colorIndex++;
        }
      });
    }
  });

  return (
    <div className="faco-card bg-white border border-slate-200 rounded-xl p-4 shadow-2xs space-y-4">
      {/* Header épuré */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Scissors className="w-4 h-4 text-[#00478a]" />
          <h3 className="text-xs font-bold text-[#00478a] uppercase tracking-wider">
            Plan de Coupe 2D ({motherItems.length} tôle{motherItems.length > 1 ? 's' : ''})
          </h3>
        </div>

        <div className="bg-slate-100 p-0.5 rounded-lg border border-slate-200 flex text-xs">
          <button
            type="button"
            onClick={() => setViewMode('detailed')}
            className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
              viewMode === 'detailed'
                ? 'bg-[#00478a] text-white font-semibold'
                : 'text-slate-600 hover:text-[#282828]'
            }`}
          >
            Détaillé
          </button>
          <button
            type="button"
            onClick={() => setViewMode('compact')}
            className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
              viewMode === 'compact'
                ? 'bg-[#00478a] text-white font-semibold'
                : 'text-slate-600 hover:text-[#282828]'
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
          const yieldPercent = Math.round((slit.usedWidth / motherWidth) * 1000) / 10;
          const scrapWidth = slit.scrapWidth;
          const isReusedOffcut = slit.sourceType === 'REUSED_OFFCUT';
          const isParentReused = slit.suggestedScrapRef?.includes('Réemployée');

          let accumulatedX = 0;
          const cutPositions: {
            passNumber: number;
            instanceIdx: number;
            totalInstances: number;
            xStartMm: number;
            xMm: number;
            strip: typeof slit.strips[0];
            color: typeof STRIP_COLORS[0];
          }[] = [];

          slit.strips.forEach((st) => {
            const color = colorMap.get(st.pieceId) || STRIP_COLORS[0];
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
              className="bg-[#f8fafc] border border-slate-200 rounded-xl overflow-hidden transition-all"
            >
              {/* En-tête de la tôle */}
              <div
                className={`px-3.5 py-2.5 border-b flex flex-col md:flex-row md:items-center justify-between gap-2.5 ${
                  isReusedOffcut
                    ? 'bg-[#3ca7da]/10 border-[#3ca7da]/30'
                    : 'bg-slate-100/80 border-slate-200'
                }`}
              >
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span
                    className={`font-mono font-bold text-xs px-2 py-0.5 rounded ${
                      isReusedOffcut
                        ? 'bg-[#3ca7da] text-white'
                        : 'bg-[#00478a] text-white'
                    }`}
                  >
                    #{opIdx + 1}
                  </span>

                  {isReusedOffcut && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-white border border-[#3ca7da]/40 text-[#00478a] flex items-center gap-1">
                      <Layers className="w-3 h-3 text-[#3ca7da]" />
                      <span>Reprise Chute #{slit.sourceOpIndex}</span>
                    </span>
                  )}

                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-700">
                    {mItem.material || selectedMaterial}
                  </span>

                  <strong className="text-xs font-mono text-[#282828] bg-white px-2 py-0.5 rounded border border-slate-200">
                    {isReusedOffcut
                      ? `Chute ${motherWidth} mm × ${slit.originalOffcutLength || motherLength} m`
                      : `${motherWidth} mm × ${motherLength} m`}
                  </strong>

                  <span className="text-xs text-slate-500 font-mono">
                    ({((motherWidth / 1000) * motherLength).toFixed(2)} m²)
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
                          className="px-2.5 py-1 bg-[#e7511f] hover:bg-[#cf4315] text-white rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
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
                            className="px-2 py-1 bg-white hover:bg-slate-50 text-[#00478a] border border-[#00478a]/30 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-all cursor-pointer"
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
                    className="p-1 rounded hover:bg-slate-200/70 text-slate-500 hover:text-[#282828] transition-colors cursor-pointer"
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
                    <span className="font-semibold text-[#00478a]">{motherWidth} mm</span>
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
                            isHovered ? 'ring-2 ring-inset ring-[#00478a]/50 z-10' : ''
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
                              className="absolute top-1 right-1.5 z-20 px-1.5 py-0.5 rounded bg-[#e7511f] text-white font-sans font-semibold text-[9px] flex items-center gap-0.5 shadow-xs hover:bg-[#cf4315] cursor-pointer"
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
                        }}
                        className={`@container h-full min-w-0 flex flex-col items-center justify-center px-1 text-center relative overflow-hidden ${
                          slit.isScrapReusable
                            ? 'bg-emerald-50/80 text-emerald-800 border-l border-emerald-200'
                            : 'bg-slate-100 text-slate-500 border-l border-slate-200'
                        }`}
                        title={
                          slit.isScrapReusable
                            ? `Chute réutilisable : ${scrapWidth} mm × ${motherLength} m`
                            : `Perte : ${scrapWidth} mm`
                        }
                      >
                        <span className="relative font-mono font-semibold text-[10px] @[56px]:text-xs truncate w-full">
                          {scrapWidth} <span className="hidden @[48px]:inline">mm</span>
                        </span>

                        <span className="hidden @[42px]:inline-block relative text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded mt-0.5 truncate max-w-full">
                          {slit.isScrapReusable ? 'Chute' : 'Perte'}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Séquence des passes */}
                  <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs pt-0.5">
                    <span className="text-[11px] font-sans font-semibold text-slate-500 flex items-center gap-1 mr-1">
                      <Ruler className="w-3.5 h-3.5 text-[#00478a]" />
                      <span>Butées :</span>
                    </span>

                    {cutPositions.map((cut, cIdx) => (
                      <div
                        key={cIdx}
                        className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md border bg-white border-slate-200 text-[#282828]`}
                      >
                        <span className="text-slate-400 text-[10px]">#{cIdx + 1}</span>
                        <strong className="text-[#00478a]">{cut.strip.dev}mm</strong>
                        <span className="text-[10px] text-slate-500">({cut.xMm}mm)</span>
                        {!isReusedOffcut && onMovePieceToScrap && (
                          <button
                            type="button"
                            onClick={() => onMovePieceToScrap(cut.strip.pieceId, 1)}
                            className="ml-0.5 px-1.5 py-0.5 rounded bg-slate-100 hover:bg-[#e7511f] text-slate-600 hover:text-white text-[10px] font-sans font-semibold inline-flex items-center gap-0.5 transition-colors cursor-pointer"
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
                      <div className="flex items-center gap-1 px-2 py-0.5 rounded-md border border-[#3ca7da]/40 bg-[#3ca7da]/10 text-[#00478a] text-[11px]">
                        <PackageCheck className="w-3 h-3 text-[#3ca7da]" />
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
