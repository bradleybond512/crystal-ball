/**
 * OperationalPlaybookLibrary — human-facing SOP library.
 *
 * Distinct from:
 *   • src/services/intelligence/playbook-engine.ts (PR #417) — automated
 *     response rules triggered by event signatures.
 *   • src/services/intelligence/operational-playbook.ts — Situation-driven
 *     automated checklist engine with TriggerCondition matching.
 *
 * This library exposes a static catalog of operator-facing step-by-step
 * procedures (one per crisis domain) plus a lightweight execution
 * lifecycle so an operator can walk through a playbook, tick off steps,
 * and either complete or abort the run.
 *
 * Pure deterministic; no DOM, no fetch. Storage is injected via a
 * StorageLike port so tests can pin behaviour without touching
 * localStorage.
 */

// ── Public types ─────────────────────────────────────────────────────

export type PlaybookSeverity = 'low' | 'medium' | 'high' | 'critical';
export type ExecutionStatus = 'active' | 'completed' | 'aborted';

export interface PlaybookStep {
  order: number;
  action: string;
  responsible: string;
  timeoutMinutes: number;
  notes?: string;
}

export interface OperationalPlaybook {
  id: string;
  domain: string;
  triggerCondition: string;
  title: string;
  severity: PlaybookSeverity;
  steps: PlaybookStep[];
  estimatedMinutes: number;
  lastUpdated: number;
}

export interface PlaybookExecution {
  id: string;
  playbookId: string;
  startedAt: number;
  completedSteps: number[];
  status: ExecutionStatus;
}

// ── Storage port ─────────────────────────────────────────────────────

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// ── Constants ────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-operational-playbooks';
export const MAX_TOTAL_PLAYBOOKS = 100;

// ── Built-in playbooks ───────────────────────────────────────────────
//
// Eight seeded crisis-domain SOPs. Step counts and timeouts are tuned
// to be useful in the first hour of response rather than exhaustive —
// the library is a starting checklist, not a substitute for trained
// incident command. `lastUpdated` is a static epoch (2026-05-01) so
// the catalog is stable across rebuilds and tests can assert equality.

const SEEDED_AT = Date.parse('2026-05-01T00:00:00Z');

