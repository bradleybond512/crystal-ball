/**
 * Operational Playbook engine — structured response protocols
 * triggered automatically when v2 Situations match specific conditions.
 *
 * Distinct from src/services/intelligence/playbook-engine.ts (the
 * existing per-domain action library) — this module focuses on
 * *response* protocols: ordered step checklists with responsibility
 * assignments and progress tracking.
 *
 * Pure deterministic; no DOM, no fetch.
 */

import type { Situation, SituationSeverity } from './situation-store-v2';

// ── Public types ─────────────────────────────────────────────────────

export type StepStatus = 'pending' | 'in-progress' | 'complete' | 'skipped';
export type PlaybookStatus = 'active' | 'complete' | 'abandoned';
export type Responsible = 'analyst' | 'system' | 'external';

export interface PlaybookStep {
  id: string;
  order: number;
  action: string;
  responsible: Responsible;
  estimatedMinutes: number;
  status: StepStatus;
  completedAt?: number;
  notes?: string;
}

/** Shape used to author a template — instance steps are created from
 *  these on activation. Separate type so a template isn't mistakable
 *  for an instance. */
export interface PlaybookStepBlueprint {
  order: number;
  action: string;
  responsible: Responsible;
  estimatedMinutes: number;
}

export type ConditionField = 'domain' | 'severity' | 'correlationCount' | 'entityType';
export type ConditionOperator = 'eq' | 'gte' | 'lte' | 'contains';

export interface TriggerCondition {
  field: ConditionField;
  operator: ConditionOperator;
  value: unknown;
}

export interface PlaybookTemplate {
  id: string;
  name: string;
  domain: string;
  severity: string;
  triggerConditions: TriggerCondition[];
  stepBlueprints: PlaybookStepBlueprint[];
}

export interface Playbook {
  id: string;
  name: string;
  templateId: string;
  triggerConditions: TriggerCondition[];
  domain: string;
  severity: string;
  steps: PlaybookStep[];
  activatedAt: number;
  completedAt?: number;
  abandonedAt?: number;
  abandonReason?: string;
  situationId: string;
  status: PlaybookStatus;
}

