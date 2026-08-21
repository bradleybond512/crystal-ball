import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';

import {
  matchesExactCurrentLifelinesSnapshot,
  parseBgpResponse,
  parseRadiationResponse,
  startGridIntelligenceLoader,
} from '../src/services/infrastructure/grid-intelligence-loader.ts';
import {
  buildLocalLogisticsFingerprint,
  LOCAL_LOGISTICS_CATEGORIES,
  type LocalLogisticsSnapshot,
} from '../src/services/local-logistics.ts';
import type { SavedPlace } from '../src/services/saved-places.ts';

const NOW = Date.parse('2026-08-14T14:00:00.000Z');

test('BGP loader treats a missing key and malformed bodies as unknown, not reported zero', () => {
  const missingKey = parseBgpResponse({ events: [], keyMissing: true, fetchedAt: NOW }, NOW);
  assert.equal(missingKey.coverage, 'unknown');
  assert.match(missingKey.error ?? '', /not configured/i);

  for (const malformed of [null, {}, { events: [] }, {
    schemaVersion: 1, provider: 'cloudflare-radar', coverage: 'reported',
    events: [], acceptedRows: 1, droppedRows: 0, error: null, fetchedAt: NOW,
  }, {
    schemaVersion: 1, provider: 'cloudflare-radar', coverage: 'reported',
    events: [], acceptedRows: 0, droppedRows: 2, error: null, fetchedAt: NOW,
  }]) {
    const summary = parseBgpResponse(malformed, NOW);
    assert.equal(summary.coverage, 'unknown');
    assert.equal(summary.events.length, 0);
  }

  const incompletePage = parseBgpResponse({
    schemaVersion: 1, provider: 'cloudflare-radar', coverage: 'unknown',
    events: [], acceptedRows: 0, droppedRows: 0, error: 'incomplete_page', fetchedAt: NOW,
  }, NOW);
  assert.equal(incompletePage.coverage, 'unknown');
  assert.match(incompletePage.error ?? '', /incomplete/i);
});

test('BGP loader preserves an explicit valid empty response as reported zero', () => {
  const summary = parseBgpResponse({
    schemaVersion: 1, provider: 'cloudflare-radar', coverage: 'reported',
    events: [], acceptedRows: 0, droppedRows: 0, error: null, fetchedAt: NOW,
  }, NOW);
  assert.equal(summary.coverage, 'reported');
  assert.equal(summary.acceptedRows, 0);
  assert.equal(summary.events.length, 0);
  assert.equal(summary.error, null);
});

test('radiation loader distinguishes valid empty/background from malformed or zero-valid rows', () => {
  const empty = parseRadiationResponse({
    schemaVersion: 1, provider: 'epa-radnet', coverage: 'reported',
    stations: [], acceptedRows: 0, droppedRows: 0, error: null, fetchedAt: NOW,
  }, NOW);
  assert.equal(empty.coverage, 'reported');
  assert.equal(empty.stationCount, 0);

  const background = parseRadiationResponse({
    schemaVersion: 1, provider: 'epa-radnet', coverage: 'reported',
    stations: [{
      StationName: 'Zero, IN', GammaCpm: 0, Latitude: 0, Longitude: 0,
      SampleDateTime: '2026-08-14T13:00:00Z',
    }],
    acceptedRows: 1, droppedRows: 0, error: null, fetchedAt: NOW,
  }, NOW);
  assert.equal(background.coverage, 'reported');
  assert.equal(background.stationCount, 1);
  assert.equal(background.maxCpm, 0);
  assert.equal(background.severity, 'normal');

  for (const malformed of [{}, {
    schemaVersion: 1, provider: 'epa-radnet', coverage: 'reported',
    stations: [{ StationName: 'missing CPM' }], acceptedRows: 1, droppedRows: 0,
    error: null, fetchedAt: NOW,
  }, {
    schemaVersion: 1, provider: 'epa-radnet', coverage: 'reported',
    stations: [], acceptedRows: 0, droppedRows: 2, error: null, fetchedAt: NOW,
  }]) {
    const summary = parseRadiationResponse(malformed, NOW);
    assert.equal(summary.coverage, 'unknown');
    assert.equal(summary.stationCount, 0);
    assert.equal(summary.severity, null);
  }
});

function place(overrides: Partial<SavedPlace> = {}): SavedPlace {
  return {
    id: 'home', name: 'Home', lat: 41.6, lon: -86.7, radiusKm: 25,
    tags: ['home'], priority: 0, notes: '', offlinePinned: true, primary: true,
    source: 'manual', sortIndex: 1, createdAt: NOW - 1_000, updatedAt: NOW - 1_000,
    ...overrides,
  };
}