const BUILT_IN_PLAYBOOKS: readonly OperationalPlaybook[] = [
  {
    id: 'earthquake-response',
    domain: 'natural_disaster',
    triggerCondition: 'M >= 5.5 within 200km of populated area OR USGS PAGER yellow+',
    title: 'Earthquake response',
    severity: 'high',
    estimatedMinutes: 90,
    lastUpdated: SEEDED_AT,
    steps: [
      { order: 1, action: 'Confirm magnitude, depth, epicenter from USGS + EMSC',          responsible: 'analyst',  timeoutMinutes: 5 },
      { order: 2, action: 'Check ShakeMap MMI overlay against saved-places watchlist',     responsible: 'analyst',  timeoutMinutes: 5 },
      { order: 3, action: 'Pull PAGER fatality + economic loss estimates',                  responsible: 'analyst',  timeoutMinutes: 5 },
      { order: 4, action: 'Cross-check tsunami warning bulletins (PTWC, JMA)',             responsible: 'analyst',  timeoutMinutes: 10 },
      { order: 5, action: 'Notify on-call lead if PAGER yellow+ or saved-place inside MMI VII', responsible: 'analyst',  timeoutMinutes: 5 },
      { order: 6, action: 'Stand up situation room channel + pin initial brief',           responsible: 'analyst',  timeoutMinutes: 10 },
      { order: 7, action: 'Schedule 30-minute aftershock + damage recheck cadence',        responsible: 'system',   timeoutMinutes: 5 },
    ],
  },
  {
    id: 'cyber-incident',
    domain: 'cyber',
    triggerCondition: 'CISA KEV exploit observed against owned ASN or CVSS >= 9.0 on prod surface',
    title: 'Cyber incident response',
    severity: 'critical',
    estimatedMinutes: 120,
    lastUpdated: SEEDED_AT,
    steps: [
      { order: 1, action: 'Triage alert — confirm true-positive vs. tuning artefact',                 responsible: 'analyst',  timeoutMinutes: 10 },
      { order: 2, action: 'Open IR ticket; assign severity SEV-1/2/3 per runbook',                    responsible: 'analyst',  timeoutMinutes: 5 },
      { order: 3, action: 'Snapshot affected hosts + capture volatile memory before containment',     responsible: 'analyst',  timeoutMinutes: 15 },
      { order: 4, action: 'Isolate affected hosts at network layer (do not power off)',               responsible: 'system',   timeoutMinutes: 10 },
      { order: 5, action: 'Rotate credentials with blast radius to affected segment',                 responsible: 'analyst',  timeoutMinutes: 20 },
      { order: 6, action: 'Notify legal + comms if PII / regulated data may be exposed',              responsible: 'external', timeoutMinutes: 15 },
      { order: 7, action: 'File initial incident timeline; assign forensics owner',                    responsible: 'analyst',  timeoutMinutes: 15 },
      { order: 8, action: 'Stand up daily standup until eradication confirmed',                        responsible: 'analyst',  timeoutMinutes: 30, notes: 'Skip if scope contained within 4 hours.' },
    ],
  },
  {
    id: 'pandemic-escalation',
    domain: 'biosurveillance',
    triggerCondition: 'WHO PHEIC OR ProMED unverified cluster + wastewater RNA z-score > 2',
    title: 'Pandemic escalation',
    severity: 'critical',
    estimatedMinutes: 180,
    lastUpdated: SEEDED_AT,
    steps: [
      { order: 1, action: 'Confirm signal across ≥2 independent sources (WHO, ProMED, GISAID, wastewater)', responsible: 'analyst',  timeoutMinutes: 15 },
      { order: 2, action: 'Classify by ProMED outbreak phase + R0 estimate if available',                    responsible: 'analyst',  timeoutMinutes: 20 },
      { order: 3, action: 'Identify geographic spread + travel-link risk to home region',                    responsible: 'analyst',  timeoutMinutes: 20 },
      { order: 4, action: 'Audit PPE + test inventory; flag depletion timelines',                            responsible: 'external', timeoutMinutes: 30 },
      { order: 5, action: 'Brief leadership; recommend escalation tier (monitor / prepare / activate)',      responsible: 'analyst',  timeoutMinutes: 20 },
      { order: 6, action: 'Open daily sitrep cadence with HHS / state health authority',                     responsible: 'external', timeoutMinutes: 30 },
      { order: 7, action: 'Schedule 12-hour signal recheck + sequence-data pull',                            responsible: 'system',   timeoutMinutes: 15 },
      { order: 8, action: 'Pre-stage public communications draft for tier upgrade',                          responsible: 'analyst',  timeoutMinutes: 30 },
    ],
  },
  {
    id: 'severe-weather',
    domain: 'weather',
    triggerCondition: 'NWS Warning (Tornado / Severe Thunderstorm / Flash Flood) intersects saved-place polygon',
    title: 'Severe weather response',
    severity: 'high',
    estimatedMinutes: 60,
    lastUpdated: SEEDED_AT,
    steps: [
      { order: 1, action: 'Confirm polygon intersect + UGC zone match for each saved place',  responsible: 'analyst', timeoutMinutes: 5 },
      { order: 2, action: 'Cross-check radar reflectivity + storm-relative velocity',          responsible: 'analyst', timeoutMinutes: 5 },
      { order: 3, action: 'Fire Storm Mode payload to push notifier (deduped per warning ID)', responsible: 'system',  timeoutMinutes: 2 },
      { order: 4, action: 'Verify shelter / drive-route guidance is current for affected place', responsible: 'analyst', timeoutMinutes: 10 },
      { order: 5, action: 'Monitor for warning extensions + new polygons',                       responsible: 'analyst', timeoutMinutes: 30 },
      { order: 6, action: 'Issue all-clear when expiration passes + radar quiets',               responsible: 'analyst', timeoutMinutes: 5 },
    ],
  },
  {
    id: 'maritime-incident',
    domain: 'maritime',
    triggerCondition: 'AIS gap > 6h in chokepoint OR vessel collision/grounding reported',
    title: 'Maritime incident response',
    severity: 'medium',
    estimatedMinutes: 75,
    lastUpdated: SEEDED_AT,
    steps: [
      { order: 1, action: 'Confirm vessel identity from AISStream + MarineTraffic crosscheck',     responsible: 'analyst',  timeoutMinutes: 10 },
      { order: 2, action: 'Pull last-known position + heading + draft from cached AIS history',   responsible: 'analyst',  timeoutMinutes: 5 },
      { order: 3, action: 'Check chokepoint freight-stress score and queue-length deltas',         responsible: 'analyst',  timeoutMinutes: 10 },
      { order: 4, action: 'Estimate cargo type + downstream commodity-supply impact',              responsible: 'analyst',  timeoutMinutes: 15 },
      { order: 5, action: 'Notify maritime-domain watch officer if Hormuz/Suez/Bosphorus involved', responsible: 'external', timeoutMinutes: 10 },
      { order: 6, action: 'Open delta-watch with hourly position polls until resolved',            responsible: 'system',   timeoutMinutes: 25 },
    ],
  },
  {
    id: 'civil-unrest',
    domain: 'conflict',
    triggerCondition: 'ACLED political-violence cluster within 50km of saved-place OR State Dept advisory ≥ 3',
    title: 'Civil unrest response',
    severity: 'high',
    estimatedMinutes: 90,
    lastUpdated: SEEDED_AT,
    steps: [
      { order: 1, action: 'Confirm event count, fatality count, actor list from ACLED',              responsible: 'analyst',  timeoutMinutes: 10 },
      { order: 2, action: 'Cross-check UCDP + GDELT for corroboration',                              responsible: 'analyst',  timeoutMinutes: 10 },
      { order: 3, action: 'Map geographic spread vs. saved-place radius',                            responsible: 'analyst',  timeoutMinutes: 10 },
      { order: 4, action: 'Pull current State Dept / FCDO travel advisories',                        responsible: 'analyst',  timeoutMinutes: 5 },
      { order: 5, action: 'Identify any in-region personnel + last-known contact',                   responsible: 'external', timeoutMinutes: 20 },
      { order: 6, action: 'Recommend movement-restriction or evacuation posture to leadership',      responsible: 'analyst',  timeoutMinutes: 20 },
      { order: 7, action: 'Schedule 6-hour recheck cadence until cluster intensity drops',           responsible: 'system',   timeoutMinutes: 15 },
    ],
  },
  {
    id: 'infrastructure-failure',
    domain: 'infrastructure',
    triggerCondition: 'Accepted, unexpired ORNL ODIN reports > 50k customers out for the active saved-place county OR BGP hijack on critical prefix OR ISP outage > 30 min',
    title: 'Infrastructure failure response',
    severity: 'high',
    estimatedMinutes: 60,
    lastUpdated: SEEDED_AT,
    steps: [
      { order: 1, action: 'Confirm scope from primary feed + at-least-one independent source',       responsible: 'analyst',  timeoutMinutes: 10 },
      { order: 2, action: 'Identify dependent services + saved-place utility exposure',              responsible: 'analyst',  timeoutMinutes: 10 },
      { order: 3, action: 'Estimate restoration ETA from utility / NOC postings',                    responsible: 'analyst',  timeoutMinutes: 15 },
      { order: 4, action: 'Trigger fallback runbooks for cascading dependencies (DNS, CDN, payments)', responsible: 'system',   timeoutMinutes: 10 },
      { order: 5, action: 'Push notify affected operators with ETA + workaround guidance',            responsible: 'system',   timeoutMinutes: 5 },
      { order: 6, action: 'Capture post-incident artefacts for the weekly review',                    responsible: 'analyst',  timeoutMinutes: 10 },
    ],
  },
  {
    id: 'financial-contagion',
    domain: 'finance',
    triggerCondition: 'VIX > 35 sustained 2h OR major bank CDS spike > 200bps OR sovereign yield blow-out',
    title: 'Financial contagion response',
    severity: 'critical',
    estimatedMinutes: 150,
    lastUpdated: SEEDED_AT,
    steps: [
      { order: 1, action: 'Confirm VIX / CDS / credit-spread reading from ≥2 venues',                responsible: 'analyst',  timeoutMinutes: 10 },
      { order: 2, action: 'Identify originating instrument + counterparty exposure map',             responsible: 'analyst',  timeoutMinutes: 20 },
      { order: 3, action: 'Pull funding-stress signals (SOFR-IOER, FX swap basis, GC repo)',         responsible: 'analyst',  timeoutMinutes: 20 },
      { order: 4, action: 'Cross-check Fed / ECB / BoE liquidity-operations posture',                responsible: 'analyst',  timeoutMinutes: 15 },
      { order: 5, action: 'Brief portfolio leads on tier (watch / de-risk / hedge) recommendation',  responsible: 'external', timeoutMinutes: 25 },
      { order: 6, action: 'Open hourly recheck cadence until volatility decays',                     responsible: 'system',   timeoutMinutes: 30 },
      { order: 7, action: 'Pre-stage client communication draft for tier upgrade',                   responsible: 'analyst',  timeoutMinutes: 30 },
    ],
  },
];

