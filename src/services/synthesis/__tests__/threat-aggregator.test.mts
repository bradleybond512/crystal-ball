import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateThreats,
  computeAviationThreat,
  computeBiosurveillanceThreat,
  computeCyberThreat,
  computeEconomicThreat,
  computeGeopoliticalThreat,
  computeInfrastructureThreat,
  computeMaritimeThreat,
  computeSeismicThreat,
  computeSpaceWeatherThreat,
  computeWeatherThreat,
  computeWildfireThreat,
  emptyAggregatedThreats,
  startThreatAggregator,
  ThreatEvidenceStore,
  type ThreatReceipt,
  type ThreatLevelsEventDetail,
} from '../threat-aggregator';

const T0 = 1_700_000_000_000;
const ONE_HOUR = 60 * 60 * 1000;

describe('computeSeismicThreat', () => {
  it('returns NONE when no quakes', () => {
    const out = computeSeismicThreat({ quakes: [], nowMs: T0 });
    assert.equal(out.level, 'NONE');
    assert.equal(out.topAlert, null);
  });

  it('LOW for M<5', () => {
    const out = computeSeismicThreat({
      quakes: [{ magnitude: 4.2, place: 'Aleutians', timeMs: T0 - ONE_HOUR }],
      nowMs: T0,
    });
    assert.equal(out.level, 'LOW');
    assert.match(out.topAlert!, /M4\.2/);
  });

  it('ELEVATED at M5', () => {
    const out = computeSeismicThreat({
      quakes: [{ magnitude: 5, place: 'Fiji', timeMs: T0 }],
      nowMs: T0,
    });
    assert.equal(out.level, 'ELEVATED');
  });

  it('HIGH at M6', () => {
    const out = computeSeismicThreat({
      quakes: [{ magnitude: 6.4, place: 'Tonga', timeMs: T0 }],
      nowMs: T0,
    });
    assert.equal(out.level, 'HIGH');
  });

  it('CRITICAL at M7', () => {
    const out = computeSeismicThreat({
      quakes: [{ magnitude: 7.1, place: 'Solomon Islands', timeMs: T0 }],
      nowMs: T0,
    });
    assert.equal(out.level, 'CRITICAL');
  });

  it('ignores quakes older than the 24h window', () => {
    const out = computeSeismicThreat({
      quakes: [{ magnitude: 7.5, place: 'old', timeMs: T0 - 48 * ONE_HOUR }],
      nowMs: T0,
    });
    assert.equal(out.level, 'NONE');
  });

  it('uses the largest magnitude as the top quake', () => {
    const out = computeSeismicThreat({
      quakes: [
        { magnitude: 4.2, timeMs: T0 - ONE_HOUR },
        { magnitude: 6.4, place: 'Tonga', timeMs: T0 - 2 * ONE_HOUR },
        { magnitude: 5.1, timeMs: T0 - 3 * ONE_HOUR },
      ],
      nowMs: T0,
    });
    assert.equal(out.level, 'HIGH');
    assert.match(out.topAlert!, /M6\.4/);
  });
});

describe('computeSpaceWeatherThreat', () => {
  it('NONE when quiet', () => {
    const out = computeSpaceWeatherThreat({
      kpIndex: 2,
      recentFlareClass: 'C2',
      nowMs: T0,
    });
    assert.equal(out.level, 'NONE');
  });

  it('ELEVATED at Kp5', () => {
    const out = computeSpaceWeatherThreat({
      kpIndex: 5,
      recentFlareClass: null,
      nowMs: T0,
    });
    assert.equal(out.level, 'ELEVATED');
  });

  it('HIGH at Kp7', () => {
    const out = computeSpaceWeatherThreat({
      kpIndex: 7.3,
      recentFlareClass: null,
      nowMs: T0,
    });
    assert.equal(out.level, 'HIGH');
  });

  it('CRITICAL at Kp9', () => {
    const out = computeSpaceWeatherThreat({
      kpIndex: 9,
      recentFlareClass: null,
      nowMs: T0,
    });
    assert.equal(out.level, 'CRITICAL');
  });

  it('CRITICAL on X-flare regardless of Kp', () => {
    const out = computeSpaceWeatherThreat({
      kpIndex: 1,
      recentFlareClass: 'X1.2',
      nowMs: T0,
    });
    assert.equal(out.level, 'CRITICAL');
  });

  it('ELEVATED on M-flare regardless of Kp', () => {
    const out = computeSpaceWeatherThreat({
      kpIndex: 2,
      recentFlareClass: 'M5.4',
      nowMs: T0,
    });
    assert.equal(out.level, 'ELEVATED');
  });

  it('takes the max of Kp and flare', () => {
    const out = computeSpaceWeatherThreat({
      kpIndex: 7,
      recentFlareClass: 'M2',
      nowMs: T0,
    });
    assert.equal(out.level, 'HIGH'); // Kp7 (HIGH) beats M (ELEVATED)
  });
});

