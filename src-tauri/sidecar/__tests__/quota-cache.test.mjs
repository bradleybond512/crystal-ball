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

test('origin describes actual load, not successful persistence or serialized claims', (t) => {
  const file = tempFile(t);
  const cache = createQuotaCache({ filePath: file, now: () => 1000, logger: quiet });
  cache.set('k', { original: 900 });
  assert.deepEqual(cache.getWithMetadata('k', 2000), { data: { original: 900 }, origin: 'memory' });
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(saved.entries.k, { ts: 1000, data: { original: 900 } });
  saved.entries.k.origin = 'memory';
  writeFileSync(file, JSON.stringify(saved));
  const restarted = createQuotaCache({ filePath: file, now: () => 1100, logger: quiet });
  assert.deepEqual(restarted.getWithMetadata('k', 2000), { data: { original: 900 }, origin: 'disk' });
  restarted.set('k', 'new');
  assert.deepEqual(restarted.getWithMetadata('k', 2000), { data: 'new', origin: 'memory' });
  assert.equal(restarted.getWithMetadata('k', 0), null);
});

test('failed and oversized writes retain truthful memory origin', (t) => {
  for (const options of [
    { filePath: path.join(path.dirname(tempFile(t)), 'missing', 'cache.json') },
    { filePath: tempFile(t), maxBytes: 1 },
    { filePath: undefined },
  ]) {
    const cache = createQuotaCache({ ...options, now: () => 1000, logger: quiet });
    cache.set('k', 'value');
    assert.deepEqual(cache.getWithMetadata('k', 2000), { data: 'value', origin: 'memory' });
  }
});

test('disk loading enforces the same entry cap as insertion', (t) => {
  const file = tempFile(t);
  writeFileSync(file, JSON.stringify({ version: 1, entries: {
    a: { ts: 1000, data: 'a' }, b: { ts: 1000, data: 'b' }, c: { ts: 1000, data: 'c' },
  } }));
  const cache = createQuotaCache({ filePath: file, now: () => 1000, maxEntries: 2, logger: quiet });
  assert.equal(cache.getStale('a'), null);
  assert.equal(cache.getStale('b'), 'b');
  assert.equal(cache.getStale('c'), 'c');
});

