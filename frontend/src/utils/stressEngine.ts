/**
 * Moteur de test de charge côté navigateur pour l'API FastAPI FacoNote.
 *
 * Principe : un pool de "workers" asynchrones (1 worker = 1 utilisateur virtuel)
 * enchaîne des requêtes HTTP réelles vers le backend et enregistre chaque échantillon
 * (latence, code HTTP, erreur). Les statistiques sont calculées à partir de ces échantillons.
 *
 * ⚠️ Limite physique : en HTTP/1.1, un navigateur ouvre au maximum ~6 connexions
 * simultanées par origine. Au-delà, les requêtes sont mises en file par le navigateur
 * lui-même. Pour une vraie charge massive, utiliser `tools/stress_test.py`.
 */

// ---------------------------------------------------------------------------
// Scénarios
// ---------------------------------------------------------------------------

export type ScenarioId =
  | 'health'
  | 'quick-encode'
  | 'auto-breakdown'
  | 'calculate-light'
  | 'calculate-heavy'
  | 'print-sheet'
  | 'invalid-422'
  | 'mixed';

export interface ScenarioDef {
  id: ScenarioId;
  label: string;
  method: 'GET' | 'POST';
  path: string;
  description: string;
  /** Code HTTP attendu (un 422 attendu est un succès pour le scénario "invalid-422") */
  expectedStatus: number;
  /** Poids dans le scénario "mixed" (reflète l'usage réel en atelier) */
  mixWeight: number;
  buildBody?: (opts: PayloadOptions) => unknown;
}

export interface PayloadOptions {
  heavyPieces: number;
}

const DEV_BOUNDS = [100, 120, 150, 175, 187, 200, 250, 285, 300, 333, 375, 400, 450, 500];
const ZINC_MATERIALS = ['Zinc Naturel 0.7', 'Zinc Quartz 0.7', 'Zinc Noir ATZ 0.7'];
const ALU_MATERIALS = ['Alu 7016 gris bleu 0.7', 'Alu 9010 Blanc 0.7'];

const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const randLen = () => Math.round((1 + Math.random() * 5) * 10) / 10; // 1.0 → 6.0 m

function buildPieces(count: number, mixMaterials: boolean) {
  return Array.from({ length: count }, (_, i) => {
    const material = mixMaterials && Math.random() < 0.3 ? pick(ALU_MATERIALS) : pick(ZINC_MATERIALS);
    return {
      id: `stress-${i}`,
      label: `Profil test #${i + 1}`,
      dev: pick(DEV_BOUNDS) + randInt(-10, 0),
      length: randLen(),
      quantity: randInt(1, 12),
      bends: randInt(0, 5),
      material,
    };
  });
}

function buildOptimizationRequest(pieceCount: number, mixMaterials: boolean) {
  return {
    client_name: 'Stress Lab',
    chantier_ref: `Charge-${Date.now()}`,
    material: 'Zinc Naturel 0.7',
    pieces: buildPieces(pieceCount, mixMaterials),
    available_mother_widths: [600, 650, 750, 1000],
    use_workshop_scraps: false,
    accepted_proposal_ids: null,
  };
}

