import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  scoreQuantumDominance,
  classifyMaturityTier,
  getLeadingCountryByDomain,
  computeEncryptionThreatLevel,
  rankProgramsByDominance,
  getTotalInvestment,
  filterMilitaryPrograms,
  getUrgentThreats,
  buildRenderData,
} from '../quantum-tech-race-helpers.ts';
import type {
  QuantumProgram,
  QuantumThreat,
  MaturityLevel,
  QuantumDomain,
} from '../quantum-tech-race-helpers.ts';

// ── Test fixtures ─────────────────────────────────────────────────────────────

const makeProgram = (overrides: Partial<QuantumProgram> = {}): QuantumProgram => ({
  country: 'TestLand',
  domain: 'computing',
  maturity: 'experimental',
  annualInvestmentUSD: 1_000_000,
  militaryApplication: false,
  threatToEncryption: 10,
  leadingInstitutions: ['Test Uni'],
  dominanceScore: 50,
  ...overrides,
});

const makeThreat = (overrides: Partial<QuantumThreat> = {}): QuantumThreat => ({
  id: 'test-threat',
  type: 'post-quantum-migration',
  actor: 'Global',
  urgency: 'near-term',
  affectedSystems: ['TLS'],
  description: 'test description',
  ...overrides,
});

// ── scoreQuantumDominance ─────────────────────────────────────────────────────

describe('scoreQuantumDominance', () => {
  it('returns the dominanceScore field directly', () => {
    const p = makeProgram({ dominanceScore: 77 });
    assert.equal(scoreQuantumDominance(p), 77);
  });

  it('returns 0 for dominanceScore of 0', () => {
    assert.equal(scoreQuantumDominance(makeProgram({ dominanceScore: 0 })), 0);
  });

  it('returns 100 for dominanceScore of 100', () => {
    assert.equal(scoreQuantumDominance(makeProgram({ dominanceScore: 100 })), 100);
  });

  it('returns a number type', () => {
    assert.equal(typeof scoreQuantumDominance(makeProgram()), 'number');
  });
});

// ── classifyMaturityTier ──────────────────────────────────────────────────────

describe('classifyMaturityTier', () => {
  it('operational returns near-term', () => {
    assert.equal(classifyMaturityTier('operational'), 'near-term');
  });

  it('advanced-prototype returns near-term', () => {
    assert.equal(classifyMaturityTier('advanced-prototype'), 'near-term');
  });

  it('experimental returns developmental', () => {
    assert.equal(classifyMaturityTier('experimental'), 'developmental');
  });

  it('early-prototype returns developmental', () => {
    assert.equal(classifyMaturityTier('early-prototype'), 'developmental');
  });

  it('theoretical returns developmental', () => {
    assert.equal(classifyMaturityTier('theoretical'), 'developmental');
  });

  it('all MaturityLevel values return a valid tier', () => {
    const levels: MaturityLevel[] = ['theoretical', 'experimental', 'early-prototype', 'advanced-prototype', 'operational'];
    const validTiers = new Set(['operational', 'near-term', 'developmental']);
    for (const level of levels) {
      assert.ok(validTiers.has(classifyMaturityTier(level)), `unexpected tier for ${level}`);
    }
  });
});

// ── getLeadingCountryByDomain ─────────────────────────────────────────────────

describe('getLeadingCountryByDomain', () => {
  it('returns the country with highest dominanceScore in domain', () => {
    const programs = [
      makeProgram({ country: 'Alpha', domain: 'computing', dominanceScore: 60 }),
      makeProgram({ country: 'Beta', domain: 'computing', dominanceScore: 85 }),
      makeProgram({ country: 'Gamma', domain: 'sensing', dominanceScore: 90 }),
    ];
    assert.equal(getLeadingCountryByDomain(programs, 'computing'), 'Beta');
  });

  it('returns unknown for empty programs array', () => {
    assert.equal(getLeadingCountryByDomain([], 'computing'), 'unknown');
  });

  it('returns unknown when no programs match domain', () => {
    const programs = [makeProgram({ domain: 'sensing' })];
    assert.equal(getLeadingCountryByDomain(programs, 'computing'), 'unknown');
  });

  it('correctly handles single-program domain', () => {
    const programs = [makeProgram({ country: 'Solo', domain: 'cryptography', dominanceScore: 42 })];
    assert.equal(getLeadingCountryByDomain(programs, 'cryptography'), 'Solo');
  });

  it('does not mutate original array', () => {
    const programs = [
      makeProgram({ country: 'A', domain: 'computing', dominanceScore: 70 }),
      makeProgram({ country: 'B', domain: 'computing', dominanceScore: 90 }),
    ];
    const original = [...programs];
    getLeadingCountryByDomain(programs, 'computing');
    assert.equal(programs[0].country, original[0].country);
  });
});

