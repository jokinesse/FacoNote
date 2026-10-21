import React from 'react';
import { Printer, X, FileText } from 'lucide-react';
import { ShapedPiece, OptimizationResult, MaterialType } from '../types';
import { cleanWorkshopText } from '../utils/textCleaner';

export interface WorkshopJobData {
  code?: string;
  client: string;
  chantier: string;
  date?: string;
  material: MaterialType;
  finish: string;
  thickness: string;
  pieces: ShapedPiece[];
}

interface WorkshopPrintModalProps {
  job: WorkshopJobData | null;
  optimizationResult: OptimizationResult | null;
  onClose: () => void;
}

export const WorkshopPrintModal: React.FC<WorkshopPrintModalProps> = ({
  job,
  optimizationResult,
  onClose,
}) => {
  if (!job) return null;

  const handlePrint = () => {
    window.print();
  };

  const totalMeters = job.pieces.reduce(
    (acc, p) => acc + p.length * p.quantity,
    0
  );
  const totalSurfaceM2 = job.pieces.reduce(
    (acc, p) => acc + (p.dev / 1000) * p.length * p.quantity,
    0
  );

  const displayCode = job.code || `FZ-DEBIT-${new Date().getFullYear()}`;
  const displayDate = job.date || new Date().toISOString().split('T')[0];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/40 backdrop-blur-xs flex justify-center p-4 sm:p-6">
      {/* Modal Container */}
      <div className="relative w-full max-w-4xl bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden my-auto">
        {/* Modal Top Bar - Hidden during print */}
        <div className="no-print px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-[#00478a]" />
            <h3 className="text-sm font-bold text-[#282828]">
              Aperçu Fiche Atelier
            </h3>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={handlePrint}
              className="px-4 py-1.5 bg-[#e7511f] hover:bg-[#cf4315] text-white font-bold text-xs rounded-lg flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Imprimer (Format A4)</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200/60 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Printable Sheet Content */}
        <div className="p-8 bg-white text-slate-900 print:p-0 print:m-0 font-sans">
          {/* Printable Header */}
          <div className="border-b-2 border-[#00478a] pb-4 flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-[#00478a] text-white font-black text-2xl flex items-center justify-center rounded">
                FZ
              </div>
              <div>
                <h1 className="text-2xl font-black tracking-tight text-slate-900 uppercase">
                  FACOZINC
                </h1>
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  Atelier de Façonnage · Zinc &amp; Aluminium
                </p>
              </div>
            </div>

            <div className="text-right">
              <span className="text-xs uppercase font-bold text-slate-500">
                Fiche de Débit &amp; Façonnage
              </span>
              <div className="text-xl font-mono font-bold text-slate-900">
                {displayCode}
              </div>
              <span className="text-xs font-mono text-slate-600">
                Date : {displayDate}
              </span>
            </div>
          </div>

          {/* Client & Material Grid */}
          <div className="grid grid-cols-2 gap-4 my-5 p-4 bg-slate-50 rounded border border-slate-200 text-xs">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-500 block">
                Client / Chantier :
              </span>
              <strong className="text-sm text-slate-900">{job.client}</strong>
              <div className="text-slate-700 mt-1">
                Chantier : <strong>{job.chantier}</strong>
              </div>
            </div>

            <div>
              <span className="text-[10px] uppercase font-bold text-slate-500 block">
                Matière Première &amp; Épaisseur :
              </span>
              <div className="text-sm font-bold text-slate-900">
                {job.material} · {job.finish}
              </div>
              <div className="text-slate-700 mt-1 font-mono">
                Épaisseur : <strong>{job.thickness} mm</strong>
              </div>
            </div>
          </div>

          {/* Table: Pieces to Fold */}
          <div className="my-5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 mb-2">
              1. Nomenclature des Pièces à Façonner
            </h2>

            <table className="w-full text-left border-collapse text-xs border border-slate-300">
              <thead>
                <tr className="bg-slate-100 text-slate-800 uppercase text-[10px] font-bold border-b border-slate-300">
                  <th className="py-2 px-3 border-r border-slate-300">#</th>
                  <th className="py-2 px-3 border-r border-slate-300">Désignation</th>
                  <th className="py-2 px-3 border-r border-slate-300 text-right">Dév (mm)</th>
                  <th className="py-2 px-3 border-r border-slate-300 text-right">Longueur</th>
                  <th className="py-2 px-3 border-r border-slate-300 text-right">Nb Pièces</th>
                  <th className="py-2 px-3 border-r border-slate-300 text-right">Mètres</th>
                  <th className="py-2 px-3">Découpe Atelier</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-300 font-mono text-[11px]">
                {job.pieces.map((p, i) => (
                  <tr key={p.id}>
                    <td className="py-2 px-3 border-r border-slate-300 font-bold">
                      {i + 1}
                    </td>
                    <td className="py-2 px-3 border-r border-slate-300 font-sans font-medium text-slate-900">
                      {cleanWorkshopText(p.label)}
                    </td>
                    <td className="py-2 px-3 border-r border-slate-300 text-right font-bold text-slate-900">
                      {p.dev} mm
                    </td>
                    <td className="py-2 px-3 border-r border-slate-300 text-right">
                      {p.length} m
                    </td>
                    <td className="py-2 px-3 border-r border-slate-300 text-right font-bold">
                      {p.quantity}
                    </td>
                    <td className="py-2 px-3 border-r border-slate-300 text-right">
                      {(p.length * p.quantity).toFixed(2)} m
                    </td>
                    <td className="py-2 px-3 font-sans text-[10px] text-slate-600">
                      {cleanWorkshopText(p.workshopSplitReason) || 'Longueur unitaire'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-bold border-t border-slate-300 text-[11px]">
                  <td colSpan={4} className="py-2 px-3 uppercase text-[10px]">
                    Total Pièces Façonnées
                  </td>
                  <td className="py-2 px-3 text-right font-mono">
                    {job.pieces.reduce((acc, p) => acc + p.quantity, 0)}
                  </td>
                  <td className="py-2 px-3 text-right font-mono">
                    {totalMeters.toFixed(2)} m
                  </td>
                  <td className="py-2 px-3 font-mono text-[10px] text-slate-600">
                    Surface : {totalSurfaceM2.toFixed(2)} m²
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Section 2: Mother coil and scrap withdrawal slip */}
          {optimizationResult && (
            <div className="my-5 grid grid-cols-2 gap-4">
              <div className="border border-slate-300 rounded p-3 text-xs bg-slate-50">
                <h3 className="font-bold uppercase text-[11px] text-slate-800 mb-1.5">
                  2. Bon de Sortie Magasin (Matière Mère &amp; Chutes)
                </h3>
                <ul className="space-y-1 font-mono text-[11px] text-slate-800">
                  {optimizationResult.motherItemsNeeded.map((m, idx) => (
                    <li key={idx} className="flex justify-between border-b border-slate-200 pb-1">
                      <span>
                        Bobine mère {m.motherWidth} mm [{m.material || job.finish}] :
                      </span>
                      <strong>{m.motherLength} m</strong>
                    </li>
                  ))}
                  {optimizationResult.appliedWorkshopScraps && optimizationResult.appliedWorkshopScraps.length > 0 ? (
                    optimizationResult.appliedWorkshopScraps.map((u, idx) => (
                      <li key={idx} className="flex justify-between border-b border-slate-200 pb-1 text-amber-800">
                        <span>Chute atelier rack ({u.pieceLabel}) :</span>
                        <strong>Dév {u.scrapDev} mm × {u.pieceLength} m</strong>
                      </li>
                    ))
                  ) : optimizationResult.usedScrapsFromStock.map((u, idx) => (
                    <li key={idx} className="flex justify-between border-b border-slate-200 pb-1 text-slate-700">
                      <span>Chute rack :</span>
                      <strong>{u.scrap.refCode} ({u.scrap.dev}mm)</strong>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="border border-slate-300 rounded p-3 text-xs bg-slate-50">
                <h3 className="font-bold uppercase text-[11px] text-slate-800 mb-1.5">
                  3. Nouvelles Chutes Réutilisables Intégrées au Chutier
                </h3>
                {optimizationResult.newReusableScrapsCreated.length === 0 ? (
                  <p className="text-slate-500 text-[11px]">
                    Aucune nouvelle chute exploitable (&gt;100mm).
                  </p>
                ) : (
                  <ul className="space-y-1 font-mono text-[11px] text-slate-800">
                    {optimizationResult.newReusableScrapsCreated.map((s, idx) => (
                      <li key={idx} className="flex justify-between border-b border-slate-200 pb-1">
                        <span>{s.refCode} :</span>
                        <strong>
                          {s.dev} mm × {s.length} m ({s.weightKg} kg)
                        </strong>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* Signatures & Safety notice */}
          <div className="mt-8 pt-4 border-t-2 border-slate-300 grid grid-cols-3 gap-6 text-[11px]">
            <div>
              <span className="font-bold uppercase text-slate-500 block mb-1">
                Consignes d'Atelier
              </span>
              <p className="text-slate-600">
                Température atelier zinc &ge; 10°C. Sens de laminage respecté.
                Gants anti-coupure obligatoires.
              </p>
            </div>

            <div>
              <span className="font-bold uppercase text-slate-500 block mb-8">
                Opérateur Façonnage (Visa) :
              </span>
              <div className="border-b border-slate-400"></div>
            </div>

            <div>
              <span className="font-bold uppercase text-slate-500 block mb-8">
                Chef d'Atelier (Validation Débit) :
              </span>
              <div className="border-b border-slate-400"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
