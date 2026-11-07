import { RESOLVER_METRIC_KEYS, type BridgePassMetrics, type ResolverPassMetrics } from './resolver-pass-metrics';

const LIMIT = 16;
const REQUIRED = 7;
const INTERVAL_MS = 15 * 60_000;

type Readiness = 'ready' | 'hidden' | 'cognition-disabled' | 'not-hydrated' | 'disposed' | 'coordination-unavailable';
type Outcome = 'completed' | 'skipped' | 'failed';
interface RunTimes {
  dueAt: number;
  startedAt: number;
  completedAt: number;
  readiness: Readiness;
  outcome: Outcome;
}

export type ResolutionRunInput = RunTimes & (
  | { kind: 'scheduled' | 'catchup'; metrics: ResolverPassMetrics | null }
  | { kind: 'bridge'; metrics: BridgePassMetrics | null }
);
export type ResolutionRunReceipt = ResolutionRunInput & { sequence: number };

const readiness = new Set<Readiness>(['ready', 'hidden', 'cognition-disabled', 'not-hydrated', 'disposed', 'coordination-unavailable']);
const outcomes = new Set<Outcome>(['completed', 'skipped', 'failed']);
const receipts: ResolutionRunReceipt[] = [];
let sequence = 0;
let interruptedAfter = 0;

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function resolverMetrics(input: ResolverPassMetrics | null): ResolverPassMetrics | null {
  if (!input) return null;
  const metrics = {} as ResolverPassMetrics;
  for (const key of RESOLVER_METRIC_KEYS) {
    if (!isCount(input[key])) return null;
    metrics[key] = input[key];
  }
  return metrics;
}

function bridgeMetrics(input: BridgePassMetrics | null): BridgePassMetrics | null {
  if (!input) return null;
  const { enabled, shortageExpired, advisoryExpired, legacyExpired, failed } = input;
  if (typeof enabled !== 'boolean' || typeof failed !== 'boolean'
    || ![shortageExpired, advisoryExpired, legacyExpired].every(value => isCount(value))) return null;
  return { enabled, shortageExpired, advisoryExpired, legacyExpired, failed };
}

export function interruptResolutionRunStreak(): void {
  interruptedAfter = sequence;
}

export function resetResolutionRunSession(): void {
  receipts.length = 0;
  sequence = 0;
  interruptedAfter = 0;
}

export function recordResolutionRun(run: ResolutionRunInput): void {
  const { kind, dueAt, startedAt, completedAt, readiness: state, outcome } = run;
  if (!(kind === 'scheduled' || kind === 'catchup' || kind === 'bridge') || !outcomes.has(outcome)
    || !readiness.has(state) || ![dueAt, startedAt, completedAt].every(value => isCount(value))
    || dueAt > startedAt || startedAt > completedAt) {
    interruptResolutionRunStreak();
    return;
  }
  const fields = { sequence: ++sequence, dueAt, startedAt, completedAt, readiness: state, outcome };
  receipts.push(kind === 'bridge'
    ? { ...fields, kind, metrics: bridgeMetrics(run.metrics) }
    : { ...fields, kind, metrics: resolverMetrics(run.metrics) });
  if (receipts.length > LIMIT) receipts.shift();
}

function qualifies(run: ResolutionRunReceipt): boolean {
  if (run.kind !== 'scheduled' || run.outcome !== 'completed' || run.readiness !== 'ready') return false;
  const m = run.metrics;
  return !!m && m.opportunities > 0 && m.eligibleOverdueAfter === 0
    && m.rejectedWrites === 0 && m.persistenceFailures === 0 && run.startedAt - run.dueAt < INTERVAL_MS;
}

function scheduledStreak(): number {
  let count = 0;
  let lastDueAt = 0;
  for (const run of receipts) {
    if (run.sequence <= interruptedAfter || run.kind === 'bridge') continue;
    if (!qualifies(run)) { count = 0; continue; }
    const gap = run.dueAt - lastDueAt;
    count = count && gap >= INTERVAL_MS && gap < 2 * INTERVAL_MS ? count + 1 : 1;
    lastDueAt = run.dueAt;
  }
  return count;
}

export function getResolutionRunDiagnostics() {
  return {
    requiredScheduledRuns: REQUIRED,
    consecutiveQualifyingScheduledRuns: scheduledStreak(),
    receipts: receipts.map(r => ({ ...r, metrics: r.metrics && { ...r.metrics } })),
  };
}
