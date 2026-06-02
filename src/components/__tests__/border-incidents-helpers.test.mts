import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  BORDER_FRICTION_ZONES,
  getHighIntensity,
  getEscalating,
  getByRegion,
  getNuclearRisk,
  computeGlobalMIDIndex,
  incidentTypeClass,
  intensityClass,
  buildRenderData,
  type BorderFrictionZone,
} from '../border-incidents-helpers.ts';

// ── BORDER_FRICTION_ZONES data integrity ─────────────────────────────────────

describe('BORDER_FRICTION_ZONES', () => {
  it('contains exactly 12 zones', () => {
    assert.equal(BORDER_FRICTION_ZONES.length, 12);
  });

  it('every zone has a non-empty id string', () => {
    for (const z of BORDER_FRICTION_ZONES) {
      assert.ok(typeof z.id === 'string' && z.id.length > 0, `Empty id on zone`);
    }
  });

  it('every zone has at least 2 parties', () => {
    for (const z of BORDER_FRICTION_ZONES) {
      assert.ok(z.parties.length >= 2, `${z.id} has fewer than 2 parties`);
    }
  });

  it('escalationPotential is in [1, 10] for all zones', () => {
    for (const z of BORDER_FRICTION_ZONES) {
      assert.ok(
        z.escalationPotential >= 1 && z.escalationPotential <= 10,
        `${z.id} potential out of range: ${z.escalationPotential}`,
      );
    }
  });

  it('monthlyFrequency is a positive number for all zones', () => {
    for (const z of BORDER_FRICTION_ZONES) {
      assert.ok(z.monthlyFrequency > 0, `${z.id} has non-positive monthlyFrequency`);
    }
  });

  it('trend is one of the valid union values', () => {
    const valid = new Set(['escalating', 'stable', 'de-escalating']);
    for (const z of BORDER_FRICTION_ZONES) {
      assert.ok(valid.has(z.trend), `${z.id} invalid trend: ${z.trend}`);
    }
  });

  it('incidentType is a non-empty array for all zones', () => {
    for (const z of BORDER_FRICTION_ZONES) {
      assert.ok(Array.isArray(z.incidentType) && z.incidentType.length > 0,
        `${z.id} has empty incidentType`);
    }
  });

  it('all incidentType values are valid', () => {
    const valid = new Set(['Fire', 'Maneuver', 'Display', 'Blockade', 'Seizure']);
    for (const z of BORDER_FRICTION_ZONES) {
      for (const t of z.incidentType) {
        assert.ok(valid.has(t), `${z.id} invalid incidentType: ${t}`);
      }
    }
  });

  it('nuclearRisk is a boolean on all zones', () => {
    for (const z of BORDER_FRICTION_ZONES) {
      assert.equal(typeof z.nuclearRisk, 'boolean');
    }
  });

  it('china-taiwan-adiz has escalationPotential 9', () => {
    const z = BORDER_FRICTION_ZONES.find((x) => x.id === 'china-taiwan-adiz');
    assert.ok(z);
    assert.equal(z!.escalationPotential, 9);
  });

  it('russia-ukraine-frontline has monthlyFrequency 300', () => {
    const z = BORDER_FRICTION_ZONES.find((x) => x.id === 'russia-ukraine-frontline');
    assert.ok(z);
    assert.equal(z!.monthlyFrequency, 300);
  });
});

// ── getHighIntensity ──────────────────────────────────────────────────────────

describe('getHighIntensity', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(getHighIntensity(BORDER_FRICTION_ZONES)));
  });

  it('returns empty for empty input', () => {
    assert.equal(getHighIntensity([]).length, 0);
  });

  it('every returned zone satisfies monthly>10 or potential>=8', () => {
    for (const z of getHighIntensity(BORDER_FRICTION_ZONES)) {
      assert.ok(
        z.monthlyFrequency > 10 || z.escalationPotential >= 8,
        `${z.id} should not be high-intensity`,
      );
    }
  });

  it('china-taiwan-adiz is high intensity (45/mo and P9)', () => {
    const result = getHighIntensity(BORDER_FRICTION_ZONES);
    assert.ok(result.some((z) => z.id === 'china-taiwan-adiz'));
  });

  it('russia-ukraine-frontline is high intensity (300/mo)', () => {
    const result = getHighIntensity(BORDER_FRICTION_ZONES);
    assert.ok(result.some((z) => z.id === 'russia-ukraine-frontline'));
  });

  it('ecuador-colombia is NOT high intensity (2/mo, P4)', () => {
    const result = getHighIntensity(BORDER_FRICTION_ZONES);
    assert.ok(!result.some((z) => z.id === 'ecuador-colombia'));
  });

  it('a zone with exactly monthly=11 qualifies', () => {
    const zone: BorderFrictionZone = {
      id: 'test', parties: ['A', 'B'], region: 'X',
      incidentType: ['Fire'], monthlyFrequency: 11, trend: 'stable',
      nuclearRisk: false, escalationPotential: 3,
      description: '', lastIncident: '',
    };
    assert.equal(getHighIntensity([zone]).length, 1);
  });

  it('a zone with monthly=10 and potential=7 does NOT qualify', () => {
    const zone: BorderFrictionZone = {
      id: 'test', parties: ['A', 'B'], region: 'X',
      incidentType: ['Display'], monthlyFrequency: 10, trend: 'stable',
      nuclearRisk: false, escalationPotential: 7,
      description: '', lastIncident: '',
    };
    assert.equal(getHighIntensity([zone]).length, 0);
  });
});

