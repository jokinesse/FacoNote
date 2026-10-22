import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Gauge,
  Play,
  Square,
  Download,
  Trash2,
  Server,
  Zap,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Timer,
  Users,
  Wrench,
  Info,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import {
  SCENARIOS,
  ScenarioId,
  LoadMode,
  StressConfig,
  Sample,
  LiveState,
  StatsSnapshot,
  Verdict,
  runStressTest,
  computeStats,
  computeVerdict,
} from '../utils/stressEngine';

// ---------------------------------------------------------------------------
// Constantes & helpers
// ---------------------------------------------------------------------------

const HISTORY_KEY = 'faconote.stresslab.history';

/**
 * Calcule dynamiquement l'URL directe du backend FastAPI sur le port 8000
 * en se basant sur le nom d'hôte ou l'adresse IP actuelle de la page distante.
 */
function getDirectBackendUrl(): string {
  if (typeof window !== 'undefined' && window.location) {
    const { protocol, hostname } = window.location;
    const port = protocol === 'https:' ? '8443' : '8000';
    return `${protocol}//${hostname}:${port}`;
  }
  return 'http://127.0.0.1:8000';
}

interface RunSummary {
  id: string;
  date: string;
  scenario: ScenarioId;
  mode: LoadMode;
  concurrency: number;
  count: number;
  durationSec: number;
  rps: number;
  p50: number;
  p95: number;
  p99: number;
  errorRate: number;
  verdict: Verdict;
}

interface HealthPoint {
  latency: number;
  ok: boolean;
}

const PRESETS: { label: string; hint: string; config: Partial<StressConfig> }[] = [
  {
    label: 'Fumée',
    hint: '50 requêtes, 2 utilisateurs : vérifie que tout répond.',
    config: { scenario: 'mixed', mode: 'count', totalRequests: 50, concurrency: 2, thinkTimeMs: 0 },
  },
  {
    label: 'Charge atelier',
    hint: '500 requêtes mixtes, 10 postes simultanés.',
    config: { scenario: 'mixed', mode: 'count', totalRequests: 500, concurrency: 10, thinkTimeMs: 0 },
  },
  {
    label: 'Pic 1000 req.',
    hint: '1000 encodages envoyés le plus vite possible par 50 utilisateurs.',
    config: { scenario: 'quick-encode', mode: 'count', totalRequests: 1000, concurrency: 50, thinkTimeMs: 0 },
  },
  {
    label: 'Calcul lourd',
    hint: '100 refentes de 60 pièces multi-matières : stress CPU.',
    config: { scenario: 'calculate-heavy', mode: 'count', totalRequests: 100, concurrency: 10, heavyPieces: 60 },
  },
  {
    label: 'Rampe 30 s',
    hint: 'Monte progressivement de 1 à 40 utilisateurs pour trouver le point de rupture.',
    config: { scenario: 'mixed', mode: 'ramp', durationSec: 30, concurrency: 40, thinkTimeMs: 0 },
  },
  {
    label: 'Endurance 60 s',
    hint: '8 utilisateurs pendant 60 s avec 200 ms de réflexion : détecte les fuites/dérives.',
    config: { scenario: 'mixed', mode: 'duration', durationSec: 60, concurrency: 8, thinkTimeMs: 200 },
  },
  {
    label: 'Robustesse 422',
    hint: '300 saisies invalides : le serveur doit rejeter proprement sans planter.',
    config: { scenario: 'invalid-422', mode: 'count', totalRequests: 300, concurrency: 10 },
  },
];

const DEFAULT_CONFIG: StressConfig = {
  scenario: 'mixed',
  mode: 'count',
  totalRequests: 200,
  durationSec: 20,
  concurrency: 6,
  timeoutMs: 10000,
  thinkTimeMs: 0,
  heavyPieces: 40,
  baseUrl: '',
};

