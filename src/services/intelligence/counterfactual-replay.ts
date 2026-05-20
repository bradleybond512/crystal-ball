/**
 * CounterfactualReplayEngine — "what if?" scenario engine.
 *
 * Takes a historical world snapshot id and replays the scenario with
 * one or more domain state overrides applied. Computes a cascade score
 * (mean absolute severity delta, clamped 0-1) and generates a narrative
 * summary. Persists up to 100 scenarios under `wm-counterfactual-replay`.
 *
 * Pure module — no DOM, no fetch, no globals at import time.
 */

// ── Public types ──────────────────────────────────────────────────────

export interface DomainOverride {
  domain: string;
  severityDelta: number;
  eventCountDelta: number;
}

export interface ReplayResult {
  scenarioId: string;
  computedAt: number;
  affectedDomains: string[];
  cascadeScore: number;
  narrativeSummary: string;
}

export interface CounterfactualScenario {
  id: string;
  name: string;
  baseSnapshotId: string;
  overrides: DomainOverride[];
  createdAt: number;
  result?: ReplayResult;
}

// ── Constants ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'wm-counterfactual-replay';
const MAX_SCENARIOS = 100;

// ── Helpers ───────────────────────────────────────────────────────────

function safeStorage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

function cascadeTier(score: number): string {
  if (score > 0.7) return 'critical cascade';
  if (score > 0.4) return 'moderate cascade';
  if (score > 0.1) return 'minor cascade';
  return 'minimal impact';
}

function computeCascadeScore(overrides: DomainOverride[]): number {
  if (overrides.length === 0) return 0;
  const sumAbs = overrides.reduce((acc, o) => acc + Math.abs(o.severityDelta), 0);
  return Math.min(1, sumAbs / overrides.length);
}

function buildNarrative(scenario: CounterfactualScenario, result: ReplayResult): string {
  const n = result.affectedDomains.length;
  const tier = cascadeTier(result.cascadeScore);
  const domainList = result.affectedDomains.join(', ') || 'none';
  return `Scenario "${scenario.name}": ${n} domain(s) modified. Cascade score: ${result.cascadeScore.toFixed(2)} (${tier}). Affected: ${domainList}.`;
}

// ── Serialization ─────────────────────────────────────────────────────

function isValidScenario(v: unknown): v is CounterfactualScenario {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    typeof s.name === 'string' &&
    typeof s.baseSnapshotId === 'string' &&
    Array.isArray(s.overrides) &&
    typeof s.createdAt === 'number'
  );
}

function loadScenarios(): CounterfactualScenario[] {
  const store = safeStorage();
  if (!store) return [];
  let raw: string | null = null;
  try { raw = store.getItem(STORAGE_KEY); } catch { return []; }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is CounterfactualScenario => isValidScenario(v));
  } catch {
    return [];
  }
}

function persistScenarios(scenarios: CounterfactualScenario[]): void {
  const store = safeStorage();
  if (!store) return;
  try { store.setItem(STORAGE_KEY, JSON.stringify(scenarios)); } catch { /* quota */ }
}

// ── Engine ────────────────────────────────────────────────────────────

let _idCounter = 0;
let _instance: CounterfactualReplayEngine | null = null;

function nextId(): string {
  _idCounter += 1;
  return `cfr-${Date.now()}-${_idCounter}`;
}

export class CounterfactualReplayEngine {
  private scenarios: CounterfactualScenario[];

  constructor() {
    this.scenarios = loadScenarios();
  }

  static getInstance(): CounterfactualReplayEngine {
    _instance ??= new CounterfactualReplayEngine();
    return _instance;
  }

  createScenario(
    name: string,
    baseSnapshotId: string,
    overrides: DomainOverride[],
  ): CounterfactualScenario {
    const scenario: CounterfactualScenario = {
      id: nextId(),
      name,
      baseSnapshotId,
      overrides,
      createdAt: Date.now(),
    };
    if (this.scenarios.length >= MAX_SCENARIOS) {
      this.scenarios.shift();
    }
    this.scenarios.push(scenario);
    persistScenarios(this.scenarios);
    return { ...scenario, overrides: [...overrides] };
  }

  runScenario(scenarioId: string): ReplayResult | undefined {
    const idx = this.scenarios.findIndex((s) => s.id === scenarioId);
    if (idx === -1) return undefined;
    const scenario = this.scenarios[idx]!;
    const affectedDomains = scenario.overrides.map((o) => o.domain);
    const cascadeScore = computeCascadeScore(scenario.overrides);
    const result: ReplayResult = {
      scenarioId,
      computedAt: Date.now(),
      affectedDomains,
      cascadeScore,
      narrativeSummary: '',
    };
    result.narrativeSummary = buildNarrative(scenario, result);
    this.scenarios[idx] = { ...scenario, result };
    persistScenarios(this.scenarios);
    return { ...result };
  }

  getScenario(id: string): CounterfactualScenario | undefined {
    const s = this.scenarios.find((sc) => sc.id === id);
    return s ? { ...s, overrides: [...s.overrides] } : undefined;
  }

  listScenarios(): CounterfactualScenario[] {
    return this.scenarios.map((s) => ({ ...s, overrides: [...s.overrides] }));
  }
}

// ── Test seam ─────────────────────────────────────────────────────────

export function __resetCounterfactualReplaySingleton(): void {
  _instance = null;
  _idCounter = 0;
}

export const __internals = {
  STORAGE_KEY,
  MAX_SCENARIOS,
  computeCascadeScore,
  cascadeTier,
};
