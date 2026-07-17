import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSmokeHeadline } from '../smoke-headline.ts';
import { buildSnapshot } from '../smoke-snapshot.ts';
import type { ParsedAq } from '../smoke-parse.ts';

function snapWithAqi(usAqi: number | null, safeLabel = false): ReturnType<typeof buildSnapshot> {
  const home: ParsedAq = {
    current: { usAqi, pm25: null },
    hourly: safeLabel
      ? [{ time: '2026-07-17T02:00:00Z', usAqi: 60, pm25: null }]
      : [{ time: '2026-07-17T02:00:00Z', usAqi: usAqi ?? 150, pm25: null }],
  };
  return buildSnapshot({
    place: { id: 'home', name: 'La Porte', lat: 41.6, lon: -86.7 },
    home,
    compassParsed: [],
    doneChecklistIds: [],
    sensitiveGroup: false,
    now: 0,
  });
}

test('below USG with no alerts → no callout', () => {
  assert.equal(buildSmokeHeadline(snapWithAqi(91), 0), null);
  assert.equal(buildSmokeHeadline(snapWithAqi(null), 0), null);
});

test('USG threshold edge: 101 fires at severity 72 (critical band, not critical tone)', () => {
  const h = buildSmokeHeadline(snapWithAqi(101), 0);
  assert.ok(h);
  assert.equal(h.severity, 72);
  assert.match(h.description, /sensitive groups/i);
  assert.match(h.description, /La Porte/);
  assert.match(h.description, /AQI 101/);
});

test('category ladder is monotone and crosses critical tone at very_unhealthy', () => {
  const usg = buildSmokeHeadline(snapWithAqi(120), 0)!;
  const unhealthy = buildSmokeHeadline(snapWithAqi(160), 0)!;
  const vu = buildSmokeHeadline(snapWithAqi(250), 0)!;
  const haz = buildSmokeHeadline(snapWithAqi(320), 0)!;
  assert.ok(usg.severity < unhealthy.severity && unhealthy.severity < vu.severity && vu.severity < haz.severity);
  assert.ok(vu.severity >= 85 && haz.severity >= 85);
});

test('improving hint appended when a safe window exists', () => {
  const h = buildSmokeHeadline(snapWithAqi(160, true), 0);
  assert.match(h!.description, /improving/i);
});

test('sub-USG AQI with active smoke alerts → advisory-grade callout at band floor', () => {
  const h = buildSmokeHeadline(snapWithAqi(91), 3);
  assert.ok(h);
  assert.equal(h.severity, 70);
  assert.match(h.description, /advisories active near La Porte/);
  assert.match(h.description, /AQI 91/);
});

test('stable eventId per place (replaces prior callout instead of stacking)', () => {
  assert.equal(buildSmokeHeadline(snapWithAqi(160), 0)!.eventId, 'smoke-home');
  assert.equal(buildSmokeHeadline(snapWithAqi(320), 1)!.eventId, 'smoke-home');
});
