import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIPLOMATIC_SIGNALS,
  BILATERAL_RELATIONSHIPS,
  buildRenderData,
  getBySignalType,
  getEscalatorySignals,
  getWarmingSignals,
  getByCountry,
  getHostileRelationships,
  getDeterioratingRelationships,
  computeGlobalDiplomaticTensionIndex,
  sentimentClass,
  intensityClass,
  relationshipStatusClass,
  type DiplomaticSignal,
  type BilateralRelationship,
  type SignalType,
  type SignalSentiment,
} from '../diplomatic-signals-helpers';

const SENTIMENTS: SignalSentiment[] = ['escalatory', 'cooling', 'warming', 'neutral'];
const INTENSITIES: DiplomaticSignal['intensity'][] = ['critical', 'high', 'medium', 'low'];
const STATUSES: BilateralRelationship['currentStatus'][] = [
  'hostile',
  'tense',
  'neutral',
  'cooperative',
  'allied',
];
const SIGNAL_TYPES: SignalType[] = [
  'ambassador-recall',
  'expulsion',
  'embassy-closure',
  'visa-restriction',
  'state-visit',
  'joint-statement',
  'hotline-established',
  'sanctions-waiver',
  'trade-suspension',
  'military-attache-expulsion',
];

// ── Fixture shape ──────────────────────────────────────────────────────────

test('DIPLOMATIC_SIGNALS has exactly 15 entries', () => {
  assert.equal(DIPLOMATIC_SIGNALS.length, 15);
});

test('BILATERAL_RELATIONSHIPS has exactly 10 entries', () => {
  assert.equal(BILATERAL_RELATIONSHIPS.length, 10);
});

test('all signal ids are unique', () => {
  const ids = new Set(DIPLOMATIC_SIGNALS.map((s) => s.id));
  assert.equal(ids.size, 15);
});

test('all relationship ids are unique', () => {
  const ids = new Set(BILATERAL_RELATIONSHIPS.map((r) => r.id));
  assert.equal(ids.size, 10);
});

test('every signal has a non-empty id', () => {
  for (const s of DIPLOMATIC_SIGNALS) assert.ok(s.id.length > 0);
});

test('every signal has a non-empty initiatingCountry', () => {
  for (const s of DIPLOMATIC_SIGNALS) assert.ok(s.initiatingCountry.length > 0, s.id);
});

test('every signal has a non-empty targetCountry', () => {
  for (const s of DIPLOMATIC_SIGNALS) assert.ok(s.targetCountry.length > 0, s.id);
});

test('every signal has a non-empty context', () => {
  for (const s of DIPLOMATIC_SIGNALS) assert.ok(s.context.length > 0, s.id);
});

test('every signal has a non-empty notes', () => {
  for (const s of DIPLOMATIC_SIGNALS) assert.ok(s.notes.length > 0, s.id);
});

test('every signal date is YYYY-MM format', () => {
  for (const s of DIPLOMATIC_SIGNALS) assert.match(s.date, /^\d{4}-\d{2}$/, s.id);
});

test('every signal sentiment is a known value', () => {
  for (const s of DIPLOMATIC_SIGNALS) assert.ok(SENTIMENTS.includes(s.sentiment), s.id);
});

test('every signal intensity is a known value', () => {
  for (const s of DIPLOMATIC_SIGNALS) assert.ok(INTENSITIES.includes(s.intensity), s.id);
});

test('every signal signalType is a known value', () => {
  for (const s of DIPLOMATIC_SIGNALS) assert.ok(SIGNAL_TYPES.includes(s.signalType), s.id);
});

test('every relationship has a non-empty country1 and country2', () => {
  for (const r of BILATERAL_RELATIONSHIPS) {
    assert.ok(r.country1.length > 0, r.id);
    assert.ok(r.country2.length > 0, r.id);
  }
});

test('every relationship currentStatus is a known value', () => {
  for (const r of BILATERAL_RELATIONSHIPS) assert.ok(STATUSES.includes(r.currentStatus), r.id);
});

test('every relationship trend is a known value', () => {
  for (const r of BILATERAL_RELATIONSHIPS) {
    assert.ok(['deteriorating', 'stable', 'improving'].includes(r.trend), r.id);
  }
});

test('every relationship has at least one keyTension', () => {
  for (const r of BILATERAL_RELATIONSHIPS) assert.ok(r.keyTensions.length >= 1, r.id);
});

