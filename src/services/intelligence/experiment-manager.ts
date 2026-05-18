/**
 * Experiment Manager — lightweight A/B framework for algorithm tweaks.
 * Pure store: injectable Storage + clock so unit tests run without DOM.
 * Experiments live in `wm-experiments`; observations in a 5000-record
 * ring buffer under `wm-experiment-observations`.
 *
 * Arm assignment is deterministic per inputHash so the same input
 * always lands in the same arm for the life of an experiment.
 */

// ── Public types ─────────────────────────────────────────────────────────

export type ExperimentStatus = 'draft' | 'running' | 'paused' | 'concluded';
export type ExperimentArm = 'control' | 'treatment';
export type ExperimentOutcome = 'positive' | 'negative' | 'neutral';
export type ExperimentRecommendation =
  | 'graduate'
  | 'reject'
  | 'continue'
  | 'insufficient-data';

export interface Experiment {
  id: string;
  name: string;
  description: string;
  algorithmId: string;
  status: ExperimentStatus;
  trafficSplit: number;
  createdAt: Date;
  startedAt?: Date;
  concludedAt?: Date;
  hypothesis: string;
  successMetric: string;
}

export interface ExperimentObservation {
  id: string;
  experimentId: string;
  arm: ExperimentArm;
  inputHash: string;
  outcome: ExperimentOutcome;
  recordedAt: Date;
}

export interface ExperimentResult {
  experimentId: string;
  controlPositiveRate: number;
  treatmentPositiveRate: number;
  lift: number;
  sampleSize: number;
  isSignificant: boolean;
  recommendation: ExperimentRecommendation;
}

export interface RecordObservationInput {
  experimentId: string;
  arm: ExperimentArm;
  inputHash: string;
  outcome: ExperimentOutcome;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ExperimentManagerOptions {
  storage?: StorageLike | null;
  now?: () => number;
}

export interface ExperimentManager {
  create(input: Omit<Experiment, 'id' | 'status' | 'createdAt' | 'startedAt' | 'concludedAt'>): Experiment;
  start(id: string): Experiment;
  pause(id: string): Experiment;
  resume(id: string): Experiment;
  conclude(id: string): Experiment;
  assignArm(experimentId: string, inputHash: string): ExperimentArm;
  recordObservation(input: RecordObservationInput): ExperimentObservation;
  getResult(experimentId: string): ExperimentResult;
  getExperiments(status?: ExperimentStatus): Experiment[];
  getObservations(experimentId: string, limit?: number): ExperimentObservation[];
  subscribe(cb: (experiments: Experiment[]) => void): void;
  unsubscribe(cb: (experiments: Experiment[]) => void): void;
}

// ── Constants ────────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-experiments';
export const OBSERVATIONS_STORAGE_KEY = 'wm-experiment-observations';
export const MAX_OBSERVATIONS = 5000;
export const SIGNIFICANCE_LIFT_THRESHOLD = 0.05;
export const SIGNIFICANCE_MIN_SAMPLE = 30;

// ── Helpers ──────────────────────────────────────────────────────────────

let _idCounter = 0;
function nextId(prefix: string, nowMs: number): string {
  _idCounter += 1;
  return `${prefix}-${nowMs.toString(36)}-${_idCounter.toString(36)}`;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** FNV-1a-style string-to-uint32 hash used for deterministic arm assignment. */
function hashStringToUint32(s: string): number {
  let h = 2_166_136_261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.codePointAt(i) ?? 0;
    h = Math.imul(h, 16_777_619);
  }
  return h >>> 0;
}

function resolveLocalStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof globalThis !== 'undefined') {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (ls && typeof ls.getItem === 'function') return ls;
  }
  return null;
}

function cloneExperiment(e: Experiment): Experiment {
  return {
    ...e,
    createdAt: new Date(e.createdAt),
    startedAt: e.startedAt ? new Date(e.startedAt) : undefined,
    concludedAt: e.concludedAt ? new Date(e.concludedAt) : undefined,
  };
}

function cloneObservation(o: ExperimentObservation): ExperimentObservation {
  return { ...o, recordedAt: new Date(o.recordedAt) };
}

interface PersistedExperiment extends Omit<Experiment, 'createdAt' | 'startedAt' | 'concludedAt'> {
  createdAt: string;
  startedAt?: string;
  concludedAt?: string;
}

interface PersistedObservation extends Omit<ExperimentObservation, 'recordedAt'> {
  recordedAt: string;
}

function serializeExperiment(e: Experiment): PersistedExperiment {
  return {
    ...e,
    createdAt: e.createdAt.toISOString(),
    startedAt: e.startedAt ? e.startedAt.toISOString() : undefined,
    concludedAt: e.concludedAt ? e.concludedAt.toISOString() : undefined,
  };
}

function serializeObservation(o: ExperimentObservation): PersistedObservation {
  return { ...o, recordedAt: o.recordedAt.toISOString() };
}