export const SCENARIOS: Record<ScenarioId, ScenarioDef> = {
  health: {
    id: 'health',
    label: 'Santé (/api/health)',
    method: 'GET',
    path: '/api/health',
    description: 'Requête minimale : mesure le coût réseau + framework pur (référence de base).',
    expectedStatus: 200,
    mixWeight: 0,
  },
  'quick-encode': {
    id: 'quick-encode',
    label: 'Encodage rapide',
    method: 'POST',
    path: '/api/v1/optimizer/quick-encode',
    description: 'Parseur RPN + affectation de borne. ~90 % du trafic réel d’un poste de saisie.',
    expectedStatus: 200,
    mixWeight: 60,
    buildBody: () => ({
      raw_input: `${pick(DEV_BOUNDS)}/${randInt(1, 20)}*${randLen()}`,
      material: pick(ZINC_MATERIALS),
      length_unit: 'm',
      preset: 'DEV_PIECE',
    }),
  },
  'auto-breakdown': {
    id: 'auto-breakdown',
    label: 'Auto-calepinage',
    method: 'POST',
    path: '/api/v1/optimizer/auto-breakdown',
    description: 'Recherche des diviseurs et scoring des alternatives sur un métrage aléatoire.',
    expectedStatus: 200,
    mixWeight: 20,
    buildBody: () => ({
      total_meters: Math.round((2 + Math.random() * 60) * 10) / 10,
      current_pieces: [],
      target_material: pick(ZINC_MATERIALS),
      forced_length: null,
    }),
  },
  'calculate-light': {
    id: 'calculate-light',
    label: 'Refente légère (5 pièces)',
    method: 'POST',
    path: '/api/v1/optimizer/calculate',
    description: 'Imbrication d’une commande typique de comptoir (5 repères, zinc).',
    expectedStatus: 200,
    mixWeight: 15,
    buildBody: () => buildOptimizationRequest(5, false),
  },
  'calculate-heavy': {
    id: 'calculate-heavy',
    label: 'Refente lourde (N pièces)',
    method: 'POST',
    path: '/api/v1/optimizer/calculate',
    description: 'Commande chantier volumineuse multi-matières (zinc + alu) : sollicite fortement le CPU.',
    expectedStatus: 200,
    mixWeight: 0,
    buildBody: (opts) => buildOptimizationRequest(opts.heavyPieces, true),
  },
  'print-sheet': {
    id: 'print-sheet',
    label: 'Fiche A4 (HTML)',
    method: 'POST',
    path: '/api/v1/optimizer/print-sheet',
    description: 'Imbrication + génération HTML complète (réponse volumineuse).',
    expectedStatus: 200,
    mixWeight: 5,
    buildBody: () => buildOptimizationRequest(8, false),
  },
  'invalid-422': {
    id: 'invalid-422',
    label: 'Saisies invalides (422)',
    method: 'POST',
    path: '/api/v1/optimizer/quick-encode',
    description: 'Envoie volontairement des saisies erronées : vérifie que le serveur rejette proprement (422) sans planter.',
    expectedStatus: 422,
    mixWeight: 0,
    buildBody: () => ({
      raw_input: pick(['0/4*2', '175/0*', 'abc/2*3', '175/3*2/0']),
      material: 'Zinc Naturel 0.7',
      length_unit: 'm',
      preset: 'DEV_PIECE',
    }),
  },
  mixed: {
    id: 'mixed',
    label: 'Trafic atelier mixte',
    method: 'POST',
    path: '(pondéré)',
    description: 'Mélange réaliste : 60 % encodage, 20 % calepinage, 15 % refente, 5 % fiches A4.',
    expectedStatus: 200,
    mixWeight: 0,
  },
};

function resolveScenario(id: ScenarioId): ScenarioDef {
  if (id !== 'mixed') return SCENARIOS[id];
  const pool = Object.values(SCENARIOS).filter((s) => s.mixWeight > 0);
  const total = pool.reduce((a, s) => a + s.mixWeight, 0);
  let r = Math.random() * total;
  for (const s of pool) {
    r -= s.mixWeight;
    if (r <= 0) return s;
  }
  return pool[0];
}

// ---------------------------------------------------------------------------
// Configuration & échantillons
// ---------------------------------------------------------------------------

export type LoadMode = 'count' | 'duration' | 'ramp';

export interface StressConfig {
  scenario: ScenarioId;
  mode: LoadMode;
  totalRequests: number;
  durationSec: number;
  concurrency: number;
  timeoutMs: number;
  thinkTimeMs: number;
  heavyPieces: number;
  baseUrl: string;
  adminToken?: string;
}

export interface Sample {
  /** ms depuis le début du test (fin de requête) */
  t: number;
  latency: number;
  status: number; // 0 = erreur réseau / timeout
  ok: boolean;
  timeout: boolean;
  scenario: ScenarioId;
  bytes: number;
  error?: string;
}

export interface LiveState {
  inFlight: number;
  issued: number;
  activeWorkers: number;
  startedAt: number;
}

// ---------------------------------------------------------------------------
// Moteur d'exécution
// ---------------------------------------------------------------------------

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0 || signal.aborted) return resolve();
    const id = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(id);
      resolve();
    }, { once: true });
  });

