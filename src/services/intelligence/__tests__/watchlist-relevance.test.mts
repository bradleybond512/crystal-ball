import assert from 'node:assert/strict';
import test from 'node:test';

import {
  scoreRelevance,
  applyFeedback,
} from '../watchlist-relevance.ts';
import type { RelevanceItem, UserContext, FeedbackState } from '../watchlist-relevance.ts';

const NOW = 1_745_000_000_000;

const HOME = { id: 'home', label: 'La Porte, IN', lat: 41.61, lon: -86.72 } as const;

function item(overrides: Partial<RelevanceItem> = {}): RelevanceItem {
  return {
    id: 'i-1',
    domain: 'weather',
    title: 'Severe thunderstorm warning',
    severityScore: 60,
    entities: [],
    ...overrides,
  };
}

const empty: FeedbackState = { domainNudges: {} };

// ── Severity baseline ───────────────────────────────────────────────────

test('baseline: severity contributes ~0.5x to score', () => {
  const r = scoreRelevance(item({ severityScore: 80 }), {}, empty);
  // Severity 80 * 0.5 = 40 baseline (no other contributions).
  assert.equal(r.score, 40);
  assert.equal(r.impact, 'moderate');
});

// ── Saved place ────────────────────────────────────────────────────────

test('place: storm centroid right at home → strong contribution', () => {
  const it = item({
    centroid: { lat: 41.61, lon: -86.72 },
    severityScore: 70,
  });
  const r = scoreRelevance(it, { savedPlaces: [HOME] }, empty);
  assert.ok(r.contributions.some((c) => /La Porte/.test(c.reason)));
  // Within radius/2 → +30; severity 70*0.5 = 35; total 65.
  assert.ok(r.score >= 60);
  assert.ok(['high', 'direct'].includes(r.impact));
});

test('place: storm centroid 80 km away (within radius) → moderate contribution', () => {
  const it = item({
    centroid: { lat: 42.3, lon: -86.72 }, // ~77 km north
    severityScore: 60,
  });
  const r = scoreRelevance(it, { savedPlaces: [HOME] }, empty);
  const place = r.contributions.find((c) => /La Porte/.test(c.reason));
  assert.ok(place);
  assert.equal(place!.weight, 18);
});

test('place: storm centroid >200 km away (outside 2x radius) → no contribution', () => {
  const it = item({
    centroid: { lat: 0, lon: 0 }, // far away
  });
  const r = scoreRelevance(it, { savedPlaces: [HOME] }, empty);
  assert.ok(!r.contributions.some((c) => /La Porte/.test(c.reason)));
});

test('place: explicit per-place radius is honored', () => {
  const farPlace = { id: 'far', label: 'Far Place', lat: 0, lon: 0, radiusKm: 200 };
  const it = item({ centroid: { lat: 0.5, lon: 0.5 } }); // ~78 km away
  const r = scoreRelevance(it, { savedPlaces: [farPlace] }, empty);
  // 78 km is within 200 km radius/2 = 100 km → strong (+30).
  assert.ok(r.contributions.some((c) => c.weight === 30));
});

// ── Watched countries ───────────────────────────────────────────────────

test('country: watched country adds +20', () => {
  const r = scoreRelevance(
    item({ entities: ['UA'] }),
    { watchedCountries: ['UA', 'PL'] },
    empty,
  );
  const country = r.contributions.find((c) => /Watched/.test(c.reason));
  assert.ok(country);
  assert.equal(country!.weight, 20);
});

test('country: unwatched countries do not contribute', () => {
  const r = scoreRelevance(item({ entities: ['BR'] }), { watchedCountries: ['UA'] }, empty);
  assert.ok(!r.contributions.some((c) => /Watched/.test(c.reason)));
});

// ── Portfolio ──────────────────────────────────────────────────────────

