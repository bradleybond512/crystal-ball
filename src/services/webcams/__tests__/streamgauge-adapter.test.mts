import assert from 'node:assert/strict';
import test from 'node:test';

import {
  KNOWN_STREAM_GAUGE_CAMS,
  STREAM_GAUGE_PHOTO_BASE,
  adaptStreamGauge,
  adaptStreamGauges,
} from '../streamgauge-adapter.ts';

test('adaptStreamGauge: builds USGS photo URL', () => {
  const f = adaptStreamGauge({
    siteNo: '11447650',
    name: 'Sacramento River',
    lat: 38.4555,
    lon: -121.5021,
    state: 'CA',
    hasPhoto: true,
  });
  assert.ok(f);
  assert.equal(f.source, 'USGS_STREAM');
  assert.equal(f.category, 'stream');
  assert.equal(f.id, 'USGS_STREAM:11447650');
  assert.equal(f.snapshotUrl, `${STREAM_GAUGE_PHOTO_BASE}11447650`);
  assert.equal(f.metadata.state, 'CA');
});

test('adaptStreamGauge: drops gauges without photos', () => {
  assert.equal(
    adaptStreamGauge({ siteNo: '1', name: 'x', lat: 1, lon: 1, hasPhoto: false }),
    null,
  );
});

test('adaptStreamGauge: drops gauges with bad coords', () => {
  assert.equal(
    adaptStreamGauge({ siteNo: '1', name: 'x', lat: Number.NaN, lon: 1, hasPhoto: true }),
    null,
  );
});

test('adaptStreamGauges: produces only valid feeds', () => {
  const out = adaptStreamGauges([
    { siteNo: '1', name: 'a', lat: 1, lon: 1, hasPhoto: true },
    { siteNo: '2', name: 'b', lat: 2, lon: 2, hasPhoto: false },
    null as unknown as never,
  ]);
  assert.equal(out.length, 1);
});

test('KNOWN_STREAM_GAUGE_CAMS: every record is well-formed', () => {
  assert.ok(KNOWN_STREAM_GAUGE_CAMS.length >= 5);
  for (const rec of KNOWN_STREAM_GAUGE_CAMS) {
    assert.ok(rec.siteNo.length > 0, `siteNo missing: ${JSON.stringify(rec)}`);
    assert.ok(Number.isFinite(rec.lat));
    assert.ok(Number.isFinite(rec.lon));
    assert.equal(rec.hasPhoto, true);
  }
  const sites = KNOWN_STREAM_GAUGE_CAMS.map((r) => r.siteNo);
  assert.equal(sites.length, new Set(sites).size, 'siteNo must be unique');
});

test('KNOWN_STREAM_GAUGE_CAMS: all adapt cleanly to WebcamFeed', () => {
  const feeds = adaptStreamGauges(KNOWN_STREAM_GAUGE_CAMS);
  assert.equal(feeds.length, KNOWN_STREAM_GAUGE_CAMS.length);
});
