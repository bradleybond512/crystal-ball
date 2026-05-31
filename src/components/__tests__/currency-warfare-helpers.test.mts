import assert from 'node:assert/strict';
import test from 'node:test';

import {
  severityToScore,
  warfareTier,
  freshnessMultiplier,
  scoreCurrencyRisks,
  normalizeCurrencyCode,
  blocLabel,
  blocOf,
  scoreBlocRisks,
  scoreReserveShift,
  scoreDollarWeaponization,
  scoreSwiftExclusion,
  eventToWarfareSignal,
  eventsToWarfareSignals,
  formatTimeAgo,
  buildCurrencyWarfareState,
  renderCurrencyWarfareHtml,
  ALL_DIMENSIONS,
  DIMENSION_WEIGHTS,
  type WarfareSignal,
} from '../currency-warfare-helpers.ts';
import type { ObservationEvent, ObservationSeverity } from '@/types/intelligence';

const NOW = Date.parse('2026-05-26T12:00:00Z');
const DAY_MS = 86_400_000;

function signal(over: Partial<WarfareSignal> = {}): WarfareSignal {
  return {
    dimension: over.dimension ?? 'fx-intervention',
    currencyCodes: over.currencyCodes ?? ['JPY'],
    severity: over.severity ?? 'HIGH',
    observedAt: over.observedAt ?? NOW,
    label: over.label ?? 'test label',
    sourceId: over.sourceId,
  };
}

function obs(over: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: over.id ?? 'ev-1',
    sourceId: over.sourceId ?? 'test',
    domain: over.domain ?? 'finance',
    timestamp: over.timestamp ?? NOW,
    severity: over.severity ?? 'HIGH',
    title: over.title ?? 'Test event',
    raw: over.raw ?? {},
    entityIds: over.entityIds ?? [],
    tags: over.tags ?? [],
    location: over.location,
  };
}

// ── severityToScore ───────────────────────────────────────────────

test('severityToScore covers every level', () => {
  assert.equal(severityToScore('INFO'), 0);
  assert.equal(severityToScore('LOW'), 2);
  assert.equal(severityToScore('MEDIUM'), 5);
  assert.equal(severityToScore('HIGH'), 7);
  assert.equal(severityToScore('CRITICAL'), 9);
});

test('severityToScore returns 0 for unknown severity', () => {
  assert.equal(severityToScore('UNKNOWN' as ObservationSeverity), 0);
});

// ── warfareTier ───────────────────────────────────────────────────

test('warfareTier maps score ranges', () => {
  assert.equal(warfareTier(0), 'calm');
  assert.equal(warfareTier(19), 'calm');
  assert.equal(warfareTier(20), 'watch');
  assert.equal(warfareTier(39), 'watch');
  assert.equal(warfareTier(40), 'elevated');
  assert.equal(warfareTier(59), 'elevated');
  assert.equal(warfareTier(60), 'stressed');
  assert.equal(warfareTier(79), 'stressed');
  assert.equal(warfareTier(80), 'crisis');
  assert.equal(warfareTier(100), 'crisis');
});

// ── freshnessMultiplier ───────────────────────────────────────────

test('freshnessMultiplier is 1.0 for current signals', () => {
  assert.ok(freshnessMultiplier(NOW, NOW) >= 0.99);
});

test('freshnessMultiplier halves around the half-life mark', () => {
  const tenDays = 10 * DAY_MS;
  const decayed = freshnessMultiplier(NOW - tenDays, NOW);
  assert.ok(decayed > 0.45 && decayed < 0.55, `expected ~0.5, got ${decayed}`);
});

test('freshnessMultiplier never drops below the 0.05 floor', () => {
  const oneYear = 365 * DAY_MS;
  assert.ok(freshnessMultiplier(NOW - oneYear, NOW) >= 0.05);
});

test('freshnessMultiplier clamps future timestamps to 1.0', () => {
  const future = NOW + 30 * DAY_MS;
  assert.equal(freshnessMultiplier(future, NOW), 1);
});

// ── normalizeCurrencyCode ─────────────────────────────────────────

