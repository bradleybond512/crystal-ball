import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseDyfiCdiZip,
  aggregateDyfiByState,
  summarizeDyfiCdiZip,
  cdiToMmiLabel,
  MMI_DESCRIPTIONS,
} from '../dyfi-collector.ts';

// ── cdiToMmiLabel ─────────────────────────────────────────────────────

test('mmi: cdi 1.0 → I (not felt)', () => {
  assert.equal(cdiToMmiLabel(1.0), 'I');
});

test('mmi: cdi 4.5 rounds to V (moderate)', () => {
  assert.equal(cdiToMmiLabel(4.5), 'V');
});

test('mmi: cdi 6.5 rounds to VII (very strong)', () => {
  assert.equal(cdiToMmiLabel(6.5), 'VII');
});

test('mmi: cdi 11.9 → XII (extreme cap)', () => {
  assert.equal(cdiToMmiLabel(11.9), 'XII');
});

test('mmi: cdi NaN / negative → I', () => {
  assert.equal(cdiToMmiLabel(Number.NaN), 'I');
  assert.equal(cdiToMmiLabel(-5), 'I');
});

test('mmi: cdi 100 caps at XII', () => {
  assert.equal(cdiToMmiLabel(100), 'XII');
});

test('mmi: full ladder is exhaustive', () => {
  for (const c of [1, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5]) {
    const label = cdiToMmiLabel(c);
    assert.ok(MMI_DESCRIPTIONS[label]);
  }
});

// ── parseDyfiCdiZip — newer <result> layout ───────────────────────────

const newLayoutXml = `<?xml version="1.0"?>
<cdi>
  <eventid>nc73239876</eventid>
  <maxmmi>5.2</maxmmi>
  <results>
    <result>
      <zip>94025</zip>
      <cdi>4.7</cdi>
      <responses>13</responses>
      <state>CA</state>
      <city>Menlo Park</city>
      <lat>37.45</lat>
      <lon>-122.18</lon>
    </result>
    <result>
      <zip>94027</zip>
      <cdi>5.2</cdi>
      <responses>27</responses>
      <state>CA</state>
      <city>Atherton</city>
      <lat>37.46</lat>
      <lon>-122.20</lon>
    </result>
    <result>
      <zip>89701</zip>
      <cdi>3.1</cdi>
      <responses>4</responses>
      <state>NV</state>
      <city>Carson City</city>
    </result>
  </results>
</cdi>`;

test('parse: newer <result> layout extracts all entries', () => {
  const out = parseDyfiCdiZip(newLayoutXml);
  assert.equal(out.length, 3);
  assert.equal(out[0]!.zip, '94025');
  assert.equal(out[0]!.cdi, 4.7);
  assert.equal(out[0]!.state, 'CA');
  assert.equal(out[0]!.city, 'Menlo Park');
  assert.equal(out[1]!.responses, 27);
  assert.equal(out[2]!.lat, null);
});

// ── parseDyfiCdiZip — legacy <zipcode> layout ─────────────────────────

const legacyXml = `<?xml version="1.0"?>
<cdi_zip>
  <event_id>nc73239876</event_id>
  <zipcode value="94025">
    <cdi>4.7</cdi>
    <responses>13</responses>
    <state>CA</state>
    <city>Menlo Park</city>
    <location lat="37.45" lon="-122.18" />
  </zipcode>
  <zipcode value="94027">
    <cdi>5.2</cdi>
    <responses>27</responses>
    <state>CA</state>
    <city>Atherton</city>
  </zipcode>
</cdi_zip>`;

test('parse: legacy <zipcode> layout extracts all entries', () => {
  const out = parseDyfiCdiZip(legacyXml);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.zip, '94025');
  assert.equal(out[0]!.lat, 37.45);
  assert.equal(out[0]!.lon, -122.18);
  assert.equal(out[1]!.responses, 27);
});

test('parse: empty XML returns empty array', () => {
  assert.deepEqual(parseDyfiCdiZip('<cdi/>'), []);
});

test('parse: entries with non-numeric CDI are skipped', () => {
  const xml = `<cdi><results>
    <result><zip>1</zip><cdi>foo</cdi><responses>1</responses><state>CA</state></result>
    <result><zip>2</zip><cdi>3.0</cdi><responses>1</responses><state>CA</state></result>
  </results></cdi>`;
  const out = parseDyfiCdiZip(xml);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.zip, '2');
});