function parseDate(raw: unknown): Date | null {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === 'string') {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function isStatus(s: unknown): s is ExperimentStatus {
  return s === 'draft' || s === 'running' || s === 'paused' || s === 'concluded';
}

function isArm(a: unknown): a is ExperimentArm {
  return a === 'control' || a === 'treatment';
}

function isOutcome(o: unknown): o is ExperimentOutcome {
  return o === 'positive' || o === 'negative' || o === 'neutral';
}

function deserializeExperiment(raw: unknown): Experiment | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string') return null;
  const createdAt = parseDate(r.createdAt);
  if (!createdAt) return null;
  return {
    id: r.id,
    name: typeof r.name === 'string' ? r.name : '',
    description: typeof r.description === 'string' ? r.description : '',
    algorithmId: typeof r.algorithmId === 'string' ? r.algorithmId : '',
    status: isStatus(r.status) ? r.status : 'draft',
    trafficSplit: typeof r.trafficSplit === 'number' ? clamp01(r.trafficSplit) : 0.5,
    createdAt,
    startedAt: parseDate(r.startedAt) ?? undefined,
    concludedAt: parseDate(r.concludedAt) ?? undefined,
    hypothesis: typeof r.hypothesis === 'string' ? r.hypothesis : '',
    successMetric: typeof r.successMetric === 'string' ? r.successMetric : '',
  };
}

function deserializeObservation(raw: unknown): ExperimentObservation | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.experimentId !== 'string') return null;
  const recordedAt = parseDate(r.recordedAt);
  if (!recordedAt) return null;
  return {
    id: r.id,
    experimentId: r.experimentId,
    arm: isArm(r.arm) ? r.arm : 'control',
    inputHash: typeof r.inputHash === 'string' ? r.inputHash : '',
    outcome: isOutcome(r.outcome) ? r.outcome : 'neutral',
    recordedAt,
  };
}

function rehydrateExperiments(storage: StorageLike | null): Experiment[] {
  if (!storage) return [];
  let raw: string | null;
  try { raw = storage.getItem(STORAGE_KEY); } catch { return []; }
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: Experiment[] = [];
  for (const p of parsed) {
    const d = deserializeExperiment(p);
    if (d) out.push(d);
  }
  return out;
}

function rehydrateObservations(storage: StorageLike | null): ExperimentObservation[] {
  if (!storage) return [];
  let raw: string | null;
  try { raw = storage.getItem(OBSERVATIONS_STORAGE_KEY); } catch { return []; }
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: ExperimentObservation[] = [];
  for (const p of parsed) {
    const d = deserializeObservation(p);
    if (d) out.push(d);
  }
  return out;
}

// ── Factory ──────────────────────────────────────────────────────────────