test('normalizeCurrencyCode accepts canonical ISO 4217', () => {
  assert.equal(normalizeCurrencyCode('USD'), 'USD');
  assert.equal(normalizeCurrencyCode('jpy'), 'JPY');
  assert.equal(normalizeCurrencyCode('  eur  '), 'EUR');
});

test('normalizeCurrencyCode rejects wrong length', () => {
  assert.equal(normalizeCurrencyCode('US'), null);
  assert.equal(normalizeCurrencyCode('DOLLARS'), null);
  assert.equal(normalizeCurrencyCode(''), null);
});

test('normalizeCurrencyCode rejects non-letter input', () => {
  assert.equal(normalizeCurrencyCode('US1'), null);
  assert.equal(normalizeCurrencyCode('U S'), null);
});

test('normalizeCurrencyCode rejects non-string input', () => {
  assert.equal(normalizeCurrencyCode(123 as unknown as string), null);
});

// ── blocOf / blocLabel ────────────────────────────────────────────

test('blocOf classifies anchor reserve currencies', () => {
  assert.equal(blocOf('USD'), 'usd-bloc');
  assert.equal(blocOf('EUR'), 'eur-bloc');
  assert.equal(blocOf('CNY'), 'cny-bloc');
});

test('blocOf classifies Gulf pegs separately from USD bloc', () => {
  assert.equal(blocOf('SAR'), 'gulf-pegs');
  assert.equal(blocOf('AED'), 'gulf-pegs');
});

test('blocOf classifies EM regions distinctly', () => {
  assert.equal(blocOf('TRY'), 'em-europe');
  assert.equal(blocOf('BRL'), 'em-latam');
  assert.equal(blocOf('NGN'), 'em-africa');
  assert.equal(blocOf('IDR'), 'em-asia');
});

test('blocOf returns reserve-alts for gold/SDR', () => {
  assert.equal(blocOf('XAU'), 'reserve-alts');
  assert.equal(blocOf('XDR'), 'reserve-alts');
});

test('blocOf returns other for unknown codes', () => {
  assert.equal(blocOf('ZZZ'), 'other');
});

test('blocLabel covers every bloc', () => {
  for (const code of ['USD', 'EUR', 'CNY', 'SAR', 'JPY', 'BRL', 'NGN', 'TRY', 'XAU', 'ZZZ']) {
    const label = blocLabel(blocOf(code));
    assert.ok(label.length > 0, `bloc label missing for ${code}`);
  }
});

// ── DIMENSION_WEIGHTS ─────────────────────────────────────────────

test('DIMENSION_WEIGHTS sums to 1.0', () => {
  const sum = ALL_DIMENSIONS.reduce((acc, d) => acc + DIMENSION_WEIGHTS[d], 0);
  assert.ok(Math.abs(sum - 1) < 0.001, `weights sum to ${sum}`);
});

test('dollar-weaponization carries the heaviest weight', () => {
  for (const dim of ALL_DIMENSIONS) {
    if (dim === 'dollar-weaponization') continue;
    assert.ok(
      DIMENSION_WEIGHTS['dollar-weaponization'] >= DIMENSION_WEIGHTS[dim],
      `dollar-weaponization weight should dominate ${dim}`,
    );
  }
});

// ── scoreCurrencyRisks ────────────────────────────────────────────

test('scoreCurrencyRisks returns empty array with no signals', () => {
  assert.deepEqual(scoreCurrencyRisks([]), []);
});

test('scoreCurrencyRisks ignores signals with no valid currency codes', () => {
  const ignored = scoreCurrencyRisks([signal({ currencyCodes: ['XX'] })]);
  assert.deepEqual(ignored, []);
});

