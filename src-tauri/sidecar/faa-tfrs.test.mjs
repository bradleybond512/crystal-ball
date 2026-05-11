/* eslint-disable unicorn/prefer-event-target */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  extractNotamIds,
  parseTfrXml,
  tfrColor,
  fetchTfrIds,
  fetchTfrDetail,
  fetchAllTfrs,
} from './faa-tfrs.mjs';

// ── extractNotamIds ──────────────────────────────────────────────────────────

test('extractNotamIds: parses href links from FAA list HTML', () => {
  const html = `
    <a href="/save_pages/detail_1_0_1234567.xml">TFR 1</a>
    <a href="/save_pages/detail_1_0_9999999.html">TFR 2</a>
  `;
  const ids = extractNotamIds(html);
  assert.ok(ids.includes('1_0_1234567'), 'should include XML link id');
  assert.ok(ids.includes('1_0_9999999'), 'should include HTML link id');
});

test('extractNotamIds: deduplicates identical IDs', () => {
  const html = `
    <a href="/save_pages/detail_1_0_1234567.xml">TFR 1</a>
    <a href="/save_pages/detail_1_0_1234567.xml">TFR 1 dup</a>
  `;
  const ids = extractNotamIds(html);
  assert.equal(ids.filter((id) => id === '1_0_1234567').length, 1);
});

test('extractNotamIds: finds inline JS references', () => {
  const html = `<script>var id = "detail_2_0_5678901";</script>`;
  const ids = extractNotamIds(html);
  assert.ok(ids.includes('2_0_5678901'));
});

test('extractNotamIds: returns empty array for HTML with no TFR links', () => {
  const ids = extractNotamIds('<html><body>no links here</body></html>');
  assert.deepEqual(ids, []);
});

// ── parseTfrXml ──────────────────────────────────────────────────────────────

test('parseTfrXml: parses polygon points from <Point> elements', () => {
  const xml = `<Group>
    <Notam_Number>0/1234</Notam_Number>
    <Txt_type>SECURITY</Txt_type>
    <Altitude_floor>0</Altitude_floor>
    <Altitude_ceiling>18000</Altitude_ceiling>
    <Effective_Date>2026-05-11T00:00:00Z</Effective_Date>
    <Expire_Date>2026-05-12T00:00:00Z</Expire_Date>
    <Area>
      <Point><Lat>38.8951</Lat><Lon>-77.0364</Lon></Point>
      <Point><Lat>38.9051</Lat><Lon>-77.0264</Lon></Point>
      <Point><Lat>38.8851</Lat><Lon>-77.0264</Lon></Point>
    </Area>
  </Group>`;
  const tfr = parseTfrXml('1_0_test', xml);
  assert.ok(tfr !== null);
  assert.equal(tfr.polygon.length, 3);
  assert.equal(tfr.type, 'Security');
  assert.equal(tfr.altFloor, 0);
  assert.equal(tfr.altCeiling, 18_000);
  assert.equal(tfr.notamNumber, '0/1234');
  assert.ok(tfr.effectiveStart?.includes('2026-05-11'));
  assert.ok(tfr.effectiveEnd?.includes('2026-05-12'));
});

test('parseTfrXml: classifies VIP type from presidential keyword', () => {
  const xml = `<Group>
    <Txt_type>VIP MOVEMENT</Txt_type>
    <Point><Lat>38.8951</Lat><Lon>-77.0364</Lon></Point>
  </Group>`;
  const tfr = parseTfrXml('1_0_vip', xml);
  assert.ok(tfr !== null);
  assert.equal(tfr.type, 'VIP');
});

test('parseTfrXml: classifies Fire type', () => {
  const xml = `<Group>
    <type>WILDFIRE FIREFIGHTING OPERATIONS</type>
    <Point><Lat>37.5</Lat><Lon>-120.5</Lon></Point>
  </Group>`;
  const tfr = parseTfrXml('1_0_fire', xml);
  assert.ok(tfr !== null);
  assert.equal(tfr.type, 'Fire');
});

test('parseTfrXml: computes center as average of polygon vertices', () => {
  const xml = `<Group>
    <Point><Lat>0.0</Lat><Lon>0.0</Lon></Point>
    <Point><Lat>2.0</Lat><Lon>2.0</Lon></Point>
  </Group>`;
  const tfr = parseTfrXml('1_0_center', xml);
  assert.ok(tfr !== null);
  assert.ok(tfr.center !== null);
  assert.equal(tfr.center[0], 1); // avg lon
  assert.equal(tfr.center[1], 1); // avg lat
});

test('parseTfrXml: returns null for empty XML', () => {
  assert.equal(parseTfrXml('1_0_empty', ''), null);
  assert.equal(parseTfrXml('1_0_null', null), null);
});

