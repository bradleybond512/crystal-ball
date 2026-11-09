import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports, registerHooks } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createQuotaGovernor } from '../quota-governor.mjs';

const NOW = Date.UTC(2026, 10, 8);
const URL = 'https://api.abuseipdb.com/api/v2/blacklist';
const quiet = { warn() {} };
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-ledger-io-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, filePath: path.join(dir, 'ledger.json') };
}
function governor(filePath, extra = {}) {
  return createQuotaGovernor({ filePath, now: () => NOW, writeDelayMs: 60_000, logger: quiet, ...extra });
}
function count(g) { return g.status().providers.find(p => p.id === 'abuseipdb-blacklist').windows[0].used; }
function patch(methods, body) {
  const saved = Object.fromEntries(Object.keys(methods).map(k => [k, fs[k]]));
  Object.assign(fs, methods); syncBuiltinESMExports();
  try { return body(saved); } finally { Object.assign(fs, saved); syncBuiltinESMExports(); }
}
function seeded(t) {
  const f = fixture(t); const g = governor(f.filePath); g.admit(URL); g.flush(); return f;
}

test('ledger writes complete short writes before publishing the atomic file', (t) => {
  const { filePath, dir } = fixture(t); const g = governor(filePath); g.admit(URL);
  const original = fs.writeSync; let calls = 0;
  patch({ writeSync(fd, data, offset = 0, length = data.length) {
    calls++;
    const bytes = typeof data === 'string' ? Buffer.from(data) : data;
    return original(fd, bytes, typeof offset === 'number' ? offset : 0, Math.min(7, length), null);
  } }, () => g.flush());
  assert.ok(calls > 1, 'a short write must be completed');
  assert.equal(count(governor(filePath)), 1);
  assert.deepEqual(fs.readdirSync(dir), ['ledger.json']);
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
});

for (const failure of ['zero-progress', 'throw-after-partial']) test(`failed ${failure} write keeps the good ledger and admits in memory`, (t) => {
  const { filePath, dir } = seeded(t); const before = fs.readFileSync(filePath); const warnings = [];
  const g = governor(filePath, { logger: { warn: text => warnings.push(text) } }); g.admit(URL);
  const original = fs.writeSync; let calls = 0;
  patch({ writeSync(fd, data, offset = 0) {
    calls++;
    if (failure === 'zero-progress') return 0;
    if (calls > 1) throw Object.assign(new Error('fixture write failure'), { code: 'EIO' });
    const bytes = typeof data === 'string' ? Buffer.from(data) : data;
    return original(fd, bytes, offset, 5, null);
  } }, () => g.flush());
  assert.deepEqual(fs.readFileSync(filePath), before, 'previous atomic file retained');
  assert.ok(warnings.some(text => text.includes('ledger write failed')));
  assert.equal(count(g), 2, 'already admitted attempts are not refunded');
  assert.equal(g.admit(URL).allowed, true, 'write failure adds no blocking policy');
  g.flush();
  assert.deepEqual(fs.readdirSync(dir), ['ledger.json']);
});

test('ledger reads use one no-follow nonblocking descriptor and close it', (t) => {
  const { filePath } = seeded(t); const open = fs.openSync; const close = fs.closeSync;
  const opened = []; const closed = [];
  patch({ openSync(file, flags, mode) { const fd = open(file, flags, mode); if (file === filePath) { opened.push({ fd, flags }); } return fd; },
    closeSync(fd) { closed.push(fd); return close(fd); },
  }, () => assert.equal(count(governor(filePath)), 1));
  assert.equal(opened.length, 1);
  assert.equal(typeof opened[0].flags, 'number');
  assert.ok(opened[0].flags & fs.constants.O_NOFOLLOW);
  assert.ok(opened[0].flags & fs.constants.O_NONBLOCK);
  assert.ok(closed.includes(opened[0].fd));
});

test('path replacement after descriptor open cannot substitute another ledger', (t) => {
  const { filePath, dir } = seeded(t); const alternate = path.join(dir, 'alternate.json');
  const other = governor(alternate); other.admit(URL); other.admit(URL); other.flush();
  const open = fs.openSync; let swapped = false;
  patch({ openSync(file, flags, mode) {
    const fd = open(file, flags, mode);
    if (file === filePath && !swapped) { swapped = true; fs.renameSync(alternate, filePath); }
    return fd;
  } }, () => assert.equal(count(governor(filePath)), 1));
  assert.equal(swapped, true);
});

test('growing file after fstat is read only through the size bound and rejected', (t) => {
  const { filePath } = seeded(t); const fstat = fs.fstatSync; const read = fs.readSync;
  const cap = 4096; let bytes = 0; let changed = false;
  patch({ fstatSync(fd) {
    const stat = fstat(fd);
    if (!changed) { changed = true; fs.appendFileSync(filePath, ' '.repeat(cap * 2)); }
    return stat;
  }, readSync(fd, buffer, offset, length, position) {
    const n = read(fd, buffer, offset, length, position); bytes += n; return n;
  } }, () => assert.equal(count(governor(filePath, { maxBytes: cap })), 0));
  assert.equal(changed, true);
  assert.ok(bytes > 0 && bytes <= cap + 1, 'bounded descriptor read detects growth without unbounded read');
});