test('scoreCurrencyRisks produces a critical tier for severe USD weaponization', () => {
  const out = scoreCurrencyRisks([
    signal({ dimension: 'dollar-weaponization', currencyCodes: ['RUB'], severity: 'CRITICAL', label: 'OFAC block' }),
    signal({ dimension: 'swift-exclusion', currencyCodes: ['RUB'], severity: 'CRITICAL', label: 'SWIFT cut' }),
    signal({ dimension: 'capital-flight', currencyCodes: ['RUB'], severity: 'HIGH', label: 'reserve drain' }),
  ], NOW);
  assert.equal(out.length, 1);
  const rub = out[0]!;
  assert.equal(rub.currencyCode, 'RUB');
  assert.ok(rub.score >= 40, `expected stressed-or-higher, got ${rub.score}`);
  assert.ok(['elevated', 'stressed', 'crisis'].includes(rub.tier));
});

test('scoreCurrencyRisks down-weights stale signals when mixed with fresh ones', () => {
  // One fresh MEDIUM + one stale CRITICAL scores closer to MEDIUM than to
  // CRITICAL: the freshness multiplier on the stale signal pulls the
  // weighted mean down. Compare against a fresh-only CRITICAL baseline.
  const mixed = scoreCurrencyRisks([
    signal({ currencyCodes: ['JPY'], observedAt: NOW, severity: 'MEDIUM' }),
    signal({ currencyCodes: ['JPY'], observedAt: NOW - 90 * DAY_MS, severity: 'CRITICAL' }),
  ], NOW)[0]!;
  const freshOnly = scoreCurrencyRisks([
    signal({ currencyCodes: ['KRW'], observedAt: NOW, severity: 'CRITICAL' }),
  ], NOW)[0]!;
  assert.ok(mixed.score < freshOnly.score, `mixed=${mixed.score} freshOnly=${freshOnly.score}`);
});

test('scoreCurrencyRisks attributes signal to every named currency', () => {
  const out = scoreCurrencyRisks([
    signal({ dimension: 'competitive-devaluation', currencyCodes: ['CNY', 'USD'], severity: 'HIGH', label: 'devaluation round' }),
  ]);
  assert.equal(out.length, 2);
  const codes = out.map((c) => c.currencyCode).sort();
  assert.deepEqual(codes, ['CNY', 'USD']);
});

test('scoreCurrencyRisks records last-updated timestamp', () => {
  const out = scoreCurrencyRisks([
    signal({ currencyCodes: ['EUR'], observedAt: NOW - 2 * DAY_MS }),
    signal({ currencyCodes: ['EUR'], observedAt: NOW }),
  ])[0]!;
  assert.equal(out.lastUpdated, NOW);
});

test('scoreCurrencyRisks amplifier slightly favors many signals over few', () => {
  const many = scoreCurrencyRisks(Array.from({ length: 10 }, () =>
    signal({ currencyCodes: ['TRY'], severity: 'MEDIUM' }),
  ))[0]!;
  const few = scoreCurrencyRisks([
    signal({ currencyCodes: ['TRY'], severity: 'MEDIUM' }),
  ])[0]!;
  assert.ok(many.score >= few.score, `many=${many.score} few=${few.score}`);
});

test('scoreCurrencyRisks sorts by composite score descending', () => {
  const out = scoreCurrencyRisks([
    signal({ currencyCodes: ['JPY'], severity: 'LOW' }),
    signal({ currencyCodes: ['RUB'], severity: 'CRITICAL', dimension: 'dollar-weaponization' }),
    signal({ currencyCodes: ['MXN'], severity: 'MEDIUM' }),
  ]);
  assert.equal(out[0]!.currencyCode, 'RUB');
});

test('scoreCurrencyRisks dimension breakdown is sorted by weighted contribution', () => {
  const out = scoreCurrencyRisks([
    signal({ dimension: 'fx-intervention', currencyCodes: ['JPY'], severity: 'LOW' }),
    signal({ dimension: 'dollar-weaponization', currencyCodes: ['JPY'], severity: 'HIGH', label: 'sanctions on JPY trade' }),
  ])[0]!;
  assert.equal(out.byDimension[0]!.dimension, 'dollar-weaponization');
});

