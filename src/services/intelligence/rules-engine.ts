/**
 * Custom Alert Rules Engine (Phase 3).
 *
 * User-defined IF/THEN rules evaluated against each ObservationEvent as
 * it's ingested. Independent of the legacy `alert-rules.ts` (UnifiedAlert)
 * and `alert-rules-engine.ts` (NormalizedFact) systems; lives under
 * `intelligence/` so the rule schema can evolve with the ObservationEvent
 * pipeline.
 *
 * Persistence: `localStorage` under `wm-alert-rules`. Pure helpers
 * (evaluateCondition, evaluate, parseLatLon, haversineKm) are exported
 * so the sidecar mirror + tests can use them without touching storage.
 *
 * Side effects:
 *   - On match, dispatches `wm:rule-triggered` on `document` with
 *     `{ rule, event }` detail.
 */

import type {
  AlertRule,
  ObservationEvent,
  RuleAction,
  RuleCondition,
} from '@/types/intelligence';

export const STORAGE_KEY = 'wm-alert-rules';

// ── Pure geo helper ───────────────────────────────────────────────────────

const EARTH_KM = 6371;
const DEG2RAD = Math.PI / 180;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.sin(dLon / 2) ** 2;
  return EARTH_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Parse a "lat,lon" string into a tuple. Returns null on garbage input —
 * the engine then treats the condition as false rather than throwing.
 */