// ── getEscalating ─────────────────────────────────────────────────────────────

describe('getEscalating', () => {
  it('returns empty for empty input', () => {
    assert.equal(getEscalating([]).length, 0);
  });

  it('all returned zones have trend === "escalating"', () => {
    for (const z of getEscalating(BORDER_FRICTION_ZONES)) {
      assert.equal(z.trend, 'escalating');
    }
  });

  it('india-pakistan-loc is escalating', () => {
    assert.ok(getEscalating(BORDER_FRICTION_ZONES).some((z) => z.id === 'india-pakistan-loc'));
  });

  it('armenia-azerbaijan is NOT escalating (de-escalating)', () => {
    assert.ok(!getEscalating(BORDER_FRICTION_ZONES).some((z) => z.id === 'armenia-azerbaijan'));
  });

  it('russia-ukraine-frontline is NOT escalating (stable)', () => {
    assert.ok(!getEscalating(BORDER_FRICTION_ZONES).some((z) => z.id === 'russia-ukraine-frontline'));
  });

  it('result is a subset of input', () => {
    const ids = new Set(BORDER_FRICTION_ZONES.map((z) => z.id));
    for (const z of getEscalating(BORDER_FRICTION_ZONES)) {
      assert.ok(ids.has(z.id));
    }
  });
});

// ── getByRegion ───────────────────────────────────────────────────────────────

describe('getByRegion', () => {
  it('returns empty for unknown region', () => {
    assert.equal(getByRegion(BORDER_FRICTION_ZONES, 'Narnia').length, 0);
  });

  it('returns empty for empty input', () => {
    assert.equal(getByRegion([], 'Europe').length, 0);
  });

  it('all returned zones have the requested region', () => {
    for (const z of getByRegion(BORDER_FRICTION_ZONES, 'Europe')) {
      assert.equal(z.region, 'Europe');
    }
  });

  it('Europe has at least 2 zones (Russia-Ukraine, Serbia-Kosovo, Russia-Finland)', () => {
    assert.ok(getByRegion(BORDER_FRICTION_ZONES, 'Europe').length >= 2);
  });

  it('South Asia zone count is 2 (China-India, India-Pakistan)', () => {
    assert.equal(getByRegion(BORDER_FRICTION_ZONES, 'South Asia').length, 2);
  });

  it('Latin America has exactly 1 zone', () => {
    assert.equal(getByRegion(BORDER_FRICTION_ZONES, 'Latin America').length, 1);
  });
});

// ── getNuclearRisk ────────────────────────────────────────────────────────────

describe('getNuclearRisk', () => {
  it('returns empty for empty input', () => {
    assert.equal(getNuclearRisk([]).length, 0);
  });

  it('all returned zones have nuclearRisk true', () => {
    for (const z of getNuclearRisk(BORDER_FRICTION_ZONES)) {
      assert.equal(z.nuclearRisk, true);
    }
  });

  it('china-taiwan-adiz is a nuclear-risk zone', () => {
    assert.ok(getNuclearRisk(BORDER_FRICTION_ZONES).some((z) => z.id === 'china-taiwan-adiz'));
  });

  it('ecuador-colombia is NOT a nuclear-risk zone', () => {
    assert.ok(!getNuclearRisk(BORDER_FRICTION_ZONES).some((z) => z.id === 'ecuador-colombia'));
  });

  it('nuclear-risk count is 5', () => {
    assert.equal(getNuclearRisk(BORDER_FRICTION_ZONES).length, 5);
  });
});

// ── computeGlobalMIDIndex ─────────────────────────────────────────────────────

