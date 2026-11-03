import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeNWSAlert } from '../alert-normalizer.ts';
import { projectDigestStories } from '../digest-alert-projection.ts';
import { adaptLiveAlert } from '../survival/storm-posture-adapter.ts';
import {
  readOfflineCacheEntry,
  withOfflineCache,
  writeOfflineCacheEntry,
} from '../offline-alert-cache.ts';

const nws = await import('../nws-alerts.ts') as typeof import('../nws-alerts.ts') & {
  _resetNwsAlertsForTest?: () => void;
};

function validAlert(id = 'nws-1'): Record<string, unknown> {
  return {
    id,
    event: 'Red Flag Warning',
    headline: 'Dry fuels and strong winds',
    description: 'Elevated fire danger',
    severity: 'Severe',
    urgency: 'Expected',
    areaDesc: 'Test County',
    sent: '2026-09-03T11:55:00.000Z',
    onset: '2026-09-03T11:59:00.000Z',
    expires: '2026-09-03T13:00:00.000Z',
    status: 'Actual',
    messageType: 'Alert',
    centroid: [-86.7, 41.6],
    geometry: { type: 'Polygon', coordinates: [[[-87, 41], [-86, 41], [-86, 42], [-87, 41]]] },
  };
}

function envelope(alerts: unknown[], observedAt = Date.now()) {
  return { schemaVersion: 1, scope: 'national-active', completeness: 'complete', observedAt, alerts };
}

class MemoryStorage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
  clear(): void { this.values.clear(); }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
}

async function withLocalStorage<T>(storage: MemoryStorage, run: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  try {
    return await run();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
}

test('NWS retrieval evidence is stamped once and preserved by the client cache', async () => {
  assert.equal(typeof nws._resetNwsAlertsForTest, 'function', 'test requires an isolated NWS cache seam');
  nws._resetNwsAlertsForTest?.();
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let calls = 0;
  try {
    Date.now = () => 1_788_437_600_000;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify(envelope([validAlert()])), { status: 200 });
    };

    const first = await nws.fetchNWSAlerts();
    assert.equal(first[0]?.retrievedAt, 1_788_437_600_000);
    Date.now = () => 1_788_437_660_000;
    const cached = await nws.fetchNWSAlerts();
    assert.equal(calls, 1, 'fresh client cache must avoid a second network request');
    assert.equal(cached[0]?.retrievedAt, 1_788_437_600_000,
      'cache reads must preserve the original retrieval evidence instead of making it look newer');
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    nws._resetNwsAlertsForTest?.();
  }
});

test('live alert adaptation uses sent when onset is missing', () => {
  const sent = '2026-09-03T11:55:00.000Z';
  const adapted = adaptLiveAlert({
    id: 'missing-onset',
    event: 'Red Flag Warning',
    sent,
    expires: '2026-09-03T13:00:00.000Z',
  });

  assert.equal(adapted.sent, sent);
});

test('malformed HTTP-200 NWS rows are never cached as current evidence', async () => {
  assert.equal(typeof nws._resetNwsAlertsForTest, 'function', 'test requires an isolated NWS cache seam');
  nws._resetNwsAlertsForTest?.();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls += 1;
      const body = calls === 1 ? [{ id: 'missing-required-fields' }] : [validAlert('valid-after-malformed')];
      return new Response(JSON.stringify(envelope(body)), { status: 200 });
    };

    await assert.rejects(
      nws.fetchNWSAlerts(),
      /malformed/i,
      'malformed HTTP-200 data must reject so the offline-cache layer owns fallback',
    );
    const recovered = await nws.fetchNWSAlerts();
    assert.equal(calls, 2, 'a malformed response must not populate the success cache');
    assert.equal(recovered[0]?.id, 'valid-after-malformed');
    assert.equal(typeof recovered[0]?.retrievedAt, 'number');
  } finally {
    globalThis.fetch = originalFetch;
    nws._resetNwsAlertsForTest?.();
  }
});

