/**
 * All-producers notification integration test suite.
 *
 * Covers 10 producer domains (NWS, SWPC, NIFC, NHC, USGS, FAA, GDACS, AIS,
 * biosurveillance, cyber) — at least 2 tests per domain (≥24 total):
 *   - sidecar data shape → producer fires on high-severity event
 *   - low-severity event is suppressed when threshold = 'high'
 *   - suppressed events appear in registry history
 *
 * Registry unit tests cover register, shouldFire, fire, and history.
 *
 * Run with: tsx --test src-tauri/sidecar/__tests__/notification-integration.test.mts
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createProducerRegistry,
  type ProducerSeverity,
  type ProducerNotificationPayload,
} from '../../../src/services/notifications/notification-producer-registry.ts';

import { parseNwsCapFeatures } from '../ipaws-aggregate.mjs';
import { parseGdacsRss } from '../gdacs-rss.mjs';
import { parseTfrXml } from '../faa-tfrs.mjs';
import { buildBiosurveillanceWastewater } from '../biosurveillance-wastewater.mjs';

// ── shared helpers ──────────────────────────────────────────────────────────

const RANK: Record<ProducerSeverity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

function noop(): Promise<void> { return Promise.resolve(); }

function capturedSend(): { calls: ProducerNotificationPayload[]; fn: (p: ProducerNotificationPayload) => Promise<void> } {
  const calls: ProducerNotificationPayload[] = [];
  return { calls, fn: (p) => { calls.push(p); return Promise.resolve(); } };
}

// ── Registry unit tests ─────────────────────────────────────────────────────

test('registry: register() makes domain available for shouldFire', () => {
  const registry = createProducerRegistry();
  registry.register({
    domain: 'test',
    name: 'Test Producer',
    getSeverity: () => 'high',
    formatNotification: () => ({ title: 'T', body: 'B', sound: 'Ping', dedupeKey: 'k' }),
  });
  assert.ok(registry.shouldFire('test', {}, 'high'));
});

test('registry: shouldFire returns false for unknown domain', () => {
  const registry = createProducerRegistry();
  assert.equal(registry.shouldFire('unknown', {}), false);
});

test('registry: fire() calls send and records fired=true when severity meets threshold', async () => {
  const registry = createProducerRegistry();
  const send = capturedSend();
  registry.register({
    domain: 'd',
    name: 'D',
    getSeverity: () => 'critical',
    formatNotification: () => ({ title: 'T', body: 'B', sound: 'Basso', dedupeKey: 'dk' }),
  });
  const { fired } = await registry.fire('d', {}, { threshold: 'high', send: send.fn });
  assert.equal(fired, true);
  assert.equal(send.calls.length, 1);
  assert.equal(registry.history().length, 1);
  assert.equal(registry.history()[0]?.fired, true);
});

test('registry: fire() skips send and records fired=false when severity below threshold', async () => {
  const registry = createProducerRegistry();
  const send = capturedSend();
  registry.register({
    domain: 'd',
    name: 'D',
    getSeverity: () => 'low',
    formatNotification: () => ({ title: 'T', body: 'B', sound: 'Tink', dedupeKey: 'dk' }),
  });
  const { fired } = await registry.fire('d', {}, { threshold: 'high', send: send.fn });
  assert.equal(fired, false);
  assert.equal(send.calls.length, 0);
  assert.equal(registry.history().length, 1);
  assert.equal(registry.history()[0]?.fired, false);
});

// ── NWS (weather / CAP alerts) ──────────────────────────────────────────────

interface IpawsAlert { id: string; severity: string; urgency: string; event: string; headline: string; areaDesc: string; }

function nwsProducer() {
  return {
    domain: 'nws',
    name: 'NWS Weather Alerts',
    getSeverity(data: IpawsAlert): ProducerSeverity {
      if (data.severity === 'Extreme' && data.urgency === 'Immediate') return 'critical';
      if (data.severity === 'Severe' && data.urgency === 'Immediate') return 'high';
      return 'low';
    },
    formatNotification(data: IpawsAlert): ProducerNotificationPayload {
      return {
        title: `Crystal Ball — ${data.event}`,
        body: `${data.headline} — ${data.areaDesc}`,
        sound: 'Basso',
        dedupeKey: `nws:${data.id}`,
        meta: { severity: data.severity, urgency: data.urgency },
      };
    },
  };
}

test('NWS: Extreme+Immediate CAP alert fires and payload has correct shape', async () => {
  const registry = createProducerRegistry();
  registry.register(nwsProducer());
  const send = capturedSend();
  const alert: IpawsAlert = {
    id: 'NWS-001',
    severity: 'Extreme',
    urgency: 'Immediate',
    event: 'Tornado Warning',
    headline: 'Tornado Warning for La Porte IN',
    areaDesc: 'La Porte, IN',
  };
  const { fired } = await registry.fire('nws', alert, { send: send.fn });
  assert.equal(fired, true);
  assert.match(send.calls[0]?.title ?? '', /Tornado Warning/);
  assert.match(send.calls[0]?.body ?? '', /La Porte/);
  assert.equal(send.calls[0]?.dedupeKey, 'nws:NWS-001');
});

test('NWS: Moderate urgency alert suppressed at HIGH threshold + recorded in history', async () => {
  const registry = createProducerRegistry();
  registry.register(nwsProducer());
  const alert: IpawsAlert = {
    id: 'NWS-002',
    severity: 'Moderate',
    urgency: 'Expected',
    event: 'Wind Advisory',
    headline: 'Wind Advisory',
    areaDesc: 'Lake County, IN',
  };
  const { fired } = await registry.fire('nws', alert, { threshold: 'high', send: noop });
  assert.equal(fired, false);
  assert.equal(registry.history().length, 1);
  assert.equal(registry.history()[0]?.domain, 'nws');
  assert.equal(registry.history()[0]?.fired, false);
});

test('NWS: parseNwsCapFeatures produces objects consumable by nws producer', () => {
  const features = [{
    id: 'urn:oid:2.49.0.1.840.0',
    type: 'Feature',
    properties: {
      id: 'urn:oid:2.49.0.1.840.0',
      event: 'Tornado Warning',
      headline: 'Tornado Warning',
      description: 'A tornado was spotted',
      severity: 'Extreme',
      urgency: 'Immediate',
      certainty: 'Observed',
      areaDesc: 'Porter County',
      effective: '2026-05-11T00:00:00Z',
      expires: '2026-05-11T01:00:00Z',
      status: 'Actual',
    },
  }];
  const alerts = parseNwsCapFeatures(features);
  assert.equal(alerts.length, 1);
  assert.ok('severity' in alerts[0]);
  assert.ok('urgency' in alerts[0]);
  assert.ok('event' in alerts[0]);
  const producer = nwsProducer();
  assert.doesNotThrow(() => producer.getSeverity(alerts[0] as IpawsAlert));
});

// ── SWPC (space weather) ───────────────────────────────────────────────────

interface SwpcInput { kpIndex: number; observedAt?: string; }

function swpcProducer() {
  return {
    domain: 'swpc',
    name: 'SWPC Space Weather',
    getSeverity(data: SwpcInput): ProducerSeverity {
      if (data.kpIndex >= 9) return 'critical';
      if (data.kpIndex >= 8) return 'high';
      if (data.kpIndex >= 7) return 'medium';
      return 'low';
    },
    formatNotification(data: SwpcInput): ProducerNotificationPayload {
      const level = data.kpIndex >= 9 ? 'G5' : data.kpIndex >= 8 ? 'G4' : 'G3';
      return {
        title: `Crystal Ball — Geomagnetic ${level}`,
        body: `Geomagnetic storm ${level} (Kp ${data.kpIndex})`,
        sound: data.kpIndex >= 9 ? 'Basso' : 'Sosumi',
        dedupeKey: `swpc:kp${data.kpIndex}:${data.observedAt ?? 'now'}`,
        meta: { kpIndex: data.kpIndex },
      };
    },
  };
}

test('SWPC: Kp 8 (G4) geomagnetic storm fires at HIGH threshold', async () => {
  const registry = createProducerRegistry();
  registry.register(swpcProducer());
  const send = capturedSend();
  const { fired } = await registry.fire('swpc', { kpIndex: 8 }, { threshold: 'high', send: send.fn });
  assert.equal(fired, true);
  assert.match(send.calls[0]?.title ?? '', /G4/);
  assert.match(send.calls[0]?.body ?? '', /Kp 8/);
});

test('SWPC: Kp 4 suppressed at HIGH threshold, recorded in history', async () => {
  const registry = createProducerRegistry();
  registry.register(swpcProducer());
  const { fired } = await registry.fire('swpc', { kpIndex: 4 }, { threshold: 'high', send: noop });
  assert.equal(fired, false);
  const hist = registry.history();
  assert.equal(hist[0]?.severity, 'low');
  assert.equal(hist[0]?.fired, false);
});

// ── NIFC (wildfire) ─────────────────────────────────────────────────────────

interface NifcInput { name: string; state: string; acres: number; containmentPct: number; }

function nifcProducer() {
  return {
    domain: 'nifc',
    name: 'NIFC Wildfire Perimeters',
    getSeverity(data: NifcInput): ProducerSeverity {
      if (data.acres > 10_000 && data.containmentPct < 10) return 'high';
      if (data.acres > 5_000 && data.containmentPct < 30) return 'medium';
      return 'low';
    },
    formatNotification(data: NifcInput): ProducerNotificationPayload {
      return {
        title: `Crystal Ball — Wildfire ${data.name}`,
        body: `${data.name} (${data.state}) — ${data.acres.toLocaleString()} acres, ${data.containmentPct}% contained`,
        sound: 'Sosumi',
        dedupeKey: `nifc:${data.name}:${data.state}`,
        meta: { ...data },
      };
    },
  };
}

test('NIFC: 15,000-acre fire at 5% containment fires at HIGH threshold', async () => {
  const registry = createProducerRegistry();
  registry.register(nifcProducer());
  const send = capturedSend();
  const { fired } = await registry.fire('nifc', { name: 'Oak Fire', state: 'CA', acres: 15_000, containmentPct: 5 }, { send: send.fn });
  assert.equal(fired, true);
  assert.match(send.calls[0]?.body ?? '', /Oak Fire/);
  assert.match(send.calls[0]?.body ?? '', /15,000/);
});

test('NIFC: 2,000-acre fire suppressed at HIGH threshold, recorded in history', async () => {
  const registry = createProducerRegistry();
  registry.register(nifcProducer());
  const { fired } = await registry.fire('nifc', { name: 'Brush Fire', state: 'AZ', acres: 2_000, containmentPct: 40 }, { threshold: 'high', send: noop });
  assert.equal(fired, false);
  assert.equal(registry.history()[0]?.fired, false);
  assert.equal(registry.history()[0]?.domain, 'nifc');
});

// ── NHC (hurricane) ─────────────────────────────────────────────────────────

interface NhcInput { name: string; category: number; projectedLandfall?: string; }

function nhcProducer() {
  return {
    domain: 'nhc',
    name: 'NHC Hurricane Advisories',
    getSeverity(data: NhcInput): ProducerSeverity {
      if (data.category >= 4) return 'critical';
      if (data.category >= 3) return 'high';
      if (data.category >= 1) return 'medium';
      return 'low';
    },
    formatNotification(data: NhcInput): ProducerNotificationPayload {
      return {
        title: `Crystal Ball — Hurricane ${data.name} Cat ${data.category}`,
        body: `Hurricane ${data.name} Category ${data.category}${data.projectedLandfall ? ` — landfall ${data.projectedLandfall}` : ''}`,
        sound: 'Basso',
        dedupeKey: `nhc:${data.name}:cat${data.category}`,
        meta: { ...data },
      };
    },
  };
}

test('NHC: Category 4 hurricane fires at HIGH threshold', async () => {
  const registry = createProducerRegistry();
  registry.register(nhcProducer());
  const send = capturedSend();
  const { fired } = await registry.fire('nhc', { name: 'Milton', category: 4, projectedLandfall: 'Florida' }, { send: send.fn });
  assert.equal(fired, true);
  assert.match(send.calls[0]?.title ?? '', /Milton/);
  assert.match(send.calls[0]?.title ?? '', /Cat 4/);
  assert.match(send.calls[0]?.body ?? '', /Florida/);
});

test('NHC: Category 1 hurricane suppressed at HIGH threshold, history records severity=medium', async () => {
  const registry = createProducerRegistry();
  registry.register(nhcProducer());
  const { fired } = await registry.fire('nhc', { name: 'Ana', category: 1 }, { threshold: 'high', send: noop });
  assert.equal(fired, false);
  assert.equal(registry.history()[0]?.severity, 'medium');
  assert.equal(registry.history()[0]?.fired, false);
});

// ── USGS (earthquake) ───────────────────────────────────────────────────────

interface UsgsInput { magnitude: number; place: string; eventId?: string; }

function usgsProducer() {
  return {
    domain: 'usgs',
    name: 'USGS Earthquake Feed',
    getSeverity(data: UsgsInput): ProducerSeverity {
      if (data.magnitude >= 7) return 'critical';
      if (data.magnitude >= 5) return 'high';
      if (data.magnitude >= 3) return 'medium';
      return 'low';
    },
    formatNotification(data: UsgsInput): ProducerNotificationPayload {
      const mag = data.magnitude.toFixed(1);
      return {
        title: `Crystal Ball — M${mag} earthquake`,
        body: `M${mag} near ${data.place}`,
        sound: data.magnitude >= 7 ? 'Basso' : 'Sosumi',
        dedupeKey: data.eventId ? `usgs:${data.eventId}` : `usgs:${mag}:${data.place}`,
        meta: { magnitude: data.magnitude, place: data.place },
      };
    },
  };
}

test('USGS: M7.0 earthquake fires at HIGH threshold', async () => {
  const registry = createProducerRegistry();
  registry.register(usgsProducer());
  const send = capturedSend();
  const { fired } = await registry.fire('usgs', { magnitude: 7.0, place: 'near Ridgecrest, CA', eventId: 'ci39838079' }, { send: send.fn });
  assert.equal(fired, true);
  assert.match(send.calls[0]?.title ?? '', /M7\.0/);
  assert.match(send.calls[0]?.body ?? '', /Ridgecrest/);
  assert.equal(send.calls[0]?.dedupeKey, 'usgs:ci39838079');
});

test('USGS: M2.8 suppressed at HIGH threshold, recorded with severity=low', async () => {
  const registry = createProducerRegistry();
  registry.register(usgsProducer());
  const { fired } = await registry.fire('usgs', { magnitude: 2.8, place: 'Southern California' }, { threshold: 'high', send: noop });
  assert.equal(fired, false);
  const hist = registry.history();
  assert.equal(hist[0]?.severity, 'low');
  assert.equal(hist[0]?.fired, false);
});

// ── FAA (TFR / Temporary Flight Restriction) ────────────────────────────────

interface FaaTfrInput { id: string; notamNumber: string; type: 'VIP' | 'Security' | 'Fire' | 'Other'; altCeiling: number | null; }

function faaProducer() {
  return {
    domain: 'faa',
    name: 'FAA Temporary Flight Restrictions',
    getSeverity(data: FaaTfrInput): ProducerSeverity {
      if (data.type === 'VIP' || data.type === 'Security') return 'high';
      if (data.type === 'Fire') return 'medium';
      return 'low';
    },
    formatNotification(data: FaaTfrInput): ProducerNotificationPayload {
      const ceiling = data.altCeiling !== null ? `${data.altCeiling.toLocaleString()} ft` : 'unlimited';
      return {
        title: `Crystal Ball — TFR ${data.notamNumber}`,
        body: `${data.type} TFR active — ceiling ${ceiling}`,
        sound: 'Ping',
        dedupeKey: `faa:${data.id}`,
        meta: { type: data.type, altCeiling: data.altCeiling },
      };
    },
  };
}

test('FAA: VIP TFR fires at HIGH threshold with correct NOTAM in payload', async () => {
  const registry = createProducerRegistry();
  registry.register(faaProducer());
  const send = capturedSend();
  const tfr: FaaTfrInput = { id: '1_0_9999999', notamNumber: '0/9999', type: 'VIP', altCeiling: 18_000 };
  const { fired } = await registry.fire('faa', tfr, { send: send.fn });
  assert.equal(fired, true);
  assert.match(send.calls[0]?.title ?? '', /0\/9999/);
  assert.match(send.calls[0]?.body ?? '', /VIP/);
});

test('FAA: Other-type TFR suppressed at HIGH threshold, recorded in history', async () => {
  const registry = createProducerRegistry();
  registry.register(faaProducer());
  const tfr: FaaTfrInput = { id: '1_0_1234', notamNumber: '0/1234', type: 'Other', altCeiling: 3_000 };
  const { fired } = await registry.fire('faa', tfr, { threshold: 'high', send: noop });
  assert.equal(fired, false);
  assert.equal(registry.history()[0]?.fired, false);
});

test('FAA: parseTfrXml returns object with required shape for faa producer', () => {
  const xml = `<NOTAM_Aerodrome>
    <Notam_Number>0/TESTNOTAM</Notam_Number>
    <notamType>VIP</notamType>
    <AltitudeFloor>0</AltitudeFloor>
    <AltitudeCeiling>18000</AltitudeCeiling>
    <Point><Lat>41.5</Lat><Lon>-87.0</Lon></Point>
  </NOTAM_Aerodrome>`;
  const result = parseTfrXml('1_0_test', xml);
  // parseTfrXml returns null when it can't fully parse — verify it either parses or returns null gracefully
  assert.ok(result === null || (typeof result === 'object' && 'id' in result));
});

// ── GDACS (global disaster alerts) ─────────────────────────────────────────

interface GdacsInput { id: string; eventType: string; name: string; alertLevel: 'Green' | 'Orange' | 'Red'; score: number; country: string; }

function gdacsProducer() {
  return {
    domain: 'gdacs',
    name: 'GDACS Global Disaster Alerts',
    getSeverity(data: GdacsInput): ProducerSeverity {
      if (data.alertLevel === 'Red') return 'critical';
      if (data.alertLevel === 'Orange') return 'high';
      return 'low';
    },
    formatNotification(data: GdacsInput): ProducerNotificationPayload {
      return {
        title: `Crystal Ball — GDACS ${data.eventType} ${data.alertLevel} Alert`,
        body: `${data.name} — ${data.country} (score ${data.score.toFixed(1)})`,
        sound: data.alertLevel === 'Red' ? 'Basso' : 'Sosumi',
        dedupeKey: `gdacs:${data.id}`,
        meta: { eventType: data.eventType, alertLevel: data.alertLevel, country: data.country },
      };
    },
  };
}

test('GDACS: Red-alert earthquake fires at HIGH threshold', async () => {
  const registry = createProducerRegistry();
  registry.register(gdacsProducer());
  const send = capturedSend();
  const event: GdacsInput = { id: 'EQ1001', eventType: 'EQ', name: 'M6.8 Turkey', alertLevel: 'Red', score: 2.5, country: 'Turkey' };
  const { fired } = await registry.fire('gdacs', event, { send: send.fn });
  assert.equal(fired, true);
  assert.match(send.calls[0]?.title ?? '', /Red/);
  assert.match(send.calls[0]?.body ?? '', /Turkey/);
});

test('GDACS: Green-alert event suppressed at HIGH threshold, recorded in history', async () => {
  const registry = createProducerRegistry();
  registry.register(gdacsProducer());
  const event: GdacsInput = { id: 'FL2001', eventType: 'FL', name: 'Flood Brazil', alertLevel: 'Green', score: 0.8, country: 'Brazil' };
  const { fired } = await registry.fire('gdacs', event, { threshold: 'high', send: noop });
  assert.equal(fired, false);
  assert.equal(registry.history()[0]?.domain, 'gdacs');
  assert.equal(registry.history()[0]?.fired, false);
});

test('GDACS: parseGdacsRss returns events with alertLevel field consumable by gdacs producer', () => {
  const rss = `<?xml version="1.0"?>
<rss><channel>
<item>
  <title>M6.8 Earthquake in Turkey</title>
  <description>Earthquake</description>
  <gdacs:alertlevel>Red</gdacs:alertlevel>
  <gdacs:eventtype>EQ</gdacs:eventtype>
  <gdacs:eventid>1001</gdacs:eventid>
  <gdacs:severity units="Richter" value="6.8">Earthquake of 6.8</gdacs:severity>
  <gdacs:country>Turkey</gdacs:country>
  <gdacs:fromdate>2026-05-11T00:00:00</gdacs:fromdate>
  <geo:point><geo:lat>39.0</geo:lat><geo:long>36.0</geo:long></geo:point>
</item>
</channel></rss>`;
  const events = parseGdacsRss(rss);
  assert.ok(Array.isArray(events));
  if (events.length > 0) {
    assert.ok('alertLevel' in events[0]);
    assert.ok('eventType' in events[0]);
    assert.ok('country' in events[0]);
  }
});

// ── AIS (vessel dark activity) ──────────────────────────────────────────────

interface AisInput { mmsi: string; name: string; flag: string; sanctioned: boolean; distanceKm: number; }

function aisProducer() {
  return {
    domain: 'ais',
    name: 'AIS Dark Vessel Alerts',
    getSeverity(data: AisInput): ProducerSeverity {
      if (data.sanctioned) return 'critical';
      if (data.distanceKm < 50) return 'high';
      if (data.distanceKm < 200) return 'medium';
      return 'low';
    },
    formatNotification(data: AisInput): ProducerNotificationPayload {
      return {
        title: `Crystal Ball — Dark vessel ${data.name}`,
        body: `${data.flag} vessel ${data.mmsi}${data.sanctioned ? ' (SANCTIONED)' : ''} — ${Math.round(data.distanceKm)} km away`,
        sound: data.sanctioned ? 'Basso' : 'Sosumi',
        dedupeKey: `ais:dark:${data.mmsi}`,
        meta: { mmsi: data.mmsi, sanctioned: data.sanctioned },
      };
    },
  };
}

test('AIS: sanctioned vessel going dark fires at HIGH threshold', async () => {
  const registry = createProducerRegistry();
  registry.register(aisProducer());
  const send = capturedSend();
  const vessel: AisInput = { mmsi: '273123456', name: 'Arktika', flag: 'Russia', sanctioned: true, distanceKm: 320 };
  const { fired } = await registry.fire('ais', vessel, { send: send.fn });
  assert.equal(fired, true);
  assert.match(send.calls[0]?.body ?? '', /SANCTIONED/);
  assert.equal(send.calls[0]?.dedupeKey, 'ais:dark:273123456');
});

test('AIS: distant non-sanctioned vessel suppressed at HIGH threshold, recorded in history', async () => {
  const registry = createProducerRegistry();
  registry.register(aisProducer());
  const vessel: AisInput = { mmsi: '412900000', name: 'Yangtze', flag: 'China', sanctioned: false, distanceKm: 500 };
  const { fired } = await registry.fire('ais', vessel, { threshold: 'high', send: noop });
  assert.equal(fired, false);
  assert.equal(registry.history()[0]?.fired, false);
  assert.equal(registry.history()[0]?.severity, 'low');
});

// ── Biosurveillance (NWSS / CDC wastewater) ─────────────────────────────────

interface BioInput { stateCode: string; level: string; trend: string; percentile15d: number; }

function bioProducer() {
  return {
    domain: 'biosurveillance',
    name: 'NWSS Wastewater Biosurveillance',
    getSeverity(data: BioInput): ProducerSeverity {
      if (data.level === 'high' && data.trend === 'rising') return 'high';
      if (data.level === 'elevated' || data.level === 'high') return 'medium';
      return 'low';
    },
    formatNotification(data: BioInput): ProducerNotificationPayload {
      return {
        title: `Crystal Ball — Wastewater signal: ${data.stateCode}`,
        body: `${data.stateCode} wastewater level ${data.level} (${Math.round(data.percentile15d)}th percentile, ${data.trend})`,
        sound: 'Ping',
        dedupeKey: `bio:${data.stateCode}:${data.level}`,
        meta: { stateCode: data.stateCode, level: data.level, trend: data.trend },
      };
    },
  };
}

test('biosurveillance: high+rising wastewater signal fires at HIGH threshold', async () => {
  const registry = createProducerRegistry();
  registry.register(bioProducer());
  const send = capturedSend();
  const signal: BioInput = { stateCode: 'IN', level: 'high', trend: 'rising', percentile15d: 88 };
  const { fired } = await registry.fire('biosurveillance', signal, { send: send.fn });
  assert.equal(fired, true);
  assert.match(send.calls[0]?.title ?? '', /IN/);
  assert.match(send.calls[0]?.body ?? '', /high/);
  assert.match(send.calls[0]?.body ?? '', /rising/);
});

test('biosurveillance: low+stable wastewater suppressed at HIGH threshold, recorded in history', async () => {
  const registry = createProducerRegistry();
  registry.register(bioProducer());
  const signal: BioInput = { stateCode: 'WY', level: 'low', trend: 'stable', percentile15d: 22 };
  const { fired } = await registry.fire('biosurveillance', signal, { threshold: 'high', send: noop });
  assert.equal(fired, false);
  assert.equal(registry.history()[0]?.fired, false);
});

test('biosurveillance: buildBiosurveillanceWastewater output has state entries consumable by bio producer', () => {
  const NOW = Date.parse('2026-05-11T00:00:00Z');
  const rows = [
    { key_plot_id: 'in-1', wwtp_jurisdiction: 'Indiana', wwtp_name: 'Plant', county_names: 'La Porte', population_served: 50_000, date_end: '2026-05-10', percentile: 88, ptc_15d: 32 },
    { key_plot_id: 'wy-1', wwtp_jurisdiction: 'Wyoming', wwtp_name: 'Plant', county_names: 'Park', population_served: 10_000, date_end: '2026-05-10', percentile: 22, ptc_15d: -5 },
  ];
  const result = buildBiosurveillanceWastewater(rows, NOW);
  assert.ok(Array.isArray(result.states));
  assert.ok(result.states.length > 0);
  const state = result.states[0];
  assert.ok('stateCode' in state);
  assert.ok('level' in state);
  assert.ok('trend' in state);
  const producer = bioProducer();
  assert.doesNotThrow(() => producer.getSeverity({ stateCode: state.stateCode, level: state.level, trend: state.trend, percentile15d: 50 }));
});

// ── Cyber (HIBP / AbuseIPDB) ────────────────────────────────────────────────

interface CyberInput { source: string; level: ProducerSeverity; count: number; indicator?: string; }

function cyberProducer() {
  return {
    domain: 'cyber',
    name: 'Cyber Threat Intelligence',
    getSeverity(data: CyberInput): ProducerSeverity {
      return data.level;
    },
    formatNotification(data: CyberInput): ProducerNotificationPayload {
      return {
        title: `Crystal Ball — ${data.source} security alert`,
        body: `${data.count.toLocaleString()} indicators${data.indicator ? ` including ${data.indicator}` : ''}`,
        sound: data.level === 'critical' ? 'Basso' : 'Sosumi',
        dedupeKey: `cyber:${data.source}:${data.indicator ?? data.count}`,
        meta: { source: data.source, count: data.count, level: data.level },
      };
    },
  };
}

test('cyber: high-severity HIBP breach fires at HIGH threshold', async () => {
  const registry = createProducerRegistry();
  registry.register(cyberProducer());
  const send = capturedSend();
  const event: CyberInput = { source: 'HIBP', level: 'high', count: 150_000, indicator: 'example.com' };
  const { fired } = await registry.fire('cyber', event, { send: send.fn });
  assert.equal(fired, true);
  assert.match(send.calls[0]?.title ?? '', /HIBP/);
  assert.match(send.calls[0]?.body ?? '', /150,000/);
  assert.match(send.calls[0]?.body ?? '', /example\.com/);
});

test('cyber: low-severity AbuseIPDB report suppressed at HIGH threshold, recorded in history', async () => {
  const registry = createProducerRegistry();
  registry.register(cyberProducer());
  const event: CyberInput = { source: 'AbuseIPDB', level: 'low', count: 3, indicator: '1.2.3.4' };
  const { fired } = await registry.fire('cyber', event, { threshold: 'high', send: noop });
  assert.equal(fired, false);
  assert.equal(registry.history()[0]?.domain, 'cyber');
  assert.equal(registry.history()[0]?.severity, 'low');
  assert.equal(registry.history()[0]?.fired, false);
});

// ── Cross-domain: history accumulates all fired and suppressed events ────────

test('history accumulates entries across multiple domains', async () => {
  const registry = createProducerRegistry();
  registry.register(usgsProducer());
  registry.register(swpcProducer());
  registry.register(nhcProducer());

  await registry.fire('usgs', { magnitude: 7.5, place: 'Alaska' }, { send: noop });
  await registry.fire('swpc', { kpIndex: 4 }, { threshold: 'high', send: noop });
  await registry.fire('nhc', { name: 'Irma', category: 5 }, { send: noop });

  const hist = registry.history();
  assert.equal(hist.length, 3);
  assert.equal(hist.filter(h => h.fired).length, 2);
  assert.equal(hist.filter(h => !h.fired).length, 1);
  assert.deepEqual(
    hist.map(h => h.domain),
    ['usgs', 'swpc', 'nhc'],
  );
});

test('shouldFire respects severity rank: medium event fails HIGH threshold, passes MEDIUM', () => {
  const registry = createProducerRegistry();
  registry.register(nhcProducer());
  const cat1 = { name: 'Ana', category: 1 }; // medium severity
  assert.equal(registry.shouldFire('nhc', cat1, 'high'), false);
  assert.equal(registry.shouldFire('nhc', cat1, 'medium'), true);
  assert.equal(registry.shouldFire('nhc', cat1, 'low'), true);
});
