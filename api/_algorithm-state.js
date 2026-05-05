/**
 * Sidecar-side singleton state for the algorithm accuracy stack.
 * Holds an in-memory mirror of the renderer's algorithm ledger plus
 * shadow ledger, lifecycle table, parameters, fixtures, and annotations.
 *
 * The renderer pushes snapshots via /api/algorithms/sync. External
 * consumers (MCP, scripts, this worktree's tests) query via the GET
 * routes. Mutations from the sidecar (manual grade, annotation, shadow
 * promotion request) write here and the renderer polls to sync back.
 *
 * Pure JS so the sidecar (Node) can import without a build step.
 */

const RESOLVER_DELAYS = {
  defaultDelayMs: 24 * 60 * 60 * 1000,
  domainOverrides: {
    compound_risk: 72 * 60 * 60 * 1000,
    forecast_calibration: 72 * 60 * 60 * 1000,
    reasoning_hypothesis: 72 * 60 * 60 * 1000,
    situation_clustering: 72 * 60 * 60 * 1000,
  },
};

const VALID_OUTCOMES = new Set(['hit', 'miss', 'partial', 'inconclusive']);
const VALID_VERDICTS = new Set([
  'TRUE_POSITIVE',
  'FALSE_POSITIVE',
  'TRUE_NEGATIVE',
  'FALSE_NEGATIVE',
  'INCONCLUSIVE',
]);

const state = {
  // Map<id, EvaluationRecord>
  ledger: new Map(),
  // Map<id, ShadowRecord>
  shadowLedger: new Map(),
  // Map<algorithmId, LifecycleEntry>
  lifecycle: new Map(),
  // Map<algorithmId, Map<paramName, value>>
  params: new Map(),
  // Map<algorithmId, ReplayFixture[]>
  fixtures: new Map(),
  // UserAnnotation[]
  annotations: [],
  // string[] (push log of mutation summaries for debugging)
  mutations: [],
  lastSyncAt: 0,
};

function trackMutation(message) {
  state.mutations.push(`[${new Date().toISOString()}] ${message}`);
  if (state.mutations.length > 200) state.mutations.shift();
}

export function getAlgorithmState() {
  return state;
}

export function resetAlgorithmState() {
  state.ledger.clear();
  state.shadowLedger.clear();
  state.lifecycle.clear();
  state.params.clear();
  state.fixtures.clear();
  state.annotations.length = 0;
  state.mutations.length = 0;
  state.lastSyncAt = 0;
}

export function syncLedger(records) {
  if (!Array.isArray(records)) {
    throw new TypeError('records must be an array');
  }
  state.ledger.clear();
  for (const r of records) {
    if (!r || typeof r.id !== 'string') continue;
    state.ledger.set(r.id, { ...r });
  }
  state.lastSyncAt = Date.now();
  trackMutation(`synced ${records.length} ledger records`);
}

export function syncShadow(records) {
  if (!Array.isArray(records)) {
    throw new TypeError('records must be an array');
  }
  state.shadowLedger.clear();
  for (const r of records) {
    if (!r || typeof r.id !== 'string') continue;
    state.shadowLedger.set(r.id, { ...r });
  }
  trackMutation(`synced ${records.length} shadow records`);
}

export function syncLifecycle(entries) {
  if (!Array.isArray(entries)) {
    throw new TypeError('entries must be an array');
  }
  state.lifecycle.clear();
  for (const e of entries) {
    if (!e || typeof e.algorithmId !== 'string') continue;
    state.lifecycle.set(e.algorithmId, { ...e });
  }
}

export function syncParams(byAlgorithm) {
  if (!byAlgorithm || typeof byAlgorithm !== 'object') {
    throw new Error('byAlgorithm must be an object');
  }
  state.params.clear();
  for (const [algoId, params] of Object.entries(byAlgorithm)) {
    if (!params || typeof params !== 'object') continue;
    state.params.set(algoId, new Map(Object.entries(params)));
  }
}

export function setParam(algorithmId, paramName, value) {
  if (!state.params.has(algorithmId)) {
    state.params.set(algorithmId, new Map());
  }
  state.params.get(algorithmId).set(paramName, value);
  trackMutation(`set param ${algorithmId}.${paramName}=${JSON.stringify(value)}`);
}

export function getParams(algorithmId) {
  const m = state.params.get(algorithmId);
  if (!m) return {};
  return Object.fromEntries(m);
}

