import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  getByCountry,
  getByFunction,
  getCriticalRisk,
  computeStateCapIndex,
  topCountryBySoeCount,
  functionClass,
  riskClass,
  buildRenderData,
  type StrategicSOE,
  type StrategicFunction,
  type GeopoliticalRiskLevel,
} from '../state-capitalism-helpers.ts';

// ── Mock data ─────────────────────────────────────────────────────────────────
const MOCK_SOES: StrategicSOE[] = [
  { id: 'S1', name: 'Alpha Corp', country: 'China', sector: 'Telecom', annualRevenueBn: 100, strategicFunction: 'Tech Espionage', geopoliticalRiskLevel: 'Critical', description: 'Desc A', recentIncident: 'Banned in EU' },
  { id: 'S2', name: 'Beta Oil', country: 'Russia', sector: 'Oil', annualRevenueBn: 200, strategicFunction: 'Energy Leverage', geopoliticalRiskLevel: 'High', description: 'Desc B', recentIncident: 'Sanctioned' },
  { id: 'S3', name: 'Gamma Ports', country: 'China', sector: 'Shipping', annualRevenueBn: 50, strategicFunction: 'Port Access', geopoliticalRiskLevel: 'Critical', description: 'Desc C', recentIncident: 'CFIUS blocked' },
  { id: 'S4', name: 'Delta Investments', country: 'UAE', sector: 'Finance', annualRevenueBn: 20, strategicFunction: 'Market Dominance', geopoliticalRiskLevel: 'Medium', description: 'Desc D', recentIncident: 'Scrutinized' },
  { id: 'S5', name: 'Epsilon Arms', country: 'Russia', sector: 'Defense', annualRevenueBn: 15, strategicFunction: 'Defense Export', geopoliticalRiskLevel: 'High', description: 'Desc E', recentIncident: 'Arms to Iran' },
  { id: 'S6', name: 'Zeta Evasion', country: 'Russia', sector: 'Oil', annualRevenueBn: 80, strategicFunction: 'Sanctions Evasion', geopoliticalRiskLevel: 'High', description: 'Desc F', recentIncident: 'Shadow fleet' },
  { id: 'S7', name: 'Eta Grid', country: 'China', sector: 'Power', annualRevenueBn: 530, strategicFunction: 'Market Dominance', geopoliticalRiskLevel: 'High', description: 'Desc G', recentIncident: 'Blocked in AU' },
];

// ── getByCountry ──────────────────────────────────────────────────────────────
describe('getByCountry', () => {
  it('returns only SOEs matching the given country', () => {
    const cn = getByCountry(MOCK_SOES, 'China');
    assert.equal(cn.length, 3);
    assert.ok(cn.every(s => s.country === 'China'));
  });
  it('returns only Russia SOEs', () => {
    const ru = getByCountry(MOCK_SOES, 'Russia');
    assert.equal(ru.length, 3);
  });
  it('returns empty array for unknown country', () => {
    assert.equal(getByCountry(MOCK_SOES, 'Atlantis').length, 0);
  });
  it('does not mutate the source array', () => {
    const before = MOCK_SOES.length;
    getByCountry(MOCK_SOES, 'China');
    assert.equal(MOCK_SOES.length, before);
  });
  it('returns single match for UAE', () => {
    const uae = getByCountry(MOCK_SOES, 'UAE');
    assert.equal(uae.length, 1);
    assert.equal(uae[0].id, 'S4');
  });
  it('is case-sensitive (china vs China)', () => {
    assert.equal(getByCountry(MOCK_SOES, 'china').length, 0);
  });
});

