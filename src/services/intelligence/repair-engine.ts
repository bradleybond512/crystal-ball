/**
 * Autonomous Repair Recommendations (Phase 4).
 *
 * Translates safety-case failures and DomainScorecard component drops
 * into ordered, step-by-step repair recommendations. The output is
 * never a vague "something is wrong" — it's "here is what to do about
 * it" with specific actions and an estimated impact.
 *
 * Inputs:
 *   - `SafetyCase` (local interface — keep in sync with the eventual
 *     `safety-case.ts` module when it lands)
 *   - `DomainScorecard` from `./domain-scorecard` (live)
 *
 * Outputs: `RepairRecommendation[]` persisted in localStorage so the
 * panel can re-render across renders/reloads.
 *
 * Pure module: no DOM / fetch / globals at import time.
 */

import type { DomainScorecard } from './domain-scorecard';

// ── Public types ──────────────────────────────────────────────────────

export type RepairPriority = 'critical' | 'high' | 'medium' | 'low';
export type RepairStatus = 'open' | 'in-progress' | 'resolved' | 'dismissed';

export interface RepairAction {
  id: string;
  step: number;
  description: string;
  automated: boolean;
  automationFn?: string;
}

export interface RepairRecommendation {
  id: string;
  title: string;
  summary: string;
  triggerSource: string;
  domain?: string;
  priority: RepairPriority;
  actions: RepairAction[];
  estimatedImpact: string;
  status: RepairStatus;
  createdAt: Date;
  resolvedAt?: Date;
  dismissedReason?: string;
}

export interface RepairStats {
  open: number;
  inProgress: number;
  resolved: number;
  dismissed: number;
  byPriority: Record<RepairPriority, number>;
}

// ── SafetyCase contract (local until safety-case.ts lands) ──────────

/** Property-level verdict in a safety case. Matches the four-state
 *  ladder the eventual safety-case module is documented to emit. */
export type SafetyVerdict = 'pass' | 'warn' | 'fail' | 'unknown';

/** Canonical property ids used by the safety case. Listed here so
 *  the repair engine knows which template to apply. New properties
 *  can be added without breaking generation — they fall through to
 *  the generic template. */
export type SafetyPropertyId =
  | 'ACCURACY'
  | 'BIAS-FREE'
  | 'ASSUMPTIONS-DISCLOSED'
  | 'ALERT-BUDGET'
  | 'FEED-COVERAGE'
  | 'FALSE-POSITIVE-RATE'
  | 'HUMAN-IN-LOOP'
  | 'ALGORITHM-STABLE';

export interface SafetyProperty {
  /** A SafetyPropertyId from the documented set, or any future
   *  property id the safety case introduces. */
  id: string;
  verdict: SafetyVerdict;
  /** Free-text rationale shown to the user. Optional; repair engine
   *  uses it as fallback summary text when no template-specific
   *  language is available. */
  reason?: string;
}

export interface SafetyCase {
  generatedAt: Date;
  properties: readonly SafetyProperty[];
}

export type RepairListener = (recommendation: RepairRecommendation) => void;

// ── Constants ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'wm-repair-recommendations';
const MAX_RECOMMENDATIONS = 200;
const SCORECARD_COMPONENT_THRESHOLD = 0.5;

const PRIORITY_RANK: Record<RepairPriority, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

// ── Action templates per safety property ───────────────────────────

interface ActionTemplate {
  description: string;
  automated?: boolean;
  automationFn?: string;
}

interface SafetyTemplate {
  title: string;
  summary: string;
  estimatedImpact: string;
  actions: readonly ActionTemplate[];
}

