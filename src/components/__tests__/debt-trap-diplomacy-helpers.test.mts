import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  getAtRiskCountries,
  getByStatus,
  getHighDebtRatio,
  computeVulnerabilityIndex,
  statusClass,
  leverageClass,
  buildRenderData,
  type BriDebtor,
  type DebtorStatus,
  type LeverageType,
} from '../debt-trap-diplomacy-helpers.js';

// ---- Fixtures ------------------------------------------------------------------

function makeDebtor(overrides: Partial<BriDebtor> = {}): BriDebtor {
  return {
    id: 'TEST',
    country: 'Testland',
    iso3: 'TST',
    debtToChinaBn: 5,
    debtToGdpPct: 60,
    chineseDebtToGdpPct: 15,
    strategicAsset: 'Test Port',
    status: 'At Risk',
    leverageType: 'Port/Infrastructure',
    notes: 'test notes',
    ...overrides,
  };
}

// ---- getAtRiskCountries --------------------------------------------------------

describe('getAtRiskCountries', () => {
  test('empty array returns empty array', () => {
    assert.deepEqual(getAtRiskCountries([]), []);
  });
  test('returns only At Risk debtors', () => {
    const pool = [
      makeDebtor({ id: 'A', status: 'At Risk' }),
      makeDebtor({ id: 'B', status: 'Defaulted' }),
      makeDebtor({ id: 'C', status: 'At Risk' }),
    ];
    const result = getAtRiskCountries(pool);
    assert.equal(result.length, 2);
    assert.ok(result.every((d) => d.status === 'At Risk'));
  });
  test('excludes Defaulted', () => {
    const pool = [makeDebtor({ status: 'Defaulted' })];
    assert.equal(getAtRiskCountries(pool).length, 0);
  });
  test('excludes Restructuring', () => {
    const pool = [makeDebtor({ status: 'Restructuring' })];
    assert.equal(getAtRiskCountries(pool).length, 0);
  });
  test('excludes Repaying', () => {
    const pool = [makeDebtor({ status: 'Repaying' })];
    assert.equal(getAtRiskCountries(pool).length, 0);
  });
  test('all At Risk returns all', () => {
    const pool = [makeDebtor({ status: 'At Risk' }), makeDebtor({ status: 'At Risk' })];
    assert.equal(getAtRiskCountries(pool).length, 2);
  });
});

// ---- getByStatus ---------------------------------------------------------------

describe('getByStatus', () => {
  const pool: BriDebtor[] = [
    makeDebtor({ id: 'S1', status: 'At Risk' }),
    makeDebtor({ id: 'S2', status: 'Defaulted' }),
    makeDebtor({ id: 'S3', status: 'Restructuring' }),
    makeDebtor({ id: 'S4', status: 'Repaying' }),
    makeDebtor({ id: 'S5', status: 'At Risk' }),
  ];
  test('empty array returns empty', () => {
    assert.deepEqual(getByStatus([], 'At Risk'), []);
  });
  test('At Risk filter returns matching', () => {
    const r = getByStatus(pool, 'At Risk');
    assert.equal(r.length, 2);
    assert.ok(r.every((d) => d.status === 'At Risk'));
  });
  test('Defaulted filter', () => {
    const r = getByStatus(pool, 'Defaulted');
    assert.equal(r.length, 1);
    assert.equal(r[0].id, 'S2');
  });
  test('Restructuring filter', () => {
    const r = getByStatus(pool, 'Restructuring');
    assert.equal(r.length, 1);
    assert.equal(r[0].id, 'S3');
  });
  test('Repaying filter', () => {
    const r = getByStatus(pool, 'Repaying');
    assert.equal(r.length, 1);
    assert.equal(r[0].id, 'S4');
  });
  test('no match returns empty', () => {
    const r = getByStatus([makeDebtor({ status: 'Repaying' })], 'Defaulted');
    assert.equal(r.length, 0);
  });
});

