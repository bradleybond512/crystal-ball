/**
 * PolicyEngine — dynamic system-behavior policies.
 *
 * Evaluates a system state snapshot against a list of active policies
 * and returns the actions whose conditions matched. The engine itself
 * is pure: same systemState + same policies always yields the same
 * actions, in the same order (priority desc, then policy id).
 *
 * Five built-in policies seed the registry on first instantiation:
 *   - flood-of-alerts suppressor  → mute domain on alert spike
 *   - critical-domain escalator   → escalate alerts above severity threshold
 *   - stale-feed muter            → disable feature when feed health is stale
 *   - night-quiet-hours           → adjust threshold during configured hours
 *   - cascade-amplifier           → escalate when cascade depth exceeds N
 *
 * Storage key: `wm-policy-engine`, capped at 100 policies.
 *
 * The engine never *executes* an action; callers wire returned
 * PolicyAction[] into the relevant subsystems (notification ladder,
 * feed manager, feature flags, threshold registry).
 */

// ── Public types ─────────────────────────────────────────────────────

export type PolicyStatus = 'active' | 'paused' | 'expired';

export type PolicyConditionType =
  | 'metric-threshold'
  | 'domain-severity'
  | 'time-window'
  | 'feed-health';

export type PolicyActionType =
  | 'adjust-threshold'
  | 'mute-domain'
  | 'escalate-alerts'
  | 'enable-feature'
  | 'disable-feature';

export interface PolicyCondition {
  type: PolicyConditionType;
  params: Record<string, unknown>;
}

export interface PolicyAction {
  type: PolicyActionType;
  params: Record<string, unknown>;
}

export interface Policy {
  id: string;
  name: string;
  description: string;
  condition: PolicyCondition;
  action: PolicyAction;
  priority: number;
  status: PolicyStatus;
  appliedCount: number;
  lastAppliedAt?: number;
  expiresAt?: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface PolicyEngineOptions {
  capacity?: number;
  storage?: StorageLike | null;
  now?: () => number;
  /** When false, the constructor will not seed built-in policies. */
  seedBuiltIns?: boolean;
}

// ── Constants ────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-policy-engine';
const DEFAULT_CAPACITY = 100;

// ── Engine ───────────────────────────────────────────────────────────

interface PersistedStore {
  policies: Policy[];
}

export class PolicyEngine {
  private static instance: PolicyEngine | undefined;

  private readonly capacity: number;
  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  private policies: Policy[] = [];

  constructor(opts: PolicyEngineOptions = {}) {
    this.capacity = opts.capacity ?? DEFAULT_CAPACITY;
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.clock = opts.now ?? Date.now;
    this.hydrate();
    if (opts.seedBuiltIns !== false && this.policies.length === 0) {
      this.seedBuiltInPolicies();
    }
  }

  static getInstance(): PolicyEngine {
    PolicyEngine.instance ??= new PolicyEngine();
    return PolicyEngine.instance;
  }

  static resetForTests(): void {
    PolicyEngine.instance = undefined;
  }

  /**
   * Run all active, non-expired policies against the given system
   * state. Returns the list of PolicyActions whose conditions matched,
   * sorted by priority descending (ties broken by policy id for
   * deterministic output). Side effect: increments appliedCount and
   * stamps lastAppliedAt on matched policies, and persists.
   */
  evaluate(systemState: Record<string, unknown>): PolicyAction[] {
    const now = this.clock();
    this.expireStalePolicies(now);

    const matched: { policy: Policy; action: PolicyAction }[] = [];
    for (const policy of this.policies) {
      if (policy.status !== 'active') continue;
      if (!evaluateCondition(policy.condition, systemState)) continue;
      matched.push({ policy, action: policy.action });
      policy.appliedCount += 1;
      policy.lastAppliedAt = now;
    }

    matched.sort((a, b) => {
      if (b.policy.priority !== a.policy.priority) {
        return b.policy.priority - a.policy.priority;
      }
      return a.policy.id.localeCompare(b.policy.id);
    });

    if (matched.length > 0) this.persist();
    return matched.map((m) => m.action);
  }

  /**
   * Insert or replace a policy by id. Caller-supplied appliedCount
   * defaults to 0 if omitted. Enforces the capacity cap by dropping
   * the lowest-priority policy when full.
   */
  addPolicy(policy: Omit<Policy, 'appliedCount'> & { appliedCount?: number }): Policy {
    const normalized: Policy = {
      ...policy,
      appliedCount: policy.appliedCount ?? 0,
    };
    const existingIdx = this.policies.findIndex((p) => p.id === normalized.id);
    if (existingIdx === -1) {
      this.policies.push(normalized);
      this.enforceCapacity();
    } else {
      this.policies[existingIdx] = normalized;
    }
    this.persist();
    return normalized;
  }