// ── getByFunction ─────────────────────────────────────────────────────────────
describe('getByFunction', () => {
  it('returns Tech Espionage SOEs', () => {
    const tech = getByFunction(MOCK_SOES, 'Tech Espionage');
    assert.equal(tech.length, 1);
    assert.equal(tech[0].id, 'S1');
  });
  it('returns Energy Leverage SOEs', () => {
    const en = getByFunction(MOCK_SOES, 'Energy Leverage');
    assert.equal(en.length, 1);
    assert.equal(en[0].id, 'S2');
  });
  it('returns Port Access SOEs', () => {
    const p = getByFunction(MOCK_SOES, 'Port Access');
    assert.equal(p.length, 1);
    assert.equal(p[0].id, 'S3');
  });
  it('returns Market Dominance SOEs (2 entries)', () => {
    const md = getByFunction(MOCK_SOES, 'Market Dominance');
    assert.equal(md.length, 2);
    assert.ok(md.every(s => s.strategicFunction === 'Market Dominance'));
  });
  it('returns Defense Export SOEs', () => {
    const de = getByFunction(MOCK_SOES, 'Defense Export');
    assert.equal(de.length, 1);
    assert.equal(de[0].id, 'S5');
  });
  it('returns Sanctions Evasion SOEs', () => {
    const se = getByFunction(MOCK_SOES, 'Sanctions Evasion');
    assert.equal(se.length, 1);
    assert.equal(se[0].id, 'S6');
  });
  it('returns empty array when no match', () => {
    const allEnergy = MOCK_SOES.map(s => ({ ...s, strategicFunction: 'Energy Leverage' as StrategicFunction }));
    assert.equal(getByFunction(allEnergy, 'Tech Espionage').length, 0);
  });
});

// ── getCriticalRisk ───────────────────────────────────────────────────────────
describe('getCriticalRisk', () => {
  it('returns only Critical risk SOEs', () => {
    const crit = getCriticalRisk(MOCK_SOES);
    assert.equal(crit.length, 2);
    assert.ok(crit.every(s => s.geopoliticalRiskLevel === 'Critical'));
  });
  it('returns empty array when no Critical SOEs', () => {
    const low = MOCK_SOES.map(s => ({ ...s, geopoliticalRiskLevel: 'Low' as GeopoliticalRiskLevel }));
    assert.equal(getCriticalRisk(low).length, 0);
  });
  it('does not include High risk SOEs', () => {
    const crit = getCriticalRisk(MOCK_SOES);
    assert.ok(crit.every(s => s.geopoliticalRiskLevel !== 'High'));
  });
  it('returns all when all are Critical', () => {
    const all = MOCK_SOES.map(s => ({ ...s, geopoliticalRiskLevel: 'Critical' as GeopoliticalRiskLevel }));
    assert.equal(getCriticalRisk(all).length, MOCK_SOES.length);
  });
  it('handles empty array', () => {
    assert.equal(getCriticalRisk([]).length, 0);
  });
});

// ── computeStateCapIndex ──────────────────────────────────────────────────────
describe('computeStateCapIndex', () => {
  it('returns a number', () => {
    assert.equal(typeof computeStateCapIndex({ China: 92, Russia: 88 }, { China: 18, Russia: 2 }), 'number');
  });
  it('returns 0 for empty index', () => {
    assert.equal(computeStateCapIndex({}, {}), 0);
  });
  it('returns the single value for one country', () => {
    assert.equal(computeStateCapIndex({ China: 90 }, { China: 10 }), 90);
  });
  it('higher-weighted countries influence result more', () => {
    const highChinaWeight = computeStateCapIndex({ China: 92, USA: 20 }, { China: 100, USA: 1 });
    const equalWeight = computeStateCapIndex({ China: 92, USA: 20 }, { China: 1, USA: 1 });
    assert.ok(highChinaWeight > equalWeight);
  });
  it('result is an integer (rounded)', () => {
    const idx = computeStateCapIndex({ A: 91, B: 87 }, { A: 3, B: 5 });
    assert.equal(idx, Math.round(idx));
  });
  it('handles missing weight with fallback of 1', () => {
    const idx = computeStateCapIndex({ X: 50, Y: 50 }, {});
    assert.equal(idx, 50);
  });
  it('returns correct weighted average for equal weights', () => {
    const idx = computeStateCapIndex({ A: 80, B: 60 }, { A: 1, B: 1 });
    assert.equal(idx, 70);
  });
});

