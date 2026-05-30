import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  getByCountry,
  getByFunction,
  getHighRisk,
  computeStateCapitalismIndex,
  functionClass,
  riskClass,
  buildRenderData,
  SOES,
  SOE_INCIDENTS,
  STATE_CAPITALISM_INDEX,
  type SOE,
  type SOEIncident,
  type StateCapitalismCountry,
  type GeopoliticalRisk,
  type StrategicFunction,
} from '../state-capitalism-helpers.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function mkSOE(overrides: Partial<SOE> = {}): SOE {
  return {
    id: 'TEST001',
    name: 'TestCorp',
    country: 'Testland',
    sector: 'Energy',
    revenueUSD: 100,
    strategicFunction: 'Energy Leverage',
    geopoliticalRisk: 'High',
    description: 'Test description',
    ...overrides,
  };
}

function mkCountry(overrides: Partial<StateCapitalismCountry> = {}): StateCapitalismCountry {
  return {
    country: 'Testland',
    code: 'TS',
    index: 50,
    description: 'Test',
    ...overrides,
  };
}

const MINI_SOES: SOE[] = [
  mkSOE({ id: 'A', name: 'Alpha',   country: 'China',  geopoliticalRisk: 'Critical', strategicFunction: 'Energy Leverage' }),
  mkSOE({ id: 'B', name: 'Beta',    country: 'Russia', geopoliticalRisk: 'Critical', strategicFunction: 'Sanctions Evasion' }),
  mkSOE({ id: 'C', name: 'Gamma',   country: 'China',  geopoliticalRisk: 'High',     strategicFunction: 'Port Access' }),
  mkSOE({ id: 'D', name: 'Delta',   country: 'France', geopoliticalRisk: 'Low',      strategicFunction: 'Nuclear / Energy Policy' }),
  mkSOE({ id: 'E', name: 'Epsilon', country: 'UAE',    geopoliticalRisk: 'Medium',   strategicFunction: 'Market Dominance' }),
];

const MINI_COUNTRIES: StateCapitalismCountry[] = [
  mkCountry({ country: 'China',  index: 92 }),
  mkCountry({ country: 'Russia', index: 85 }),
  mkCountry({ country: 'France', index: 45 }),
  mkCountry({ country: 'USA',    index: 12 }),
];

// ── getByCountry ──────────────────────────────────────────────────────────────

describe('getByCountry', () => {
  it('returns all SOEs for a given country', () => {
    const result = getByCountry(MINI_SOES, 'China');
    assert.equal(result.length, 2);
    assert.ok(result.every(s => s.country === 'China'));
  });

  it('returns single SOE for unique country', () => {
    const result = getByCountry(MINI_SOES, 'Russia');
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'Beta');
  });

  it('returns empty array for unknown country', () => {
    assert.deepEqual(getByCountry(MINI_SOES, 'Nowhere'), []);
  });

  it('is case-sensitive', () => {
    assert.deepEqual(getByCountry(MINI_SOES, 'china'), []);
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(getByCountry([], 'China'), []);
  });

  it('does not mutate the input array', () => {
    const copy = [...MINI_SOES];
    getByCountry(MINI_SOES, 'China');
    assert.deepEqual(MINI_SOES, copy);
  });
});

// ── getByFunction ─────────────────────────────────────────────────────────────

describe('getByFunction', () => {
  it('returns SOEs matching a strategic function', () => {
    const result = getByFunction(MINI_SOES, 'Energy Leverage');
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'Alpha');
  });

  it('returns multiple SOEs for shared function', () => {
    const soes = [
      mkSOE({ id: 'X', strategicFunction: 'Port Access' }),
      mkSOE({ id: 'Y', strategicFunction: 'Port Access' }),
      mkSOE({ id: 'Z', strategicFunction: 'Tech Espionage' }),
    ];
    assert.equal(getByFunction(soes, 'Port Access').length, 2);
  });

  it('returns empty array when no match', () => {
    assert.deepEqual(getByFunction(MINI_SOES, 'Tech Espionage'), []);
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(getByFunction([], 'Energy Leverage'), []);
  });

  it('Nuclear / Energy Policy function works', () => {
    const result = getByFunction(MINI_SOES, 'Nuclear / Energy Policy');
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'Delta');
  });
});

// ── getHighRisk ───────────────────────────────────────────────────────────────