// ---- getHighDebtRatio ----------------------------------------------------------

describe('getHighDebtRatio', () => {
  const pool: BriDebtor[] = [
    makeDebtor({ id: 'H1', chineseDebtToGdpPct: 10 }),
    makeDebtor({ id: 'H2', chineseDebtToGdpPct: 20 }),
    makeDebtor({ id: 'H3', chineseDebtToGdpPct: 30 }),
    makeDebtor({ id: 'H4', chineseDebtToGdpPct: 55 }),
  ];
  test('empty array returns empty', () => {
    assert.deepEqual(getHighDebtRatio([]), []);
  });
  test('default threshold 20 returns >= 20', () => {
    const r = getHighDebtRatio(pool);
    assert.equal(r.length, 3); // H2, H3, H4
    assert.ok(r.every((d) => d.chineseDebtToGdpPct >= 20));
  });
  test('custom threshold 30 returns >= 30', () => {
    const r = getHighDebtRatio(pool, 30);
    assert.equal(r.length, 2); // H3, H4
  });
  test('exact threshold value is included', () => {
    const r = getHighDebtRatio(pool, 20);
    assert.ok(r.some((d) => d.id === 'H2'));
  });
  test('below threshold excluded', () => {
    const r = getHighDebtRatio(pool, 20);
    assert.ok(!r.some((d) => d.id === 'H1'));
  });
  test('threshold 0 returns all', () => {
    const r = getHighDebtRatio(pool, 0);
    assert.equal(r.length, pool.length);
  });
  test('threshold above max returns empty', () => {
    const r = getHighDebtRatio(pool, 100);
    assert.equal(r.length, 0);
  });
});

// ---- computeVulnerabilityIndex -------------------------------------------------

describe('computeVulnerabilityIndex', () => {
  test('empty array returns 0', () => {
    assert.equal(computeVulnerabilityIndex([]), 0);
  });
  test('returns number type', () => {
    assert.equal(typeof computeVulnerabilityIndex([makeDebtor()]), 'number');
  });
  test('all Defaulted returns 100', () => {
    const pool = [makeDebtor({ status: 'Defaulted' }), makeDebtor({ status: 'Defaulted' })];
    assert.equal(computeVulnerabilityIndex(pool), 100);
  });
  test('all Repaying returns 25', () => {
    const pool = [makeDebtor({ status: 'Repaying' }), makeDebtor({ status: 'Repaying' })];
    assert.equal(computeVulnerabilityIndex(pool), 25);
  });
  test('all At Risk returns 50', () => {
    const pool = [makeDebtor({ status: 'At Risk' }), makeDebtor({ status: 'At Risk' })];
    assert.equal(computeVulnerabilityIndex(pool), 50);
  });
  test('all Restructuring returns 75', () => {
    const pool = [makeDebtor({ status: 'Restructuring' }), makeDebtor({ status: 'Restructuring' })];
    assert.equal(computeVulnerabilityIndex(pool), 75);
  });
  test('single Defaulted returns 100', () => {
    assert.equal(computeVulnerabilityIndex([makeDebtor({ status: 'Defaulted' })]), 100);
  });
  test('single Repaying returns 25', () => {
    assert.equal(computeVulnerabilityIndex([makeDebtor({ status: 'Repaying' })]), 25);
  });
  test('mixed: Defaulted + Repaying averages correctly', () => {
    const pool = [makeDebtor({ status: 'Defaulted' }), makeDebtor({ status: 'Repaying' })];
    // score = 4+1 = 5; maxPossible = 8; 5/8 * 100 = 62.5 -> round = 63
    assert.equal(computeVulnerabilityIndex(pool), 63);
  });
  test('result is always in range 0-100', () => {
    const statuses: DebtorStatus[] = ['At Risk', 'Restructuring', 'Defaulted', 'Repaying'];
    for (const s of statuses) {
      const v = computeVulnerabilityIndex([makeDebtor({ status: s })]);
      assert.ok(v >= 0 && v <= 100);
    }
  });
});