test('malformed HTTP-200 rows are not persisted as fresh offline-cache network data', async () => {
  assert.equal(typeof nws._resetNwsAlertsForTest, 'function', 'test requires an isolated NWS cache seam');
  nws._resetNwsAlertsForTest?.();
  const originalFetch = globalThis.fetch;
  const storage = new MemoryStorage();
  const serviceId = 'nws-malformed-http-200-regression';
  try {
    globalThis.fetch = async () => new Response(JSON.stringify(envelope([{ id: 'missing-required-fields' }])), { status: 200 });
    await withLocalStorage(storage, async () => {
      const outcome = await withOfflineCache(serviceId, () => nws.fetchNWSAlerts(), 60 * 60_000)
        .then((snapshot) => ({ rejected: false, source: snapshot.source }))
        .catch(() => ({ rejected: true, source: null }));
      assert.deepEqual({
        ...outcome,
        persisted: readOfflineCacheEntry(serviceId, storage),
      }, {
        rejected: true,
        source: null,
        persisted: null,
      });
    });
  } finally {
    globalThis.fetch = originalFetch;
    nws._resetNwsAlertsForTest?.();
  }
});

test('malformed Polygon and MultiPolygon bodies reject without poisoning the success cache', async (t) => {
  const oversizedRing = Array.from({ length: 50_000 }, (_, index) => (
    [[-87, 41], [-86, 41], [-86, 42], [-87, 42]][index % 4]
  ));
  oversizedRing.push([-87, 41]);
  const malformedGeometries: Array<{ name: string; geometry: unknown }> = [
    {
      name: 'non-array coordinates',
      geometry: { type: 'Polygon', coordinates: 'not-an-array' },
    },
    {
      name: 'unsupported geometry type',
      geometry: { type: 'Point', coordinates: [-86.7, 41.6] },
    },
    {
      name: 'string coordinate',
      geometry: { type: 'Polygon', coordinates: [[['-87', 41], [-86, 41], [-86, 42], ['-87', 41]]] },
    },
    {
      name: 'invalid Polygon nesting',
      geometry: { type: 'Polygon', coordinates: [[-87, 41], [-86, 41], [-86, 42], [-87, 41]] },
    },
    {
      name: 'out-of-range coordinate',
      geometry: { type: 'Polygon', coordinates: [[[181, 41], [-86, 41], [-86, 42], [181, 41]]] },
    },
    {
      name: 'invalid MultiPolygon nesting',
      geometry: { type: 'MultiPolygon', coordinates: [[[[-87, 41], [-86, 41], [-86, 42], [-87, 41]]], ['not-a-polygon']] },
    },
    {
      name: 'over-budget Polygon',
      geometry: { type: 'Polygon', coordinates: [oversizedRing] },
    },
  ];

  for (const item of malformedGeometries) {
    await t.test(item.name, async () => {
      nws._resetNwsAlertsForTest?.();
      const originalFetch = globalThis.fetch;
      let calls = 0;
      try {
        globalThis.fetch = async () => {
          calls += 1;
          const row = calls === 1
            ? { ...validAlert('bad-geometry'), geometry: item.geometry }
            : validAlert('valid-after-bad-geometry');
          return new Response(JSON.stringify(envelope([row])), { status: 200 });
        };

        await assert.rejects(nws.fetchNWSAlerts(), /malformed/i);
        const recovered = await nws.fetchNWSAlerts();
        assert.equal(calls, 2, 'invalid geometry must not populate the five-minute success cache');
        assert.equal(recovered[0]?.id, 'valid-after-bad-geometry');
      } finally {
        globalThis.fetch = originalFetch;
        nws._resetNwsAlertsForTest?.();
      }
    });
  }
});