describe('getHighRisk', () => {
  it('returns Critical and High risk SOEs only', () => {
    const result = getHighRisk(MINI_SOES);
    assert.equal(result.length, 3);
    assert.ok(result.every(s => s.geopoliticalRisk === 'Critical' || s.geopoliticalRisk === 'High'));
  });

  it('excludes Medium risk', () => {
    const result = getHighRisk(MINI_SOES);
    assert.ok(result.every(s => s.geopoliticalRisk !== 'Medium'));
  });

  it('excludes Low risk', () => {
    const result = getHighRisk(MINI_SOES);
    assert.ok(result.every(s => s.geopoliticalRisk !== 'Low'));
  });

  it('returns empty array for all low-risk SOEs', () => {
    const low = [mkSOE({ geopoliticalRisk: 'Low' }), mkSOE({ geopoliticalRisk: 'Medium' })];
    assert.deepEqual(getHighRisk(low), []);
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(getHighRisk([]), []);
  });
});

// ── computeStateCapitalismIndex ───────────────────────────────────────────────

describe('computeStateCapitalismIndex', () => {
  it('computes average of indices', () => {
    const countries = [
      mkCountry({ index: 80 }),
      mkCountry({ index: 60 }),
      mkCountry({ index: 40 }),
    ];
    assert.equal(computeStateCapitalismIndex(countries), 60);
  });

  it('rounds to nearest integer', () => {
    const countries = [mkCountry({ index: 10 }), mkCountry({ index: 11 })];
    assert.equal(computeStateCapitalismIndex(countries), 11);
  });

  it('returns 0 for empty array', () => {
    assert.equal(computeStateCapitalismIndex([]), 0);
  });

  it('returns single value unchanged', () => {
    assert.equal(computeStateCapitalismIndex([mkCountry({ index: 75 })]), 75);
  });

  it('works on MINI_COUNTRIES fixture', () => {
    const result = computeStateCapitalismIndex(MINI_COUNTRIES);
    assert.equal(result, Math.round((92 + 85 + 45 + 12) / 4));
  });
});

// ── functionClass ─────────────────────────────────────────────────────────────

describe('functionClass', () => {
  it('Energy Leverage -> sc-func-energy', () => {
    assert.equal(functionClass('Energy Leverage'), 'sc-func-energy');
  });

  it('Port Access -> sc-func-port', () => {
    assert.equal(functionClass('Port Access'), 'sc-func-port');
  });

  it('Tech Espionage -> sc-func-tech', () => {
    assert.equal(functionClass('Tech Espionage'), 'sc-func-tech');
  });

  it('Sanctions Evasion -> sc-func-sanctions', () => {
    assert.equal(functionClass('Sanctions Evasion'), 'sc-func-sanctions');
  });

  it('Market Dominance -> sc-func-market', () => {
    assert.equal(functionClass('Market Dominance'), 'sc-func-market');
  });

  it('Weapons Export -> sc-func-weapons', () => {
    assert.equal(functionClass('Weapons Export'), 'sc-func-weapons');
  });

  it('Financial Control -> sc-func-finance', () => {
    assert.equal(functionClass('Financial Control'), 'sc-func-finance');
  });

  it('Nuclear / Energy Policy -> sc-func-nuclear', () => {
    assert.equal(functionClass('Nuclear / Energy Policy'), 'sc-func-nuclear');
  });

  it('returns a non-empty string for every StrategicFunction value', () => {
    const fns: StrategicFunction[] = [
      'Energy Leverage', 'Port Access', 'Tech Espionage', 'Sanctions Evasion',
      'Market Dominance', 'Weapons Export', 'Financial Control', 'Nuclear / Energy Policy',
    ];
    for (const fn of fns) {
      assert.ok(functionClass(fn).length > 0, `functionClass('${fn}') must be non-empty`);
    }
  });
});

// ── riskClass ─────────────────────────────────────────────────────────────────

describe('riskClass', () => {
  it('Critical -> sc-risk-critical', () => {
    assert.equal(riskClass('Critical'), 'sc-risk-critical');
  });

  it('High -> sc-risk-high', () => {
    assert.equal(riskClass('High'), 'sc-risk-high');
  });

  it('Medium -> sc-risk-medium', () => {
    assert.equal(riskClass('Medium'), 'sc-risk-medium');
  });

  it('Low -> sc-risk-low', () => {
    assert.equal(riskClass('Low'), 'sc-risk-low');
  });

  it('returns distinct classes for each risk level', () => {
    const risks: GeopoliticalRisk[] = ['Critical', 'High', 'Medium', 'Low'];
    const classes = risks.map(riskClass);
    assert.equal(new Set(classes).size, 4);
  });
});

// ── buildRenderData ───────────────────────────────────────────────────────────

