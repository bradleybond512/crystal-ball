import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  HAZECAM_SITES,
  HAZECAM_ATTRIBUTION,
  hazecamSnapshotUrl,
  hazecamPageUrl,
  hazecamSiteToFeed,
  hazecamCamsToFeeds,
} from '../hazecam-catalog.ts';
import { isVisibilityCam } from '../airnow-visibility-catalog.ts';
import { evaluateSmokeTrigger } from '../webcam-event-triggers.ts';

// ── Catalog shape ─────────────────────────────────────────────────────────

test('HAZECAM_SITES: 9 active CAMNET sites with finite coords + slug ids', () => {
  assert.equal(HAZECAM_SITES.length, 9);
  const ids = new Set(HAZECAM_SITES.map((s) => s.site));
  assert.equal(ids.size, 9); // unique
  for (const s of HAZECAM_SITES) {
    assert.ok(Number.isFinite(s.lat) && Number.isFinite(s.lon), `${s.site} coords`);
    assert.match(s.site, /^[a-z0-9]+$/);
    assert.ok(s.region === 'Northeast' || s.region === 'Mid-Atlantic');
  }
});

test('hazecamSnapshotUrl / hazecamPageUrl: stable https URLs', () => {
  assert.equal(hazecamSnapshotUrl('acadia'), 'https://hazecam.net/images/large/acadia_left.jpg');
  assert.equal(hazecamPageUrl('nyc'), 'https://hazecam.net/camsite.aspx?site=nyc');
});

// ── Feed conversion ───────────────────────────────────────────────────────

test('hazecamSiteToFeed: builds a visibility-tagged nature feed with attribution', () => {
  const f = hazecamSiteToFeed({ site: 'boston', name: 'Boston, MA', lat: 42.36, lon: -71.058, region: 'Northeast' });
  assert.equal(f.id, 'HAZECAM:boston');
  assert.equal(f.source, 'HAZECAM');
  assert.equal(f.category, 'nature');
  assert.equal(f.metadata.visibility, 'true');
  assert.equal(f.metadata.program, 'camnet');
  assert.equal(f.metadata.attribution, HAZECAM_ATTRIBUTION);
  assert.equal(f.snapshotUrl, 'https://hazecam.net/images/large/boston_left.jpg');
  assert.equal(isVisibilityCam(f), true); // reuses the AirNow visibility machinery
});

test('hazecamCamsToFeeds: one visibility-tagged feed per site, all https snapshots', () => {
  const feeds = hazecamCamsToFeeds();
  assert.equal(feeds.length, 9);
  assert.ok(feeds.every((f) => isVisibilityCam(f)));
  assert.ok(feeds.every((f) => f.snapshotUrl.startsWith('https://')));
  assert.equal(new Set(feeds.map((f) => f.id)).size, 9);
});

// ── Smoke trigger integration ─────────────────────────────────────────────

const NOW = Date.UTC(2026, 6, 19, 18, 0, 0);

test('evaluateSmokeTrigger: an Unhealthy-AQI event near a CAMNET cam fires on it', () => {
  const feeds = hazecamCamsToFeeds();
  // NYC smoke event (40.71,-74.01) — the NYC + Brigantine cams are within 150km
  const ev = evaluateSmokeTrigger({ id: 'nyc-smoke', lat: 40.71, lon: -74.01, aqi: 160, observedAt: NOW }, feeds, NOW, []);
  assert.ok(ev);
  assert.equal(ev!.kind, 'smoke');
  assert.ok(ev!.affectedCamIds.includes('HAZECAM:nyc'));
});

test('evaluateSmokeTrigger: Moderate AQI (<101) near a CAMNET cam does not fire', () => {
  const feeds = hazecamCamsToFeeds();
  const ev = evaluateSmokeTrigger({ id: 'nyc-ok', lat: 40.71, lon: -74.01, aqi: 60, observedAt: NOW }, feeds, NOW, []);
  assert.equal(ev, null);
});

test('evaluateSmokeTrigger: a far event (Midwest) matches no Northeast CAMNET cam', () => {
  const feeds = hazecamCamsToFeeds();
  const ev = evaluateSmokeTrigger({ id: 'in-smoke', lat: 41.6, lon: -86.7, aqi: 175, observedAt: NOW }, feeds, NOW, []);
  assert.equal(ev, null);
});