// ── Service ──────────────────────────────────────────────────────────

export class OperationalPlaybookLibrary {
  private static _singleton: OperationalPlaybookLibrary | null = null;

  private custom: OperationalPlaybook[] = [];
  private executions = new Map<string, PlaybookExecution>();
  private storage: StorageLike;
  private hydrated = false;
  private executionCounter = 0;

  private constructor(
    storage: StorageLike = (globalThis as { localStorage?: StorageLike }).localStorage ?? nullStorage(),
  ) {
    this.storage = storage;
  }

  static getInstance(): OperationalPlaybookLibrary {
    OperationalPlaybookLibrary._singleton ??= new OperationalPlaybookLibrary();
    return OperationalPlaybookLibrary._singleton;
  }

  /** Build an isolated instance with a caller-supplied storage port — used by tests. */
  static createForTesting(storage: StorageLike): OperationalPlaybookLibrary {
    return new OperationalPlaybookLibrary(storage);
  }

  /** Drop the module-level singleton so subsequent getInstance() calls rebuild it. Tests only. */
  static _resetForTests(): void {
    OperationalPlaybookLibrary._singleton = null;
  }

  // ── Catalog ────────────────────────────────────────────────────────

  /** Return all known playbooks (built-ins first, custom last). When `domain` is supplied
   *  the result is filtered to playbooks whose `domain` matches exactly. */
  getPlaybooks(domain?: string): OperationalPlaybook[] {
    this.ensureHydrated();
    const all = [...BUILT_IN_PLAYBOOKS, ...this.custom];
    const matching = domain === undefined ? all : all.filter((p) => p.domain === domain);
    return matching.map((p) => clonePlaybook(p));
  }