test('descriptor validation rejects nonregular files and closes them', (t) => {
  const { filePath } = seeded(t); const fstat = fs.fstatSync; const close = fs.closeSync; let closed = 0;
  patch({ fstatSync(fd) { const stat = fstat(fd); return { ...stat, isFile: () => false }; },
    closeSync(fd) { closed++; return close(fd); },
  }, () => assert.equal(count(governor(filePath)), 0));
  assert.ok(closed > 0);
});

test('default one-second writes coalesce and explicit flush cancels the pending timer', (t) => {
  const { filePath } = fixture(t); t.mock.timers.enable({ apis: ['setTimeout'] });
  const g = createQuotaGovernor({ filePath, now: () => NOW, logger: quiet });
  const rename = fs.renameSync; let writes = 0;
  patch({ renameSync(from, to) { writes++; return rename(from, to); } }, () => {
    g.admit(URL); g.admit(URL); g.admit(URL);
    t.mock.timers.tick(999); assert.equal(fs.existsSync(filePath), false);
    t.mock.timers.tick(1); assert.equal(count(governor(filePath)), 3); assert.equal(writes, 1);
    g.admit(URL); g.flush(); assert.equal(writes, 2);
    t.mock.timers.tick(1000); assert.equal(writes, 2, 'flush cancelled pending timer');
    assert.equal(count(governor(filePath)), 4);
  });
});

test('descriptor closes on read failure and recovery remains a miss', (t) => {
  const { filePath } = seeded(t); const close = fs.closeSync; const warnings = []; let closed = 0;
  patch({ readSync() { throw Object.assign(new Error('fixture read failure'), { code: 'EIO' }); },
    closeSync(fd) { closed++; return close(fd); },
  }, () => assert.equal(count(governor(filePath, { logger: { warn: text => warnings.push(text) } })), 0));
  assert.equal(closed, 1);
  assert.ok(warnings.some(text => text.includes('ledger read failed')));
});

test('oversized writes preserve the prior good file without a new admission block', (t) => {
  const { filePath } = fixture(t); const g = governor(filePath, { maxBytes: 4000 });
  g.admit(URL); g.flush(); const before = fs.readFileSync(filePath);
  for (let i = 0; i < 64; i++) g.observe(g.admit(`https://${'x'.repeat(80)}${i}.example.test/feed`), { status: 429, headers: { 'retry-after': '60' } });
  g.flush(); assert.deepEqual(fs.readFileSync(filePath), before);
  assert.equal(g.admit(URL).allowed, true); g.flush();
});

for (const flag of ['O_NOFOLLOW', 'O_NONBLOCK']) for (const value of [0, undefined]) {
  test(`ledger refuses disk reads when required platform flag ${flag} is ${value ?? 'missing'}`, async (t) => {
    const { filePath } = seeded(t);
    const moduleUrl = new globalThis.URL(`../quota-governor.mjs?unsupported=${flag}-${String(value)}`, import.meta.url).href;
    const constants = { ...fs.constants };
    if (value === undefined) delete constants[flag]; else constants[flag] = value;
    let readOpens = 0;
    const key = '__quotaUnsupportedFlagsFixture';
    globalThis[key] = { constants, ...Object.fromEntries(['closeSync','fstatSync','fsyncSync','readSync','renameSync','unlinkSync','writeSync'].map(name => [name, fs[name]])), openSync(...args) {
      if (typeof args[1] === 'number') readOpens++;
      return fs.openSync(...args);
    } };
    const names = ['constants','closeSync','fstatSync','fsyncSync','openSync','readSync','renameSync','unlinkSync','writeSync'];
    const exports = names.map(name => `export const ${name}=f.${name};`).join('');
    const facade = `// ${flag}=${String(value)}\nconst f=globalThis.${key};${exports}`;
    const hook = registerHooks({ resolve(specifier, context, next) {
      if (specifier === 'node:fs' && context.parentURL === moduleUrl) return { url: `data:text/javascript,${encodeURIComponent(facade)}`, shortCircuit: true };
      return next(specifier, context);
    } });
    try {
      const { createQuotaGovernor: createSyntheticGovernor } = await import(moduleUrl);
      const warnings = [];
      const g = createSyntheticGovernor({ filePath, now: () => NOW, writeDelayMs: 60_000, logger: { warn: text => warnings.push(text) } });
      assert.equal(count(g), 0, 'unsupported safe-open flags never admit disk counts');
      assert.equal(readOpens, 0, 'do not attempt a weaker file open');
      assert.ok(warnings.some(text => text.includes('safe ledger reads unavailable')));
      assert.equal(g.admit(URL).allowed, true, 'in-process accounting retains existing admission policy');
      assert.equal(count(g), 1);
      g.flush();
    } finally { hook.deregister(); delete globalThis[key]; }
  });
}
