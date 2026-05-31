import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  outbreakTrajectory,
  buildOutbreakRows,
  groupWastewaterByJurisdiction,
  detectBiodisasterSignals,
  buildHealthcareStressRows,
  computePreparednessIndex,
  type BiodisasterFlag,
  type HealthcareStressRow,
  type OutbreakRow,
  type WastewaterMetroRow,
} from '../../src/components/HealthSuperpowerPanel.js';
import type { DiseaseOutbreak } from '../../src/services/disease-outbreak.js';
import type { WastewaterSignal } from '../../src/services/wastewater.js';
import type { Situation } from '../../src/services/situation-types.js';

const NOW = 1_758_000_000_000; // 2025-09-15

// ── Fixture helpers ──────────────────────────────────────────────────────────

function outbreak(over: Partial<DiseaseOutbreak> = {}): DiseaseOutbreak {
  return {
    id: over.id ?? `o-${Math.random().toString(36).slice(2, 8)}`,
    title: over.title ?? 'Routine seasonal flu cases',
    country: over.country ?? 'United States',
    disease: over.disease ?? 'Influenza',
    date: over.date ?? new Date(NOW - 86_400_000),
    source: over.source ?? 'WHO',
    severity: over.severity ?? 'low',
    ...(over.url ? { url: over.url } : {}),
  };
}

function wwSignal(over: Partial<WastewaterSignal> = {}): WastewaterSignal {
  return {
    pathogen: over.pathogen ?? 'COVID-19',
    jurisdiction: over.jurisdiction ?? 'Boston, MA',
    level: over.level ?? 'moderate',
    trend: over.trend ?? 'stable',
    percentile15d: over.percentile15d ?? null,
    ptc15d: over.ptc15d ?? null,
    lastUpdated: over.lastUpdated ?? new Date(NOW).toISOString(),
  };
}

function situation(over: Partial<Situation> & { domain?: string; title?: string; summary?: string; severity?: string; geo?: { label?: string } } = {}): Situation {
  return {
    id: over.id ?? `sit-${Math.random().toString(36).slice(2, 8)}`,
    title: over.title ?? 'Generic situation',
    summary: over.summary ?? 'A summary',
    domain: (over.domain ?? 'health') as Situation['domain'],
    severity: over.severity ?? 'medium',
    geo: over.geo ?? { label: 'Test Region' },
  } as unknown as Situation;
}

// ── outbreakTrajectory ───────────────────────────────────────────────────────

describe('outbreakTrajectory', () => {
  it('returns "stable" when input is undefined', () => {
    assert.equal(outbreakTrajectory(undefined), 'stable');
  });

  it('honors explicit trajectory hint when valid', () => {
    assert.equal(outbreakTrajectory({ trajectory: 'rising' }), 'rising');
    assert.equal(outbreakTrajectory({ trajectory: 'falling' }), 'falling');
  });

  it('detects rising trajectory from title keywords', () => {
    assert.equal(outbreakTrajectory({ title: 'Cholera cases surge in Lusaka' }), 'rising');
    assert.equal(outbreakTrajectory({ title: 'Rapid spread of measles' }), 'rising');
  });

  it('detects falling trajectory from title keywords', () => {
    assert.equal(outbreakTrajectory({ title: 'Outbreak contained after declining cases' }), 'falling');
  });

  it('defaults to "stable" when no signal is present', () => {
    assert.equal(outbreakTrajectory({ title: 'Routine reporting' }), 'stable');
  });
});

// ── buildOutbreakRows ────────────────────────────────────────────────────────