export interface PlaybookStats {
  totalActivated: number;
  totalCompleted: number;
  avgCompletionMinutes: number;
  stepCompletionRate: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface OperationalPlaybookEngineOptions {
  templates?: PlaybookTemplate[];
  capacity?: number;
  storage?: StorageLike | null;
  now?: () => number;
}

const DEFAULT_CAPACITY = 50;
export const STORAGE_KEY = 'wm-operational-playbooks';

const SEVERITY_RANK: Record<string, number> = {
  low: 1, medium: 2, high: 3, critical: 4,
};

// ── Built-in templates ──────────────────────────────────────────────

export function builtInTemplates(): PlaybookTemplate[] {
  return [
    {
      id: 'earthquake-response',
      name: 'Earthquake response',
      domain: 'earthquake',
      severity: 'high',
      triggerConditions: [
        { field: 'domain', operator: 'eq', value: 'earthquake' },
        { field: 'severity', operator: 'gte', value: 'high' },
      ],
      stepBlueprints: [
        { order: 1, action: 'Verify epicenter against USGS feed', responsible: 'analyst',  estimatedMinutes: 5 },
        { order: 2, action: 'Trigger Storm Mode for affected saved places', responsible: 'system', estimatedMinutes: 1 },
        { order: 3, action: 'Notify household + pre-positioned contacts', responsible: 'system', estimatedMinutes: 2 },
        { order: 4, action: 'Monitor aftershock predictions (24h horizon)', responsible: 'analyst', estimatedMinutes: 60 },
        { order: 5, action: 'Coordinate with local emergency services if shaking >MMI VI', responsible: 'external', estimatedMinutes: 30 },
      ],
    },
    {
      id: 'biosurv-outbreak-response',
      name: 'Biosurveillance outbreak response',
      domain: 'biosurveillance',
      severity: 'high',
      triggerConditions: [
        { field: 'domain', operator: 'eq', value: 'biosurveillance' },
        { field: 'severity', operator: 'gte', value: 'high' },
      ],
      stepBlueprints: [
        { order: 1, action: 'Confirm wastewater spike with second lab', responsible: 'external', estimatedMinutes: 120 },
        { order: 2, action: 'Pull historical baseline for same region', responsible: 'analyst', estimatedMinutes: 15 },
        { order: 3, action: 'Cross-reference with aviation traffic for transit pattern', responsible: 'system', estimatedMinutes: 5 },
        { order: 4, action: 'Estimate R0 amplification window', responsible: 'analyst', estimatedMinutes: 30 },
        { order: 5, action: 'Notify household with PPE recommendations', responsible: 'system', estimatedMinutes: 1 },
      ],
    },
    {
      id: 'maritime-incident-response',
      name: 'Maritime incident response',
      domain: 'maritime',
      severity: 'high',
      triggerConditions: [
        { field: 'domain', operator: 'eq', value: 'maritime' },
        { field: 'severity', operator: 'gte', value: 'high' },
      ],
      stepBlueprints: [
        { order: 1, action: 'Confirm AIS position with LRIT / satellite RF', responsible: 'external', estimatedMinutes: 30 },
        { order: 2, action: 'Identify chokepoint and traffic-density impact', responsible: 'analyst', estimatedMinutes: 10 },
        { order: 3, action: 'Pull cargo manifests and flag-state registry', responsible: 'system', estimatedMinutes: 3 },
        { order: 4, action: 'Assess conflict-escalation risk near hostile waters', responsible: 'analyst', estimatedMinutes: 20 },
        { order: 5, action: 'Watchlist alerts for related vessel network', responsible: 'system', estimatedMinutes: 2 },
      ],
    },
    {
      id: 'aviation-emergency-response',
      name: 'Aviation emergency response',
      domain: 'aviation',
      severity: 'critical',
      triggerConditions: [
        { field: 'domain', operator: 'eq', value: 'aviation' },
        { field: 'severity', operator: 'gte', value: 'high' },
      ],
      stepBlueprints: [
        { order: 1, action: 'Pull squawk + ADS-B trail for affected aircraft', responsible: 'system', estimatedMinutes: 2 },
        { order: 2, action: 'Identify airspace-closure cascade risk', responsible: 'analyst', estimatedMinutes: 10 },
        { order: 3, action: 'Cross-check with severe-weather + space-weather', responsible: 'system', estimatedMinutes: 3 },
        { order: 4, action: 'Notify operations contact + flight-tracker subscribers', responsible: 'system', estimatedMinutes: 1 },
      ],
    },
    {
      id: 'cyber-infrastructure-response',
      name: 'Cyber-infrastructure incident response',
      domain: 'cyber',
      severity: 'high',
      triggerConditions: [
        { field: 'domain', operator: 'eq', value: 'cyber' },
        { field: 'severity', operator: 'gte', value: 'high' },
      ],
      stepBlueprints: [
        { order: 1, action: 'Verify CVSS score and KEV listing', responsible: 'system', estimatedMinutes: 2 },
        { order: 2, action: 'Identify affected systems in dependency graph', responsible: 'analyst', estimatedMinutes: 15 },
        { order: 3, action: 'Pull TTP consistency check against historical operator profile', responsible: 'analyst', estimatedMinutes: 30 },
        { order: 4, action: 'Coordinate with CISA / sector ISAC', responsible: 'external', estimatedMinutes: 60 },
        { order: 5, action: 'Snapshot for post-incident review', responsible: 'system', estimatedMinutes: 2 },
      ],
    },
    {
      id: 'severe-weather-response',
      name: 'Severe-weather response',
      domain: 'weather',
      severity: 'high',
      triggerConditions: [
        { field: 'domain', operator: 'eq', value: 'weather' },
        { field: 'severity', operator: 'gte', value: 'high' },
      ],
      stepBlueprints: [
        { order: 1, action: 'Verify NWS polygon vs saved places', responsible: 'system', estimatedMinutes: 1 },
        { order: 2, action: 'Activate Storm Mode payload for matched places', responsible: 'system', estimatedMinutes: 1 },
        { order: 3, action: 'Notify household with category-specific preparedness checklist', responsible: 'system', estimatedMinutes: 1 },
        { order: 4, action: 'Monitor intensification trend (pressure-fall, wind-shift)', responsible: 'analyst', estimatedMinutes: 60 },
        { order: 5, action: 'Coordinate with neighbors / community comms if Cat-3+', responsible: 'external', estimatedMinutes: 30 },
      ],
    },
  ];
}

// ── Engine ──────────────────────────────────────────────────────────

export class OperationalPlaybookEngine {
  private readonly capacity: number;
  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  private readonly templates: PlaybookTemplate[];
  private readonly byId = new Map<string, Playbook>();
  private readonly order: string[] = [];
  private readonly subscribers = new Set<(pb: Playbook) => void>();
  private idCounter = 0;

