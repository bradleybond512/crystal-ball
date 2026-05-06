import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VOLCANO_CAMS,
  adaptVolcanoCam,
  getVolcanoCamFeeds,
} from '../volcano-cam-catalog.ts';

test('VOLCANO_CAMS: catalog has at least 10 cams across 4 observatories', () => {
  assert.ok(VOLCANO_CAMS.length >= 10);
  const obs = new Set(VOLCANO_CAMS.map((c) => c.observatory));
  assert.ok(obs.has('HVO'));
  assert.ok(obs.has('CVO'));
  assert.ok(obs.has('AVO'));
});

test('VOLCANO_CAMS: every entry has finite lat/lon and snapshotUrl', () => {
  for (const cam of VOLCANO_CAMS) {
    assert.ok(Number.isFinite(cam.lat), `${cam.id} lat not finite`);
    assert.ok(Number.isFinite(cam.lon), `${cam.id} lon not finite`);
    assert.ok(cam.snapshotUrl.startsWith('http'), `${cam.id} has bad URL`);
    assert.ok(cam.name.length > 0);
    assert.ok(cam.volcano.length > 0);
  }
});

test('VOLCANO_CAMS: ids are unique', () => {
  const ids = VOLCANO_CAMS.map((c) => c.id);
  assert.equal(ids.length, new Set(ids).size);
});

test('adaptVolcanoCam: maps to USGS_VOLCANO source + volcano category', () => {
  const f = adaptVolcanoCam(VOLCANO_CAMS[0]!);
  assert.equal(f.source, 'USGS_VOLCANO');
  assert.equal(f.category, 'volcano');
  assert.equal(f.id, `USGS_VOLCANO:${VOLCANO_CAMS[0]!.id}`);
  assert.equal(f.metadata.observatory, VOLCANO_CAMS[0]!.observatory);
});

test('getVolcanoCamFeeds: empty alert map returns full catalog', () => {
  const feeds = getVolcanoCamFeeds();
  assert.equal(feeds.length, VOLCANO_CAMS.length);
});

test('getVolcanoCamFeeds: alert level threaded into metadata', () => {
  const feeds = getVolcanoCamFeeds({ Kilauea: 'WATCH' });
  const kilauea = feeds.find((f) => f.metadata.volcano === 'Kilauea');
  assert.ok(kilauea);
  assert.equal(kilauea.metadata.alertLevel, 'WATCH');
});

test('getVolcanoCamFeeds: unknown volcano name doesn\'t leak metadata', () => {
  const feeds = getVolcanoCamFeeds({ Unknown: 'WARNING' });
  assert.ok(feeds.every((f) => f.metadata.alertLevel !== 'WARNING'));
});
