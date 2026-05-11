/**
 * Route-level coverage for api/gdelt/events.js
 *
 * GDELT 2.0 EVENT poller — verifies CSV row filtering (QuadClass 3/4,
 * NumMentions ≥ 3, AvgTone ≤ -2), Goldstein → IntensityLabel mapping,
 * single-entry deflate-raw ZIP extraction, and the OPTIONS / wrong-method /
 * upstream-failure contract preservation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invokeHandler, mockFetch } from './_test-utils.mjs';

const mod = await import('../gdelt/events.js');
const handler = mod.default;
const { parseExportCsv, intensityFromGoldstein, unzipFirstEntry, __resetCacheForTests } = mod;

// ── pure parser: CSV → HistoricalEvent[] ─────────────────────────────

const HEADER_PADDING = (cols) => {
  // GDELT 2.0 EVENT has 61 columns. Tests provide only the columns they
  // care about; this helper pads the rest with empty strings so col
  // indexes line up with the production parser.
  const out = new Array(61).fill('');
  for (const [idx, val] of Object.entries(cols)) out[+idx] = String(val);
  return out.join('\t');
};

test('parseExportCsv: keeps QuadClass=4 rows with mentions≥3 and tone≤-2', () => {
  const row = HEADER_PADDING({
    0: '12345', 6: 'Russia Mil', 7: 'RUS', 16: 'Ukraine Mil', 17: 'UKR',
    26: '193', 29: '4', 30: '-9', 31: '12', 34: '-5.4',
    52: 'Donetsk, Ukraine', 53: 'UKR',
    59: '20260506120000', 60: 'http://example/x',
  });
  const events = parseExportCsv(row);
  assert.equal(events.length, 1);
  const ev = events[0];
  assert.equal(ev.id, 'gdelt-12345');
  assert.equal(ev.intensity, 'critical');           // Goldstein -9 ⇒ critical
  assert.equal(ev.eventType, 'fight');              // CAMEO 19 ⇒ fight
  assert.equal(ev.country, 'UKR');
  assert.deepEqual(ev.actors, ['Russia Mil', 'Ukraine Mil']);
  assert.equal(ev.source, 'gdelt');
  assert.match(ev.date, /^2026-05-06T12:00:00/);
});

test('parseExportCsv: drops QuadClass 1/2 (cooperative)', () => {
  const row = HEADER_PADDING({ 0: '1', 29: '1', 30: '5', 31: '20', 34: '-5', 59: '20260101000000' });
  assert.equal(parseExportCsv(row).length, 0);
});

test('parseExportCsv: drops rows with NumMentions < 3', () => {
  const row = HEADER_PADDING({ 0: '2', 29: '4', 30: '-9', 31: '2', 34: '-5', 59: '20260101000000' });
  assert.equal(parseExportCsv(row).length, 0);
});

test('parseExportCsv: drops positive-tone rows even if QuadClass=4', () => {
  // Tone +1 ⇒ this isn't conflict reporting, it's ceasefire / cooperation.
  const row = HEADER_PADDING({ 0: '3', 29: '4', 30: '-1', 31: '10', 34: '1.0', 59: '20260101000000' });
  assert.equal(parseExportCsv(row).length, 0);
});

test('parseExportCsv: malformed DATEADDED is dropped (no synthesized date)', () => {
  const row = HEADER_PADDING({ 0: '4', 29: '4', 30: '-9', 31: '5', 34: '-3', 59: 'BADDATE' });
  assert.equal(parseExportCsv(row).length, 0);
});

test('parseExportCsv: handles empty input safely', () => {
  assert.deepEqual(parseExportCsv(''), []);
  assert.deepEqual(parseExportCsv('\n\n\n'), []);
});

test('parseExportCsv: caps at MAX_EVENTS=500 even if more pass the filter', () => {
  const lines = Array.from({ length: 600 }, (_, i) => HEADER_PADDING({
    0: String(i), 29: '4', 30: '-9', 31: '5', 34: '-3', 59: '20260101000000',
  }));
  assert.equal(parseExportCsv(lines.join('\n')).length, 500);
});

// ── intensity bucket mapping ─────────────────────────────────────────

test('intensityFromGoldstein: bucket boundaries', () => {
  assert.equal(intensityFromGoldstein(-10), 'critical');
  assert.equal(intensityFromGoldstein(-8), 'critical');
  assert.equal(intensityFromGoldstein(-7.99), 'high');
  assert.equal(intensityFromGoldstein(-5), 'high');
  assert.equal(intensityFromGoldstein(-4.99), 'medium');
  assert.equal(intensityFromGoldstein(-2), 'medium');
  assert.equal(intensityFromGoldstein(-1.99), 'low');
  assert.equal(intensityFromGoldstein(NaN), 'medium');     // unknown → safe default
});

// ── ZIP extraction round-trip ────────────────────────────────────────

async function makeMinimalZip(payload) {
  // Compress 'payload' with deflate-raw, then wrap in a single-entry ZIP
  // local file header. Used only to feed unzipFirstEntry a real archive.
  const compressed = await new Response(
    new Blob([new TextEncoder().encode(payload)]).stream()
      .pipeThrough(new CompressionStream('deflate-raw')),
  ).arrayBuffer();
  const fileName = 'fixture.csv';
  const fnBuf = new TextEncoder().encode(fileName);
  const header = new ArrayBuffer(30 + fnBuf.length);
  const v = new DataView(header);
  v.setUint32(0, 0x04034b50, true);
  v.setUint16(4, 20, true);                      // version needed
  v.setUint16(6, 0, true);                       // flags
  v.setUint16(8, 8, true);                       // method = deflate
  v.setUint16(10, 0, true); v.setUint16(12, 0, true);
  v.setUint32(14, 0, true);                      // CRC32 (not validated)
  v.setUint32(18, compressed.byteLength, true);  // compressed size
  v.setUint32(22, payload.length, true);         // uncompressed size
  v.setUint16(26, fnBuf.length, true);
  v.setUint16(28, 0, true);                      // extra
  new Uint8Array(header, 30).set(fnBuf);
  const out = new Uint8Array(header.byteLength + compressed.byteLength);
  out.set(new Uint8Array(header), 0);
  out.set(new Uint8Array(compressed), header.byteLength);
  return out.buffer;
}

test('unzipFirstEntry: round-trips deflate-raw payload', async () => {
  const text = 'col1\tcol2\nfoo\tbar\n';
  const zip = await makeMinimalZip(text);
  const decoded = await unzipFirstEntry(zip);
  assert.equal(decoded, text);
});

test('unzipFirstEntry: rejects non-ZIP payloads (bad signature)', async () => {
  // Need ≥30 bytes to pass the size guard; fill with non-ZIP bytes so the
  // signature check fires.
  const buf = new Uint8Array(64).fill(0x41).buffer;     // 'A' repeated
  await assert.rejects(() => unzipFirstEntry(buf), /Bad ZIP signature/);
});

test('unzipFirstEntry: rejects payloads smaller than the local file header', async () => {
  const buf = new Uint8Array(8).buffer;
  await assert.rejects(() => unzipFirstEntry(buf), /ZIP too small/);
});

// ── handler: HTTP contract ───────────────────────────────────────────

test('handler: OPTIONS returns 204', async () => {
  const { res } = await invokeHandler(handler, { method: 'OPTIONS' });
  assert.equal(res.statusCode, 204);
});

test('handler: rejects non-GET methods', async () => {
  const { res } = await invokeHandler(handler, { method: 'POST' });
  assert.equal(res.statusCode, 405);
});

test('handler: lastupdate.txt 503 → degraded payload (preserves 200 contract)', async () => {
  __resetCacheForTests();
  const restore = mockFetch(new Map([['lastupdate.txt', { status: 503, text: '' }]]));
  try {
    const { res } = await invokeHandler(handler, {});
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.degraded, true);
    assert.deepEqual(res.body.events, []);
    assert.match(res.body.reason, /lastupdate\.txt HTTP 503/);
  } finally { restore(); }
});

test('handler: lastupdate.txt missing export entry → degraded', async () => {
  __resetCacheForTests();
  const restore = mockFetch(new Map([['lastupdate.txt', { status: 200, text: '' }]]));
  try {
    const { res } = await invokeHandler(handler, {});
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.degraded, true);
    assert.match(res.body.reason, /missing export entry/);
  } finally { restore(); }
});

test('handler: full pipeline — lastupdate → ZIP → CSV → HistoricalEvent[]', async () => {
  __resetCacheForTests();
  const csv = HEADER_PADDING({
    0: '999', 6: 'Hamas', 7: 'PSE', 16: 'Israel Mil', 17: 'ISR',
    26: '193', 29: '4', 30: '-10', 31: '50', 34: '-7.5',
    52: 'Gaza City', 53: 'PSE',
    59: '20260506130000', 60: 'http://example/y',
  });
  const zipBuf = await makeMinimalZip(csv);
  const lastUpdate = '12345 abc123 http://data.gdeltproject.org/gdeltv2/20260506130000.export.CSV.zip\n';
  const restore = mockFetch(new Map([
    ['lastupdate.txt', { status: 200, text: lastUpdate }],
    ['export.CSV.zip', { status: 200, text: '__BINARY_ZIP__' }],
  ]));
  try {
    // Bespoke fetch override that returns the binary ZIP for the export URL
    // (mockFetch only supports text/JSON; the ZIP needs an arrayBuffer body).
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const urlStr = typeof url === 'string' ? url : url?.url ?? String(url);
      if (urlStr.includes('lastupdate.txt')) {
        return new Response(lastUpdate, { status: 200, headers: { 'content-type': 'text/plain' } });
      }
      if (urlStr.includes('export.CSV.zip')) {
        return new Response(zipBuf, { status: 200, headers: { 'content-type': 'application/zip' } });
      }
      throw new Error(`Unmocked: ${urlStr}`);
    };
    try {
      const { res } = await invokeHandler(handler, {});
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.events.length, 1);
      const ev = res.body.events[0];
      assert.equal(ev.id, 'gdelt-999');
      assert.equal(ev.intensity, 'critical');
      assert.equal(ev.country, 'PSE');
      assert.equal(res.body.source, 'gdelt-event-2.0');
    } finally { globalThis.fetch = originalFetch; }
  } finally { restore(); }
});