test('portfolio: ticker match adds weight*3', () => {
  const r = scoreRelevance(
    item({ entities: ['AAPL'] }),
    { portfolio: [{ id: 'AAPL', weight: 7 }] },
    empty,
  );
  const port = r.contributions.find((c) => /Portfolio/.test(c.reason));
  assert.ok(port);
  assert.equal(port!.weight, 21);
});

test('portfolio: default weight is 5 → +15', () => {
  const r = scoreRelevance(
    item({ entities: ['AAPL'] }),
    { portfolio: [{ id: 'AAPL' }] },
    empty,
  );
  const port = r.contributions.find((c) => /Portfolio/.test(c.reason));
  assert.equal(port!.weight, 15);
});

// ── Travel plans ───────────────────────────────────────────────────────

test('travel: plan overlap with item → +25', () => {
  const r = scoreRelevance(
    item({
      entities: ['JP'],
      activeFrom: NOW,
      activeUntil: NOW + 7 * 24 * 60 * 60 * 1000,
    }),
    {
      travelPlans: [{
        destinations: ['JP'],
        startMs: NOW + 3 * 24 * 60 * 60 * 1000,
        endMs: NOW + 14 * 24 * 60 * 60 * 1000,
      }],
    },
    empty,
  );
  const travel = r.contributions.find((c) => /Travel/.test(c.reason));
  assert.ok(travel);
  assert.equal(travel!.weight, 25);
});

test('travel: time-window mismatch → no contribution', () => {
  const r = scoreRelevance(
    item({
      entities: ['JP'],
      activeFrom: NOW,
      activeUntil: NOW + 7 * 24 * 60 * 60 * 1000,
    }),
    {
      travelPlans: [{
        destinations: ['JP'],
        startMs: NOW + 30 * 24 * 60 * 60 * 1000, // a month later
        endMs: NOW + 60 * 24 * 60 * 60 * 1000,
      }],
    },
    empty,
  );
  assert.ok(!r.contributions.some((c) => /Travel/.test(c.reason)));
});

// ── Preferred / muted domains ──────────────────────────────────────────

test('preferred: matching domain adds +8', () => {
  const r = scoreRelevance(
    item({ domain: 'weather' }),
    { preferredDomains: ['weather'] },
    empty,
  );
  const pref = r.contributions.find((c) => /Preferred/.test(c.reason));
  assert.ok(pref);
  assert.equal(pref!.weight, 8);
});

test('muted: domain produces -40 contribution and shouldNotify=false', () => {
  const r = scoreRelevance(
    item({ severityScore: 95 }),
    { mutedDomains: ['weather'] },
    empty,
  );
  const mute = r.contributions.find((c) => /muted/.test(c.reason));
  assert.ok(mute);
  assert.equal(mute!.weight, -40);
  assert.equal(r.shouldNotify, false);
});

// ── Personal impact labels ─────────────────────────────────────────────

test('impact: 80+ → direct, 60+ → high, 40+ → moderate', () => {
  // direct
  const a = scoreRelevance(
    item({ severityScore: 80, centroid: HOME, entities: ['US-IN'] }),
    { savedPlaces: [HOME], watchedCountries: ['US-IN'] },
    empty,
  );
  // 80*0.5 = 40 + 30 (place) + 20 (country) = 90 → direct
  assert.equal(a.impact, 'direct');

  const b = scoreRelevance(item({ severityScore: 50 }), {}, empty);
  // 50*0.5 = 25 → low
  assert.equal(b.impact, 'low');
});

// ── Notification threshold ─────────────────────────────────────────────

test('notify: default threshold 60, well-exposed item triggers shouldNotify', () => {
  const it = item({
    severityScore: 70,
    entities: ['US-IN'],
    centroid: HOME,
  });
  const r = scoreRelevance(
    it,
    { savedPlaces: [HOME], watchedCountries: ['US-IN'] },
    empty,
  );
  assert.equal(r.shouldNotify, true);
});