// ── computeEncryptionThreatLevel ──────────────────────────────────────────────

describe('computeEncryptionThreatLevel', () => {
  it('returns the maximum threatToEncryption across all programs', () => {
    const programs = [
      makeProgram({ threatToEncryption: 10 }),
      makeProgram({ threatToEncryption: 45 }),
      makeProgram({ threatToEncryption: 30 }),
    ];
    assert.equal(computeEncryptionThreatLevel(programs), 45);
  });

  it('returns 0 for all-zero threats', () => {
    const programs = [
      makeProgram({ threatToEncryption: 0 }),
      makeProgram({ threatToEncryption: 0 }),
    ];
    assert.equal(computeEncryptionThreatLevel(programs), 0);
  });

  it('returns the single value for a one-element array', () => {
    assert.equal(computeEncryptionThreatLevel([makeProgram({ threatToEncryption: 55 })]), 55);
  });

  it('returns a number', () => {
    assert.equal(typeof computeEncryptionThreatLevel([makeProgram()]), 'number');
  });
});

// ── rankProgramsByDominance ───────────────────────────────────────────────────

describe('rankProgramsByDominance', () => {
  it('returns programs sorted by dominanceScore descending', () => {
    const programs = [
      makeProgram({ country: 'Low', dominanceScore: 30 }),
      makeProgram({ country: 'High', dominanceScore: 90 }),
      makeProgram({ country: 'Mid', dominanceScore: 60 }),
    ];
    const ranked = rankProgramsByDominance(programs);
    assert.equal(ranked[0].country, 'High');
    assert.equal(ranked[1].country, 'Mid');
    assert.equal(ranked[2].country, 'Low');
  });

  it('does not mutate the original array', () => {
    const programs = [
      makeProgram({ country: 'A', dominanceScore: 20 }),
      makeProgram({ country: 'B', dominanceScore: 80 }),
    ];
    rankProgramsByDominance(programs);
    assert.equal(programs[0].country, 'A');
  });

  it('returns an array of the same length', () => {
    const programs = [makeProgram(), makeProgram(), makeProgram()];
    assert.equal(rankProgramsByDominance(programs).length, 3);
  });

  it('handles empty array', () => {
    assert.deepEqual(rankProgramsByDominance([]), []);
  });

  it('handles single-element array', () => {
    const p = makeProgram({ dominanceScore: 42 });
    assert.equal(rankProgramsByDominance([p])[0].dominanceScore, 42);
  });
});

// ── getTotalInvestment ────────────────────────────────────────────────────────

describe('getTotalInvestment', () => {
  it('sums annualInvestmentUSD across programs', () => {
    const programs = [
      makeProgram({ annualInvestmentUSD: 1_000_000 }),
      makeProgram({ annualInvestmentUSD: 2_000_000 }),
      makeProgram({ annualInvestmentUSD: 3_000_000 }),
    ];
    assert.equal(getTotalInvestment(programs), 6_000_000);
  });

  it('returns 0 for empty array', () => {
    assert.equal(getTotalInvestment([]), 0);
  });

  it('returns the single value for a one-element array', () => {
    assert.equal(getTotalInvestment([makeProgram({ annualInvestmentUSD: 500 })]), 500);
  });
});

// ── filterMilitaryPrograms ────────────────────────────────────────────────────

describe('filterMilitaryPrograms', () => {
  it('returns only programs with militaryApplication true', () => {
    const programs = [
      makeProgram({ militaryApplication: true }),
      makeProgram({ militaryApplication: false }),
      makeProgram({ militaryApplication: true }),
    ];
    const result = filterMilitaryPrograms(programs);
    assert.equal(result.length, 2);
    assert.ok(result.every(p => p.militaryApplication));
  });

  it('returns empty array when no military programs', () => {
    const programs = [makeProgram({ militaryApplication: false })];
    assert.deepEqual(filterMilitaryPrograms(programs), []);
  });

  it('returns all programs when all are military', () => {
    const programs = [
      makeProgram({ militaryApplication: true }),
      makeProgram({ militaryApplication: true }),
    ];
    assert.equal(filterMilitaryPrograms(programs).length, 2);
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(filterMilitaryPrograms([]), []);
  });
});