const fmtMs = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v.toFixed(v < 10 ? 1 : 0)} ms`);
const fmtBytes = (b: number) =>
  b > 1_048_576 ? `${(b / 1_048_576).toFixed(1)} Mo` : b > 1024 ? `${(b / 1024).toFixed(0)} Ko` : `${b} o`;

const VERDICT_META: Record<Verdict, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  stable: { label: 'STABLE', cls: 'text-emerald-800 bg-emerald-50 border-emerald-200', Icon: CheckCircle2 },
  degraded: { label: 'DÉGRADÉ', cls: 'text-amber-800 bg-amber-50 border-amber-200', Icon: AlertTriangle },
  unstable: { label: 'INSTABLE', cls: 'text-rose-800 bg-rose-50 border-rose-200', Icon: XCircle },
};

const latencyColor = (ms: number) =>
  ms < 100 ? 'text-emerald-600' : ms < 500 ? 'text-amber-600' : 'text-rose-600';

// ---------------------------------------------------------------------------
// Graphiques SVG natifs (aucune dépendance)
// ---------------------------------------------------------------------------

const TimelineChart: React.FC<{ stats: StatsSnapshot }> = ({ stats }) => {
  const W = 760;
  const H = 220;
  const PAD = { l: 44, r: 52, t: 14, b: 26 };
  const data = stats.timeline;
  if (data.length === 0) {
    return <p className="text-xs text-slate-400 py-10 text-center">Le graphique apparaîtra dès les premières réponses.</p>;
  }
  const maxRps = Math.max(1, ...data.map((d) => d.ok + d.errors));
  const maxLat = Math.max(10, ...data.map((d) => d.p95));
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const bw = iw / data.length;
  const x = (i: number) => PAD.l + i * bw;
  const yR = (v: number) => PAD.t + ih - (v / maxRps) * ih;
  const yL = (v: number) => PAD.t + ih - (v / maxLat) * ih;
  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i) + bw / 2},${yL(d.p95)}`).join(' ');
  const tickEvery = Math.max(1, Math.ceil(data.length / 10));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto"
      role="img"
      aria-label={`Débit par seconde (max ${maxRps} req/s) et latence p95 (max ${fmtMs(maxLat)}) sur ${data.length} secondes`}
    >
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + ih * (1 - f)} y2={PAD.t + ih * (1 - f)} stroke="#e2e8f0" />
          <text x={PAD.l - 6} y={PAD.t + ih * (1 - f) + 3} textAnchor="end" fontSize="9" fill="#64748b">
            {Math.round(maxRps * f)}
          </text>
          <text x={W - PAD.r + 6} y={PAD.t + ih * (1 - f) + 3} fontSize="9" fill="#d97706">
            {fmtMs(maxLat * f)}
          </text>
        </g>
      ))}
      {data.map((d, i) => {
        const gap = Math.min(2, bw * 0.15);
        return (
          <g key={d.second}>
            <rect x={x(i) + gap} width={Math.max(1, bw - gap * 2)} y={yR(d.ok)} height={ih - (yR(d.ok) - PAD.t)} fill="#10b981" opacity="0.85" rx="1" />
            {d.errors > 0 && (
              <rect
                x={x(i) + gap}
                width={Math.max(1, bw - gap * 2)}
                y={yR(d.ok + d.errors)}
                height={yR(d.ok) - yR(d.ok + d.errors)}
                fill="#ef4444"
                rx="1"
              />
            )}
            {i % tickEvery === 0 && (
              <text x={x(i) + bw / 2} y={H - 8} textAnchor="middle" fontSize="9" fill="#64748b">
                {d.second}s
              </text>
            )}
          </g>
        );
      })}
      <path d={line} fill="none" stroke="#d97706" strokeWidth="2" strokeLinejoin="round" />
      <text x={PAD.l} y={10} fontSize="9" fill="#64748b" fontWeight="600">req/s</text>
      <text x={W - PAD.r + 6} y={10} fontSize="9" fill="#d97706" fontWeight="600">p95</text>
    </svg>
  );
};

const Histogram: React.FC<{ stats: StatsSnapshot }> = ({ stats }) => {
  const max = Math.max(1, ...stats.histogram.map((h) => h.count));
  return (
    <ul className="space-y-1.5" aria-label="Distribution des latences">
      {stats.histogram.map((h) => (
        <li key={h.label} className="grid grid-cols-[64px_1fr_48px] items-center gap-2 text-[11px] font-mono">
          <span className="text-slate-500 text-right">{h.label}</span>
          <span className="h-3.5 bg-slate-100 border border-slate-200 rounded overflow-hidden">
            <span
              className={`block h-full rounded ${h.max <= 100 ? 'bg-emerald-500' : h.max <= 500 ? 'bg-amber-500' : 'bg-rose-500'}`}
              style={{ width: `${(h.count / max) * 100}%` }}
            />
          </span>
          <span className="text-slate-700 font-semibold tabular-nums">{h.count}</span>
        </li>
      ))}
    </ul>
  );
};