describe('buildRenderData', () => {
  it('returns all 12 SOEs', () => {
    const data = buildRenderData();
    assert.equal(data.soes.length, 12);
  });

  it('returns all 8 incidents', () => {
    const data = buildRenderData();
    assert.equal(data.incidents.length, 8);
  });

  it('returns 10 countries in state capitalism index', () => {
    const data = buildRenderData();
    assert.equal(data.stateCapitalismIndex.length, 10);
  });

  it('criticalCount is correct', () => {
    const data = buildRenderData();
    const expected = SOES.filter(s => s.geopoliticalRisk === 'Critical').length;
    assert.equal(data.criticalCount, expected);
  });

  it('highRiskCount is correct', () => {
    const data = buildRenderData();
    const expected = SOES.filter(s => s.geopoliticalRisk === 'High').length;
    assert.equal(data.highRiskCount, expected);
  });

  it('totalRevenueTrillion is positive', () => {
    const data = buildRenderData();
    assert.ok(data.totalRevenueTrillion > 0);
  });

  it('totalRevenueTrillion matches sum of SOE revenues / 1000', () => {
    const data = buildRenderData();
    const expected = parseFloat((SOES.reduce((acc, s) => acc + s.revenueUSD, 0) / 1000).toFixed(1));
    assert.equal(data.totalRevenueTrillion, expected);
  });

  it('topCountryByControl is China (highest index = 92)', () => {
    const data = buildRenderData();
    assert.equal(data.topCountryByControl, 'China');
  });

  it('criticalCount + highRiskCount <= total SOE count', () => {
    const data = buildRenderData();
    assert.ok(data.criticalCount + data.highRiskCount <= data.soes.length);
  });

  it('soes reference is the SOES constant', () => {
    const data = buildRenderData();
    assert.strictEqual(data.soes, SOES);
  });
});

// ── SOES static data integrity ────────────────────────────────────────────────

describe('SOES static data', () => {
  it('all SOEs have unique ids', () => {
    const ids = SOES.map(s => s.id);
    assert.equal(new Set(ids).size, SOES.length);
  });

  it('all SOEs have positive revenueUSD', () => {
    assert.ok(SOES.every(s => s.revenueUSD > 0));
  });

  it('all SOEs have non-empty name', () => {
    assert.ok(SOES.every(s => s.name.length > 0));
  });

  it('all SOEs have a valid geopoliticalRisk value', () => {
    const valid = new Set<string>(['Critical', 'High', 'Medium', 'Low']);
    assert.ok(SOES.every(s => valid.has(s.geopoliticalRisk)));
  });

  it('COSCO is in SOES', () => {
    assert.ok(SOES.some(s => s.name.includes('COSCO')));
  });

  it('Gazprom is in SOES with Energy Leverage function', () => {
    const g = SOES.find(s => s.name === 'Gazprom');
    assert.ok(g);
    assert.equal(g?.strategicFunction, 'Energy Leverage');
  });

  it('State Grid Corporation has the highest revenue', () => {
    const aramco = SOES.find(s => s.name === 'State Grid Corporation');
    assert.ok(aramco);
    const maxRev = Math.max(...SOES.map(s => s.revenueUSD));
    assert.equal(aramco?.revenueUSD, maxRev);
  });
});

// ── SOE_INCIDENTS static data integrity ───────────────────────────────────────

describe('SOE_INCIDENTS static data', () => {
  it('all incidents have unique ids', () => {
    const ids = SOE_INCIDENTS.map(i => i.id);
    assert.equal(new Set(ids).size, SOE_INCIDENTS.length);
  });

  it('all incidents have severity between 1 and 10', () => {
    assert.ok(SOE_INCIDENTS.every(i => i.severity >= 1 && i.severity <= 10));
  });

  it('Gazprom Nord Stream incident has max severity 10', () => {
    const inc = SOE_INCIDENTS.find(i => i.entity === 'Gazprom');
    assert.ok(inc);
    assert.equal(inc?.severity, 10);
  });

  it('all incidents have non-empty description', () => {
    assert.ok(SOE_INCIDENTS.every(i => i.description.length > 0));
  });
});

// ── STATE_CAPITALISM_INDEX static data integrity ──────────────────────────────

describe('STATE_CAPITALISM_INDEX static data', () => {
  it('all indices are between 0 and 100', () => {
    assert.ok(STATE_CAPITALISM_INDEX.every(c => c.index >= 0 && c.index <= 100));
  });

  it('China has the highest index', () => {
    const china = STATE_CAPITALISM_INDEX.find(c => c.country === 'China');
    const max = Math.max(...STATE_CAPITALISM_INDEX.map(c => c.index));
    assert.equal(china?.index, max);
  });

  it('USA has the lowest index', () => {
    const usa = STATE_CAPITALISM_INDEX.find(c => c.country === 'USA');
    const min = Math.min(...STATE_CAPITALISM_INDEX.map(c => c.index));
    assert.equal(usa?.index, min);
  });

  it('all countries have 2-letter codes', () => {
    assert.ok(STATE_CAPITALISM_INDEX.every(c => c.code.length === 2));
  });

  it('all countries have non-empty descriptions', () => {
    assert.ok(STATE_CAPITALISM_INDEX.every(c => c.description.length > 0));
  });
});