test('parse: entries with no responses default to 0', () => {
  const xml = `<cdi><results><result><zip>1</zip><cdi>3.0</cdi><state>CA</state></result></results></cdi>`;
  const out = parseDyfiCdiZip(xml);
  assert.equal(out[0]!.responses, 0);
});

test('parse: handles CDATA-wrapped fields', () => {
  const xml = `<cdi><results><result>
    <zip>1</zip>
    <cdi>4.0</cdi>
    <responses>5</responses>
    <state><![CDATA[CA]]></state>
    <city><![CDATA[San Francisco]]></city>
  </result></results></cdi>`;
  const out = parseDyfiCdiZip(xml);
  assert.equal(out[0]!.state, 'CA');
  assert.equal(out[0]!.city, 'San Francisco');
});

// ── aggregateDyfiByState ──────────────────────────────────────────────

test('aggregate: zero-response entries are dropped', () => {
  const out = aggregateDyfiByState([
    { zip: '1', cdi: 5, responses: 0, state: 'CA', city: null, lat: null, lon: null },
    { zip: '2', cdi: 4, responses: 3, state: 'CA', city: null, lat: null, lon: null },
  ]);
  assert.equal(out.totalResponses, 3);
  assert.equal(out.totalZips, 1);
  assert.equal(out.maxCdi, 4);
});

test('aggregate: groups by state, maxCdi tracks per-state strongest ZIP', () => {
  const out = aggregateDyfiByState([
    { zip: '1', cdi: 4, responses: 5, state: 'CA', city: 'A', lat: null, lon: null },
    { zip: '2', cdi: 5.5, responses: 8, state: 'CA', city: 'B', lat: null, lon: null },
    { zip: '3', cdi: 3, responses: 2, state: 'NV', city: 'C', lat: null, lon: null },
  ]);
  assert.equal(out.byState.length, 2);
  assert.equal(out.byState[0]!.state, 'CA');
  assert.equal(out.byState[0]!.maxCdi, 5.5);
  assert.equal(out.byState[0]!.maxCdiCity, 'B');
  assert.equal(out.byState[0]!.zipCount, 2);
  assert.equal(out.byState[0]!.responses, 13);
  assert.equal(out.byState[1]!.state, 'NV');
});

test('aggregate: sorted by descending maxCdi, then by descending responses', () => {
  const out = aggregateDyfiByState([
    { zip: '1', cdi: 4, responses: 100, state: 'OR', city: null, lat: null, lon: null },
    { zip: '2', cdi: 4, responses: 50, state: 'NV', city: null, lat: null, lon: null },
    { zip: '3', cdi: 5, responses: 1, state: 'CA', city: null, lat: null, lon: null },
  ]);
  assert.deepEqual(out.byState.map((s) => s.state), ['CA', 'OR', 'NV']);
});

test('aggregate: maxCdiState reflects the global max', () => {
  const out = aggregateDyfiByState([
    { zip: '1', cdi: 4, responses: 5, state: 'CA', city: null, lat: null, lon: null },
    { zip: '2', cdi: 6.7, responses: 5, state: 'NV', city: null, lat: null, lon: null },
  ]);
  assert.equal(out.maxCdiState, 'NV');
  assert.equal(out.mmiLabel, 'VII');
  assert.equal(out.mmiDescription, 'Very strong');
});

test('aggregate: empty input → all-zero summary', () => {
  const out = aggregateDyfiByState([]);
  assert.equal(out.totalResponses, 0);
  assert.equal(out.totalZips, 0);
  assert.equal(out.maxCdi, 0);
  assert.equal(out.maxCdiState, null);
  assert.equal(out.mmiLabel, 'I');
  assert.deepEqual(out.byState, []);
});

test('aggregate: result is JSON-serializable', () => {
  const out = aggregateDyfiByState([
    { zip: '1', cdi: 4, responses: 5, state: 'CA', city: 'X', lat: 0, lon: 0 },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
});

// ── summarizeDyfiCdiZip ───────────────────────────────────────────────

test('summarize: end-to-end on the new layout', () => {
  const out = summarizeDyfiCdiZip(newLayoutXml);
  assert.equal(out.totalZips, 3);
  assert.equal(out.totalResponses, 44);
  assert.equal(out.maxCdiState, 'CA');
  assert.equal(out.mmiLabel, 'V');
});

test('summarize: end-to-end on the legacy layout', () => {
  const out = summarizeDyfiCdiZip(legacyXml);
  assert.equal(out.totalZips, 2);
  assert.equal(out.totalResponses, 40);
  assert.equal(out.byState[0]!.state, 'CA');
});
