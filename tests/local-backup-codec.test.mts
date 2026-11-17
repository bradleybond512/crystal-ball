import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { encryptBackup, decryptBackup } from '../src/services/local-backup/codec.ts';
import { backup, store, ids, place, canonical, freeze, passphrase, independentArchive, independentDecrypt, withGlobal } from './fixtures/local-backup/fixtures.mts';

const vector = JSON.parse(readFileSync(new URL('./fixtures/local-backup/vector.json', import.meta.url), 'utf8'));
const bytes = () => Uint8Array.from(Buffer.from(vector.archiveHex, 'hex'));
const reject = async (promise, code) => assert.rejects(promise, error => {
  assert.ok(error.message.length <= 160); if (code) assert.equal(error.code, code);
  assert.ok(!error.message.includes('cam-a')); assert.ok(!error.message.includes(passphrase)); return true;
});
const cryptoSpy = overrides => ({ getRandomValues: webcrypto.getRandomValues.bind(webcrypto), subtle: new Proxy(webcrypto.subtle, { get(target, key) { return overrides[key] ?? (typeof target[key] === 'function' ? target[key].bind(target) : target[key]); } }) });

test('independent fixed Node-crypto vector decrypts to the exact canonical payload', async () => {
  assert.deepEqual(await decryptBackup(bytes(), vector.passphrase), JSON.parse(vector.plaintext));
  assert.equal(independentArchive(vector.plaintext).toString('hex'), vector.archiveHex);
});

test('WebCrypto encryption interoperates with independent Node crypto and uses fresh salt/IV', async t => {
  const input = freeze(backup()), start = performance.now();
  const first = await encryptBackup(input, passphrase), second = await encryptBackup(input, passphrase);
  assert.ok(first instanceof Uint8Array); assert.notDeepEqual(first.subarray(16, 32), second.subarray(16, 32)); assert.notDeepEqual(first.subarray(32, 44), second.subarray(32, 44));
  assert.equal(independentDecrypt(first).toString(), canonical(input));
  assert.deepEqual(await decryptBackup(first, passphrase), input);
  assert.equal(Buffer.from(first.subarray(0, 8)).toString(), 'CBSTATE\0'); assert.equal(first[8], 1); assert.equal(first[9], 1);
  assert.equal(new DataView(first.buffer, first.byteOffset).getUint32(12), 600_000);
  t.diagnostic(`Synthetic 3-store/4-record encryption twice + independent decrypt + WebCrypto decrypt: ${(performance.now() - start).toFixed(1)}ms; archive ${first.length} bytes (measurement, no timing gate)`);
});

test('derived AES keys are nonextractable and every encryption binds the full header with a 128-bit tag', async () => {
  let derivations = 0, encryptions = 0;
  await withGlobal('crypto', cryptoSpy({
    deriveKey(...args) { derivations++; assert.equal(args[0].iterations, 600_000); assert.equal(args[0].hash, 'SHA-256'); assert.equal(args[2].name, 'AES-GCM'); assert.equal(args[2].length, 256); assert.equal(args[3], false); return webcrypto.subtle.deriveKey(...args); },
    encrypt(...args) { encryptions++; assert.equal(args[0].tagLength, 128); assert.equal(Buffer.from(args[0].additionalData).subarray(0, 27).toString(), 'crystalball-local-backup-v1'); assert.equal(args[0].additionalData.byteLength, 76); return webcrypto.subtle.encrypt(...args); },
  }), () => encryptBackup(backup(), passphrase));
  assert.equal(derivations, 1); assert.equal(encryptions, 1);
});

test('wrong passphrases and authenticated header/ciphertext/tag tampering expose no plaintext', async () => {
  await reject(decryptBackup(bytes(), 'different synthetic password'), 'authentication-failed');
  for (const offset of [16, 32, 48, bytes().length - 1]) { const changed = bytes(); changed[offset] ^= 1; await reject(decryptBackup(changed, passphrase), 'authentication-failed'); }
});

test('unsupported and malformed envelopes reject before any KDF operation', async () => {
  const cases = [new Uint8Array(), bytes().slice(0, 47), bytes().slice(0, -1), Uint8Array.from([...bytes(), 0]), new Uint8Array(1_048_641)];
  for (const [offset, value] of [[0, 0], [8, 2], [9, 2], [10, 1], [11, 1], [12, 1], [44, 255]]) { const changed = bytes(); changed[offset] = value; cases.push(changed); }
  const lowCount = bytes(); new DataView(lowCount.buffer).setUint32(12, 599_999); cases.push(lowCount);
  const shortTag = bytes(); new DataView(shortTag.buffer).setUint32(44, 15); cases.push(shortTag);
  let calls = 0; const never = () => { calls++; throw new Error('KDF must not run'); };
  await withGlobal('crypto', cryptoSpy({ importKey: never, deriveKey: never, deriveBits: never }), async () => { for (const archive of cases) await reject(decryptBackup(archive, passphrase)); });
  assert.equal(calls, 0);
});