test('every relationshipScore is within -100..100', () => {
  for (const r of BILATERAL_RELATIONSHIPS) {
    assert.ok(r.relationshipScore >= -100 && r.relationshipScore <= 100, r.id);
  }
});

test('every relationship recentSignalsCount is non-negative', () => {
  for (const r of BILATERAL_RELATIONSHIPS) assert.ok(r.recentSignalsCount >= 0, r.id);
});

// ── Specific named entries ───────────────────────────────────────────────────

test('russia-uk-expulsion-2023 is present', () => {
  assert.ok(DIPLOMATIC_SIGNALS.find((s) => s.id === 'russia-uk-expulsion-2023'));
});

test('china-us-hotline-2023 is present and warming', () => {
  const s = DIPLOMATIC_SIGNALS.find((x) => x.id === 'china-us-hotline-2023');
  assert.ok(s);
  assert.equal(s?.sentiment, 'warming');
  assert.equal(s?.signalType, 'hotline-established');
});

test('all 15 expected signal ids present', () => {
  const expected = [
    'russia-uk-expulsion-2023',
    'china-us-hotline-2023',
    'saudi-iran-embassy-2023',
    'sweden-nato-accession',
    'niger-usa-base-2024',
    'india-canada-expulsion-2023',
    'taiwan-diplomatic-switches-2023',
    'us-china-sanctions-2024',
    'russia-germany-recall-2022',
    'china-philippines-confrontation-2024',
    'israel-turkey-ambassador-2024',
    'us-iran-prisoner-swap-2023',
    'china-russia-joint-2023',
    'australia-china-thaw-2023',
    'venezuela-us-oil-waiver-2023',
  ];
  for (const id of expected) {
    assert.ok(DIPLOMATIC_SIGNALS.find((s) => s.id === id), `missing ${id}`);
  }
});

test('all 10 expected relationship ids present', () => {
  const expected = [
    'us-china',
    'russia-west',
    'india-pakistan',
    'saudi-iran',
    'usa-israel',
    'china-russia',
    'india-canada',
    'turkey-west',
    'china-philippines',
    'australia-china',
  ];
  for (const id of expected) {
    assert.ok(BILATERAL_RELATIONSHIPS.find((r) => r.id === id), `missing ${id}`);
  }
});

// ── getBySignalType ──────────────────────────────────────────────────────────

test('getBySignalType returns only matching type', () => {
  const expulsions = getBySignalType(DIPLOMATIC_SIGNALS, 'expulsion');
  assert.ok(expulsions.length >= 1);
  for (const s of expulsions) assert.equal(s.signalType, 'expulsion');
});

test('getBySignalType for sanctions-waiver returns 3', () => {
  assert.equal(getBySignalType(DIPLOMATIC_SIGNALS, 'sanctions-waiver').length, 3);
});

test('getBySignalType for unused type returns empty', () => {
  assert.equal(getBySignalType(DIPLOMATIC_SIGNALS, 'visa-restriction').length, 0);
});

// ── getEscalatorySignals ─────────────────────────────────────────────────────

test('getEscalatorySignals returns only escalatory', () => {
  const esc = getEscalatorySignals(DIPLOMATIC_SIGNALS);
  assert.ok(esc.length >= 1);
  for (const s of esc) assert.equal(s.sentiment, 'escalatory');
});

test('getEscalatorySignals includes russia-uk-expulsion-2023', () => {
  const esc = getEscalatorySignals(DIPLOMATIC_SIGNALS);
  assert.ok(esc.find((s) => s.id === 'russia-uk-expulsion-2023'));
});

test('getEscalatorySignals count matches manual filter', () => {
  const manual = DIPLOMATIC_SIGNALS.filter((s) => s.sentiment === 'escalatory').length;
  assert.equal(getEscalatorySignals(DIPLOMATIC_SIGNALS).length, manual);
});

// ── getWarmingSignals ────────────────────────────────────────────────────────

test('getWarmingSignals returns only warming', () => {
  const warm = getWarmingSignals(DIPLOMATIC_SIGNALS);
  assert.ok(warm.length >= 1);
  for (const s of warm) assert.equal(s.sentiment, 'warming');
});