describe('computeWildfireThreat', () => {
  it('NONE when no fires', () => {
    assert.equal(
      computeWildfireThreat({ activeFires: [], nowMs: T0 }).level,
      'NONE',
    );
  });

  it('LOW at 4 fires', () => {
    const out = computeWildfireThreat({
      activeFires: Array.from({ length: 4 }, () => ({})),
      nowMs: T0,
    });
    assert.equal(out.level, 'LOW');
  });

  it('ELEVATED at 5 fires', () => {
    const out = computeWildfireThreat({
      activeFires: Array.from({ length: 5 }, () => ({})),
      nowMs: T0,
    });
    assert.equal(out.level, 'ELEVATED');
  });

  it('HIGH at 20+ fires', () => {
    const out = computeWildfireThreat({
      activeFires: Array.from({ length: 23 }, () => ({})),
      nowMs: T0,
    });
    assert.equal(out.level, 'HIGH');
    assert.match(out.topAlert!, /23 active fires/);
  });
});

describe('computeWeatherThreat', () => {
  it('NONE when no alerts', () => {
    assert.equal(
      computeWeatherThreat({ alerts: [], nowMs: T0 }).level,
      'NONE',
    );
  });

  it('CRITICAL on tornado warning', () => {
    const out = computeWeatherThreat({
      alerts: [{ event: 'Tornado Warning', severity: 'Severe', headline: 'Take shelter' }],
      nowMs: T0,
    });
    assert.equal(out.level, 'CRITICAL');
    assert.match(out.topAlert!, /Tornado warning/);
  });

  it('HIGH on Extreme', () => {
    const out = computeWeatherThreat({
      alerts: [{ event: 'Hurricane Warning', severity: 'Extreme' }],
      nowMs: T0,
    });
    assert.equal(out.level, 'HIGH');
  });

  it('ELEVATED on Severe', () => {
    const out = computeWeatherThreat({
      alerts: [{ event: 'Flood Warning', severity: 'Severe' }],
      nowMs: T0,
    });
    assert.equal(out.level, 'ELEVATED');
  });

  it('LOW on Moderate', () => {
    const out = computeWeatherThreat({
      alerts: [{ event: 'Wind Advisory', severity: 'Moderate' }],
      nowMs: T0,
    });
    assert.equal(out.level, 'LOW');
  });

  it('skips Unknown severity alerts', () => {
    const out = computeWeatherThreat({
      alerts: [{ event: 'Unverified', severity: 'Unknown' }],
      nowMs: T0,
    });
    assert.equal(out.level, 'NONE');
  });
});

