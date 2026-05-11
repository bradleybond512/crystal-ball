/**
 * Route-level coverage for api/acled/events.js
 *
 * Verifies env-var gate, ACLED row → HistoricalEvent mapping, intensity
 * bucket boundaries (fatality-driven, type-fallback), success:false
 * handling (ACLED returns 200 on auth failure), and HTTP contract.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invokeHandler, mockFetch } from './_test-utils.mjs';

const mod = await import('../acled/events.js');
const handler = mod.default;
const { toHistoricalEvent, intensityFromAcled, __resetCacheForTests } = mod;

const acledRow = (overrides = {}) => ({
  event_id_cnty: 'TEST123',
  event_date: '2026-05-01',
  event_type: 'Battles',
  sub_event_type: 'Armed clash',
  actor1: 'Group A',
  actor2: 'Group B',
  country: 'Sudan',
  admin1: 'Khartoum',
  location: 'Omdurman',
  latitude: 15.6,
  longitude: 32.5,
  fatalities: '12',
  notes: 'Fighting reported in northern districts.',
  ...overrides,
});

// ── pure mapper ─────────────────────────────────────────────────────

test('toHistoricalEvent: maps a typical ACLED row', () => {
  const ev = toHistoricalEvent(acledRow());
  assert.equal(ev.id, 'acled-TEST123');
  assert.equal(ev.date, '2026-05-01T00:00:00Z');
  assert.equal(ev.eventType, 'Armed clash');         // sub_event_type wins
  assert.equal(ev.country, 'Sudan');
  assert.equal(ev.location, 'Omdurman, Khartoum, Sudan');
  assert.deepEqual(ev.actors, ['Group A', 'Group B']);
  assert.equal(ev.intensity, 'high');                // 12 fatalities → high
  assert.equal(ev.source, 'acled');
});

test('toHistoricalEvent: drops rows missing id or date', () => {
  assert.equal(toHistoricalEvent(acledRow({ event_id_cnty: null })), null);
  assert.equal(toHistoricalEvent(acledRow({ event_date: null })), null);
});

test('toHistoricalEvent: filters empty actors', () => {
  const ev = toHistoricalEvent(acledRow({ actor1: '', actor2: 'Solo Actor' }));
  assert.deepEqual(ev.actors, ['Solo Actor']);
});

test('toHistoricalEvent: falls back to event_type when sub_event_type is empty', () => {
  const ev = toHistoricalEvent(acledRow({ sub_event_type: '' }));
  assert.equal(ev.eventType, 'Battles');
});

test('toHistoricalEvent: handles non-object input safely', () => {
  assert.equal(toHistoricalEvent(null), null);
  assert.equal(toHistoricalEvent('not an object'), null);
});

// ── intensity bucket ────────────────────────────────────────────────

test('intensityFromAcled: fatalities dominate type', () => {
  assert.equal(intensityFromAcled('Protests', 100), 'critical');
  assert.equal(intensityFromAcled('Protests', 25), 'high');
  assert.equal(intensityFromAcled('Protests', 5), 'medium');
  assert.equal(intensityFromAcled('Protests', 0), 'low');
});

test('intensityFromAcled: zero-fatality rows fall back to type', () => {
  assert.equal(intensityFromAcled('Battles', 0), 'high');
  assert.equal(intensityFromAcled('Violence against civilians', 0), 'medium');
  assert.equal(intensityFromAcled('Explosions/Remote violence', 0), 'medium');
  assert.equal(intensityFromAcled('Strategic developments', 0), 'low');
  assert.equal(intensityFromAcled('Riots', 0), 'low');
  assert.equal(intensityFromAcled('UnknownType', 0), 'low');
});

// ── handler: HTTP contract ──────────────────────────────────────────

test('handler: OPTIONS returns 204', async () => {
  const { res } = await invokeHandler(handler, { method: 'OPTIONS' });
  assert.equal(res.statusCode, 204);
});

test('handler: rejects non-GET methods', async () => {
  const { res } = await invokeHandler(handler, { method: 'POST' });
  assert.equal(res.statusCode, 405);
});

test('handler: missing ACLED_ACCESS_TOKEN → degraded payload', async () => {
  __resetCacheForTests();
  const prevKey = process.env.ACLED_ACCESS_TOKEN;
  const prevEmail = process.env.ACLED_EMAIL;
  delete process.env.ACLED_ACCESS_TOKEN;
  delete process.env.ACLED_EMAIL;
  try {
    const { res } = await invokeHandler(handler, {});
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.degraded, true);
    assert.match(res.body.reason, /ACLED_ACCESS_TOKEN.*ACLED_EMAIL/);
  } finally {
    if (prevKey) process.env.ACLED_ACCESS_TOKEN = prevKey;
    if (prevEmail) process.env.ACLED_EMAIL = prevEmail;
  }
});

test('handler: ACLED success:false (auth/quota) → degraded payload', async () => {
  __resetCacheForTests();
  process.env.ACLED_ACCESS_TOKEN = 'fake-key';
  process.env.ACLED_EMAIL = 'tester@example.com';
  const restore = mockFetch(new Map([
    ['acleddata.com', { status: 200, json: { success: false, error: { message: 'Invalid API credentials' } } }],
  ]));
  try {
    const { res } = await invokeHandler(handler, {});
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.degraded, true);
    assert.match(res.body.reason, /Invalid API credentials/);
  } finally {
    restore();
    delete process.env.ACLED_ACCESS_TOKEN;
    delete process.env.ACLED_EMAIL;
  }
});

test('handler: happy path → events array with source acled', async () => {
  __resetCacheForTests();
  process.env.ACLED_ACCESS_TOKEN = 'fake-key';
  process.env.ACLED_EMAIL = 'tester@example.com';
  const mockPayload = {
    success: true,
    data: [acledRow(), acledRow({ event_id_cnty: 'TEST124', fatalities: '0', event_type: 'Protests' })],
  };
  const restore = mockFetch(new Map([['acleddata.com', { status: 200, json: mockPayload }]]));
  try {
    const { res } = await invokeHandler(handler, {});
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.events.length, 2);
    assert.equal(res.body.source, 'acled');
    assert.equal(res.body.events[0].id, 'acled-TEST123');
    assert.equal(res.body.events[1].intensity, 'low');     // protests, 0 fatalities
    assert.ok(res.body.window.since.match(/^\d{4}-\d{2}-\d{2}$/));
    assert.equal(res.body.window.days, 30);
  } finally {
    restore();
    delete process.env.ACLED_ACCESS_TOKEN;
    delete process.env.ACLED_EMAIL;
  }
});

test('handler: ACLED 503 → degraded (200 contract preserved)', async () => {
  __resetCacheForTests();
  process.env.ACLED_ACCESS_TOKEN = 'fake-key';
  process.env.ACLED_EMAIL = 'tester@example.com';
  const restore = mockFetch(new Map([['acleddata.com', { status: 503, json: {} }]]));
  try {
    const { res } = await invokeHandler(handler, {});
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.degraded, true);
    assert.match(res.body.reason, /HTTP 503/);
  } finally {
    restore();
    delete process.env.ACLED_ACCESS_TOKEN;
    delete process.env.ACLED_EMAIL;
  }
});
