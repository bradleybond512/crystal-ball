import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  getActiveCases,
  getByDetainingCountry,
  getHighSeverityCases,
  getMostRecentReleases,
  getDeceasedCases,
  detentionDurationDays,
  formatDuration,
  statusClass,
  leverageClass,
  severityColor,
  leverageCategoryLabel,
  countryWrongfulDetentionScore,
  globalHostageDiplomacyIndex,
  buildCountryScores,
  buildRenderData,
  HOSTAGE_CASES,
  SWAP_EVENTS,
  type HostageCase,
  type DetainingCountry,
} from '../hostage-diplomacy-helpers.ts';

// ── HOSTAGE_CASES seed data ───────────────────────────────────────────────

describe('HOSTAGE_CASES', () => {
  it('contains at least 10 cases', () => {
    assert.ok(HOSTAGE_CASES.length >= 10);
  });

  it('every case has a unique id', () => {
    const ids = HOSTAGE_CASES.map((c) => c.id);
    assert.equal(ids.length, new Set(ids).size);
  });

  it('every case has a non-empty detainee name', () => {
    for (const c of HOSTAGE_CASES) {
      assert.ok(c.detainee.length > 0, 'empty detainee: ' + c.id);
    }
  });

  it('every case has a valid status', () => {
    const valid = new Set(['Active', 'Released', 'Deceased']);
    for (const c of HOSTAGE_CASES) {
      assert.ok(valid.has(c.status), c.id + ' has invalid status: ' + c.status);
    }
  });

  it('severity is between 1 and 10 for all cases', () => {
    for (const c of HOSTAGE_CASES) {
      assert.ok(c.severity >= 1 && c.severity <= 10, c.id + ' severity out of range: ' + c.severity);
    }
  });

  it('released cases have a releaseDate', () => {
    for (const c of HOSTAGE_CASES) {
      if (c.status === 'Released') {
        assert.ok(c.releaseDate !== undefined, c.id + ' is Released but has no releaseDate');
      }
    }
  });

  it('active cases have no releaseDate', () => {
    for (const c of HOSTAGE_CASES) {
      if (c.status === 'Active') {
        assert.equal(c.releaseDate, undefined, c.id + ' is Active but has a releaseDate');
      }
    }
  });

  it('detentionDate is always before releaseDate when both present', () => {
    for (const c of HOSTAGE_CASES) {
      if (c.releaseDate) {
        assert.ok(
          c.detentionDate < c.releaseDate,
          c.id + ': detentionDate not before releaseDate',
        );
      }
    }
  });

  it('includes at least one Iranian case', () => {
    assert.ok(HOSTAGE_CASES.some((c) => c.detainingCountry === 'Iran'));
  });

  it('includes at least one Russian case', () => {
    assert.ok(HOSTAGE_CASES.some((c) => c.detainingCountry === 'Russia'));
  });

  it('includes at least one Chinese case', () => {
    assert.ok(HOSTAGE_CASES.some((c) => c.detainingCountry === 'China'));
  });

  it('includes Otto Warmbier as Deceased', () => {
    const ow = HOSTAGE_CASES.find((c) => c.detainee === 'Otto Warmbier');
    assert.ok(ow !== undefined, 'Warmbier case missing');
    assert.equal(ow.status, 'Deceased');
  });
});

// ── SWAP_EVENTS seed data ─────────────────────────────────────────────────

describe('SWAP_EVENTS', () => {
  it('contains at least 4 events', () => {
    assert.ok(SWAP_EVENTS.length >= 4);
  });

  it('every event has a non-empty date', () => {
    for (const ev of SWAP_EVENTS) {
      assert.ok(ev.date.length > 0);
    }
  });

  it('every event has at least one detainee released', () => {
    for (const ev of SWAP_EVENTS) {
      assert.ok(ev.detaineesReleased.length > 0);
    }
  });

  it('events are in reverse chronological order (newest first)', () => {
    for (let i = 0; i < SWAP_EVENTS.length - 1; i++) {
      assert.ok(
        SWAP_EVENTS[i].date >= SWAP_EVENTS[i + 1].date,
        'swap events not in descending order at index ' + i,
      );
    }
  });
});

// ── getActiveCases ────────────────────────────────────────────────────────

describe('getActiveCases', () => {
  it('returns only Active cases from default data', () => {
    const result = getActiveCases();
    assert.ok(result.every((c) => c.status === 'Active'));
  });

  it('returns empty array when no active cases', () => {
    const cases: HostageCase[] = HOSTAGE_CASES.filter((c) => c.status !== 'Active');
    assert.equal(getActiveCases(cases).length, 0);
  });

  it('returns all active cases when all are active', () => {
    const cases = HOSTAGE_CASES.filter((c) => c.status === 'Active');
    assert.equal(getActiveCases(cases).length, cases.length);
  });

  it('count matches HOSTAGE_CASES active subset', () => {
    const expected = HOSTAGE_CASES.filter((c) => c.status === 'Active').length;
    assert.equal(getActiveCases().length, expected);
  });
});