describe('computeAviationThreat', () => {
  it('NONE when nothing active', () => {
    const out = computeAviationThreat({
      sigmets: [],
      groundStops: [],
      nowMs: T0,
    });
    assert.equal(out.level, 'NONE');
  });

  it('ELEVATED on any SIGMET', () => {
    const out = computeAviationThreat({
      sigmets: [{ hazard: 'turbulence' }],
      groundStops: [],
      nowMs: T0,
    });
    assert.equal(out.level, 'ELEVATED');
    assert.match(out.topAlert!, /1 SIGMET/);
  });

  it('counts volcanic ash SIGMETs separately in the alert text', () => {
    const out = computeAviationThreat({
      sigmets: [
        { hazard: 'volcanic_ash' },
        { hazard: 'turbulence' },
        { hazard: 'volcanic ash' },
      ],
      groundStops: [],
      nowMs: T0,
    });
    assert.match(out.topAlert!, /3 SIGMETs.*2 ash/);
  });

  it('HIGH on any ground stop', () => {
    const out = computeAviationThreat({
      sigmets: [],
      groundStops: [{ airport: 'EWR', reason: 'Wind' }],
      nowMs: T0,
    });
    assert.equal(out.level, 'HIGH');
    assert.match(out.topAlert!, /EWR ground stop/);
  });
});

describe('computeInfrastructureThreat', () => {
  it('NONE when no outages', () => {
    assert.equal(
      computeInfrastructureThreat({ outages: [], nowMs: T0 }).level,
      'NONE',
    );
  });

  it('LOW for small outages', () => {
    const out = computeInfrastructureThreat({
      outages: [{ provider: 'Comcast', customersAffected: 10_000 }],
      nowMs: T0,
    });
    assert.equal(out.level, 'LOW');
  });

  it('ELEVATED at >100k', () => {
    const out = computeInfrastructureThreat({
      outages: [{ provider: 'PG&E', customersAffected: 250_000, region: 'NorCal' }],
      nowMs: T0,
    });
    assert.equal(out.level, 'ELEVATED');
    assert.match(out.topAlert!, /PG&E.*250k.*NorCal/);
  });

  it('HIGH at >500k', () => {
    const out = computeInfrastructureThreat({
      outages: [{ provider: 'Duke', customersAffected: 850_000 }],
      nowMs: T0,
    });
    assert.equal(out.level, 'HIGH');
    assert.match(out.topAlert!, /850k/);
  });

  it('reports millions for very large outages', () => {
    const out = computeInfrastructureThreat({
      outages: [{ provider: 'GridX', customersAffected: 2_400_000 }],
      nowMs: T0,
    });
    assert.match(out.topAlert!, /2\.4M/);
  });
});

describe('computeMaritimeThreat', () => {
  it('NONE when no vessels in red zone', () => {
    assert.equal(
      computeMaritimeThreat({ vesselsInRedZone: [], nowMs: T0 }).level,
      'NONE',
    );
  });

  it('ELEVATED with 1 vessel', () => {
    const out = computeMaritimeThreat({
      vesselsInRedZone: [{ name: 'GHOST 1', mmsi: '123' }],
      nowMs: T0,
    });
    assert.equal(out.level, 'ELEVATED');
    assert.match(out.topAlert!, /GHOST 1/);
  });

  it('HIGH with >5 vessels', () => {
    const out = computeMaritimeThreat({
      vesselsInRedZone: Array.from({ length: 7 }, (_, i) => ({ name: `V${i}` })),
      nowMs: T0,
    });
    assert.equal(out.level, 'HIGH');
  });
});

describe('computeBiosurveillanceThreat', () => {
  it('NONE when no outbreaks', () => {
    assert.equal(
      computeBiosurveillanceThreat({ outbreaks: [], nowMs: T0 }).level,
      'NONE',
    );
  });

  it('ELEVATED at >=100 cases', () => {
    const out = computeBiosurveillanceThreat({
      outbreaks: [{ disease: 'Measles', caseCount: 150, region: 'TX' }],
      nowMs: T0,
    });
    assert.equal(out.level, 'ELEVATED');
  });

  it('HIGH at >=1000 cases', () => {
    const out = computeBiosurveillanceThreat({
      outbreaks: [{ disease: 'Cholera', caseCount: 4_500 }],
      nowMs: T0,
    });
    assert.equal(out.level, 'HIGH');
  });
});

