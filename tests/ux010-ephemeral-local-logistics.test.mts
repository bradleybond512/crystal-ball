import assert from 'node:assert/strict';
import test from 'node:test';

import * as localLogistics from '../src/services/local-logistics.ts';

const anchor = { latitude: 0, longitude: -78.8986 };

interface FetchEphemeralOptions {
  radiusKm: 5 | 10 | 25 | 50;
  categories?: string[];
  limitPerCategory?: number;
  signal?: AbortSignal;
}

type FetchEphemeral = (
  anchor: { latitude: number; longitude: number },
  options: FetchEphemeralOptions,
) => Promise<{ placeId: string; placeName: string; queryFingerprint: string; effectiveRadiusKm: number }>;

function requireFetch(): FetchEphemeral {
  const candidate = (localLogistics as Record<string, unknown>).fetchEphemeralLocalLogistics;
  assert.equal(typeof candidate, 'function', 'fetchEphemeralLocalLogistics must be exported');
  return candidate as FetchEphemeral;
}

function emptyResponse(radiusKm = 10, categories = ['shelter', 'hotel', 'hospital', 'pharmacy', 'fuel', 'water', 'recovery']): Response {
  const now = new Date(Date.now() - 1_000).toISOString();
  const providers = [
    { id: 'osm', state: 'empty', acceptedRows: 0, droppedRows: 0, observedAt: now, retrievedAt: now },
    { id: 'fema-open-shelters', state: 'empty', acceptedRows: 0, droppedRows: 0, observedAt: now, retrievedAt: now },
    { id: 'fema-recovery-centers', state: 'empty', acceptedRows: 0, droppedRows: 0, observedAt: now, retrievedAt: now },
    { id: 'ornl-odin', state: 'empty', acceptedRows: 0, droppedRows: 0, observedAt: now, retrievedAt: now },
  ];
  return new Response(JSON.stringify({
    schemaVersion: 2,
    query: { radiusKm, categories },
    sites: [],
    observations: [],
    providers,
    areaConditions: [],
    fetchedAt: now,
    retrievedAt: now,
    partial: false,
    nodes: [],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function responseWithOneFacility(): Promise<Record<string, unknown>> {
  const body = await emptyResponse().json() as Record<string, unknown> & { providers: Array<Record<string, unknown>> };
  const now = new Date(Date.now() - 1_000);
  const expiresAt = new Date(now.getTime() + 60 * 60_000).toISOString();
  body.sites = [{
    id: 'osm:node:1', kind: 'fuel', name: 'Fuel Stop', lat: 0.01, lon: -78.89,
    sourceRefs: [{ provider: 'osm', recordId: 'node/1' }], capabilities: {},
  }];
  body.observations = [{
    id: 'osm:node:1:directory', siteId: 'osm:node:1', provider: 'osm', verification: 'directory',
    operational: 'unknown', inventory: 'unknown', power: 'unknown', access: 'unknown',
    observedAt: now.toISOString(), retrievedAt: now.toISOString(), expiresAt,
    confidence: 'low', sourceUrl: 'https://www.openstreetmap.org/node/1',
  }];
  const osm = body.providers.find((provider) => provider.id === 'osm');
  if (osm) Object.assign(osm, { state: 'ok', acceptedRows: 1 });
  return body;
}

test('ephemeral Lifelines uses an exact private POST and never touches shared persistence or events', async () => {
  const fetchEphemeral = requireFetch();
  const priorFetch = globalThis.fetch;
  const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const requests: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new Proxy({}, { get: () => { throw new Error('ephemeral request touched localStorage'); } }),
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { dispatchEvent: () => { throw new Error('ephemeral request emitted a document event'); } },
  });
  globalThis.fetch = async (input, init) => {
    requests.push({ input, init });
    return emptyResponse();
  };

  try {
    const result = await fetchEphemeral(anchor, { radiusKm: 10 });
    assert.equal(requests.length, 1);
    const request = requests[0];
    assert.equal(String(request?.input), '/api/local-logistics');
    assert.equal(request?.init?.method, 'POST');
    assert.equal(request?.init?.cache, 'no-store');
    assert.equal(request?.init?.referrerPolicy, 'no-referrer');
    assert.equal(new Headers(request?.init?.headers).get('content-type'), 'application/json');
    assert.deepEqual(JSON.parse(String(request?.init?.body)), {
      schemaVersion: 1,
      purpose: 'session-lifelines',
      latitude: 0,
      longitude: -78.8986,
      radiusKm: 10,
      categories: ['shelter', 'hotel', 'hospital', 'pharmacy', 'fuel', 'water', 'recovery'],
      limitPerCategory: 3,
    });
    assert.equal(result.placeId, 'session-current-location');
    assert.equal(result.placeName, 'Current location');
    assert.equal(result.queryFingerprint, 'session-lifelines');
    assert.equal(result.effectiveRadiusKm, 10);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorStorage) Object.defineProperty(globalThis, 'localStorage', priorStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
    if (priorDocument) Object.defineProperty(globalThis, 'document', priorDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});

test('ephemeral Lifelines requests do not coalesce and caller abort is forwarded', async () => {
  const fetchEphemeral = requireFetch();
  const priorFetch = globalThis.fetch;
  const pending: Array<(response: Response) => void> = [];
  const signals: Array<AbortSignal | null | undefined> = [];
  globalThis.fetch = async (_input, init) => {
    signals.push(init?.signal);
    return new Promise<Response>((resolve) => pending.push(resolve));
  };
  const firstController = new AbortController();
  const secondController = new AbortController();

  try {
    const first = fetchEphemeral(anchor, { radiusKm: 10, signal: firstController.signal });
    const second = fetchEphemeral(anchor, { radiusKm: 10, signal: secondController.signal });
    assert.equal(pending.length, 2, 'separate explicit actions must own separate network work');
    firstController.abort();
    secondController.abort();
    assert.equal(signals[0]?.aborted, true, 'the first caller must be able to abort only its request');
    assert.equal(signals[1]?.aborted, true, 'the second caller must be able to abort only its request');
    pending[0]?.(emptyResponse());
    pending[1]?.(emptyResponse());
    await Promise.all([first, second]);
  } finally {
    globalThis.fetch = priorFetch;
  }
});

test('ephemeral Lifelines rejects coordinate-bearing response metadata and never falls back', async () => {
  const fetchEphemeral = requireFetch();
  const priorFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const body = await emptyResponse().json() as Record<string, unknown>;
    body.query = { ...(body.query as object), lat: anchor.latitude };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  try {
    await assert.rejects(fetchEphemeral(anchor, { radiusKm: 10 }), /malformed lifelines query/i);
    assert.equal(calls, 1, 'a rejected private response must not trigger a GET or cache fallback');
  } finally {
    globalThis.fetch = priorFetch;
  }
});

test('ephemeral Lifelines maps remote failure to a bounded error without response details', async () => {
  const fetchEphemeral = requireFetch();
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: 'upstream_failed', latitude: 12.345678, secret: 'provider-token' }),
    { status: 502 },
  );
  try {
    await assert.rejects(
      fetchEphemeral(anchor, { radiusKm: 10 }),
      (error: unknown) => error instanceof Error
        && error.message === 'Lifelines are temporarily unavailable. Try again.'
        && !/12\.345678|provider-token/.test(error.message),
    );
  } finally {
    globalThis.fetch = priorFetch;
  }
});

test('ephemeral Lifelines maps every HTTP failure class without retry, GET, or cache fallback', async () => {
  const fetchEphemeral = requireFetch();
  const priorFetch = globalThis.fetch;
  const cases = [
    [400, 'Current-location Lifelines request was rejected. Choose a supported radius and try again.'],
    [401, 'Current-location Lifelines are unavailable in this app session.'],
    [403, 'Current-location Lifelines are unavailable in this app session.'],
    [405, 'Lifelines are temporarily unavailable. Try again.'],
    [413, 'Current-location Lifelines request was rejected. Choose a supported radius and try again.'],
    [415, 'Current-location Lifelines request was rejected. Choose a supported radius and try again.'],
    [429, 'Current-location Lifelines are temporarily rate limited. Try again later.'],
    [500, 'Lifelines are temporarily unavailable. Try again.'],
    [502, 'Lifelines are temporarily unavailable. Try again.'],
    [503, 'Lifelines are temporarily unavailable. Try again.'],
  ] as const;
  const requests: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
  let status = 500;
  globalThis.fetch = async (input, init) => {
    requests.push({ input, init });
    return new Response(JSON.stringify({ error: 'bounded-error', latitude: 35.994, token: 'secret' }), { status });
  };
  try {
    for (const [nextStatus, expectedMessage] of cases) {
      status = nextStatus;
      const before = requests.length;
      await assert.rejects(
        fetchEphemeral(anchor, { radiusKm: 10 }),
        (error: unknown) => error instanceof Error
          && error.message === expectedMessage
          && !/35\.994|secret|bounded-error/i.test(error.message),
      );
      assert.equal(requests.length, before + 1, `${status} must make exactly one POST`);
      assert.equal(requests.at(-1)?.init?.method, 'POST');
      assert.equal(String(requests.at(-1)?.input), '/api/local-logistics');
    }
  } finally {
    globalThis.fetch = priorFetch;
  }
});

test('ephemeral Lifelines rejects facility provider contribution-count mismatches', async () => {
  const fetchEphemeral = requireFetch();
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const body = await emptyResponse().json() as { providers: Array<Record<string, unknown>> };
    const osm = body.providers.find((provider) => provider.id === 'osm');
    if (osm) Object.assign(osm, { state: 'ok', acceptedRows: 1 });
    return new Response(JSON.stringify(body), { status: 200 });
  };
  try {
    await assert.rejects(fetchEphemeral(anchor, { radiusKm: 10 }), /contribution mismatch/i);
  } finally {
    globalThis.fetch = priorFetch;
  }
});

