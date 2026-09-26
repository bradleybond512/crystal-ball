import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { normalizeGDACSEvent, normalizeNWSAlert } from '../alert-normalizer.ts';
import { fetchGDACSEventsTracked, getGDACSSuccessfulUpdate, parseGDACSResponse, type GDACSEvent } from '../gdacs.ts';
import type { NWSAlert } from '../nws-alerts.ts';
import { identifyAlert } from '../alert-identity.ts';

const OBSERVED = Date.parse('2026-09-25T12:00:00Z');
const ONSET = OBSERVED - 4 * 86_400_000;
const nws = (changes: Partial<NWSAlert> = {}): NWSAlert => ({
  id: 'warning-1', event: 'Flood Warning', headline: 'Flooding continues', description: '',
  severity: 'Severe', urgency: 'Expected', areaDesc: 'Test county',
  sent: new Date(ONSET).toISOString(), onset: new Date(ONSET).toISOString(),
  expires: new Date(OBSERVED + 2 * 86_400_000).toISOString(),
  status: 'Actual', messageType: 'Update', centroid: [0, 0], retrievedAt: OBSERVED, ...changes,
});
const gdacs = (changes: Partial<GDACSEvent> = {}): GDACSEvent => ({
  id: 'gdacs-FL-1', eventType: 'FL', name: 'Flood', description: '', alertLevel: 'Red',
  country: 'Test', coordinates: [0, 0], fromDate: new Date(ONSET), severity: '', url: '',
  retrievedAt: OBSERVED, ...changes,
});
const verified = { kind: 'verified-response' as const, observedAt: OBSERVED };
const replay = { kind: 'replay' as const };

test('multi-day NWS warning retains validated expiry without changing chronology or zero coordinates', () => {
  const alert = normalizeNWSAlert(nws(), verified);
  assert.deepEqual(alert.retentionEvidence, {
    kind: 'nws-expiry', observedAt: OBSERVED, issuedAt: ONSET, expiresAt: OBSERVED + 2 * 86_400_000,
  });
  assert.equal(alert.timestamp, ONSET);
  assert.deepEqual(alert.location, { lat: 0, lon: 0, label: 'Test county' });
});

test('NWS memory, offline and storm-context replay preserve original row retrieval time', () => {
  const row = nws();
  const expected = normalizeNWSAlert(row, verified).retentionEvidence;
  assert.ok(expected);
  for (const context of [verified, replay, { kind: 'replay' as const, observedAt: OBSERVED }]) {
    assert.deepEqual(normalizeNWSAlert(row, context).retentionEvidence, expected);
  }
  assert.equal(normalizeNWSAlert(row, { kind: 'verified-response', observedAt: OBSERVED + 1000 }).retentionEvidence, undefined);
});

test('unknown provenance and missing row retrieval cannot manufacture warning freshness', () => {
  for (const row of [nws({ retrievedAt: undefined }), nws({ retrievedAt: Number.NaN }), nws({ retrievedAt: Date.now() + 86_400_000 })]) {
    assert.equal(normalizeNWSAlert(row, verified).retentionEvidence, undefined);
    assert.equal(normalizeNWSAlert(row, replay).retentionEvidence, undefined);
  }
  assert.equal(normalizeNWSAlert(nws()).retentionEvidence, undefined);
  assert.equal(normalizeGDACSEvent(gdacs()).retentionEvidence, undefined);
});

test('NWS malformed dates and untrusted status/message enums never gain expiry exemption', () => {
  for (const changes of [
    { sent: 'invalid' }, { expires: 'invalid' }, { expires: new Date(ONSET - 1).toISOString() },
    { sent: new Date(OBSERVED + 1).toISOString() }, { status: 'Test' }, { status: undefined },
    { messageType: 'Cancel' }, { messageType: 'constructor' }, { messageType: undefined },
  ]) {
    assert.equal(normalizeNWSAlert(nws(changes as Partial<NWSAlert>), verified).retentionEvidence, undefined);
  }
});

