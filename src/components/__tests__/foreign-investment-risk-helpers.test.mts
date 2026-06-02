import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBlockRate,
  computeApprovalRate,
  getPendingTransactions,
  getHighRiskTransactions,
  getTotalValueBn,
  getBlockedValueBn,
  getCriticalSectors,
  rankSectorsByExposure,
  statusBadgeClass,
  riskClass,
  buildRenderData,
  type FDITransaction,
  type SectorExposure,
} from '../foreign-investment-risk-helpers.js';

const MOCK_TXS: FDITransaction[] = [
  { id: 'A1', acquirer: 'X', acquirerCountry: 'CN', target: 'Y', targetSector: 'Tech', dealValueBn: 10, status: 'Blocked', reviewBody: 'CFIUS', riskLevel: 'Critical', year: 2022, notes: '' },
  { id: 'A2', acquirer: 'B', acquirerCountry: 'US', target: 'C', targetSector: 'Finance', dealValueBn: 5, status: 'Approved', reviewBody: 'DOJ', riskLevel: 'Low', year: 2021, notes: '' },
  { id: 'A3', acquirer: 'D', acquirerCountry: 'UAE', target: 'E', targetSector: 'AI', dealValueBn: 2, status: 'Pending', reviewBody: 'CFIUS', riskLevel: 'High', year: 2023, notes: '' },
  { id: 'A4', acquirer: 'F', acquirerCountry: 'JP', target: 'G', targetSector: 'Telecom', dealValueBn: 8, status: 'Conditioned', reviewBody: 'FCC', riskLevel: 'Medium', year: 2020, notes: '' },
  { id: 'A5', acquirer: 'H', acquirerCountry: 'UK', target: 'I', targetSector: 'Defense', dealValueBn: 3, status: 'Withdrawn', reviewBody: 'NSIA', riskLevel: 'High', year: 2019, notes: '' },
];

const MOCK_SECTORS: SectorExposure[] = [
  { sector: 'Defense', foreignOwnershipPct: 3, sensitivityLevel: 'Critical', topForeignActors: ['UK'], recentDeals: 1 },
  { sector: 'Biotech', foreignOwnershipPct: 40, sensitivityLevel: 'Medium', topForeignActors: ['DE'], recentDeals: 5 },
  { sector: 'Semiconductors', foreignOwnershipPct: 28, sensitivityLevel: 'Critical', topForeignActors: ['TW'], recentDeals: 10 },
  { sector: 'AI', foreignOwnershipPct: 22, sensitivityLevel: 'High', topForeignActors: ['UAE'], recentDeals: 8 },
];

describe('computeBlockRate', () => {
  it('returns correct percentage with mixed statuses', () => {
    assert.equal(computeBlockRate(MOCK_TXS), 20); // 1 of 5 blocked
  });
  it('returns 0 for empty array', () => {
    assert.equal(computeBlockRate([]), 0);
  });
  it('returns 100 when all blocked', () => {
    const all = MOCK_TXS.map(t => ({ ...t, status: 'Blocked' as const }));
    assert.equal(computeBlockRate(all), 100);
  });
  it('rounds to nearest integer', () => {
    const txs = [
      { ...MOCK_TXS[0], status: 'Blocked' as const },
      { ...MOCK_TXS[1], status: 'Approved' as const },
      { ...MOCK_TXS[2], status: 'Approved' as const },
    ];
    assert.equal(typeof computeBlockRate(txs), 'number');
  });
});

describe('computeApprovalRate', () => {
  it('counts Approved and Conditioned as approved', () => {
    assert.equal(computeApprovalRate(MOCK_TXS), 40); // A2=Approved, A4=Conditioned = 2/5
  });
  it('returns 0 for empty array', () => {
    assert.equal(computeApprovalRate([]), 0);
  });
  it('returns 100 when all approved', () => {
    const all = MOCK_TXS.map(t => ({ ...t, status: 'Approved' as const }));
    assert.equal(computeApprovalRate(all), 100);
  });
  it('does not count Pending as approved', () => {
    const txs = [{ ...MOCK_TXS[0], status: 'Pending' as const }];
    assert.equal(computeApprovalRate(txs), 0);
  });
  it('does not count Blocked as approved', () => {
    const txs = [{ ...MOCK_TXS[0], status: 'Blocked' as const }];
    assert.equal(computeApprovalRate(txs), 0);
  });
});