test('getWarmingSignals includes china-us-hotline-2023', () => {
  const warm = getWarmingSignals(DIPLOMATIC_SIGNALS);
  assert.ok(warm.find((s) => s.id === 'china-us-hotline-2023'));
});

// ── getByCountry ─────────────────────────────────────────────────────────────

test('getByCountry matches initiating country', () => {
  const us = getByCountry(DIPLOMATIC_SIGNALS, 'United States');
  assert.ok(us.length >= 1);
  for (const s of us) {
    assert.ok(s.initiatingCountry === 'United States' || s.targetCountry === 'United States');
  }
});

test('getByCountry matches target country', () => {
  const russia = getByCountry(DIPLOMATIC_SIGNALS, 'Russia');
  assert.ok(russia.find((s) => s.targetCountry === 'Russia'));
});

test('getByCountry returns empty for unknown country', () => {
  assert.equal(getByCountry(DIPLOMATIC_SIGNALS, 'Atlantis').length, 0);
});

// ── getHostileRelationships ──────────────────────────────────────────────────

test('getHostileRelationships returns only hostile', () => {
  const hostile = getHostileRelationships(BILATERAL_RELATIONSHIPS);
  for (const r of hostile) assert.equal(r.currentStatus, 'hostile');
});

test('getHostileRelationships includes russia-west and india-pakistan', () => {
  const ids = getHostileRelationships(BILATERAL_RELATIONSHIPS).map((r) => r.id);
  assert.ok(ids.includes('russia-west'));
  assert.ok(ids.includes('india-pakistan'));
});

// ── getDeterioratingRelationships ────────────────────────────────────────────

test('getDeterioratingRelationships returns only deteriorating', () => {
  const det = getDeterioratingRelationships(BILATERAL_RELATIONSHIPS);
  for (const r of det) assert.equal(r.trend, 'deteriorating');
});

test('getDeterioratingRelationships includes the three expected ids', () => {
  // Per the fixture data, russia-west trend is 'stable' (hostile but not worsening);
  // the deteriorating relationships are india-canada, usa-israel, china-philippines.
  const ids = getDeterioratingRelationships(BILATERAL_RELATIONSHIPS).map((r) => r.id);
  assert.ok(ids.includes('india-canada'));
  assert.ok(ids.includes('usa-israel'));
  assert.ok(ids.includes('china-philippines'));
  assert.ok(!ids.includes('russia-west'));
});

// ── computeGlobalDiplomaticTensionIndex ──────────────────────────────────────

test('computeGlobalDiplomaticTensionIndex returns 0-100', () => {
  const idx = computeGlobalDiplomaticTensionIndex(DIPLOMATIC_SIGNALS, BILATERAL_RELATIONSHIPS);
  assert.ok(idx >= 0 && idx <= 100);
});

test('tension index is an integer', () => {
  const idx = computeGlobalDiplomaticTensionIndex(DIPLOMATIC_SIGNALS, BILATERAL_RELATIONSHIPS);
  assert.equal(Number.isInteger(idx), true);
});

test('tension index for empty inputs is 0', () => {
  assert.equal(computeGlobalDiplomaticTensionIndex([], []), 0);
});

test('all-allied stable relationships score lower than all-hostile', () => {
  const allied: BilateralRelationship[] = BILATERAL_RELATIONSHIPS.map((r) => ({
    ...r,
    currentStatus: 'allied',
    trend: 'stable',
  }));
  const hostile: BilateralRelationship[] = BILATERAL_RELATIONSHIPS.map((r) => ({
    ...r,
    currentStatus: 'hostile',
    trend: 'deteriorating',
  }));
  const lo = computeGlobalDiplomaticTensionIndex([], allied);
  const hi = computeGlobalDiplomaticTensionIndex([], hostile);
  assert.ok(hi > lo);
});

test('more escalatory signals raise the index', () => {
  const calm: DiplomaticSignal[] = DIPLOMATIC_SIGNALS.map((s) => ({
    ...s,
    sentiment: 'warming',
  }));
  const tense: DiplomaticSignal[] = DIPLOMATIC_SIGNALS.map((s) => ({
    ...s,
    sentiment: 'escalatory',
    intensity: 'critical',
  }));
  const lo = computeGlobalDiplomaticTensionIndex(calm, []);
  const hi = computeGlobalDiplomaticTensionIndex(tense, []);
  assert.ok(hi > lo);
});

