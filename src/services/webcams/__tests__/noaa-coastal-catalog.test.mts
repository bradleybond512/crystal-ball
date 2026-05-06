import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NOAA_COASTAL_CAMS,
  adaptNoaaCoastalCam,
  getNoaaCoastalCamFeeds,
} from '../noaa-coastal-catalog.ts';

test('NOAA_COASTAL_CAMS: catalog has at least 5 buoys', () => {
  assert.ok(NOAA_COASTAL_CAMS.length >= 5);
});

test('NOAA_COASTAL_CAMS: every record has finite coords + buoycam URL', () => {
  for (const cam of NOAA_COASTAL_CAMS) {
    assert.ok(Number.isFinite(cam.lat));
    assert.ok(Number.isFinite(cam.lon));
    assert.ok(cam.snapshotUrl.includes('ndbc.noaa.gov/buoycam.php'));
    assert.ok(cam.stationId.length > 0);
  }
});

test('NOAA_COASTAL_CAMS: station IDs are unique', () => {
  const ids = NOAA_COASTAL_CAMS.map((c) => c.stationId);
  assert.equal(ids.length, new Set(ids).size);
});

test('adaptNoaaCoastalCam: maps to NOAA_COASTAL source + coastal category', () => {
  const f = adaptNoaaCoastalCam(NOAA_COASTAL_CAMS[0]!);
  assert.equal(f.source, 'NOAA_COASTAL');
  assert.equal(f.category, 'coastal');
  assert.equal(f.id, `NOAA_COASTAL:${NOAA_COASTAL_CAMS[0]!.stationId}`);
  assert.equal(f.metadata.agency, NOAA_COASTAL_CAMS[0]!.agency);
});

test('getNoaaCoastalCamFeeds: returns full catalog as feeds', () => {
  assert.equal(getNoaaCoastalCamFeeds().length, NOAA_COASTAL_CAMS.length);
});