test('GDACS qualifying response and replay retain underlying observation independently from event time', () => {
  for (const context of [verified, replay]) {
    const alert = normalizeGDACSEvent(gdacs(), context);
    assert.deepEqual(alert.retentionEvidence, { kind: 'gdacs-observation', observedAt: OBSERVED });
    assert.equal(alert.timestamp, ONSET);
    assert.deepEqual(alert.location, { lat: 0, lon: 0, label: 'Test' });
  }
  assert.equal(normalizeGDACSEvent(gdacs({ retrievedAt: undefined }), verified).retentionEvidence, undefined);
  assert.equal(normalizeGDACSEvent(gdacs(), { kind: 'replay', observedAt: OBSERVED + 1 }).retentionEvidence, undefined);
});

test('observation-only refresh does not change alert identity or material revision', () => {
  for (const [first, later] of [
    [normalizeNWSAlert(nws(), verified), normalizeNWSAlert(nws({ retrievedAt: OBSERVED + 1000 }), { kind: 'verified-response', observedAt: OBSERVED + 1000 })],
    [normalizeGDACSEvent(gdacs(), verified), normalizeGDACSEvent(gdacs({ retrievedAt: OBSERVED + 1000 }), { kind: 'verified-response', observedAt: OBSERVED + 1000 })],
  ]) {
    assert.notDeepEqual(first!.retentionEvidence, later!.retentionEvidence);
    assert.deepEqual(identifyAlert(first!), identifyAlert(later!));
  }
});

test('GDACS parser never trusts provider-supplied retrieval provenance', () => {
  const [row] = parseGDACSResponse({ features: [{ type: 'Feature', retrievedAt: OBSERVED,
    geometry: { type: 'Point', coordinates: [0, 0] }, properties: {
      eventid: 1, eventtype: 'FL', alertlevel: 'Red', name: 'Flood', country: 'Test',
      fromdate: new Date(ONSET).toISOString(), retrievedAt: OBSERVED,
    },
  }] });
  assert.ok(row);
  assert.equal(row.retrievedAt, undefined);
  assert.equal(normalizeGDACSEvent(row, verified).retentionEvidence, undefined);
});