test('parseTfrXml: falls back to flat latitude/longitude elements', () => {
  const xml = `<Group>
    <latitude>40.0</latitude><longitude>-74.0</longitude>
    <latitude>41.0</latitude><longitude>-73.0</longitude>
  </Group>`;
  const tfr = parseTfrXml('1_0_flat', xml);
  assert.ok(tfr !== null);
  assert.equal(tfr.polygon.length, 2);
});

// ── tfrColor ─────────────────────────────────────────────────────────────────

test('tfrColor: VIP returns red RGBA', () => {
  const color = tfrColor('VIP');
  assert.equal(color[0], 220);
  assert.equal(color[1], 53);
  assert.equal(color[2], 69);
});

test('tfrColor: Security returns same red as VIP', () => {
  assert.deepEqual(tfrColor('Security'), tfrColor('VIP'));
});

test('tfrColor: Fire returns orange', () => {
  const color = tfrColor('Fire');
  assert.equal(color[0], 255);
  assert.equal(color[1], 140);
});

test('tfrColor: Other returns blue', () => {
  const color = tfrColor('Other');
  assert.equal(color[0], 74);
  assert.equal(color[1], 158);
  assert.equal(color[2], 255);
});

// ── fetchTfrIds ───────────────────────────────────────────────────────────────

test('fetchTfrIds: calls FAA list URL and extracts IDs', async () => {
  let capturedUrl = '';
  const mockFetcher = async (url) => {
    capturedUrl = url;
    return {
      ok: true,
      text: async () => `<a href="/save_pages/detail_1_0_111222.xml">TFR</a>`,
    };
  };
  const ids = await fetchTfrIds(mockFetcher);
  assert.ok(capturedUrl.includes('tfr.faa.gov'));
  assert.ok(ids.includes('1_0_111222'));
});

async function fetch503() { return { ok: false, status: 503 }; }
async function fetch404() { return { ok: false, status: 404 }; }
async function fetchNetworkError() { throw new Error('network error'); }

test('fetchTfrIds: throws on non-200 response', async () => {
  await assert.rejects(() => fetchTfrIds(fetch503), /TFR list HTTP 503/);
});

// ── fetchTfrDetail ────────────────────────────────────────────────────────────

test('fetchTfrDetail: returns null on HTTP error (soft failure)', async () => {
  const result = await fetchTfrDetail('1_0_missing', fetch404);
  assert.equal(result, null);
});

test('fetchTfrDetail: returns null on fetch exception', async () => {
  const result = await fetchTfrDetail('1_0_broken', fetchNetworkError);
  assert.equal(result, null);
});

test('fetchTfrDetail: fetches detail_{id}.xml URL', async () => {
  let capturedUrl = '';
  const mockFetcher = async (url) => {
    capturedUrl = url;
    return {
      ok: true,
      text: async () => `<Group>
        <Point><Lat>38.9</Lat><Lon>-77.0</Lon></Point>
      </Group>`,
    };
  };
  const result = await fetchTfrDetail('1_0_9876', mockFetcher);
  assert.ok(capturedUrl.endsWith('detail_1_0_9876.xml'));
  assert.ok(result !== null);
  assert.equal(result.id, '1_0_9876');
});

// ── fetchAllTfrs ──────────────────────────────────────────────────────────────

test('fetchAllTfrs: combines list fetch and detail fetches', async () => {
  let callCount = 0;
  const mockFetcher = async (url) => {
    callCount++;
    if (url.includes('list.html')) {
      return {
        ok: true,
        text: async () => `
          <a href="/save_pages/detail_1_0_aaa.xml">A</a>
          <a href="/save_pages/detail_1_0_bbb.xml">B</a>
        `,
      };
    }
    return {
      ok: true,
      text: async () => `<Group><Point><Lat>40.0</Lat><Lon>-74.0</Lon></Point></Group>`,
    };
  };
  const tfrs = await fetchAllTfrs(mockFetcher);
  assert.equal(callCount, 3); // 1 list + 2 detail
  assert.equal(tfrs.length, 2);
});

test('fetchAllTfrs: tolerates partial detail failures', async () => {
  let first = true;
  const mockFetcher = async (url) => {
    if (url.includes('list.html')) {
      return {
        ok: true,
        text: async () => `
          <a href="/save_pages/detail_1_0_good.xml">good</a>
          <a href="/save_pages/detail_1_0_bad.xml">bad</a>
        `,
      };
    }
    if (url.includes('_bad') && first) { first = false; throw new Error('timeout'); }
    return {
      ok: true,
      text: async () => `<Group><Point><Lat>40.0</Lat><Lon>-74.0</Lon></Point></Group>`,
    };
  };
  const tfrs = await fetchAllTfrs(mockFetcher);
  assert.ok(tfrs.length >= 1, 'should return partial results despite one failure');
});