describe('buildOutbreakRows', () => {
  it('returns [] when input is empty', () => {
    assert.deepEqual(buildOutbreakRows([], NOW), []);
  });

  it('preserves disease, region, source, severity', () => {
    const rows = buildOutbreakRows([outbreak({
      disease: 'Marburg', country: 'Rwanda', source: 'WHO', severity: 'critical',
    })], NOW);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.disease, 'Marburg');
    assert.equal(rows[0]!.region, 'Rwanda');
    assert.equal(rows[0]!.source, 'WHO');
    assert.equal(rows[0]!.severity, 'critical');
  });

  it('drops entries with missing disease string', () => {
    const rows = buildOutbreakRows([
      outbreak({ disease: 'Ebola' }),
      outbreak({ disease: '' }),
    ], NOW);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.disease, 'Ebola');
  });

  it('orders critical > high > medium > low', () => {
    const rows = buildOutbreakRows([
      outbreak({ id: 'lo', severity: 'low', disease: 'X' }),
      outbreak({ id: 'cr', severity: 'critical', disease: 'Y' }),
      outbreak({ id: 'me', severity: 'medium', disease: 'Z' }),
      outbreak({ id: 'hi', severity: 'high', disease: 'W' }),
    ], NOW);
    assert.deepEqual(rows.map((r) => r.severity), ['critical', 'high', 'medium', 'low']);
  });

  it('breaks ties on severity by trajectory (rising first)', () => {
    const rows = buildOutbreakRows([
      outbreak({ id: 'a', severity: 'high', title: 'Cases declining in region A', disease: 'A' }),
      outbreak({ id: 'b', severity: 'high', title: 'Cases surge in region B', disease: 'B' }),
    ], NOW);
    assert.equal(rows[0]!.disease, 'B');
    assert.equal(rows[1]!.disease, 'A');
  });

  it('computes daysOld from outbreak.date', () => {
    const rows = buildOutbreakRows([
      outbreak({ date: new Date(NOW - 5 * 86_400_000), disease: 'D' }),
    ], NOW);
    assert.equal(rows[0]!.daysOld, 5);
  });

  it('caps results at 25 rows', () => {
    const many: DiseaseOutbreak[] = Array.from({ length: 40 }, (_, i) =>
      outbreak({ id: `o-${i}`, disease: `Disease-${i}` }));
    assert.equal(buildOutbreakRows(many, NOW).length, 25);
  });
});

// ── groupWastewaterByJurisdiction ────────────────────────────────────────────

describe('groupWastewaterByJurisdiction', () => {
  it('returns [] when input is empty', () => {
    assert.deepEqual(groupWastewaterByJurisdiction([]), []);
  });

  it('groups signals by jurisdiction', () => {
    const rows = groupWastewaterByJurisdiction([
      wwSignal({ jurisdiction: 'Boston, MA', pathogen: 'COVID-19' }),
      wwSignal({ jurisdiction: 'Boston, MA', pathogen: 'flu_a' }),
      wwSignal({ jurisdiction: 'Seattle, WA', pathogen: 'rsv' }),
    ]);
    assert.equal(rows.length, 2);
    const boston = rows.find((r) => r.jurisdiction === 'Boston, MA');
    assert.equal(boston?.pathogens.length, 2);
  });

  it('drops signals with empty jurisdiction', () => {
    const rows = groupWastewaterByJurisdiction([
      wwSignal({ jurisdiction: '', pathogen: 'COVID-19' }),
      wwSignal({ jurisdiction: 'NYC', pathogen: 'flu_a' }),
    ]);
    assert.equal(rows.length, 1);
  });

  it('bubbles the worst level to the row header', () => {
    const rows = groupWastewaterByJurisdiction([
      wwSignal({ jurisdiction: 'Metro', pathogen: 'COVID-19', level: 'moderate' }),
      wwSignal({ jurisdiction: 'Metro', pathogen: 'flu_a', level: 'high' }),
      wwSignal({ jurisdiction: 'Metro', pathogen: 'rsv', level: 'low' }),
    ]);
    assert.equal(rows[0]!.worstLevel, 'high');
  });

  it('caps pathogens per metro at 3, ranked by level desc', () => {
    const sigs: WastewaterSignal[] = [
      wwSignal({ jurisdiction: 'M', pathogen: 'COVID-19', level: 'low' }),
      wwSignal({ jurisdiction: 'M', pathogen: 'flu_a', level: 'high' }),
      wwSignal({ jurisdiction: 'M', pathogen: 'flu_b', level: 'moderate' }),
      wwSignal({ jurisdiction: 'M', pathogen: 'rsv', level: 'elevated' }),
      wwSignal({ jurisdiction: 'M', pathogen: 'norovirus', level: 'low' }),
    ];
    const rows = groupWastewaterByJurisdiction(sigs);
    assert.equal(rows[0]!.pathogens.length, 3);
    assert.equal(rows[0]!.pathogens[0]!.level, 'high');
    assert.equal(rows[0]!.pathogens[1]!.level, 'elevated');
  });

  it('sorts metros by worst level desc', () => {
    const rows = groupWastewaterByJurisdiction([
      wwSignal({ jurisdiction: 'Calm', pathogen: 'COVID-19', level: 'low' }),
      wwSignal({ jurisdiction: 'Hot', pathogen: 'COVID-19', level: 'high' }),
      wwSignal({ jurisdiction: 'Watch', pathogen: 'COVID-19', level: 'elevated' }),
    ]);
    assert.deepEqual(rows.map((r) => r.jurisdiction), ['Hot', 'Watch', 'Calm']);
  });
});