export function createExperimentManager(
  options: ExperimentManagerOptions = {},
): ExperimentManager {
  const storage = resolveLocalStorage(options.storage);
  const clock = options.now ?? (() => Date.now());
  const experiments: Experiment[] = rehydrateExperiments(storage);
  const observations: ExperimentObservation[] = rehydrateObservations(storage);
  const listeners = new Set<(experiments: Experiment[]) => void>();

  function persistExperiments(): void {
    if (!storage) return;
    try {
      const payload = experiments.map((e) => serializeExperiment(e));
      storage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch { /* quota / private-mode — non-critical */ }
  }

  function persistObservations(): void {
    if (!storage) return;
    try {
      const payload = observations.map((o) => serializeObservation(o));
      storage.setItem(OBSERVATIONS_STORAGE_KEY, JSON.stringify(payload));
    } catch { /* quota / private-mode — non-critical */ }
  }

  function notify(): void {
    const snapshot = experiments.map((e) => cloneExperiment(e));
    for (const cb of listeners) {
      try { cb(snapshot); } catch { /* listener crash isolation */ }
    }
  }

  function findById(id: string): Experiment | undefined {
    return experiments.find((e) => e.id === id);
  }

  function requireById(id: string): Experiment {
    const exp = findById(id);
    if (!exp) throw new Error(`Experiment not found: ${id}`);
    return exp;
  }

  return {
    create(input): Experiment {
      const nowMs = clock();
      const exp: Experiment = {
        id: nextId('exp', nowMs),
        name: input.name,
        description: input.description,
        algorithmId: input.algorithmId,
        status: 'draft',
        trafficSplit: clamp01(input.trafficSplit),
        createdAt: new Date(nowMs),
        hypothesis: input.hypothesis,
        successMetric: input.successMetric,
      };
      experiments.push(exp);
      persistExperiments();
      notify();
      return cloneExperiment(exp);
    },

    start(id): Experiment {
      const exp = requireById(id);
      if (exp.status !== 'draft') {
        throw new Error(`Cannot start experiment in status '${exp.status}': must be 'draft'`);
      }
      exp.status = 'running';
      exp.startedAt = new Date(clock());
      persistExperiments();
      notify();
      return cloneExperiment(exp);
    },

    pause(id): Experiment {
      const exp = requireById(id);
      if (exp.status !== 'running') {
        throw new Error(`Cannot pause experiment in status '${exp.status}': must be 'running'`);
      }
      exp.status = 'paused';
      persistExperiments();
      notify();
      return cloneExperiment(exp);
    },

    resume(id): Experiment {
      const exp = requireById(id);
      if (exp.status !== 'paused') {
        throw new Error(`Cannot resume experiment in status '${exp.status}': must be 'paused'`);
      }
      exp.status = 'running';
      persistExperiments();
      notify();
      return cloneExperiment(exp);
    },

    conclude(id): Experiment {
      const exp = requireById(id);
      if (exp.status !== 'running' && exp.status !== 'paused') {
        throw new Error(
          `Cannot conclude experiment in status '${exp.status}': must be 'running' or 'paused'`,
        );
      }
      exp.status = 'concluded';
      exp.concludedAt = new Date(clock());
      persistExperiments();
      notify();
      return cloneExperiment(exp);
    },

    assignArm(experimentId, inputHash): ExperimentArm {
      const exp = requireById(experimentId);
      if (exp.status !== 'running') {
        throw new Error(
          `Cannot assign arm for experiment in status '${exp.status}': must be 'running'`,
        );
      }
      if (exp.trafficSplit <= 0) return 'control';
      if (exp.trafficSplit >= 1) return 'treatment';
      const bucket = hashStringToUint32(`${exp.id}:${inputHash}`) % 100;
      return bucket < exp.trafficSplit * 100 ? 'treatment' : 'control';
    },

    recordObservation(input): ExperimentObservation {
      const nowMs = clock();
      const obs: ExperimentObservation = {
        id: nextId('obs', nowMs),
        experimentId: input.experimentId,
        arm: input.arm,
        inputHash: input.inputHash,
        outcome: input.outcome,
        recordedAt: new Date(nowMs),
      };
      observations.push(obs);
      if (observations.length > MAX_OBSERVATIONS) {
        observations.splice(0, observations.length - MAX_OBSERVATIONS);
      }
      persistObservations();
      return cloneObservation(obs);
    },

    getResult(experimentId): ExperimentResult {
      let controlTotal = 0;
      let controlPositive = 0;
      let treatmentTotal = 0;
      let treatmentPositive = 0;
      for (const o of observations) {
        if (o.experimentId !== experimentId) continue;
        if (o.arm === 'control') {
          controlTotal += 1;
          if (o.outcome === 'positive') controlPositive += 1;
        } else {
          treatmentTotal += 1;
          if (o.outcome === 'positive') treatmentPositive += 1;
        }
      }
      const controlPositiveRate = controlTotal === 0 ? 0 : controlPositive / controlTotal;
      const treatmentPositiveRate = treatmentTotal === 0 ? 0 : treatmentPositive / treatmentTotal;
      const lift = treatmentPositiveRate - controlPositiveRate;
      const sampleSize = controlTotal + treatmentTotal;
      const isSignificant =
        sampleSize >= SIGNIFICANCE_MIN_SAMPLE && Math.abs(lift) > SIGNIFICANCE_LIFT_THRESHOLD;
      const recommendation = recommend(sampleSize, lift, isSignificant);
      return {
        experimentId,
        controlPositiveRate,
        treatmentPositiveRate,
        lift,
        sampleSize,
        isSignificant,
        recommendation,
      };
    },

    getExperiments(status): Experiment[] {
      const filtered = status === undefined
        ? experiments
        : experiments.filter((e) => e.status === status);
      return filtered.map((e) => cloneExperiment(e));
    },

    getObservations(experimentId, limit): ExperimentObservation[] {
      const out: ExperimentObservation[] = [];
      for (let i = observations.length - 1; i >= 0; i--) {
        const o = observations[i];
        if (o?.experimentId !== experimentId) continue;
        out.push(cloneObservation(o));
        if (limit !== undefined && out.length >= limit) break;
      }
      return out;
    },

    subscribe(cb): void {
      listeners.add(cb);
    },

    unsubscribe(cb): void {
      listeners.delete(cb);
    },
  };
}

function recommend(
  sampleSize: number,
  lift: number,
  isSignificant: boolean,
): ExperimentRecommendation {
  if (sampleSize < SIGNIFICANCE_MIN_SAMPLE) return 'insufficient-data';
  if (isSignificant && lift > 0) return 'graduate';
  if (isSignificant && lift < 0) return 'reject';
  return 'continue';
}

// ── Singleton ────────────────────────────────────────────────────────────

let _singleton: ExperimentManager | null = null;

export function getExperimentManager(): ExperimentManager {
  _singleton ??= createExperimentManager();
  return _singleton;
}

export function resetExperimentManagerForTests(): void {
  _singleton = null;
}