  constructor(opts: OperationalPlaybookEngineOptions = {}) {
    this.capacity = opts.capacity ?? DEFAULT_CAPACITY;
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.clock = opts.now ?? Date.now;
    this.templates = opts.templates ?? builtInTemplates();
    this.hydrate();
  }

  getTemplates(): readonly PlaybookTemplate[] {
    return this.templates;
  }

  evaluate(situation: Situation): Playbook | null {
    // Idempotent under repeated calls — one active playbook per situation.
    for (const pb of this.byId.values()) {
      if (pb.status === 'active' && pb.situationId === situation.id) return null;
    }
    const template = this.templates.find((t) => allConditionsMatch(t.triggerConditions, situation));
    if (!template) return null;

    const activatedAt = this.clock();
    const playbook: Playbook = {
      id: this.nextId('pb'),
      name: template.name,
      templateId: template.id,
      triggerConditions: template.triggerConditions,
      domain: template.domain,
      severity: template.severity,
      steps: [...template.stepBlueprints]
        .sort((a, b) => a.order - b.order)
        .map((bp) => ({
          id: this.nextId('step'),
          order: bp.order,
          action: bp.action,
          responsible: bp.responsible,
          estimatedMinutes: bp.estimatedMinutes,
          status: 'pending' as const,
        })),
      activatedAt,
      situationId: situation.id,
      status: 'active',
    };
    this.commit(playbook);
    this.notify(playbook);
    return playbook;
  }

  advanceStep(playbookId: string, stepId: string, notes?: string): void {
    const pb = this.byId.get(playbookId);
    if (pb?.status !== 'active') return;
    const stepIdx = pb.steps.findIndex((s) => s.id === stepId);
    if (stepIdx === -1) return;
    const step = pb.steps[stepIdx]!;
    const updated: PlaybookStep = {
      ...step,
      status: 'complete',
      completedAt: this.clock(),
      notes: notes ?? step.notes,
    };
    const nextSteps = [...pb.steps];
    nextSteps[stepIdx] = updated;
    this.commitProgress(pb, nextSteps);
  }

  skipStep(playbookId: string, stepId: string, reason: string): void {
    const pb = this.byId.get(playbookId);
    if (pb?.status !== 'active') return;
    const stepIdx = pb.steps.findIndex((s) => s.id === stepId);
    if (stepIdx === -1) return;
    const step = pb.steps[stepIdx]!;
    const updated: PlaybookStep = { ...step, status: 'skipped', notes: reason };
    const nextSteps = [...pb.steps];
    nextSteps[stepIdx] = updated;
    this.commitProgress(pb, nextSteps);
  }

  abandonPlaybook(playbookId: string, reason: string): void {
    const pb = this.byId.get(playbookId);
    if (pb?.status !== 'active') return;
    const updated: Playbook = {
      ...pb,
      status: 'abandoned',
      abandonedAt: this.clock(),
      abandonReason: reason,
    };
    this.byId.set(pb.id, updated);
    this.persist();
    this.notify(updated);
  }

  getAll(): Playbook[] {
    return [...this.byId.values()];
  }

  getActive(): Playbook[] {
    return this.getAll().filter((p) => p.status === 'active');
  }

  getCompleted(): Playbook[] {
    return this.getAll().filter((p) => p.status === 'complete');
  }

  stats(): PlaybookStats {
    const all = this.getAll();
    const completed = all.filter((p) => p.status === 'complete');
    let totalDurationMs = 0;
    for (const pb of completed) {
      const end = pb.completedAt ?? pb.activatedAt;
      totalDurationMs += Math.max(0, end - pb.activatedAt);
    }
    const avgCompletionMinutes = completed.length === 0
      ? 0
      : Number(((totalDurationMs / completed.length) / 60_000).toFixed(2));

    let totalSteps = 0;
    let completedSteps = 0;
    for (const pb of all) {
      for (const step of pb.steps) {
        totalSteps++;
        if (step.status === 'complete') completedSteps++;
      }
    }
    return {
      totalActivated: all.length,
      totalCompleted: completed.length,
      avgCompletionMinutes,
      stepCompletionRate: totalSteps === 0 ? 0 : Number((completedSteps / totalSteps).toFixed(4)),
    };
  }

  subscribe(cb: (pb: Playbook) => void): () => void {
    this.subscribers.add(cb);
    return () => { this.subscribers.delete(cb); };
  }