test('accepted grid events must match the exact current cache fingerprint, retrieval, and county', () => {
  const currentPlace = place();
  const queryFingerprint = buildLocalLogisticsFingerprint(
    currentPlace,
    25,
    [...LOCAL_LOGISTICS_CATEGORIES],
  );
  const cached = {
    placeId: currentPlace.id,
    placeName: currentPlace.name,
    queryFingerprint,
    effectiveRadiusKm: 25,
    countyFips: '18091',
    fetchedAt: new Date(NOW),
  } as LocalLogisticsSnapshot;
  const candidate = { ...cached, fetchedAt: new Date(NOW) };

  assert.equal(matchesExactCurrentLifelinesSnapshot(candidate, currentPlace, cached), true);
  assert.equal(matchesExactCurrentLifelinesSnapshot({ ...candidate, countyFips: '06037' }, currentPlace, cached), false);
  assert.equal(matchesExactCurrentLifelinesSnapshot({ ...candidate, fetchedAt: new Date(NOW - 1) }, currentPlace, cached), false);
  assert.equal(matchesExactCurrentLifelinesSnapshot(candidate, place({ lat: 42.1 }), cached), false);
});

interface PendingFetch {
  path: string;
  signal: AbortSignal | undefined;
  resolve: (response: Response) => void;
}

function responseFor(path: string, demand = 100): Response {
  if (path.endsWith('/api/infrastructure/grid')) {
    const currentPeriod = new Date().toISOString().slice(0, 10);
    return Response.json({
      rows: [
        { period: currentPeriod, respondent: 'CISO', type: 'D', value: demand },
        { period: currentPeriod, respondent: 'CISO', type: 'NG', value: demand },
      ],
    });
  }
  if (path.endsWith('/api/infrastructure/bgp')) {
    return Response.json({
      schemaVersion: 1,
      provider: 'cloudflare-radar',
      coverage: 'reported',
      events: [{
        id: `bgp-${demand}`, started_at: '2026-08-14T13:00:00Z',
        ended_at: null,
        prefixes: ['203.0.113.0/24'], involved_asns: ['64512'],
      }],
      acceptedRows: 1,
      droppedRows: 0,
      error: null,
      fetchedAt: Date.now(),
    });
  }
  return Response.json({
    schemaVersion: 1,
    provider: 'epa-radnet',
    coverage: 'reported',
    stations: [{
      StationName: `Station ${demand}`, GammaCpm: demand, Latitude: 0, Longitude: 0,
      SampleDateTime: '2026-08-14T13:00:00Z',
    }],
    acceptedRows: 1,
    droppedRows: 0,
    error: null,
    fetchedAt: Date.now(),
  });
}

function installDeferredRuntime(t: TestContext): {
  pending: PendingFetch[];
  updates: Array<Record<string, unknown>>;
} {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const pending: PendingFetch[] = [];
  const updates: Array<Record<string, unknown>> = [];
  globalThis.document = new EventTarget() as unknown as Document;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => new Promise<Response>((resolve) => {
    pending.push({ path: String(input), signal: init?.signal ?? undefined, resolve });
  })) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.document = originalDocument;
  });
  return { pending, updates };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

test('stopping a loader aborts pending sources and prevents late panel or banner mutation', async (t) => {
  const { pending, updates } = installDeferredRuntime(t);
  const panel = { update: (patch: Record<string, unknown>) => { updates.push(patch); } };
  const handle = startGridIntelligenceLoader(panel as never, { getActivePlaceId: () => null });
  t.after(() => handle.stop());
  assert.equal(pending.length, 3);
  const updatesAtStop = updates.length;

  handle.stop();
  assert.equal(pending.every((request) => request.signal?.aborted), true);
  for (const request of pending) request.resolve(responseFor(request.path));
  await flushAsync();
  assert.equal(updates.length, updatesAtStop);
});

test('a superseded refresh cannot overwrite newer grid, BGP, or radiation state', async (t) => {
  const { pending, updates } = installDeferredRuntime(t);
  const panel = { update: (patch: Record<string, unknown>) => { updates.push(patch); } };
  const handle = startGridIntelligenceLoader(panel as never, { getActivePlaceId: () => null });
  t.after(() => handle.stop());

  for (const request of pending.splice(0, 3)) request.resolve(responseFor(request.path, 50));
  await flushAsync();

  const older = handle.refresh();
  const olderRequests = pending.splice(0, 3);
  const newer = handle.refresh();
  const newerRequests = pending.splice(0, 3);
  assert.equal(olderRequests.length, 3);
  assert.equal(newerRequests.length, 3);
  assert.equal(olderRequests.every((request) => request.signal?.aborted), true);

  for (const request of newerRequests) request.resolve(responseFor(request.path, 222));
  await newer;
  const updatesAfterNewer = updates.length;
  for (const request of olderRequests) request.resolve(responseFor(request.path, 111));
  await older;
  assert.equal(updates.length, updatesAfterNewer);

  const lastGrid = [...updates].reverse().find((patch) => 'grid' in patch)?.grid as {
    regions?: Array<{ region: string; demandMwh: number | null }>;
  } | null;
  assert.equal(lastGrid?.regions?.find((region) => region.region === 'CISO')?.demandMwh, 222);
  const lastBgp = [...updates].reverse().find((patch) => 'bgp' in patch)?.bgp as {
    events?: Array<{ id: string }>;
  } | null;
  assert.equal(lastBgp?.events?.[0]?.id, 'bgp-222');
  const lastRadiation = [...updates].reverse().find((patch) => 'radiation' in patch)?.radiation as {
    maxCpm?: number | null;
  } | null;
  assert.equal(lastRadiation?.maxCpm, 222);
  handle.stop();
});