describe('computeGlobalMIDIndex', () => {
  it('returns 0 for empty array', () => {
    assert.equal(computeGlobalMIDIndex([]), 0);
  });

  it('returns a number in [0, 100]', () => {
    const idx = computeGlobalMIDIndex(BORDER_FRICTION_ZONES);
    assert.ok(idx >= 0 && idx <= 100, `Index out of range: ${idx}`);
  });

  it('single zone with potential 10, escalating, nuclear yields near-100', () => {
    const zone: BorderFrictionZone = {
      id: 'x', parties: ['A', 'B'], region: 'X', incidentType: ['Fire'],
      monthlyFrequency: 1, trend: 'escalating', nuclearRisk: true,
      escalationPotential: 10, description: '', lastIncident: '',
    };
    const idx = computeGlobalMIDIndex([zone]);
    assert.ok(idx >= 90, `Expected near-100, got ${idx}`);
  });

  it('single zone with potential 1, stable, no nuclear yields low index', () => {
    const zone: BorderFrictionZone = {
      id: 'x', parties: ['A', 'B'], region: 'X', incidentType: ['Display'],
      monthlyFrequency: 1, trend: 'stable', nuclearRisk: false,
      escalationPotential: 1, description: '', lastIncident: '',
    };
    const idx = computeGlobalMIDIndex([zone]);
    assert.ok(idx < 20, `Expected low index, got ${idx}`);
  });

  it('more nuclear zones yields higher index (same potential, same trend)', () => {
    const base: BorderFrictionZone = {
      id: 'x', parties: ['A', 'B'], region: 'X', incidentType: ['Fire'],
      monthlyFrequency: 1, trend: 'stable', nuclearRisk: false,
      escalationPotential: 5, description: '', lastIncident: '',
    };
    const nuclear: BorderFrictionZone = { ...base, nuclearRisk: true };
    const withNuclear = computeGlobalMIDIndex([nuclear, base]);
    const withoutNuclear = computeGlobalMIDIndex([base, base]);
    assert.ok(withNuclear > withoutNuclear);
  });

  it('more escalating zones yields higher index (same potential, no nuclear)', () => {
    const stable: BorderFrictionZone = {
      id: 'x', parties: ['A', 'B'], region: 'X', incidentType: ['Fire'],
      monthlyFrequency: 1, trend: 'stable', nuclearRisk: false,
      escalationPotential: 5, description: '', lastIncident: '',
    };
    const esc: BorderFrictionZone = { ...stable, trend: 'escalating' };
    const withEsc    = computeGlobalMIDIndex([esc, stable]);
    const withoutEsc = computeGlobalMIDIndex([stable, stable]);
    assert.ok(withEsc > withoutEsc);
  });

  it('clamps at 100 for extreme inputs', () => {
    const maxZone: BorderFrictionZone = {
      id: 'x', parties: ['A', 'B'], region: 'X', incidentType: ['Fire'],
      monthlyFrequency: 9999, trend: 'escalating', nuclearRisk: true,
      escalationPotential: 10, description: '', lastIncident: '',
    };
    assert.equal(computeGlobalMIDIndex([maxZone]), 100);
  });
});

// ── incidentTypeClass ─────────────────────────────────────────────────────────

describe('incidentTypeClass', () => {
  it('Fire returns "mid-type--fire"', () => {
    assert.equal(incidentTypeClass('Fire'), 'mid-type--fire');
  });

  it('Maneuver returns "mid-type--maneuver"', () => {
    assert.equal(incidentTypeClass('Maneuver'), 'mid-type--maneuver');
  });

  it('Display returns "mid-type--display"', () => {
    assert.equal(incidentTypeClass('Display'), 'mid-type--display');
  });

  it('Blockade returns "mid-type--blockade"', () => {
    assert.equal(incidentTypeClass('Blockade'), 'mid-type--blockade');
  });

  it('Seizure returns "mid-type--seizure"', () => {
    assert.equal(incidentTypeClass('Seizure'), 'mid-type--seizure');
  });

  it('all 5 types return distinct class strings', () => {
    const classes = ['Fire', 'Maneuver', 'Display', 'Blockade', 'Seizure']
      .map((t) => incidentTypeClass(t as any));
    assert.equal(new Set(classes).size, 5);
  });

  it('all returned strings start with "mid-type--"', () => {
    for (const t of ['Fire', 'Maneuver', 'Display', 'Blockade', 'Seizure'] as const) {
      assert.ok(incidentTypeClass(t).startsWith('mid-type--'));
    }
  });
});