  unsubscribe(cb: (pb: Playbook) => void): void {
    this.subscribers.delete(cb);
  }

  clear(): void {
    this.byId.clear();
    this.order.length = 0;
    this.persist();
  }

  // ── Internals ─────────────────────────────────────────────────────

  private commitProgress(pb: Playbook, nextSteps: PlaybookStep[]): void {
    const allDone = nextSteps.every((s) => s.status === 'complete' || s.status === 'skipped');
    const updated: Playbook = {
      ...pb,
      steps: nextSteps,
      status: allDone ? 'complete' : 'active',
      completedAt: allDone ? this.clock() : pb.completedAt,
    };
    this.byId.set(pb.id, updated);
    this.persist();
    this.notify(updated);
  }

  private commit(pb: Playbook): void {
    this.byId.set(pb.id, pb);
    this.order.push(pb.id);
    while (this.order.length > this.capacity) {
      const evict = this.order.shift();
      if (evict !== undefined) this.byId.delete(evict);
    }
    this.persist();
  }

  private notify(pb: Playbook): void {
    for (const cb of this.subscribers) cb(pb);
  }

  private nextId(prefix: string): string {
    this.idCounter++;
    return `${prefix}-${this.clock()}-${this.idCounter}`;
  }

  private hydrate(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Playbook[];
      if (!Array.isArray(parsed)) return;
      for (const pb of parsed) {
        if (!this.byId.has(pb.id)) this.order.push(pb.id);
        this.byId.set(pb.id, pb);
      }
    } catch {
      this.byId.clear();
      this.order.length = 0;
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      const serial: Playbook[] = [];
      for (const id of this.order) {
        const pb = this.byId.get(id);
        if (pb) serial.push(pb);
      }
      this.storage.setItem(STORAGE_KEY, JSON.stringify(serial));
    } catch {
      // Storage failures are non-fatal.
    }
  }
}

// ── Lazy singleton ──────────────────────────────────────────────────

let singleton: OperationalPlaybookEngine | undefined;

export function getOperationalPlaybookEngine(): OperationalPlaybookEngine {
  singleton ??= new OperationalPlaybookEngine();
  return singleton;
}

export function resetForTests(): void {
  singleton = undefined;
}

// ── Trigger evaluation ──────────────────────────────────────────────

function allConditionsMatch(conditions: readonly TriggerCondition[], situation: Situation): boolean {
  if (conditions.length === 0) return true;
  return conditions.every((c) => matchCondition(c, situation));
}

function matchCondition(condition: TriggerCondition, situation: Situation): boolean {
  switch (condition.field) {
    case 'domain': {
      return matchDomain(condition.operator, condition.value, situation.domain);
    }
    case 'severity': {
      return matchSeverity(condition.operator, condition.value, situation.severity);
    }
    case 'correlationCount': {
      return matchNumeric(condition.operator, condition.value, situation.edges.length);
    }
    case 'entityType': {
      return matchEntityType(condition.operator, condition.value, situation.entityIds);
    }
  }
}

function matchDomain(op: ConditionOperator, value: unknown, domain: string): boolean {
  if (typeof value !== 'string') return false;
  if (op === 'eq') return domain === value;
  if (op === 'contains') return domain.includes(value);
  return false;
}

function matchSeverity(op: ConditionOperator, value: unknown, severity: SituationSeverity): boolean {
  if (typeof value !== 'string') return false;
  const targetRank = SEVERITY_RANK[value];
  if (targetRank === undefined) return false;
  const actualRank = SEVERITY_RANK[severity] ?? 0;
  if (op === 'eq') return actualRank === targetRank;
  if (op === 'gte') return actualRank >= targetRank;
  if (op === 'lte') return actualRank <= targetRank;
  return false;
}

function matchNumeric(op: ConditionOperator, value: unknown, actual: number): boolean {
  if (typeof value !== 'number') return false;
  if (op === 'eq') return actual === value;
  if (op === 'gte') return actual >= value;
  if (op === 'lte') return actual <= value;
  return false;
}

function matchEntityType(op: ConditionOperator, value: unknown, entityIds: readonly string[]): boolean {
  if (typeof value !== 'string') return false;
  if (op === 'contains') return entityIds.some((id) => id.includes(value));
  if (op === 'eq') return entityIds.includes(value);
  return false;
}

function defaultStorage(): StorageLike | null {
  if (typeof globalThis === 'undefined') return null;
  const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
  return ls ?? null;
}
