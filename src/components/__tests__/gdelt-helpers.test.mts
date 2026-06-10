import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  parseToneDescription,
  getToneClass,
  buildBarChart,
  formatThemeName,
  normalizeSummary,
  mapGdeltResponse,
  type GdeltSummary,
} from '../gdelt-helpers.ts';

// ── parseToneDescription ──────────────────────────────────────────────

describe('parseToneDescription', () => {
  it('extremely negative below -5', () => {
    assert.equal(parseToneDescription(-6), 'Extremely Negative');
  });
  it('extremely negative at -100 extreme', () => {
    assert.equal(parseToneDescription(-100), 'Extremely Negative');
  });
  it('negative at the -5 boundary', () => {
    assert.equal(parseToneDescription(-5), 'Negative');
  });
  it('negative in the -5..-2 band', () => {
    assert.equal(parseToneDescription(-3), 'Negative');
  });
  it('neutral at the -2 boundary', () => {
    assert.equal(parseToneDescription(-2), 'Neutral');
  });
  it('neutral at zero', () => {
    assert.equal(parseToneDescription(0), 'Neutral');
  });
  it('neutral at the +2 boundary', () => {
    assert.equal(parseToneDescription(2), 'Neutral');
  });
  it('positive just above +2', () => {
    assert.equal(parseToneDescription(2.5), 'Positive');
  });
  it('positive at +100 extreme', () => {
    assert.equal(parseToneDescription(100), 'Positive');
  });
});

// ── getToneClass ──────────────────────────────────────────────────────

describe('getToneClass', () => {
  it('crisis below -5', () => {
    assert.equal(getToneClass(-6), 'crisis');
  });
  it('crisis at -100 extreme', () => {
    assert.equal(getToneClass(-100), 'crisis');
  });
  it('negative exactly at -5 boundary', () => {
    assert.equal(getToneClass(-5), 'negative');
  });
  it('negative between -5 and -2', () => {
    assert.equal(getToneClass(-3.5), 'negative');
  });
  it('neutral exactly at -2 boundary', () => {
    assert.equal(getToneClass(-2), 'neutral');
  });
  it('neutral at zero', () => {
    assert.equal(getToneClass(0), 'neutral');
  });
  it('neutral exactly at +2 boundary', () => {
    assert.equal(getToneClass(2), 'neutral');
  });
  it('positive exactly at +5', () => {
    assert.equal(getToneClass(5), 'positive');
  });
  it('positive just above +2', () => {
    assert.equal(getToneClass(2.01), 'positive');
  });
  it('positive at +100 extreme', () => {
    assert.equal(getToneClass(100), 'positive');
  });
  it('only returns the four known classes', () => {
    const allowed = new Set(['positive', 'neutral', 'negative', 'crisis']);
    for (const t of [-100, -10, -5, -2, 0, 2, 5, 50]) {
      assert.ok(allowed.has(getToneClass(t)));
    }
  });
});

// ── buildBarChart ─────────────────────────────────────────────────────

describe('buildBarChart', () => {
  it('default width is 10', () => {
    assert.equal(buildBarChart(50, 100).length, 10);
  });
  it('respects a custom width', () => {
    assert.equal(buildBarChart(50, 100, 4).length, 4);
  });
  it('all empty at value 0', () => {
    assert.equal(buildBarChart(0, 100), '░░░░░░░░░░');
  });
  it('all filled at value === max', () => {
    assert.equal(buildBarChart(100, 100), '██████████');
  });
  it('half filled at half max', () => {
    assert.equal(buildBarChart(50, 100), '█████░░░░░');
  });
  it('clamps to full when value exceeds max', () => {
    assert.equal(buildBarChart(500, 100), '██████████');
  });
  it('clamps to empty for negative value', () => {
    assert.equal(buildBarChart(-20, 100), '░░░░░░░░░░');
  });
  it('returns all empty when max is 0 (no divide-by-zero)', () => {
    assert.equal(buildBarChart(5, 0), '░░░░░░░░░░');
  });
  it('returns all empty when max is negative', () => {
    assert.equal(buildBarChart(5, -10), '░░░░░░░░░░');
  });
  it('filled + empty always equals width', () => {
    for (const v of [0, 13, 50, 87, 100]) {
      const bar = buildBarChart(v, 100, 8);
      const filled = [...bar].filter(c => c === '█').length;
      const empty = [...bar].filter(c => c === '░').length;
      assert.equal(filled + empty, 8);
    }
  });
  it('custom width fills proportionally', () => {
    assert.equal(buildBarChart(50, 100, 4), '██░░');
  });
});

// ── formatThemeName ───────────────────────────────────────────────────

