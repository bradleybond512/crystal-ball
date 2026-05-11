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

describe('emptyAggregatedThreats', () => {
  it('seeds all domains at NONE with the supplied timestamp', () => {
    const out = emptyAggregatedThreats(T0);
    for (const v of Object.values(out)) {
      assert.equal(v.level, 'NONE');
      assert.equal(v.lastUpdatedMs, T0);
    }
  });
});

describe('startThreatAggregator', () => {
  it('emits a wm:threat-levels-updated detail on first poll', async () => {
    const events: ThreatLevelsEventDetail[] = [];
    const handle = startThreatAggregator({
      intervalMs: 1_000_000,
      now: () => T0,
      emit: (d) => events.push(d),
      fetchSeismic: async () => ({
        quakes: [{ magnitude: 7.2, place: 'Test', timeMs: T0 }],
        nowMs: T0,
      }),
    });
    await handle.pollNow();
    handle.stop();
    assert.ok(events.length >= 1);
    assert.equal(events[0]!.threats.seismic.level, 'CRITICAL');
  });

  it('survives a fetcher that throws', async () => {
    const events: ThreatLevelsEventDetail[] = [];
    const handle = startThreatAggregator({
      intervalMs: 1_000_000,
      now: () => T0,
      emit: (d) => events.push(d),
      fetchCyber: async () => {
        throw new Error('boom');
      },
    });
    await handle.pollNow();
    handle.stop();
    // Cyber falls back to default snapshot, so its level is NONE.
    assert.equal(events.at(-1)!.threats.cyber.level, 'NONE');
  });
});