const SAFETY_TEMPLATES: Partial<Record<SafetyPropertyId, { fail?: SafetyTemplate; warn?: SafetyTemplate }>> = {
  ACCURACY: {
    fail: {
      title: 'Accuracy below threshold',
      summary: 'The system is mispredicting more often than the calibrated baseline allows. Review the worst-performing domains and tighten the trust budget.',
      estimatedImpact: 'Expected to improve accuracy by ~15%',
      actions: [
        { description: 'Review dismissed alerts in OutcomeLedger past 7d' },
        { description: 'Identify domains with lowest accuracy in AlgoEvalLedger' },
        { description: 'Lower trust budget quotas for worst-performing domains' },
      ],
    },
  },
  'BIAS-FREE': {
    fail: {
      title: 'Bias detected in alert distribution',
      summary: 'Bias scan flagged non-random distribution across domains, sources, or geographies. Acknowledge the signal and re-scan after a settle window.',
      estimatedImpact: 'Restores bias-free property within one re-scan cycle',
      actions: [
        { description: 'Open BiasDetectionPanel and review flagged dimensions' },
        { description: "Acknowledge all 'alert' signals" },
        { description: 'Re-run bias scan after 1h' },
      ],
    },
  },
  'ASSUMPTIONS-DISCLOSED': {
    fail: {
      title: 'Critical assumptions undisclosed',
      summary: 'Outputs depend on assumptions that have not been surfaced to the operator. Walk the assumption ledger and patch the missing inputs.',
      estimatedImpact: 'Closes assumption coverage gap within one review pass',
      actions: [
        { description: 'Open AssumptionPanel and group by violationRisk=high' },
        { description: 'Review all critical assumptions with high violation risk' },
        { description: 'Add missing data sources for flagged domains' },
      ],
    },
    warn: {
      title: 'Some assumptions still implicit',
      summary: 'Most outputs are documented but a few critical assumptions remain implicit. Sweep the affected domains.',
      estimatedImpact: 'Improves transparency for affected downstream outputs',
      actions: [
        { description: 'Open AssumptionPanel and filter to status=open' },
        { description: 'Walk the high-risk critical assumptions' },
        { description: 'Document or annotate the remaining implicit ones' },
      ],
    },
  },
  'ALERT-BUDGET': {
    fail: {
      title: 'Alert budget exhausted',
      summary: 'Per-domain or global alert quotas are saturating, causing meaningful events to be throttled. Rebalance the quotas.',
      estimatedImpact: 'Restores alert headroom for under-quota domains within minutes',
      actions: [
        { description: 'Open TrustBudgetPanel and identify chronically exhausted domains' },
        { description: 'Raise global rate limit or reduce per-domain quotas' },
        { description: 'Verify recovery by watching the next hour of trust-budget output' },
      ],
    },
  },
  'FEED-COVERAGE': {
    fail: {
      title: 'Feed coverage degraded — operator action required',
      summary: 'One or more primary feeds is down with no live fallback. Immediate action needed before downstream calibration degrades.',
      estimatedImpact: 'Restores ingestion for affected domains as soon as fallback is enabled',
      actions: [
        { description: 'Immediately check the degraded feed config in SystemDiagnosticPanel' },
        { description: 'Enable fallback sources for the failing feed' },
        { description: 'Alert the operator if no fallback is available' },
      ],
    },
    warn: {
      title: 'Feed coverage warning',
      summary: 'A non-primary feed is degraded. Verify before it slips into a fail state.',
      estimatedImpact: 'Prevents the warn condition from escalating to fail',
      actions: [
        { description: 'Check feed health in SystemDiagnosticPanel' },
        { description: 'Verify API keys for degraded feeds' },
      ],
    },
  },
  'FALSE-POSITIVE-RATE': {
    fail: {
      title: 'False-positive rate above ceiling',
      summary: 'Operators are dismissing alerts at an unsustainable rate. Tighten the high-FP domains before trust erodes.',
      estimatedImpact: 'Reduces dismissed-alert rate by ~20% on next calibration cycle',
      actions: [
        { description: 'Review dismissed alerts in OutcomeLedger for the top-FP domains' },
        { description: 'Reduce severity thresholds for the high-FP domains' },
        { description: 'Consider retiring underperforming shadow algorithms' },
      ],
    },
  },
  'HUMAN-IN-LOOP': {
    fail: {
      title: 'Human review backlog blocking outputs',
      summary: 'Outputs flagged for human review are piling up. Drain the queue or relax the gating threshold.',
      estimatedImpact: 'Clears the review backlog within the next session',
      actions: [
        { description: 'Open ActiveLearningPanel' },
        { description: 'Review the top 5 highest-uncertainty items' },
        { description: 'Skip items older than 12h if their context is stale' },
      ],
    },
    warn: {
      title: 'Human review queue growing',
      summary: 'The review queue is trending upward. Drain a few items before it becomes a blocker.',
      estimatedImpact: 'Holds review queue size flat over the next 24h',
      actions: [
        { description: 'Open ActiveLearningPanel' },
        { description: 'Review the top 3 highest-uncertainty items' },
      ],
    },
  },
  'ALGORITHM-STABLE': {
    fail: {
      title: 'Algorithm output drifting',
      summary: 'One or more production algorithms is producing unstable scores across recent runs. Backtest before promoting any further changes.',
      estimatedImpact: 'Identifies the source of drift before it reaches production',
      actions: [
        { description: 'Open AlgoEvalPanel and identify the degrading algorithms' },
        { description: 'Run a backtest with the current parameters' },
        { description: 'Consider rolling back recent parameter changes' },
      ],
    },
  },
};