// ── getByDetainingCountry ─────────────────────────────────────────────────

describe('getByDetainingCountry', () => {
  it('returns only Iran cases when filtering for Iran', () => {
    const result = getByDetainingCountry('Iran');
    assert.ok(result.every((c) => c.detainingCountry === 'Iran'));
  });

  it('returns empty for Venezuela (no seed cases)', () => {
    const result = getByDetainingCountry('Venezuela');
    assert.equal(result.length, 0);
  });

  it('returns correct count for Russia', () => {
    const result = getByDetainingCountry('Russia');
    const expected = HOSTAGE_CASES.filter((c) => c.detainingCountry === 'Russia').length;
    assert.equal(result.length, expected);
  });

  it('works with custom cases array', () => {
    const custom: HostageCase[] = [
      {
        id: 'T-001', detainee: 'Test Person', citizenship: ['US'],
        detainingCountry: 'Iran', chargeAlleged: 'Test', detentionDate: '2023-01-01',
        status: 'Active', leveragePurpose: 'Test', leverageCategory: 'prisoner-swap', severity: 5,
      },
    ];
    assert.equal(getByDetainingCountry('Iran', custom).length, 1);
    assert.equal(getByDetainingCountry('Russia', custom).length, 0);
  });
});

// ── getHighSeverityCases ──────────────────────────────────────────────────

describe('getHighSeverityCases', () => {
  it('default threshold 8 returns cases with severity >= 8', () => {
    const result = getHighSeverityCases();
    assert.ok(result.every((c) => c.severity >= 8));
  });

  it('threshold 10 returns only severity-10 cases', () => {
    const result = getHighSeverityCases(10);
    assert.ok(result.every((c) => c.severity >= 10));
  });

  it('threshold 1 returns all cases', () => {
    assert.equal(getHighSeverityCases(1).length, HOSTAGE_CASES.length);
  });

  it('threshold 11 returns empty array', () => {
    assert.equal(getHighSeverityCases(11).length, 0);
  });
});

// ── getMostRecentReleases ─────────────────────────────────────────────────

describe('getMostRecentReleases', () => {
  it('returns only released cases', () => {
    const result = getMostRecentReleases();
    assert.ok(result.every((c) => c.status === 'Released'));
  });

  it('respects the n limit', () => {
    const result = getMostRecentReleases(2);
    assert.ok(result.length <= 2);
  });

  it('first result is the most recently released', () => {
    const result = getMostRecentReleases(5);
    if (result.length >= 2) {
      assert.ok((result[0].releaseDate ?? '') >= (result[1].releaseDate ?? ''));
    }
  });

  it('returns empty array when no released cases', () => {
    const cases = HOSTAGE_CASES.filter((c) => c.status === 'Active');
    assert.equal(getMostRecentReleases(3, cases).length, 0);
  });
});

// ── getDeceasedCases ──────────────────────────────────────────────────────

describe('getDeceasedCases', () => {
  it('returns only Deceased cases', () => {
    const result = getDeceasedCases();
    assert.ok(result.every((c) => c.status === 'Deceased'));
  });

  it('includes Warmbier', () => {
    const result = getDeceasedCases();
    assert.ok(result.some((c) => c.detainee === 'Otto Warmbier'));
  });
});

// ── detentionDurationDays ─────────────────────────────────────────────────

describe('detentionDurationDays', () => {
  it('returns 0 for same start and end date', () => {
    assert.equal(detentionDurationDays('2023-01-01', '2023-01-01'), 0);
  });

  it('returns 365 for exactly one year', () => {
    assert.equal(detentionDurationDays('2022-01-01', '2023-01-01'), 365);
  });

  it('returns positive value when releaseDate is after detentionDate', () => {
    const d = detentionDurationDays('2020-01-01', '2021-01-01');
    assert.ok(d > 0);
  });

  it('uses today when releaseDate is omitted', () => {
    const d = detentionDurationDays('2020-01-01');
    assert.ok(d > 1000, 'expected >1000 days from 2020 to today, got ' + d);
  });

  it('never returns a negative number', () => {
    const d = detentionDurationDays('2030-01-01', '2031-01-01');
    assert.ok(d >= 0);
  });
});

// ── formatDuration ────────────────────────────────────────────────────────