export function parseLatLon(value: unknown): { lat: number; lon: number } | null {
  if (typeof value !== 'string') return null;
  const parts = value.split(',').map((s) => s.trim());
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

// ── Severity helpers ──────────────────────────────────────────────────────

const SEVERITY_RANK: Record<string, number> = {
  INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4,
  info: 0, low: 1, medium: 2, moderate: 2, high: 3, critical: 4,
};

function severityRank(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const r = SEVERITY_RANK[value];
  return typeof r === 'number' ? r : null;
}

// ── Numeric extraction from tag / raw payload ────────────────────────────

/**
 * Pull a magnitude from an ObservationEvent. USGS adapters embed it in
 * `raw.magnitude`, others encode it as a "mag:N.N" tag. Returns null
 * when no magnitude is detectable so `gt` / `lt` conditions short-circuit
 * to false rather than the JS `null` truthiness.
 */
export function extractMagnitude(event: ObservationEvent): number | null {
  if (event.raw && typeof event.raw === 'object') {
    const m = (event.raw as Record<string, unknown>).magnitude;
    if (typeof m === 'number' && Number.isFinite(m)) return m;
  }
  const tagMatch = event.tags.find((t) => /^mag[:=]/i.test(t));
  if (tagMatch) {
    const n = Number.parseFloat(tagMatch.split(/[:=]/, 2)[1] ?? '');
    if (Number.isFinite(n)) return n;
  }
  // Fall back to a title pattern like "M5.8 earthquake".
  const titleMatch = /\bM(\d+(?:\.\d+)?)\b/.exec(event.title);
  if (titleMatch) {
    const n = Number.parseFloat(titleMatch[1] ?? '');
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Pull a wildfire containment percentage from raw / tag / title. */
export function extractContainment(event: ObservationEvent): number | null {
  if (event.raw && typeof event.raw === 'object') {
    const c = (event.raw as Record<string, unknown>).containment;
    if (typeof c === 'number' && Number.isFinite(c)) return c;
  }
  const tagMatch = event.tags.find((t) => /^containment[:=]/i.test(t));
  if (tagMatch) {
    const n = Number.parseFloat(tagMatch.split(/[:=]/, 2)[1] ?? '');
    if (Number.isFinite(n)) return n;
  }
  // Single-pass linear scan; capped at 10-char prefix so backtracking is bounded.
  const titleMatch = /(\d{1,4}(?:\.\d{1,3})?) *% *contained/i.exec(event.title);
  if (titleMatch) {
    const n = Number.parseFloat(titleMatch[1] ?? '');
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// ── Pure condition evaluation ────────────────────────────────────────────

export function evaluateCondition(
  event: ObservationEvent,
  condition: RuleCondition,
): boolean {
  switch (condition.field) {
    case 'domain': {   return matchString(event.domain, condition);
    }
    case 'keyword': {  return matchKeyword(event, condition);
    }
    case 'severity': { return matchSeverity(event.severity, condition);
    }
    case 'magnitude': { return matchNumber(extractMagnitude(event), condition);
    }
    case 'containment': { return matchNumber(extractContainment(event), condition);
    }
    case 'location': { return matchLocation(event, condition);
    }
  }
}

function matchString(actual: string, c: RuleCondition): boolean {
  const want = String(c.value).toLowerCase();
  const got = actual.toLowerCase();
  if (c.operator === 'equals') return got === want;
  if (c.operator === 'contains') return got.includes(want);
  return false;
}

function matchKeyword(event: ObservationEvent, c: RuleCondition): boolean {
  const want = String(c.value).toLowerCase();
  if (want.length === 0) return false;
  const haystack = `${event.title} ${event.tags.join(' ')}`.toLowerCase();
  if (c.operator === 'equals') return event.title.toLowerCase() === want
    || event.tags.some((t) => t.toLowerCase() === want);
  if (c.operator === 'contains') return haystack.includes(want);
  return false;
}

function matchSeverity(actual: string, c: RuleCondition): boolean {
  if (c.operator === 'equals' || c.operator === 'contains') return matchString(actual, c);
  const a = severityRank(actual);
  const b = severityRank(c.value);
  if (a === null || b === null) return false;
  if (c.operator === 'gt') return a > b;
  if (c.operator === 'lt') return a < b;
  return false;
}

function matchNumber(actual: number | null, c: RuleCondition): boolean {
  if (actual === null) return false;
  const wanted = typeof c.value === 'number' ? c.value : Number(c.value);
  if (!Number.isFinite(wanted)) return false;
  if (c.operator === 'equals') return actual === wanted;
  if (c.operator === 'gt') return actual > wanted;
  if (c.operator === 'lt') return actual < wanted;
  return false;
}

function matchLocation(event: ObservationEvent, c: RuleCondition): boolean {
  if (c.operator !== 'near') return false;
  const loc = event.location;
  if (!loc) return false;
  const radius = c.radiusKm;
  if (typeof radius !== 'number' || !Number.isFinite(radius) || radius <= 0) return false;
  const target = parseLatLon(c.value);
  if (!target) return false;
  const distKm = haversineKm(loc.lat, loc.lon, target.lat, target.lon);
  return distKm <= radius;
}

// ── Rule evaluation ──────────────────────────────────────────────────────

export function ruleMatches(event: ObservationEvent, rule: AlertRule): boolean {
  if (!rule.enabled) return false;
  if (rule.conditions.length === 0) return false;
  if (rule.conditionOperator === 'OR') {
    return rule.conditions.some((c) => evaluateCondition(event, c));
  }
  return rule.conditions.every((c) => evaluateCondition(event, c));
}

export function evaluate(event: ObservationEvent, rules: AlertRule[]): AlertRule[] {
  const out: AlertRule[] = [];
  for (const rule of rules) {
    if (ruleMatches(event, rule)) out.push(rule);
  }
  return out;
}

// ── Persistence ──────────────────────────────────────────────────────────

interface StorageHost {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): StorageHost | null {
  if (typeof globalThis === 'undefined') return null;
  const ls = (globalThis as { localStorage?: StorageHost }).localStorage;
  return ls ?? null;
}

export function loadRules(storage?: StorageHost | null): AlertRule[] {
  const host = storage === undefined ? defaultStorage() : storage;
  if (!host) return [];
  try {
    const raw = host.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value) => isValidRule(value));
  } catch {
    return [];
  }
}

export function saveRules(rules: AlertRule[], storage?: StorageHost | null): void {
  const host = storage === undefined ? defaultStorage() : storage;
  if (!host) return;
  try {
    host.setItem(STORAGE_KEY, JSON.stringify(rules));
  } catch {
    // Storage full / quota — drop silently. The caller still holds the
    // in-memory snapshot.
  }
}

let _idCounter = 0;

export function nextRuleId(now = Date.now()): string {
  _idCounter += 1;
  return `rule-${now.toString(36)}-${_idCounter}`;
}

export type CreateRuleInput =
  Omit<AlertRule, 'id' | 'created' | 'lastTriggered' | 'triggerCount'>
  & { id?: string; created?: number };

export function createRule(input: CreateRuleInput, now = Date.now()): AlertRule {
  return {
    id: input.id ?? nextRuleId(now),
    name: input.name,
    enabled: input.enabled,
    conditions: input.conditions.map((c) => ({ ...c })),
    conditionOperator: input.conditionOperator,
    actions: input.actions.map((a) => ({ ...a })),
    created: input.created ?? now,
    triggerCount: 0,
  };
}

export function upsertRule(rule: AlertRule, rules: AlertRule[]): AlertRule[] {
  const out = rules.filter((r) => r.id !== rule.id);
  out.push(rule);
  return out;
}

export function deleteRuleById(id: string, rules: AlertRule[]): AlertRule[] {
  return rules.filter((r) => r.id !== id);
}

// ── Action dispatch ──────────────────────────────────────────────────────

export type ActionDispatch =
  ((name: 'wm:rule-triggered', detail: { rule: AlertRule; event: ObservationEvent }) => void)
  | null;

interface RunActionsOptions {
  dispatch?: ActionDispatch;
  log?: ((line: string) => void) | null;
}

function defaultDispatch(
  name: 'wm:rule-triggered',
  detail: { rule: AlertRule; event: ObservationEvent },
): void {
  if (typeof document === 'undefined') return;
  document.dispatchEvent(new CustomEvent(name, { detail }));
}

const noopLog: (line: string) => void = () => { /* intentional swallow — caller passed log:undefined */ };

/**
 * Run every action attached to a rule and return a new copy of the rule
 * with `lastTriggered` + `triggerCount` updated. Pure on the input — the
 * caller is responsible for re-persisting via `saveRules`.
 */
export function runRuleActions(
  rule: AlertRule,
  event: ObservationEvent,
  options: RunActionsOptions = {},
): { rule: AlertRule; dispatched: number } {
  const now = Date.now();
  const dispatch = options.dispatch === null
    ? null
    : (options.dispatch ?? defaultDispatch);
  const logFn = options.log === null
    ? null
    : (options.log ?? noopLog);
  let dispatched = 0;
  for (const action of rule.actions) {
    dispatchOne(rule, event, action, dispatch, logFn);
    dispatched += 1;
  }
  return {
    rule: {
      ...rule,
      lastTriggered: now,
      triggerCount: rule.triggerCount + 1,
    },
    dispatched,
  };
}

function dispatchOne(
  rule: AlertRule,
  event: ObservationEvent,
  action: RuleAction,
  dispatch: ActionDispatch,
  log: ((line: string) => void) | null,
): void {
  // All actions broadcast a single canonical event; downstream services
  // (notification ladder, escalation router, log archive) decide what
  // to do per action.type.
  dispatch?.('wm:rule-triggered', { rule, event });
  if (action.type === 'log' && log) {
    log(`[rule ${rule.id}] ${rule.name} matched event ${event.id}`);
  }
}

// ── Validation ───────────────────────────────────────────────────────────

const VALID_FIELDS = new Set(['domain', 'severity', 'location', 'keyword',
  'magnitude', 'containment']);
const VALID_OPERATORS = new Set(['equals', 'contains', 'gt', 'lt', 'near']);
const VALID_ACTION_TYPES = new Set(['notify', 'escalate', 'log']);
const VALID_JOINS = new Set(['AND', 'OR']);

export function isValidRule(value: unknown): value is AlertRule {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || typeof v.name !== 'string') return false;
  if (typeof v.enabled !== 'boolean') return false;
  if (!VALID_JOINS.has(v.conditionOperator as string)) return false;
  if (!Array.isArray(v.conditions) || !Array.isArray(v.actions)) return false;
  if (typeof v.created !== 'number' || typeof v.triggerCount !== 'number') return false;
  return v.conditions.every((c) => isValidCondition(c))
    && v.actions.every((a) => isValidAction(a));
}

function isValidCondition(value: unknown): value is RuleCondition {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!VALID_FIELDS.has(v.field as string)) return false;
  if (!VALID_OPERATORS.has(v.operator as string)) return false;
  if (typeof v.value !== 'string' && typeof v.value !== 'number') return false;
  return true;
}

function isValidAction(value: unknown): value is RuleAction {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return VALID_ACTION_TYPES.has(v.type as string);
}

// ── Test seam ────────────────────────────────────────────────────────────

export function __resetIdCounter(): void { _idCounter = 0; }
