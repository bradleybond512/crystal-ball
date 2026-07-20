import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  extractNotamIds,
  parseTfrXml,
  tfrColor,
  detailUrlForId,
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
    if (url.includes('exportTfrList')) {
      return {
        ok: true,
        text: async () => JSON.stringify([{ notam_id: '1/0001' }, { notam_id: '1/0002' }]),
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
    if (url.includes('exportTfrList')) {
      return {
        ok: true,
        text: async () => JSON.stringify([{ notam_id: '1/good' }, { notam_id: '1/bad' }]),
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

// ── TFR3 migration: JSON list + XNOTAM detail schema ─────────────────────────

test('extractNotamIds: parses the TFR3 JSON list', () => {
  const json = JSON.stringify([
    { notam_id: '6/1748', type: 'HAZARDS', state: 'WA' },
    { notam_id: '6/1745', type: 'UAS PUBLIC GATHERING', state: 'CO' },
  ]);
  const ids = extractNotamIds(json);
  assert.deepEqual(ids, ['6/1748', '6/1745']);
});

test('extractNotamIds: ignores JSON rows without a notam_id', () => {
  const json = JSON.stringify([{ notam_id: '6/1748' }, { type: 'HAZARDS' }, { notam_id: '' }]);
  assert.deepEqual(extractNotamIds(json), ['6/1748']);
});

test('detailUrlForId: maps the TFR3 slash id onto the download path', () => {
  assert.equal(detailUrlForId('6/1748'), 'https://tfr.faa.gov/download/detail_6_1748.xml');
  // Legacy underscore ids pass through unchanged.
  assert.equal(detailUrlForId('1_0_1234567'), 'https://tfr.faa.gov/download/detail_1_0_1234567.xml');
});

test('parseTfrXml: parses the TFR3 XNOTAM schema (Avx polygon + fields)', () => {
  const xml = `<XNOTAM-Update>
    <Not>
      <NotUid><txtLocalName>6/1748</txtLocalName></NotUid>
      <dateEffective>2026-06-29T23:44:00</dateEffective>
      <dateExpire>2026-07-13T04:00:00</dateExpire>
      <txtDescrPurpose>TO PROVIDE A SAFE ENVIRONMENT FOR FIRE FIGHTING ACFT OPS</txtDescrPurpose>
      <TfrNot>
        <codeType>91.137(a)(2)</codeType>
        <aseTFRArea>
          <valDistVerUpper>6000</valDistVerUpper>
          <valDistVerLower>0</valDistVerLower>
          <Avx><geoLat>46.11666667N</geoLat><geoLong>118.95833333W</geoLong></Avx>
          <Avx><geoLat>46.16666667N</geoLat><geoLong>118.69166667W</geoLong></Avx>
          <Avx><geoLat>45.98333333N</geoLat><geoLong>118.68333333W</geoLong></Avx>
        </aseTFRArea>
      </TfrNot>
    </Not>
  </XNOTAM-Update>`;
  const tfr = parseTfrXml('6_1748', xml);
  assert.ok(tfr !== null);
  assert.equal(tfr.notamNumber, '6/1748');
  assert.equal(tfr.type, 'Fire'); // from the purpose text
  assert.equal(tfr.altFloor, 0);
  assert.equal(tfr.altCeiling, 6000);
  assert.ok(tfr.effectiveStart?.includes('2026-06-29'));
  assert.ok(tfr.effectiveEnd?.includes('2026-07-13'));
  assert.equal(tfr.polygon.length, 3);
  // N latitudes stay positive; W longitudes become negative.
  assert.ok(tfr.polygon.every(([lon, lat]) => lon < 0 && lat > 0));
  const [lon0, lat0] = tfr.polygon[0];
  assert.ok(lat0 > 46.1 && lat0 < 46.2, `N latitude near 46.12, got ${lat0}`);
  assert.ok(lon0 > -119 && lon0 < -118.9, `W longitude near -118.96, got ${lon0}`);
  assert.ok(tfr.center !== null);
});

test('extractNotamIds: drops ids with unsafe URL characters', () => {
  const json = JSON.stringify([
    { notam_id: '6/1748' },
    { notam_id: '../../etc/passwd' },
    { notam_id: 'a b' },
    { notam_id: '4/9999' },
  ]);
  assert.deepEqual(extractNotamIds(json), ['6/1748', '4/9999']);
});

const fetcherReturning = (body) => () => Promise.resolve({ ok: true, text: () => Promise.resolve(body) });

test('fetchTfrIds: throws on a JSON-shaped body that does not parse (degrades, not healthy-empty)', async () => {
  await assert.rejects(() => fetchTfrIds(fetcherReturning('[{ "notam_id": "6/1748" ')), /TFR list JSON parse error/);
});

test('fetchTfrIds: throws on an unexpected JSON shape', async () => {
  await assert.rejects(() => fetchTfrIds(fetcherReturning(JSON.stringify({ error: 'upstream changed' }))), /TFR list JSON shape unexpected/);
});

test('fetchTfrIds: a valid empty array is a healthy "no active TFRs" response', async () => {
  const ids = await fetchTfrIds(fetcherReturning('[]'));
  assert.deepEqual(ids, []);
});