// ── topCountryBySoeCount ──────────────────────────────────────────────────────
describe('topCountryBySoeCount', () => {
  it('returns China as top country (3 SOEs in mock)', () => {
    assert.equal(topCountryBySoeCount(MOCK_SOES), 'China');
  });
  it('returns N/A for empty array', () => {
    assert.equal(topCountryBySoeCount([]), 'N/A');
  });
  it('returns the sole country in a single-element array', () => {
    assert.equal(topCountryBySoeCount([MOCK_SOES[0]]), 'China');
  });
  it('returns the country with most SOEs', () => {
    const soes = [
      { ...MOCK_SOES[0], country: 'USA' },
      { ...MOCK_SOES[1], country: 'USA' },
      { ...MOCK_SOES[2], country: 'USA' },
      { ...MOCK_SOES[3], country: 'France' },
    ];
    assert.equal(topCountryBySoeCount(soes), 'USA');
  });
});

// ── functionClass ─────────────────────────────────────────────────────────────
describe('functionClass', () => {
  it('returns fn-energy for Energy Leverage', () => {
    assert.equal(functionClass('Energy Leverage'), 'fn-energy');
  });
  it('returns fn-port for Port Access', () => {
    assert.equal(functionClass('Port Access'), 'fn-port');
  });
  it('returns fn-tech for Tech Espionage', () => {
    assert.equal(functionClass('Tech Espionage'), 'fn-tech');
  });
  it('returns fn-sanctions for Sanctions Evasion', () => {
    assert.equal(functionClass('Sanctions Evasion'), 'fn-sanctions');
  });
  it('returns fn-market for Market Dominance', () => {
    assert.equal(functionClass('Market Dominance'), 'fn-market');
  });
  it('returns fn-defense for Defense Export', () => {
    assert.equal(functionClass('Defense Export'), 'fn-defense');
  });
  it('all functions return a string starting with fn-', () => {
    const all: StrategicFunction[] = [
      'Energy Leverage', 'Port Access', 'Tech Espionage',
      'Sanctions Evasion', 'Market Dominance', 'Defense Export',
    ];
    for (const fn of all) {
      assert.ok(functionClass(fn).startsWith('fn-'), `${fn} => ${functionClass(fn)}`);
    }
  });
});

// ── riskClass ─────────────────────────────────────────────────────────────────
describe('riskClass', () => {
  it('returns risk-critical for Critical', () => {
    assert.equal(riskClass('Critical'), 'risk-critical');
  });
  it('returns risk-high for High', () => {
    assert.equal(riskClass('High'), 'risk-high');
  });
  it('returns risk-medium for Medium', () => {
    assert.equal(riskClass('Medium'), 'risk-medium');
  });
  it('returns risk-low for Low', () => {
    assert.equal(riskClass('Low'), 'risk-low');
  });
  it('all levels return a string starting with risk-', () => {
    const levels: GeopoliticalRiskLevel[] = ['Critical', 'High', 'Medium', 'Low'];
    for (const l of levels) {
      assert.ok(riskClass(l).startsWith('risk-'), `${l} => ${riskClass(l)}`);
    }
  });
});

