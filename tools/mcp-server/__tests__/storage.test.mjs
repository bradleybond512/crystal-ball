import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStorage } from '../storage.mjs';

describe('storage', () => {
  let tmp;
  let storage;

  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'cb-storage-'));
    storage = createStorage(tmp);
  });

  after(() => rmSync(tmp, { recursive: true }));

  test('readJSON returns null for missing file', () => {
    const result = storage.readJSON('nonexistent.json');
    assert.equal(result, null);
  });

  test('resolve refuses path traversal out of the sandbox', () => {
    // Caller input (e.g. an MCP watchlist name) reaches resolve(); a `../`
    // payload must not escape baseDir for read/write/delete.
    assert.throws(() => storage.resolve('../evil.json'), /sandbox/i);
    assert.throws(() => storage.resolve('../../.ssh/authorized_keys'), /sandbox/i);
    assert.throws(() => storage.resolve('watchlists/../../../etc/x.json'), /sandbox/i);
    assert.throws(() => storage.resolve('bad\0name'), /Invalid path/i);
    // legitimate subpaths still resolve under baseDir
    assert.ok(storage.resolve('watchlists/foo.json').endsWith(join('watchlists', 'foo.json')));
  });

  test('writeJSON creates file and parent dirs', () => {
    storage.writeJSON('sentinel/latest-snapshot.json', { foo: 1 });
    const raw = readFileSync(join(tmp, 'sentinel', 'latest-snapshot.json'), 'utf8');
    assert.deepEqual(JSON.parse(raw), { foo: 1 });
  });

  test('readJSON reads back written data', () => {
    storage.writeJSON('test.json', { bar: 2 });
    const result = storage.readJSON('test.json');
    assert.deepEqual(result, { bar: 2 });
  });

  test('appendToArray creates file if missing then appends', () => {
    storage.appendToArray('alerts.json', { id: 1 });
    storage.appendToArray('alerts.json', { id: 2 });
    const result = storage.readJSON('alerts.json');
    assert.deepEqual(result, [{ id: 1 }, { id: 2 }]);
  });

  test('listFiles returns matching files in a subdirectory', () => {
    storage.writeJSON('history/2026-04-14-0800.json', { a: 1 });
    storage.writeJSON('history/2026-04-14-0830.json', { b: 2 });
    const files = storage.listFiles('history', '*.json');
    assert.equal(files.length, 2);
    assert.ok(files.includes('2026-04-14-0800.json'));
    assert.ok(files.includes('2026-04-14-0830.json'));
  });

  test('pruneOlderThan removes files older than N days', () => {
    storage.writeJSON('history/old.json', { old: true });
    const oldPath = join(tmp, 'history', 'old.json');
    const eightDaysAgo = new Date(Date.now() - 8 * 86400000);
    utimesSync(oldPath, eightDaysAgo, eightDaysAgo);

    storage.writeJSON('history/new.json', { new: true });
    storage.pruneOlderThan('history', 7);

    const remaining = storage.listFiles('history', '*.json');
    assert.ok(!remaining.includes('old.json'));
    assert.ok(remaining.includes('new.json'));
  });
});
