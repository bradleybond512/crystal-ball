import assert from 'node:assert/strict';
import test from 'node:test';

const TEST_TOKEN = 'analyst-diagnostics-test-token';
process.env.LOCAL_API_TOKEN ??= TEST_TOKEN;
const {
  createLocalApiServer,
  validateEvaluationReportProjection,
} = await import('../local-api-server.mjs');

const silentLogger = { log() {}, warn() {}, error() {} };

function validEvaluationProjection(overrides = {}) {
  return {
    schemaVersion: 1,
    generatedAt: Date.now(),
    forecast: {
      total: 20,
      resolved: 10,
      pending: 8,
      overduePending: 2,
      expired: 2,
      resolutionCoverage: 0.5,
      expirationRate: 0.1,
      metrics: {
        brier: { status: 'ok', sampleSize: 10, value: 0.2 },
        logLoss: { status: 'insufficient_evidence', sampleSize: 10, minSampleSize: 30 },
        brierSkill: { status: 'ok', sampleSize: 10, value: -0.1 },
        equalMassEce: { status: 'unavailable' },
      },
      largestVersionLossShare: 0.6,
      quarantinedCount: 1,
    },
    champion: {
      availability: 'available',
      active: { model: 'production', version: '1.2.3', activatedAt: 1_700_000_000_000 },
      challengers: [{
        model: 'superforecast',
        status: 'promotable',
        evidenceCount: 120,
        proxyShare: 0.1,
        perDomain: [{ domain: 'weather', count: 60 }],
        deltas: [{ metric: 'brier', delta: -0.02, ciLow: -0.04, ciHigh: -0.01 }],
      }],
      promotions: [{ at: 1_700_000_000_000, kind: 'initial', model: 'production' }],
      rejectionHistory: {
        availability: 'unavailable',
        reasonCode: 'no_runtime_rejection_history',
      },
    },
    ...overrides,
  };
}

async function postAnalystState(base, headers, body) {
  return fetch(`${base}/api/analyst-state`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

test('analyst-state mirrors bounded diagnostics and pipeline traces for agents', async () => {
  const app = await createLocalApiServer({ port: 0, logger: silentLogger });
  const { port } = await app.start();
  const base = `http://127.0.0.1:${port}`;
  const headers = {
    authorization: `Bearer ${process.env.LOCAL_API_TOKEN}`,
    'content-type': 'application/json',
  };
  try {
    const post = await fetch(`${base}/api/analyst-state`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        timestamp: Date.now(),
        algorithmDiagnostics: {
          schemaVersion: 1,
          health: { status: 'healthy', algorithms: [] },
          ledger: { total: 2, graded: 1, pending: 1 },
          runtime: [],
          __proto__: { polluted: true },
        },
        pipelineTrace: {
          total: 1,
          entries: [{ id: 'trace-1', events: [] }],
        },
      }),
    });
    assert.equal(post.status, 200);

    const get = await fetch(`${base}/api/analyst-state`, { headers });
    assert.equal(get.status, 200);
    const body = await get.json();
    assert.equal(body.algorithmDiagnostics.schemaVersion, 1);
    assert.equal(body.algorithmDiagnostics.polluted, undefined);
    assert.equal(body.pipelineTrace.total, 1);
    assert.equal(body.pipelineTrace.entries[0].id, 'trace-1');
  } finally {
    await app.close();
  }
});

test('analyst-state diagnostics updates preserve the latest analyst and forecast snapshots', async () => {
  const app = await createLocalApiServer({ port: 0, logger: silentLogger });
  const { port } = await app.start();
  const base = `http://127.0.0.1:${port}`;
  const headers = {
    authorization: `Bearer ${process.env.LOCAL_API_TOKEN}`,
    'content-type': 'application/json',
  };
  try {
    const initial = await fetch(`${base}/api/analyst-state`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        timestamp: 1000,
        analyst: {
          timestamp: 900,
          hypotheses: [{ id: 'hypothesis-1' }],
          aiEnriched: true,
        },
        forecast: {
          timestamp: 950,
          advisories: [{ id: 'advisory-1' }],
          pressure: { overall: 0.72 },
        },
      }),
    });
    assert.equal(initial.status, 200);

    const diagnosticsOnly = await fetch(`${base}/api/analyst-state`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        timestamp: 2000,
        algorithmDiagnostics: {
          schemaVersion: 1,
          ledger: { total: 10, graded: 4, pending: 6 },
        },
      }),
    });
    assert.equal(diagnosticsOnly.status, 200);

    const get = await fetch(`${base}/api/analyst-state`, { headers });
    assert.equal(get.status, 200);
    const body = await get.json();
    assert.equal(body.timestamp, 2000);
    assert.equal(body.analyst.hypotheses[0].id, 'hypothesis-1');
    assert.equal(body.forecast.advisories[0].id, 'advisory-1');
    assert.equal(body.algorithmDiagnostics.ledger.graded, 4);
  } finally {
    await app.close();
  }
});

