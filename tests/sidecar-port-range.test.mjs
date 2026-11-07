import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createLocalApiServer } from '../src-tauri/sidecar/local-api-server.mjs';

async function withServer(port, run) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'cb-port-range-'));
  const portFile = path.join(dataDir, 'bound-port');
  const oldFile = process.env.LOCAL_API_PORT_FILE;
  const oldToken = process.env.LOCAL_API_TOKEN;
  process.env.LOCAL_API_TOKEN = randomUUID();
  process.env.LOCAL_API_PORT_FILE = portFile;
  const warnings = [];
  let app;
  try {
    app = await createLocalApiServer({ port, dataDir, apiDir: path.resolve('api'),
      agentMonitorStatePath: path.join(dataDir, 'monitor-state.json'),
      agentMonitorEventsPath: path.join(dataDir, 'monitor-events.json'),
      littleSnitchExportPath: null, littleSnitchBaselinePath: null,
      logger: { log() {}, warn(message) { warnings.push(message); }, error() {} },
    });
    await run(app, portFile, warnings);
  } finally {
    if (app?.server.listening) await app.close();
    else app?.context.evidenceStore?.close();
    if (oldToken === undefined) delete process.env.LOCAL_API_TOKEN;
    else process.env.LOCAL_API_TOKEN = oldToken;
    if (oldFile === undefined) delete process.env.LOCAL_API_PORT_FILE;
    else process.env.LOCAL_API_PORT_FILE = oldFile;
    await rm(dataDir, { recursive: true, force: true });
  }
}

// Exercise the production start() path, its retry listeners, and real port-file
// publication. Successful attempts bind an owned ephemeral socket so test
// processes never contend for the canonical sidecar or either model port.
function scriptListen(t, server, fail) {
  const listen = server.listen;
  const attempts = [];
  t.mock.method(server, 'listen', function (port, host) {
    attempts.push(port);
    assert.equal(host, '127.0.0.1');
    const error = fail(port);
    if (error) { queueMicrotask(() => this.emit('error', error)); return this; }
    return listen.call(this, 0, host);
  });
  return attempts;
}

const busy = () => Object.assign(new Error('owned test port is busy'), { code: 'EADDRINUSE' });
const allCandidates = Array.from({ length: 11 }, (_, i) => 46123 + i);
for (const [label, base, occupied, expected] of [
  ['first choice free', 46123, [], [46123]],
  ['one busy port', 46123, [46123], [46123, 46124]],
  ['two busy ports', 46123, [46123, 46124], [46123, 46124, 46125]],
  ['bounded range exhausted', 46123, allCandidates, [...allCandidates, 0]],
  ['upper port boundary', 65534, [65534, 65535], [65534, 65535, 0]],
  ['explicit OS allocation', 0, [], [0]],
]) {
  test(`startup publishes only the actual bind after ${label}`, async t => {
    await withServer(base, async (app, file, warnings) => {
      const attempts = scriptListen(t, app.server, candidate => occupied.includes(candidate) ? busy() : null);
      const { port } = await app.start();
      assert.deepEqual(attempts, expected);
      const exhaustionWarnings = warnings.filter(message => /native health only/i.test(message));
      if (expected.length > 1 && expected.at(-1) === 0) {
        assert.equal(exhaustionWarnings.length, 1);
        assert.ok(exhaustionWarnings[0].includes(`${base}-${expected.at(-2)}`));
        assert.match(exhaustionWarnings[0], /webview cannot reach/i);
      } else {
        assert.deepEqual(exhaustionWarnings, []);
      }
      assert.equal(port, app.server.address().port);
      assert.equal(port, app.context.port);
      assert.equal((await readFile(file, 'utf8')).trim(), String(port));
      assert.equal((await stat(file)).mode & 0o777, 0o600);
    });
  });
}

test('a non-collision listen error stops at that candidate and cannot publish a port', async t => {
  await withServer(46123, async (app, file) => {
    const denied = Object.assign(new Error('fixture denial'), { code: 'EACCES' });
    const attempts = scriptListen(t, app.server, candidate => candidate === 46123 ? busy() : denied);
    await assert.rejects(app.start(), error => error === denied);
    assert.deepEqual(attempts, [46123, 46124]);
    assert.equal(existsSync(file), false);
  });
});

for (const port of [-1, 65536]) {
  test(`invalid preferred port ${port} rejects without publishing or retrying with zero`, async () => {
    await withServer(port, async (app, file) => {
      await assert.rejects(app.start(), { code: 'ERR_SOCKET_BAD_PORT' });
      assert.equal(existsSync(file), false);
      assert.equal(app.server.listening, false);
    });
  });
}
