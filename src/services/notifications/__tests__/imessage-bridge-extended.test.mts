import assert from 'node:assert/strict';
import test from 'node:test';
import {
  routeAlertToImessage,
  parseImessageThreatTypeList,
  DEFAULT_IMESSAGE_THREAT_TYPES,
  type ImessageExtendedSettings,
  type ImessageThreatType,
} from '../imessage-bridge-extended.ts';
import type { NotificationPayload } from '../push-notifier.ts';

const settings = (overrides: Partial<ImessageExtendedSettings> = {}): ImessageExtendedSettings => ({
  enabled: true,
  recipient: '+15555550199',
  threatTypes: ['seismic_tier5'],
  ...overrides,
});

const seismic = (tier: 'tier3' | 'tier4' | 'tier5', overrides: Partial<NotificationPayload> = {}): NotificationPayload => ({
  title: `Crystal Ball — M7.2 earthquake`,
  body: 'M7.2 near Anchorage',
  sound: 'Basso',
  threatType: `seismic_${tier}` as ImessageThreatType,
  threatLevel: tier === 'tier5' ? 'critical' : 'high',
  dedupeKey: `seismic:${tier}`,
  meta: { magnitude: 7.2, place: 'Anchorage', tier: tier === 'tier5' ? 'TIER_5' : tier === 'tier4' ? 'TIER_4' : 'TIER_3' },
  ...overrides,
});

// ── Default whitelist ────────────────────────────────────────────────────────

test('DEFAULT_IMESSAGE_THREAT_TYPES is exactly seismic_tier5 (preserves legacy behavior)', () => {
  assert.deepEqual([...DEFAULT_IMESSAGE_THREAT_TYPES], ['seismic_tier5']);
});

// ── Whitelist gating ─────────────────────────────────────────────────────────

test('routeAlertToImessage: default settings (tier5 only) skips tier3', () => {
  const result = routeAlertToImessage(seismic('tier3'), settings());
  assert.equal(result.send, false);
  assert.equal(result.reason, 'threat-type-not-in-whitelist');
});

test('routeAlertToImessage: default settings sends for tier5', () => {
  const result = routeAlertToImessage(seismic('tier5'), settings());
  assert.equal(result.send, true);
  assert.match(result.body ?? '', /M7\.2/);
});

test('routeAlertToImessage: extended whitelist sends for tier3', () => {
  const result = routeAlertToImessage(seismic('tier3'), settings({ threatTypes: ['seismic_tier3', 'seismic_tier5'] }));
  assert.equal(result.send, true);
});

test('routeAlertToImessage: empty whitelist sends nothing', () => {
  const result = routeAlertToImessage(seismic('tier5'), settings({ threatTypes: [] }));
  assert.equal(result.send, false);
});

test('routeAlertToImessage: globally disabled blocks everything', () => {
  const result = routeAlertToImessage(seismic('tier5'), settings({ enabled: false, threatTypes: ['seismic_tier5'] }));
  assert.equal(result.send, false);
  assert.equal(result.reason, 'disabled');
});

test('routeAlertToImessage: missing recipient blocks everything', () => {
  const result = routeAlertToImessage(seismic('tier5'), settings({ recipient: '' }));
  assert.equal(result.send, false);
  assert.equal(result.reason, 'missing-recipient');
});

// ── Body templates per threatType ────────────────────────────────────────────

test('routeAlertToImessage: seismic body includes magnitude and place', () => {
  const result = routeAlertToImessage(seismic('tier5'), settings());
  assert.match(result.body ?? '', /Crystal Ball/);
  assert.match(result.body ?? '', /M7\.2/);
  assert.match(result.body ?? '', /Anchorage/);
});

test('routeAlertToImessage: geomagnetic Kp 9 (G5) sends and body shows G5', () => {
  const payload: NotificationPayload = {
    title: 'Crystal Ball — Geomagnetic G5',
    body: 'unused',
    sound: 'Basso',
    threatType: 'geomagnetic_g4',
    threatLevel: 'critical',
    dedupeKey: 'geomag:G5',
    meta: { kpIndex: 9 },
  };
  const result = routeAlertToImessage(payload, settings({ threatTypes: ['geomagnetic_g4'] }));
  assert.equal(result.send, true);
  assert.match(result.body ?? '', /G5/);
  assert.match(result.body ?? '', /Kp 9/);
});

test('routeAlertToImessage: geomagnetic Kp 8 (G4) push-only — no iMessage', () => {
  const payload: NotificationPayload = {
    title: 'Crystal Ball — Geomagnetic G4',
    body: 'unused',
    sound: 'Sosumi',
    threatType: 'geomagnetic_g4',
    threatLevel: 'high',
    dedupeKey: 'geomag:G4',
    meta: { kpIndex: 8 },
  };
  const result = routeAlertToImessage(payload, settings({ threatTypes: ['geomagnetic_g4'] }));
  assert.equal(result.send, false);
  assert.equal(result.reason, 'geomagnetic-below-kp9');
});

test('routeAlertToImessage: wildfire body includes name, state, containment', () => {
  const payload: NotificationPayload = {
    title: 'Crystal Ball — Wildfire Park Fire',
    body: 'unused',
    sound: 'Sosumi',
    threatType: 'wildfire_extreme',
    threatLevel: 'high',
    dedupeKey: 'wildfire:Park Fire:CA',
    meta: { name: 'Park Fire', state: 'CA', containment: 5, acres: 50_000 },
  };
  const result = routeAlertToImessage(payload, settings({ threatTypes: ['wildfire_extreme'] }));
  assert.equal(result.send, true);
  assert.match(result.body ?? '', /Park Fire/);
  assert.match(result.body ?? '', /CA/);
  assert.match(result.body ?? '', /5%/);
});