test('analyst-state accepts only the exact bounded evaluation-report projection schema', async () => {
  const app = await createLocalApiServer({ port: 0, logger: silentLogger });
  const { port } = await app.start();
  const base = `http://127.0.0.1:${port}`;
  const headers = {
    authorization: `Bearer ${process.env.LOCAL_API_TOKEN}`,
    'content-type': 'application/json',
  };
  try {
    const projection = validEvaluationProjection();
    const post = await postAnalystState(base, headers, {
      timestamp: Date.now(),
      evaluationReportProjection: projection,
    });
    assert.equal(post.status, 200);

    const get = await fetch(`${base}/api/analyst-state`, { headers });
    const body = await get.json();
    assert.deepEqual(body.evaluationReportProjection, projection);
    assert.equal(body.evaluationReportProjection.champion.challengers.length, 1);
  } finally {
    await app.close();
  }
});

test('invalid evaluation-report updates preserve the last valid projection atomically', async () => {
  const app = await createLocalApiServer({ port: 0, logger: silentLogger });
  const { port } = await app.start();
  const base = `http://127.0.0.1:${port}`;
  const headers = {
    authorization: `Bearer ${process.env.LOCAL_API_TOKEN}`,
    'content-type': 'application/json',
  };
  const sentinel = validEvaluationProjection();
  try {
    const initial = await postAnalystState(base, headers, {
      timestamp: Date.now(),
      evaluationReportProjection: sentinel,
    });
    assert.equal(initial.status, 200);

    const invalidCandidates = [
      { ...sentinel, schemaVersion: 2 },
      { ...sentinel, unknown: 'must-not-pass' },
      { ...sentinel, forecast: { ...sentinel.forecast, total: 1_000_000_001 } },
      { ...sentinel, forecast: { ...sentinel.forecast, resolutionCoverage: -1 } },
      {
        ...sentinel,
        champion: { ...sentinel.champion, availability: 'healthy' },
      },
      {
        ...sentinel,
        champion: {
          ...sentinel.champion,
          challengers: Array.from({ length: 5 }, () => sentinel.champion.challengers[0]),
        },
      },
      {
        ...sentinel,
        champion: {
          ...sentinel.champion,
          active: { ...sentinel.champion.active, version: 'unsafe version with spaces' },
        },
      },
      { forecast: { total: 999 } },
      JSON.parse(`{"schemaVersion":1,"generatedAt":${Date.now()},"forecast":{"__proto__":{"polluted":true}}}`),
    ];

    for (const candidate of invalidCandidates) {
      const response = await postAnalystState(base, headers, {
        timestamp: Date.now(),
        evaluationReportProjection: candidate,
      });
      assert.equal(response.status, 200);
      const get = await fetch(`${base}/api/analyst-state`, { headers });
      const body = await get.json();
      assert.deepEqual(body.evaluationReportProjection, sentinel);
      assert.equal({}.polluted, undefined);
    }
  } finally {
    await app.close();
  }
});

test('evaluation-report validator rejects non-finite numbers and sentinel boundaries', () => {
  const now = Date.now();
  assert.equal(validateEvaluationReportProjection(validEvaluationProjection(), now)?.schemaVersion, 1);
  assert.equal(validateEvaluationReportProjection(validEvaluationProjection({ generatedAt: Number.NaN }), now), null);
  assert.equal(validateEvaluationReportProjection(validEvaluationProjection({ generatedAt: Number.POSITIVE_INFINITY }), now), null);
  assert.equal(validateEvaluationReportProjection(validEvaluationProjection({ generatedAt: now + 5 * 60_000 + 1 }), now), null);
  assert.equal(validateEvaluationReportProjection({
    ...validEvaluationProjection(),
    forecast: {
      ...validEvaluationProjection().forecast,
      metrics: {
        ...validEvaluationProjection().forecast.metrics,
        brier: { status: 'ok', sampleSize: 10, value: Number.NaN },
      },
    },
  }, now), null);
});