describe('formatDuration', () => {
  it('returns "0 days" for 0', () => {
    assert.equal(formatDuration(0), '0 days');
  });

  it('returns "0 days" for negative input', () => {
    assert.equal(formatDuration(-5), '0 days');
  });

  it('returns days string for < 30 days', () => {
    assert.equal(formatDuration(15), '15d');
  });

  it('returns months string for 30-364 days', () => {
    const result = formatDuration(60);
    assert.ok(result.endsWith('mo'), 'expected months, got: ' + result);
  });

  it('returns years string for >= 365 days', () => {
    const result = formatDuration(365);
    assert.ok(result.includes('y'), 'expected years, got: ' + result);
  });

  it('returns years+months for multi-year non-integer', () => {
    const result = formatDuration(400);
    assert.ok(result.includes('y'), 'expected years in: ' + result);
  });
});

// ── statusClass ───────────────────────────────────────────────────────────

describe('statusClass', () => {
  it('Active returns a string containing ef4444', () => {
    assert.ok(statusClass('Active').includes('ef4444'));
  });

  it('Released returns a string containing 4caf50', () => {
    assert.ok(statusClass('Released').includes('4caf50'));
  });

  it('Deceased returns a string containing 9e9e9e', () => {
    assert.ok(statusClass('Deceased').includes('9e9e9e'));
  });

  it('Active and Released return different colors', () => {
    assert.notEqual(statusClass('Active'), statusClass('Released'));
  });
});

// ── leverageClass ─────────────────────────────────────────────────────────

describe('leverageClass', () => {
  it('returns a non-empty string for all categories', () => {
    const cats = [
      'sanctions-relief', 'prisoner-swap', 'diplomatic-concession',
      'espionage-pretext', 'internal-suppression', 'asset-seizure',
    ] as const;
    for (const cat of cats) {
      assert.ok(leverageClass(cat).length > 0, 'empty color for: ' + cat);
    }
  });

  it('espionage-pretext returns the critical red', () => {
    assert.ok(leverageClass('espionage-pretext').includes('ef4444'));
  });
});

// ── severityColor ─────────────────────────────────────────────────────────

describe('severityColor', () => {
  it('severity 10 returns critical red', () => {
    assert.ok(severityColor(10).includes('ef4444'));
  });

  it('severity 7 returns high orange', () => {
    assert.ok(severityColor(7).includes('fb923c'));
  });

  it('severity 5 returns medium yellow', () => {
    assert.ok(severityColor(5).includes('facc15'));
  });

  it('severity 3 returns low green', () => {
    assert.ok(severityColor(3).includes('4caf50'));
  });

  it('severity 9 and 10 return same color', () => {
    assert.equal(severityColor(9), severityColor(10));
  });
});

// ── leverageCategoryLabel ─────────────────────────────────────────────────

describe('leverageCategoryLabel', () => {
  it('returns human-readable label for sanctions-relief', () => {
    assert.equal(leverageCategoryLabel('sanctions-relief'), 'Sanctions Relief');
  });

  it('returns human-readable label for prisoner-swap', () => {
    assert.equal(leverageCategoryLabel('prisoner-swap'), 'Prisoner Swap');
  });

  it('returns non-empty string for all categories', () => {
    const cats = [
      'sanctions-relief', 'prisoner-swap', 'diplomatic-concession',
      'espionage-pretext', 'internal-suppression', 'asset-seizure',
    ] as const;
    for (const cat of cats) {
      assert.ok(leverageCategoryLabel(cat).length > 0);
    }
  });
});

// ── countryWrongfulDetentionScore ─────────────────────────────────────────

describe('countryWrongfulDetentionScore', () => {
  it('returns 0 for Venezuela (no cases)', () => {
    assert.equal(countryWrongfulDetentionScore('Venezuela'), 0);
  });

  it('returns value in [0, 100] for all countries', () => {
    const countries: DetainingCountry[] = ['Iran', 'Russia', 'China', 'North Korea', 'Belarus'];
    for (const c of countries) {
      const score = countryWrongfulDetentionScore(c);
      assert.ok(score >= 0 && score <= 100, c + ' score out of range: ' + score);
    }
  });

  it('active cases raise the score vs released-only cases', () => {
    const active: HostageCase[] = [{
      id: 'A', detainee: 'A', citizenship: ['US'], detainingCountry: 'Iran',
      chargeAlleged: 'test', detentionDate: '2020-01-01', status: 'Active',
      leveragePurpose: 'test', leverageCategory: 'prisoner-swap', severity: 8,
    }];
    const released: HostageCase[] = [{ ...active[0], id: 'B', status: 'Released', releaseDate: '2021-01-01' }];
    assert.ok(
      countryWrongfulDetentionScore('Iran', active) >
      countryWrongfulDetentionScore('Iran', released),
    );
  });

  it('deceased cases score higher than released at same severity', () => {
    const deceased: HostageCase[] = [{
      id: 'D', detainee: 'D', citizenship: ['US'], detainingCountry: 'Iran',
      chargeAlleged: 'test', detentionDate: '2020-01-01', releaseDate: '2021-01-01',
      status: 'Deceased', leveragePurpose: 'test', leverageCategory: 'prisoner-swap', severity: 8,
    }];
    const released: HostageCase[] = [{ ...deceased[0], id: 'R', status: 'Released' }];
    assert.ok(
      countryWrongfulDetentionScore('Iran', deceased) >
      countryWrongfulDetentionScore('Iran', released),
    );
  });

  it('North Korea scores high due to Warmbier severity 10', () => {
    const score = countryWrongfulDetentionScore('North Korea');
    assert.ok(score >= 70, 'expected NK score >= 70, got ' + score);
  });
});