test('ephemeral Lifelines rejects malformed present outage IDs and optional strings', async () => {
  const fetchEphemeral = requireFetch();
  const priorFetch = globalThis.fetch;
  const invalidRows = [
    { id: '', utilityName: 'Example Electric' },
    { id: 'ornl-odin:37183:utility-1', utilityName: 42 },
  ];
  let index = 0;
  globalThis.fetch = async () => {
    const body = await emptyResponse().json() as {
      providers: Array<Record<string, unknown>>;
      areaConditions: unknown[];
    };
    const odin = body.providers.find((provider) => provider.id === 'ornl-odin');
    if (odin) Object.assign(odin, { state: 'ok', acceptedRows: 1 });
    const now = new Date(Date.now() - 1_000).toISOString();
    body.areaConditions = [{
      type: 'power_outage', coverage: 'reported', countyFips: '37183', county: 'Wake',
      state: 'North Carolina', customersOut: 4, observedAt: now, retrievedAt: now,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), source: 'ornl-odin',
      ...invalidRows[index++],
    }];
    return new Response(JSON.stringify(body), { status: 200 });
  };
  try {
    await assert.rejects(fetchEphemeral(anchor, { radiusKm: 10 }), /malformed Lifelines outage evidence/i);
    await assert.rejects(fetchEphemeral(anchor, { radiusKm: 10 }), /malformed Lifelines outage evidence/i);
  } finally {
    globalThis.fetch = priorFetch;
  }
});