  /** Return a single playbook by id (or null). Defensive copy — callers cannot mutate the catalog. */
  getPlaybook(id: string): OperationalPlaybook | null {
    this.ensureHydrated();
    const found = this.findPlaybook(id);
    return found ? clonePlaybook(found) : null;
  }

  /** Add a custom playbook to the library. Throws on id collision with a built-in or another custom entry. */
  addPlaybook(playbook: OperationalPlaybook): void {
    this.ensureHydrated();
    if (!isValidPlaybook(playbook)) {
      throw new Error('OperationalPlaybookLibrary: playbook fails shape validation');
    }
    if (this.findPlaybook(playbook.id)) {
      throw new Error(`OperationalPlaybookLibrary: playbook id "${playbook.id}" already exists`);
    }
    this.custom.push(clonePlaybook(playbook));
    this.enforceMaxCap();
    this.persist();
  }

  // ── Execution lifecycle ────────────────────────────────────────────

  /** Start a new execution for the given playbook. Throws if the playbook id is unknown. */
  startExecution(playbookId: string): PlaybookExecution {
    this.ensureHydrated();
    const playbook = this.findPlaybook(playbookId);
    if (!playbook) {
      throw new Error(`OperationalPlaybookLibrary: unknown playbookId "${playbookId}"`);
    }
    this.executionCounter += 1;
    const execution: PlaybookExecution = {
      id: `exec-${Date.now()}-${this.executionCounter}`,
      playbookId,
      startedAt: Date.now(),
      completedSteps: [],
      status: 'active',
    };
    this.executions.set(execution.id, execution);
    return cloneExecution(execution);
  }

