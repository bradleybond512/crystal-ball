/**
 * R4-LOW-008: durable calibration evidence.
 *
 * Covers the scored projections (privacy + rebuild idempotency), the
 * byte-for-byte digest agreement with the sidecar, the fold, the journal
 * client against a REAL node:sqlite EvidenceStore behind a fake fetch, and an
 * end-to-end "WebKit reset" rebuild through the app wiring.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const memory = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, String(value)); },
  removeItem: (key: string) => { memory.delete(key); },
  clear: () => memory.clear(),
};

import { EvidenceStore, canonicalJson as sidecarCanonicalJson, normalizeEvidenceEntry } from '../../../../src-tauri/sidecar/evidence-store.mjs';
import { setEvidenceChangeHandler } from '../evidence-bus.ts';
import {
  EVIDENCE_ROUTES,
  createEvidenceJournal,
  isLoopbackBase,
  type EvidenceSourceAdapter,
} from '../evidence-journal.ts';
import {
  CLAIM_NOT_RETAINED,
  canonicalJson,
  emaForecastFromEvidence,
  foldLatest,
  forecastFromEvidence,
  outcomeFromEvidence,
  projectEmaForecast,
  projectEmaTotals,
  projectForecast,
  projectOutcome,
  sha256Hex,
  type EvidenceEntry,
  type JournalEntry,
} from '../evidence-projection.ts';
import type { PredictionRecord } from '../forecast-calibration.ts';
import type { OutcomeRecord } from '../outcome-ledger.ts';

const T0 = 1_790_000_000_000;
const BASE = 'http://127.0.0.1:46123';

function resolvedForecast(overrides: Partial<PredictionRecord> = {}): PredictionRecord {
  return {
    id: 'fc-1',
    sourceId: 'analyst-loop',
    targetKey: 'market:SPY:drawdown:2s',
    domain: 'markets' as PredictionRecord['domain'],
    claim: 'S&P -2 sigma drawdown within 24h',
    probability: 0.7,
    predictedAt: T0,
    resolveBy: T0 + 86_400_000,
    status: 'resolved_true',
    resolvedAt: T0 + 3_600_000,
    resolutionNote: 'proxy: VIX closed above 30 per cboe.com',
    resolutionProvenance: {
      resolverId: 'market-move',
      kind: 'proxy',
      evidence: [{ sourceIds: ['cboe'], observedAt: T0, reference: 'https://cboe.com/x', value: 31 }],
    },
    algorithmVersion: 'analyst-v3',
    ...overrides,
  };
}

function outcomeRecord(overrides: Partial<OutcomeRecord> = {}): OutcomeRecord {
  return {
    id: 'oc-1',
    alertId: 'nws-tornado-warning-Springfield-County',
    situationId: 'sit-42',
    domain: 'weather',
    predictedSeverity: 'high',
    actualOutcome: 'marked-false-positive',
    driverScores: { radar: 0.9 },
    notes: 'neighbour said it missed us',
    recordedAt: new Date(T0),
    ...overrides,
  };
}

// ── Projections ───────────────────────────────────────────────────────────

test('forecast projection keeps scored fields only and hashes the target key', async () => {
  const entry = await projectForecast(resolvedForecast());
  assert.deepEqual(Object.keys(entry.payload).sort(), [
    'algorithmVersion', 'domain', 'id', 'noteOrigin', 'predictedAt', 'probability', 'provenanceKind',
    'resolveBy', 'resolvedAt', 'resolverId', 'sourceId', 'status', 'targetKeyHash',
  ]);
  const text = canonicalJson(entry.payload);
  for (const secret of ['S&P', 'VIX', 'cboe', 'SPY']) assert.equal(text.includes(secret), false, secret);
  assert.equal(entry.payload.targetKeyHash, `sha256:${await sha256Hex('market:SPY:drawdown:2s')}`);
  assert.equal(entry.payload.noteOrigin, 'proxy');
  assert.equal(entry.digest, await sha256Hex(text));
});

test('outcome projection drops notes and driver scores and hashes ids', async () => {
  const entry = await projectOutcome(outcomeRecord());
  const text = canonicalJson(entry.payload);
  for (const secret of ['neighbour', 'radar', 'Springfield', 'sit-42']) assert.equal(text.includes(secret), false, secret);
  assert.match(String(entry.payload.alertIdHash), /^sha256:[0-9a-f]{64}$/);
  assert.match(String(entry.payload.situationIdHash), /^sha256:[0-9a-f]{64}$/);
});

test('rebuilt records project to the same digest and keep proxy/direct classification', async () => {
  const original = await projectForecast(resolvedForecast());
  const rebuilt = forecastFromEvidence(original.payload);
  assert.ok(rebuilt);
  assert.equal(rebuilt.claim, CLAIM_NOT_RETAINED);
  assert.equal(rebuilt.resolutionNote?.startsWith('proxy:'), true);
  assert.equal(rebuilt.resolutionProvenance?.kind, 'proxy');
  assert.equal((await projectForecast(rebuilt)).digest, original.digest);

  const direct = await projectForecast(resolvedForecast({ id: 'fc-d', resolutionNote: 'direct: hit', resolutionProvenance: undefined, algorithmVersion: '' }));
  assert.equal((await projectForecast(forecastFromEvidence(direct.payload)!)).digest, direct.digest);

  const outcome = await projectOutcome(outcomeRecord());
  assert.equal((await projectOutcome(outcomeFromEvidence(outcome.payload)!)).digest, outcome.digest);

  const ema = await projectEmaForecast({ id: 'pred-Kyiv-1', region: 'Kyiv', risk24h: 72, baselineCount: 4, createdAt: T0, resolvedAt: T0 + 1, hit: false });
  assert.equal((await projectEmaForecast(emaForecastFromEvidence(ema.payload)!)).digest, ema.digest);
});

test('renderer digests match the sidecar byte for byte', async () => {
  const entries = [
    await projectForecast(resolvedForecast()),
    await projectForecast(resolvedForecast({ id: 'fc-p', status: 'pending', resolvedAt: undefined, resolutionNote: undefined, resolutionProvenance: undefined, targetKey: undefined })),
    await projectOutcome(outcomeRecord()),
    await projectEmaForecast({ id: 'pred-Kyiv-1', region: 'Kyiv, Ukraine', risk24h: 72.5, baselineCount: 4, createdAt: T0 }),
    (await projectEmaTotals({ totalHits: 5, totalMisses: 3, updatedAt: T0 }))!,
  ];
  for (const entry of entries) {
    const normalized = normalizeEvidenceEntry({ kind: entry.kind, payload: entry.payload });
    assert.ok(normalized.entry, `${entry.kind}: ${normalized.error}`);
    assert.equal(normalized.entry.digest, entry.digest, entry.kind);
  }
  const accent = String.fromCodePoint(233);
  const awkward = { b: 1, B: 2, a: [3, { [accent]: true, z: null }], _: 0.1 + 0.2, '10': 'x', '9': 'y' };
  assert.equal(canonicalJson(awkward), sidecarCanonicalJson(awkward));
});

test('totals snapshots need a stable timestamp and something to keep', async () => {
  assert.equal(await projectEmaTotals({ totalHits: 0, totalMisses: 0, updatedAt: T0 }), null);
  assert.equal(await projectEmaTotals({ totalHits: 2, totalMisses: 1 }), null);
});

test('fold prefers later states over arrival order, then the newest row', () => {
  const row = (seq: number, kind: JournalEntry['kind'], recordId: string, payload: Record<string, unknown>): JournalEntry => (
    { seq, kind, recordId, digest: String(seq), recordedAt: T0, payload }
  );
  const folded = foldLatest([
    row(1, 'forecast', 'a', { status: 'resolved_false' }),
    row(2, 'forecast', 'a', { status: 'pending' }),
    row(3, 'forecast', 'b', { status: 'pending' }),
    row(4, 'forecast', 'b', { status: 'pending', probability: 0.4 }),
  ]);
  const byId = new Map(folded.map((entry) => [entry.recordId, entry.seq]));
  assert.equal(byId.get('a'), 1);
  assert.equal(byId.get('b'), 4);
  const totals = foldLatest([
    row(5, 'ema-forecast-totals', 'totals', { totalHits: 9, totalMisses: 1 }),
    row(6, 'ema-forecast-totals', 'totals', { totalHits: 3, totalMisses: 1 }),
  ]);
  assert.equal(totals[0]?.seq, 5);
});

// ── Client against a real journal ─────────────────────────────────────────

let dir = '';
let store: EvidenceStore;
let calls: string[] = [];

beforeEach(() => {
  memory.clear();
  dir = mkdtempSync(path.join(tmpdir(), 'evidence-client-'));
  store = new EvidenceStore({ dbPath: path.join(dir, 'evidence.db') });
  calls = [];
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
  setEvidenceChangeHandler(null);
});

function storeFetch(target: EvidenceStore) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const parsed = new URL(url);
    calls.push(`${init?.method ?? 'GET'} ${parsed.pathname}`);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const params = parsed.searchParams;
    switch (parsed.pathname) {
      case EVIDENCE_ROUTES.missing: return Response.json({ missing: target.missing(body.entries) });
      case EVIDENCE_ROUTES.append: return Response.json(target.append(body.entries));
      case EVIDENCE_ROUTES.records: return Response.json(target.records({
        kind: params.get('kind'),
        beforeSeq: Number(params.get('before_seq')) || undefined,
        limit: Number(params.get('limit')) || undefined,
      }));
      case EVIDENCE_ROUTES.summary: return Response.json(target.summary());
      case EVIDENCE_ROUTES.export: return new Response(target.exportJsonl());
      default: return new Response('not found', { status: 404 });
    }
  };
}

function fakeSource(entries: () => Promise<EvidenceEntry[]>, overrides: Partial<EvidenceSourceAdapter> = {}): EvidenceSourceAdapter {
  return {
    kind: 'forecast',
    capacity: 500,
    rebuildKinds: ['forecast'],
    collect: entries,
    localCount: () => 0,
    mergeRebuilt: () => 0,
    ...overrides,
  };
}

test('every journal route is on the local-only prefix the fetch patch never sends to the cloud', () => {
  for (const route of Object.values(EVIDENCE_ROUTES)) assert.ok(route.startsWith('/api/local-'), route);
  assert.equal(isLoopbackBase(BASE), true);
  assert.equal(isLoopbackBase('http://[::1]:46123'), true);
  assert.equal(isLoopbackBase('http://localhost:46123'), false);
  assert.equal(isLoopbackBase('https://api.crystalball.example'), false);
  assert.equal(isLoopbackBase(''), false);
});

test('the client makes no request outside the desktop app or to a non-loopback base', async () => {
  const source = fakeSource(async () => [await projectForecast(resolvedForecast())]);
  const offline = createEvidenceJournal({ fetch: storeFetch(store), baseUrl: () => BASE, available: () => false, sources: [source] });
  await assert.rejects(offline.reconcile(), /desktop app/);
  assert.equal(await offline.summary(), null);
  const remote = createEvidenceJournal({ fetch: storeFetch(store), baseUrl: () => 'https://cloud.example', available: () => true, sources: [source] });
  await assert.rejects(remote.reconcile(), /loopback/);
  assert.deepEqual(calls, []);
});

test('reconcile appends only what the journal lacks and remembers what it confirmed', async () => {
  let records = [resolvedForecast(), resolvedForecast({ id: 'fc-2', status: 'pending', resolvedAt: undefined })];
  const source = fakeSource(() => Promise.all(records.map((r) => projectForecast(r))));
  const journal = createEvidenceJournal({ fetch: storeFetch(store), baseUrl: () => BASE, available: () => true, sources: [source] });

  const first = await journal.reconcile();
  assert.deepEqual(first, { checked: 2, sent: 2, appended: 2, rejected: 0 });
  calls = [];
  assert.deepEqual(await journal.reconcile(), { checked: 2, sent: 0, appended: 0, rejected: 0 });
  assert.deepEqual(calls, [], 'confirmed entries are not re-queried');

  records = [records[0]!, resolvedForecast({ id: 'fc-2', status: 'resolved_false' })];
  const third = await journal.reconcile();
  assert.equal(third.appended, 1);
  assert.equal(store.summary().byKind.forecast, 3, 'the resolution is a new row; the pending row stays');
});

test('entries the journal already holds are confirmed by one query and never re-queried', async () => {
  const entry = await projectForecast(resolvedForecast());
  store.append([{ kind: entry.kind, payload: entry.payload }]);
  const journal = createEvidenceJournal({
    fetch: storeFetch(store), baseUrl: () => BASE, available: () => true, sources: [fakeSource(async () => [entry])],
  });
  assert.deepEqual(await journal.reconcile(), { checked: 1, sent: 0, appended: 0, rejected: 0 });
  assert.deepEqual(calls, [`POST ${EVIDENCE_ROUTES.missing}`]);
  calls = [];
  await journal.reconcile();
  assert.deepEqual(calls, []);
});

test('a rejected entry is reported once and not resent until it changes', async () => {
  const logs: string[] = [];
  const bad = await projectForecast(resolvedForecast({ id: 'fc-bad' }));
  bad.payload.probability = 2;
  bad.digest = await sha256Hex(canonicalJson(bad.payload));
  const source = fakeSource(async () => [bad, await projectForecast(resolvedForecast())]);
  const journal = createEvidenceJournal({
    fetch: storeFetch(store), baseUrl: () => BASE, available: () => true, sources: [source], log: (m) => logs.push(m),
  });
  const first = await journal.reconcile();
  assert.equal(first.appended, 1);
  assert.equal(first.rejected, 1);
  assert.deepEqual(logs, ['evidence journal rejected entries']);
  calls = [];
  await journal.reconcile();
  assert.deepEqual(calls, []);
});

test('rebuild folds the newest journal entries into an empty ledger and skips a full one', async () => {
  store.append([
    { kind: 'forecast', payload: (await projectForecast(resolvedForecast({ status: 'pending', resolvedAt: undefined, resolutionNote: undefined, resolutionProvenance: undefined }))).payload },
    { kind: 'forecast', payload: (await projectForecast(resolvedForecast())).payload },
  ]);
  const merged: JournalEntry[][] = [];
  const empty = fakeSource(async () => [], { mergeRebuilt: (byKind) => { merged.push(byKind.forecast ?? []); return 1; } });
  const journal = createEvidenceJournal({ fetch: storeFetch(store), baseUrl: () => BASE, available: () => true, sources: [empty] });
  const report = await journal.rebuild();
  assert.deepEqual(report.added, { forecast: 1 });
  assert.equal(merged[0]?.length, 1);
  assert.equal(merged[0]?.[0]?.payload.status, 'resolved_true');

  calls = [];
  let fullMerges = 0;
  const full = fakeSource(async () => [], { localCount: () => 500, mergeRebuilt: () => { fullMerges++; return 0; } });
  await createEvidenceJournal({ fetch: storeFetch(store), baseUrl: () => BASE, available: () => true, sources: [full] }).rebuild();
  assert.equal(fullMerges, 0, 'a full working ledger must never invoke rebuild merge');
  assert.deepEqual(calls, [`GET ${EVIDENCE_ROUTES.summary}`], 'a full ledger never fetches historical records');
});

test('export reconciles first, then returns the journal as JSONL', async () => {
  const source = fakeSource(async () => [await projectForecast(resolvedForecast())]);
  const journal = createEvidenceJournal({ fetch: storeFetch(store), baseUrl: () => BASE, available: () => true, sources: [source] });
  const lines = (await journal.exportJsonl()).trimEnd().split('\n');
  assert.equal(JSON.parse(lines[0]!).type, 'crystal-ball-evidence-export');
  assert.equal(lines.length, 2);
});

// ── End to end through the app wiring: a WebKit reset ─────────────────────

test('all three ledgers survive a WebKit storage reset', async () => {
  const outcomeLedger = await import('../outcome-ledger.ts');
  const adapter = await import('../forecast-calibration-adapter.ts');
  const accuracy = await import('../../forecast-accuracy.ts');
  const wiring = await import('../evidence-journal-wiring.ts');
  const reset = () => {
    memory.clear();
    outcomeLedger.__resetOutcomeLedgerSingleton();
    adapter._resetCalibrationForTests();
    accuracy.__resetForecastAccuracyForTests();
  };
  reset();

  const changed: string[] = [];
  setEvidenceChangeHandler((kind) => changed.push(kind));
  outcomeLedger.getOutcomeLedger().record({ domain: 'weather', predictedSeverity: 'high', actualOutcome: 'confirmed-real', recordedAt: new Date(T0), notes: 'secret' });
  outcomeLedger.getOutcomeLedger().record({ domain: 'cyber', predictedSeverity: 'low', actualOutcome: 'dismissed', recordedAt: new Date(T0 + 1) });
  // mergeRebuiltPredictions persists through the same path as recordPrediction,
  // without recordPrediction's paired baseline forecasts.
  adapter.mergeRebuiltPredictions([
    resolvedForecast({ id: 'fc-e2e-1' }),
    resolvedForecast({ id: 'fc-e2e-2', status: 'resolved_false', probability: 0.2 }),
  ]);
  accuracy.mergeRebuiltForecastAccuracy(
    [{ id: 'pred-Kyiv-1', region: 'Kyiv', risk24h: 80, baselineCount: 2, createdAt: T0, resolvedAt: T0 + 5, hit: true }],
    { totalHits: 7, totalMisses: 2, updatedAt: T0 + 5 },
  );
  assert.ok(changed.includes('alert-outcome') && changed.includes('forecast') && changed.includes('ema-forecast'));
  const before = {
    outcomes: outcomeLedger.getOutcomeLedger().stats(),
    brier: adapter.getCalibrationStore().brier(),
    accuracy: accuracy.getForecastAccuracyEvidence().totals,
  };

  const journal = createEvidenceJournal({
    fetch: storeFetch(store), baseUrl: () => BASE, available: () => true, sources: wiring.buildEvidenceSources(),
  });
  const sent = await journal.reconcile();
  assert.equal(sent.appended, 2 + 2 + 2, 'two outcomes, two forecasts, one EMA prediction and its totals');

  reset();
  assert.equal(outcomeLedger.getOutcomeLedger().list().length, 0);

  const rebuilt = createEvidenceJournal({
    fetch: storeFetch(store), baseUrl: () => BASE, available: () => true, sources: wiring.buildEvidenceSources(),
  });
  const report = await rebuilt.rebuild();
  assert.deepEqual(report.added, { forecast: 2, 'alert-outcome': 2, 'ema-forecast': 1 });
  assert.deepEqual(outcomeLedger.getOutcomeLedger().stats(), before.outcomes);
  assert.deepEqual(adapter.getCalibrationStore().brier(), before.brier);
  assert.deepEqual(accuracy.getForecastAccuracyEvidence().totals, before.accuracy);
  assert.equal(adapter.getCalibrationStore().get('fc-e2e-1')?.claim, CLAIM_NOT_RETAINED);
  assert.equal(outcomeLedger.getOutcomeLedger().list().some((r) => r.notes !== undefined), false);

  // Merging what is already present is a no-op for every ledger.
  assert.equal(outcomeLedger.getOutcomeLedger().mergeRebuilt(outcomeLedger.getOutcomeLedger().list()), 0);
  assert.equal(adapter.mergeRebuiltPredictions(adapter.getCalibrationStore().all()), 0);
  assert.equal(accuracy.mergeRebuiltForecastAccuracy(accuracy.getForecastAccuracyEvidence().predictions), 0);
  assert.equal(outcomeLedger.getOutcomeLedger().list().length, 2);

  calls = [];
  const after = await rebuilt.reconcile();
  assert.equal(after.appended, 0, 'rebuilt records never re-append');
});

test('a corrupt forecast-accuracy blob no longer throws', async () => {
  const accuracy = await import('../../forecast-accuracy.ts');
  memory.set('crystalball-forecast-accuracy-v1', JSON.stringify({
    predictions: [{ id: 'a', region: 'r', risk24h: 70, baselineCount: 2, createdAt: T0 }, { bad: true }, 7],
    totalHits: 'many',
    totalMisses: 2,
  }));
  accuracy.__resetForecastAccuracyForTests();
  const evidence = accuracy.getForecastAccuracyEvidence();
  assert.equal(evidence.predictions.length, 1);
  assert.deepEqual([evidence.totals.totalHits, evidence.totals.totalMisses], [0, 2]);
  assert.doesNotThrow(() => accuracy.getForecastAccuracy());

  memory.set('crystalball-forecast-accuracy-v1', '{"predictions": 5}');
  accuracy.__resetForecastAccuracyForTests();
  assert.deepEqual(accuracy.getForecastAccuracyEvidence().predictions, []);
  assert.doesNotThrow(() => accuracy.getForecastAccuracy());
});


// B1–B3 use the existing producer and app wiring APIs, including pre-start changes.
async function mainJournal() {
  (globalThis as any).window = { __TAURI_INTERNALS__: {}, location: { search: '' }, navigator: {} };
  globalThis.fetch = storeFetch(store) as typeof fetch;
  const wiring = await import('../evidence-journal-wiring.ts');
  return wiring.getEvidenceJournal();
}

function sqlEntries(kind: string) {
  const rows: any[] = [];
  let beforeSeq: number | undefined;
  do {
    const page = store.records({ kind, limit: 1000, beforeSeq });
    rows.push(...page.entries);
    beforeSeq = page.nextBeforeSeq ?? undefined;
  } while (beforeSeq !== undefined);
  return rows;
}

test('B1 real forecast mutations retain pre-cap states and automatic baselines before first flush', async () => {
  const adapter = await import('../forecast-calibration-adapter.ts');
  adapter._resetCalibrationForTests();
  memory.set('crystalball-forecast-calibration-v1', JSON.stringify([resolvedForecast({ id: 'B1-hydrated', targetKey: 'mode:test', predictedAt: T0 - 1000, resolvedAt: T0 - 500, resolutionNote: 'direct: private', resolutionProvenance: undefined })]));
  const journal = await mainJournal();
  const pending = (id: string, n: number) => resolvedForecast({ id, predictedAt: T0 + n, status: 'pending', resolvedAt: undefined, resolutionNote: undefined, resolutionProvenance: undefined });
  adapter.recordPrediction({ ...pending('B1-baseline-target', 0), targetKey: 'mode:test' });
  const baselineIds = adapter.getCalibrationStore().all().filter(r => r.sourceId === 'persistence-baseline').map(r => r.id);
  assert.ok(baselineIds.length > 0, 'actual baseline builder emits a baseline in this fixture');
  adapter.recordPrediction(pending('B1-resolve', 1));
  adapter.resolvePrediction('B1-resolve', true, T0 + 2);
  adapter.recordPrediction(pending('B1-expire', 3));
  adapter.expirePrediction('B1-expire', T0 + 4, 'proxy: private note');
  adapter.recordPrediction(pending('B1-bulk', 5));
  adapter.expirePendingPredictions(T0 + 86_400_010);
  adapter.recordPrediction({ ...pending('B1-resolver-expire', 6), criteria: { kind: 'market_move', symbol: 'SPY', direction: 'up', minAbsPct: 1, basisPrice: 100, basisObservedAt: T0 } });
  adapter.recordPrediction({ ...pending('B1-resolver-resolve', 7), criteria: { kind: 'market_move', symbol: 'SPY', direction: 'up', minAbsPct: 1, basisPrice: 100, basisObservedAt: T0 } });
  assert.equal(adapter.dispatchOutcomeResolvers({ now: T0 + 7 * 86_400_000 } as any, [{ id: 'fixture-expiry', canResolve: r => r.id.startsWith('B1-resolver-'), resolve: r => r.id === 'B1-resolver-resolve' ? { outcome: false } : null }]), 1);
  adapter.recordPredictions(Array.from({ length: 505 }, (_, i) => pending(`B1-batch-${i}`, 100 + i)));
  assert.equal(adapter.getCalibrationStore().all().length, 500);
  await journal.reconcile();
  const rows = sqlEntries('forecast');
  assert.equal(rows.filter((r: any) => r.recordId === 'B1-resolve').length, 2, 'earliest pending and resolved forecast must both survive cap');
  assert.equal(rows.filter((r: any) => r.recordId === 'B1-expire').length, 2, 'single expiry retains both states');
  assert.equal(rows.filter((r: any) => r.recordId === 'B1-bulk').length, 2, 'bulk expiry retains both states');
  for (let i = 0; i < 505; i++) assert.ok(rows.some((r: any) => r.recordId === `B1-batch-${i}`), `batch forecast ${i} retained`);
  for (const id of baselineIds) assert.deepEqual(rows.filter((r: any) => r.recordId === id).map((r: any) => r.payload.status).sort(), ['expired', 'pending'], 'automatic baseline creation and expiry states retained');
  assert.equal(rows.filter((r: any) => r.recordId === 'B1-hydrated').length, 1, 'hydrated state captured before eviction');
  assert.equal(rows.filter((r: any) => r.recordId === 'B1-resolver-expire').length, 2, 'resolver-owned expiry retains pending and expired states');
  assert.equal(rows.filter((r: any) => r.recordId === 'B1-resolver-resolve').length, 2, 'resolver dispatch retains pending and resolved states');
});

test('B2 real outcome records retain every state before the 2000-row cap and first flush', async () => {
  const outcomes = await import('../outcome-ledger.ts');
  outcomes.__resetOutcomeLedgerSingleton();
  const journal = await mainJournal();
  const ids: string[] = [];
  for (let i = 0; i < 2003; i++) ids.push(outcomes.getOutcomeLedger().record({ domain: 'weather', predictedSeverity: 'high', actualOutcome: 'confirmed-real', recordedAt: new Date(T0 + i) }).id);
  assert.equal(outcomes.getOutcomeLedger().stats().total, 2000);
  await journal.reconcile();
  const rows = sqlEntries('alert-outcome');
  assert.equal(rows.length, 2003, 'all emitted outcomes survive, including the three evicted before flush');
  for (let i = 0; i < ids.length; i++) assert.ok(rows.some((r: any) => r.recordId === ids[i] && r.payload.recordedAt === T0 + i));
});

test('B3 scheduled EMA producer retains one-run overflow, resolutions and each totals increment', async () => {
  const accuracy = await import('../../forecast-accuracy.ts');
  const ema = await import('../../ema-forecast.ts');
  accuracy.__resetForecastAccuracyForTests();
  ema.resetForecast();
  memory.set('crystalball-forecast-accuracy-v1', JSON.stringify({ predictions: [
    { id: 'B3-old-a', region: 'old-a', risk24h: 80, baselineCount: 2, createdAt: T0 - 86_400_001 },
    { id: 'B3-old-b', region: 'old-b', risk24h: 80, baselineCount: 2, createdAt: T0 - 86_400_001 },
  ], totalHits: 0, totalMisses: 0 }));
  const journal = await mainJournal();
  const callbacks: Array<() => void> = [];
  (globalThis as any).window.setTimeout = (fn: () => void) => { callbacks.push(fn); return 1; };
  (globalThis as any).window.setInterval = (fn: () => void) => { callbacks.push(fn); return 2; };
  const originalNow = Date.now;
  const { unifiedAlertStore } = await import('../../unified-alerts.ts');
  const originalAlerts = unifiedAlertStore.getAll;
  unifiedAlertStore.getAll = () => Array.from({ length: 4 }, () => ({ timestamp: T0, location: { label: 'old-a' } })) as any;
  Date.now = () => T0;
  try {
    accuracy.startForecastAccuracy();
    callbacks[0]!();
    for (let i = 0; i < 103; i++) {
      for (let j = 0; j < 23; j++) ema.updateRegionCount(`B3-region-${i}`, 1);
      ema.updateRegionCount(`B3-region-${i}`, 100);
    }
    assert.equal(ema.forecastRegions().filter(r => r.risk24h >= 65).length, 103);
    callbacks[1]!();
    assert.equal(accuracy.getForecastAccuracyEvidence().predictions.length, 100);
    await journal.reconcile();
    assert.equal(sqlEntries('ema-forecast').filter((r: any) => String(r.recordId).startsWith('pred-B3-region-')).length, 103, 'earliest EMA pending states survive single-run cap');
    assert.equal(sqlEntries('ema-forecast').filter((r: any) => String(r.recordId).startsWith('B3-old-')).length, 4, 'hydrated pending and resolved EMA states survive later eviction');
    assert.deepEqual(sqlEntries('ema-forecast-totals').map((r: any) => [r.payload.totalHits, r.payload.totalMisses]).sort(), [[1, 0], [1, 1]], 'each hit and miss totals increment is a distinct snapshot');
    assert.equal(sqlEntries('ema-forecast').find((r: any) => r.recordId === 'B3-old-a' && r.payload.resolvedAt)?.payload.hit, true);
    assert.equal(sqlEntries('ema-forecast').find((r: any) => r.recordId === 'B3-old-b' && r.payload.resolvedAt)?.payload.hit, false);
  } finally { Date.now = originalNow; unifiedAlertStore.getAll = originalAlerts; ema.resetForecast(); }
});

// B4–B9 exercise new contracts behaviorally. Root QA mutates these on the clean freeze.
import {
  createEvidenceOutbox, isEvidenceCaptureOwner, OUTBOX_NAMESPACE, OUTBOX_SLOTS,
  OUTBOX_STORAGE_BYTES, OUTBOX_TRANSIENT_BYTES, OUTBOX_WORKERS,
} from '../evidence-outbox.ts';
import { projectEvidenceDraft, type EvidenceDraft } from '../evidence-projection.ts';

function localOutbox(overrides: Partial<Parameters<typeof createEvidenceOutbox>[0]> = {}) {
  return createEvidenceOutbox({ storage: () => (globalThis as any).localStorage, available: () => true, clock: () => T0, ...overrides });
}
const emaChange = (id: string) => ({ kind: 'ema-forecast' as const, record: { id, region: 'region', risk24h: 80, baselineCount: 2, createdAt: T0 } });
const flushMicrotasks = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function queueJournal(outbox: ReturnType<typeof createEvidenceOutbox>, fetch = storeFetch(store), timers?: any) {
  return createEvidenceJournal({ fetch, baseUrl: () => BASE, available: () => true, sources: [], outbox, timers });
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

class FakeClock {
  now = 0;
  next = 0;
  jobs = new Map<number, { at: number; callback: () => void; interval?: number }>();
  setTimeout = (callback: () => void, ms: number) => { const id = ++this.next; this.jobs.set(id, { at: this.now + ms, callback }); return id; };
  clearTimeout = (id: number) => { this.jobs.delete(id); };
  setInterval = (callback: () => void, ms: number) => { const id = ++this.next; this.jobs.set(id, { at: this.now + ms, callback, interval: ms }); return id; };
  clearInterval = this.clearTimeout;
  async advance(ms: number) {
    const end = this.now + ms;
    for (;;) {
      const due = [...this.jobs.entries()].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, job] = due;
      this.now = job.at;
      if (job.interval) job.at += job.interval; else this.jobs.delete(id);
      job.callback(); await flushMicrotasks();
    }
    this.now = end; await flushMicrotasks();
  }
  delays() { return [...this.jobs.values()].map(job => job.at - this.now).sort((a, b) => a - b); }
}

// Hash delay, not a fake digest: all final payloads use actual WebCrypto and real SQL.
test('B4 snapshots all scored primitives before delayed hashing and persists no raw hash inputs', async () => {
  const gate = deferred();
  const outbox = localOutbox({ project: async draft => { await gate.promise; return projectEvidenceDraft(draft); } });
  const record = resolvedForecast({ id: 'B4', status: 'pending', resolvedAt: undefined });
  const expected = await projectForecast(record);
  assert.equal(outbox.capture({ kind: 'forecast', record }).status, 'admitted');
  const marker = memory.get(`${OUTBOX_NAMESPACE}slot:0`)!;
  assert.deepEqual(Object.keys(JSON.parse(marker)).sort(), ['admission', 'admittedAt', 'kind', 'phase', 'reservedBytes', 'token', 'v']);
  for (const raw of ['B4', 'market:SPY', 'S&P', 'cboe', 'proxy:', 'probability', 'targetKey', 'coordinates']) assert.equal(marker.includes(raw), false, raw);
  record.probability = 0.1;
  record.status = 'resolved_false';
  record.resolvedAt = T0 + 10;
  record.resolutionProvenance!.resolverId = 'changed';
  record.resolutionNote = 'direct: changed note';
  record.targetKey = 'changed raw key';
  assert.equal(outbox.capture({ kind: 'forecast', record }).status, 'admitted');
  const mark = outbox.watermark();
  gate.resolve(); await outbox.materializeThrough(mark);
  const ready = outbox.readyThrough(mark);
  assert.equal(ready.length, 2);
  assert.deepEqual(ready[0]!.payload, expected.payload, 'emission-time probability/status/provenance are immutable');
  assert.equal(ready[0]!.digest, expected.digest);
  assert.equal(ready[1]!.payload.status, 'resolved_false');
  for (const [key, raw] of memory) if (key.startsWith(OUTBOX_NAMESPACE)) {
    for (const secret of ['market:SPY', 'changed raw key', 'S&P', 'cboe.com', 'changed note']) assert.equal(raw.includes(secret), false, secret);
  }
  await queueJournal(outbox).reconcile();
  assert.equal(sqlEntries('forecast').length, 2);
  assert.equal(outbox.diagnostics().slots, 0);
  assert.equal(outbox.diagnostics().transientBytes, 0, 'exact acknowledgements release all transient hash inputs');
});

test('B4 browser and actual standalone HTML/query windows cannot capture or recover markers', () => {
  const oldWindow = (globalThis as any).window;
  for (const location of [ { pathname: '/settings.html', search: '' }, { pathname: '/live-channels.html', search: '' }, { pathname: '/index.html', search: '?settings=1' }, { pathname: '/', search: '?live-channels=1' } ]) {
    (globalThis as any).window = { __TAURI_INTERNALS__: {}, location };
    assert.equal(isEvidenceCaptureOwner(), false);
  }
  (globalThis as any).window = { location: { pathname: '/', search: '' }, navigator: {} };
  assert.equal(isEvidenceCaptureOwner(), false);
  const outbox = localOutbox({ available: () => false });
  assert.equal(outbox.capture(emaChange('inactive')).status, 'inactive');
  assert.equal(memory.size, 0);
  (globalThis as any).window = oldWindow;
});

test('B5 saved ready states replay after restart and lost working ledgers exactly once in SQL', async () => {
  const first = localOutbox();
  for (let i = 0; i < 104; i++) first.capture(emaChange(`B5-${i}`));
  await first.materializeThrough(first.watermark());
  const down = queueJournal(first, async () => new Response('', { status: 503 }));
  await assert.rejects(down.reconcile(), /503/);
  assert.equal(first.diagnostics().savedAwaitingSync, 104);
  const restarted = localOutbox();
  await queueJournal(restarted).reconcile();
  assert.equal(sqlEntries('ema-forecast').length, 104);
  assert.equal(restarted.diagnostics().slots, 0);
  await queueJournal(restarted).reconcile();
  assert.equal(sqlEntries('ema-forecast').length, 104);
});

test('B5 interrupted markers become restart-retained explicit refusals before being freed', () => {
  const dormant = localOutbox({ schedule: () => undefined });
  dormant.capture(emaChange('B5-private-not-in-marker'));
  const restarted = localOutbox({ schedule: () => undefined });
  assert.equal(restarted.diagnostics().interrupted, 1);
  assert.equal(restarted.diagnostics().refused, 1);
  assert.equal(restarted.diagnostics().slots, 0);
  assert.equal(restarted.readyThrough(restarted.watermark()).length, 0);
  assert.equal(localOutbox().diagnostics().interrupted, 1);
  assert.equal([...memory.values()].join('').includes('B5-private-not-in-marker'), false);
});

test('B6 count ceiling is enforced before workers and retains every older admission', async () => {
  const tasks: Array<() => void> = [];
  const gate = deferred();
  const outbox = localOutbox({ schedule: fn => tasks.push(fn), project: async draft => { await gate.promise; return projectEvidenceDraft(draft); } });
  for (let i = 0; i < OUTBOX_SLOTS; i++) assert.equal(outbox.capture(emaChange(`B6-${i}`)).status, 'admitted');
  assert.equal(tasks.length, 1, 'one scheduler task, not one promise per emission');
  assert.equal(outbox.capture(emaChange('overflow')).reason, 'capacity');
  assert.equal(outbox.diagnostics().slots, OUTBOX_SLOTS);
  tasks.shift()!(); await flushMicrotasks();
  assert.equal(outbox.diagnostics().workers, OUTBOX_WORKERS);
  assert.equal(outbox.diagnostics().highWater.workers, OUTBOX_WORKERS);
  assert.ok(outbox.diagnostics().reservedBytes <= OUTBOX_STORAGE_BYTES);
  assert.ok(outbox.diagnostics().transientBytes <= OUTBOX_TRANSIENT_BYTES);
  const highWater = outbox.diagnostics().highWater;
  console.log('T2 performance B6 high-water', JSON.stringify(highWater));
  // Allow the finite admitted set to complete without creating unresolved owned jobs.
  gate.resolve();
  while (outbox.diagnostics().hashing > 0) {
    while (tasks.length) tasks.shift()!();
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(outbox.readyThrough(outbox.watermark()).length, OUTBOX_SLOTS);
});

test('B6 reserved and transient byte ceilings, input size and reachable scored payload size refuse visibly', () => {
  const reserved = localOutbox({ schedule: () => undefined });
  const wide = '\ud800';
  let reason: string | undefined;
  for (let i = 0; i < OUTBOX_SLOTS; i++) {
    const result = reserved.capture({ kind: 'forecast', record: resolvedForecast({ id: `B6-bytes-${i}`, sourceId: wide.repeat(128), domain: wide.repeat(64) as any, algorithmVersion: wide.repeat(128), resolutionProvenance: { kind: 'proxy', resolverId: wide.repeat(128), evidence: [] }, targetKey: undefined }) });
    if (result.status === 'refused') { reason = result.reason; break; }
  }
  assert.equal(reason, 'storage-bytes');
  assert.ok(reserved.diagnostics().reservedBytes <= OUTBOX_STORAGE_BYTES);
  memory.clear();
  const transient = localOutbox({ schedule: () => undefined });
  for (let i = 0; i < 1000; i++) {
    const result = transient.capture({ kind: 'forecast', record: resolvedForecast({ id: `B6-transient-${i}`, targetKey: 'x'.repeat(7000) }) });
    if (result.status === 'refused') { reason = result.reason; break; }
  }
  assert.equal(reason, 'transient-bytes');
  assert.ok(transient.diagnostics().transientBytes <= OUTBOX_TRANSIENT_BYTES);
  assert.equal(transient.capture({ kind: 'forecast', record: resolvedForecast({ targetKey: 'x'.repeat(8193) }) }).reason, 'input-size');
  assert.equal(transient.capture({ kind: 'forecast', record: resolvedForecast({ id: wide.repeat(200), sourceId: wide.repeat(128), domain: wide.repeat(64) as any, algorithmVersion: wide.repeat(128), resolutionProvenance: { kind: 'proxy', resolverId: wide.repeat(128), evidence: [] } }) }).reason, 'payload-size');
  console.log('T2 performance B6 byte high-water', JSON.stringify({ reserved: reserved.diagnostics().highWater, transient: transient.diagnostics().highWater }));
});

test('B6 quota failures at admission, ready replacement, removal and diagnostics remain truthful and bounded', async () => {
  let fail: 'marker' | 'ready' | 'remove' | 'diagnostics' | null = 'marker';
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if ((fail === 'marker' && value.includes('"phase":"hashing"')) || (fail === 'ready' && value.includes('"phase":"ready"')) || (fail === 'diagnostics' && key.endsWith('diagnostics'))) throw new Error('fixture quota');
      memory.set(key, value);
    },
    removeItem: (key: string) => { if (fail === 'remove') throw new Error('quota'); memory.delete(key); },
  };
  const outbox = localOutbox({ storage: () => storage });
  assert.equal(outbox.capture(emaChange('refused')).reason, 'storage-quota');
  assert.equal(outbox.diagnostics().workers, 0);
  fail = 'ready'; outbox.capture(emaChange('volatile'));
  await outbox.materializeThrough(outbox.watermark());
  assert.equal(outbox.diagnostics().awaitingStorage, 1);
  assert.equal(outbox.diagnostics().savedAwaitingSync, 0);
  assert.equal(JSON.parse(memory.get(`${OUTBOX_NAMESPACE}slot:0`)!).phase, 'hashing');
  fail = null; await outbox.materializeThrough(outbox.watermark());
  const receipt = outbox.readyThrough(outbox.watermark())[0]!;
  fail = 'remove'; assert.equal(outbox.ack(receipt), false);
  assert.equal(outbox.diagnostics().savedAwaitingSync, 1);
  fail = 'diagnostics'; assert.equal(outbox.reject(receipt), true);
  assert.equal(outbox.diagnostics().terminalBlocked, 1);
  assert.equal(outbox.diagnostics().diagnosticsUnsaved, true);
  assert.equal(outbox.diagnostics().refused, 2);
  assert.equal(outbox.diagnostics().storageFailures, 2);
  fail = null; await outbox.materializeThrough(outbox.watermark());
  assert.equal(outbox.diagnostics().slots, 0);
  assert.equal(localOutbox({ storage: () => storage }).diagnostics().refused, 2);
});

test('B6 invalid and over-ceiling persisted ready rows are quarantined without posting or silent deletion', async () => {
  memory.set(`${OUTBOX_NAMESPACE}slot:0`, '{"raw":"private malformed"}');
  const outbox = localOutbox();
  assert.equal(outbox.diagnostics().quarantined, 1);
  assert.equal(outbox.capture(emaChange('blocked')).reason, 'invalid-persisted');
  await assert.rejects(queueJournal(outbox).reconcile(), /pending/);
  assert.equal(calls.length, 0);
  assert.equal(memory.get(`${OUTBOX_NAMESPACE}slot:0`), '{"raw":"private malformed"}');
  assert.equal(memory.get(`${OUTBOX_NAMESPACE}diagnostics`)!.includes('private malformed'), false);
});

test('B7 an older in-flight exact acknowledgement preserves a newer state and cannot erase a reused slot', async () => {
  const outbox = localOutbox();
  outbox.capture(emaChange('B7'));
  await outbox.materializeThrough(outbox.watermark());
  const old = outbox.readyThrough(outbox.watermark())[0]!;
  const reply = deferred<Response>();
  const entered = deferred();
  const journal = queueJournal(outbox, async () => { entered.resolve(); return reply.promise; });
  const sending = journal.reconcile(); await entered.promise;
  outbox.capture({ kind: 'ema-forecast', record: { ...emaChange('B7').record, resolvedAt: T0 + 1, hit: true } });
  await outbox.materializeThrough(outbox.watermark());
  reply.resolve(Response.json({ results: [{ status: 'appended' }] }));
  await sending;
  const newer = outbox.readyThrough(outbox.watermark());
  assert.equal(newer.length, 1);
  assert.equal(newer[0]!.payload.hit, true);
  assert.notEqual(newer[0]!.digest, old.digest);
  outbox.capture(emaChange('B7-slot-reuse'));
  await outbox.materializeThrough(outbox.watermark());
  assert.equal(outbox.ack(old), false);
  assert.equal(outbox.readyThrough(outbox.watermark()).length, 2);
  await queueJournal(outbox).reconcile();
  assert.equal(sqlEntries('ema-forecast').length, 2);
});

test('B7 stop and restart prevents late completion from acknowledging any pending receipt', async () => {
  const outbox = localOutbox(); outbox.capture(emaChange('B7-stop'));
  await outbox.materializeThrough(outbox.watermark());
  const entered = deferred(); const reply = deferred<Response>();
  const journal = queueJournal(outbox, async () => { entered.resolve(); return reply.promise; });
  const sending = journal.reconcile(); await entered.promise;
  journal.stop();
  reply.resolve(Response.json({ results: [{ status: 'appended' }] }));
  await assert.rejects(sending, /stopped/);
  assert.equal(outbox.diagnostics().savedAwaitingSync, 1);
  await queueJournal(outbox).reconcile();
  assert.equal(outbox.diagnostics().slots, 0);
});

test('B8 partial, unknown and malformed append responses and HTTP failures retain every exact state', async () => {
  for (const response of [
    () => Response.json({ results: [] }), () => Response.json({ results: [{ status: 'appended' }, { status: 'duplicate' }] }),
    () => Response.json({ results: [{ status: 'unknown' }] }), () => Response.json({ results: [{ status: 'appended', id: 'unexpected' }] }),
    () => new Response('', { status: 507 }), () => new Response('', { status: 503 }),
  ]) {
    memory.clear(); const outbox = localOutbox(); outbox.capture(emaChange('B8'));
    const journal = queueJournal(outbox, async () => response());
    await assert.rejects(journal.reconcile());
    assert.equal(outbox.diagnostics().savedAwaitingSync, 1);
    assert.equal(outbox.diagnostics().refused, 0);
    if (outbox.diagnostics().journalFull) assert.equal(response().status, 507);
    await queueJournal(outbox).reconcile();
    assert.equal(outbox.diagnostics().slots, 0);
  }
});

test('B8 invalid missing indexes cannot confirm unsaved working states and terminal rejection is content-free', async () => {
  const entry = await projectForecast(resolvedForecast());
  for (const missing of [undefined, [9], [-1], [0, 0], ['0']]) {
    const journal = createEvidenceJournal({ fetch: async () => Response.json({ missing }), baseUrl: () => BASE, available: () => true, sources: [fakeSource(async () => [entry])] });
    await assert.rejects(journal.reconcile(), /missing indexes/);
    await assert.rejects(journal.reconcile(), /missing indexes/, 'ambiguous response never enters confirmation memo');
  }
  const outbox = localOutbox(); outbox.capture(emaChange('B8-reject')); outbox.capture(emaChange('B8-good'));
  const journal = queueJournal(outbox, async () => Response.json({ results: [{ status: 'rejected', reason: 'secret server body' }, { status: 'appended' }] }));
  const report = await journal.reconcile();
  assert.equal(report.rejected, 1); assert.equal(report.appended, 1);
  assert.equal(outbox.diagnostics().refused, 1); assert.equal(outbox.diagnostics().slots, 0);
  assert.equal([...memory.values()].join('').includes('secret server body'), false);
});

test('B8 identical rejected working state is memoized while changed digest retries', async () => {
  let entry = await projectForecast(resolvedForecast());
  let appends = 0;
  const journal = createEvidenceJournal({ fetch: async (url) => {
    if (url.endsWith('/missing')) return Response.json({ missing: [0] });
    appends++; return Response.json({ results: [{ status: 'rejected', reason: 'untrusted' }] });
  }, baseUrl: () => BASE, available: () => true, sources: [fakeSource(async () => [entry])] });
  await journal.reconcile(); await journal.reconcile(); assert.equal(appends, 1);
  entry = await projectForecast(resolvedForecast({ probability: 0.3 }));
  await journal.reconcile(); assert.equal(appends, 2);
});

test('B9 fixed first-run/debounce, failure retry and periodic reconciliation remain live during bursts', async () => {
  const timers = new FakeClock();
  const outbox = localOutbox();
  let fail = true; let requests = 0;
  let working = await projectForecast(resolvedForecast({ id: 'B9-working' }));
  const journal = createEvidenceJournal({ outbox, sources: [fakeSource(async () => [working])], baseUrl: () => BASE, available: () => true, timers, fetch: async (url, init) => {
    requests++;
    if (fail) return new Response('', { status: 503 });
    return storeFetch(store)(url, init);
  } });
  journal.start(); assert.equal(timers.delays()[0], 20_000);
  await timers.advance(20_000);
  assert.equal(requests, 1);
  assert.equal(timers.delays()[0], 30_000);
  for (let i = 0; i < 10; i++) { outbox.capture(emaChange(`B9-${i}`)); journal.noteChanged(); await timers.advance(1000); }
  assert.equal(requests, 1, 'enqueue cannot replace the fixed failure retry');
  assert.equal(timers.delays()[0], 20_000);
  fail = false;
  await outbox.materializeThrough(outbox.watermark());
  await timers.advance(20_000);
  // Wait for real WebCrypto/SQLite async cycle completion without advancing fake time.
  for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(outbox.diagnostics().savedAwaitingSync, 0);
  const afterRecovery = requests;
  outbox.capture(emaChange('B9-debounce-one')); await outbox.materializeThrough(outbox.watermark());
  journal.noteChanged(); await timers.advance(1000);
  outbox.capture(emaChange('B9-debounce-two')); await outbox.materializeThrough(outbox.watermark());
  journal.noteChanged(); await timers.advance(999);
  assert.equal(requests, afterRecovery, 'fixed debounce waits until its original due time');
  await timers.advance(1);
  assert.equal(requests, afterRecovery + 1, 'both new captures drain at the fixed due time');
  working = await projectForecast(resolvedForecast({ id: 'B9-working', probability: 0.3 }));
  await timers.advance(15 * 60_000);
  assert.equal(requests, afterRecovery + 3, 'periodic reconciliation finds a changed legacy working state');
  journal.stop(); assert.equal(timers.jobs.size, 0);
});

test('B9 finite watermark, 200-row append chunks and honest export pending hashing', async () => {
  const gate = deferred();
  const timers = new FakeClock();
  const slow = localOutbox({ project: async draft => { await gate.promise; return projectEvidenceDraft(draft); }, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout as any });
  slow.capture(emaChange('B9-hash-pending'));
  const exportAttempt = queueJournal(slow).exportJsonl();
  await flushMicrotasks(); await timers.advance(10_000);
  await assert.rejects(exportAttempt, /still hashing/);
  assert.equal(slow.diagnostics().hashing, 1);
  gate.resolve(); await slow.materializeThrough(slow.watermark());
  assert.equal((await queueJournal(slow).exportJsonl()).trim().split('\n').length, 2);
  memory.clear();
  const outbox = localOutbox();
  for (let i = 0; i < 405; i++) outbox.capture(emaChange(`B9-chunk-${i}`));
  const sizes: number[] = [];
  const journal = queueJournal(outbox, async (url, init) => {
    if (url.endsWith('/append')) sizes.push(JSON.parse(String(init!.body)).entries.length);
    return storeFetch(store)(url, init);
  });
  await assert.doesNotReject(journal.reconcile(), 'bounded append chunks must reconcile through real SQLite');
  assert.deepEqual(sizes, [200, 200, 5]);
  assert.equal(outbox.diagnostics().slots, 0);
});

test('B5 restart preserves admission order after slot reuse and validates ready digests before posting', async () => {
  const outbox = localOutbox();
  outbox.capture(emaChange('B5-slot-zero')); outbox.capture(emaChange('B5-older'));
  await outbox.materializeThrough(outbox.watermark());
  outbox.ack(outbox.readyThrough(outbox.watermark())[0]!);
  outbox.capture(emaChange('B5-newer'));
  await outbox.materializeThrough(outbox.watermark());
  const restarted = localOutbox();
  await restarted.materializeThrough(restarted.watermark());
  assert.deepEqual(restarted.readyThrough(restarted.watermark()).map(r => r.id), ['B5-older', 'B5-newer']);
  const raw = JSON.parse(memory.get(`${OUTBOX_NAMESPACE}slot:0`)!);
  raw.digest = '0'.repeat(64);
  memory.set(`${OUTBOX_NAMESPACE}slot:0`, JSON.stringify(raw));
  const tampered = localOutbox();
  await assert.rejects(queueJournal(tampered).reconcile(), /pending/);
  assert.equal(tampered.diagnostics().blocked, true);
  assert.equal(tampered.diagnostics().quarantined, 1);
  assert.equal(calls.length, 0);
  assert.equal(JSON.parse(memory.get(`${OUTBOX_NAMESPACE}slot:0`)!).digest, '0'.repeat(64), 'invalid row remains quarantined');
});

test('B6 unavailable storage recovery scans existing receipts and malformed diagnostics stay quarantined', async () => {
  const first = localOutbox(); first.capture(emaChange('B6-existing'));
  await first.materializeThrough(first.watermark());
  let available = false;
  const recovered = localOutbox({ storage: () => available ? (globalThis as any).localStorage : null });
  assert.equal(recovered.capture(emaChange('B6-while-unavailable')).reason, 'storage-unavailable');
  available = true;
  recovered.capture(emaChange('B6-after-recovery'));
  await recovered.materializeThrough(recovered.watermark());
  assert.deepEqual(recovered.readyThrough(recovered.watermark()).map(r => r.id), ['B6-existing', 'B6-after-recovery']);
  assert.equal(recovered.diagnostics().refused, 1, 'live refusal survives delayed diagnostics hydration');
  memory.set(`${OUTBOX_NAMESPACE}diagnostics`, '{"private":"malformed diagnostics"}');
  const blocked = localOutbox();
  assert.equal(blocked.capture(emaChange('refused')).reason, 'invalid-persisted');
  assert.equal(blocked.diagnostics().diagnosticsUnsaved, true);
  assert.equal(memory.get(`${OUTBOX_NAMESPACE}diagnostics`), '{"private":"malformed diagnostics"}');
});

test('B7 actual SQL commit with a lost reply replays both states without erasing committed history', async () => {
  const outbox = localOutbox(); outbox.capture(emaChange('B7-lost'));
  const journal = queueJournal(outbox, async (url, init) => {
    await storeFetch(store)(url, init);
    throw new Error('lost after real SQLite commit');
  });
  await assert.rejects(journal.reconcile(), /lost/);
  assert.equal(sqlEntries('ema-forecast').length, 1);
  assert.equal(outbox.diagnostics().savedAwaitingSync, 1);
  outbox.capture({ kind: 'ema-forecast', record: { ...emaChange('B7-lost').record, hit: false, resolvedAt: T0 + 1 } });
  await queueJournal(outbox).reconcile();
  assert.equal(sqlEntries('ema-forecast').length, 2);
  assert.equal(outbox.diagnostics().slots, 0);
});

test('B9 a finite watermark leaves later states queued and working backfill cannot reorder them', async () => {
  const outbox = localOutbox(); const record = resolvedForecast({ id: 'B9-watermark', status: 'pending', resolvedAt: undefined });
  outbox.capture({ kind: 'forecast', record });
  const entered = deferred(); const reply = deferred();
  const transport = storeFetch(store); let firstAppend = true;
  const journal = createEvidenceJournal({ outbox, available: () => true, baseUrl: () => BASE,
    sources: [fakeSource(async () => [await projectForecast(record)])],
    fetch: async (url, init) => {
      if (url.endsWith('/append') && firstAppend) { firstAppend = false; entered.resolve(); await reply.promise; }
      return transport(url, init);
    },
  });
  const first = journal.reconcile(); await entered.promise;
  record.status = 'resolved_true'; record.resolvedAt = T0 + 1;
  outbox.capture({ kind: 'forecast', record });
  await outbox.materializeThrough(outbox.watermark());
  reply.resolve();
  await assert.doesNotReject(first, 'first watermark completes while the later receipt remains pending');
  const report = await first;
  assert.equal(report.sent, 1, 'newer working state is withheld while its receipt is outside the watermark');
  assert.equal(outbox.readyThrough(outbox.watermark()).length, 1);
  assert.deepEqual(sqlEntries('forecast').map(row => row.payload.status), ['pending'], 'first watermark commits only the older state');
  await queueJournal(outbox).reconcile();
  assert.deepEqual(sqlEntries('forecast').sort((a, b) => a.seq - b.seq).map(row => row.payload.status), ['pending', 'resolved_true'], 'later receipt commits after the older state');
});

test('B9 backoff caps at fifteen minutes, preserves due time and stop removes all timers', async () => {
  const timers = new FakeClock(); let requests = 0;
  const journal = queueJournal(localOutbox(), async () => { requests++; return new Response('', { status: 503 }); }, timers);
  journal.start(); await timers.advance(20_000);
  for (const delay of [30_000, 60_000, 120_000, 240_000, 480_000]) {
    assert.ok(timers.delays().includes(delay));
    journal.noteChanged(); assert.ok(timers.delays().includes(delay));
    await timers.advance(delay);
  }
  assert.ok([...timers.jobs.values()].some(job => !job.interval && job.at - timers.now === 900_000), 'failure retry reaches its exact fifteen-minute ceiling');
  assert.ok(requests >= 6);
  journal.stop(); assert.equal(timers.jobs.size, 0);
});

test('B9 real crypto concurrency is shared across captured states and all compatibility sources', async () => {
  const { getEvidenceProjectionDiagnostics, projectEvidenceDrafts, snapshotEvidence } = await import('../evidence-projection.ts');
  const gate = deferred(); let active = 0; let highWater = 0;
  const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
  crypto.subtle.digest = (async (...args: Parameters<typeof crypto.subtle.digest>) => {
    active++; highWater = Math.max(highWater, active);
    try { await gate.promise; return await originalDigest(...args); } finally { active--; }
  }) as typeof crypto.subtle.digest;
  try {
    const outbox = localOutbox();
    for (let i = 0; i < 20; i++) outbox.capture(emaChange(`B9-concurrent-${i}`));
    const compatibility = [0, 1, 2].map(source => projectEvidenceDrafts(Array.from({ length: 20 }, (_, i) => snapshotEvidence(emaChange(`B9-compat-${source}-${i}`))!)));
    await flushMicrotasks();
    assert.equal(highWater, 4, 'actual WebCrypto concurrency never exceeds four across owners');
    assert.ok(getEvidenceProjectionDiagnostics().queued <= getEvidenceProjectionDiagnostics().maxWaiters);
    gate.resolve(); await Promise.all(compatibility);
    await outbox.materializeThrough(outbox.watermark());
    assert.equal(highWater, 4);
    console.log('T2 global projection high-water', JSON.stringify({ crypto: highWater, ...getEvidenceProjectionDiagnostics() }));
  } finally { crypto.subtle.digest = originalDigest; gate.resolve(); }
});

test('B6 valid persisted rows over the aggregate byte ceiling block without pruning or posting', async () => {
  const wide = '\ud800';
  for (let i = 0; i < 700; i++) {
    const entry = await projectForecast(resolvedForecast({ id: `persisted-${i}`, sourceId: wide.repeat(128), domain: wide.repeat(64) as any,
      algorithmVersion: wide.repeat(128), resolutionProvenance: { kind: 'proxy', resolverId: wide.repeat(128), evidence: [] }, targetKey: undefined }));
    const row = { v: 1, phase: 'ready', token: `00000000-0000-4000-8000-000000000000:${i + 1}`, admittedAt: T0, admission: i + 1,
      kind: entry.kind, id: entry.id, digest: entry.digest, payload: entry.payload, encodedBytes: 0 };
    let raw = JSON.stringify(row);
    do { row.encodedBytes = new TextEncoder().encode(raw).length; raw = JSON.stringify(row); } while (row.encodedBytes !== new TextEncoder().encode(raw).length);
    memory.set(`${OUTBOX_NAMESPACE}slot:${i}`, raw);
  }
  const outbox = localOutbox();
  assert.equal(outbox.diagnostics().blocked, true);
  assert.equal(outbox.diagnostics().quarantined, 700);
  assert.ok(outbox.diagnostics().reservedBytes > OUTBOX_STORAGE_BYTES);
  assert.equal(outbox.capture(emaChange('refused')).reason, 'invalid-persisted');
  await assert.rejects(queueJournal(outbox).reconcile(), /pending/);
  assert.equal(calls.length, 0);
  assert.equal([...memory.keys()].filter(k => k.includes(':slot:')).length, 700, 'every prior row remains untouched');
});

test('B8 a finite request timeout retains a saved receipt for retry', async () => {
  const timers = new FakeClock();
  const timeout = AbortSignal.timeout;
  AbortSignal.timeout = ms => { const controller = new AbortController(); timers.setTimeout(() => controller.abort(new Error('fixture timeout')), ms); return controller.signal; };
  let journal: ReturnType<typeof queueJournal> | undefined;
  let observed: Promise<void> | undefined;
  try {
    const outbox = localOutbox(); outbox.capture(emaChange('B8-timeout'));
    await outbox.materializeThrough(outbox.watermark());
    const entered = deferred();
    journal = queueJournal(outbox, async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }); entered.resolve();
    }));
    let settled = false; let rejected = false;
    const pending = journal.reconcile();
    observed = pending.then(() => { settled = true; }, () => { settled = true; rejected = true; });
    await entered.promise;
    await timers.advance(10_000); await flushMicrotasks();
    assert.equal(settled, true, 'request must settle at its ten-second deadline');
    assert.equal(rejected, true, 'deadline must reject the pending request');
    await assert.rejects(pending, /timeout/);
    assert.equal(outbox.diagnostics().savedAwaitingSync, 1);
    assert.equal(outbox.diagnostics().refused, 0);
    await queueJournal(outbox).reconcile();
    assert.equal(outbox.diagnostics().slots, 0);
  } finally {
    journal?.stop();
    await timers.advance(100_000); await observed;
    AbortSignal.timeout = timeout;
    assert.equal(timers.jobs.size, 0, 'all fake request deadlines are reaped after timeout fixture');
  }
});

test('B9 working missing queries are bounded to 2000 entries and append requests to 200', async () => {
  const { projectEvidenceDrafts, snapshotEvidence } = await import('../evidence-projection.ts');
  const entries = await projectEvidenceDrafts(Array.from({ length: 2001 }, (_, i) => snapshotEvidence(emaChange(`B9-missing-${i}`))!));
  const missingSizes: number[] = []; const appendSizes: number[] = [];
  const journal = createEvidenceJournal({ sources: [fakeSource(async () => entries)], available: () => true, baseUrl: () => BASE, fetch: async (url, init) => {
    if (init?.body) { const count = JSON.parse(String(init.body)).entries.length;
      if (url.endsWith('/missing')) missingSizes.push(count); else if (url.endsWith('/append')) appendSizes.push(count);
    }
    return storeFetch(store)(url, init);
  } });
  const report = await journal.reconcile();
  assert.equal(report.appended, 2001);
  assert.deepEqual(missingSizes, [2000, 1]);
  assert.deepEqual(appendSizes, [...Array(10).fill(200), 1]);
});

test('B6 refusal counters saturate explicitly without overflowing', () => {
  localOutbox().capture({ kind: 'forecast', record: resolvedForecast({ probability: 2 }) });
  const key = `${OUTBOX_NAMESPACE}diagnostics`;
  const row = JSON.parse(memory.get(key)!);
  row.refused = Number.MAX_SAFE_INTEGER;
  row.byReason['invalid-input'] = Number.MAX_SAFE_INTEGER;
  row.byKind.forecast = Number.MAX_SAFE_INTEGER;
  memory.set(key, JSON.stringify(row));
  const outbox = localOutbox();
  assert.equal(outbox.capture({ kind: 'forecast', record: resolvedForecast({ probability: 2 }) }).reason, 'invalid-input');
  assert.equal(outbox.diagnostics().refused, Number.MAX_SAFE_INTEGER);
  assert.equal(outbox.diagnostics().byReason['invalid-input'], Number.MAX_SAFE_INTEGER);
  assert.equal(outbox.diagnostics().saturated, true);
  assert.equal(localOutbox().diagnostics().saturated, true);
});

test('B4 identical scored snapshots remain deduplicated while pending and release on exact acknowledgement', async () => {
  const outbox = localOutbox();
  assert.equal(outbox.capture(emaChange('B4-dedupe')).status, 'admitted');
  assert.equal(outbox.capture(emaChange('B4-dedupe')).status, 'already-pending');
  await outbox.materializeThrough(outbox.watermark());
  assert.equal(outbox.capture(emaChange('B4-dedupe')).status, 'already-pending');
  assert.equal(outbox.diagnostics().slots, 1);
  outbox.ack(outbox.readyThrough(outbox.watermark())[0]!);
  assert.equal(outbox.diagnostics().transientBytes, 0);
  assert.equal(outbox.capture(emaChange('B4-dedupe')).status, 'admitted');
  await outbox.materializeThrough(outbox.watermark());
});

test('B6 terminal diagnostic credit survives failed removal, restart and blocked slot reuse exactly once', async () => {
  let removeFails = true; let diagnosticsFail = false;
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { if (diagnosticsFail && key.endsWith('diagnostics')) throw new Error('quota'); memory.set(key, value); },
    removeItem: (key: string) => { if (removeFails) throw new Error('quota'); memory.delete(key); },
  };
  const first = localOutbox({ storage: () => storage }); first.capture(emaChange('B6-rejected'));
  await first.materializeThrough(first.watermark());
  first.reject(first.readyThrough(first.watermark())[0]!);
  assert.equal(first.diagnostics().refused, 1); assert.equal(first.diagnostics().terminalBlocked, 1);
  removeFails = false;
  const second = localOutbox({ storage: () => storage });
  await second.materializeThrough(second.watermark());
  assert.equal(second.diagnostics().refused, 1, 'persisted terminal receipt is not counted again after restart');
  assert.equal(second.diagnostics().slots, 0);
  diagnosticsFail = true;
  assert.equal(second.capture(emaChange('B6-reuse-blocked')).reason, 'storage-quota', 'credited slot cannot be reused until the clear is durable');
  assert.equal(second.diagnostics().slots, 0);
  diagnosticsFail = false;
  second.capture(emaChange('B6-reused'));
  await second.materializeThrough(second.watermark());
  const third = localOutbox({ storage: () => storage });
  await third.materializeThrough(third.watermark());
  const reusedReceipts = third.readyThrough(third.watermark());
  assert.equal(reusedReceipts.length, 1, 'old terminal credit cannot erase a reused receipt');
  assert.equal(reusedReceipts[0]!.id, 'B6-reused', 'old diagnostic credit cannot dispose of the new owner');
  await queueJournal(third).reconcile();
  assert.equal(third.diagnostics().slots, 0);
  assert.equal(sqlEntries('ema-forecast').length, 1);
});

test('B5 interrupted diagnostic credit is not counted twice after a failed marker removal', () => {
  let removeFails = true;
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value); },
    removeItem: (key: string) => { if (removeFails) throw new Error('quota'); memory.delete(key); },
  };
  localOutbox({ storage: () => storage, schedule: () => undefined }).capture(emaChange('B5-interrupted-credit'));
  const interrupted = localOutbox({ storage: () => storage, schedule: () => undefined });
  assert.equal(interrupted.diagnostics().interrupted, 1);
  assert.equal(interrupted.diagnostics().terminalBlocked, 1);
  removeFails = false;
  const restarted = localOutbox({ storage: () => storage, schedule: () => undefined });
  assert.equal(restarted.diagnostics().interrupted, 1);
  assert.equal(restarted.diagnostics().slots, 0);
});


test('B4 mutable Date is captured as the original scored timestamp through real SQLite', async () => {
  const gate = deferred();
  const outbox = localOutbox({ project: async draft => { await gate.promise; return projectEvidenceDraft(draft); } });
  const record = outcomeRecord({ id: 'B4-Date' });
  const expected = await projectOutcome(record);
  assert.equal(outbox.capture({ kind: 'alert-outcome', record }).status, 'admitted');
  record.recordedAt.setTime(T0 + 123456);
  assert.equal(record.recordedAt.getTime(), T0 + 123456, 'fixture mutates the same Date object after capture');
  gate.resolve(); await outbox.materializeThrough(outbox.watermark());
  const ready = outbox.readyThrough(outbox.watermark());
  assert.equal(ready.length, 1);
  assert.equal(ready[0]!.payload.recordedAt, T0, 'ready scored timestamp retains original Date value');
  assert.deepEqual(ready[0]!.payload, expected.payload);
  assert.equal(ready[0]!.digest, expected.digest);
  await queueJournal(outbox).reconcile();
  const rows = sqlEntries('alert-outcome');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.payload.recordedAt, T0, 'SQLite retains the emission-time Date timestamp');
  assert.deepEqual(rows[0]!.payload, expected.payload);
});

test('B1 actual resolver expiry-only return zero still captures expired state in SQLite', async () => {
  const adapter = await import('../forecast-calibration-adapter.ts');
  const { getEvidenceOutbox, resetEvidenceOutboxForTests } = await import('../evidence-outbox.ts');
  resetEvidenceOutboxForTests(); adapter._resetCalibrationForTests();
  (globalThis as any).window = { __TAURI_INTERNALS__: {}, location: { search: '' }, navigator: {} };
  const record = resolvedForecast({ id: 'B1-expiry-only', status: 'pending', resolvedAt: undefined, resolutionNote: undefined,
    resolutionProvenance: undefined, criteria: { kind: 'market_move', symbol: 'SPY', direction: 'up', minAbsPct: 1, basisPrice: 100, basisObservedAt: T0 } });
  adapter.getCalibrationStore().record(record);
  const expiredAt = T0 + 7 * 86_400_000;
  const count = adapter.dispatchOutcomeResolvers({ now: expiredAt } as any,
    [{ id: 'expiry-only', canResolve: prediction => prediction.id === record.id, resolve: () => null }]);
  assert.equal(count, 0, 'actual resolver has no resolved verdicts');
  assert.equal(adapter.getCalibrationStore().get(record.id)?.status, 'expired', 'actual resolver-owned expiry occurred');
  await queueJournal(getEvidenceOutbox()).reconcile();
  const rows = sqlEntries('forecast').filter(row => row.recordId === record.id);
  assert.equal(rows.length, 2, 'zero-return resolver persists both pending and expired states');
  assert.deepEqual(rows.map(row => row.payload.status).sort(), ['expired', 'pending']);
  assert.equal(rows.find(row => row.payload.status === 'expired')?.payload.resolvedAt, expiredAt);
});

test('B2 over-cap real outcome hydration retains all original states before next insertion trims', async () => {
  const outcomes = await import('../outcome-ledger.ts');
  const { getEvidenceOutbox, resetEvidenceOutboxForTests } = await import('../evidence-outbox.ts');
  resetEvidenceOutboxForTests(); outcomes.__resetOutcomeLedgerSingleton();
  (globalThis as any).window = { __TAURI_INTERNALS__: {}, location: { search: '' }, navigator: {} };
  const persisted = Array.from({ length: 2003 }, (_, i) => ({ id: `B2-hydrated-${i}`, domain: 'weather',
    predictedSeverity: 'high', actualOutcome: 'confirmed-real', recordedAt: T0 + i }));
  memory.set('wm-outcome-ledger', JSON.stringify(persisted));
  const ledger = outcomes.getOutcomeLedger();
  assert.equal(ledger.list().length, 2003, 'original hydration has no working cap until record/merge');
  ledger.record({ domain: 'weather', predictedSeverity: 'high', actualOutcome: 'confirmed-real', recordedAt: new Date(T0 + 2003) });
  assert.equal(ledger.list().length, 2000, 'next real insertion enforces the unchanged working cap');
  await queueJournal(getEvidenceOutbox()).reconcile();
  const rows = sqlEntries('alert-outcome');
  assert.equal(rows.length, 2004, 'all hydrated states and next emitted state survive real working eviction');
  for (const row of persisted) {
    const saved = rows.filter(entry => entry.recordId === row.id);
    assert.equal(saved.length, 1, `${row.id} hydrated exactly once into SQLite`);
    assert.equal(saved[0]!.payload.recordedAt, row.recordedAt);
  }
});

test('B9 real projection pool rejects thirteenth waiter without invoking it and reaps bounded jobs', async () => {
  const { runEvidenceProjection, getEvidenceProjectionDiagnostics } = await import('../evidence-projection.ts');
  const gate = deferred(); let invoked = 0; let overflowInvoked = false;
  const jobs = Array.from({ length: 16 }, () => runEvidenceProjection(async () => { invoked++; await gate.promise; }));
  let overflowError: unknown;
  let overflow: Promise<void> = Promise.resolve();
  try {
    await flushMicrotasks();
    assert.equal(invoked, 4);
    assert.equal(getEvidenceProjectionDiagnostics().active, 4);
    assert.equal(getEvidenceProjectionDiagnostics().queued, 12);
    overflow = runEvidenceProjection(async () => { overflowInvoked = true; }).catch(error => { overflowError = error; });
    await flushMicrotasks();
    assert.ok(overflowError instanceof Error, 'thirteenth waiter refuses immediately before held jobs release');
    assert.equal(overflowError.message, 'bounded evidence projection queue is full', 'queue refusal contains no captured content');
    assert.equal(overflowInvoked, false, 'refused thirteenth waiter never executes');
    assert.equal(getEvidenceProjectionDiagnostics().active, 4);
    assert.equal(getEvidenceProjectionDiagnostics().queued, 12, 'refusal creates no additional waiter');
  } finally { gate.resolve(); await Promise.allSettled([...jobs, overflow]); }
  assert.equal(invoked, 16);
  assert.equal(getEvidenceProjectionDiagnostics().active, 0);
  assert.equal(getEvidenceProjectionDiagnostics().queued, 0);
  assert.equal(getEvidenceProjectionDiagnostics().compatibilityWorkers, 0);
});

test('B6 production payload guard preempts downstream projection and no oversized claim reaches SQL', async () => {
  const { evidenceDraftRefusal, snapshotEvidence } = await import('../evidence-projection.ts');
  const wide = '\ud800'; let projected = 0;
  const record = resolvedForecast({ id: wide.repeat(200), sourceId: wide.repeat(128), domain: wide.repeat(64) as any,
    algorithmVersion: wide.repeat(128), resolutionProvenance: { kind: 'proxy', resolverId: wide.repeat(128), evidence: [] } });
  const draft = snapshotEvidence({ kind: 'forecast', record })!;
  const actual = await projectEvidenceDraft(draft);
  assert.ok(new TextEncoder().encode(canonicalJson(actual.payload)).byteLength > 4096, 'real projection can encode beyond payload cap');
  assert.equal(evidenceDraftRefusal(draft), 'payload-size', 'admission sees the same scored encoded payload');
  const outbox = localOutbox({ project: async input => { projected++; return projectEvidenceDraft(input); } });
  assert.equal(outbox.capture({ kind: 'forecast', record }).reason, 'payload-size');
  await queueJournal(outbox).reconcile();
  assert.equal(projected, 0, 'production admission preempts downstream projection checks');
  assert.equal(outbox.diagnostics().slots, 0);
  assert.equal(sqlEntries('forecast').length, 0);
  const admitted = { ...record, id: wide.repeat(100), targetKey: `sha256:${'f'.repeat(64)}` };
  assert.equal(outbox.capture({ kind: 'forecast', record: admitted }).status, 'admitted');
  const marker = JSON.parse(memory.get(`${OUTBOX_NAMESPACE}slot:0`)!);
  await outbox.materializeThrough(outbox.watermark());
  const readyText = memory.get(`${OUTBOX_NAMESPACE}slot:0`)!;
  const readyBytes = new TextEncoder().encode(readyText).byteLength;
  assert.equal(readyBytes + 16, marker.reservedBytes, 'real projection matches admission ready size with exact reserved margin');
  assert.equal(projected, 1);
  assert.equal(outbox.readyThrough(outbox.watermark()).length, 1);
  await queueJournal(outbox).reconcile();
  assert.equal(sqlEntries('forecast').length, 1, 'near-ceiling actual production payload saves normally');
});

test('B6 injected malformed projector exercises downstream payload and reserved-ready byte defenses', async () => {
  const { validEvidencePayload } = await import('../evidence-projection.ts');
  const wide = '\ud800';
  const record = resolvedForecast({ id: wide.repeat(200) });
  const oversized = await projectForecast({ ...record, sourceId: wide.repeat(128), domain: wide.repeat(64) as any,
    algorithmVersion: wide.repeat(128), resolutionProvenance: { kind: 'proxy', resolverId: wide.repeat(128), evidence: [] } });
  assert.equal(validEvidencePayload('forecast', oversized.payload), true, 'schema-valid injected output isolates byte ceiling');
  assert.ok(new TextEncoder().encode(canonicalJson(oversized.payload)).byteLength > 4096);
  const payloadBox = localOutbox({ project: async () => oversized });
  assert.equal(payloadBox.capture({ kind: 'forecast', record }).status, 'admitted');
  await payloadBox.materializeThrough(payloadBox.watermark());
  assert.equal(payloadBox.diagnostics().byReason['projection-failed'], 1, 'oversized injected projection refuses before ready persistence');
  assert.equal(payloadBox.readyThrough(payloadBox.watermark()).length, 0);
  await queueJournal(payloadBox).reconcile();
  assert.equal(sqlEntries('forecast').length, 0);

  const small = resolvedForecast({ id: 'B6-reservation-defense' });
  const expanded = await projectForecast({ ...small, sourceId: 'x'.repeat(128) });
  assert.equal(validEvidencePayload('forecast', expanded.payload), true);
  assert.ok(new TextEncoder().encode(canonicalJson(expanded.payload)).byteLength <= 4096);
  const reservationBox = localOutbox({ project: async () => expanded });
  assert.equal(reservationBox.capture({ kind: 'forecast', record: small }).status, 'admitted');
  await reservationBox.materializeThrough(reservationBox.watermark());
  assert.equal(reservationBox.diagnostics().byReason['payload-size'], 1, 'valid injected expansion cannot exceed exact ready reservation');
  assert.equal(reservationBox.readyThrough(reservationBox.watermark()).length, 0);
  await queueJournal(reservationBox).reconcile();
  assert.equal(sqlEntries('forecast').length, 0);
});