describe('formatThemeName', () => {
  it('converts the canonical WB CAMEO code', () => {
    assert.equal(formatThemeName('WB_635_CONFLICT_AND_VIOLENCE'), 'Conflict & Violence');
  });
  it('strips the TAX_FNCACT taxonomy prefix', () => {
    assert.equal(formatThemeName('TAX_FNCACT_PRESIDENT'), 'President');
  });
  it('strips a numeric year segment', () => {
    assert.equal(formatThemeName('WB_2024_ANTI_CORRUPTION'), 'Anti Corruption');
  });
  it('strips a letter+digit code segment', () => {
    assert.equal(formatThemeName('CRISISLEX_C03_WELLBEING_HEALTH'), 'Wellbeing Health');
  });
  it('strips the EPU prefix', () => {
    assert.equal(formatThemeName('EPU_POLICY'), 'Policy');
  });
  it('title-cases a single bare word', () => {
    assert.equal(formatThemeName('PROTEST'), 'Protest');
  });
  it('handles an already-clean theme', () => {
    assert.equal(formatThemeName('ECONOMY'), 'Economy');
  });
  it('replaces standalone AND with an ampersand', () => {
    assert.equal(formatThemeName('CRIME_AND_PUNISHMENT'), 'Crime & Punishment');
  });
  it('does not mangle AND inside a word', () => {
    assert.equal(formatThemeName('COMMAND'), 'Command');
  });
  it('returns empty string for empty input', () => {
    assert.equal(formatThemeName(''), '');
  });
});

// ── normalizeSummary + GdeltSummary structure ─────────────────────────

describe('normalizeSummary', () => {
  it('fills a complete default for null input', () => {
    const s = normalizeSummary(null);
    assert.equal(s.tone, 0);
    assert.deepEqual(s.topThemes, []);
    assert.deepEqual(s.topLocations, []);
    assert.deepEqual(s.topPeople, []);
    assert.deepEqual(s.topOrgs, []);
    assert.equal(s.fetchedAt, '');
  });
  it('fills a complete default for undefined input', () => {
    const s = normalizeSummary(undefined);
    assert.equal(s.tone, 0);
    assert.deepEqual(s.topThemes, []);
  });
  it('preserves a provided tone', () => {
    assert.equal(normalizeSummary({ tone: -2.3 }).tone, -2.3);
  });
  it('coerces a non-numeric tone to 0', () => {
    assert.equal(normalizeSummary({ tone: Number.NaN }).tone, 0);
  });
  it('preserves provided theme rows', () => {
    const s = normalizeSummary({ topThemes: [{ theme: 'WB_635_CONFLICT_AND_VIOLENCE', count: 8234 }] });
    assert.equal(s.topThemes.length, 1);
    assert.equal(s.topThemes[0].count, 8234);
  });
  it('defaults missing arrays to empty without throwing', () => {
    const s = normalizeSummary({ tone: 1.5, topPeople: [{ name: 'Biden', count: 3 }] });
    assert.deepEqual(s.topThemes, []);
    assert.deepEqual(s.topLocations, []);
    assert.equal(s.topPeople[0].name, 'Biden');
  });
  it('defaults a missing fetchedAt to empty string', () => {
    assert.equal(normalizeSummary({ tone: 0 }).fetchedAt, '');
  });
  it('produces a structurally valid GdeltSummary', () => {
    const s: GdeltSummary = normalizeSummary({
      tone: -2.3,
      topThemes: [{ theme: 'X', count: 1 }],
      topLocations: [{ name: 'United States', count: 12 }],
      topPeople: [{ name: 'Zelensky', count: 4 }],
      topOrgs: [{ name: 'NATO', count: 2 }],
      fetchedAt: '2026-06-10T00:00:00Z',
    });
    assert.equal(typeof s.tone, 'number');
    assert.ok(Array.isArray(s.topThemes));
    assert.ok(Array.isArray(s.topLocations));
    assert.ok(Array.isArray(s.topPeople));
    assert.ok(Array.isArray(s.topOrgs));
    assert.equal(typeof s.fetchedAt, 'string');
  });
  it('handles empty arrays gracefully end to end', () => {
    const s = normalizeSummary({ tone: 0, topThemes: [], topLocations: [], topPeople: [], topOrgs: [] });
    assert.equal(s.topThemes.length, 0);
    assert.equal(buildBarChart(0, 0).length, 10);
  });
});

// ── mapGdeltResponse (raw GDELT DOC API JSON -> GdeltSummary) ──────────

const FETCHED_AT = '2026-06-10T12:00:00Z';

function toneJson(values: number[]) {
  return {
    timeline: [
      { series: 'Average Tone', data: values.map((v, i) => ({ date: `20260610T0${i}0000Z`, value: v })) },
    ],
  };
}

function artJson(articles: Array<{ title?: string; sourcecountry?: string }>) {
  return { articles };
}

