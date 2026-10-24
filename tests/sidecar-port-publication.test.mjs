import test from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

assert.equal(process.env.CB_TEST_RUNNER_GROUP, '1', 'Run publication behavior through test:port-publication and its owned fixture');
const { publishSidecarPort } = await import('../src-tauri/sidecar/local-api-server.mjs');

function fixture(t, port = 42_123) {
  const directory = mkdtempSync(join(tmpdir(), 'cb-port-publication-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const errors = [];
  const server = {
    closes: 0,
    address: () => ({ port }),
    close(done) { this.closes++; done(); },
  };
  return { directory, path: join(directory, 'sidecar.port'), errors, server, logger: { error(message) { errors.push(message); } } };
}

test('publication exposes the complete actual bound port only after its private file is closed', async (t) => {
  const f = fixture(t);
  writeFileSync(f.path, 'previous-publication');
  let closed = false;
  let renames = 0;
  const port = await publishSidecarPort(f.server, f.path, f.logger, {
    closeSync(descriptor) { closeSync(descriptor); closed = true; },
    renameSync(temporary, target) {
      assert.equal(closed, true, 'close the complete temporary file before publication');
      assert.equal(target, f.path, 'the existing runtime path is retained');
      assert.equal(readFileSync(target, 'utf8'), 'previous-publication');
      assert.equal(readFileSync(temporary, 'utf8'), '42123');
      assert.equal(statSync(temporary).mode & 0o777, 0o600);
      renameSync(temporary, target);
      renames++;
    },
  });
  assert.equal(port, 42_123);
  assert.equal(renames, 1);
  assert.equal(readFileSync(f.path, 'utf8'), '42123');
  assert.equal(statSync(f.path).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(f.directory), ['sidecar.port']);
  assert.equal(f.server.closes, 0, 'a successfully published listener stays running');
  assert.deepEqual(f.errors, []);
});

for (const operation of ['openSync', 'fchmodSync', 'writeFileSync', 'renameSync']) {
  test(`${operation} failure is visible and fatal, preserves the target and closes the owned listener`, async (t) => {
    const f = fixture(t);
    writeFileSync(f.path, 'previous-publication');
    const io = {
      [operation](...args) {
        if (operation === 'writeFileSync') writeFileSync(args[0], '4');
        throw Object.assign(new Error(`private fixture path ${f.path} secret fixture-value`), { code: 'EACCES' });
      },
    };
    await assert.rejects(publishSidecarPort(f.server, f.path, f.logger, io), {
      message: 'Sidecar port publication failed (EACCES)',
    });
    assert.equal(f.server.closes, 1);
    assert.equal(readFileSync(f.path, 'utf8'), 'previous-publication');
    assert.deepEqual(readdirSync(f.directory), ['sidecar.port'], 'attempt-owned temporary file is removed');
    assert.deepEqual(f.errors, ['[local-api] Sidecar port publication failed (EACCES)']);
    assert.ok(!f.errors.join('\n').includes(f.path), 'failure diagnostics do not expose arbitrary error text');
  });
}

test('an exclusive-create collision never removes the file this attempt did not create', async (t) => {
  const f = fixture(t);
  let collision;
  await assert.rejects(publishSidecarPort(f.server, f.path, f.logger, {
    openSync(temporary) {
      collision = temporary;
      writeFileSync(temporary, 'other-attempt');
      throw Object.assign(new Error('exists'), { code: 'EEXIST' });
    },
  }), /Sidecar port publication failed \(EEXIST\)/);
  assert.equal(readFileSync(collision, 'utf8'), 'other-attempt');
  assert.equal(existsSync(f.path), false);
  assert.equal(f.server.closes, 1);
});

test('standalone mode without a native portfile does not write or close the listener', async (t) => {
  const f = fixture(t);
  const port = await publishSidecarPort(f.server, undefined, f.logger, {
    openSync() { throw new Error('standalone mode must not publish a file'); },
  });
  assert.equal(port, 42_123);
  assert.deepEqual(readdirSync(f.directory), []);
  assert.equal(f.server.closes, 0);
});

test('an unavailable bound address cannot become the preferred port', async (t) => {
  const f = fixture(t);
  f.server.address = () => null;
  await assert.rejects(publishSidecarPort(f.server, f.path, f.logger), /PORT_UNAVAILABLE/);
  assert.equal(f.server.closes, 1);
  assert.deepEqual(readdirSync(f.directory), []);
});

test('listener cleanup errors remain visible and cannot turn failed publication into success', async (t) => {
  const f = fixture(t);
  f.server.close = (done) => done(Object.assign(new Error('close fixture'), { code: 'EIO' }));
  await assert.rejects(publishSidecarPort(f.server, f.path, f.logger, {
    openSync() { throw Object.assign(new Error('write fixture'), { code: 'EACCES' }); },
  }), /Sidecar port publication failed \(EACCES\)/);
  assert.ok(f.errors.includes('[local-api] port publication listener cleanup failed (EIO)'));
});

test('publication failure closes owned active connections before rejecting startup', async (t) => {
  const f = fixture(t);
  let finishClose;
  let closedConnections = 0;
  f.server.close = (done) => { finishClose = done; };
  f.server.closeAllConnections = () => { closedConnections++; finishClose(); };
  await assert.rejects(publishSidecarPort(f.server, f.path, f.logger, {
    openSync() { throw Object.assign(new Error('write fixture'), { code: 'EACCES' }); },
  }), /Sidecar port publication failed \(EACCES\)/);
  assert.equal(closedConnections, 1);
});

test('native sidecar startup awaits publication before healthy logging or heartbeat writes', () => {
  const source = readFileSync(new URL('../src-tauri/sidecar/local-api-server.mjs', import.meta.url), 'utf8');
  const start = source.slice(source.indexOf(' async start() {'), source.indexOf(' async close() {'));
  const publication = start.indexOf('const boundPort = await publishSidecarPort(server, process.env.LOCAL_API_PORT_FILE, context.logger);');
  const healthy = start.indexOf('context.logger.log(`[local-api] listening on');
  const heartbeat = start.indexOf("const heartbeatPath =");
  assert.ok(publication >= 0 && healthy > publication && heartbeat > healthy);
  assert.doesNotMatch(start.slice(publication, healthy), /catch|return/);
  assert.doesNotMatch(start, /writeFileSync\(portFile|boundPort.*: context\.port/);
});
