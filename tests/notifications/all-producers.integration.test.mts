/**
 * Notification all-producers integration test suite.
 *
 * Covers every domain producer wired into `decideNotification` +
 * `firePushForEvent`, plus the settings-driven gate (`shouldNotify`)
 * for threshold / quiet-hours / domain-mute / master-mute. Each producer
 * is exercised with a threshold-crossing event, a below-threshold event,
 * and the relevant metadata assertions (severity / dedupe key / coords).
 *
 * Pure — no DOM, no network, no real Tauri invokes. Dispatch uses an
 * injected `send` and `recordHistory: false` so the in-memory history
 * ring stays clean between tests.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decideNotification,
  firePushForEvent,
  type NotifiableEvent,
  type NotificationPayload,
} from '../../src/services/notifications/push-notifier.ts';
import { createNotificationLedger } from '../../src/services/notifications/notification-ledger.ts';
import type { ThresholdConfig } from '../../src/services/config/alert-thresholds.ts';
import {
  resetSettings,
  updateDomainSettings,
  updateGlobalSettings,
  shouldNotify,
} from '../../src/services/notifications/notification-settings-service.ts';
import {
  createProducerRegistry,
  type ProducerRegistration,
} from '../../src/services/notifications/notification-producer-registry.ts';

// ── Fixtures ─────────────────────────────────────────────────────────────

const PERMISSIVE: ThresholdConfig = {
  seismic: { pushMinMagnitude: 5, voiceMinMagnitude: 7 },
  geomagnetic: { pushMinKp: 7, voiceMinKp: 8 },
  wildfire: { pushMinFRP: 100, radiusKm: 50 },
  airQuality: { pushMinAQI: 150 },
  economic: { pushMinVIX: 30, ofrFsiSigmas: 2 },
  hurricane: { pushMinCategory: 3 },
};

function captureSend(): { fn: (payload: NotificationPayload) => Promise<void>; calls: NotificationPayload[] } {
  const calls: NotificationPayload[] = [];
  return {
    calls,
    fn: async (payload) => { calls.push(payload); },
  };
}

// ── 1. Seismic producer (5 tests) ────────────────────────────────────────

test('producer:seismic — M6.5 fires with tier3 + high level', () => {
  const d = decideNotification({ kind: 'seismic', magnitude: 6.5, place: 'Tokyo' }, { thresholds: PERMISSIVE });
  assert.equal(d.shouldFire, true);
  assert.equal(d.payload?.threatType, 'seismic_tier3');
  assert.equal(d.payload?.threatLevel, 'high');
});

test('producer:seismic — M4.9 below pushMinMagnitude=5 suppresses', () => {
  const d = decideNotification({ kind: 'seismic', magnitude: 4.9, place: 'Test' }, { thresholds: PERMISSIVE });
  assert.equal(d.shouldFire, false);
  assert.equal(d.reason, 'magnitude-below-threshold');
});

test('producer:seismic — payload includes coordinates in meta when provided', () => {
  const d = decideNotification({ kind: 'seismic', magnitude: 7.1, place: 'Pacific', lat: 35.5, lon: 140.0 });
  assert.equal(d.payload?.meta?.lat, 35.5);
  assert.equal(d.payload?.meta?.lon, 140.0);
});

test('producer:seismic — dedupe key uses eventId when supplied', () => {
  const d = decideNotification({ kind: 'seismic', magnitude: 6.0, place: 'X', eventId: 'us7000abcd' });
  assert.equal(d.payload?.dedupeKey, 'seismic:us7000abcd');
});

test('producer:seismic — M8.5 (TIER_5) escalates to critical', () => {
  const d = decideNotification({ kind: 'seismic', magnitude: 8.5, place: 'Y' });
  assert.equal(d.payload?.threatLevel, 'critical');
  assert.equal(d.payload?.threatType, 'seismic_tier5');
});

// ── 2. Geomagnetic producer (4 tests) ────────────────────────────────────

test('producer:geomagnetic — Kp 7 (G3) fires medium', () => {
  const d = decideNotification({ kind: 'geomagnetic', kpIndex: 7 });
  assert.equal(d.shouldFire, true);
  assert.equal(d.payload?.threatLevel, 'medium');
});

test('producer:geomagnetic — Kp 8 (G4) fires high', () => {
  const d = decideNotification({ kind: 'geomagnetic', kpIndex: 8 });
  assert.equal(d.payload?.threatLevel, 'high');
  assert.equal(d.payload?.threatType, 'geomagnetic_g4');
});

test('producer:geomagnetic — Kp 9 (G5) fires critical', () => {
  const d = decideNotification({ kind: 'geomagnetic', kpIndex: 9 });
  assert.equal(d.payload?.threatLevel, 'critical');
});

test('producer:geomagnetic — Kp 6 below pushMinKp=7 suppresses', () => {
  const d = decideNotification({ kind: 'geomagnetic', kpIndex: 6 });
  assert.equal(d.shouldFire, false);
  assert.equal(d.reason, 'kp-below-threshold');
});

// ── 3. Solar flare producer (3 tests) ────────────────────────────────────

test('producer:solar_flare — X-class fires high', () => {
  const d = decideNotification({ kind: 'solar_flare', peakClass: 'X', peakLabel: 'X2.7' });
  assert.equal(d.shouldFire, true);
  assert.equal(d.payload?.threatLevel, 'high');
  assert.equal(d.payload?.threatType, 'solar_flare_x');
});

test('producer:solar_flare — M-class suppresses (covered by geomagnetic ladder)', () => {
  const d = decideNotification({ kind: 'solar_flare', peakClass: 'M', peakLabel: 'M5.4' });
  assert.equal(d.shouldFire, false);
  assert.equal(d.reason, 'kp-below-threshold');
});

test('producer:solar_flare — body includes peakLabel for context', () => {
  const d = decideNotification({ kind: 'solar_flare', peakClass: 'X', peakLabel: 'X9.0' });
  assert.match(d.payload?.body ?? '', /X9\.0/);
});

// ── 4. CAP (NWS) producer (5 tests) ──────────────────────────────────────

test('producer:cap — Extreme + Immediate fires critical', () => {
  const d = decideNotification({
    kind: 'cap',
    severity: 'Extreme',
    urgency: 'Immediate',
    event: 'Tornado Warning',
    headline: 'Tornado near Town',
    areaDesc: 'County A',
  });
  assert.equal(d.shouldFire, true);
  assert.equal(d.payload?.threatLevel, 'critical');
  assert.equal(d.payload?.threatType, 'cap_extreme');
});

test('producer:cap — Severe + Immediate fires high', () => {
  const d = decideNotification({
    kind: 'cap',
    severity: 'Severe',
    urgency: 'Immediate',
    event: 'Severe Thunderstorm Warning',
    headline: 'Storm',
    areaDesc: 'County B',
  });
  assert.equal(d.shouldFire, true);
  assert.equal(d.payload?.threatLevel, 'high');
});

test('producer:cap — Moderate suppresses (below severe)', () => {
  const d = decideNotification({
    kind: 'cap',
    severity: 'Moderate',
    urgency: 'Immediate',
    event: 'Advisory',
    headline: 'x',
    areaDesc: 'y',
  });
  assert.equal(d.shouldFire, false);
});

test('producer:cap — urgency=Future suppresses even if severity=Extreme', () => {
  const d = decideNotification({
    kind: 'cap',
    severity: 'Extreme',
    urgency: 'Future',
    event: 'Watch',
    headline: 'x',
    areaDesc: 'y',
  });
  assert.equal(d.shouldFire, false);
  assert.equal(d.reason, 'cap-not-extreme-immediate');
});

test('producer:cap — dedupe key uses alertId when supplied', () => {
  const d = decideNotification({
    kind: 'cap',
    severity: 'Extreme',
    urgency: 'Immediate',
    event: 'Tornado',
    headline: 'x',
    areaDesc: 'y',
    alertId: 'NWS-IND-12345',
  });
  assert.equal(d.payload?.dedupeKey, 'cap:NWS-IND-12345');
});

// ── 5. Hurricane producer (3 tests) ──────────────────────────────────────

test('producer:hurricane — Cat 3 fires high', () => {
  const d = decideNotification({ kind: 'hurricane', nhcStorm: { name: 'Milton', category: 3 } });
  assert.equal(d.shouldFire, true);
  assert.equal(d.payload?.threatLevel, 'high');
});

test('producer:hurricane — Cat 5 fires critical', () => {
  const d = decideNotification({ kind: 'hurricane', nhcStorm: { name: 'Mega', category: 5 } });
  assert.equal(d.payload?.threatLevel, 'critical');
});

test('producer:hurricane — Cat 2 below pushMinCategory=3 suppresses', () => {
  const d = decideNotification({ kind: 'hurricane', nhcStorm: { name: 'Soft', category: 2 } });
  assert.equal(d.shouldFire, false);
  assert.equal(d.reason, 'hurricane-below-cat3');
});

// ── 6. NIFC Wildfire producer (3 tests) ──────────────────────────────────

test('producer:wildfire — 15k acres + 5% containment fires high', () => {
  const d = decideNotification({
    kind: 'wildfire',
    nifc: { name: 'Sample Fire', state: 'CA', containment: 5, acres: 15_000 },
  });
  assert.equal(d.shouldFire, true);
  assert.equal(d.payload?.threatLevel, 'high');
});

test('producer:wildfire — containment ≥ 10% suppresses', () => {
  const d = decideNotification({
    kind: 'wildfire',
    nifc: { name: 'Tame Fire', state: 'CA', containment: 25, acres: 50_000 },
  });
  assert.equal(d.shouldFire, false);
  assert.equal(d.reason, 'wildfire-containment-above-threshold');
});

test('producer:wildfire — under 10k acres suppresses even with low containment', () => {
  const d = decideNotification({
    kind: 'wildfire',
    nifc: { name: 'Small Fire', state: 'CA', containment: 5, acres: 8_000 },
  });
  assert.equal(d.shouldFire, false);
  assert.equal(d.reason, 'wildfire-below-acre-threshold');
});

// ── 7. FIRMS Wildfire-FRP producer (3 tests) ─────────────────────────────

test('producer:wildfire-frp — 250 MW within radius fires', () => {
  const d = decideNotification({
    kind: 'wildfire-frp',
    frpMw: 250,
    lat: 41.6,
    lon: -86.7,
    distanceKm: 30,
  }, { thresholds: PERMISSIVE });
  assert.equal(d.shouldFire, true);
  assert.equal(d.payload?.meta?.frpMw, 250);
});

test('producer:wildfire-frp — outside radius suppresses', () => {
  const d = decideNotification({
    kind: 'wildfire-frp',
    frpMw: 500,
    lat: 0,
    lon: 0,
    distanceKm: 200,
  }, { thresholds: PERMISSIVE });
  assert.equal(d.shouldFire, false);
  assert.equal(d.reason, 'wildfire-out-of-radius');
});

test('producer:wildfire-frp — below MW threshold suppresses', () => {
  const d = decideNotification({
    kind: 'wildfire-frp',
    frpMw: 50,
    lat: 0,
    lon: 0,
    distanceKm: 10,
  }, { thresholds: PERMISSIVE });
  assert.equal(d.shouldFire, false);
  assert.equal(d.reason, 'wildfire-frp-below-threshold');
});

// ── 8. Air quality producer (3 tests) ────────────────────────────────────

test('producer:air-quality — AQI 220 fires high', () => {
  const d = decideNotification({ kind: 'air-quality', aqi: 220, pollutant: 'pm2_5' }, { thresholds: PERMISSIVE });
  assert.equal(d.shouldFire, true);
  assert.equal(d.payload?.threatLevel, 'high');
});

test('producer:air-quality — AQI 310 escalates to critical', () => {
  const d = decideNotification({ kind: 'air-quality', aqi: 310 }, { thresholds: PERMISSIVE });
  assert.equal(d.payload?.threatLevel, 'critical');
});

test('producer:air-quality — AQI 100 suppresses', () => {
  const d = decideNotification({ kind: 'air-quality', aqi: 100 }, { thresholds: PERMISSIVE });
  assert.equal(d.shouldFire, false);
  assert.equal(d.reason, 'aqi-below-threshold');
});

// ── 9. Market producer (3 tests) ─────────────────────────────────────────

test('producer:market — VIX 35 fires (above pushMinVIX=30)', () => {
  const d = decideNotification({ kind: 'market', vix: 35 }, { thresholds: PERMISSIVE });
  assert.equal(d.shouldFire, true);
  assert.equal(d.payload?.threatLevel, 'high');
});

test('producer:market — OFR FSI ≥ 2σ fires even when VIX low', () => {
  const d = decideNotification({ kind: 'market', vix: 10, ofrFsiSigmas: 2.5 }, { thresholds: PERMISSIVE });
  assert.equal(d.shouldFire, true);
});

test('producer:market — both metrics below threshold suppresses', () => {
  const d = decideNotification({ kind: 'market', vix: 20, ofrFsiSigmas: 0.5 }, { thresholds: PERMISSIVE });
  assert.equal(d.shouldFire, false);
  assert.equal(d.reason, 'market-below-threshold');
});

// ── 10. Side-effect dispatch (3 tests) ───────────────────────────────────

test('firePushForEvent — fires injected send for above-threshold event', async () => {
  const send = captureSend();
  const result = await firePushForEvent(
    { kind: 'seismic', magnitude: 7.0, place: 'T' },
    { send: send.fn, recordHistory: false },
  );
  assert.equal(result.fired, true);
  assert.equal(send.calls.length, 1);
  assert.match(send.calls[0]!.title, /M7\.0/);
});

test('firePushForEvent — does NOT call send for below-threshold event', async () => {
  const send = captureSend();
  const result = await firePushForEvent(
    { kind: 'seismic', magnitude: 4.0, place: 'T' },
    { send: send.fn, recordHistory: false },
  );
  assert.equal(result.fired, false);
  assert.equal(send.calls.length, 0);
});

test('firePushForEvent — fired event appends to ledger when supplied', async () => {
  const ledger = createNotificationLedger();
  const send = captureSend();
  await firePushForEvent(
    { kind: 'cap', severity: 'Extreme', urgency: 'Immediate', event: 'Tornado', headline: 'x', areaDesc: 'y' },
    { send: send.fn, ledger, recordHistory: false },
  );
  const entries = ledger.list();
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.threatLevel, 'critical');
});

// ── 11. Settings-driven gate (5 tests) ───────────────────────────────────

test('settings:shouldNotify — fires when severity meets domain threshold', () => {
  resetSettings();
  assert.equal(shouldNotify('weather', 'medium'), true);
  assert.equal(shouldNotify('weather', 'high'), true);
});

test('settings:shouldNotify — suppresses below threshold', () => {
  resetSettings();
  assert.equal(shouldNotify('weather', 'low'), false);
});

test('settings:shouldNotify — domain mute suppresses critical', () => {
  resetSettings();
  updateDomainSettings('earthquakes', { enabled: false });
  assert.equal(shouldNotify('earthquakes', 'critical'), false);
});

test('settings:shouldNotify — master mute suppresses every domain', () => {
  resetSettings();
  updateGlobalSettings({ masterMute: true });
  assert.equal(shouldNotify('weather', 'critical'), false);
  assert.equal(shouldNotify('cyber', 'high'), false);
});

test('settings:shouldNotify — quiet hours never suppresses critical', () => {
  resetSettings();
  updateGlobalSettings({ quietHoursStart: '00:00', quietHoursEnd: '23:59' });
  updateDomainSettings('weather', { quietHoursEnabled: true });
  // Critical bypasses quiet hours regardless of time.
  assert.equal(shouldNotify('weather', 'critical'), true);
});

// ── 12. Producer registry pattern (4 tests) ──────────────────────────────

interface FakeSeismic { magnitude: number; place: string }

const seismicProducer: ProducerRegistration<FakeSeismic> = {
  domain: 'earthquakes',
  name: 'Seismic',
  getSeverity: (d) => (d.magnitude >= 7 ? 'critical' : d.magnitude >= 6 ? 'high' : d.magnitude >= 5 ? 'medium' : 'low'),
  formatNotification: (d) => ({
    title: `M${d.magnitude.toFixed(1)}`,
    body: `near ${d.place}`,
    sound: 'Basso',
    dedupeKey: `seismic:${d.magnitude.toFixed(1)}:${d.place}`,
    meta: { magnitude: d.magnitude, place: d.place },
  }),
};

test('registry — shouldFire true when severity meets threshold', () => {
  const reg = createProducerRegistry();
  reg.register(seismicProducer);
  assert.equal(reg.shouldFire('earthquakes', { magnitude: 6.5, place: 'X' }, 'medium'), true);
});

test('registry — shouldFire false when severity below threshold', () => {
  const reg = createProducerRegistry();
  reg.register(seismicProducer);
  assert.equal(reg.shouldFire('earthquakes', { magnitude: 4, place: 'X' }, 'medium'), false);
});

test('registry — fire() invokes send and records history', async () => {
  const reg = createProducerRegistry();
  reg.register(seismicProducer);
  const calls: unknown[] = [];
  const { fired, record } = await reg.fire('earthquakes', { magnitude: 7.5, place: 'P' }, {
    threshold: 'high',
    send: async (p) => { calls.push(p); },
  });
  assert.equal(fired, true);
  assert.equal(calls.length, 1);
  assert.equal(record.severity, 'critical');
  assert.equal(reg.history().length, 1);
});

test('registry — fire() unknown domain returns fired:false and records', async () => {
  const reg = createProducerRegistry();
  const { fired, record } = await reg.fire('does-not-exist', {}, {});
  assert.equal(fired, false);
  assert.equal(record.fired, false);
  assert.equal(reg.history().length, 1);
});

// ── 13. Unknown / edge events (2 tests) ──────────────────────────────────

test('decideNotification — unknown event kind returns unknown-event-kind', () => {
  // Cast through unknown to feed an out-of-union kind to the dispatcher.
  const d = decideNotification({ kind: 'made-up' } as unknown as NotifiableEvent);
  assert.equal(d.shouldFire, false);
  assert.equal(d.reason, 'unknown-event-kind');
});

test('decideNotification — hurricane without nhcStorm yields todo-data-feed-pending', () => {
  const d = decideNotification({ kind: 'hurricane' });
  assert.equal(d.shouldFire, false);
  assert.equal(d.reason, 'todo-data-feed-pending');
});