test('scoreCurrencyRisks pickTopDrivers returns at most three labels', () => {
  const out = scoreCurrencyRisks([
    signal({ dimension: 'fx-intervention', currencyCodes: ['JPY'], label: 'BOJ buys yen' }),
    signal({ dimension: 'peg-stress', currencyCodes: ['JPY'], label: 'yield-curve test' }),
    signal({ dimension: 'capital-flight', currencyCodes: ['JPY'], label: 'outflows surge' }),
    signal({ dimension: 'competitive-devaluation', currencyCodes: ['JPY'], label: 'CNY response' }),
  ])[0]!;
  assert.ok(out.topDrivers.length <= 3);
});

// ── scoreBlocRisks ────────────────────────────────────────────────

test('scoreBlocRisks groups currencies into their bloc', () => {
  const blocs = scoreBlocRisks(scoreCurrencyRisks([
    signal({ currencyCodes: ['EUR'], dimension: 'fx-intervention', severity: 'HIGH' }),
    signal({ currencyCodes: ['GBP'], dimension: 'fx-intervention', severity: 'MEDIUM' }),
    signal({ currencyCodes: ['JPY'], dimension: 'fx-intervention', severity: 'HIGH' }),
  ]));
  const euro = blocs.find((b) => b.bloc === 'eur-bloc');
  assert.ok(euro);
  assert.equal(euro!.currencyCount, 2);
});

test('scoreBlocRisks top-heavy mean pulls bloc up when one currency is in crisis', () => {
  const blocs = scoreBlocRisks(scoreCurrencyRisks([
    signal({ currencyCodes: ['RUB'], dimension: 'dollar-weaponization', severity: 'CRITICAL' }),
    signal({ currencyCodes: ['RUB'], dimension: 'swift-exclusion', severity: 'CRITICAL' }),
    signal({ currencyCodes: ['PLN'], dimension: 'fx-intervention', severity: 'LOW' }),
  ]));
  const emEurope = blocs.find((b) => b.bloc === 'em-europe');
  assert.ok(emEurope);
  assert.ok(emEurope!.score > 0);
});

test('scoreBlocRisks returns empty array when no currencies score', () => {
  assert.deepEqual(scoreBlocRisks([]), []);
});

test('scoreBlocRisks topCurrencies returns at most three entries', () => {
  const signals: WarfareSignal[] = [];
  for (const code of ['IDR', 'PHP', 'MYR', 'THB', 'VND']) {
    signals.push(signal({ currencyCodes: [code], dimension: 'fx-intervention', severity: 'MEDIUM' }));
  }
  const blocs = scoreBlocRisks(scoreCurrencyRisks(signals));
  const emAsia = blocs.find((b) => b.bloc === 'em-asia');
  assert.ok(emAsia);
  assert.ok(emAsia!.topCurrencies.length <= 3);
});

// ── scoreReserveShift ─────────────────────────────────────────────

test('scoreReserveShift only includes reserve-shift signals', () => {
  const out = scoreReserveShift([
    signal({ dimension: 'reserve-shift', currencyCodes: ['CNY'], severity: 'HIGH', label: 'BRICS settlement' }),
    signal({ dimension: 'reserve-shift', currencyCodes: ['XAU'], severity: 'CRITICAL', label: 'central bank gold buying' }),
    signal({ dimension: 'fx-intervention', currencyCodes: ['CNY'], severity: 'HIGH', label: 'PBoC FX op' }),
  ]);
  const codes = out.map((e) => e.targetCurrency).sort();
  assert.deepEqual(codes, ['CNY', 'XAU']);
});

test('scoreReserveShift sorts by score descending and dedupes drivers', () => {
  const out = scoreReserveShift([
    signal({ dimension: 'reserve-shift', currencyCodes: ['CNY'], severity: 'MEDIUM', label: 'announcement A' }),
    signal({ dimension: 'reserve-shift', currencyCodes: ['XAU'], severity: 'CRITICAL', label: 'gold rush' }),
  ]);
  assert.equal(out[0]!.targetCurrency, 'XAU');
  assert.ok(out[0]!.score >= out[1]!.score);
});

test('scoreReserveShift returns empty array when no reserve-shift signals', () => {
  assert.deepEqual(scoreReserveShift([
    signal({ dimension: 'fx-intervention', currencyCodes: ['USD'] }),
  ]), []);
});

