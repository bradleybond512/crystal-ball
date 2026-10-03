// R4-SEC-004: every command an outside caller queues on /api/analyst-commands
// is tagged origin: 'external', so the renderer can hold agent feedback for
// the user's confirmation. Identifier fields are bounded.
import assert from 'node:assert/strict';
import test from 'node:test';

const TEST_TOKEN = 'analyst-commands-origin-test-token';
process.env.LOCAL_API_TOKEN ??= TEST_TOKEN;
const { createLocalApiServer } = await import('../local-api-server.mjs');

const silentLogger = { log() {}, warn() {}, error() {} };

async function withServer(run) {
  const app = await createLocalApiServer({ port: 0, logger: silentLogger });
  const { port } = await app.start();
  const base = `http://127.0.0.1:${port}`;
  const headers = {
    authorization: `Bearer ${process.env.LOCAL_API_TOKEN}`,
    'content-type': 'application/json',
  };
  try {
    await run({ base, headers });
  } finally {
    await app.close();
  }
}

async function drain(base, headers) {
  const res = await fetch(`${base}/api/analyst-commands`, { headers });
  return res.json();
}

async function post(base, headers, body) {
  return fetch(`${base}/api/analyst-commands`, { method: 'POST', headers, body: JSON.stringify(body) });
}

test('queued analyst commands are tagged external, whatever the caller claims', async () => {
  await withServer(async ({ base, headers }) => {
    for (const kind of ['thumbs_up', 'thumbs_down', 'dismiss', 'run_skeptic']) {
      const res = await post(base, headers, { kind, hypothesisId: `h-${kind}`, origin: 'renderer', note: 'n' });
      assert.equal(res.status, 200, kind);
    }
    const drained = await drain(base, headers);
    assert.equal(drained.commands.length, 4);
    for (const command of drained.commands) {
      assert.equal(command.origin, 'external', command.kind);
      assert.equal(command.hypothesisId, `h-${command.kind}`);
    }
  });
});

test('identifier fields and notes are bounded', async () => {
  await withServer(async ({ base, headers }) => {
    const res = await post(base, headers, {
      kind: 'dismiss',
      hypothesisId: 'i'.repeat(1000),
      signature: 's'.repeat(5000),
      note: 'n'.repeat(5000),
    });
    assert.equal(res.status, 200);
    const { commands: [command] } = await drain(base, headers);
    assert.equal(command.hypothesisId.length, 128);
    assert.equal(command.signature.length, 512);
    assert.equal(command.note.length, 400);
  });
});

test('unknown kinds are still rejected', async () => {
  await withServer(async ({ base, headers }) => {
    const res = await post(base, headers, { kind: 'set_calibration', hypothesisId: 'h' });
    assert.equal(res.status, 400);
  });
});
