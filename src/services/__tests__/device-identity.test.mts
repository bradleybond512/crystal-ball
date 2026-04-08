import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';

// In-memory localStorage shim
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string) {
 return this.store.has(k) ? (this.store.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
 this.store.set(k, String(v));
  }
  removeItem(k: string) {
 this.store.delete(k);
  }
  clear() {
 this.store.clear();
  }
}

type FetchFn = typeof fetch;

interface GlobalShims {
  localStorage: MemoryStorage;
  navigator: { userAgent: string; language: string };
  fetch: FetchFn;
}

function installShims(opts: {
  ua?: string;
  language?: string;
  fetchImpl?: FetchFn;
}): GlobalShims {
  const storage = new MemoryStorage();
  const navigator = {
 userAgent: opts.ua ?? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)',
 language: opts.language ?? 'en-US',
  };
  const fetchImpl: FetchFn =
 opts.fetchImpl ??
 (async () =>
 new Response(
 JSON.stringify({
 data: {
 prefixes: [
 {
 asn: { asn: 7922, name: 'COMCAST', country_code: 'US' },
 },
 ],
 },
 }),
 { headers: { 'content-type': 'application/json' } },
 ));
  Object.defineProperty(globalThis, 'localStorage', {
 value: storage,
 configurable: true,
 writable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
 value: navigator,
 configurable: true,
 writable: true,
  });
  Object.defineProperty(globalThis, 'fetch', {
 value: fetchImpl,
 configurable: true,
 writable: true,
  });
  return { localStorage: storage, navigator, fetch: fetchImpl };
}

let ghostMode = false;
async function loadModule() {
  (globalThis as unknown as { __wmGhost: () => boolean }).__wmGhost = () =>
 ghostMode;
  return await import('../device-identity.ts');
}

beforeEach(() => {
  ghostMode = false;
});

afterEach(() => {
  delete (globalThis as Partial<{ localStorage: unknown }>).localStorage;
  delete (globalThis as Partial<{ navigator: unknown }>).navigator;
  delete (globalThis as Partial<{ fetch: unknown }>).fetch;
  delete (globalThis as Partial<{ __wmGhost: unknown }>).__wmGhost;
});

test('returns cached value when within TTL', async () => {
  let fetchCount = 0;
  installShims({
 fetchImpl: async () => {
 fetchCount += 1;
 return new Response(
 JSON.stringify({
 data: {
 prefixes: [
 { asn: { asn: 7922, name: 'COMCAST', country_code: 'US' } },
 ],
 },
 }),
 { headers: { 'content-type': 'application/json' } },
 );
 },
  });
  const mod = await loadModule();
  mod.clearDeviceFingerprintCache();
  const a = await mod.getDeviceFingerprint();
  const b = await mod.getDeviceFingerprint();
  assert.equal(a.asn, 7922);
  assert.equal(b.asn, 7922);
  assert.equal(fetchCount, 1);
});

test('re-fetches after TTL expires', async () => {
  let fetchCount = 0;
  installShims({
 fetchImpl: async () => {
 fetchCount += 1;
 return new Response(
 JSON.stringify({
 data: {
 prefixes: [
 { asn: { asn: 7922, name: 'COMCAST', country_code: 'US' } },
 ],
 },
 }),
 { headers: { 'content-type': 'application/json' } },
 );
 },
  });
  const mod = await loadModule();
  mod.clearDeviceFingerprintCache();
  await mod.getDeviceFingerprint();
  // Mutate the cached entry's fetchedAt to be > 6h old
  const raw = (
 globalThis as unknown as { localStorage: MemoryStorage }
  ).localStorage.getItem('crystalball-device-fingerprint');
  assert.ok(raw);
  const parsed = JSON.parse(raw as string);
  parsed.fetchedAt = Date.now() - (6 * 60 * 60 * 1000 + 1000);
  (
 globalThis as unknown as { localStorage: MemoryStorage }
  ).localStorage.setItem(
 'crystalball-device-fingerprint',
 JSON.stringify(parsed),
  );
  await mod.getDeviceFingerprint();
  assert.equal(fetchCount, 2);
});

test('returns empty fingerprint in Ghost Mode without network call', async () => {
  let fetchCount = 0;
  installShims({
 fetchImpl: async () => {
 fetchCount += 1;
 return new Response('{}');
 },
  });
  ghostMode = true;
  const mod = await loadModule();
  mod.clearDeviceFingerprintCache();
  const fp = await mod.getDeviceFingerprint();
  assert.equal(fp.asn, null);
  assert.equal(fp.country, null);
  assert.equal(fetchCount, 0);
});

test('derives os: macos from a Mac UA string', async () => {
  installShims({
 ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15',
  });
  const mod = await loadModule();
  mod.clearDeviceFingerprintCache();
  const fp = await mod.getDeviceFingerprint();
  assert.equal(fp.os, 'macos');
});

test('swallows fetch errors and returns empty fingerprint', async () => {
  installShims({
 language: 'xx',
 fetchImpl: async () => {
 throw new Error('boom');
 },
  });
  const mod = await loadModule();
  mod.clearDeviceFingerprintCache();
  const fp = await mod.getDeviceFingerprint();
  assert.equal(fp.asn, null);
  assert.equal(fp.asnOrg, null);
  assert.equal(fp.country, null);
  assert.equal(fp.os, 'macos');
});
