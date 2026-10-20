import React, { useState } from 'react';
import {
  Scissors,
  Maximize2,
  Minimize2,
  CheckCircle,
  AlertTriangle,
  Layers,
  Ruler,
  Info,
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
}

// Palette de couleurs industrielles à fort contraste pour différencier les repères de refente
const STRIP_COLORS = [
  { bg: 'bg-sky-500/20', border: 'border-sky-400', text: 'text-sky-200', tag: 'bg-sky-500/30 text-sky-200' },
  { bg: 'bg-amber-500/20', border: 'border-amber-400', text: 'text-amber-200', tag: 'bg-amber-500/30 text-amber-200' },
  { bg: 'bg-emerald-500/20', border: 'border-emerald-400', text: 'text-emerald-200', tag: 'bg-emerald-500/30 text-emerald-200' },
  { bg: 'bg-purple-500/20', border: 'border-purple-400', text: 'text-purple-200', tag: 'bg-purple-500/30 text-purple-200' },
  { bg: 'bg-cyan-500/20', border: 'border-cyan-400', text: 'text-cyan-200', tag: 'bg-cyan-500/30 text-cyan-200' },
  { bg: 'bg-rose-500/20', border: 'border-rose-400', text: 'text-rose-200', tag: 'bg-rose-500/30 text-rose-200' },
  { bg: 'bg-indigo-500/20', border: 'border-indigo-400', text: 'text-indigo-200', tag: 'bg-indigo-500/30 text-indigo-200' },
];

