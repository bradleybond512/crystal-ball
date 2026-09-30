// R4-BUG-005: persisted TTL cache for quota-limited providers.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createQuotaCache, QUOTA_CACHE_FILE } from '../quota-cache.mjs';

const quiet = { warn() {} };

function tempFile(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cb-quota-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, QUOTA_CACHE_FILE);
}

test('entries survive a restart (a new cache over the same file)', (t) => {
  const file = tempFile(t);
  let clock = 1_000_000;
  const first = createQuotaCache({ filePath: file, now: () => clock, logger: quiet });
  first.set('abuseipdb-reports', [{ ipAddress: '203.0.113.1' }]);
  clock += 60_000;
  const restarted = createQuotaCache({ filePath: file, now: () => clock, logger: quiet });
  assert.deepEqual(restarted.get('abuseipdb-reports', 8 * 3_600_000), [{ ipAddress: '203.0.113.1' }]);
});

test('TTL is honoured, and stale data stays available for serve-stale', (t) => {
  const file = tempFile(t);
  let clock = 5_000_000;
  const cache = createQuotaCache({ filePath: file, now: () => clock, logger: quiet });
  cache.set('k', 'v');
  clock += 999;
  assert.equal(cache.get('k', 1000), 'v');
  clock += 1;
  assert.equal(cache.get('k', 1000), null);
  assert.equal(cache.getStale('k'), 'v');
  assert.equal(cache.get('missing', 1000), null);
  assert.equal(cache.getStale('missing'), null);
});

test('the file is private (0600) and replaced atomically without temp leftovers', (t) => {
  const file = tempFile(t);
  const cache = createQuotaCache({ filePath: file, now: () => 1, logger: quiet });
  cache.set('a', 1);
  cache.set('b', 2);
  assert.equal(lstatSync(file).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(path.dirname(file)), [QUOTA_CACHE_FILE]);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { version: 1, entries: { a: { ts: 1, data: 1 }, b: { ts: 1, data: 2 } } });
});


test('entries stamped in the future are dropped on load (clock change or tampering)', (t) => {
  const file = tempFile(t);
  const now = 10_000_000;
  writeFileSync(file, JSON.stringify({ version: 1, entries: {
    future: { ts: now + 3_600_000, data: 'pinned' },
    ok: { ts: now - 1000, data: 'fresh' },
  } }), { mode: 0o600 });
  const cache = createQuotaCache({ filePath: file, now: () => now, logger: quiet });
  assert.equal(cache.getStale('future'), null);
  assert.equal(cache.get('ok', 60_000), 'fresh');
});

test('malformed, oversized, wrong-version or symlinked files are ignored, never trusted', (t) => {
  for (const [label, prepare] of [
    ['malformed', (file) => writeFileSync(file, '{not json')],
    ['wrong version', (file) => writeFileSync(file, JSON.stringify({ version: 2, entries: { k: { ts: 1, data: 'x' } } }))],
    ['bad entries', (file) => writeFileSync(file, JSON.stringify({ version: 1, entries: { k: { ts: 'yesterday', data: 'x' }, j: { data: 'y' } } }))],
    ['oversized', (file) => writeFileSync(file, JSON.stringify({ version: 1, entries: { k: { ts: 1, data: 'x'.repeat(2048) } } }))],
    ['symlink', (file) => {
      const target = `${file}.target`;
      writeFileSync(target, JSON.stringify({ version: 1, entries: { k: { ts: 1, data: 'x' } } }));
      symlinkSync(target, file);
    }],
  ]) {
    const file = tempFile(t);
    prepare(file);
    const cache = createQuotaCache({ filePath: file, now: () => 2, maxBytes: 1024, logger: quiet });
    assert.equal(cache.getStale('k'), null, label);
    assert.equal(cache.getStale('j'), null, label);
  }
});

test('entry count is bounded (oldest evicted) and oversize data stays in memory only', (t) => {
  const file = tempFile(t);
  const cache = createQuotaCache({ filePath: file, now: () => 1, maxEntries: 2, maxBytes: 200, logger: quiet });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  assert.equal(cache.getStale('a'), null);
  assert.equal(cache.getStale('c'), 3);
  cache.set('big', 'x'.repeat(500));
  assert.equal(cache.getStale('big').length, 500, 'still served from memory');
  const reloaded = createQuotaCache({ filePath: file, now: () => 1, maxBytes: 200, logger: quiet });
  assert.equal(reloaded.getStale('big'), null, 'not persisted past the size cap');
  assert.equal(reloaded.getStale('c'), 3, 'previous good file kept');
});

test('without a file path the cache is memory-only', () => {
  const cache = createQuotaCache({ filePath: null, now: () => 1, logger: quiet });
  cache.set('k', 'v');
  assert.equal(cache.get('k', 10), 'v');
});