// ── globalHostageDiplomacyIndex ───────────────────────────────────────────

describe('globalHostageDiplomacyIndex', () => {
  it('returns 0 when no active cases', () => {
    const cases = HOSTAGE_CASES.filter((c) => c.status !== 'Active');
    assert.equal(globalHostageDiplomacyIndex(cases), 0);
  });

  it('returns value in [0, 100]', () => {
    const idx = globalHostageDiplomacyIndex();
    assert.ok(idx >= 0 && idx <= 100, 'index out of range: ' + idx);
  });

  it('higher severity active cases raise the index', () => {
    const low: HostageCase[] = [{
      id: 'L', detainee: 'L', citizenship: ['US'], detainingCountry: 'Iran',
      chargeAlleged: 'test', detentionDate: '2020-01-01', status: 'Active',
      leveragePurpose: 'test', leverageCategory: 'prisoner-swap', severity: 2,
    }];
    const high: HostageCase[] = [{ ...low[0], id: 'H', severity: 9 }];
    assert.ok(globalHostageDiplomacyIndex(high) > globalHostageDiplomacyIndex(low));
  });
});

// ── buildCountryScores ────────────────────────────────────────────────────

describe('buildCountryScores', () => {
  it('returns an array with 6 entries (one per tracked country)', () => {
    assert.equal(buildCountryScores().length, 6);
  });

  it('is sorted by score descending', () => {
    const scores = buildCountryScores();
    for (let i = 0; i < scores.length - 1; i++) {
      assert.ok(scores[i].score >= scores[i + 1].score);
    }
  });

  it('Venezuela has 0 active cases in seed data', () => {
    const vz = buildCountryScores().find((s) => s.country === 'Venezuela');
    assert.ok(vz !== undefined);
    assert.equal(vz.activeCases, 0);
  });

  it('avgSeverity is >= 0 for all countries', () => {
    for (const s of buildCountryScores()) {
      assert.ok(s.avgSeverity >= 0);
    }
  });

  it('totalCases equals activeCases + non-active for each country', () => {
    for (const s of buildCountryScores()) {
      const all = getByDetainingCountry(s.country);
      assert.equal(s.totalCases, all.length);
    }
  });
});

// ── buildRenderData ───────────────────────────────────────────────────────

describe('buildRenderData', () => {
  it('returns an object with expected shape', () => {
    const data = buildRenderData();
    assert.ok(typeof data === 'object' && data !== null);
    assert.ok(Array.isArray(data.cases));
    assert.ok(Array.isArray(data.activeCases));
    assert.ok(Array.isArray(data.recentReleases));
    assert.ok(Array.isArray(data.swapEvents));
    assert.ok(Array.isArray(data.countryScores));
    assert.equal(typeof data.globalIndex, 'number');
    assert.equal(typeof data.badgeCount, 'number');
  });

  it('activeCases is a subset of cases', () => {
    const data = buildRenderData();
    const ids = new Set(data.cases.map((c) => c.id));
    assert.ok(data.activeCases.every((c) => ids.has(c.id)));
  });

  it('recentReleases contains at most 4 entries', () => {
    assert.ok(buildRenderData().recentReleases.length <= 4);
  });

  it('globalIndex is in [0, 100]', () => {
    const idx = buildRenderData().globalIndex;
    assert.ok(idx >= 0 && idx <= 100);
  });

  it('badgeCount is a non-negative integer', () => {
    const bc = buildRenderData().badgeCount;
    assert.ok(bc >= 0 && Number.isInteger(bc));
  });

  it('swapEvents contains SWAP_EVENTS', () => {
    assert.equal(buildRenderData().swapEvents.length, SWAP_EVENTS.length);
  });
});