// Built-in filesystem seams run only in fresh child processes with synthetic files.
for (const scenario of ['swap', 'growth', 'partial', 'zero', 'invalid', 'oversized-write', 'read-error', 'open-error', 'nonregular', 'invalid-read', 'read-flags']) {
  test(`cache I/O boundary: ${scenario}`, async () => {
    const { spawnSync } = await import('node:child_process');
    const source = new URL('../quota-cache.mjs', import.meta.url).href;
    const script = `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      import { strict as assert } from 'node:assert';
      import os from 'node:os';
      import path from 'node:path';
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-io-'));
      const file = path.join(dir, 'cache.json');
      const target = path.join(dir, 'outside.json');
      const body = value => JSON.stringify({version:1,entries:{k:{ts:1,data:value}}});
      const original = Object.fromEntries(['lstatSync','fstatSync','writeSync','closeSync','readSync','openSync'].map(k=>[k,fs[k]]));
      const scenario = ${JSON.stringify(scenario)};
      const {createQuotaCache} = await import(${JSON.stringify(source)});
      let closed = 0;
      try {
        fs.writeFileSync(file, body('old'));
        fs.writeFileSync(target, body('outside'));
        let swapped = false;
        for (const method of ['lstatSync','fstatSync']) {
          fs[method] = (...args) => {
            const stat = original[method](...args);
            if (!swapped && (scenario === 'swap' || scenario === 'growth')) {
              swapped = true;
              if (scenario === 'swap') { fs.unlinkSync(file); fs.symlinkSync(target,file); }
              else fs.writeFileSync(file,body('x'.repeat(1025-Buffer.byteLength(body('')))));
            }
            if (scenario === 'nonregular' && method === 'fstatSync') stat.isFile = () => false;
            return stat;
          };
        }
        fs.closeSync = fd => { closed++; return original.closeSync(fd); };
        fs.writeSync = (fd, data, offset, length, position) => {
          if (scenario === 'zero') return 0;
          if (scenario === 'invalid') return -1;
          if (scenario === 'oversized-write') return typeof data === 'string' ? Buffer.byteLength(data)+1 : length+1;
          if (scenario === 'partial') {
            if (typeof data === 'string') return original.writeSync(fd,Buffer.from(data).subarray(0,3));
            return original.writeSync(fd,data,offset,Math.min(3,length),position);
          }
          return original.writeSync(fd,data,offset,length,position);
        };
        fs.readSync = (...args) => {
          if (scenario === 'invalid-read') return -1;
          if (scenario === 'read-error') throw Object.assign(new Error('fixture'), {code:'EIO'});
          return original.readSync(...args);
        };
        fs.openSync = (...args) => {
          if (scenario === 'read-flags' && args[0] === file) {
            assert.ok((args[1] & fs.constants.O_NOFOLLOW) !== 0,'nofollow required');
            assert.ok((args[1] & fs.constants.O_NONBLOCK) !== 0,'nonblocking required');
          }
          if (scenario === 'open-error') throw Object.assign(new Error('fixture'), {code:'ENOTSUP'});
          return original.openSync(...args);
        };
        syncBuiltinESMExports();
        const cache = createQuotaCache({filePath:file,now:()=>2,maxBytes:1024,logger:{warn(){}}});
        if (scenario === 'swap') {
          assert.equal(cache.getStale('k'),'old','read must remain bound to checked descriptor');
          assert.ok(closed>0,'checked descriptor closes');
        } else if (scenario === 'growth') {
          assert.equal(cache.getStale('k'),null,'growth beyond bound rejected');
          assert.ok(closed>0,'rejected descriptor closes');
        } else if (scenario === 'read-flags') {
          assert.equal(cache.getStale('k'),'old');
        } else if (['read-error','open-error','nonregular','invalid-read'].includes(scenario)) {
          assert.equal(cache.getStale('k'),null,'read/open failure must fail closed');
          if (scenario !== 'open-error') assert.ok(closed>0,'failed read descriptor closes');
        } else {
          cache.set('k','雪🌍');
          assert.equal(cache.getWithMetadata('k',100).origin,'memory');
          assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).entries.k.data,
            scenario === 'partial' ? '雪🌍' : 'old','complete write or preserve previous file');
          assert.deepEqual(fs.readdirSync(dir).sort(),['cache.json','outside.json']);
        }
      } finally { Object.assign(fs,original); syncBuiltinESMExports(); fs.rmSync(dir,{recursive:true,force:true}); }
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr || String(result.error));
  });
}


// Exact source, synthetic fs exports, no host filesystem or platform claims.
for (const flag of ['O_NOFOLLOW', 'O_NONBLOCK']) {
  for (const value of ['zero', 'missing']) {
    test(`cache fails closed with ${value} ${flag}`, async () => {
      const { spawnSync } = await import('node:child_process');
      const source = new URL('../quota-cache.mjs', import.meta.url).href;
      const script = `
        import * as fs from 'node:fs';
        import * as crypto from 'node:crypto';
        import vm from 'node:vm';
        import { strict as assert } from 'node:assert';
        const constants = {...fs.constants};
        const flag = ${JSON.stringify(flag)};
        if (${JSON.stringify(value)} === 'zero') constants[flag] = 0;
        else delete constants[flag];
        let opens = 0;
        let reads = 0;
        const bytes = Buffer.from(JSON.stringify({version:1,entries:{k:{ts:1,data:'unsafe'}}}));
        const context = vm.createContext({Buffer});
        const mocks = {
          ...fs, constants,
          openSync: () => { opens++; return 10; },
          fstatSync: () => ({isFile:()=>true,size:bytes.length}),
          readSync: (_fd, buffer, offset) => {
            reads++;
            if (offset) return 0;
            bytes.copy(buffer); return bytes.length;
          },
          closeSync: () => {},
        };
        const module = new vm.SourceTextModule(fs.readFileSync(new URL(${JSON.stringify(source)}),'utf8'), {context});
        await module.link(specifier => {
          const exports = specifier === 'node:fs' ? mocks : specifier === 'node:crypto' ? crypto : null;
          assert.ok(exports, 'unexpected dependency');
          return new vm.SyntheticModule(Object.keys(exports), function() {
            for (const [key, value] of Object.entries(exports)) this.setExport(key,value);
          }, {context});
        });
        await module.evaluate();
        const cache = module.namespace.createQuotaCache({filePath:'/synthetic/cache.json',now:()=>2,logger:{warn(){}}});
        assert.equal(cache.getStale('k'),null,'unsupported flags must reject before open');
        assert.equal(opens,0,'unsupported flags must not open');
        assert.equal(reads,0,'unsupported flags must not read');
      `;
      const result = spawnSync(process.execPath, ['--experimental-vm-modules', '--input-type=module', '-e', script], {encoding:'utf8',timeout:10_000});
      assert.equal(result.status,0,result.stderr || String(result.error));
    });
  }
}