describe('mapGdeltResponse', () => {
  it('extracts the latest finite tone from the timeline series', () => {
    const s = mapGdeltResponse(toneJson([-3.6, -1.6, -2.5]), artJson([]), FETCHED_AT);
    assert.equal(s.tone, -2.5);
  });
  it('defaults tone to 0 when the timeline is missing', () => {
    assert.equal(mapGdeltResponse({}, {}, FETCHED_AT).tone, 0);
  });
  it('defaults tone to 0 when the data series is empty', () => {
    assert.equal(mapGdeltResponse(toneJson([]), artJson([]), FETCHED_AT).tone, 0);
  });
  it('ignores trailing non-finite tone values and uses the last finite one', () => {
    const raw = { timeline: [{ series: 'Average Tone', data: [
      { date: 'a', value: -4.2 },
      { date: 'b', value: 'NaN' },
      { date: 'c', value: null },
    ] }] };
    assert.equal(mapGdeltResponse(raw, artJson([]), FETCHED_AT).tone, -4.2);
  });
  it('counts top locations from sourcecountry, sorted descending', () => {
    const s = mapGdeltResponse(toneJson([0]), artJson([
      { sourcecountry: 'United States', title: '' },
      { sourcecountry: 'Ukraine', title: '' },
      { sourcecountry: 'United States', title: '' },
      { sourcecountry: 'United States', title: '' },
      { sourcecountry: 'Ukraine', title: '' },
    ]), FETCHED_AT);
    assert.equal(s.topLocations[0].name, 'United States');
    assert.equal(s.topLocations[0].count, 3);
    assert.equal(s.topLocations[1].name, 'Ukraine');
    assert.equal(s.topLocations[1].count, 2);
  });
  it('caps top locations at 8 entries', () => {
    const articles = Array.from({ length: 20 }, (_, i) => ({ sourcecountry: `Country${i}`, title: '' }));
    const s = mapGdeltResponse(toneJson([0]), artJson(articles), FETCHED_AT);
    assert.ok(s.topLocations.length <= 8);
  });
  it('skips articles with blank or missing sourcecountry', () => {
    const s = mapGdeltResponse(toneJson([0]), artJson([
      { sourcecountry: '', title: '' },
      { title: '' },
      { sourcecountry: 'France', title: '' },
    ]), FETCHED_AT);
    assert.equal(s.topLocations.length, 1);
    assert.equal(s.topLocations[0].name, 'France');
  });
  it('tallies themes from real article headlines', () => {
    const s = mapGdeltResponse(toneJson([0]), artJson([
      { title: 'Missile strike kills dozens as fighting escalates' },
      { title: 'Mass protest rally fills the capital' },
      { title: 'Oil and gas prices surge on supply fears' },
    ]), FETCHED_AT);
    const labels = s.topThemes.map(t => t.theme);
    assert.ok(labels.includes('Conflict & Violence'));
    assert.ok(labels.includes('Protest & Unrest'));
    assert.ok(labels.includes('Energy'));
  });
  it('excludes themes with no headline matches', () => {
    const s = mapGdeltResponse(toneJson([0]), artJson([
      { title: 'Local bakery wins regional dessert award' },
    ]), FETCHED_AT);
    assert.ok(s.topThemes.every(t => t.count > 0));
  });
  it('sorts themes by descending count', () => {
    const s = mapGdeltResponse(toneJson([0]), artJson([
      { title: 'war attack missile' },
      { title: 'war attack' },
      { title: 'protest' },
    ]), FETCHED_AT);
    for (let i = 1; i < s.topThemes.length; i++) {
      assert.ok(s.topThemes[i - 1].count >= s.topThemes[i].count);
    }
  });
  it('leaves people and orgs empty (not available in the free DOC JSON path)', () => {
    const s = mapGdeltResponse(toneJson([-2]), artJson([{ title: 'war', sourcecountry: 'X' }]), FETCHED_AT);
    assert.deepEqual(s.topPeople, []);
    assert.deepEqual(s.topOrgs, []);
  });
  it('stamps fetchedAt from the argument', () => {
    assert.equal(mapGdeltResponse({}, {}, FETCHED_AT).fetchedAt, FETCHED_AT);
  });
  it('tolerates entirely garbage input and returns a valid summary', () => {
    const s = mapGdeltResponse(null, undefined, FETCHED_AT);
    assert.equal(s.tone, 0);
    assert.deepEqual(s.topLocations, []);
    assert.deepEqual(s.topThemes, []);
    assert.equal(s.fetchedAt, FETCHED_AT);
  });
  it('skips malformed (non-object) articles without throwing', () => {
    const raw = { articles: [null, 'nope', 42, { sourcecountry: 'Spain', title: 'war' }] };
    const s = mapGdeltResponse(toneJson([0]), raw, FETCHED_AT);
    assert.equal(s.topLocations[0].name, 'Spain');
  });
});