const loader = readFileSync(new URL('../../app/data-loader.ts', import.meta.url), 'utf8');
const parsedLoader = ts.createSourceFile('data-loader.ts', loader, ts.ScriptTarget.Latest, true);
function method(name: string, bindings: Record<string, unknown>): (...args: unknown[]) => Promise<unknown> {
  let body = '';
  function visit(node: ts.Node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(parsedLoader) === name) body = node.getText(parsedLoader);
    ts.forEachChild(node, visit);
  }
  visit(parsedLoader);
  assert.ok(body, `${name} must exist`);
  const compiled = ts.transpileModule(`class Subject { ${body} } return Subject.prototype.${name};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(bindings), compiled)(...Object.values(bindings));
}

test('real verified GDACS loader stamps only underlying successful timestamp and remains array-compatible', async () => {
  const row = gdacs({ retrievedAt: undefined });
  const updates: unknown[][] = [];
  const fetch = method('fetchVerifiedGDACSEvents', {
    fetchGDACSEventsTracked: async () => ({ events: [row], dataState: { mode: 'live', timestamp: OBSERVED, offline: false } }),
    getGDACSSuccessfulUpdate,
    dataFreshness: { recordUpdate: (...args: unknown[]) => updates.push(args) },
  });
  const result = await fetch() as GDACSEvent[];
  assert.ok(Array.isArray(result));
  assert.equal(result[0]?.retrievedAt, OBSERVED);
  assert.equal(row.retrievedAt, undefined, 'stamping does not mutate breaker-owned rows');
  assert.deepEqual(updates, [['gdacs', 1, OBSERVED]]);
  assert.equal((loader.match(/withOfflineCache\('gdacs-events', \(\) => this.fetchVerifiedGDACSEvents\(\)/g) ?? []).length, 3);
});

test('real GDACS loader rejects unavailable and breaker-cache responses without a fresh observation', async () => {
  for (const mode of ['cached', 'unavailable']) {
    const updates: unknown[] = [];
    const fetch = method('fetchVerifiedGDACSEvents', {
      fetchGDACSEventsTracked: async () => ({ events: [gdacs()], dataState: { mode, timestamp: OBSERVED, offline: false } }),
      getGDACSSuccessfulUpdate,
      dataFreshness: { recordError: () => {}, recordUpdate: (...args: unknown[]) => updates.push(args) },
    });
    await assert.rejects(fetch(), /fallback/);
    assert.deepEqual(updates, []);
  }
});

function alertLoaderBindings(snapshot: unknown, fallback = nws()) {
  const alerts: ReturnType<typeof normalizeNWSAlert>[] = [];
  return {
    alerts,
    owner: { ctx: { intelligenceCache: {}, panels: {} } },
    bindings: {
      withOfflineCache: async () => { if (snapshot instanceof Error) throw snapshot; return snapshot; },
      getStormPreparednessContext: () => ({ nwsAlerts: [fallback] }),
      fetchNWSAlerts: async () => [], fetchSpcSummary: async () => null, fetchMarineHazards: async () => [],
      fetchExcessiveRainfallOutlooks: async () => [], fetchWinterWeatherOutlooks: async () => [],
      nwsAlertMinimal: (row: unknown) => row,
      normalizeNWSAlert, normalizeGDACSEvent,
      unifiedAlertStore: { ingest: (rows: typeof alerts) => alerts.push(...rows) },
      recordWarningPredictions: () => { throw new Error('Stop after tested ingestion'); },
      classifyRegion: () => null,
      feedFreshnessFromSnapshot: () => ({ fresh: true }),
      dataFreshness: { recordError: () => {} },
      console: { warn: () => {} },
    },
  };
}

test('real NWS loader preserves memory/offline row provenance and storm fallback', async () => {
  for (const snapshot of [
    { data: [nws()], source: 'network', cachedAt: OBSERVED + 10_000 },
    { data: [nws()], source: 'offline-cache', cachedAt: OBSERVED + 20_000 },
    new Error('outage'),
  ]) {
    const h = alertLoaderBindings(snapshot);
    await method('loadNWSAlerts', h.bindings).call(h.owner);
    assert.equal(h.alerts.length, 1);
    assert.equal(h.alerts[0]?.retentionEvidence?.observedAt, OBSERVED);
    assert.equal(h.alerts[0]?.timestamp, ONSET);
  }
});

test('real GDACS alert loader preserves live and offline row observation instead of wrapper cache time', async () => {
  for (const source of ['network', 'offline-cache']) {
    const h = alertLoaderBindings({ data: [gdacs()], source, cachedAt: OBSERVED + 10_000 });
    await method('loadGDACSAlerts', h.bindings).call(h.owner);
    assert.equal(h.alerts.length, 1);
    assert.deepEqual(h.alerts[0]?.retentionEvidence, { kind: 'gdacs-observation', observedAt: OBSERVED });
  }
});


test('captured live GDACS HTTP 400 body cannot produce observations or successful freshness', async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const originalWarn = console.warn;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response('{"message":"Eventtype is required."}', { status: 400, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  console.error = () => {};
  console.warn = () => {};
  try {
    const result = await fetchGDACSEventsTracked();
    assert.equal(calls.length, 1);
    assert.equal(calls[0], 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP');
    assert.deepEqual(result.events, []);
    assert.equal(result.dataState.mode, 'unavailable');
    assert.equal(getGDACSSuccessfulUpdate(result), null);
    assert.throws(() => parseGDACSResponse({ message: 'Eventtype is required.' }), /features array/);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    console.warn = originalWarn;
  }
});