// ── buildRenderData ───────────────────────────────────────────────────────────
describe('buildRenderData', () => {
  it('returns all required fields', () => {
    const d = buildRenderData();
    assert.ok(Array.isArray(d.soes));
    assert.ok(Array.isArray(d.incidents));
    assert.equal(typeof d.stateCapIndex, 'number');
    assert.equal(typeof d.criticalRiskCount, 'number');
    assert.equal(typeof d.highRiskCount, 'number');
    assert.equal(typeof d.topCountryByControl, 'string');
  });
  it('soes array is non-empty', () => {
    assert.ok(buildRenderData().soes.length > 0);
  });
  it('incidents array is non-empty', () => {
    assert.ok(buildRenderData().incidents.length > 0);
  });
  it('stateCapIndex is between 0 and 100', () => {
    const idx = buildRenderData().stateCapIndex;
    assert.ok(idx >= 0 && idx <= 100, `stateCapIndex ${idx} out of range`);
  });
  it('criticalRiskCount matches actual Critical SOEs', () => {
    const d = buildRenderData();
    assert.equal(d.criticalRiskCount, d.soes.filter(s => s.geopoliticalRiskLevel === 'Critical').length);
  });
  it('highRiskCount matches actual High SOEs', () => {
    const d = buildRenderData();
    assert.equal(d.highRiskCount, d.soes.filter(s => s.geopoliticalRiskLevel === 'High').length);
  });
  it('topCountryByControl is a non-empty string', () => {
    assert.ok(buildRenderData().topCountryByControl.trim().length > 0);
  });
  it('topCountryByControl is China (most SOEs)', () => {
    assert.equal(buildRenderData().topCountryByControl, 'China');
  });
  it('all SOE IDs are unique', () => {
    const ids = buildRenderData().soes.map(s => s.id);
    assert.equal(new Set(ids).size, ids.length);
  });
  it('all incident IDs are unique', () => {
    const ids = buildRenderData().incidents.map(i => i.id);
    assert.equal(new Set(ids).size, ids.length);
  });
  it('all annualRevenueBn values are positive', () => {
    for (const s of buildRenderData().soes) {
      assert.ok(s.annualRevenueBn > 0, `${s.name} revenue ${s.annualRevenueBn} not positive`);
    }
  });
  it('all SOE risk levels are valid', () => {
    const valid = new Set(['Low', 'Medium', 'High', 'Critical']);
    for (const s of buildRenderData().soes) {
      assert.ok(valid.has(s.geopoliticalRiskLevel), `Invalid risk: ${s.geopoliticalRiskLevel}`);
    }
  });
  it('all SOE strategic functions are valid', () => {
    const valid = new Set([
      'Energy Leverage', 'Port Access', 'Tech Espionage',
      'Sanctions Evasion', 'Market Dominance', 'Defense Export',
    ]);
    for (const s of buildRenderData().soes) {
      assert.ok(valid.has(s.strategicFunction), `Invalid function: ${s.strategicFunction}`);
    }
  });
  it('all incident severities are in range 1-10', () => {
    for (const inc of buildRenderData().incidents) {
      assert.ok(inc.severity >= 1 && inc.severity <= 10, `${inc.id} severity ${inc.severity} out of range`);
    }
  });
  it('all SOEs have non-empty names', () => {
    for (const s of buildRenderData().soes) {
      assert.ok(s.name.trim().length > 0, `SOE ${s.id} has empty name`);
    }
  });
  it('all SOEs have non-empty descriptions', () => {
    for (const s of buildRenderData().soes) {
      assert.ok(s.description.trim().length > 0, `SOE ${s.id} has empty description`);
    }
  });
  it('all SOEs have non-empty recentIncident', () => {
    for (const s of buildRenderData().soes) {
      assert.ok(s.recentIncident.trim().length > 0, `SOE ${s.id} has empty recentIncident`);
    }
  });
  it('all incidents have non-empty descriptions', () => {
    for (const inc of buildRenderData().incidents) {
      assert.ok(inc.description.trim().length > 0, `Incident ${inc.id} has empty description`);
    }
  });
  it('all incidents have non-empty soe field', () => {
    for (const inc of buildRenderData().incidents) {
      assert.ok(inc.soe.trim().length > 0, `Incident ${inc.id} has empty soe`);
    }
  });
  it('all incidents have non-empty date field', () => {
    for (const inc of buildRenderData().incidents) {
      assert.ok(inc.date.trim().length > 0, `Incident ${inc.id} has empty date`);
    }
  });
  it('exactly 12 SOEs are defined', () => {
    assert.equal(buildRenderData().soes.length, 12);
  });
  it('exactly 8 incidents are defined', () => {
    assert.equal(buildRenderData().incidents.length, 8);
  });
  it('China has at least 4 SOEs', () => {
    const d = buildRenderData();
    assert.ok(getByCountry(d.soes, 'China').length >= 4);
  });
  it('Russia has at least 3 SOEs', () => {
    const d = buildRenderData();
    assert.ok(getByCountry(d.soes, 'Russia').length >= 3);
  });
  it('all SOE countries are non-empty strings', () => {
    for (const s of buildRenderData().soes) {
      assert.ok(s.country.trim().length > 0);
    }
  });
  it('all SOE sectors are non-empty strings', () => {
    for (const s of buildRenderData().soes) {
      assert.ok(s.sector.trim().length > 0);
    }
  });
  it('stateCapIndex is an integer', () => {
    const idx = buildRenderData().stateCapIndex;
    assert.equal(idx, Math.round(idx));
  });
  it('criticalRiskCount is non-negative', () => {
    assert.ok(buildRenderData().criticalRiskCount >= 0);
  });
  it('highRiskCount is non-negative', () => {
    assert.ok(buildRenderData().highRiskCount >= 0);
  });
});