test('missing or blank onset remains displayable from sent but cannot support a digest complete-negative', async (t) => {
  for (const [name, onset] of [['missing', undefined], ['blank', '   ']] as const) {
    await t.test(name, async () => {
      nws._resetNwsAlertsForTest?.();
      const originalFetch = globalThis.fetch;
      const originalNow = Date.now;
      const now = Date.parse('2026-09-03T12:00:00.000Z');
      try {
        Date.now = () => now;
        const row = validAlert(`onset-${name}`);
        if (onset === undefined) delete row.onset;
        else row.onset = onset;
        globalThis.fetch = async () => new Response(JSON.stringify(envelope([row])), { status: 200 });

        const fetched = await nws.fetchNWSAlerts();
        assert.equal(fetched.length, 1, `${name} onset must not hide an otherwise valid alert`);
        const normalized = normalizeNWSAlert(fetched[0]!);
        assert.equal(normalized.timestamp, Date.parse(row.sent as string), 'sent is the display timestamp fallback');
        const [card] = projectDigestStories({
          seeds: [{
            id: `story-${name}`,
            alertIds: [normalized.id],
            headline: normalized.title,
            narrative: normalized.body,
          }],
          alerts: [normalized],
          savedPlaces: [{
            id: 'far-place', name: 'Far Place', lat: 0, lon: 0, radiusKm: 1,
            tags: [], priority: 0, notes: '', offlinePinned: false, primary: true,
            source: 'manual', sortIndex: 1, createdAt: now, updatedAt: now,
          }],
          now,
        });
        assert.equal(card?.impactStatus, 'unknown', 'missing onset cannot prove complete-negative coverage');
        assert.doesNotMatch(card?.impactText ?? '', /No reported overlap/i);
      } finally {
        globalThis.fetch = originalFetch;
        Date.now = originalNow;
        nws._resetNwsAlertsForTest?.();
      }
    });
  }
});

test('HTTP and network failures reject so the existing offline cache owns stale fallback', async (t) => {
  for (const failure of ['http', 'network'] as const) {
    await t.test(failure, async () => {
      nws._resetNwsAlertsForTest?.();
      const originalFetch = globalThis.fetch;
      const storage = new MemoryStorage();
      const serviceId = `nws-offline-owner-${failure}`;
      const cached = [{ ...validAlert(`cached-${failure}`), retrievedAt: 1234 }];
      try {
        assert.equal(writeOfflineCacheEntry(serviceId, cached, storage), true);
        globalThis.fetch = failure === 'http'
          ? async () => new Response('unavailable', { status: 503 })
          : async () => { throw new TypeError('network unavailable'); };

        await withLocalStorage(storage, async () => {
          const snapshot = await withOfflineCache(serviceId, () => nws.fetchNWSAlerts(), 60 * 60_000);
          assert.equal(snapshot.source, 'offline-cache');
          assert.equal(snapshot.isStale, true);
          assert.deepEqual(snapshot.data, cached);
        });
      } finally {
        globalThis.fetch = originalFetch;
        nws._resetNwsAlertsForTest?.();
      }
    });
  }
});


test('NWS normalization ranks by issued time while preserving future onset separately', async () => {
  nws._resetNwsAlertsForTest?.();
  const originalFetch = globalThis.fetch;
  try {
    const row = validAlert();
    globalThis.fetch = async () => new Response(JSON.stringify(envelope([row])));
    const [alert] = await nws.fetchNWSAlerts();
    assert.equal(normalizeNWSAlert(alert!).timestamp, Date.parse(row.sent as string));
    assert.equal(alert!.onset, row.onset);
  } finally {
    globalThis.fetch = originalFetch;
    nws._resetNwsAlertsForTest?.();
  }
});

test('non-string onset is malformed rather than absent', async (t) => {
  for (const onset of [123, false, {}, []]) {
    await t.test(JSON.stringify(onset), async () => {
      nws._resetNwsAlertsForTest?.();
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = async () => new Response(JSON.stringify(envelope([{ ...validAlert(), onset }])));
        await assert.rejects(nws.fetchNWSAlerts(), /malformed/i);
      } finally {
        globalThis.fetch = originalFetch;
        nws._resetNwsAlertsForTest?.();
      }
    });
  }
});

function boundedRing(length = 4): number[][] {
  const corners = [[-87, 41], [-86, 41], [-86, 42], [-87, 42]];
  return Array.from({ length }, (_, index) => index === length - 1 ? corners[0]! : corners[index % 4]!);
}