// ── Component → template + impact map for scorecards ────────────────

type ScorecardComponentKey = keyof DomainScorecard['components'];

interface ComponentTemplate {
  title: (domain: string) => string;
  summary: (domain: string, score: number) => string;
  estimatedImpact: string;
  actions: readonly ActionTemplate[];
}

const SCORECARD_COMPONENT_TEMPLATES: Record<ScorecardComponentKey, ComponentTemplate> = {
  outcomeQuality: {
    title: (domain) => `${domain}: outcome quality below threshold`,
    summary: (domain, score) => `Outcome quality for ${domain} is ${(score * 100).toFixed(0)}%. Operators are rejecting or correcting outputs more often than the baseline allows.`,
    estimatedImpact: 'Improves outcome quality on next calibration cycle',
    actions: [
      { description: 'Filter OutcomeLedger by this domain and review the past 7d' },
      { description: 'Identify the top three reasons for rejection' },
      { description: 'Update domain-specific thresholds based on those reasons' },
    ],
  },
  predictionAccuracy: {
    title: (domain) => `${domain}: prediction accuracy below threshold`,
    summary: (domain, score) => `Prediction accuracy for ${domain} is ${(score * 100).toFixed(0)}%. The current driver weights are mismatched against ground truth.`,
    estimatedImpact: 'Restores prediction accuracy to baseline within one tuning pass',
    actions: [
      { description: 'Open AlgoEvalPanel filtered to this domain' },
      { description: 'Review the driver-weight contributions for missed predictions' },
      { description: 'Re-tune driver weights or enable a candidate shadow algorithm' },
    ],
  },
  feedHealth: {
    title: (domain) => `${domain}: feed health degraded`,
    summary: (domain, score) => `Feed health for ${domain} is ${(score * 100).toFixed(0)}%. One or more upstream sources is stale, degraded, or down.`,
    estimatedImpact: 'Restores feed coverage as soon as upstream is healthy or fallback is enabled',
    actions: [
      { description: 'Open SystemDiagnosticPanel and look for sources tagged with this domain' },
      { description: 'Enable fallback sources where available' },
      { description: 'Verify upstream credentials / API keys' },
    ],
  },
  attentionEfficiency: {
    title: (domain) => `${domain}: attention efficiency low`,
    summary: (domain, score) => `Attention efficiency for ${domain} is ${(score * 100).toFixed(0)}%. The system is surfacing low-relevance items at the expense of higher-priority signals.`,
    estimatedImpact: 'Improves relevance ranking on next attention-allocator update',
    actions: [
      { description: 'Open AttentionAllocator diagnostics' },
      { description: 'Lower the domain multiplier or raise the rivalry-score weight' },
      { description: 'Verify by watching the next 24h of routed events' },
    ],
  },
  budgetHealth: {
    title: (domain) => `${domain}: budget health critical`,
    summary: (domain, score) => `Budget health for ${domain} is ${(score * 100).toFixed(0)}%. Alert quotas are saturating and important signals may be throttled.`,
    estimatedImpact: 'Restores headroom and prevents further throttling',
    actions: [
      { description: 'Open TrustBudgetPanel filtered to this domain' },
      { description: 'Raise per-domain quota or temporarily increase global rate limit' },
      { description: 'Investigate sustained over-budget periods for false positives' },
    ],
  },
};