test('tension index with only signals stays in range', () => {
  const idx = computeGlobalDiplomaticTensionIndex(DIPLOMATIC_SIGNALS, []);
  assert.ok(idx >= 0 && idx <= 100);
});

test('tension index with only relationships stays in range', () => {
  const idx = computeGlobalDiplomaticTensionIndex([], BILATERAL_RELATIONSHIPS);
  assert.ok(idx >= 0 && idx <= 100);
});

// ── relationshipScore extremes ───────────────────────────────────────────────

test('russia-west has the lowest relationshipScore (-85)', () => {
  const lowest = [...BILATERAL_RELATIONSHIPS].sort(
    (a, b) => a.relationshipScore - b.relationshipScore,
  )[0];
  assert.equal(lowest.id, 'russia-west');
  assert.equal(lowest.relationshipScore, -85);
});

test('china-russia has the highest positive relationshipScore (75)', () => {
  const highest = [...BILATERAL_RELATIONSHIPS].sort(
    (a, b) => b.relationshipScore - a.relationshipScore,
  )[0];
  assert.equal(highest.id, 'china-russia');
  assert.equal(highest.relationshipScore, 75);
});

// ── class helpers ────────────────────────────────────────────────────────────

test('sentimentClass returns non-empty for every sentiment', () => {
  for (const s of SENTIMENTS) assert.ok(sentimentClass(s).length > 0, s);
});

test('sentimentClass values are distinct per sentiment', () => {
  const set = new Set(SENTIMENTS.map((s) => sentimentClass(s)));
  assert.equal(set.size, SENTIMENTS.length);
});

test('intensityClass returns non-empty for every intensity', () => {
  for (const i of INTENSITIES) assert.ok(intensityClass(i).length > 0, i);
});

test('intensityClass values are distinct per intensity', () => {
  const set = new Set(INTENSITIES.map((i) => intensityClass(i)));
  assert.equal(set.size, INTENSITIES.length);
});

test('relationshipStatusClass returns non-empty for every status', () => {
  for (const s of STATUSES) assert.ok(relationshipStatusClass(s).length > 0, s);
});

test('relationshipStatusClass values are distinct per status', () => {
  const set = new Set(STATUSES.map((s) => relationshipStatusClass(s)));
  assert.equal(set.size, STATUSES.length);
});

// ── buildRenderData shape ────────────────────────────────────────────────────

test('buildRenderData returns 15 signals', () => {
  assert.equal(buildRenderData().signals.length, 15);
});

test('buildRenderData returns 10 relationships', () => {
  assert.equal(buildRenderData().relationships.length, 10);
});

test('buildRenderData globalDiplomaticTensionIndex is a number 0-100', () => {
  const idx = buildRenderData().globalDiplomaticTensionIndex;
  assert.equal(typeof idx, 'number');
  assert.ok(idx >= 0 && idx <= 100);
});

test('buildRenderData lastUpdated is set', () => {
  assert.ok(buildRenderData().lastUpdated.length > 0);
});

test('buildRenderData returns copies, not the shared arrays', () => {
  const data = buildRenderData();
  assert.notEqual(data.signals, DIPLOMATIC_SIGNALS);
  assert.notEqual(data.relationships, BILATERAL_RELATIONSHIPS);
});

test('buildRenderData is deterministic across calls', () => {
  const a = buildRenderData();
  const b = buildRenderData();
  assert.equal(a.globalDiplomaticTensionIndex, b.globalDiplomaticTensionIndex);
  assert.equal(a.signals.length, b.signals.length);
});

// ── boundary tests on empty inputs ───────────────────────────────────────────

test('getBySignalType on empty array returns empty', () => {
  assert.deepEqual(getBySignalType([], 'expulsion'), []);
});

test('getEscalatorySignals on empty array returns empty', () => {
  assert.deepEqual(getEscalatorySignals([]), []);
});

test('getWarmingSignals on empty array returns empty', () => {
  assert.deepEqual(getWarmingSignals([]), []);
});

test('getByCountry on empty array returns empty', () => {
  assert.deepEqual(getByCountry([], 'Russia'), []);
});

test('getHostileRelationships on empty array returns empty', () => {
  assert.deepEqual(getHostileRelationships([]), []);
});

test('getDeterioratingRelationships on empty array returns empty', () => {
  assert.deepEqual(getDeterioratingRelationships([]), []);
});