// ── scoreDollarWeaponization + scoreSwiftExclusion ────────────────

test('scoreDollarWeaponization only includes weaponization signals', () => {
  const out = scoreDollarWeaponization([
    signal({ dimension: 'dollar-weaponization', currencyCodes: ['RUB'], severity: 'CRITICAL', label: 'OFAC block' }),
    signal({ dimension: 'swift-exclusion', currencyCodes: ['RUB'], severity: 'CRITICAL' }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.currencyCode, 'RUB');
});

test('scoreSwiftExclusion sorts by score descending', () => {
  const out = scoreSwiftExclusion([
    signal({ dimension: 'swift-exclusion', currencyCodes: ['IRR'], severity: 'CRITICAL', label: 'Iran cutoff' }),
    signal({ dimension: 'swift-exclusion', currencyCodes: ['KPW'], severity: 'MEDIUM', label: 'DPRK measures' }),
  ]);
  assert.ok(out[0]!.score >= out[1]!.score);
});

test('scoreSwiftExclusion latest reflects the newest signal', () => {
  const out = scoreSwiftExclusion([
    signal({ dimension: 'swift-exclusion', currencyCodes: ['RUB'], observedAt: NOW - 3 * DAY_MS }),
    signal({ dimension: 'swift-exclusion', currencyCodes: ['RUB'], observedAt: NOW - DAY_MS }),
  ]);
  assert.equal(out[0]!.latest, NOW - DAY_MS);
});

// ── eventToWarfareSignal ──────────────────────────────────────────

test('eventToWarfareSignal converts well-tagged events', () => {
  const out = eventToWarfareSignal(obs({
    tags: ['dollar-weaponization', 'currency:RUB'],
    severity: 'CRITICAL',
    title: 'OFAC block on RUB clearing',
  }));
  assert.ok(out);
  assert.equal(out!.dimension, 'dollar-weaponization');
  assert.deepEqual(out!.currencyCodes, ['RUB']);
  assert.equal(out!.severity, 'CRITICAL');
});

test('eventToWarfareSignal picks dimension from any matching tag', () => {
  const out = eventToWarfareSignal(obs({
    tags: ['unrelated-tag', 'capital-flight', 'currency:TRY'],
  }));
  assert.equal(out!.dimension, 'capital-flight');
});

test('eventToWarfareSignal pulls currency codes from entityIds', () => {
  const out = eventToWarfareSignal(obs({
    tags: ['swift-exclusion'],
    entityIds: ['IRR'],
  }));
  assert.deepEqual(out!.currencyCodes, ['IRR']);
});

test('eventToWarfareSignal returns null without a dimension tag', () => {
  assert.equal(eventToWarfareSignal(obs({
    tags: ['currency:USD'],
    entityIds: ['USD'],
  })), null);
});

test('eventToWarfareSignal returns null without any currency', () => {
  assert.equal(eventToWarfareSignal(obs({
    tags: ['fx-intervention'],
  })), null);
});

test('eventToWarfareSignal de-dupes currency codes across tags + entityIds', () => {
  const out = eventToWarfareSignal(obs({
    tags: ['fx-intervention', 'currency:JPY'],
    entityIds: ['JPY'],
  }));
  assert.deepEqual(out!.currencyCodes, ['JPY']);
});

test('eventsToWarfareSignals drops un-tagged events silently', () => {
  const out = eventsToWarfareSignals([
    obs({ id: 'a', tags: ['fx-intervention'], entityIds: ['JPY'] }),
    obs({ id: 'b', tags: [] }),
    obs({ id: 'c', tags: ['peg-stress'], entityIds: ['HKD'] }),
  ]);
  assert.equal(out.length, 2);
});

// ── formatTimeAgo ─────────────────────────────────────────────────

test('formatTimeAgo seconds < minute', () => {
  assert.equal(formatTimeAgo(NOW - 5 * 1000, NOW), '5s ago');
});

test('formatTimeAgo minutes < hour', () => {
  assert.equal(formatTimeAgo(NOW - 5 * 60 * 1000, NOW), '5m ago');
});

test('formatTimeAgo hours < day', () => {
  assert.equal(formatTimeAgo(NOW - 3 * 60 * 60 * 1000, NOW), '3h ago');
});

test('formatTimeAgo days for older timestamps', () => {
  assert.equal(formatTimeAgo(NOW - 5 * DAY_MS, NOW), '5d ago');
});

test('formatTimeAgo handles future timestamps', () => {
  assert.equal(formatTimeAgo(NOW + 1000, NOW), 'just now');
});

// ── buildCurrencyWarfareState + renderer ──────────────────────────

test('buildCurrencyWarfareState composes every section', () => {
  const signals: WarfareSignal[] = [
    signal({ dimension: 'dollar-weaponization', currencyCodes: ['RUB'], severity: 'CRITICAL', label: 'OFAC block' }),
    signal({ dimension: 'swift-exclusion', currencyCodes: ['RUB'], severity: 'CRITICAL', label: 'SWIFT cut' }),
    signal({ dimension: 'reserve-shift', currencyCodes: ['CNY'], severity: 'HIGH', label: 'BRICS settlement' }),
    signal({ dimension: 'fx-intervention', currencyCodes: ['JPY'], severity: 'MEDIUM', label: 'BOJ buys yen' }),
  ];
  const state = buildCurrencyWarfareState({ signals }, NOW);
  assert.ok(state.topCurrencies.length > 0);
  assert.ok(state.blocs.length > 0);
  assert.ok(state.dollarWeaponization.length > 0);
  assert.ok(state.swiftExclusion.length > 0);
  assert.ok(state.reserveShift.length > 0);
  assert.equal(state.signalCount, signals.length);
  assert.equal(state.generatedAt, NOW);
});

test('buildCurrencyWarfareState respects currencyLimit', () => {
  const signals: WarfareSignal[] = [];
  for (const code of ['USD', 'EUR', 'JPY', 'GBP', 'CNY', 'CHF']) {
    signals.push(signal({ currencyCodes: [code], dimension: 'fx-intervention' }));
  }
  const state = buildCurrencyWarfareState({ signals, currencyLimit: 3 }, NOW);
  assert.equal(state.topCurrencies.length, 3);
});

test('renderCurrencyWarfareHtml includes every section header', () => {
  const signals: WarfareSignal[] = [
    signal({ dimension: 'dollar-weaponization', currencyCodes: ['RUB'], severity: 'CRITICAL' }),
    signal({ dimension: 'swift-exclusion', currencyCodes: ['RUB'], severity: 'CRITICAL' }),
    signal({ dimension: 'reserve-shift', currencyCodes: ['CNY'], severity: 'HIGH' }),
  ];
  const html = renderCurrencyWarfareHtml(buildCurrencyWarfareState({ signals }, NOW), () => NOW);
  assert.ok(html.includes('Bloc Stress'));
  assert.ok(html.includes('Top Currencies'));
  assert.ok(html.includes('USD Weaponization'));
  assert.ok(html.includes('SWIFT Exclusion'));
  assert.ok(html.includes('Reserve Shift'));
});

test('renderCurrencyWarfareHtml escapes user-controlled labels', () => {
  const html = renderCurrencyWarfareHtml(buildCurrencyWarfareState({
    signals: [signal({
      dimension: 'fx-intervention',
      currencyCodes: ['JPY'],
      label: '<script>alert(1)</script>',
    })],
  }, NOW), () => NOW);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('renderCurrencyWarfareHtml shows empty-state messages with no data', () => {
  const html = renderCurrencyWarfareHtml(buildCurrencyWarfareState({ signals: [] }, NOW), () => NOW);
  assert.ok(html.includes('No bloc signals'));
  assert.ok(html.includes('No currency signals'));
  assert.ok(html.includes('No usd weaponization signals'));
  assert.ok(html.includes('No swift exclusion signals'));
  assert.ok(html.includes('No reserve-shift signals'));
});