const Sparkline: React.FC<{ points: HealthPoint[] }> = ({ points }) => {
  const W = 220;
  const H = 40;
  if (points.length < 2) return <div className="h-10" />;
  const max = Math.max(20, ...points.map((p) => p.latency));
  const step = W / 59;
  const offset = W - (points.length - 1) * step;
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${offset + i * step},${H - (p.latency / max) * (H - 4) - 2}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-10" aria-hidden="true">
      <path d={d} fill="none" stroke="#00478a" strokeWidth="1.5" />
      {points.map((p, i) =>
        !p.ok ? <circle key={i} cx={offset + i * step} cy={H - 4} r="2.5" fill="#ef4444" /> : null
      )}
    </svg>
  );
};

// ---------------------------------------------------------------------------
// Composant principal
// ---------------------------------------------------------------------------

interface StressLabProps {
  adminToken: string;
  expiresInSec: number;
  onLock: () => void;
}

export const StressLab: React.FC<StressLabProps> = ({ adminToken, expiresInSec, onLock }) => {
  const [config, setConfig] = useState<StressConfig>(DEFAULT_CONFIG);
  // Par défaut 'proxy' (Même origine /api) : fonctionne automatiquement sur serveur distant,
  // derrière un reverse-proxy, sur IP ou en HTTPS sans blocage CORS ni Private Network Access.
  const [targetMode, setTargetMode] = useState<'proxy' | 'direct' | 'custom'>('proxy');
  const [customUrl, setCustomUrl] = useState<string>(() => getDirectBackendUrl());
  const [isRunning, setIsRunning] = useState(false);
  const [stats, setStats] = useState<StatsSnapshot | null>(null);
  const [live, setLive] = useState<LiveState>({ inFlight: 0, issued: 0, activeWorkers: 0, startedAt: 0 });
  const [lastVerdict, setLastVerdict] = useState<Verdict | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [history, setHistory] = useState<RunSummary[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') as RunSummary[];
    } catch {
      return [];
    }
  });

  // Moniteur de santé
  const [healthOn, setHealthOn] = useState(true);
  const [health, setHealth] = useState<HealthPoint[]>([]);

  const samplesRef = useRef<Sample[]>([]);
  const liveRef = useRef<LiveState>({ inFlight: 0, issued: 0, activeWorkers: 0, startedAt: 0 });
  const abortRef = useRef<AbortController | null>(null);

  const directUrl = useMemo(() => getDirectBackendUrl(), []);
  const baseUrl = targetMode === 'proxy' ? '' : targetMode === 'direct' ? directUrl : customUrl.trim();

  const update = <K extends keyof StressConfig>(key: K, value: StressConfig[K]) =>
    setConfig((c) => ({ ...c, [key]: value }));

  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 50)));
  }, [history]);

  // Ping santé toutes les secondes (indépendant du test : montre la réactivité sous charge)
  useEffect(() => {
    if (!healthOn) return;
    let cancelled = false;
    const ping = async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const t0 = performance.now();
      let ok = false;
      try {
        const res = await fetch(`${baseUrl}/api/health`, { cache: 'no-store', signal: ctrl.signal });
        ok = res.ok;
      } catch {
        ok = false;
      } finally {
        clearTimeout(timer);
      }
      if (!cancelled) {
        const latency = performance.now() - t0;
        setHealth((h) => [...h.slice(-59), { latency, ok }]);
      }
    };
    ping();
    const id = setInterval(ping, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [healthOn, baseUrl]);

  const lastHealth = health[health.length - 1];
  const healthStatus: 'up' | 'slow' | 'down' | 'unknown' = !lastHealth
    ? 'unknown'
    : !lastHealth.ok
    ? 'down'
    : lastHealth.latency > 500
    ? 'slow'
    : 'up';
  const healthUptime = health.length ? (health.filter((p) => p.ok).length / health.length) * 100 : 0;

  // Rafraîchissement de l'UI pendant le test (≈ 3 fois / s, évite un rendu par requête)
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => {
      const elapsed = performance.now() - liveRef.current.startedAt;
      setStats(computeStats(samplesRef.current, elapsed));
      setLive({ ...liveRef.current });
    }, 300);
    return () => clearInterval(id);
  }, [isRunning]);

  const handleStart = useCallback(async () => {
    if (isRunning) return;
    const runConfig: StressConfig = { ...config, baseUrl, adminToken };
    samplesRef.current = [];
    abortRef.current = new AbortController();
    setStats(null);
    setLastVerdict(null);
    setIsRunning(true);
    setAnnouncement('');

    try {
      await runStressTest(runConfig, samplesRef.current, liveRef.current, abortRef.current.signal);
    } finally {
      const elapsed = performance.now() - liveRef.current.startedAt;
      const final = computeStats(samplesRef.current, elapsed);
      const verdict = computeVerdict(final);
      setStats(final);
      setLive({ ...liveRef.current });
      setLastVerdict(verdict);
      setIsRunning(false);

      const summary: RunSummary = {
        id: `run-${Date.now()}`,
        date: new Date().toLocaleString('fr-FR'),
        scenario: runConfig.scenario,
        mode: runConfig.mode,
        concurrency: runConfig.concurrency,
        count: final.count,
        durationSec: final.elapsedSec,
        rps: final.rps,
        p50: final.p50,
        p95: final.p95,
        p99: final.p99,
        errorRate: final.errorRate,
        verdict,
      };
      setHistory((h) => [summary, ...h]);
      setAnnouncement(
        `Test terminé : ${final.count} requêtes, ${final.rps.toFixed(0)} requêtes par seconde, ` +
          `p95 ${fmtMs(final.p95)}, ${final.errorRate.toFixed(1)} % d'erreurs. Verdict : ${VERDICT_META[verdict].label}.`
      );
    }
  }, [config, baseUrl, adminToken, isRunning]);

  const handleStop = () => abortRef.current?.abort();

  const handleExport = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      config: { ...config, baseUrl: baseUrl || '(proxy Vite)' },
      stats,
      history,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `faconote-stress-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const progress = useMemo(() => {
    if (!isRunning && !stats) return 0;
    if (config.mode === 'count') return Math.min(100, ((stats?.count || 0) / config.totalRequests) * 100);
    const elapsed = stats?.elapsedSec || 0;
    return Math.min(100, (elapsed / config.durationSec) * 100);
  }, [isRunning, stats, config]);

  const scenario = SCENARIOS[config.scenario];
  const browserCapWarning = config.concurrency > 6;

  return (
    <div className="space-y-5">
      {/* Région live unique, polie : n'annonce que la fin des tests (pas chaque tick) */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      {/* EN-TÊTE + MONITEUR DE SANTÉ */}
      <section className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-[#00478a]/10 border border-[#00478a]/20 text-[#00478a]">
                <Wrench className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-[#282828] tracking-tight">Stress Lab — Boîte à outils de charge</h2>
                <p className="text-xs text-slate-500">
                  Envoie de vraies requêtes au backend FastAPI et mesure débit, latences (p50/p95/p99) et stabilité.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-mono flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                Admin actif ({Math.floor(expiresInSec / 60)}:{String(expiresInSec % 60).padStart(2, '0')})
              </span>
              <button
                type="button"
                onClick={onLock}
                className="px-3 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs"
                title="Révoquer immédiatement le jeton Admin et masquer le Stress Lab"
              >
                <Lock className="w-3.5 h-3.5" />
                Verrouiller
              </button>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Préréglages de test">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                disabled={isRunning}
                title={p.hint}
                onClick={() => setConfig((c) => ({ ...c, ...p.config }))}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#f8fafc] border border-slate-200 text-slate-700 hover:bg-slate-100 hover:border-slate-300 hover:text-[#00478a] disabled:opacity-40 transition-colors cursor-pointer shadow-2xs"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5 text-[#00478a]" /> Moniteur de santé
            </h3>
            <label className="flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer">
              <input type="checkbox" checked={healthOn} onChange={(e) => setHealthOn(e.target.checked)} className="accent-[#00478a]" />
              Ping 1 s
            </label>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                healthStatus === 'up' ? 'bg-emerald-500' : healthStatus === 'slow' ? 'bg-amber-500' : healthStatus === 'down' ? 'bg-rose-500 animate-pulse' : 'bg-slate-400'
              }`}
            />
            <span className="text-sm font-bold text-[#282828]">
              {healthStatus === 'up' ? 'En ligne' : healthStatus === 'slow' ? 'Lent' : healthStatus === 'down' ? 'Hors ligne' : '—'}
            </span>
            {lastHealth && (
              <span className={`ml-auto text-xs font-mono ${latencyColor(lastHealth.latency)}`}>{fmtMs(lastHealth.latency)}</span>
            )}
          </div>
          <Sparkline points={health} />
          <p className="text-[10px] text-slate-400 font-mono">
            Disponibilité (60 s) : {healthUptime.toFixed(0)} % · cible : {baseUrl || 'proxy Vite'}
          </p>
        </div>
      </section>

      {/* CONFIGURATION */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs space-y-4" aria-labelledby="cfg-title">
        <h3 id="cfg-title" className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
          <Gauge className="w-3.5 h-3.5 text-[#00478a]" /> Configuration du test
        </h3>

        <fieldset disabled={isRunning} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 disabled:opacity-60">
          <div className="xl:col-span-2">
            <label htmlFor="sl-scenario" className="text-[11px] font-semibold text-slate-700 block mb-1">Scénario</label>
            <select
              id="sl-scenario"
              value={config.scenario}
              onChange={(e) => update('scenario', e.target.value as ScenarioId)}
              className="w-full bg-[#f8fafc] border border-slate-300 rounded-lg px-3 py-2 text-sm text-[#282828] focus:outline-none focus:border-[#00478a] focus:bg-white transition-colors"
            >
              {Object.values(SCENARIOS).map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500 mt-1">
              <span className="font-mono text-slate-600 font-semibold">{scenario.method} {scenario.path}</span> — {scenario.description}
            </p>
          </div>

          <div>
            <span className="text-[11px] font-semibold text-slate-700 block mb-1" id="sl-mode-label">Mode de charge</span>
            <div className="grid grid-cols-3 bg-slate-100 border border-slate-200 rounded-lg p-0.5 text-xs" role="radiogroup" aria-labelledby="sl-mode-label">
              {([['count', 'Nombre'], ['duration', 'Durée'], ['ramp', 'Rampe']] as [LoadMode, string][]).map(([m, l]) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={config.mode === m}
                  onClick={() => update('mode', m)}
                  className={`py-1.5 rounded-md font-semibold cursor-pointer transition-all ${config.mode === m ? 'bg-[#00478a] text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="text-[11px] font-semibold text-slate-700 block mb-1" id="sl-target-label">Cible backend</span>
            <div className="grid grid-cols-3 bg-slate-100 border border-slate-200 rounded-lg p-0.5 text-xs" role="radiogroup" aria-labelledby="sl-target-label">
              {([['proxy', 'Même origine (/api)'], ['direct', 'Direct :8000'], ['custom', 'Autre']] as const).map(([m, l]) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={targetMode === m}
                  onClick={() => setTargetMode(m)}
                  className={`py-1.5 rounded-md font-semibold cursor-pointer transition-all ${targetMode === m ? 'bg-[#00478a] text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  {l}
                </button>
              ))}
            </div>

            <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500 font-mono">
              <span className="truncate">Cible : <strong className="text-[#00478a]">{baseUrl || '(Même domaine /api)'}</strong></span>
              {targetMode === 'direct' && (
                <span className="text-slate-400 text-[10px] shrink-0 ml-1">Hôte auto</span>
              )}
            </div>

            {targetMode === 'custom' && (
              <div className="mt-1.5 flex gap-1.5">
                <input
                  aria-label="URL personnalisée du backend"
                  type="url"
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                  placeholder="http://IP_OU_DOMAINE:8000"
                  className="w-full bg-[#f8fafc] border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-mono text-[#282828] focus:outline-none focus:border-[#00478a] focus:bg-white"
                />
                <button
                  type="button"
                  onClick={() => setCustomUrl(directUrl)}
                  className="px-2 py-1 text-[11px] bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-md font-semibold shrink-0 cursor-pointer"
                  title="Réinitialiser avec l'hôte actuel"
                >
                  Réinit
                </button>
              </div>
            )}
          </div>

          {config.mode === 'count' ? (
            <NumberField id="sl-total" label="Nombre total de requêtes" value={config.totalRequests} min={1} max={20000} onChange={(v) => update('totalRequests', v)} />
          ) : (
            <NumberField id="sl-duration" label="Durée (secondes)" value={config.durationSec} min={5} max={600} onChange={(v) => update('durationSec', v)} />
          )}
          <NumberField
            id="sl-conc"
            label={config.mode === 'ramp' ? 'Utilisateurs simultanés (max)' : 'Utilisateurs simultanés'}
            value={config.concurrency}
            min={1}
            max={200}
            onChange={(v) => update('concurrency', v)}
          />
          <NumberField id="sl-think" label="Temps de réflexion (ms)" value={config.thinkTimeMs} min={0} max={10000} onChange={(v) => update('thinkTimeMs', v)} />
          <NumberField id="sl-timeout" label="Timeout par requête (ms)" value={config.timeoutMs} min={500} max={120000} onChange={(v) => update('timeoutMs', v)} />
          {config.scenario === 'calculate-heavy' && (
            <div className="md:col-span-2">
              <label htmlFor="sl-pieces" className="text-[11px] font-semibold text-slate-700 block mb-1">
                Pièces par commande lourde : <span className="font-mono text-[#00478a] font-bold">{config.heavyPieces}</span>
              </label>
              <input
                id="sl-pieces"
                type="range"
                min={5}
                max={150}
                value={config.heavyPieces}
                onChange={(e) => update('heavyPieces', Number(e.target.value))}
                className="w-full accent-[#00478a]"
              />
            </div>
          )}
        </fieldset>

        {browserCapWarning && (
          <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex gap-2">
            <Info className="w-4 h-4 shrink-0 text-amber-600" />
            <span>
              Les navigateurs limitent à ~6 connexions HTTP/1.1 simultanées par serveur : au-delà, les requêtes attendent dans le
              navigateur (la latence mesurée inclut cette attente). Pour une vraie charge massive, lancez&nbsp;
              <code className="font-mono text-amber-900 bg-amber-100 px-1 py-0.5 rounded">.venv\Scripts\python tools\stress_test.py</code>.
            </span>
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          {!isRunning ? (
            <button
              type="button"
              onClick={handleStart}
              disabled={targetMode === 'custom' && !customUrl.trim()}
              className="px-5 py-2.5 bg-[#00478a] hover:bg-[#003870] disabled:opacity-40 text-white font-bold rounded-lg text-sm flex items-center gap-2 cursor-pointer shadow-xs transition-colors"
            >
              <Play className="w-4 h-4" /> Lancer le test
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStop}
              className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg text-sm flex items-center gap-2 cursor-pointer shadow-xs transition-colors"
            >
              <Square className="w-4 h-4" /> Arrêter
            </button>
          )}
          <div className="flex-1 min-w-[200px]">
            <progress value={progress} max={100} aria-label="Progression du test" className="w-full h-2 rounded overflow-hidden [&::-webkit-progress-bar]:bg-slate-200 [&::-webkit-progress-bar]:rounded [&::-webkit-progress-value]:bg-[#00478a] [&::-webkit-progress-value]:rounded [&::-moz-progress-bar]:bg-[#00478a]" />
            <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-1">
              <span>{progress.toFixed(0)} %</span>
              <span>
                En vol : <strong className="text-[#00478a] font-bold">{live.inFlight}</strong> · Workers actifs : {live.activeWorkers} · Émises : {live.issued}
              </span>
            </div>
          </div>
          {lastVerdict && !isRunning && (
            <span className={`px-3 py-1.5 rounded-lg border text-xs font-black tracking-wider flex items-center gap-1.5 ${VERDICT_META[lastVerdict].cls}`}>
              {React.createElement(VERDICT_META[lastVerdict].Icon, { className: 'w-4 h-4' })}
              {VERDICT_META[lastVerdict].label}
            </span>
          )}
        </div>
      </section>

      {/* KPI */}
      {stats && (
        <>
          <section className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3" aria-label="Indicateurs clés">
            <Kpi icon={<Zap className="w-3.5 h-3.5" />} label="Débit" value={`${stats.rps.toFixed(1)}`} unit="req/s" />
            <Kpi icon={<Activity className="w-3.5 h-3.5" />} label="Requêtes" value={`${stats.count}`} unit={`${stats.elapsedSec.toFixed(1)} s`} />
            <Kpi label="Erreurs" value={`${stats.errorRate.toFixed(1)} %`} unit={`${stats.errors} (${stats.timeouts} timeout)`} tone={stats.errorRate === 0 ? 'good' : stats.errorRate < 5 ? 'warn' : 'bad'} />
            <Kpi icon={<Timer className="w-3.5 h-3.5" />} label="p50" value={fmtMs(stats.p50)} tone={stats.p50 < 100 ? 'good' : stats.p50 < 500 ? 'warn' : 'bad'} />
            <Kpi label="p95" value={fmtMs(stats.p95)} tone={stats.p95 < 100 ? 'good' : stats.p95 < 500 ? 'warn' : 'bad'} />
            <Kpi label="p99" value={fmtMs(stats.p99)} tone={stats.p99 < 250 ? 'good' : stats.p99 < 1000 ? 'warn' : 'bad'} />
            <Kpi label="Min / Max" value={fmtMs(stats.min)} unit={`max ${fmtMs(stats.max)}`} />
            <Kpi icon={<Users className="w-3.5 h-3.5" />} label="Données" value={fmtBytes(stats.bytes)} unit={`moy. ${fmtMs(stats.avg)}`} />
          </section>

          <section className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                Débit (succès <span className="text-emerald-600">■</span> / erreurs <span className="text-rose-600">■</span>) &amp; latence p95 <span className="text-amber-600">—</span>
              </h3>
              <TimelineChart stats={stats} />
              <details className="mt-2 text-[11px] text-slate-500">
                <summary className="cursor-pointer hover:text-[#00478a]">Voir les données seconde par seconde</summary>
                <div className="max-h-48 overflow-auto mt-2">
                  <table className="w-full font-mono text-slate-700">
                    <caption className="sr-only">Débit et latence par seconde</caption>
                    <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 text-[10px] uppercase">
                      <tr><th scope="col" className="text-left py-1">t</th><th scope="col" className="text-right">OK</th><th scope="col" className="text-right">Err.</th><th scope="col" className="text-right">Moy.</th><th scope="col" className="text-right">p95</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {stats.timeline.map((p) => (
                        <tr key={p.second}><td>{p.second}s</td><td className="text-right">{p.ok}</td><td className="text-right text-rose-600 font-semibold">{p.errors || ''}</td><td className="text-right">{fmtMs(p.avg)}</td><td className="text-right">{fmtMs(p.p95)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs space-y-4">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">Distribution des latences</h3>
                <Histogram stats={stats} />
              </div>
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">Codes de réponse</h3>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(stats.statusCodes).map(([code, n]) => (
                    <span
                      key={code}
                      className={`px-2 py-0.5 rounded text-[11px] font-mono border ${
                        code.startsWith('2') ? 'border-emerald-200 text-emerald-800 bg-emerald-50' : code === '422' ? 'border-amber-200 text-amber-800 bg-amber-50' : 'border-rose-200 text-rose-800 bg-rose-50'
                      }`}
                    >
                      {code} × {n}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs overflow-x-auto">
              <table className="w-full text-xs">
                <caption className="text-left text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">Détail par endpoint</caption>
                <thead className="text-[10px] uppercase text-slate-500 border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th scope="col" className="text-left py-1.5">Scénario</th>
                    <th scope="col" className="text-right">Req.</th>
                    <th scope="col" className="text-right">Erreurs</th>
                    <th scope="col" className="text-right">Moy.</th>
                    <th scope="col" className="text-right">p95</th>
                  </tr>
                </thead>
                <tbody className="font-mono divide-y divide-slate-100">
                  {Object.entries(stats.byScenario).map(([id, s]) => (
                    <tr key={id}>
                      <th scope="row" className="text-left py-1.5 font-sans font-medium text-slate-800">{SCENARIOS[id as ScenarioId]?.label || id}</th>
                      <td className="text-right text-slate-700">{s.count}</td>
                      <td className={`text-right ${s.errors ? 'text-rose-600 font-semibold' : 'text-slate-400'}`}>{s.errors}</td>
                      <td className={`text-right ${latencyColor(s.avg)}`}>{fmtMs(s.avg)}</td>
                      <td className={`text-right ${latencyColor(s.p95)}`}>{fmtMs(s.p95)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">Dernières erreurs</h3>
              {stats.recentErrors.length === 0 ? (
                <p className="text-xs text-emerald-700 flex items-center gap-1.5 font-medium"><CheckCircle2 className="w-4 h-4 text-emerald-600" /> Aucune erreur.</p>
              ) : (
                <ul className="space-y-1 max-h-56 overflow-auto text-[11px] font-mono">
                  {stats.recentErrors.map((e, i) => (
                    <li key={i} className="bg-rose-50 border border-rose-200 rounded px-2.5 py-1 text-rose-900">
                      <span className="text-rose-700 font-bold">[{e.status || 'ERR'}]</span> {e.scenario} · {fmtMs(e.latency)} — {e.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      )}

      {/* HISTORIQUE */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs overflow-x-auto">
        <div className="flex items-center justify-between mb-2 gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Historique des campagnes ({history.length})</h3>
          <div className="flex gap-2">
            <button type="button" onClick={handleExport} disabled={!stats && history.length === 0} className="px-2.5 py-1 rounded text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 flex items-center gap-1 disabled:opacity-40 cursor-pointer transition-colors shadow-2xs">
              <Download className="w-3.5 h-3.5" /> Export JSON
            </button>
            <button type="button" onClick={() => setHistory([])} disabled={history.length === 0} className="px-2.5 py-1 rounded text-[11px] bg-slate-100 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 text-slate-700 border border-slate-200 flex items-center gap-1 disabled:opacity-40 cursor-pointer transition-colors shadow-2xs">
              <Trash2 className="w-3.5 h-3.5" /> Vider
            </button>
          </div>
        </div>
        {history.length === 0 ? (
          <p className="text-xs text-slate-400">Aucune campagne enregistrée. Lancez un test pour commencer à comparer.</p>
        ) : (
          <table className="w-full text-xs">
            <caption className="sr-only">Historique des tests de charge</caption>
            <thead className="text-[10px] uppercase text-slate-500 border-b border-slate-200 bg-slate-50">
              <tr>
                <th scope="col" className="text-left py-1.5">Date</th>
                <th scope="col" className="text-left">Scénario</th>
                <th scope="col" className="text-left">Mode</th>
                <th scope="col" className="text-right">Utilis.</th>
                <th scope="col" className="text-right">Req.</th>
                <th scope="col" className="text-right">req/s</th>
                <th scope="col" className="text-right">p50</th>
                <th scope="col" className="text-right">p95</th>
                <th scope="col" className="text-right">p99</th>
                <th scope="col" className="text-right">Err.</th>
                <th scope="col" className="text-right">Verdict</th>
              </tr>
            </thead>
            <tbody className="font-mono divide-y divide-slate-100">
              {history.map((r) => (
                <tr key={r.id}>
                  <td className="py-1.5 text-slate-500">{r.date}</td>
                  <td className="font-sans text-slate-800 font-medium">{SCENARIOS[r.scenario]?.label || r.scenario}</td>
                  <td className="text-slate-500">{r.mode}</td>
                  <td className="text-right text-slate-700">{r.concurrency}</td>
                  <td className="text-right text-slate-700">{r.count}</td>
                  <td className="text-right text-amber-700 font-semibold">{r.rps.toFixed(1)}</td>
                  <td className={`text-right ${latencyColor(r.p50)}`}>{fmtMs(r.p50)}</td>
                  <td className={`text-right ${latencyColor(r.p95)}`}>{fmtMs(r.p95)}</td>
                  <td className={`text-right ${latencyColor(r.p99)}`}>{fmtMs(r.p99)}</td>
                  <td className={`text-right ${r.errorRate > 0 ? 'text-rose-600 font-semibold' : 'text-slate-400'}`}>{r.errorRate.toFixed(1)}%</td>
                  <td className="text-right">
                    <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${VERDICT_META[r.verdict].cls}`}>{VERDICT_META[r.verdict].label}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-[10px] text-slate-500 mt-3">
          Verdict : <strong className="text-emerald-700 font-semibold">Stable</strong> = erreurs &lt; 1 % et p95 &lt; 500 ms ·{' '}
          <strong className="text-amber-700 font-semibold">Dégradé</strong> = erreurs &lt; 5 % et p95 &lt; 2 s ·{' '}
          <strong className="text-rose-700 font-semibold">Instable</strong> au-delà.
        </p>
      </section>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sous-composants
// ---------------------------------------------------------------------------

const NumberField: React.FC<{ id: string; label: string; value: number; min: number; max: number; onChange: (v: number) => void }> = ({
  id,
  label,
  value,
  min,
  max,
  onChange,
}) => (
  <div>
    <label htmlFor={id} className="text-[11px] font-semibold text-slate-700 block mb-1">{label}</label>
    <input
      id={id}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={value}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (!Number.isNaN(v)) onChange(Math.max(min, Math.min(max, Math.round(v))));
      }}
      className="w-full bg-[#f8fafc] border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono text-[#282828] focus:outline-none focus:border-[#00478a] focus:bg-white transition-colors"
    />
  </div>
);

const Kpi: React.FC<{ label: string; value: string; unit?: string; icon?: React.ReactNode; tone?: 'good' | 'warn' | 'bad' }> = ({
  label,
  value,
  unit,
  icon,
  tone,
}) => (
  <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-2xs">
    <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-1">
      {icon}
      {label}
    </span>
    <span
      className={`block text-lg font-bold font-mono mt-0.5 tabular-nums ${
        tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : tone === 'bad' ? 'text-rose-700' : 'text-[#282828]'
      }`}
    >
      {value}
    </span>
    {unit && <span className="text-[10px] text-slate-400 font-mono">{unit}</span>}
  </div>
);