// ---- statusClass ---------------------------------------------------------------

describe('statusClass', () => {
  test('At Risk -> status-at-risk', () => {
    assert.equal(statusClass('At Risk'), 'status-at-risk');
  });
  test('Defaulted -> status-defaulted', () => {
    assert.equal(statusClass('Defaulted'), 'status-defaulted');
  });
  test('Restructuring -> status-restructuring', () => {
    assert.equal(statusClass('Restructuring'), 'status-restructuring');
  });
  test('Repaying -> status-repaying', () => {
    assert.equal(statusClass('Repaying'), 'status-repaying');
  });
  test('returns non-empty string for all valid values', () => {
    const values: DebtorStatus[] = ['At Risk', 'Restructuring', 'Defaulted', 'Repaying'];
    for (const v of values) {
      assert.ok(statusClass(v).length > 0);
    }
  });
});

// ---- leverageClass -------------------------------------------------------------

describe('leverageClass', () => {
  test('Port/Infrastructure -> lev-port', () => {
    assert.equal(leverageClass('Port/Infrastructure'), 'lev-port');
  });
  test('Resource Extraction -> lev-resource', () => {
    assert.equal(leverageClass('Resource Extraction'), 'lev-resource');
  });
  test('Strategic Access -> lev-strategic', () => {
    assert.equal(leverageClass('Strategic Access'), 'lev-strategic');
  });
  test('Currency Swap -> lev-currency', () => {
    assert.equal(leverageClass('Currency Swap'), 'lev-currency');
  });
  test('Railway/Transport -> lev-railway', () => {
    assert.equal(leverageClass('Railway/Transport'), 'lev-railway');
  });
  test('Mixed -> lev-mixed', () => {
    assert.equal(leverageClass('Mixed'), 'lev-mixed');
  });
  test('returns string for all valid values', () => {
    const values: LeverageType[] = [
      'Port/Infrastructure', 'Resource Extraction', 'Strategic Access',
      'Currency Swap', 'Railway/Transport', 'Mixed',
    ];
    for (const v of values) {
      assert.equal(typeof leverageClass(v), 'string');
    }
  });
});

// ---- buildRenderData -----------------------------------------------------------