// ── intensityClass ────────────────────────────────────────────────────────────

describe('intensityClass', () => {
  function zone(pot: number, freq: number): BorderFrictionZone {
    return {
      id: 'test', parties: ['A', 'B'], region: 'X', incidentType: ['Fire'],
      monthlyFrequency: freq, trend: 'stable', nuclearRisk: false,
      escalationPotential: pot, description: '', lastIncident: '',
    };
  }

  it('potential 8 returns "mid-intensity--critical"', () => {
    assert.equal(intensityClass(zone(8, 1)), 'mid-intensity--critical');
  });

  it('monthlyFrequency 51 returns "mid-intensity--critical"', () => {
    assert.equal(intensityClass(zone(3, 51)), 'mid-intensity--critical');
  });

  it('potential 6, freq 1 returns "mid-intensity--high"', () => {
    assert.equal(intensityClass(zone(6, 1)), 'mid-intensity--high');
  });

  it('monthlyFrequency 11, potential 3 returns "mid-intensity--high"', () => {
    assert.equal(intensityClass(zone(3, 11)), 'mid-intensity--high');
  });

  it('potential 4, freq 1 returns "mid-intensity--medium"', () => {
    assert.equal(intensityClass(zone(4, 1)), 'mid-intensity--medium');
  });

  it('potential 2, freq 1 returns "mid-intensity--low"', () => {
    assert.equal(intensityClass(zone(2, 1)), 'mid-intensity--low');
  });

  it('all BORDER_FRICTION_ZONES return a valid intensity class', () => {
    const valid = new Set(['mid-intensity--critical', 'mid-intensity--high', 'mid-intensity--medium', 'mid-intensity--low']);
    for (const z of BORDER_FRICTION_ZONES) {
      assert.ok(valid.has(intensityClass(z)), `${z.id} returned invalid class: ${intensityClass(z)}`);
    }
  });
});

// ── buildRenderData ───────────────────────────────────────────────────────────

describe('buildRenderData', () => {
  it('returns an object with zones, globalMIDIndex, highIntensityCount, escalatingCount, nuclearRiskCount', () => {
    const d = buildRenderData();
    assert.ok('zones' in d);
    assert.ok('globalMIDIndex' in d);
    assert.ok('highIntensityCount' in d);
    assert.ok('escalatingCount' in d);
    assert.ok('nuclearRiskCount' in d);
  });

  it('zones.length equals 12 for default input', () => {
    assert.equal(buildRenderData().zones.length, 12);
  });

  it('zones are sorted by escalationPotential descending', () => {
    const zones = buildRenderData().zones;
    for (let i = 0; i < zones.length - 1; i++) {
      assert.ok(
        zones[i].escalationPotential >= zones[i + 1].escalationPotential,
        `Sort broken at index ${i}: ${zones[i].escalationPotential} < ${zones[i + 1].escalationPotential}`,
      );
    }
  });

  it('globalMIDIndex is in [0, 100]', () => {
    const idx = buildRenderData().globalMIDIndex;
    assert.ok(idx >= 0 && idx <= 100);
  });

  it('highIntensityCount matches getHighIntensity().length', () => {
    const d = buildRenderData();
    assert.equal(d.highIntensityCount, getHighIntensity(BORDER_FRICTION_ZONES).length);
  });

  it('escalatingCount matches getEscalating().length', () => {
    const d = buildRenderData();
    assert.equal(d.escalatingCount, getEscalating(BORDER_FRICTION_ZONES).length);
  });

  it('nuclearRiskCount matches getNuclearRisk().length', () => {
    const d = buildRenderData();
    assert.equal(d.nuclearRiskCount, getNuclearRisk(BORDER_FRICTION_ZONES).length);
  });

  it('accepts a custom zones array', () => {
    const custom: BorderFrictionZone[] = [
      {
        id: 'a', parties: ['X', 'Y'], region: 'Test', incidentType: ['Fire'],
        monthlyFrequency: 5, trend: 'stable', nuclearRisk: false,
        escalationPotential: 3, description: '', lastIncident: '',
      },
    ];
    const d = buildRenderData(custom);
    assert.equal(d.zones.length, 1);
    assert.equal(d.highIntensityCount, 0);
    assert.equal(d.nuclearRiskCount, 0);
  });

  it('does not mutate the original BORDER_FRICTION_ZONES array order', () => {
    const before = BORDER_FRICTION_ZONES.map((z) => z.id);
    buildRenderData();
    const after = BORDER_FRICTION_ZONES.map((z) => z.id);
    assert.deepEqual(before, after);
  });
});