  pausePolicy(id: string): boolean {
    const policy = this.policies.find((p) => p.id === id);
    if (!policy) return false;
    if (policy.status === 'expired') return false;
    policy.status = 'paused';
    this.persist();
    return true;
  }

  resumePolicy(id: string): boolean {
    const policy = this.policies.find((p) => p.id === id);
    if (!policy) return false;
    if (policy.status === 'expired') return false;
    policy.status = 'active';
    this.persist();
    return true;
  }

  removePolicy(id: string): boolean {
    const idx = this.policies.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    this.policies.splice(idx, 1);
    this.persist();
    return true;
  }

  getActive(): Policy[] {
    const now = this.clock();
    this.expireStalePolicies(now);
    return this.policies.filter((p) => p.status === 'active');
  }

  getAll(): Policy[] {
    return [...this.policies];
  }

  getById(id: string): Policy | undefined {
    return this.policies.find((p) => p.id === id);
  }

  // ── Internals ──────────────────────────────────────────────────────

  private expireStalePolicies(now: number): void {
    let changed = false;
    for (const policy of this.policies) {
      if (
        policy.status !== 'expired' &&
        typeof policy.expiresAt === 'number' &&
        policy.expiresAt <= now
      ) {
        policy.status = 'expired';
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  private enforceCapacity(): void {
    while (this.policies.length > this.capacity) {
      // Drop the lowest-priority (ties: oldest by lastAppliedAt) so
      // newly-added high-priority policies can take the slot.
      let dropIdx = 0;
      for (let i = 1; i < this.policies.length; i++) {
        const a = this.policies[i]!;
        const b = this.policies[dropIdx]!;
        const sameTier = a.priority === b.priority;
        const olderApplied = (a.lastAppliedAt ?? 0) < (b.lastAppliedAt ?? 0);
        if (a.priority < b.priority || (sameTier && olderApplied)) {
          dropIdx = i;
        }
      }
      this.policies.splice(dropIdx, 1);
    }
  }

  private hydrate(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedStore;
      if (!parsed || !Array.isArray(parsed.policies)) return;
      this.policies = parsed.policies.filter((p) => isValidPolicy(p));
      this.enforceCapacity();
    } catch {
      this.policies = [];
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      const store: PersistedStore = { policies: this.policies };
      this.storage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      // Non-fatal.
    }
  }

  private seedBuiltInPolicies(): void {
    for (const seed of BUILT_IN_POLICIES) {
      this.policies.push({ ...seed, appliedCount: 0 });
    }
    this.persist();
  }
}

// ── Condition evaluators ─────────────────────────────────────────────

function evaluateCondition(
  condition: PolicyCondition,
  state: Record<string, unknown>,
): boolean {
  switch (condition.type) {
    case 'metric-threshold': {
      return evalMetricThreshold(condition.params, state);
    }
    case 'domain-severity': {
      return evalDomainSeverity(condition.params, state);
    }
    case 'time-window': {
      return evalTimeWindow(condition.params, state);
    }
    case 'feed-health': {
      return evalFeedHealth(condition.params, state);
    }
    default: {
      return false;
    }
  }
}

function evalMetricThreshold(
  params: Record<string, unknown>,
  state: Record<string, unknown>,
): boolean {
  const metric = typeof params.metric === 'string' ? params.metric : null;
  const operator = typeof params.operator === 'string' ? params.operator : '>=';
  const threshold = typeof params.threshold === 'number' ? params.threshold : null;
  if (!metric || threshold === null) return false;
  const value = readNumber(state, metric);
  if (value === null) return false;
  switch (operator) {
    case '>': { return value > threshold;
    }
    case '>=': { return value >= threshold;
    }
    case '<': { return value < threshold;
    }
    case '<=': { return value <= threshold;
    }
    case '==': case '=': { return value === threshold;
 }
    case '!=': { return value !== threshold;
    }
    default: { return false;
    }
  }
}

function evalDomainSeverity(
  params: Record<string, unknown>,
  state: Record<string, unknown>,
): boolean {
  const domain = typeof params.domain === 'string' ? params.domain : null;
  const minSeverity = typeof params.minSeverity === 'number' ? params.minSeverity : null;
  if (!domain || minSeverity === null) return false;
  const severities = state.domainSeverities;
  if (!severities || typeof severities !== 'object') return false;
  const value = (severities as Record<string, unknown>)[domain];
  if (typeof value !== 'number') return false;
  return value >= minSeverity;
}

function evalTimeWindow(
  params: Record<string, unknown>,
  state: Record<string, unknown>,
): boolean {
  const startHour = typeof params.startHour === 'number' ? params.startHour : null;
  const endHour = typeof params.endHour === 'number' ? params.endHour : null;
  if (startHour === null || endHour === null) return false;
  const hour = readNumber(state, 'hourOfDay');
  if (hour === null) return false;
  // Inclusive start, exclusive end; supports overnight wrap (e.g. 22..6).
  if (startHour <= endHour) {
    return hour >= startHour && hour < endHour;
  }
  return hour >= startHour || hour < endHour;
}

function evalFeedHealth(
  params: Record<string, unknown>,
  state: Record<string, unknown>,
): boolean {
  const feed = typeof params.feed === 'string' ? params.feed : null;
  const maxStaleMs = typeof params.maxStaleMs === 'number' ? params.maxStaleMs : null;
  if (!feed || maxStaleMs === null) return false;
  const feeds = state.feedHealth;
  if (!feeds || typeof feeds !== 'object') return false;
  const entry = (feeds as Record<string, unknown>)[feed];
  if (!entry || typeof entry !== 'object') return false;
  const ageMs = (entry as Record<string, unknown>).ageMs;
  if (typeof ageMs !== 'number') return false;
  return ageMs >= maxStaleMs;
}

function readNumber(state: Record<string, unknown>, key: string): number | null {
  // Supports dot-notation: "metrics.alertsPerMin"
  const parts = key.split('.');
  let cursor: unknown = state;
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object') return null;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return typeof cursor === 'number' ? cursor : null;
}

// ── Persisted-policy guard ───────────────────────────────────────────

function isValidPolicy(value: unknown): value is Policy {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || !v.id) return false;
  if (typeof v.name !== 'string') return false;
  if (typeof v.description !== 'string') return false;
  if (typeof v.priority !== 'number') return false;
  if (v.status !== 'active' && v.status !== 'paused' && v.status !== 'expired') return false;
  if (typeof v.appliedCount !== 'number') return false;
  if (!v.condition || typeof v.condition !== 'object') return false;
  if (!v.action || typeof v.action !== 'object') return false;
  return true;
}

function defaultStorage(): StorageLike | null {
  if (typeof globalThis === 'undefined') return null;
  const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
  return ls ?? null;
}

// ── Built-in seed policies ───────────────────────────────────────────

const BUILT_IN_POLICIES: Omit<Policy, 'appliedCount'>[] = [
  {
    id: 'builtin.flood-of-alerts',
    name: 'Flood-of-alerts suppressor',
    description:
      'Mute a domain when its alert rate per minute exceeds the configured cap. Prevents notification fatigue during major events.',
    condition: {
      type: 'metric-threshold',
      params: { metric: 'alertsPerMinute', operator: '>=', threshold: 30 },
    },
    action: {
      type: 'mute-domain',
      params: { domain: 'all', durationMs: 5 * 60 * 1000 },
    },
    priority: 80,
    status: 'active',
  },
  {
    id: 'builtin.critical-domain-escalator',
    name: 'Critical-domain escalator',
    description:
      'Escalate alerts to the highest rung when a tracked domain crosses severity 0.85. Targets fast-moving safety domains.',
    condition: {
      type: 'domain-severity',
      params: { domain: 'weather', minSeverity: 0.85 },
    },
    action: {
      type: 'escalate-alerts',
      params: { domain: 'weather', toRung: 'critical' },
    },
    priority: 95,
    status: 'active',
  },
  {
    id: 'builtin.stale-feed-muter',
    name: 'Stale-feed muter',
    description:
      'Disable a feature that depends on a feed once the feed has not produced a successful sample in 15 minutes. Avoids serving confidently-wrong stale data.',
    condition: {
      type: 'feed-health',
      params: { feed: 'nws-alerts', maxStaleMs: 15 * 60 * 1000 },
    },
    action: {
      type: 'disable-feature',
      params: { featureId: 'storm-mode-banner' },
    },
    priority: 70,
    status: 'active',
  },
  {
    id: 'builtin.night-quiet-hours',
    name: 'Night quiet-hours threshold',
    description:
      'Raise the alert delivery threshold during 22:00–06:00 to suppress non-critical pings while the user is asleep. Safety-critical events bypass this via the higher-priority escalator.',
    condition: {
      type: 'time-window',
      params: { startHour: 22, endHour: 6 },
    },
    action: {
      type: 'adjust-threshold',
      params: { thresholdKey: 'notification.minRung', newValue: 'high' },
    },
    priority: 40,
    status: 'active',
  },
  {
    id: 'builtin.cascade-amplifier',
    name: 'Cascade amplifier',
    description:
      'Raise notification urgency when the active cascade graph has depth ≥ 3 cross-domain edges — signal of a multi-domain compounding event.',
    condition: {
      type: 'metric-threshold',
      params: { metric: 'cascadeDepth', operator: '>=', threshold: 3 },
    },
    action: {
      type: 'escalate-alerts',
      params: { domain: 'all', toRung: 'high' },
    },
    priority: 85,
    status: 'active',
  },
];

/** @internal — exposed for tests. */
export function _builtInPolicies(): Omit<Policy, 'appliedCount'>[] {
  return BUILT_IN_POLICIES.map((p) => ({ ...p }));
}