async function fireOne(
  config: StressConfig,
  startT: number,
  globalSignal: AbortSignal
): Promise<Sample> {
  const scenario = resolveScenario(config.scenario);
  const url = `${config.baseUrl.replace(/\/+$/, '')}${scenario.path}`;

  // Signal combiné : arrêt global OU timeout individuel de la requête
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, config.timeoutMs);
  const onGlobalAbort = () => ctrl.abort();
  globalSignal.addEventListener('abort', onGlobalAbort, { once: true });

  const t0 = performance.now();
  try {
    const headers: Record<string, string> = {};
    if (scenario.method === 'POST') headers['Content-Type'] = 'application/json';
    if (config.adminToken) headers['X-Admin-Token'] = config.adminToken;

    const res = await fetch(url, {
      method: scenario.method,
      headers,
      body: scenario.buildBody ? JSON.stringify(scenario.buildBody({ heavyPieces: config.heavyPieces })) : undefined,
      signal: ctrl.signal,
      cache: 'no-store',
    });
    // Lecture complète du corps : on mesure le temps de transfert réel
    const text = await res.text();
    const t1 = performance.now();
    const ok = res.status === scenario.expectedStatus;
    return {
      t: t1 - startT,
      latency: t1 - t0,
      status: res.status,
      ok,
      timeout: false,
      scenario: scenario.id,
      bytes: text.length,
      error: ok ? undefined : text.slice(0, 160),
    };
  } catch (err: unknown) {
    const t1 = performance.now();
    const message = err instanceof Error ? err.message : String(err);
    return {
      t: t1 - startT,
      latency: t1 - t0,
      status: 0,
      ok: false,
      timeout: timedOut,
      scenario: scenario.id,
      bytes: 0,
      error: timedOut ? `Timeout > ${config.timeoutMs} ms` : `Réseau : ${message}`,
    };
  } finally {
    clearTimeout(timer);
    globalSignal.removeEventListener('abort', onGlobalAbort);
  }
}

/**
 * Lance un test de charge. Les échantillons sont poussés dans `samples` (tableau mutable,
 * lu périodiquement par l'UI pour éviter un re-rendu React par requête).
 */
export async function runStressTest(
  config: StressConfig,
  samples: Sample[],
  live: LiveState,
  signal: AbortSignal
): Promise<void> {
  const startT = performance.now();
  live.startedAt = startT;
  live.inFlight = 0;
  live.issued = 0;
  live.activeWorkers = 0;

  const durationMs = config.durationSec * 1000;
  const canIssue = () => {
    if (signal.aborted) return false;
    if (config.mode === 'count') return live.issued < config.totalRequests;
    return performance.now() - startT < durationMs;
  };

  const worker = async (index: number) => {
    // Montée en charge progressive : les workers démarrent de façon échelonnée
    if (config.mode === 'ramp') {
      await sleep((index / config.concurrency) * durationMs * 0.8, signal);
    }
    live.activeWorkers++;
    try {
      while (canIssue()) {
        live.issued++;
        live.inFlight++;
        const sample = await fireOne(config, startT, signal);
        live.inFlight--;
        if (!signal.aborted || sample.status !== 0) samples.push(sample);
        if (config.thinkTimeMs > 0) await sleep(config.thinkTimeMs, signal);
      }
    } finally {
      live.activeWorkers--;
    }
  };

  await Promise.all(Array.from({ length: config.concurrency }, (_, i) => worker(i)));
}

// ---------------------------------------------------------------------------
// Statistiques
// ---------------------------------------------------------------------------

export interface TimelinePoint {
  second: number;
  ok: number;
  errors: number;
  p95: number;
  avg: number;
}

export interface HistogramBucket {
  label: string;
  max: number;
  count: number;
}

export interface StatsSnapshot {
  count: number;
  ok: number;
  errors: number;
  timeouts: number;
  errorRate: number;
  elapsedSec: number;
  rps: number;
  min: number;
  avg: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  bytes: number;
  statusCodes: Record<string, number>;
  byScenario: Record<string, { count: number; errors: number; avg: number; p95: number }>;
  timeline: TimelinePoint[];
  histogram: HistogramBucket[];
  recentErrors: Sample[];
}