// ── Engine ────────────────────────────────────────────────────────────

export interface RepairEngineOptions {
  clock?: () => number;
}

export class RepairEngine {
  private recommendations = new Map<string, RepairRecommendation>();
  private insertionOrder: string[] = [];
  private listeners = new Set<RepairListener>();
  private clock: () => number;
  private hydrated = false;
  private idSeq = 0;

  constructor(options: RepairEngineOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
  }

  // ── Generation ───────────────────────────────────────────────────

  generateFromSafetyCase(safetyCase: SafetyCase): RepairRecommendation[] {
    this.ensureHydrated();
    const generated: RepairRecommendation[] = [];
    for (const property of safetyCase.properties) {
      if (property.verdict !== 'fail' && property.verdict !== 'warn') continue;
      const rec = this.buildFromSafetyProperty(property);
      if (rec) {
        this.store(rec);
        generated.push(cloneRecommendation(rec));
      }
    }
    this.persist();
    return generated;
  }

  generateFromScorecard(scorecard: DomainScorecard): RepairRecommendation[] {
    this.ensureHydrated();
    const generated: RepairRecommendation[] = [];
    const components = scorecard.components;
    for (const key of Object.keys(components) as ScorecardComponentKey[]) {
      const value = components[key];
      if (typeof value !== 'number' || value >= SCORECARD_COMPONENT_THRESHOLD) continue;
      const rec = this.buildFromScorecardComponent(scorecard, key, value);
      this.store(rec);
      generated.push(cloneRecommendation(rec));
    }
    this.persist();
    return generated;
  }

  private buildFromSafetyProperty(property: SafetyProperty): RepairRecommendation | undefined {
    const verdict = property.verdict === 'fail' || property.verdict === 'warn' ? property.verdict : undefined;
    if (!verdict) return undefined;
    const templates = SAFETY_TEMPLATES[property.id as SafetyPropertyId];
    const template = templates?.[verdict] ?? templates?.fail ?? genericSafetyTemplate(property, verdict);
    const priority: RepairPriority = verdict === 'fail' ? 'critical' : 'high';
    const now = this.clock();
    return {
      id: this.nextId(now, 'safety'),
      title: template.title,
      summary: property.reason ?? template.summary,
      triggerSource: `SafetyCase: ${property.id} ${verdict}`,
      priority,
      actions: buildActions(template.actions, now),
      estimatedImpact: template.estimatedImpact,
      status: 'open',
      createdAt: new Date(now),
    };
  }

  private buildFromScorecardComponent(
    scorecard: DomainScorecard,
    component: ScorecardComponentKey,
    score: number,
  ): RepairRecommendation {
    const template = SCORECARD_COMPONENT_TEMPLATES[component];
    const now = this.clock();
    const priority: RepairPriority = score < 0.25 ? 'high' : 'medium';
    return {
      id: this.nextId(now, `scorecard-${component}`),
      title: template.title(scorecard.domain),
      summary: template.summary(scorecard.domain, score),
      triggerSource: `DomainScorecard: ${scorecard.domain} ${component}=${score.toFixed(2)} (grade ${scorecard.grade})`,
      domain: scorecard.domain,
      priority,
      actions: buildActions(template.actions, now),
      estimatedImpact: template.estimatedImpact,
      status: 'open',
      createdAt: new Date(now),
    };
  }

  // ── Reads ────────────────────────────────────────────────────────

