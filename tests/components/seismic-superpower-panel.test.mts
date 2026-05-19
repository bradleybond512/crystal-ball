/**
 * SeismicSuperpowerEngine — deterministic unit tests.
 *
 * Tests the five computation sections of SeismicSuperpowerEngine:
 * earthquake clusters, tsunami risk, volcanic activity, Omori-Utsu
 * aftershock sequences, and seismic hazard index.
 *
 * No DOM — the engine is pure input → output.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  SeismicSuperpowerEngine,
} from '../../src/components/SeismicSuperpowerPanel.ts';
import type {
  EarthquakeCluster,
  TsunamiRisk,
  VolcanicAlert,
  AftershockPoint,
  HazardResult,
} from '../../src/components/SeismicSuperpowerPanel.ts';
import type { ObservationEvent } from '../../src/types/intelligence.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000;
const H = 3_600_000; // 1 hour in ms
const ENGINE = new SeismicSuperpowerEngine();

function makeEq(
  id: string,
  mag: number,
  offsetMs = 0,
  region = 'Asia-Pacific',
  depthKm = 15,
): ObservationEvent {
  return {
    id,
    sourceId: 'usgs',
    domain: 'earthquake',
    timestamp: NOW - offsetMs,
    severity: mag >= 7 ? 'CRITICAL' : mag >= 5 ? 'HIGH' : 'MEDIUM',
    title: `M${mag} earthquake near test`,
    raw: { magnitude: mag, depthKm, region },
    entityIds: [],
    tags: ['earthquake'],
  };
}

function makeTsunami(
  id: string,
  level: 'tsunami-warning' | 'tsunami-watch' | 'tsunami-advisory' | 'tsunami',
  region = 'Asia-Pacific',
  coastal = 5,
): ObservationEvent {
  return {
    id,
    sourceId: 'ptwc',
    domain: 'seismic',
    timestamp: NOW,
    severity: 'HIGH',
    title: `Tsunami ${level}`,
    raw: { region, coastalPopulationMillions: coastal },
    entityIds: [],
    tags: [level],
  };
}

function makeVolcano(
  id: string,
  tags: string[],
  vei: number | null = null,
  ashDeg: number | null = null,
  volcanoName = 'Mount Test',
): ObservationEvent {
  return {
    id,
    sourceId: 'smithsonian-gvp',
    domain: 'volcanic',
    timestamp: NOW,
    severity: 'HIGH',
    title: volcanoName,
    raw: { volcanoName, vei, ashTrajectoryDeg: ashDeg },
    entityIds: [],
    tags,
  };
}

// ── parseEarthquakeClusters ───────────────────────────────────────────────

describe('parseEarthquakeClusters', () => {
  it('returns empty for no events', () => {
    const result = ENGINE.parseEarthquakeClusters([], NOW);
    assert.deepEqual(result, []);
  });

  it('excludes events below M4.0', () => {
    const events = [makeEq('e1', 3.9)];
    assert.deepEqual(ENGINE.parseEarthquakeClusters(events, NOW), []);
  });

  it('includes M4.0 exactly', () => {
    const events = [makeEq('e1', 4.0)];
    const clusters = ENGINE.parseEarthquakeClusters(events, NOW);
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0]!.maxMagnitude, 4.0);
  });

  it('excludes events older than 48h', () => {
    const events = [makeEq('e1', 5.0, 48 * H + 1)];
    assert.deepEqual(ENGINE.parseEarthquakeClusters(events, NOW), []);
  });

  it('includes events exactly at 48h boundary', () => {
    const events = [makeEq('e1', 5.0, 48 * H)];
    const clusters = ENGINE.parseEarthquakeClusters(events, NOW);
    assert.equal(clusters.length, 1);
  });

  it('groups events in the same region into one cluster', () => {
    const events = [makeEq('e1', 5.0, 0, 'Asia-Pacific'), makeEq('e2', 4.5, 0, 'Asia-Pacific')];
    const clusters = ENGINE.parseEarthquakeClusters(events, NOW);
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0]!.eventCount, 2);
  });

  it('creates separate clusters for different regions', () => {
    const events = [makeEq('e1', 5.0, 0, 'Asia-Pacific'), makeEq('e2', 4.5, 0, 'Americas')];
    const clusters = ENGINE.parseEarthquakeClusters(events, NOW);
    assert.equal(clusters.length, 2);
  });

  it('reports max magnitude per cluster', () => {
    const events = [makeEq('e1', 4.5, 0, 'Asia-Pacific'), makeEq('e2', 6.2, 0, 'Asia-Pacific')];
    const clusters = ENGINE.parseEarthquakeClusters(events, NOW);
    assert.equal(clusters[0]!.maxMagnitude, 6.2);
  });

  it('sorts clusters by maxMagnitude descending', () => {
    const events = [
      makeEq('e1', 5.0, 0, 'Americas'),
      makeEq('e2', 7.2, 0, 'Asia-Pacific'),
      makeEq('e3', 4.8, 0, 'Europe'),
    ];
    const clusters = ENGINE.parseEarthquakeClusters(events, NOW);
    assert.equal(clusters[0]!.region, 'Asia-Pacific');
    assert.equal(clusters[1]!.region, 'Americas');
    assert.equal(clusters[2]!.region, 'Europe');
  });

  it('computes avgDepthKm across cluster events', () => {
    const events = [makeEq('e1', 5.0, 0, 'Asia-Pacific', 10), makeEq('e2', 4.5, 0, 'Asia-Pacific', 30)];
    const clusters = ENGINE.parseEarthquakeClusters(events, NOW);
    assert.equal(clusters[0]!.avgDepthKm, 20);
  });
});

// ── parseTsunamiRisk ──────────────────────────────────────────────────────

describe('parseTsunamiRisk', () => {
  it('returns empty for no tsunami-tagged events', () => {
    const events = [makeEq('e1', 5.0)];
    assert.deepEqual(ENGINE.parseTsunamiRisk(events), []);
  });

  it('detects tsunami-warning tag', () => {
    const risks = ENGINE.parseTsunamiRisk([makeTsunami('t1', 'tsunami-warning')]);
    assert.equal(risks[0]!.warningLevel, 'warning');
  });

  it('detects tsunami-watch tag', () => {
    const risks = ENGINE.parseTsunamiRisk([makeTsunami('t1', 'tsunami-watch')]);
    assert.equal(risks[0]!.warningLevel, 'watch');
  });

  it('falls back to advisory for plain tsunami tag', () => {
    const risks = ENGINE.parseTsunamiRisk([makeTsunami('t1', 'tsunami')]);
    assert.equal(risks[0]!.warningLevel, 'advisory');
  });

  it('reports coastal population from raw field', () => {
    const risks = ENGINE.parseTsunamiRisk([makeTsunami('t1', 'tsunami-warning', 'Asia-Pacific', 12.5)]);
    assert.equal(risks[0]!.coastalPopulationMillions, 12.5);
  });

  it('sorts warnings before watches before advisories', () => {
    const events = [
      makeTsunami('t1', 'tsunami'),
      makeTsunami('t2', 'tsunami-warning'),
      makeTsunami('t3', 'tsunami-watch'),
    ];
    const risks = ENGINE.parseTsunamiRisk(events);
    assert.equal(risks[0]!.warningLevel, 'warning');
    assert.equal(risks[1]!.warningLevel, 'watch');
    assert.equal(risks[2]!.warningLevel, 'advisory');
  });
});

// ── parseVolcanicActivity ─────────────────────────────────────────────────

describe('parseVolcanicActivity', () => {
  it('returns empty when no volcanic events', () => {
    assert.deepEqual(ENGINE.parseVolcanicActivity([makeEq('e1', 5.0)]), []);
  });

  it('detects eruption tag', () => {
    const alerts = ENGINE.parseVolcanicActivity([makeVolcano('v1', ['eruption'])]);
    assert.equal(alerts[0]!.alertLevel, 'eruption');
  });

  it('detects volcanic-warning tag', () => {
    const alerts = ENGINE.parseVolcanicActivity([makeVolcano('v1', ['volcanic-warning'])]);
    assert.equal(alerts[0]!.alertLevel, 'warning');
  });

  it('falls back to advisory for generic volcanic tag', () => {
    const alerts = ENGINE.parseVolcanicActivity([makeVolcano('v1', ['volcanic'])]);
    assert.equal(alerts[0]!.alertLevel, 'advisory');
  });

  it('extracts VEI from raw field', () => {
    const alerts = ENGINE.parseVolcanicActivity([makeVolcano('v1', ['eruption'], 4)]);
    assert.equal(alerts[0]!.vei, 4);
  });

  it('returns null VEI when not provided', () => {
    const alerts = ENGINE.parseVolcanicActivity([makeVolcano('v1', ['volcanic'], null)]);
    assert.equal(alerts[0]!.vei, null);
  });

  it('extracts ash trajectory degrees', () => {
    const alerts = ENGINE.parseVolcanicActivity([makeVolcano('v1', ['eruption'], 3, 270)]);
    assert.equal(alerts[0]!.ashTrajectoryDeg, 270);
  });

  it('sorts by VEI descending, null VEI last', () => {
    const events = [
      makeVolcano('v1', ['eruption'], null),
      makeVolcano('v2', ['eruption'], 5),
      makeVolcano('v3', ['eruption'], 3),
    ];
    const alerts = ENGINE.parseVolcanicActivity(events);
    assert.equal(alerts[0]!.vei, 5);
    assert.equal(alerts[1]!.vei, 3);
  });

  it('uses volcanoName from raw field', () => {
    const alerts = ENGINE.parseVolcanicActivity([makeVolcano('v1', ['eruption'], null, null, 'Krakatau')]);
    assert.equal(alerts[0]!.name, 'Krakatau');
  });
});

// ── computeOmoriAftershocks ───────────────────────────────────────────────

describe('computeOmoriAftershocks', () => {
  it('returns empty when mainshock is in the future', () => {
    const points = ENGINE.computeOmoriAftershocks(7.0, NOW + H, NOW);
    assert.deepEqual(points, []);
  });

  it('returns `steps` data points', () => {
    const points = ENGINE.computeOmoriAftershocks(6.0, NOW - 24 * H, NOW, 8);
    assert.equal(points.length, 8);
  });

  it('default steps is 10', () => {
    const points = ENGINE.computeOmoriAftershocks(6.0, NOW - 24 * H, NOW);
    assert.equal(points.length, 10);
  });

  it('rate is positive at t=0', () => {
    const points = ENGINE.computeOmoriAftershocks(6.0, NOW - H, NOW, 5);
    assert.ok(points[0]!.rate > 0);
  });

  it('rate decays over time (Omori law)', () => {
    const points = ENGINE.computeOmoriAftershocks(7.0, NOW - 24 * H, NOW, 5);
    for (let i = 1; i < points.length; i++) {
      assert.ok(
        points[i]!.rate <= points[i - 1]!.rate,
        `rate should not increase: step ${i}`,
      );
    }
  });

  it('higher magnitude produces higher initial rate', () => {
    const low = ENGINE.computeOmoriAftershocks(5.0, NOW - 24 * H, NOW, 3);
    const high = ENGINE.computeOmoriAftershocks(8.0, NOW - 24 * H, NOW, 3);
    assert.ok(high[0]!.rate > low[0]!.rate);
  });

  it('hoursAfter is non-negative for all points', () => {
    const points = ENGINE.computeOmoriAftershocks(6.5, NOW - 10 * H, NOW, 5);
    for (const p of points) {
      assert.ok(p.hoursAfter >= 0);
    }
  });
});

// ── computeHazardIndex ────────────────────────────────────────────────────

describe('computeHazardIndex', () => {
  it('returns 0 for zero population', () => {
    const r = ENGINE.computeHazardIndex({ region: 'Test', recurrenceYears: 100, populationMillions: 0 });
    assert.equal(r.hazardIndex, 0);
  });

  it('returns 1 for high population + frequent recurrence', () => {
    const r = ENGINE.computeHazardIndex({ region: 'Test', recurrenceYears: 50, populationMillions: 200 });
    assert.equal(r.hazardIndex, 1);
  });

  it('higher population → higher index (same recurrence)', () => {
    const low = ENGINE.computeHazardIndex({ region: 'Test', recurrenceYears: 100, populationMillions: 10 });
    const high = ENGINE.computeHazardIndex({ region: 'Test', recurrenceYears: 100, populationMillions: 80 });
    assert.ok(high.hazardIndex > low.hazardIndex);
  });

  it('shorter recurrence interval → higher index (same population)', () => {
    const rare = ENGINE.computeHazardIndex({ region: 'Test', recurrenceYears: 1000, populationMillions: 50 });
    const frequent = ENGINE.computeHazardIndex({ region: 'Test', recurrenceYears: 50, populationMillions: 50 });
    assert.ok(frequent.hazardIndex > rare.hazardIndex);
  });

  it('result is clamped between 0 and 1', () => {
    const r = ENGINE.computeHazardIndex({ region: 'Test', recurrenceYears: 1, populationMillions: 1000 });
    assert.ok(r.hazardIndex >= 0 && r.hazardIndex <= 1);
  });

  it('preserves region in result', () => {
    const r = ENGINE.computeHazardIndex({ region: 'Asia-Pacific', recurrenceYears: 100, populationMillions: 50 });
    assert.equal(r.region, 'Asia-Pacific');
  });
});