describe('computeEconomicThreat', () => {
  it('NONE when calm', () => {
    assert.equal(
      computeEconomicThreat({ vix: 14, ofrFsiZ: 0.3, nowMs: T0 }).level,
      'NONE',
    );
  });

  it('ELEVATED at VIX>25', () => {
    assert.equal(
      computeEconomicThreat({ vix: 28, ofrFsiZ: 0.5, nowMs: T0 }).level,
      'ELEVATED',
    );
  });

  it('HIGH at VIX>35', () => {
    assert.equal(
      computeEconomicThreat({ vix: 42, ofrFsiZ: 0.5, nowMs: T0 }).level,
      'HIGH',
    );
  });

  it('HIGH at OFR FSI > 2σ', () => {
    assert.equal(
      computeEconomicThreat({ vix: 12, ofrFsiZ: 2.4, nowMs: T0 }).level,
      'HIGH',
    );
  });

  it('handles null inputs as NONE', () => {
    assert.equal(
      computeEconomicThreat({ vix: null, ofrFsiZ: null, nowMs: T0 }).level,
      'NONE',
    );
  });
});

describe('computeCyberThreat', () => {
  it('NONE at low pulse count', () => {
    assert.equal(
      computeCyberThreat({ pulseCount24h: 5, bgpHijackActive: false, nowMs: T0 }).level,
      'NONE',
    );
  });

  it('ELEVATED at pulses>10', () => {
    assert.equal(
      computeCyberThreat({ pulseCount24h: 23, bgpHijackActive: false, nowMs: T0 }).level,
      'ELEVATED',
    );
  });

  it('HIGH at pulses>50', () => {
    assert.equal(
      computeCyberThreat({ pulseCount24h: 80, bgpHijackActive: false, nowMs: T0 }).level,
      'HIGH',
    );
  });

  it('HIGH on BGP hijack', () => {
    assert.equal(
      computeCyberThreat({ pulseCount24h: 1, bgpHijackActive: true, nowMs: T0 }).level,
      'HIGH',
    );
  });
});

describe('computeGeopoliticalThreat', () => {
  it('NONE when no events and no headline', () => {
    const out = computeGeopoliticalThreat({
      highSeverityEvents24h: 0,
      topHeadline: null,
      nowMs: T0,
    });
    assert.equal(out.level, 'NONE');
  });

  it('LOW for >0 but <10 events', () => {
    assert.equal(
      computeGeopoliticalThreat({
        highSeverityEvents24h: 3,
        topHeadline: null,
        nowMs: T0,
      }).level,
      'LOW',
    );
  });

  it('ELEVATED at 10+ events', () => {
    assert.equal(
      computeGeopoliticalThreat({
        highSeverityEvents24h: 12,
        topHeadline: null,
        nowMs: T0,
      }).level,
      'ELEVATED',
    );
  });

  it('HIGH at 25+ events', () => {
    assert.equal(
      computeGeopoliticalThreat({
        highSeverityEvents24h: 30,
        topHeadline: 'Border clash',
        nowMs: T0,
      }).level,
      'HIGH',
    );
  });
});

describe('aggregateThreats', () => {
  it('returns a stable shape with all 11 domains', () => {
    const out = aggregateThreats({
      seismic: { quakes: [], nowMs: T0 },
      spaceWeather: { kpIndex: null, recentFlareClass: null, nowMs: T0 },
      wildfire: { activeFires: [], nowMs: T0 },
      weather: { alerts: [], nowMs: T0 },
      aviation: { sigmets: [], groundStops: [], nowMs: T0 },
      infrastructure: { outages: [], nowMs: T0 },
      maritime: { vesselsInRedZone: [], nowMs: T0 },
      biosurveillance: { outbreaks: [], nowMs: T0 },
      economic: { vix: null, ofrFsiZ: null, nowMs: T0 },
      cyber: { pulseCount24h: null, bgpHijackActive: false, nowMs: T0 },
      geopolitical: { highSeverityEvents24h: null, topHeadline: null, nowMs: T0 },
    });
    assert.equal(Object.keys(out).length, 11);
    for (const v of Object.values(out)) assert.equal(v.level, 'NONE');
  });
});