  getAll(): RepairRecommendation[] {
    this.ensureHydrated();
    return this.insertionOrder
      .map((id) => this.recommendations.get(id))
      .filter((r): r is RepairRecommendation => r !== undefined)
      .map((r) => cloneRecommendation(r));
  }

  getOpen(): RepairRecommendation[] {
    return this.getAll().filter((r) => r.status === 'open' || r.status === 'in-progress');
  }

  getByPriority(priority: RepairPriority): RepairRecommendation[] {
    return this.getAll().filter((r) => r.priority === priority);
  }

  getByDomain(domain: string): RepairRecommendation[] {
    return this.getAll().filter((r) => r.domain === domain);
  }

  get(id: string): RepairRecommendation | undefined {
    this.ensureHydrated();
    const r = this.recommendations.get(id);
    return r ? cloneRecommendation(r) : undefined;
  }

  // ── State transitions ────────────────────────────────────────────

  markInProgress(id: string): RepairRecommendation | undefined {
    return this.transition(id, (r) => {
      if (r.status === 'resolved' || r.status === 'dismissed') return false;
      r.status = 'in-progress';
      return true;
    });
  }

  resolve(id: string): RepairRecommendation | undefined {
    return this.transition(id, (r) => {
      if (r.status === 'resolved' || r.status === 'dismissed') return false;
      r.status = 'resolved';
      r.resolvedAt = new Date(this.clock());
      return true;
    });
  }

  dismiss(id: string, reason: string): RepairRecommendation | undefined {
    return this.transition(id, (r) => {
      if (r.status === 'resolved' || r.status === 'dismissed') return false;
      r.status = 'dismissed';
      r.dismissedReason = reason;
      r.resolvedAt = new Date(this.clock());
      return true;
    });
  }

  private transition(
    id: string,
    apply: (r: RepairRecommendation) => boolean,
  ): RepairRecommendation | undefined {
    this.ensureHydrated();
    const current = this.recommendations.get(id);
    if (!current) return undefined;
    if (!apply(current)) return cloneRecommendation(current);
    this.recommendations.set(id, current);
    this.persist();
    this.notify(current);
    return cloneRecommendation(current);
  }

  // ── Stats + subscribe ───────────────────────────────────────────

  stats(): RepairStats {
    this.ensureHydrated();
    const byPriority: Record<RepairPriority, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    let open = 0;
    let inProgress = 0;
    let resolved = 0;
    let dismissed = 0;
    for (const r of this.recommendations.values()) {
      byPriority[r.priority] += 1;
      if (r.status === 'open') open += 1;
      else if (r.status === 'in-progress') inProgress += 1;
      else if (r.status === 'resolved') resolved += 1;
      else if (r.status === 'dismissed') dismissed += 1;
    }
    return { open, inProgress, resolved, dismissed, byPriority };
  }

