import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseAlerts,
  parseKpFeed,
  parseSolarWindFeed,
  parseXrayClass,
  toUtcIsoTag,
} from '../space-weather-parse.ts';

// Every fixture below is the REAL payload shape, captured live 2026-07-30/31
// (rows trimmed, values verbatim). The bug these pin down was a shape
// mismatch, so fabricated fixtures would have reproduced the bug instead of
// catching it.

// ── Kp — products/noaa-planetary-k-index.json ──────────────────────────────
// Array of OBJECTS, capital-K `Kp`, zone-less time_tag. The old renderer read
// it as a header row + array-of-arrays and took Number(last[1]).
const SWPC_KP_LIVE_SHAPE = [
  { time_tag: '2026-07-30T09:00:00', Kp: 2, a_running: 6, station_count: 8 },
  { time_tag: '2026-07-30T12:00:00', Kp: 1.67, a_running: 6, station_count: 8 },
  { time_tag: '2026-07-30T21:00:00', Kp: 1, a_running: 4, station_count: 8 },
];

test('parseKpFeed reads the live array-of-objects product with a capital-K Kp', () => {
  assert.equal(parseKpFeed(SWPC_KP_LIVE_SHAPE), 1);
});

test('parseKpFeed returns null — not 0 — on the shape the old code assumed', () => {
  // The header-row + array-of-arrays shape must not yield a bogus quiet reading.
  assert.equal(parseKpFeed([['time_tag', 'kp_index'], ['2026-07-30T21:00:00', 5]]), null);
  assert.equal(parseKpFeed(null), null);
  assert.equal(parseKpFeed({ Kp: [1] }), null);
  assert.equal(parseKpFeed([]), null);
});

test('parseKpFeed rejects an absent Kp on identity rather than coercing it to 0', () => {
  // Number(null) === 0, which reads as a perfectly valid "quiet" Kp.
  assert.equal(parseKpFeed([{ time_tag: '2026-07-30T21:00:00', Kp: null }]), null);
  assert.equal(parseKpFeed([{ time_tag: '2026-07-30T21:00:00', Kp: '' }]), null);
  assert.equal(parseKpFeed([{ time_tag: '2026-07-30T21:00:00' }]), null);
  assert.equal(parseKpFeed([{ time_tag: '2026-07-30T21:00:00', Kp: 'quiet' }]), null);
});

test('parseKpFeed skips unusable rows without discarding the payload', () => {
  assert.equal(parseKpFeed([
    { time_tag: '2026-07-30T21:00:00', Kp: null },
    ['2026-07-30T21:00:00', 9],
    null,
    { time_tag: '', Kp: 4 },
    { time_tag: '2026-07-30T18:00:00', Kp: 3.33 },
  ]), 3.33);
});