// ── detectBiodisasterSignals ─────────────────────────────────────────────────

describe('detectBiodisasterSignals', () => {
  it('returns [] when nothing matches', () => {
    assert.deepEqual(detectBiodisasterSignals([], []), []);
  });

  it('flags zoonotic spillover situations', () => {
    const flags = detectBiodisasterSignals(
      [situation({ domain: 'health', title: 'H5N1 avian influenza in dairy workers' })],
      [],
    );
    assert.equal(flags.length, 1);
    assert.equal(flags[0]!.kind, 'zoonotic-spillover');
  });

  it('flags new variants from situation titles', () => {
    const flags = detectBiodisasterSignals(
      [situation({ domain: 'health', title: 'New SARS-CoV-2 variant detected', summary: 'novel lineage' })],
      [],
    );
    assert.equal(flags[0]!.kind, 'new-variant');
  });

  it('flags antimicrobial resistance signals', () => {
    const flags = detectBiodisasterSignals(
      [situation({ domain: 'health', title: 'XDR tuberculosis cluster' })],
      [],
    );
    assert.equal(flags[0]!.kind, 'antimicrobial-resistance');
  });

  it('flags unusual clusters', () => {
    const flags = detectBiodisasterSignals(
      [situation({ domain: 'health', title: 'Unexplained respiratory cluster reported' })],
      [],
    );
    assert.equal(flags[0]!.kind, 'unusual-cluster');
  });

  it('flags from outbreaks too', () => {
    const flags = detectBiodisasterSignals(
      [],
      [outbreak({ disease: 'Mpox', title: 'New variant clade detected in returning travelers' })],
    );
    assert.equal(flags.length, 1);
    assert.equal(flags[0]!.source, 'outbreak');
  });

  it('ignores non-health situations', () => {
    const flags = detectBiodisasterSignals(
      [situation({ domain: 'cyber', title: 'novel variant of ransomware' })],
      [],
    );
    assert.equal(flags.length, 0);
  });

  it('dedupes by id', () => {
    const dup = situation({ id: 'dup', domain: 'health', title: 'H5N1 spillover in cats' });
    const flags = detectBiodisasterSignals([dup, dup], []);
    assert.equal(flags.length, 1);
  });

  it('caps at 12 entries', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      situation({ id: `s-${i}`, domain: 'health', title: `Novel variant ${i}` }));
    assert.equal(detectBiodisasterSignals(many, []).length, 12);
  });
});

// ── buildHealthcareStressRows ────────────────────────────────────────────────

describe('buildHealthcareStressRows', () => {
  it('returns [] when no health situations carry capacity signals', () => {
    assert.deepEqual(buildHealthcareStressRows([
      situation({ domain: 'health', title: 'Routine disease surveillance' }),
    ]), []);
  });

  it('flags ICU mentions as stress rows', () => {
    const rows = buildHealthcareStressRows([
      situation({ domain: 'health', title: 'ICU beds at 95% in Phoenix', severity: 'high' }),
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.status, 'red');
  });

  it('flags hospital capacity mentions', () => {
    const rows = buildHealthcareStressRows([
      situation({ domain: 'health', title: 'Hospital capacity strained', severity: 'medium' }),
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.status, 'yellow');
  });

  it('maps low/unknown severity to green', () => {
    const rows = buildHealthcareStressRows([
      situation({ domain: 'health', title: 'Local hospitals reporting normal ICU load', severity: 'low' }),
    ]);
    assert.equal(rows[0]!.status, 'green');
  });

  it('ignores non-health domains even with capacity keywords', () => {
    const rows = buildHealthcareStressRows([
      situation({ domain: 'cyber', title: 'ICU systems breach in datacenter' }),
    ]);
    assert.equal(rows.length, 0);
  });

  it('pulls region from geo.label when present', () => {
    const rows = buildHealthcareStressRows([
      situation({ domain: 'health', title: 'ICU strain', severity: 'critical', geo: { label: 'Phoenix, AZ' } }),
    ]);
    assert.equal(rows[0]!.region, 'Phoenix, AZ');
  });

  it('caps stress rows at 10', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      situation({ id: `s-${i}`, domain: 'health', title: `ICU strain in region ${i}` }));
    assert.equal(buildHealthcareStressRows(many).length, 10);
  });
});

// ── computePreparednessIndex ─────────────────────────────────────────────────