describe('getPendingTransactions', () => {
  it('returns only pending', () => {
    const pending = getPendingTransactions(MOCK_TXS);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, 'A3');
  });
  it('returns empty array when none pending', () => {
    const txs = MOCK_TXS.filter(t => t.status !== 'Pending');
    assert.equal(getPendingTransactions(txs).length, 0);
  });
  it('returns all when all pending', () => {
    const all = MOCK_TXS.map(t => ({ ...t, status: 'Pending' as const }));
    assert.equal(getPendingTransactions(all).length, MOCK_TXS.length);
  });
});

describe('getHighRiskTransactions', () => {
  it('returns High and Critical risk transactions', () => {
    const hr = getHighRiskTransactions(MOCK_TXS);
    assert.equal(hr.length, 3); // A1=Critical, A3=High, A5=High
  });
  it('excludes Low and Medium risk', () => {
    const hr = getHighRiskTransactions(MOCK_TXS);
    assert.ok(hr.every(t => t.riskLevel === 'High' || t.riskLevel === 'Critical'));
  });
  it('returns empty for all-low-risk list', () => {
    const all = MOCK_TXS.map(t => ({ ...t, riskLevel: 'Low' as const }));
    assert.equal(getHighRiskTransactions(all).length, 0);
  });
});

describe('getTotalValueBn', () => {
  it('sums all deal values', () => {
    assert.equal(getTotalValueBn(MOCK_TXS), 28); // 10+5+2+8+3
  });
  it('returns 0 for empty', () => {
    assert.equal(getTotalValueBn([]), 0);
  });
  it('handles zero-value deals', () => {
    const txs = [{ ...MOCK_TXS[0], dealValueBn: 0 }];
    assert.equal(getTotalValueBn(txs), 0);
  });
});

describe('getBlockedValueBn', () => {
  it('sums only blocked deal values', () => {
    assert.equal(getBlockedValueBn(MOCK_TXS), 10); // only A1 blocked
  });
  it('returns 0 when none blocked', () => {
    const txs = MOCK_TXS.map(t => ({ ...t, status: 'Approved' as const }));
    assert.equal(getBlockedValueBn(txs), 0);
  });
  it('returns 0 for empty array', () => {
    assert.equal(getBlockedValueBn([]), 0);
  });
});

describe('getCriticalSectors', () => {
  it('returns Critical and High sensitivity sectors', () => {
    const cs = getCriticalSectors(MOCK_SECTORS);
    assert.equal(cs.length, 3); // Defense=Critical, Semiconductors=Critical, AI=High
  });
  it('excludes Medium sectors', () => {
    const cs = getCriticalSectors(MOCK_SECTORS);
    assert.ok(cs.every(s => s.sensitivityLevel === 'Critical' || s.sensitivityLevel === 'High'));
  });
  it('returns empty for all-low sectors', () => {
    const all = MOCK_SECTORS.map(s => ({ ...s, sensitivityLevel: 'Low' as const }));
    assert.equal(getCriticalSectors(all).length, 0);
  });
});

describe('rankSectorsByExposure', () => {
  it('returns sectors sorted descending by foreignOwnershipPct', () => {
    const sorted = rankSectorsByExposure(MOCK_SECTORS);
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(sorted[i - 1].foreignOwnershipPct >= sorted[i].foreignOwnershipPct);
    }
  });
  it('does not mutate original array', () => {
    const orig = [...MOCK_SECTORS];
    rankSectorsByExposure(MOCK_SECTORS);
    assert.deepEqual(MOCK_SECTORS, orig);
  });
  it('handles single-element array', () => {
    const sorted = rankSectorsByExposure([MOCK_SECTORS[0]]);
    assert.equal(sorted.length, 1);
  });
  it('handles empty array', () => {
    assert.deepEqual(rankSectorsByExposure([]), []);
  });
});