// ── getUrgentThreats ──────────────────────────────────────────────────────────

describe('getUrgentThreats', () => {
  it('includes immediate threats', () => {
    const threats = [makeThreat({ urgency: 'immediate' }), makeThreat({ urgency: 'long-term' })];
    const result = getUrgentThreats(threats);
    assert.equal(result.length, 1);
    assert.equal(result[0].urgency, 'immediate');
  });

  it('includes near-term threats', () => {
    const threats = [makeThreat({ urgency: 'near-term' }), makeThreat({ urgency: 'medium-term' })];
    const result = getUrgentThreats(threats);
    assert.equal(result.length, 1);
    assert.equal(result[0].urgency, 'near-term');
  });

  it('excludes medium-term and long-term', () => {
    const threats = [
      makeThreat({ urgency: 'medium-term' }),
      makeThreat({ urgency: 'long-term' }),
    ];
    assert.equal(getUrgentThreats(threats).length, 0);
  });

  it('returns all urgent when all are immediate or near-term', () => {
    const threats = [
      makeThreat({ urgency: 'immediate' }),
      makeThreat({ urgency: 'near-term' }),
      makeThreat({ urgency: 'immediate' }),
    ];
    assert.equal(getUrgentThreats(threats).length, 3);
  });

  it('returns empty for empty input', () => {
    assert.deepEqual(getUrgentThreats([]), []);
  });
});

// ── buildRenderData ───────────────────────────────────────────────────────────

describe('buildRenderData', () => {
  it('returns an object with expected keys', () => {
    const data = buildRenderData();
    assert.ok('programs' in data);
    assert.ok('threats' in data);
    assert.ok('maxEncryptionThreat' in data);
    assert.ok('totalInvestment' in data);
    assert.ok('leadingCountry' in data);
  });

  it('programs is a non-empty array', () => {
    const { programs } = buildRenderData();
    assert.ok(Array.isArray(programs) && programs.length > 0);
  });

  it('programs are sorted by dominanceScore descending', () => {
    const { programs } = buildRenderData();
    for (let i = 0; i < programs.length - 1; i++) {
      assert.ok(programs[i].dominanceScore >= programs[i + 1].dominanceScore,
        `program[${i}].dominanceScore (${programs[i].dominanceScore}) < program[${i+1}].dominanceScore (${programs[i+1].dominanceScore})`);
    }
  });

  it('threats is a non-empty array', () => {
    const { threats } = buildRenderData();
    assert.ok(Array.isArray(threats) && threats.length > 0);
  });

  it('maxEncryptionThreat is a number >= 0', () => {
    const { maxEncryptionThreat } = buildRenderData();
    assert.equal(typeof maxEncryptionThreat, 'number');
    assert.ok(maxEncryptionThreat >= 0);
  });

  it('maxEncryptionThreat is <= 100', () => {
    assert.ok(buildRenderData().maxEncryptionThreat <= 100);
  });

  it('totalInvestment is a positive number', () => {
    const { totalInvestment } = buildRenderData();
    assert.ok(totalInvestment > 0);
  });

  it('leadingCountry is a non-empty string', () => {
    const { leadingCountry } = buildRenderData();
    assert.equal(typeof leadingCountry, 'string');
    assert.ok(leadingCountry.length > 0);
  });

  it('leadingCountry matches the top-ranked program country', () => {
    const { programs, leadingCountry } = buildRenderData();
    assert.equal(leadingCountry, programs[0].country);
  });

  it('totalInvestment equals sum of all program investments', () => {
    const { programs, totalInvestment } = buildRenderData();
    const expected = programs.reduce((s, p) => s + p.annualInvestmentUSD, 0);
    assert.equal(totalInvestment, expected);
  });

  it('all threat ids are unique', () => {
    const { threats } = buildRenderData();
    const ids = threats.map(t => t.id);
    assert.equal(ids.length, new Set(ids).size);
  });

  it('all programs have valid domain values', () => {
    const validDomains: QuantumDomain[] = ['computing', 'communications', 'sensing', 'cryptography'];
    const { programs } = buildRenderData();
    for (const p of programs) {
      assert.ok(validDomains.includes(p.domain), `unexpected domain: ${p.domain}`);
    }
  });
});