const seismicReceipt = (evidenceAtMs = T0, magnitude = 0): ThreatReceipt => ({
  evidenceAtMs,
  expiresAtMs: evidenceAtMs + ONE_HOUR,
  scope: 'complete',
  ageKind: 'fetched',
  evaluate: (nowMs) => computeSeismicThreat({
    quakes: magnitude ? [{ magnitude, timeMs: evidenceAtMs }] : [],
    nowMs,
  }),
});

describe('threat evidence', () => {
  it('starts with eleven unknown domains and no observation clocks', () => {
    const rows = Object.values(emptyAggregatedThreats());
    assert.equal(rows.length, 11);
    for (const row of rows) {
      assert.equal(row.coverage, 'unknown');
      assert.equal(row.lastUpdatedMs, 0);
      assert.deepEqual(row.sources, []);
    }
  });

  it('keeps the original observation and validity when a receipt is replayed', () => {
    let now = T0;
    const store = new ThreatEvidenceStore(() => now);
    store.begin('seismic', 'USGS').report(seismicReceipt(T0, 7));
    now += ONE_HOUR;
    store.begin('seismic', 'USGS').report({
      ...seismicReceipt(T0), expiresAtMs: now + ONE_HOUR,
    });
    const row = store.sample(now).seismic;
    assert.equal(row.coverage, 'stale');
    assert.equal(row.lastUpdatedMs, T0);
    assert.equal(row.level, 'NONE');
    assert.equal(row.sources[0]!.reporting, false);
  });

  it('accepts a worse coverage report for a replay without renewing or replacing the signal', () => {
    const store = new ThreatEvidenceStore(() => T0);
    store.begin('seismic', 'USGS').report(seismicReceipt(T0, 7));
    store.begin('seismic', 'USGS').report({
      ...seismicReceipt(), degraded: true, expiresAtMs: T0 + 2 * ONE_HOUR,
    });
    const row = store.sample(T0).seismic;
    assert.equal(row.level, 'CRITICAL');
    assert.equal(row.coverage, 'partial');
    assert.equal(row.sources[0]!.state, 'degraded');
    store.begin('seismic', 'USGS').report(seismicReceipt());
    assert.equal(store.sample(T0).seismic.coverage, 'partial');
    assert.equal(store.sample(T0 + ONE_HOUR).seismic.level, 'NONE');
  });

  it('keeps a failed source last-known, withholds reassurance, and expires it offline', () => {
    const store = new ThreatEvidenceStore(() => T0);
    store.begin('seismic', 'USGS').report(seismicReceipt(T0, 7));
    const refresh = store.begin('seismic', 'USGS');
    assert.equal(store.sample(T0).seismic.coverage, 'complete');
    refresh.fail();
    const degraded = store.sample(T0 + 10).seismic;
    assert.equal(degraded.coverage, 'unavailable');
    assert.equal(degraded.lastKnown, true);
    assert.equal(degraded.level, 'CRITICAL');
    assert.equal(degraded.signalSource, 'USGS');
    assert.equal(degraded.sources[0]!.reporting, false);
    assert.equal(store.sample(T0 + ONE_HOUR).seismic.level, 'NONE');
  });

  it('requires strictly newer evidence to recover from a failed refresh', () => {
    let now = T0;
    const store = new ThreatEvidenceStore(() => now);
    store.begin('seismic', 'USGS').report(seismicReceipt());
    store.begin('seismic', 'USGS').fail();
    now++;
    store.begin('seismic', 'USGS').report(seismicReceipt());
    const replay = store.sample(now).seismic;
    assert.equal(replay.coverage, 'unavailable');
    assert.equal(replay.sources[0]!.reporting, false);
    assert.equal(replay.lastUpdatedMs, T0);
    store.begin('seismic', 'USGS').report(seismicReceipt(now));
    assert.equal(store.sample(now).seismic.coverage, 'complete');
  });

  it('accepts an ordered change within one observation including a decrease, without renewing its age', () => {
    let now = T0 + 200;
    const store = new ThreatEvidenceStore(() => now);
    const send = (magnitude: number, rev: number, end: number) => store.begin('seismic', 'Sensor').report({
      ...seismicReceipt(T0, magnitude), revisionAtMs: rev, revisionKey: String(magnitude), expiresAtMs: end,
    });
    send(2, T0, T0 + 500);
    store.begin('seismic', 'Sensor').fail();
    send(2, T0 + 50, T0 + 1000);
    assert.equal(store.sample().seismic.coverage, 'unavailable');
    send(7, T0 + 100, T0 + 900);
    assert.equal(store.sample().seismic.level, 'CRITICAL');
    assert.equal(store.sample().seismic.lastUpdatedMs, T0);
    assert.equal(store.sample().seismic.lastKnown, false);
    send(5, T0 + 150, T0 + 450);
    assert.equal(store.sample().seismic.level, 'ELEVATED');
    assert.equal(store.sample(T0 + 449).seismic.coverage, 'complete');
    now = T0 + 450;
    send(8, now, T0 + 1000);
    assert.equal(store.sample().seismic.coverage, 'stale');
    assert.equal(store.sample().seismic.level, 'NONE');
  });

  it('retains a positive as last-known when different content cannot be ordered', () => {
    const store = new ThreatEvidenceStore(() => T0 + 200);
    const send = (magnitude: number, rev?: number) => store.begin('seismic', 'Sensor').report({
      ...seismicReceipt(T0, magnitude), revisionAtMs: rev, revisionKey: String(magnitude),
    });
    send(7, T0);
    send(7, T0 + 100);
    for (const rev of [T0 + 50, T0 + 100, undefined]) {
      send(0, rev);
      const row = store.sample().seismic;
      assert.equal(row.coverage, 'unavailable');
      assert.equal(row.level, 'CRITICAL');
      assert.equal(row.lastKnown, true);
    }
  });

  it('rejects invalid revision clocks and unlabeled revisions before admission', () => {
    const store = new ThreatEvidenceStore(() => T0 + 100);
    for (const [clock, key] of [[T0 - 1, 'a'], [T0 + 101, 'a'], [NaN, 'a'], [T0, undefined], [T0, '']] as const) {
      store.begin('seismic', 'Sensor').report({ ...seismicReceipt(), revisionAtMs: clock, revisionKey: key });
      assert.equal(store.sample().seismic.coverage, 'unavailable');
      assert.equal(store.sample().seismic.lastUpdatedMs, 0);
    }
  });

  it('does not extend the original validity window on a newer revision', () => {
    const store = new ThreatEvidenceStore(() => T0 + 100);
    store.begin('seismic', 'Sensor').report({
      ...seismicReceipt(T0, 2), revisionAtMs: T0, revisionKey: '2', expiresAtMs: T0 + 500,
    });
    store.begin('seismic', 'Sensor').report({
      ...seismicReceipt(T0, 7), revisionAtMs: T0 + 100, revisionKey: '7', expiresAtMs: T0 + 900,
    });
    assert.equal(store.sample(T0 + 499).seismic.level, 'CRITICAL');
    assert.equal(store.sample(T0 + 500).seismic.coverage, 'stale');
  });

  it('accepts an ordered membership removal even when the latest remaining item is older', () => {
    const store = new ThreatEvidenceStore(() => T0 + 50);
    const send = (age: number, clock: number, magnitude: number, key: string) => store.begin('seismic', 'Sample').report({
      ...seismicReceipt(age, magnitude), revisionAtMs: clock, revisionKey: key, snapshotMembership: true,
    });
    send(T0, T0 + 10, 7, 'six');
    send(T0 - 50, T0 + 20, 5, 'five');
    const revised = store.sample().seismic;
    assert.equal(revised.level, 'ELEVATED');
    assert.equal(revised.lastUpdatedMs, T0 - 50);
    assert.equal(revised.lastKnown, false);
    send(T0, T0 + 10, 7, 'six');
    assert.equal(store.sample().seismic.level, 'ELEVATED');
    assert.equal(store.sample().seismic.lastKnown, true);
    send(T0 + 25, T0 + 30, 7, 'seven');
    assert.equal(store.sample().seismic.level, 'CRITICAL');
    assert.equal(store.sample().seismic.lastUpdatedMs, T0 + 25);
    assert.equal(store.sample(T0 + ONE_HOUR + 24).seismic.level, 'CRITICAL');
  });

  it('never replaces an observation with an older bin even when its publication clock increases', () => {
    const store = new ThreatEvidenceStore(() => T0 + 50);
    store.begin('seismic', 'Mutable bin').report({ ...seismicReceipt(T0, 7), revisionAtMs: T0, revisionKey: '7' });
    store.begin('seismic', 'Mutable bin').report({ ...seismicReceipt(T0 - 50, 5), revisionAtMs: T0 + 20, revisionKey: '5' });
    assert.equal(store.sample().seismic.level, 'CRITICAL');
    assert.equal(store.sample().seismic.lastUpdatedMs, T0);
    assert.equal(store.sample().seismic.lastKnown, true);
  });

  it('prefers a current signal at equal severity, then the newest, then a stable source', () => {
    const store = new ThreatEvidenceStore(() => T0);
    for (const [source, stamp] of [['B', T0], ['A', T0], ['Old', T0 - 10]] as const) {
      store.begin('seismic', source).report(seismicReceipt(stamp, 7));
      store.begin('seismic', source).fail();
    }
    assert.equal(store.sample(T0).seismic.signalSource, 'A');
    store.begin('seismic', 'Older but reporting').report(seismicReceipt(T0 - 20, 7));
    assert.equal(store.sample(T0).seismic.signalSource, 'Older but reporting');
    assert.equal(store.sample(T0).seismic.lastKnown, false);
  });

  it('keeps a partially successful leg reporting when its sibling fails', () => {
    const store = new ThreatEvidenceStore(() => T0);
    const stop = store.begin('aviation', 'FAA');
    stop.report({
      ...seismicReceipt(), scope: 'partial', degraded: true,
      evaluate: (nowMs) => computeAviationThreat({ groundStops: [{ airport: 'JFK' }], sigmets: [], nowMs }),
    });
    store.begin('aviation', 'SIGMET').fail();
    const row = store.sample(T0).aviation;
    assert.equal(row.coverage, 'partial');
    assert.equal(row.level, 'HIGH');
    assert.equal(row.lastKnown, false);
    assert.deepEqual(row.sources.map(s => [s.source, s.state, s.reporting]), [
      ['FAA', 'degraded', true], ['SIGMET', 'unavailable', false],
    ]);
  });

  it('leads with the reporting hazard and preserves the stronger last-known sibling', () => {
    const store = new ThreatEvidenceStore(() => T0);
    store.begin('aviation', 'FAA').report({
      ...seismicReceipt(), scope: 'partial',
      evaluate: nowMs => computeAviationThreat({ sigmets: [], groundStops: [{ airport: 'JFK' }], nowMs }),
    });
    store.begin('aviation', 'FAA').fail();
    store.begin('aviation', 'SIGMET').report({
      ...seismicReceipt(), scope: 'partial',
      evaluate: nowMs => computeAviationThreat({ sigmets: [{ hazard: 'icing' }], groundStops: [], nowMs }),
    });
    const row = store.sample(T0).aviation;
    assert.equal(row.level, 'ELEVATED');
    assert.equal(row.lastKnown, false);
    assert.equal(row.signalSource, 'SIGMET');
    assert.deepEqual(row.sources[0]!.signal, { level: 'HIGH', topAlert: 'JFK ground stop' });
    assert.equal(row.sources[0]!.reporting, false);
    assert.deepEqual(row.sources[1]!.signal, { level: 'ELEVATED', topAlert: '1 SIGMET' });
  });

  it('uses the oldest complete receipt and withholds a whole-domain claim for partial evidence', () => {
    const store = new ThreatEvidenceStore(() => T0);
    store.begin('seismic', 'Older').report(seismicReceipt(T0 - 100));
    store.begin('seismic', 'Newer').report(seismicReceipt(T0));
    assert.equal(store.sample(T0).seismic.coverage, 'complete');
    assert.equal(store.sample(T0).seismic.lastUpdatedMs, T0 - 100);
    store.begin('seismic', 'Partial').report({ ...seismicReceipt(), scope: 'partial' });
    assert.equal(store.sample(T0).seismic.coverage, 'partial');
  });

  it('ignores superseded and cancelled attempts, including repeated settlements', () => {
    const store = new ThreatEvidenceStore(() => T0);
    const first = store.begin('seismic', 'USGS');
    assert.equal(first.isCurrent(), true);
    const second = store.begin('seismic', 'USGS');
    assert.equal(first.isCurrent(), false);
    assert.equal(second.isCurrent(), true);
    second.report(seismicReceipt(T0, 7));
    assert.equal(second.isCurrent(), false);
    first.fail();
    second.fail();
    const retired = store.begin('seismic', 'USGS');
    retired.cancel();
    retired.fail();
    assert.equal(store.sample(T0).seismic.level, 'CRITICAL');
    assert.equal(store.sample(T0).seismic.coverage, 'complete');
    const neverAdmitted = store.begin('maritime', 'AIS');
    neverAdmitted.cancel();
    neverAdmitted.report(seismicReceipt());
    assert.equal(store.sample(T0).maritime.coverage, 'unknown');
  });

  it('rejects time travel, invalid horizons, and regressions without replacing a newer hazard', () => {
    const store = new ThreatEvidenceStore(() => T0);
    for (const receipt of [
      seismicReceipt(T0 + 1), seismicReceipt(NaN), { ...seismicReceipt(), expiresAtMs: T0 },
      { ...seismicReceipt(), expiresAtMs: Infinity },
    ]) {
      store.begin('seismic', 'USGS').report(receipt);
      assert.equal(store.sample(T0).seismic.coverage, 'unavailable');
    }
    store.begin('seismic', 'USGS').report(seismicReceipt(T0, 7));
    store.begin('seismic', 'USGS').report(seismicReceipt(T0 - 1));
    const row = store.sample(T0).seismic;
    assert.equal(row.level, 'CRITICAL');
    assert.equal(row.lastUpdatedMs, T0);
    assert.notEqual(row.coverage, 'complete');
  });

  it('re-evaluates event validity before the source receipt expires', () => {
    const store = new ThreatEvidenceStore(() => T0);
    store.begin('aviation', 'FAA').report({
      ...seismicReceipt(), scope: 'partial',
      evaluate: nowMs => computeAviationThreat({ sigmets: [], groundStops: nowMs < T0 + 10 ? [{ airport: 'JFK' }] : [], nowMs }),
    });
    assert.equal(store.sample(T0).aviation.level, 'HIGH');
    assert.equal(store.sample(T0 + 10).aviation.level, 'NONE');
    assert.equal(store.sample(T0 + 10).aviation.coverage, 'partial');
  });
});

describe('startThreatAggregator', () => {
  it('publishes admitted readings, preserves their clock across ticks and stops publishing on teardown', async () => {
    let now = T0;
    const store = new ThreatEvidenceStore(() => now);
    const events: ThreatLevelsEventDetail[] = [];
    const handle = startThreatAggregator({ store, now: () => now, emit: d => events.push(d) });
    try {
      assert.equal(events[0]!.threats.seismic.coverage, 'unknown');
      store.begin('seismic', 'USGS').report(seismicReceipt(T0, 7));
      now += 30_000;
      await handle.pollNow();
      assert.equal(events.at(-1)!.threats.seismic.level, 'CRITICAL');
      assert.equal(events.at(-1)!.threats.seismic.lastUpdatedMs, T0);
      store.begin('cyber', 'OTX').fail();
      await handle.pollNow();
      assert.equal(events.at(-1)!.threats.cyber.coverage, 'unavailable');
      assert.equal(events.at(-1)!.threats.cyber.lastUpdatedMs, 0);
    } finally {
      handle.stop();
    }
    const count = events.length;
    await handle.pollNow();
    assert.equal(events.length, count);
  });
});