function inTimezone<T>(tz: string, fn: () => T): T {
  const original = process.env.TZ;
  try {
    process.env.TZ = tz;
    return fn();
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}

test('toUtcIsoTag stamps a zone-less tag and leaves an explicit zone alone', () => {
  // Asserted on the string, so it holds in every host timezone. A test that
  // only compared PARSED instants would agree with the buggy implementation on
  // a UTC runner and fail only off-UTC — i.e. never in CI.
  assert.equal(toUtcIsoTag('2026-07-30T21:00:00'), '2026-07-30T21:00:00Z');
  assert.equal(toUtcIsoTag('2026-07-30 19:03:19.350'), '2026-07-30T19:03:19.350Z');
  assert.equal(toUtcIsoTag('2026-07-30T21:00:00Z'), '2026-07-30T21:00:00Z');
  assert.equal(toUtcIsoTag('2026-07-30T21:00:00+02:00'), '2026-07-30T21:00:00+02:00');
  assert.equal(toUtcIsoTag('2026-07-30'), '2026-07-30', 'a bare date + Z parses to NaN');
  assert.equal(toUtcIsoTag(null), '');
});

test('parseKpFeed resolves a zone-less time_tag as UTC in any host timezone', () => {
  // The two bins are deliberately stamped DIFFERENTLY: one zone-less, one with
  // an explicit Z. Reading the zone-less tag as local shifts only that bin, so
  // west-of-UTC hosts flip which bin is newest. The previous version of this
  // test shifted both tags equally, so the ordering never changed and it could
  // not fail.
  const spread = [
    { time_tag: '2026-07-30T21:00:00', Kp: 1 },   // 21:00Z when read correctly
    { time_tag: '2026-07-30T23:00:00Z', Kp: 7 },  // always 23:00Z — the newest
  ];
  // Guard: if TZ mutation stops taking effect, the assertions below become
  // vacuous, so prove the runtime is actually honouring it first.
  const shifts = new Set(['UTC', 'America/Chicago', 'Asia/Tokyo']
    .map((tz) => inTimezone(tz, () => new Date('2026-07-30T21:00:00').getTime())));
  assert.equal(shifts.size, 3, 'TZ mutation must actually move naïve parsing');

  assert.equal(inTimezone('UTC', () => parseKpFeed(spread)), 7);
  // Chicago is UTC-5: the un-stamped tag would land at 02:00Z the NEXT day and
  // win, so a regression here returns 1.
  assert.equal(inTimezone('America/Chicago', () => parseKpFeed(spread)), 7,
    'the answer must not depend on where the machine is');
  assert.equal(inTimezone('Asia/Tokyo', () => parseKpFeed(spread)), 7);
});

test('parseKpFeed rejects physically impossible Kp values', () => {
  // Kp is a 0–9 scale. A corrupt 999 would trip the Kp≥5 storm alerting
  // downstream, so it is dropped rather than rendered as fact.
  assert.equal(parseKpFeed([{ time_tag: '2026-07-30T21:00:00', Kp: 999 }]), null);
  assert.equal(parseKpFeed([{ time_tag: '2026-07-30T21:00:00', Kp: -1 }]), null);
  assert.equal(parseKpFeed([
    { time_tag: '2026-07-30T21:00:00', Kp: 999 },
    { time_tag: '2026-07-30T18:00:00', Kp: 4 },
  ]), 4, 'a corrupt newest row falls back to the newest sane one');
});

test('parseKpFeed rejects non-numeric types that Number() would coerce to 0', () => {
  // Number(false), Number([]) and Number('   ') are all 0 — a valid-looking
  // quiet reading. Type-gating, not coercion, is what keeps these out.
  for (const bogus of [false, [], '   ', {}, [] as unknown]) {
    assert.equal(parseKpFeed([{ time_tag: '2026-07-30T21:00:00', Kp: bogus }]), null,
      `Kp: ${JSON.stringify(bogus)} must not read as 0`);
  }
});

test('parseKpFeed picks the newest bin by timestamp, not by array position', () => {
  assert.equal(parseKpFeed([
    { time_tag: '2026-07-30T21:00:00', Kp: 1 },
    { time_tag: '2026-07-30T09:00:00', Kp: 7 },
  ]), 1);
});

// ── Solar wind — products/geospace/propagated-solar-wind-1-hour.json ───────
// Header row + data rows. The retired mag-5-minute/plasma-5-minute products
// this replaces now 404, so Bz/speed/density were null upstream of the renderer.
const SWPC_WIND_LIVE_SHAPE = [
  ['time_tag', 'speed', 'density', 'temperature', 'bx', 'by', 'bz', 'bt', 'vx', 'vy', 'vz', 'propagated_time_tag'],
  ['2026-07-31T01:15:00Z', 321.9, 2.58, 64325, 0.47, 2.4, 3.13, 3.97, -321.1, 11.6, -19.1, '2026-07-31T02:19:12Z'],
  ['2026-07-31T01:17:00Z', 321.6, 2.75, 68239, 0.46, 2.09, 3.22, 3.86, -320.7, 12.7, -20.2, '2026-07-31T02:21:17Z'],
];

test('parseSolarWindFeed pulls speed, density and bz from the newest row', () => {
  const wind = parseSolarWindFeed(SWPC_WIND_LIVE_SHAPE);
  assert.equal(wind.speed, 321.6);
  assert.equal(wind.density, 2.75);
  assert.equal(wind.bz, 3.22);
  assert.equal(wind.observedAt, '2026-07-31T01:17:00.000Z');
});

test('parseSolarWindFeed resolves columns by NAME, surviving a reordered header', () => {
  // Index-based parsing is what broke this file; a reorder must not silently
  // swap speed and density.
  const reordered = [
    ['time_tag', 'bz', 'density', 'speed'],
    ['2026-07-31T01:17:00Z', 3.22, 2.75, 321.6],
  ];
  const wind = parseSolarWindFeed(reordered);
  assert.equal(wind.speed, 321.6);
  assert.equal(wind.density, 2.75);
  assert.equal(wind.bz, 3.22);
});

test('parseSolarWindFeed falls back per-field when the trailing row has gaps', () => {
  const gappy = [
    ['time_tag', 'speed', 'density', 'bz'],
    ['2026-07-31T01:15:00Z', 321.9, 2.58, 3.13],
    ['2026-07-31T01:17:00Z', null, null, 3.22],
  ];
  const wind = parseSolarWindFeed(gappy);
  assert.equal(wind.bz, 3.22, 'newest bz still wins');
  assert.equal(wind.speed, 321.9, 'a gap in the newest row must not null the whole panel');
  assert.equal(wind.density, 2.58);
  assert.equal(wind.observedAt, '2026-07-31T01:17:00.000Z', 'timestamp comes from the newest contributing row');
});

test('parseSolarWindFeed orders rows by timestamp, not by array position', () => {
  const outOfOrder = [
    ['time_tag', 'speed', 'density', 'bz'],
    ['2026-07-31T01:17:00Z', 321.6, 2.75, 3.22],
    ['2026-07-31T01:15:00Z', 321.9, 2.58, 3.13],
  ];
  const wind = parseSolarWindFeed(outOfOrder);
  assert.equal(wind.speed, 321.6, 'newest by clock wins even when it is not last');
  assert.equal(wind.observedAt, '2026-07-31T01:17:00.000Z');
});

test('parseSolarWindFeed never reports an unparseable tag as observedAt', () => {
  // Emitting observedAt: "not-a-date" hands every downstream staleness check an
  // Invalid Date, which silently compares false against every threshold.
  const bad = [
    ['time_tag', 'speed', 'density', 'bz'],
    ['not-a-date', 321.6, 2.75, 3.22],
  ];
  const wind = parseSolarWindFeed(bad);
  assert.equal(wind.speed, 321.6, 'the readings are still usable');
  assert.equal(wind.observedAt, null, 'but an undatable row cannot supply the timestamp');
});

test('parseSolarWindFeed drops physically impossible readings per field', () => {
  const corrupt = [
    ['time_tag', 'speed', 'density', 'bz'],
    ['2026-07-31T01:15:00Z', 321.9, 2.58, 3.13],
    ['2026-07-31T01:17:00Z', -9999, 1e9, 3.22],
  ];
  const wind = parseSolarWindFeed(corrupt);
  assert.equal(wind.bz, 3.22, 'the sane field in the newest row is kept');
  assert.equal(wind.speed, 321.9, 'a negative speed falls back to the prior row');
  assert.equal(wind.density, 2.58, 'so does an impossible density');
});

test('parseSolarWindFeed rejects non-numeric cells rather than coercing them to 0', () => {
  const bogus = [
    ['time_tag', 'speed', 'density', 'bz'],
    ['2026-07-31T01:17:00Z', false, '   ', []],
  ];
  const wind = parseSolarWindFeed(bogus);
  assert.equal(wind.speed, null);
  assert.equal(wind.density, null);
  assert.equal(wind.bz, null);
});

test('parseSolarWindFeed returns all-null on malformed or header-only payloads', () => {
  const empty = { speed: null, density: null, bz: null, observedAt: null };
  assert.deepEqual(parseSolarWindFeed([['time_tag', 'speed', 'density', 'bz']]), empty);
  assert.deepEqual(parseSolarWindFeed(null), empty);
  assert.deepEqual(parseSolarWindFeed({ speed: 300 }), empty);
  assert.deepEqual(parseSolarWindFeed([]), empty);
});

test('parseSolarWindFeed never coerces a null reading into a real 0', () => {
  const allNull = [
    ['time_tag', 'speed', 'density', 'bz'],
    ['2026-07-31T01:17:00Z', null, null, null],
  ];
  assert.deepEqual(parseSolarWindFeed(allNull), { speed: null, density: null, bz: null, observedAt: null });
});

// ── X-ray — json/goes/primary/xray-flares-latest.json ──────────────────────
const SWPC_XRAY_LIVE_SHAPE = [{
  time_tag: '2026-07-31T01:19:00Z',
  satellite: 18,
  current_class: 'C1.2',
  begin_class: 'C2.2',
  max_time: '2026-07-30T17:00:00Z',
  max_class: 'M1.9',
  end_class: null,
}];

test('parseXrayClass reports the peak class from the live single-element array', () => {
  assert.equal(parseXrayClass(SWPC_XRAY_LIVE_SHAPE), 'M1.9');
});

test('parseXrayClass falls back to current_class, then null', () => {
  assert.equal(parseXrayClass([{ current_class: 'C1.2' }]), 'C1.2');
  assert.equal(parseXrayClass([{ max_class: null, current_class: 'C1.2' }]), 'C1.2');
  assert.equal(parseXrayClass([{ max_class: '   ' }]), null);
  assert.equal(parseXrayClass([]), null);
  assert.equal(parseXrayClass(null), null);
});

test('parseXrayClass also accepts a bare object, not just a wrapping array', () => {
  assert.equal(parseXrayClass({ max_class: 'X2.1' }), 'X2.1');
});

// ── Alerts — products/alerts.json ──────────────────────────────────────────
// Every message opens with "Space Weather Message Code: ...", so the old
// first-line read showed the message CODE and classified everything 'summary'.
// issue_datetime is space-separated and zone-less.
const ALERT_AT = '2026-07-30 19:03:19.350';
const NOW = Date.parse('2026-07-30T20:00:00Z');

function swpcMessage(body: string): string {
  return `Space Weather Message Code: ALTPX1\r\nSerial Number: 366\r\nIssue Time: 2026 Jul 30 1903 UTC\r\n\r\n${body}\r\n`;
}

test('parseAlerts surfaces the severity line, not the message code', () => {
  const [alert] = parseAlerts(
    [{ product_id: 'ALTPX1', issue_datetime: ALERT_AT, message: swpcMessage('ALERT: Proton Event 10meV Integral Flux exceeded 10pfu') }],
    NOW,
  );
  assert.equal(alert!.message, 'ALERT: Proton Event 10meV Integral Flux exceeded 10pfu');
  assert.equal(alert!.severity, 'alert');
});

test('parseAlerts reads the space-separated issue_datetime as UTC', () => {
  const [alert] = parseAlerts([{ issue_datetime: ALERT_AT, message: swpcMessage('WATCH: Geomagnetic Storm Category G1') }], NOW);
  assert.equal(alert!.issuedAt.toISOString(), '2026-07-30T19:03:19.350Z');
  assert.ok(Number.isFinite(alert!.issuedAt.getTime()), 'must never render an Invalid Date');
});

test('parseAlerts maps every keyword SWPC actually emits', () => {
  const cases: [string, string][] = [
    ['ALERT: Type II Radio Emission', 'alert'],
    ['WARNING: Proton 10MeV Integral Flux above 10pfu expected', 'warning'],
    ['EXTENDED WARNING: Geomagnetic K-index of 5 expected', 'warning'],
    ['WATCH: Geomagnetic Storm Category G1 Predicted', 'watch'],
    ['SUMMARY: 10cm Radio Burst', 'summary'],
    // Both all-clears must never read as active.
    ['CANCEL WARNING: Geomagnetic K-index of 4 expected', 'summary'],
    ['CANCEL ALERT: Proton Event 100MeV Integral Flux exceeded 1pfu', 'summary'],
    // A continuation is still an active alert.
    ['CONTINUED ALERT: Electron 2MeV Integral Flux exceeded 1,000pfu', 'alert'],
  ];
  for (const [body, expected] of cases) {
    const [alert] = parseAlerts([{ issue_datetime: ALERT_AT, message: swpcMessage(body) }], NOW);
    assert.equal(alert!.severity, expected, `${body} → ${expected}`);
    assert.equal(alert!.message, body, 'headline is the severity line itself');
  }
});

test('parseAlerts drops entries outside the window and sorts newest-first', () => {
  const alerts = parseAlerts([
    { issue_datetime: '2026-07-30 10:00:00.000', message: swpcMessage('ALERT: older but in window') },
    { issue_datetime: '2026-07-28 10:00:00.000', message: swpcMessage('ALERT: two days stale') },
    { issue_datetime: '2026-07-30 19:03:19.350', message: swpcMessage('ALERT: newest') },
  ], NOW);
  assert.equal(alerts.length, 2, 'the stale entry is outside the 24h window');
  assert.equal(alerts[0]!.message, 'ALERT: newest', 'sorted here, not trusted from upstream order');
  assert.equal(alerts[1]!.message, 'ALERT: older but in window');
});

test('parseAlerts drops rows it cannot place in time rather than showing them', () => {
  assert.deepEqual(parseAlerts([{ issue_datetime: 'not-a-date', message: swpcMessage('ALERT: undateable') }], NOW), []);
  assert.deepEqual(parseAlerts([{ issue_datetime: ALERT_AT, message: '' }], NOW), []);
  assert.deepEqual(parseAlerts(null, NOW), []);
  assert.deepEqual(parseAlerts([null, 'nope', 42], NOW), []);
});

test('parseAlerts drops far-future stamps but tolerates small clock skew', () => {
  // NOW is 2026-07-30T20:00:00Z. A future-stamped alert would sort to the top
  // and render "in 3 hours"; a few minutes of drift between this host and SWPC
  // is normal and must NOT drop the newest alerts.
  const far = parseAlerts([{ issue_datetime: '2026-07-30 23:00:00.000', message: swpcMessage('ALERT: from the future') }], NOW);
  assert.deepEqual(far, [], 'three hours ahead is corrupt, not skew');

  const skewed = parseAlerts([{ issue_datetime: '2026-07-30 20:02:00.000', message: swpcMessage('ALERT: two minutes ahead') }], NOW);
  assert.equal(skewed.length, 1, 'a slow local clock must not hide brand-new alerts');
});

test('parseAlerts caps the returned list', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({
    issue_datetime: `2026-07-30 1${String(i % 10)}:00:00.000`,
    message: swpcMessage(`ALERT: burst ${i}`),
  }));
  assert.equal(parseAlerts(many, NOW).length, 20);
  assert.equal(parseAlerts(many, NOW, 24 * 60 * 60 * 1000, 5).length, 5);
});