test('notify: low-relevance item does NOT trigger shouldNotify', () => {
  const r = scoreRelevance(item({ severityScore: 40 }), {}, empty);
  assert.equal(r.shouldNotify, false);
});

// ── Feedback loop ──────────────────────────────────────────────────────

test('feedback: helpful nudge lowers threshold for that domain', () => {
  let state: FeedbackState = { domainNudges: {} };
  for (let i = 0; i < 5; i += 1) state = applyFeedback(state, 'weather', 'helpful');
  // +25 nudge → threshold drops from 60 to 35.
  const it = item({ severityScore: 70 });
  const r = scoreRelevance(it, {}, state);
  // Score = 35 (severity*0.5). Threshold = 35. Should notify.
  assert.equal(r.shouldNotify, true);
});

test('feedback: dismissed nudge raises threshold', () => {
  let state: FeedbackState = { domainNudges: {} };
  for (let i = 0; i < 5; i += 1) state = applyFeedback(state, 'weather', 'dismissed');
  // -15 nudge → threshold rises from 60 to 75.
  const it = item({
    severityScore: 70,
    entities: ['US-IN'],
    centroid: HOME,
  });
  const r = scoreRelevance(
    it,
    { savedPlaces: [HOME], watchedCountries: ['US-IN'] },
    state,
  );
  // Without nudge, score 35+30+20=85 ≥ 60 → notify. With nudge, threshold = 75
  // and still 85 ≥ 75 so it should still notify but the bar is higher.
  assert.equal(r.shouldNotify, true);
  assert.ok(r.score >= 75);
});

test('feedback: muted signal pins threshold to maximum effective for that domain', () => {
  let state: FeedbackState = { domainNudges: {} };
  state = applyFeedback(state, 'weather', 'muted');
  assert.equal(state.domainNudges.weather, -30);
});

test('feedback: nudges clamped to ±30', () => {
  let state: FeedbackState = { domainNudges: {} };
  for (let i = 0; i < 100; i += 1) state = applyFeedback(state, 'weather', 'helpful');
  assert.equal(state.domainNudges.weather, 30);
  for (let i = 0; i < 100; i += 1) state = applyFeedback(state, 'weather', 'dismissed');
  assert.equal(state.domainNudges.weather, -30);
});

// ── Should I care? ─────────────────────────────────────────────────────

test('shouldICare: low-exposure produces "keep monitoring"', () => {
  const r = scoreRelevance(item({ severityScore: 30 }), {}, empty);
  assert.match(r.shouldICare, /keep monitoring/i);
});

test('shouldICare: high-exposure cites top reasons', () => {
  const it = item({
    severityScore: 70,
    entities: ['US-IN'],
    centroid: HOME,
  });
  const r = scoreRelevance(
    it,
    { savedPlaces: [HOME], watchedCountries: ['US-IN'] },
    empty,
  );
  assert.match(r.shouldICare, /Yes/);
  assert.match(r.shouldICare, /La Porte/);
});

// ── Determinism ────────────────────────────────────────────────────────

test('determinism: same inputs → same output', () => {
  const it = item({ entities: ['US-IN'], severityScore: 70 });
  const ctx: UserContext = { watchedCountries: ['US-IN'], savedPlaces: [HOME] };
  const a = scoreRelevance(it, ctx, empty);
  const b = scoreRelevance(it, ctx, empty);
  assert.deepEqual(a, b);
});

// ── Plan invariant: Should I Care answer is always present ─────────────

test('invariant: every result has shouldICare line', () => {
  const cases = [
    scoreRelevance(item(), {}, empty),
    scoreRelevance(item({ severityScore: 95 }), {}, empty),
    scoreRelevance(item({ severityScore: 0 }), {}, empty),
    scoreRelevance(item({ severityScore: 80, centroid: HOME }), { savedPlaces: [HOME] }, empty),
  ];
  for (const r of cases) {
    assert.ok(typeof r.shouldICare === 'string' && r.shouldICare.length > 0);
  }
});