test('ephemeral Lifelines rejects coordinate-bearing or arbitrary top-level response metadata', async () => {
  const fetchEphemeral = requireFetch();
  const priorFetch = globalThis.fetch;
  const forbidden = ['latitude', 'longitude', 'purpose', 'requestFingerprint', 'arbitrary'];
  let index = 0;
  globalThis.fetch = async () => {
    const body = await emptyResponse().json() as Record<string, unknown>;
    body[forbidden[index++] ?? 'arbitrary'] = 'must-not-survive';
    return new Response(JSON.stringify(body), { status: 200 });
  };
  try {
    for (const _key of forbidden) {
      await assert.rejects(fetchEphemeral(anchor, { radiusKm: 10 }), /malformed Lifelines response/i);
    }
  } finally {
    globalThis.fetch = priorFetch;
  }
});

test('ephemeral Lifelines rejects anchor-derived wire distances on sites and deprecated nodes', async () => {
  const fetchEphemeral = requireFetch();
  const priorFetch = globalThis.fetch;
  const mutations = [
    (body: Record<string, unknown>) => {
      const sites = body.sites as Array<Record<string, unknown>>;
      if (sites[0]) sites[0].distanceKm = 1.234;
    },
    (body: Record<string, unknown>) => {
      body.nodes = [{ id: 'deprecated-node', distanceKm: 1.234 }];
    },
  ];
  let index = 0;
  globalThis.fetch = async () => {
    const body = await responseWithOneFacility();
    mutations[index++]?.(body);
    return new Response(JSON.stringify(body), { status: 200 });
  };
  try {
    for (const _mutation of mutations) {
      await assert.rejects(fetchEphemeral(anchor, { radiusKm: 10 }), /distance.*not allowed/i);
    }
  } finally {
    globalThis.fetch = priorFetch;
  }
});