describe('buildRenderData', () => {
  const data = buildRenderData();

  test('returns debtors array', () => {
    assert.ok(Array.isArray(data.debtors));
  });
  test('debtors is non-empty', () => {
    assert.ok(data.debtors.length > 0);
  });
  test('returns exactly 12 debtors', () => {
    assert.equal(data.debtors.length, 12);
  });
  test('returns stats object', () => {
    assert.ok(data.stats !== null && typeof data.stats === 'object');
  });
  test('vulnerabilityIndex is a number', () => {
    assert.equal(typeof data.stats.vulnerabilityIndex, 'number');
  });
  test('vulnerabilityIndex is in range 0-100', () => {
    assert.ok(data.stats.vulnerabilityIndex >= 0 && data.stats.vulnerabilityIndex <= 100);
  });
  test('chinaOverseasLendingBn > worldBankImfCombinedBn', () => {
    assert.ok(data.stats.chinaOverseasLendingBn > data.stats.worldBankImfCombinedBn);
  });
  test('chinaOverseasLendingBn is 843', () => {
    assert.equal(data.stats.chinaOverseasLendingBn, 843);
  });
  test('worldBankImfCombinedBn is 489', () => {
    assert.equal(data.stats.worldBankImfCombinedBn, 489);
  });
  test('atRiskCount matches getByStatus At Risk', () => {
    const expected = data.debtors.filter((d) => d.status === 'At Risk').length;
    assert.equal(data.atRiskCount, expected);
  });
  test('defaultedCount matches getByStatus Defaulted', () => {
    const expected = data.debtors.filter((d) => d.status === 'Defaulted').length;
    assert.equal(data.defaultedCount, expected);
  });
  test('restructuringCount matches getByStatus Restructuring', () => {
    const expected = data.debtors.filter((d) => d.status === 'Restructuring').length;
    assert.equal(data.restructuringCount, expected);
  });
  test('briCountriesAtRisk equals atRiskCount', () => {
    assert.equal(data.stats.briCountriesAtRisk, data.atRiskCount);
  });
  test('totalBriDebtBn is positive', () => {
    assert.ok(data.stats.totalBriDebtBn > 0);
  });
  test('totalBriDebtBn matches sum of debtors', () => {
    const sum = data.debtors.reduce((s, d) => s + d.debtToChinaBn, 0);
    assert.ok(Math.abs(data.stats.totalBriDebtBn - Math.round(sum * 10) / 10) < 0.01);
  });
  test('Sri Lanka is present and Defaulted', () => {
    const srilanka = data.debtors.find((d) => d.country === 'Sri Lanka');
    assert.ok(srilanka !== undefined);
    assert.equal(srilanka?.status, 'Defaulted');
  });
  test('Laos is present and At Risk', () => {
    const laos = data.debtors.find((d) => d.country === 'Laos');
    assert.ok(laos !== undefined);
    assert.equal(laos?.status, 'At Risk');
  });
  test('Pakistan is present', () => {
    assert.ok(data.debtors.some((d) => d.country === 'Pakistan'));
  });
  test('Cambodia is present', () => {
    assert.ok(data.debtors.some((d) => d.country === 'Cambodia'));
  });
  test('Zambia is Restructuring', () => {
    const zambia = data.debtors.find((d) => d.country === 'Zambia');
    assert.equal(zambia?.status, 'Restructuring');
  });
  test('every debtor has non-empty strategicAsset', () => {
    assert.ok(data.debtors.every((d) => d.strategicAsset.length > 0));
  });
  test('every debtor has positive debtToChinaBn', () => {
    assert.ok(data.debtors.every((d) => d.debtToChinaBn > 0));
  });
  test('every debtor has non-empty country name', () => {
    assert.ok(data.debtors.every((d) => d.country.length > 0));
  });
  test('every debtor has non-empty notes', () => {
    assert.ok(data.debtors.every((d) => d.notes.length > 0));
  });
  test('every debtor chineseDebtToGdpPct is non-negative', () => {
    assert.ok(data.debtors.every((d) => d.chineseDebtToGdpPct >= 0));
  });
  test('atRiskCount >= 1', () => {
    assert.ok(data.atRiskCount >= 1);
  });
  test('defaultedCount >= 1', () => {
    assert.ok(data.defaultedCount >= 1);
  });
  test('restructuringCount >= 1', () => {
    assert.ok(data.restructuringCount >= 1);
  });
  test('vulnerabilityIndex equals computeVulnerabilityIndex(debtors)', () => {
    const expected = computeVulnerabilityIndex(data.debtors);
    assert.equal(data.stats.vulnerabilityIndex, expected);
  });
  test('Laos has highest chineseDebtToGdpPct', () => {
    const maxPct = Math.max(...data.debtors.map((d) => d.chineseDebtToGdpPct));
    const laos = data.debtors.find((d) => d.country === 'Laos');
    assert.equal(laos?.chineseDebtToGdpPct, maxPct);
  });
  test('Pakistan has highest debtToChinaBn', () => {
    const maxDebt = Math.max(...data.debtors.map((d) => d.debtToChinaBn));
    const pak = data.debtors.find((d) => d.country === 'Pakistan');
    assert.equal(pak?.debtToChinaBn, maxDebt);
  });
  test('every debtor id is unique', () => {
    const ids = data.debtors.map((d) => d.id);
    assert.equal(new Set(ids).size, ids.length);
  });
  test('every debtor iso3 is 3 characters', () => {
    assert.ok(data.debtors.every((d) => d.iso3.length === 3));
  });
  test('Restructuring count >= 1', () => {
    assert.ok(data.restructuringCount >= 1);
  });
});
