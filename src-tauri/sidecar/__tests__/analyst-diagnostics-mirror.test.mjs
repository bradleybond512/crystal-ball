import assert from 'node:assert/strict';
import test from 'node:test';

const TEST_TOKEN = 'analyst-diagnostics-test-token';
process.env.LOCAL_API_TOKEN ??= TEST_TOKEN;
const { createLocalApiServer } = await import('../local-api-server.mjs');

const silentLogger = { log() {}, warn() {}, error() {} };

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
