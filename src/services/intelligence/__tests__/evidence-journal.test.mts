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
  const full = fakeSource(async () => [], { localCount: () => 500, mergeRebuilt: () => { throw new Error('must not merge'); } });
  await createEvidenceJournal({ fetch: storeFetch(store), baseUrl: () => BASE, available: () => true, sources: [full] }).rebuild();
  assert.deepEqual(calls, [`GET ${EVIDENCE_ROUTES.summary}`]);
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
