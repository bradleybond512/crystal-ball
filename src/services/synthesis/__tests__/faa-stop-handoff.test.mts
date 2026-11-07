import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../../../../api/aviation/delays.js';
import { normalizeDelays } from '../../aviation/aviation-intel-normalize.ts';
import { faaReceipt } from '../transport-evidence.ts';

// Fields and time window observed at /api/airport-events on Nov 3 UTC.
const sampled = Date.parse('2026-11-03T03:29:58Z');
const stop = { airportId: 'FLL', startTime: '2026-11-03T02:02:00Z', endTime: '2026-11-03T03:30:00Z', programExpirationTime: '2026-11-03T03:30:00Z', impactingCondition: 'thunderstorms' };
const row = { airportId: 'FLL', groundStop: stop };

test('the production FAA handler carries a live-shaped nested stop through acquisition to its dashboard expiry', async (t) => {
  t.mock.method(Date, 'now', () => sampled);
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls.push(url);
    return url.endsWith('airport-events') ? Response.json([row, { airportId: 'DAL', groundStop: null }]) : new Response('', { status: 404 });
  });
  const response = await handler(new Request('http://localhost/api/aviation/delays'));
  const body = await response.json();
  assert.equal(calls.length, 2);
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].airport, 'FLL');
  assert.equal(body.data[0].reason, 'thunderstorms');
  assert.equal(body.data[0].startedAt, Date.parse(stop.startTime));
  const receipt = faaReceipt(body, sampled);
  assert.ok(receipt);
  assert.equal(receipt.evaluate(sampled).topAlert, 'FLL ground stop');
  assert.equal(receipt.evaluate(Date.parse(stop.endTime)).level, 'NONE');
  assert.deepEqual(normalizeDelays([row]).map(({ airport, programType, endsAt }) => ({ airport, programType, endsAt })), [{ airport: 'FLL', programType: 'ground_stop', endsAt: Date.parse(stop.endTime) }]);
});

test('nested stops reject malformed, mismatched or unordered windows and use the earlier program expiry', () => {
  for (const groundStop of [true, {}, { ...stop, airportId: 'LAX' }, { ...stop, startTime: null }, { ...stop, startTime: '2026-02-31T01:00:00Z' }, { ...stop, endTime: 'invalid' }, { ...stop, programExpirationTime: 'invalid' }, { ...stop, endTime: '2026-11-03T01:00:00Z' }]) {
    assert.deepEqual(normalizeDelays([{ ...row, groundStop }]), []);
  }
  assert.equal(normalizeDelays([{ ...row, groundStop: { ...stop, programExpirationTime: '2026-11-03T03:00:00Z' } }])[0]?.endsAt, Date.parse('2026-11-03T03:00:00Z'));
  assert.equal(normalizeDelays([{ airport: 'FLL', eventType: 'GROUND STOP CANCELLED' }])[0]?.programType === 'ground_stop', false);
});

const delayRequest = () => new Request('http://localhost/api/aviation/delays');
const legacyStop = { airport: 'FLL', eventType: 'GROUND STOP' };

test('malformed primary 200 falls through to a usable secondary FAA response', async (t) => {
  t.mock.method(Date, 'now', () => sampled + 600_000);
  const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    urls.push(url);
    return Response.json(url.endsWith('airport-conditions') ? { wrongSchema: true } : [legacyStop]);
  });
  const body = await (await handler(delayRequest())).json();
  assert.equal(body.data[0]?.programType, 'ground_stop');
  assert.equal(body.degraded, false);
  assert.equal(urls.length, 2);
});

test('unusable, failed and mixed FAA responses retry immediately without discarding valid stops', async t => {
  const at = sampled + 1_200_000;
  t.mock.method(Date, 'now', () => at);
  const responses = [
    Response.json([{ bad: true }]), Response.json({ malformed: true }),
    new Response('', { status: 429 }), new Response('', { status: 503 }),
    Response.json([legacyStop, { ...row, groundStop: {} }]),
    Response.json([legacyStop]),
  ];
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => responses[calls++]);
  for (const _ of [0, 1]) {
    const missing = await (await handler(delayRequest())).json();
    assert.equal(missing.degraded, true);
    assert.deepEqual(missing.data, []);
    assert.equal(faaReceipt(missing, at), null);
  }
  const mixed = await (await handler(delayRequest())).json();
  assert.equal(mixed.degraded, true);
  assert.equal(mixed.data.length, 1);
  assert.equal(faaReceipt(mixed, at)?.evaluate(at).topAlert, 'FLL ground stop');
  const resumed = await (await handler(delayRequest())).json();
  assert.equal(resumed.degraded, false);
  assert.equal(resumed.data.length, 1);
  assert.equal(calls, 6);
});

test('recognized empty collection and explicit null ground-stop rows remain valid FAA responses', async t => {
  let at = sampled + 1_800_000;
  t.mock.method(Date, 'now', () => at);
  const responses = [[], [{ airportId: 'FLL', groundStop: null }], [{ airport: 'FLL', eventType: 'GROUND DELAY' }]];
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => Response.json(responses[calls++]));
  for (const count of [0, 0, 1]) {
    const body = await (await handler(delayRequest())).json();
    assert.equal(body.degraded, false);
    assert.equal(body.data.length, count);
    assert.equal(faaReceipt(body, at), null);
    at += 600_000;
  }
  assert.equal(calls, 3);
});