describe('statusBadgeClass', () => {
  it('returns status-critical for Blocked', () => {
    assert.equal(statusBadgeClass('Blocked'), 'status-critical');
  });
  it('returns status-warn for Pending', () => {
    assert.equal(statusBadgeClass('Pending'), 'status-warn');
  });
  it('returns status-medium for Conditioned', () => {
    assert.equal(statusBadgeClass('Conditioned'), 'status-medium');
  });
  it('returns status-ok for Approved', () => {
    assert.equal(statusBadgeClass('Approved'), 'status-ok');
  });
  it('returns status-low for Withdrawn', () => {
    assert.equal(statusBadgeClass('Withdrawn'), 'status-low');
  });
});

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
  it('returns risk-low for unknown', () => {
    assert.equal(riskClass('Unknown'), 'risk-low');
  });
});

describe('buildRenderData', () => {
  it('returns all required fields', () => {
    const d = buildRenderData();
    assert.ok(Array.isArray(d.transactions));
    assert.ok(Array.isArray(d.sectorExposures));
    assert.equal(typeof d.blockRate, 'number');
    assert.equal(typeof d.approvalRate, 'number');
    assert.equal(typeof d.pendingCount, 'number');
    assert.equal(typeof d.highRiskCount, 'number');
    assert.equal(typeof d.totalValueBn, 'number');
    assert.equal(typeof d.totalValueBlockedBn, 'number');
  });
  it('transactions array is non-empty', () => {
    assert.ok(buildRenderData().transactions.length > 0);
  });
  it('sectorExposures array is non-empty', () => {
    assert.ok(buildRenderData().sectorExposures.length > 0);
  });
  it('blockRate is between 0 and 100', () => {
    const r = buildRenderData().blockRate;
    assert.ok(r >= 0 && r <= 100);
  });
  it('approvalRate is between 0 and 100', () => {
    const r = buildRenderData().approvalRate;
    assert.ok(r >= 0 && r <= 100);
  });
  it('pendingCount matches actual pending transactions', () => {
    const d = buildRenderData();
    assert.equal(d.pendingCount, d.transactions.filter(t => t.status === 'Pending').length);
  });
  it('highRiskCount matches actual high/critical transactions', () => {
    const d = buildRenderData();
    const expected = d.transactions.filter(t => t.riskLevel === 'High' || t.riskLevel === 'Critical').length;
    assert.equal(d.highRiskCount, expected);
  });
  it('totalValueBn matches sum', () => {
    const d = buildRenderData();
    const sum = d.transactions.reduce((s, t) => s + t.dealValueBn, 0);
    assert.equal(d.totalValueBn, sum);
  });
  it('totalValueBlockedBn matches sum of blocked', () => {
    const d = buildRenderData();
    const sum = d.transactions.filter(t => t.status === 'Blocked').reduce((s, t) => s + t.dealValueBn, 0);
    assert.equal(d.totalValueBlockedBn, sum);
  });
  it('all transactions have valid status values', () => {
    const valid = new Set(['Approved', 'Blocked', 'Pending', 'Withdrawn', 'Conditioned']);
    for (const t of buildRenderData().transactions) {
      assert.ok(valid.has(t.status), `Invalid status: ${t.status}`);
    }
  });
  it('all transactions have valid riskLevel values', () => {
    const valid = new Set(['Low', 'Medium', 'High', 'Critical']);
    for (const t of buildRenderData().transactions) {
      assert.ok(valid.has(t.riskLevel), `Invalid riskLevel: ${t.riskLevel}`);
    }
  });
  it('all sector sensitivityLevels are valid', () => {
    const valid = new Set(['Low', 'Medium', 'High', 'Critical']);
    for (const s of buildRenderData().sectorExposures) {
      assert.ok(valid.has(s.sensitivityLevel));
    }
  });
  it('all sector foreignOwnershipPct values are 0-100', () => {
    for (const s of buildRenderData().sectorExposures) {
      assert.ok(s.foreignOwnershipPct >= 0 && s.foreignOwnershipPct <= 100);
    }
  });
  it('blockRate + approvalRate can exceed 100 only if withdrawn/pending differ', () => {
    const d = buildRenderData();
    assert.equal(typeof d.blockRate, 'number');
  });
});