export function syncFixtures(fixtures) {
  if (!Array.isArray(fixtures)) {
    throw new TypeError('fixtures must be an array');
  }
  state.fixtures.clear();
  for (const f of fixtures) {
    if (!f || typeof f.algorithmId !== 'string') continue;
    const list = state.fixtures.get(f.algorithmId) ?? [];
    list.push({ ...f });
    state.fixtures.set(f.algorithmId, list);
  }
}

export function getFixtures(algorithmId) {
  return state.fixtures.get(algorithmId) ?? [];
}

export function recordOutcome(id, outcome, verdict, reason) {
  const record = state.ledger.get(id);
  if (!record) {
    throw new Error(`Unknown evaluation id: ${id}`);
  }
  if (record.outcome !== undefined) {
    throw new Error(`Evaluation "${id}" already graded as ${record.outcome}`);
  }
  if (!VALID_OUTCOMES.has(outcome)) {
    throw new Error(`Invalid outcome: ${outcome}`);
  }
  if (verdict && !VALID_VERDICTS.has(verdict)) {
    throw new Error(`Invalid verdict: ${verdict}`);
  }
  const fullReason = verdict ? `[${verdict}] ${reason}` : reason;
  const updated = {
    ...record,
    outcome,
    outcomeAt: Date.now(),
    outcomeReason: fullReason,
  };
  state.ledger.set(id, updated);
  trackMutation(`graded ${id} as ${outcome} (${verdict ?? 'manual'})`);
  return updated;
}

export function listPending() {
  const now = Date.now();
  const out = [];
  for (const r of state.ledger.values()) {
    if (r.outcome !== undefined) continue;
    const delay =
      RESOLVER_DELAYS.domainOverrides[r.domain] ?? RESOLVER_DELAYS.defaultDelayMs;
    out.push({
      id: r.id,
      algorithmId: r.algorithmId,
      domain: r.domain,
      recordedAt: r.at,
      msUntilDue: r.at + delay - now,
      score: r.score,
      label: r.label,
    });
  }
  out.sort((a, b) => a.msUntilDue - b.msUntilDue);
  return out;
}

export function listAnnotations(filter = {}) {
  let list = [...state.annotations];
  if (filter.algorithmId) {
    list = list.filter((a) => a.algorithmId === filter.algorithmId);
  }
  if (typeof filter.since === 'number' && Number.isFinite(filter.since)) {
    list = list.filter((a) => a.submittedAt >= filter.since);
  }
  return list;
}

export function recordAnnotation(annotation) {
  if (!annotation || typeof annotation !== 'object') {
    throw new Error('annotation must be an object');
  }
  const submittedAt = Date.now();
  const stored = {
    alertId: String(annotation.alertId ?? ''),
    algorithmId: String(annotation.algorithmId ?? ''),
    annotationType: String(annotation.annotationType ?? ''),
    observedAt:
      typeof annotation.observedAt === 'number'
        ? annotation.observedAt
        : submittedAt,
    notes: typeof annotation.notes === 'string' ? annotation.notes : '',
    submittedAt,
  };
  if (!stored.alertId || !stored.algorithmId || !stored.annotationType) {
    throw new Error('alertId, algorithmId, and annotationType are required');
  }
  const allowed = new Set([
    'confirmed',
    'false_positive',
    'observed_early',
    'missed',
    'inconclusive',
  ]);
  if (!allowed.has(stored.annotationType)) {
    throw new Error(`Unsupported annotationType: ${stored.annotationType}`);
  }
  state.annotations.push(stored);
  trackMutation(
    `annotation ${stored.algorithmId}/${stored.alertId}: ${stored.annotationType}`,
  );
  return stored;
}

function earlyLeadMs(annotation) {
  if (annotation.annotationType !== 'observed_early') return null;
  const record = state.ledger.get(annotation.alertId);
  if (!record) return null;
  const lead = record.at - annotation.observedAt;
  return lead > 0 ? lead : null;
}

export function annotationCounts(algorithmId) {
  const counts = {
    confirmed: 0,
    false_positive: 0,
    observed_early: 0,
    missed: 0,
    inconclusive: 0,
  };
  let earlyLeadMsTotal = 0;
  let earlyLeadCount = 0;
  for (const a of state.annotations) {
    if (algorithmId && a.algorithmId !== algorithmId) continue;
    if (counts[a.annotationType] !== undefined) {
      counts[a.annotationType] += 1;
    }
    const lead = earlyLeadMs(a);
    if (lead !== null) {
      earlyLeadMsTotal += lead;
      earlyLeadCount += 1;
    }
  }
  return {
    counts,
    meanEarlyLeadMs: earlyLeadCount === 0 ? null : earlyLeadMsTotal / earlyLeadCount,
    earlyDetectionsWithLead: earlyLeadCount,
  };
}