  /** Mark a step as completed. Idempotent — completing the same step twice is a no-op.
   *  Throws on unknown execution, unknown step order, or non-active execution. Auto-transitions
   *  to `completed` when every step of the playbook has been ticked off. */
  completeStep(executionId: string, stepOrder: number): PlaybookExecution {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error(`OperationalPlaybookLibrary: unknown executionId "${executionId}"`);
    }
    if (execution.status !== 'active') {
      throw new Error(`OperationalPlaybookLibrary: execution "${executionId}" is ${execution.status}; cannot complete steps`);
    }
    const playbook = this.findPlaybook(execution.playbookId);
    if (!playbook) {
      throw new Error(`OperationalPlaybookLibrary: execution refers to unknown playbookId "${execution.playbookId}"`);
    }
    const stepExists = playbook.steps.some((s) => s.order === stepOrder);
    if (!stepExists) {
      throw new Error(`OperationalPlaybookLibrary: step order ${stepOrder} not in playbook "${playbook.id}"`);
    }
    if (!execution.completedSteps.includes(stepOrder)) {
      execution.completedSteps.push(stepOrder);
      execution.completedSteps.sort((a, b) => a - b);
    }
    if (execution.completedSteps.length === playbook.steps.length) {
      execution.status = 'completed';
    }
    return cloneExecution(execution);
  }

  /** Mark an execution as aborted. Idempotent on already-aborted executions; throws if the execution
   *  is unknown or already completed (completed runs are terminal). */
  abortExecution(executionId: string): PlaybookExecution {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error(`OperationalPlaybookLibrary: unknown executionId "${executionId}"`);
    }
    if (execution.status === 'completed') {
      throw new Error(`OperationalPlaybookLibrary: execution "${executionId}" already completed; cannot abort`);
    }
    execution.status = 'aborted';
    return cloneExecution(execution);
  }

  /** Look up a single execution. */
  getExecution(executionId: string): PlaybookExecution | null {
    const e = this.executions.get(executionId);
    return e ? cloneExecution(e) : null;
  }

  /** Snapshot of every execution currently tracked by this instance. */
  listExecutions(): PlaybookExecution[] {
    return [...this.executions.values()].map((e) => cloneExecution(e));
  }

  // ── Internal helpers ───────────────────────────────────────────────

  private findPlaybook(id: string): OperationalPlaybook | undefined {
    const builtin = BUILT_IN_PLAYBOOKS.find((p) => p.id === id);
    if (builtin) return builtin;
    return this.custom.find((p) => p.id === id);
  }

  private enforceMaxCap(): void {
    const maxCustom = MAX_TOTAL_PLAYBOOKS - BUILT_IN_PLAYBOOKS.length;
    while (this.custom.length > maxCustom) {
      this.custom.shift();
    }
  }

  private persist(): void {
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.custom));
    } catch {
      // storage unavailable — continue without persistence
    }
  }

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(STORAGE_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(parsed)) return;
    for (const entry of parsed) {
      if (isValidPlaybook(entry)) {
        // Skip persisted entries that collide with a built-in id — built-ins win.
        if (BUILT_IN_PLAYBOOKS.some((b) => b.id === entry.id)) continue;
        this.custom.push(entry);
      }
    }
  }
}

// ── Shape validation ─────────────────────────────────────────────────

const SEVERITIES: ReadonlySet<PlaybookSeverity> = new Set(['low', 'medium', 'high', 'critical']);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isValidStep(raw: unknown, seenOrders: Set<number>): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const s = raw as Record<string, unknown>;
  if (typeof s.order !== 'number' || !Number.isInteger(s.order) || s.order < 1) return false;
  if (seenOrders.has(s.order)) return false;
  seenOrders.add(s.order);
  if (!isNonEmptyString(s.action)) return false;
  if (!isNonEmptyString(s.responsible)) return false;
  if (!isNonNegativeFiniteNumber(s.timeoutMinutes)) return false;
  if (s.notes !== undefined && typeof s.notes !== 'string') return false;
  return true;
}

function hasValidPlaybookHeader(p: Record<string, unknown>): boolean {
  if (!isNonEmptyString(p.id)) return false;
  if (!isNonEmptyString(p.domain)) return false;
  if (typeof p.triggerCondition !== 'string') return false;
  if (!isNonEmptyString(p.title)) return false;
  if (typeof p.severity !== 'string' || !SEVERITIES.has(p.severity as PlaybookSeverity)) return false;
  if (!isNonNegativeFiniteNumber(p.estimatedMinutes)) return false;
  if (typeof p.lastUpdated !== 'number' || !Number.isFinite(p.lastUpdated)) return false;
  return true;
}

function isValidPlaybook(value: unknown): value is OperationalPlaybook {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  if (!hasValidPlaybookHeader(p)) return false;
  if (!Array.isArray(p.steps) || p.steps.length === 0) return false;
  const orders = new Set<number>();
  for (const raw of p.steps) {
    if (!isValidStep(raw, orders)) return false;
  }
  return true;
}

// ── Defensive copy helpers ───────────────────────────────────────────

function clonePlaybook(p: OperationalPlaybook): OperationalPlaybook {
  return {
    ...p,
    steps: p.steps.map((s) => ({ ...s })),
  };
}

function cloneExecution(e: PlaybookExecution): PlaybookExecution {
  return {
    ...e,
    completedSteps: [...e.completedSteps],
  };
}

// ── Null storage fallback ────────────────────────────────────────────

function nullStorage(): StorageLike {
  return {
    getItem: () => null,
    setItem: () => undefined,
  };
}