const HIST_EDGES: [string, number][] = [
  ['< 5 ms', 5],
  ['5–10', 10],
  ['10–25', 25],
  ['25–50', 50],
  ['50–100', 100],
  ['100–250', 250],
  ['250–500', 500],
  ['0,5–1 s', 1000],
  ['1–2,5 s', 2500],
  ['> 2,5 s', Infinity],
];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export function computeStats(samples: Sample[], elapsedMs: number): StatsSnapshot {
  const latencies = samples.map((s) => s.latency).sort((a, b) => a - b);
  const count = samples.length;
  const ok = samples.reduce((a, s) => a + (s.ok ? 1 : 0), 0);
  const timeouts = samples.reduce((a, s) => a + (s.timeout ? 1 : 0), 0);
  const sum = latencies.reduce((a, v) => a + v, 0);
  const bytes = samples.reduce((a, s) => a + s.bytes, 0);

  const statusCodes: Record<string, number> = {};
  const scenarioLat: Record<string, number[]> = {};
  const scenarioErr: Record<string, number> = {};
  const buckets = new Map<number, { ok: number; errors: number; lat: number[] }>();

  for (const s of samples) {
    const key = s.status === 0 ? (s.timeout ? 'TIMEOUT' : 'RÉSEAU') : String(s.status);
    statusCodes[key] = (statusCodes[key] || 0) + 1;

    (scenarioLat[s.scenario] ||= []).push(s.latency);
    if (!s.ok) scenarioErr[s.scenario] = (scenarioErr[s.scenario] || 0) + 1;

    const sec = Math.floor(s.t / 1000);
    const b = buckets.get(sec) || { ok: 0, errors: 0, lat: [] };
    if (s.ok) b.ok++;
    else b.errors++;
    b.lat.push(s.latency);
    buckets.set(sec, b);
  }

  const lastSec = Math.max(0, Math.floor(elapsedMs / 1000));
  const timeline: TimelinePoint[] = [];
  for (let sec = 0; sec <= lastSec; sec++) {
    const b = buckets.get(sec);
    if (!b) {
      timeline.push({ second: sec, ok: 0, errors: 0, p95: 0, avg: 0 });
      continue;
    }
    const sorted = b.lat.sort((x, y) => x - y);
    timeline.push({
      second: sec,
      ok: b.ok,
      errors: b.errors,
      p95: percentile(sorted, 95),
      avg: sorted.reduce((a, v) => a + v, 0) / sorted.length,
    });
  }

  const byScenario: StatsSnapshot['byScenario'] = {};
  for (const [id, lats] of Object.entries(scenarioLat)) {
    const sorted = lats.sort((a, b) => a - b);
    byScenario[id] = {
      count: sorted.length,
      errors: scenarioErr[id] || 0,
      avg: sorted.reduce((a, v) => a + v, 0) / sorted.length,
      p95: percentile(sorted, 95),
    };
  }

  const histogram: HistogramBucket[] = HIST_EDGES.map(([label, max]) => ({ label, max, count: 0 }));
  for (const v of latencies) {
    const bucket = histogram.find((h) => v < h.max) || histogram[histogram.length - 1];
    bucket.count++;
  }

  const elapsedSec = elapsedMs / 1000;
  return {
    count,
    ok,
    errors: count - ok,
    timeouts,
    errorRate: count ? ((count - ok) / count) * 100 : 0,
    elapsedSec,
    rps: elapsedSec > 0 ? count / elapsedSec : 0,
    min: latencies[0] || 0,
    avg: count ? sum / count : 0,
    p50: percentile(latencies, 50),
    p90: percentile(latencies, 90),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    max: latencies[latencies.length - 1] || 0,
    bytes,
    statusCodes,
    byScenario,
    timeline,
    histogram,
    recentErrors: samples.filter((s) => !s.ok).slice(-15).reverse(),
  };
}

export type Verdict = 'stable' | 'degraded' | 'unstable';

export function computeVerdict(stats: StatsSnapshot): Verdict {
  if (stats.count === 0) return 'unstable';
  if (stats.errorRate < 1 && stats.p95 < 500) return 'stable';
  if (stats.errorRate < 5 && stats.p95 < 2000) return 'degraded';
  return 'unstable';
}