  subscribe(listener: RepairListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Test seam — empties in-memory + persisted state. */
  resetForTesting(): void {
    this.recommendations.clear();
    this.insertionOrder = [];
    this.listeners.clear();
    this.idSeq = 0;
    this.hydrated = true;
    const store = safeStorage();
    if (store) {
      try { store.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  }

  // ── Internal ─────────────────────────────────────────────────────

  private store(rec: RepairRecommendation): void {
    const existing = this.recommendations.has(rec.id);
    this.recommendations.set(rec.id, rec);
    if (!existing) {
      this.insertionOrder.push(rec.id);
      this.enforceCapacity();
    }
    this.notify(rec);
  }

  private enforceCapacity(): void {
    while (this.insertionOrder.length > MAX_RECOMMENDATIONS) {
      const oldest = this.insertionOrder.shift();
      if (oldest !== undefined) this.recommendations.delete(oldest);
    }
  }

  private notify(rec: RepairRecommendation): void {
    const snapshot = cloneRecommendation(rec);
    for (const l of this.listeners) {
      try { l(snapshot); } catch { /* listener crash isolation */ }
    }
  }

  private nextId(now: number, scope: string): string {
    this.idSeq += 1;
    return `rep-${scope}-${now.toString(36)}-${this.idSeq}`;
  }

  // ── Persistence ──────────────────────────────────────────────────

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    const store = safeStorage();
    if (!store) return;
    let raw: string | null = null;
    try { raw = store.getItem(STORAGE_KEY); } catch { return; }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as PersistedRecommendation[] | null;
      if (!Array.isArray(parsed)) return;
      for (const entry of parsed) {
        const r = deserializeRecommendation(entry);
        if (r) {
          this.recommendations.set(r.id, r);
          this.insertionOrder.push(r.id);
        }
      }
    } catch {
      // corrupt blob — leave empty
    }
  }

  private persist(): void {
    const store = safeStorage();
    if (!store) return;
    const payload = this.insertionOrder
      .map((id) => this.recommendations.get(id))
      .filter((r): r is RepairRecommendation => r !== undefined)
      .map((r) => serializeRecommendation(r));
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // best effort
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function buildActions(templates: readonly ActionTemplate[], now: number): RepairAction[] {
  return templates.map((tpl, idx) => ({
    id: `act-${now.toString(36)}-${idx + 1}`,
    step: idx + 1,
    description: tpl.description,
    automated: tpl.automated === true,
    automationFn: tpl.automationFn,
  }));
}

function genericSafetyTemplate(property: SafetyProperty, verdict: 'fail' | 'warn'): SafetyTemplate {
  return {
    title: `${property.id} ${verdict}`,
    summary: property.reason ?? `Safety property ${property.id} is in ${verdict} state and needs operator review.`,
    estimatedImpact: 'Restores the safety property to pass once the underlying cause is addressed',
    actions: [
      { description: `Review the ${property.id} property in the Safety Case panel` },
      { description: 'Identify the upstream cause and apply the documented mitigation' },
    ],
  };
}

interface PersistedRecommendation extends Omit<RepairRecommendation, 'createdAt' | 'resolvedAt'> {
  createdAt: number;
  resolvedAt?: number;
}

function serializeRecommendation(r: RepairRecommendation): PersistedRecommendation {
  return {
    ...r,
    actions: r.actions.map((a) => ({ ...a })),
    createdAt: r.createdAt.getTime(),
    resolvedAt: r.resolvedAt?.getTime(),
  };
}

function deserializeRecommendation(raw: unknown): RepairRecommendation | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as PersistedRecommendation;
  if (typeof r.id !== 'string' || typeof r.title !== 'string') return undefined;
  const actions = Array.isArray(r.actions)
    ? r.actions.map((a) => ({ ...(a as RepairAction) }))
    : [];
  return {
    id: r.id,
    title: r.title,
    summary: r.summary ?? '',
    triggerSource: r.triggerSource ?? 'unknown',
    domain: r.domain,
    priority: (r.priority ?? 'medium') as RepairPriority,
    actions,
    estimatedImpact: r.estimatedImpact ?? '',
    status: (r.status ?? 'open') as RepairStatus,
    createdAt: new Date(typeof r.createdAt === 'number' ? r.createdAt : Date.now()),
    resolvedAt: typeof r.resolvedAt === 'number' ? new Date(r.resolvedAt) : undefined,
    dismissedReason: r.dismissedReason,
  };
}

function cloneRecommendation(r: RepairRecommendation): RepairRecommendation {
  return {
    ...r,
    actions: r.actions.map((a) => ({ ...a })),
    createdAt: new Date(r.createdAt),
    resolvedAt: r.resolvedAt ? new Date(r.resolvedAt) : undefined,
  };
}

function safeStorage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

// ── Singleton ────────────────────────────────────────────────────────

let _singleton: RepairEngine | null = null;

export function getRepairEngine(): RepairEngine {
  _singleton ??= new RepairEngine();
  return _singleton;
}

export function __resetRepairEngineSingleton(): void {
  _singleton = null;
}

export const __internals = {
  SAFETY_TEMPLATES,
  SCORECARD_COMPONENT_TEMPLATES,
  PRIORITY_RANK,
  SCORECARD_COMPONENT_THRESHOLD,
  MAX_RECOMMENDATIONS,
};