test('geometry budgets reject before traversing over-budget coordinates', async (t) => {
  const polygon = (rings: unknown[]) => ({ type: 'Polygon', coordinates: rings });
  const multi = (polygons: unknown[]) => ({ type: 'MultiPolygon', coordinates: polygons });
  const cases = [
    { name: 'feature vertices', prefix: [], target: () => {
      const ring = boundedRing(50_001);
      return { geometry: polygon([ring]), watched: ring };
    } },
    { name: 'feature rings', prefix: [], target: () => {
      const rings = Array.from({ length: 1_025 }, () => boundedRing());
      return { geometry: polygon(rings), watched: rings };
    } },
    { name: 'feature polygons', prefix: [], target: () => {
      const polygons = Array.from({ length: 257 }, () => [boundedRing()]);
      return { geometry: multi(polygons), watched: polygons };
    } },
    { name: 'response vertices', prefix: Array.from({ length: 5 }, () => polygon([boundedRing(50_000)])), target: () => {
      const ring = boundedRing();
      return { geometry: polygon([ring]), watched: ring };
    } },
    { name: 'response rings', prefix: Array.from({ length: 2 }, () => polygon(Array.from({ length: 1_024 }, () => boundedRing()))), target: () => {
      const rings = [boundedRing()];
      return { geometry: polygon(rings), watched: rings };
    } },
    { name: 'response polygons', prefix: Array.from({ length: 2 }, () => multi(Array.from({ length: 256 }, () => [boundedRing()]))), target: () => {
      const polygons = [[boundedRing()]];
      return { geometry: multi(polygons), watched: polygons };
    } },
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      nws._resetNwsAlertsForTest?.();
      const originalFetch = globalThis.fetch;
      const { geometry, watched } = item.target();
      const original = watched[0];
      let reads = 0;
      Object.defineProperty(watched, '0', { get() { reads += 1; return original; } });
      const body = [...item.prefix, geometry].map((shape, index) => ({ ...validAlert(`budget-${index}`), geometry: shape }));
      try {
        assert.equal(nws.validateNWSAlertSnapshot(envelope(body)), null);
        assert.equal(reads, 0, 'over-budget geometry must be rejected before visiting its entries');
      } finally {
        globalThis.fetch = originalFetch;
        nws._resetNwsAlertsForTest?.();
      }
    });
  }
});


test('snapshot acquisition preserves the upstream observation time instead of receive time', async () => {
  nws._resetNwsAlertsForTest?.();
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const now = Date.parse('2026-11-02T04:00:00Z');
  try {
    Date.now = () => now;
    globalThis.fetch = async () => Response.json(envelope([validAlert()], now - 120_000));
    const snapshot = await nws.fetchNWSAlertsSnapshot();
    assert.equal(snapshot.observedAt, now - 120_000);
    assert.equal(snapshot.alerts[0]?.retrievedAt, now - 120_000);
    assert.deepEqual(await nws.fetchNWSAlerts(), snapshot.alerts);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    nws._resetNwsAlertsForTest?.();
  }
});

test('snapshot validator rejects incomplete, legacy, duplicate and future evidence without side effects', () => {
  const now = Date.now();
  const valid = envelope([validAlert()], now);
  for (const input of [
    [validAlert()], { ...valid, completeness: 'partial' }, { ...valid, scope: 'state' },
    { ...valid, observedAt: now + 60_001 }, { ...valid, alerts: [validAlert(), validAlert()] },
    { ...valid, alerts: Array.from({ length: 2001 }, (_, i) => validAlert(`limit-${i}`)) },
  ]) assert.equal(nws.validateNWSAlertSnapshot(input, now), null);
  assert.equal(nws.validateNWSAlertSnapshot(envelope([], now), now)?.alerts.length, 0);
  assert.equal(nws.validateNWSAlertSnapshot(envelope([validAlert()], now - 86_400_000), now)?.observedAt, now - 86_400_000);
});