test('ephemeral Lifelines rejects duplicate site, observation, provider, and outage-condition IDs', async () => {
  const fetchEphemeral = requireFetch();
  const priorFetch = globalThis.fetch;
  const duplicateBodies: Array<() => Promise<Record<string, unknown>>> = [
    async () => {
      const body = await responseWithOneFacility();
      body.sites = [...(body.sites as unknown[]), structuredClone((body.sites as unknown[])[0])];
      return body;
    },
    async () => {
      const body = await responseWithOneFacility();
      body.observations = [...(body.observations as unknown[]), structuredClone((body.observations as unknown[])[0])];
      const osm = (body.providers as Array<Record<string, unknown>>).find((provider) => provider.id === 'osm');
      if (osm) osm.acceptedRows = 2;
      return body;
    },
    async () => {
      const body = await emptyResponse().json() as Record<string, unknown> & { providers: Array<Record<string, unknown>> };
      body.providers[3] = structuredClone(body.providers[0]);
      return body;
    },
    async () => {
      const body = await emptyResponse().json() as Record<string, unknown> & { providers: Array<Record<string, unknown>> };
      const now = new Date(Date.now() - 1_000).toISOString();
      const condition = {
        id: 'ornl-odin:37183:utility-1', type: 'power_outage', coverage: 'reported',
        countyFips: '37183', county: 'Wake', state: 'North Carolina', customersOut: 4,
        observedAt: now, retrievedAt: now, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        source: 'ornl-odin', utilityId: 'utility-1',
      };
      body.areaConditions = [condition, structuredClone(condition)];
      const odin = body.providers.find((provider) => provider.id === 'ornl-odin');
      if (odin) Object.assign(odin, { state: 'ok', acceptedRows: 2 });
      return body;
    },
  ];
  let index = 0;
  globalThis.fetch = async () => new Response(JSON.stringify(await duplicateBodies[index++]?.()), { status: 200 });
  try {
    for (const _fixture of duplicateBodies) {
      await assert.rejects(fetchEphemeral(anchor, { radiusKm: 10 }), /duplicate Lifelines|provider coverage mismatch/i);
    }
  } finally {
    globalThis.fetch = priorFetch;
  }
});

test('ephemeral Lifelines rejects every invalid request before the first fetch', async () => {
  const fetchEphemeral = requireFetch();
  const priorFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return emptyResponse(); };
  const cases: Array<[
    { latitude: number; longitude: number },
    FetchEphemeralOptions,
  ]> = [
    [{ latitude: Number.NaN, longitude: 0 }, { radiusKm: 10 }],
    [{ latitude: 91, longitude: 0 }, { radiusKm: 10 }],
    [{ latitude: 0, longitude: Number.POSITIVE_INFINITY }, { radiusKm: 10 }],
    [{ latitude: 0, longitude: -181 }, { radiusKm: 10 }],
    [anchor, { radiusKm: 11 as 10 }],
    [anchor, { radiusKm: 10, categories: [] }],
    [anchor, { radiusKm: 10, categories: ['fuel', 'fuel'] }],
    [anchor, { radiusKm: 10, categories: ['surprise'] }],
    [anchor, { radiusKm: 10, limitPerCategory: 0 }],
    [anchor, { radiusKm: 10, limitPerCategory: 6 }],
    [anchor, { radiusKm: 10, limitPerCategory: 1.5 }],
  ];
  try {
    for (const [invalidAnchor, options] of cases) {
      await assert.rejects(fetchEphemeral(invalidAnchor, options), /Invalid current-location Lifelines request/i);
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = priorFetch;
  }
});