// ── Tornado-warning iMessage gate ────────────────────────────────────────────

test('routeAlertToImessage: cap_extreme Tornado Warning sends with shelter body', () => {
  const payload: NotificationPayload = {
    title: 'Crystal Ball — Tornado Warning',
    body: 'unused',
    sound: 'Basso',
    threatType: 'cap_extreme',
    threatLevel: 'critical',
    dedupeKey: 'cap:tor1',
    meta: { event: 'Tornado Warning', areaDesc: 'La Porte, IN', severity: 'Extreme', urgency: 'Immediate' },
  };
  const result = routeAlertToImessage(payload, settings({ threatTypes: ['cap_extreme'] }));
  assert.equal(result.send, true);
  assert.match(result.body ?? '', /Tornado Warning/);
  assert.match(result.body ?? '', /La Porte/);
  assert.match(result.body ?? '', /shelter/i);
});

test('routeAlertToImessage: cap_extreme Hurricane Warning skipped — not tornado', () => {
  const payload: NotificationPayload = {
    title: 'Crystal Ball — Hurricane Warning',
    body: 'unused',
    sound: 'Basso',
    threatType: 'cap_extreme',
    threatLevel: 'critical',
    dedupeKey: 'cap:hur1',
    meta: { event: 'Hurricane Warning', areaDesc: 'Miami', severity: 'Extreme', urgency: 'Immediate' },
  };
  const result = routeAlertToImessage(payload, settings({ threatTypes: ['cap_extreme'] }));
  assert.equal(result.send, false);
  assert.equal(result.reason, 'cap-extreme-not-tornado');
});

test('routeAlertToImessage: solar_flare_x sends with X-class body', () => {
  const payload: NotificationPayload = {
    title: 'Crystal Ball — X2.7 Solar Flare',
    body: 'unused',
    sound: 'Sosumi',
    threatType: 'solar_flare_x',
    threatLevel: 'high',
    dedupeKey: 'flare:X2.7',
    meta: { peakClass: 'X', peakLabel: 'X2.7' },
  };
  const result = routeAlertToImessage(payload, settings({ threatTypes: ['solar_flare_x'] }));
  assert.equal(result.send, true);
  assert.match(result.body ?? '', /X2\.7/);
});

test('routeAlertToImessage: cap_severe is not in iMessage whitelist', () => {
  const payload: NotificationPayload = {
    title: 'Crystal Ball — Severe Thunderstorm Warning',
    body: 'unused',
    sound: 'Sosumi',
    threatType: 'cap_severe',
    threatLevel: 'high',
    dedupeKey: 'cap:sev1',
    meta: { event: 'Severe Thunderstorm Warning' },
  };
  const result = routeAlertToImessage(payload, settings({ threatTypes: ['cap_extreme'] }));
  assert.equal(result.send, false);
  assert.equal(result.reason, 'threat-type-not-eligible');
});

test('routeAlertToImessage: hurricane body includes name, category, projected landfall', () => {
  const payload: NotificationPayload = {
    title: 'Crystal Ball — Hurricane Ida Cat 4',
    body: 'unused',
    sound: 'Basso',
    threatType: 'hurricane_cat3',
    threatLevel: 'critical',
    dedupeKey: 'hurricane:Ida:4',
    meta: { name: 'Ida', category: 4, projectedLandfall: '2026-05-09T12:00:00Z' },
  };
  const result = routeAlertToImessage(payload, settings({ threatTypes: ['hurricane_cat3'] }));
  assert.equal(result.send, true);
  assert.match(result.body ?? '', /Ida/);
  assert.match(result.body ?? '', /Cat 4/);
  assert.match(result.body ?? '', /2026-05-09/);
});

test('routeAlertToImessage: falls back to push title when meta is missing', () => {
  const result = routeAlertToImessage(
    { ...seismic('tier5'), meta: undefined },
    settings(),
  );
  assert.equal(result.send, true);
  // Falls back to the push title since meta is gone
  assert.match(result.body ?? '', /Crystal Ball/);
});

// ── parseImessageThreatTypeList ──────────────────────────────────────────────

test('parseImessageThreatTypeList: comma-separated string', () => {
  const result = parseImessageThreatTypeList('seismic_tier3, seismic_tier5, geomagnetic_g4');
  assert.deepEqual(result, ['seismic_tier3', 'seismic_tier5', 'geomagnetic_g4']);
});

test('parseImessageThreatTypeList: drops unknown values', () => {
  const result = parseImessageThreatTypeList('seismic_tier5,bogus,wildfire_extreme');
  assert.deepEqual(result, ['seismic_tier5', 'wildfire_extreme']);
});

test('parseImessageThreatTypeList: empty / null returns default whitelist', () => {
  assert.deepEqual(parseImessageThreatTypeList(''), [...DEFAULT_IMESSAGE_THREAT_TYPES]);
  assert.deepEqual(parseImessageThreatTypeList(null), [...DEFAULT_IMESSAGE_THREAT_TYPES]);
  assert.deepEqual(parseImessageThreatTypeList(undefined), [...DEFAULT_IMESSAGE_THREAT_TYPES]);
});

test('parseImessageThreatTypeList: tolerates whitespace + casing', () => {
  const result = parseImessageThreatTypeList('  Seismic_Tier5  ,  WILDFIRE_EXTREME  ');
  assert.deepEqual(result, ['seismic_tier5', 'wildfire_extreme']);
});