for (const [label, patch] of [
  ['expiry before issuance', { expires: '2026-09-03T11:54:00Z' }],
  ['expiry equals issuance', { expires: '2026-09-03T11:55:00Z' }],
  ['issuance after acquisition', { sent: '2026-09-03T12:00:00.001Z' }],
  ['negative issuance epoch', { sent: '1969-12-31T23:59:59Z' }],
  ['oversized identity', { id: 'a'.repeat(1025) }],
] as const) {
  test(`renderer rejects ${label} without caching it and immediately recovers`, async () => {
    const originalFetch = globalThis.fetch;
    const originalNow = Date.now;
    const now = Date.parse('2026-09-03T12:00:00Z');
    let calls = 0;
    nws._resetNwsAlertsForTest?.();
    try {
      Date.now = () => now;
      globalThis.fetch = async () => Response.json(envelope([{ ...validAlert(), ...(calls++ === 0 ? patch : {}) }], now));
      await assert.rejects(nws.fetchNWSAlertsSnapshot(), /malformed/i);
      assert.equal((await nws.fetchNWSAlertsSnapshot()).alerts.length, 1);
      assert.equal(calls, 2);
    } finally {
      globalThis.fetch = originalFetch;
      Date.now = originalNow;
      nws._resetNwsAlertsForTest?.();
    }
  });
}

test('renderer admits only snapshots whose temporal and identity metadata can enter lifecycle storage', async () => {
  const { prepareNwsLifecycle } = await import('../nws-alert-lifecycle.ts');
  const backend = await import('../../../src-tauri/sidecar/nws-alert-snapshot.mjs');
  const now = Date.parse('2026-09-03T12:00:00Z');
  assert.equal(nws.validateNWSAlertSnapshot(envelope([], now + 1), now), null);
  assert.equal(backend.validateNWSAlertSnapshot(envelope([], now + 1), now), null);
  assert.equal(nws.validateNWSAlertSnapshot(envelope([], 8_640_000_000_000_001), 9_000_000_000_000_000), null);
  assert.equal(backend.validateNWSAlertSnapshot(envelope([], 8_640_000_000_000_001), 9_000_000_000_000_000), null);
  const oversized = Array.from({ length: 700 }, (_, index) => ({
    ...validAlert(`${index}-` + '界'.repeat(1020)), geometry: null,
  }));
  assert.equal(nws.validateNWSAlertSnapshot(envelope(oversized, now), now), null);
  assert.equal(backend.validateNWSAlertSnapshot(envelope(oversized, now), now), null);
  for (const alerts of [[], [validAlert('a'.repeat(1024))],
    [{ ...validAlert(), sent: '1970-01-01T00:00:00Z', expires: '1970-01-02T00:00:00Z' }],
    [{ ...validAlert(), sent: '2026-09-03T12:00:00Z', expires: '2026-09-03T12:00:00.001Z' }],
  ]) {
    const parsed = nws.validateNWSAlertSnapshot(envelope(alerts, now), now);
    assert.ok(parsed);
    assert.deepEqual(backend.validateNWSAlertSnapshot(envelope(alerts, now), now), parsed);
    assert.ok(prepareNwsLifecycle(parsed, now), 'every admitted boundary case must be usable by lifecycle');
  }
});


for (const mode of ['declared length', 'finite stream'] as const) {
  test(`renderer rejects oversized ${mode} without caching it and recovers immediately`, async () => {
    const originalFetch = globalThis.fetch;
    const originalNow = Date.now;
    const now = Date.parse('2026-09-03T12:00:00Z');
    const limit = 8 * 1024 * 1024;
    let calls = 0;
    nws._resetNwsAlertsForTest?.();
    try {
      Date.now = () => now;
      const data = envelope([validAlert()], now);
      globalThis.fetch = async () => {
        calls += 1;
        if (calls > 1) return Response.json(data);
        if (mode === 'declared length') {
          return new Response(JSON.stringify(data), { headers: { 'content-length': String(limit + 1) } });
        }
        const bytes = new Uint8Array(limit + 1).fill(32);
        bytes.set(new TextEncoder().encode(JSON.stringify(data)));
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes.subarray(0, limit));
            controller.enqueue(bytes.subarray(limit));
            controller.close();
          },
        });
        return new Response(stream);
      };
      await assert.rejects(nws.fetchNWSAlertsSnapshot(), /exceeded byte limit/i);
      assert.equal((await nws.fetchNWSAlertsSnapshot()).alerts.length, 1);
      assert.equal(calls, 2);
    } finally {
      globalThis.fetch = originalFetch;
      Date.now = originalNow;
      nws._resetNwsAlertsForTest?.();
    }
  });
}