export const CuttingPlan2D: React.FC<CuttingPlan2DProps> = ({
  motherItems,
  selectedMaterial,
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

  // Association stable couleur <-> repère de pièce
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
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-5">
      {/* Header du composant de calepinage 2D */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-amber-400/10 text-amber-400 border border-amber-400/20">
              <Scissors className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Plan de Refente & Calepinage 2D d'Atelier ({motherItems.length} opération{motherItems.length > 1 ? 's' : ''})
            </h3>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Visualisation géométrique haute résolution : refente longitudinale sur tôles mères et valorisation des chutes
          </p>
        </div>

        {/* Contrôles de visualisation */}
        <div className="flex items-center gap-2 self-end sm:self-auto">
          <div className="bg-slate-950 p-0.5 rounded-lg border border-slate-800 flex text-xs">
            <button
              type="button"
              onClick={() => setViewMode('detailed')}
              className={`px-3 py-1 rounded font-medium transition-colors cursor-pointer ${
                viewMode === 'detailed'
                  ? 'bg-amber-400 text-slate-950 font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Vue Cotée
            </button>
            <button
              type="button"
              onClick={() => setViewMode('compact')}
              className={`px-3 py-1 rounded font-medium transition-colors cursor-pointer ${
                viewMode === 'compact'
                  ? 'bg-amber-400 text-slate-950 font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Vue Synthétique
            </button>
          </div>
        </div>
      </div>

      {/* Liste des opérations de refente (1 par tôle mère d'atelier) */}
      <div className="space-y-6">
        {motherItems.map((mItem, opIdx) => {
          const slit = mItem.slits[0];
          if (!slit) return null;

          const isExpanded = expandedOps[opIdx] !== false; // ouvert par défaut
          const motherWidth = mItem.motherWidth;
          const motherLength = mItem.motherLength;
          const yieldPercent = Math.round((slit.usedWidth / motherWidth) * 1000) / 10;
          const scrapWidth = slit.scrapWidth;

          // Calcul des cotes cumulées de refente pour les opérateurs massicot
          // Chaque strip est déplié selon sa quantité (st.qty) pour représenter chaque bande physique sur la tôle mère
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
              className="bg-slate-950/90 border border-slate-800 rounded-xl overflow-hidden transition-all shadow-md hover:border-slate-700"
            >
              {/* En-tête de la tôle mère */}
              <div className="p-4 bg-slate-900/60 border-b border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-mono font-bold text-xs px-2.5 py-1 rounded bg-amber-400 text-slate-950">
                    OP #{opIdx + 1}
                  </span>

                  <span className="text-xs font-bold font-mono px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-amber-300">
                    {mItem.material || selectedMaterial}
                  </span>

                  <div className="flex items-center gap-2 text-xs font-mono text-slate-200">
                    <span className="text-slate-400">Tôle mère :</span>
                    <strong className="text-white bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                      Laize {motherWidth} mm × {motherLength} m
                    </strong>
                  </div>

                  <span className="text-slate-600 hidden sm:inline">·</span>

                  <div className="text-xs text-slate-400">
                    Surface : <span className="text-slate-200 font-mono font-semibold">{((motherWidth / 1000) * motherLength).toFixed(2)} m²</span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {/* Jauge de rendement matière de cette opération */}
                  <div className="flex items-center gap-2 text-xs font-mono">
                    <span className="text-slate-400 text-[11px]">Rendement :</span>
                    <span
                      className={`font-bold px-2 py-0.5 rounded text-xs ${
                        yieldPercent >= 90
                          ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/60'
                          : yieldPercent >= 75
                          ? 'bg-amber-950/80 text-amber-400 border border-amber-800/60'
                          : 'bg-rose-950/80 text-rose-400 border border-rose-800/60'
                      }`}
                    >
                      {yieldPercent}%
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => toggleOp(opIdx)}
                    className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
                    title={isExpanded ? 'Réduire' : 'Développer'}
                  >
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className="p-4 space-y-4">
                  {/* Règle graduée d'atelier supérieure (millimètres) */}
                  <div className="relative w-full h-5 text-[9px] font-mono text-slate-500 select-none flex justify-between items-end border-b border-slate-800/80 pb-0.5">
                    <span>0 mm</span>
                    <span>{Math.round(motherWidth * 0.25)} mm</span>
                    <span>{Math.round(motherWidth * 0.5)} mm</span>
                    <span>{Math.round(motherWidth * 0.75)} mm</span>
                    <span className="font-bold text-amber-400">{motherWidth} mm (Bord franc)</span>
                  </div>

                  {/* PLAN DE COUPE 2D GÉOMÉTRIQUE PROPORTIONNEL */}
                  <div
                    className="relative w-full rounded-lg overflow-hidden border-2 border-slate-700 bg-slate-900 shadow-inner flex"
                    style={{ height: viewMode === 'detailed' ? '92px' : '52px' }}
                  >
                    {/* Bandes de refente usinées (dépliées selon chaque passe physique) */}
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
                          title={`Passe #${passNumber} · ${strip.label} — Dév ${strip.dev} mm × ${strip.length} m (Repère : ${xStartMm} → ${xMm} mm)`}
                          className={`@container relative h-full min-w-0 flex flex-col justify-center items-center px-1 transition-all border-r-2 ${
                            color.border
                          } ${color.bg} ${
                            isHovered ? 'brightness-125 ring-2 ring-inset ring-white/60 z-10' : ''
                          }`}
                        >
                          {/* Trait de refente massicot */}
                          <div className="absolute right-0 top-0 bottom-0 w-0.5 bg-amber-400/80 shadow-[0_0_8px_rgba(251,191,36,0.6)]" />

                          {/* Dimensions & Libellé adaptés à la largeur disponible de la bande (@container) */}
                          <div className="text-center w-full truncate">
                            <span
                              className={`block font-mono font-black text-[11px] @[72px]:text-sm tracking-tight ${color.text} drop-shadow-sm truncate`}
                            >
                              {strip.dev} <span className="hidden @[56px]:inline">mm</span>
                            </span>

                            {viewMode === 'detailed' && (
                              <>
                                <span className="hidden @[64px]:block text-[11px] text-white font-medium truncate mt-0.5">
                                  {strip.label}
                                </span>
                                <span className="hidden @[52px]:block text-[10px] text-slate-300 font-mono opacity-90 truncate">
                                  L = {strip.length} m
                                </span>
                              </>
                            )}
                          </div>

                          {/* Repère cumulé en haut à gauche et numéro de passe en bas à droite */}
                          <span className="hidden @[80px]:block absolute top-1 left-1.5 text-[9px] font-mono text-amber-300/80">
                            {xMm}mm
                          </span>
                          <span className="hidden @[38px]:block absolute bottom-1 right-1.5 text-[9px] font-mono text-slate-300/80">
                            #{passNumber}
                          </span>
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
                            ? 'bg-emerald-950/60 text-emerald-300 border-l border-emerald-500/50'
                            : 'bg-rose-950/60 text-rose-300 border-l border-rose-500/50'
                        }`}
                        title={
                          slit.isScrapReusable
                            ? `Chute d'atelier valorisable : ${scrapWidth} mm × ${motherLength} m`
                            : `Chute non valorisable (rebut atelier) : ${scrapWidth} mm`
                        }
                      >
                        {/* Motif de hachures pour identifier visuellement les chutes */}
                        <div
                          className="absolute inset-0 opacity-15 pointer-events-none"
                          style={{
                            backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 10px, currentColor 10px, currentColor 20px)`,
                          }}
                        />

                        <span className="relative font-mono font-bold text-[10px] @[56px]:text-xs truncate w-full">
                          {scrapWidth} <span className="hidden @[48px]:inline">mm</span>
                        </span>

                        <span
                          className={`hidden @[42px]:inline-block relative text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded mt-1 truncate max-w-full ${
                            slit.isScrapReusable
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                          }`}
                        >
                          {slit.isScrapReusable ? 'Chute Rack' : 'Perte'}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Séquence de coupe pour l'opérateur de la cisaille/massicot */}
                  <div className="bg-slate-900/90 rounded-lg p-3 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-300 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                        <Ruler className="w-3.5 h-3.5 text-amber-400" />
                        <span>Séquence de réglage des butées de refente (mm) :</span>
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">
                        Cumul de refente : {slit.usedWidth} / {motherWidth} mm
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                      {cutPositions.map((cut, cIdx) => (
                        <div
                          key={cIdx}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border ${cut.color.border} ${cut.color.bg}`}
                        >
                          <span className="text-slate-400 text-[10px]">Passe {cIdx + 1} :</span>
                          <strong className="text-white">{cut.strip.dev} mm</strong>
                          <span className="text-[10px] text-slate-400">({cut.strip.label})</span>
                          <span className="text-amber-400 font-bold text-[10px] ml-1">
                            [Repère : {cut.xMm} mm]
                          </span>
                        </div>
                      ))}

                      {slit.isScrapReusable && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-emerald-500/40 bg-emerald-950/40 text-emerald-300">
                          <PackageCheck className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-[10px] font-bold">Reste à stocker :</span>
                          <strong>{scrapWidth} mm</strong>
                          <span className="text-[10px] text-emerald-400">
                            ({slit.suggestedScrapRef || `CHUTE-${scrapWidth}mm`})
                          </span>
                        </div>
                      )}

                      {!slit.isScrapReusable && scrapWidth > 0 && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-rose-500/40 bg-rose-950/40 text-rose-300">
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                          <span className="text-[10px]">Rebut :</span>
                          <strong>{scrapWidth} mm</strong>
                        </div>
                      )}
                    </div>
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