// ── Regression guard on the original defect ───────────────────────────────

test('the whole feeds OBJECT parses to nothing — the shape the route actually returns', () => {
  // Passing the envelope where a product was expected is precisely the old bug:
  // every parser must fail closed to null/[] rather than invent a reading.
  const envelope = { kp: SWPC_KP_LIVE_SHAPE, wind: SWPC_WIND_LIVE_SHAPE, xray: SWPC_XRAY_LIVE_SHAPE, alerts: [] };
  assert.equal(parseKpFeed(envelope), null);
  assert.equal(parseXrayClass(envelope), null);
  assert.deepEqual(parseSolarWindFeed(envelope), { speed: null, density: null, bz: null, observedAt: null });
  assert.deepEqual(parseAlerts(envelope, NOW), []);
});

test('destructuring the envelope yields every field the panel shows', () => {
  const envelope = {
    kp: SWPC_KP_LIVE_SHAPE,
    wind: SWPC_WIND_LIVE_SHAPE,
    xray: SWPC_XRAY_LIVE_SHAPE,
    alerts: [{ issue_datetime: ALERT_AT, message: swpcMessage('ALERT: Proton Event 10meV Integral Flux exceeded 10pfu') }],
  };
  assert.equal(parseKpFeed(envelope.kp), 1);
  assert.equal(parseSolarWindFeed(envelope.wind).bz, 3.22);
  assert.equal(parseSolarWindFeed(envelope.wind).speed, 321.6);
  assert.equal(parseSolarWindFeed(envelope.wind).density, 2.75);
  assert.equal(parseXrayClass(envelope.xray), 'M1.9');
  assert.equal(parseAlerts(envelope.alerts, NOW).length, 1);
});
