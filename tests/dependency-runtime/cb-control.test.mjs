import '../helpers/loopback-only.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { assertHostedLinux, graphRequire, ownedRuntimeFixture, websocketExchange } from '../helpers/dependency-runtime-fixture.mjs';

test('cb-control installed dependency graph', { timeout: 25_000 }, async (t) => {
  assertHostedLinux();
  const fixture = ownedRuntimeFixture(t);
  const require = graphRequire('cb-control');
  await t.test('actual storage persists sessions and indexes/deletes event text', async () => {
    const Database = require('better-sqlite3');
    const { config } = await import('../../tools/cb-control/server/config.mjs');
    assert.equal(config.dbPath, join(fixture.root, 'cb-control/data/cb-control.sqlite'));
    const { storage, db } = await import('../../tools/cb-control/server/storage.mjs');
    try {
      storage.upsertSession({ id: 'runtime-fixture', cwd: fixture.home, label: 'fixture session' });
      storage.appendEvent('runtime-fixture', 'output', { text: 'dependency constellation marker' });
      assert.equal(storage.getSession('runtime-fixture').label, 'fixture session');
      assert.equal(storage.search('constellation').length, 1);
      const event = storage.readEvents('runtime-fixture')[0];
      assert.equal(JSON.parse(event.payload).text, 'dependency constellation marker');
      storage.markEnded('runtime-fixture', 0);
      assert.equal(storage.getSession('runtime-fixture').status, 'ended');
      db.close();
      const reopened = new Database(config.dbPath);
      try {
        reopened.pragma('foreign_keys = ON');
        assert.equal(reopened.prepare('SELECT status FROM sessions WHERE id = ?').get('runtime-fixture').status, 'ended');
        assert.equal(reopened.prepare("SELECT count(*) AS n FROM events_fts WHERE events_fts MATCH 'constellation'").get().n, 1);
        reopened.prepare('DELETE FROM sessions WHERE id = ?').run('runtime-fixture');
        assert.equal(reopened.prepare('SELECT count(*) AS n FROM events').get().n, 0);
        assert.equal(reopened.prepare('SELECT count(*) AS n FROM events_fts').get().n, 0);
      } finally { reopened.close(); }
      assert.ok(existsSync(config.dbPath));
    } finally { if (db.open) db.close(); }
  });
  await t.test('ws exchanges messages on an owned loopback server', { timeout: 5000 }, async (child) => {
    const reply = await websocketExchange(child, require('ws'), 'control-fixture-response');
    assert.equal(reply, 'control-fixture-response');
  });
  await t.test('PTY runs one fixed marker child and exits', { timeout: 5000 }, async () => {
    const pty = require('node-pty');
    const terminal = pty.spawn(process.execPath, ['-e', "process.stdout.write('dependency-pty-marker');"], {
      name: 'xterm', cols: 80, rows: 24, cwd: fixture.home, env: fixture.env,
    });
    let output = '';
    let data;
    let exit;
    let timer;
    try {
      const result = await new Promise((resolveExit, reject) => {
        timer = setTimeout(() => { terminal.kill(); reject(new Error('PTY fixture exceeded deadline')); }, 3000);
        data = terminal.onData((chunk) => {
          output += chunk;
          if (output.length > 4096) { terminal.kill(); reject(new Error('PTY fixture exceeded output bound')); }
        });
        exit = terminal.onExit(resolveExit);
      });
      assert.equal(result.exitCode, 0);
      assert.equal(output, 'dependency-pty-marker');
    } finally {
      clearTimeout(timer);
      data?.dispose();
      exit?.dispose();
      try { terminal.kill(); } catch { /* The fixed child may already have exited. */ }
    }
  });
});