test('authenticated malformed payloads never become validated backups', async () => {
  const valid = vector.plaintext;
  for (const plaintext of [valid + '\n', valid.replace('"version":1', '"version":1,"version":1'), valid.replace('"version":1', '"version":2'), valid.replace('"count":2', '"count":3'), valid.replace('webcam-pins', 'secret-vault'), Buffer.from([0xc3, 0x28])]) await reject(decryptBackup(independentArchive(plaintext), passphrase));
});

test('passphrase limits count Unicode scalars and UTF8 bytes without trimming or normalization', async () => {
  let derivations = 0;
  await withGlobal('crypto', cryptoSpy({ deriveKey(...args) { derivations++; return webcrypto.subtle.deriveKey(...args); } }), async () => {
    for (const password of ['', 'x'.repeat(11), '😀'.repeat(11), 'x'.repeat(1025), '\ud800' + 'x'.repeat(20)]) await reject(encryptBackup(backup(), password), 'invalid-passphrase');
    assert.equal(derivations, 0);
    for (const password of ['😀'.repeat(12), 'x'.repeat(1024), ' '.repeat(12)]) { const archive = await encryptBackup(backup(), password); assert.deepEqual(await decryptBackup(archive, password), backup()); }
    const archive = await encryptBackup(backup(), 'é'.repeat(12)); await reject(decryptBackup(archive, 'e\u0301'.repeat(12)), 'authentication-failed');
  });
});

test('unavailable crypto rejects without reaching any ambient storage or network', async () => {
  await withGlobal('crypto', undefined, async () => { await reject(encryptBackup(backup(), passphrase), 'crypto-unavailable'); await reject(decryptBackup(bytes(), passphrase), 'crypto-unavailable'); });
  const names = ['localStorage', 'sessionStorage', 'indexedDB', 'fetch', 'XMLHttpRequest'];
  const run = async index => {
    if (index === names.length) { assert.deepEqual(await decryptBackup(await encryptBackup(freeze(backup()), passphrase), passphrase), backup()); return; }
    const previous = Object.getOwnPropertyDescriptor(globalThis, names[index]);
    Object.defineProperty(globalThis, names[index], { configurable: true, get() { throw new Error(`Forbidden I/O: ${names[index]}`); } });
    try { await run(index + 1); } finally { if (previous) Object.defineProperty(globalThis, names[index], previous); else Reflect.deleteProperty(globalThis, names[index]); }
  };
  await run(0);
  for (const name of ['schema', 'codec', 'preflight']) {
    const source = readFileSync(new URL(`../src/services/local-backup/${name}.ts`, import.meta.url), 'utf8');
    for (const match of source.matchAll(/(?:from\s+|import\s*\()['"]([^'"]+)['"]/g)) assert.match(match[1], /^\.\/(?:schema|codec|preflight)(?:\.ts)?$/, 'only isolated backup modules may be imported');
    assert.doesNotMatch(source, /\b(?:localStorage|indexedDB|fetch|XMLHttpRequest|invoke|writeFile)\s*[.(]/);
  }
});

test('encryption snapshots mutable input before the first asynchronous key operation', async () => {
  const input = backup(), expected = structuredClone(input); let changed = false;
  await withGlobal('crypto', cryptoSpy({ importKey(...args) { input.stores[0].records[0].notes = 'changed while deriving'; changed = true; return webcrypto.subtle.importKey(...args); } }), async () => { const archive = await encryptBackup(input, passphrase); assert.equal(independentDecrypt(archive).toString(), canonical(expected)); });
  assert.equal(changed, true);
});

test('decryption snapshots caller-owned archive bytes before asynchronous key operations', async () => {
  const archive = bytes(); let changed = false;
  await withGlobal('crypto', cryptoSpy({ importKey(...args) { archive.fill(0); changed = true; return webcrypto.subtle.importKey(...args); } }), async () => { assert.deepEqual(await decryptBackup(archive, passphrase), JSON.parse(vector.plaintext)); });
  assert.equal(changed, true);
});

test('synthetic larger payload stays bounded without a flaky latency acceptance threshold', async t => {
  const input = backup([store(ids[0], Array.from({ length: 60 }, (_, i) => place({ id: `${i}`, primary: i === 0, notes: 'x'.repeat(8192) })))]);
  const start = performance.now(), archive = await encryptBackup(freeze(input), passphrase);
  assert.deepEqual(await decryptBackup(archive, passphrase), input); assert.ok(archive.byteLength < 1_048_640);
  t.diagnostic(`Synthetic 60-record encrypt/decrypt ${archive.length} bytes: ${(performance.now() - start).toFixed(1)}ms (measurement only)`);
});