describe('computePreparednessIndex', () => {
  it('returns 100 / ready when nothing is wrong', () => {
    const prep = computePreparednessIndex([], [], [], []);
    assert.equal(prep.score, 100);
    assert.equal(prep.band, 'ready');
    assert.deepEqual(prep.contributors, []);
  });

  it('subtracts for each critical outbreak', () => {
    const outbreaks: OutbreakRow[] = [
      { id: 'a', region: 'X', disease: 'D', trajectory: 'rising', severity: 'critical', source: 'WHO', daysOld: 1 },
    ];
    const prep = computePreparednessIndex(outbreaks, [], [], []);
    assert.ok(prep.score < 100);
    assert.ok(prep.contributors.some((c) => c.label.includes('critical')));
  });

  it('caps critical-outbreak penalty at -40', () => {
    const outbreaks: OutbreakRow[] = Array.from({ length: 10 }, (_, i) => ({
      id: `a${i}`, region: 'X', disease: 'D', trajectory: 'stable', severity: 'critical', source: 'WHO', daysOld: 1,
    }));
    const prep = computePreparednessIndex(outbreaks, [], [], []);
    assert.ok(prep.score >= 60, `expected >= 60, got ${prep.score}`);
  });

  it('subtracts more for HIGH wastewater than ELEVATED', () => {
    const wwHigh: WastewaterMetroRow[] = [{ jurisdiction: 'A', worstLevel: 'high', pathogens: [] }];
    const wwElevated: WastewaterMetroRow[] = [{ jurisdiction: 'A', worstLevel: 'elevated', pathogens: [] }];
    const high = computePreparednessIndex([], wwHigh, [], []);
    const elevated = computePreparednessIndex([], wwElevated, [], []);
    assert.ok(high.score < elevated.score);
  });

  it('zoonotic spillover is the heaviest single biodisaster penalty', () => {
    const zoo: BiodisasterFlag[] = [{ id: 'z', kind: 'zoonotic-spillover', label: 'a', summary: '', source: 'situation' }];
    const variant: BiodisasterFlag[] = [{ id: 'v', kind: 'new-variant', label: 'a', summary: '', source: 'situation' }];
    const a = computePreparednessIndex([], [], zoo, []);
    const b = computePreparednessIndex([], [], variant, []);
    assert.ok(a.score < b.score);
  });

  it('red healthcare stress drops the score', () => {
    const stress: HealthcareStressRow[] = [{ region: 'X', status: 'red', reason: 'ICU full' }];
    const prep = computePreparednessIndex([], [], [], stress);
    assert.ok(prep.score < 100);
  });

  it('band thresholds: 80+ ready, 60+ guarded, 35+ stressed, else overwhelmed', () => {
    // Trigger an overwhelming pile to push score to 0.
    const outbreaks: OutbreakRow[] = Array.from({ length: 5 }, (_, i) => ({
      id: `c${i}`, region: 'X', disease: 'D', trajectory: 'rising', severity: 'critical', source: 'WHO', daysOld: 0,
    }));
    const ww: WastewaterMetroRow[] = Array.from({ length: 5 }, (_, i) => ({
      jurisdiction: `m${i}`, worstLevel: 'high', pathogens: [],
    }));
    const bio: BiodisasterFlag[] = [
      { id: 'z', kind: 'zoonotic-spillover', label: 'a', summary: '', source: 'situation' },
      { id: 'v', kind: 'new-variant', label: 'a', summary: '', source: 'situation' },
      { id: 'amr', kind: 'antimicrobial-resistance', label: 'a', summary: '', source: 'situation' },
    ];
    const stress: HealthcareStressRow[] = Array.from({ length: 5 }, (_, i) => ({
      region: `r${i}`, status: 'red', reason: 'x',
    }));
    const overwhelmed = computePreparednessIndex(outbreaks, ww, bio, stress);
    assert.equal(overwhelmed.band, 'overwhelmed');
    assert.ok(overwhelmed.score <= 34);
    const ready = computePreparednessIndex([], [], [], []);
    assert.equal(ready.band, 'ready');
  });

  it('score never falls below 0 or exceeds 100', () => {
    const outbreaks: OutbreakRow[] = Array.from({ length: 50 }, (_, i) => ({
      id: `c${i}`, region: 'X', disease: 'D', trajectory: 'rising', severity: 'critical', source: 'WHO', daysOld: 0,
    }));
    const prep = computePreparednessIndex(outbreaks, [], [], []);
    assert.ok(prep.score >= 0);
    const happy = computePreparednessIndex([], [], [], []);
    assert.ok(happy.score <= 100);
  });
});
