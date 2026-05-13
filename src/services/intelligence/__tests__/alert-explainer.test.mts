import assert from 'node:assert/strict';
import test from 'node:test';
import { explainAlert, SAVED_PLACE_NEAR_KM, type ExplainContext } from '../alert-explainer.ts';
import type { UnifiedAlert, AlertSource } from '@/services/unified-alerts';
import type { SavedPlace } from '@/services/saved-places';
import type { Situation } from '@/types/intelligence';

// ── Fixtures ─────────────────────────────────────────────────────────────

function mkAlert(overrides: Partial<UnifiedAlert> = {}): UnifiedAlert {
  return {
    id: 'a-1',
    source: 'earthquake' as AlertSource,
    severity: 'high',
    title: 'M6.5 earthquake near Tokyo',
    body: 'Seismic event recorded at 14:32 UTC.',
    timestamp: 1_715_000_000_000,
    location: { lat: 35.68, lon: 139.69, label: 'Tokyo' },
    relevanceScore: 80,
    acknowledged: false,
    pinned: false,
    ...overrides,
  };
}

function place(lat: number, lon: number, name = 'Home'): SavedPlace {
  return {
    id: `place-${name}`,
    name,
    lat,
    lon,
    radiusKm: 50,
    tags: ['home'],
    priority: 10,
    notes: '',
    offlinePinned: false,
    primary: true,
    source: 'manual',
    sortIndex: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

function ctx(overrides: Partial<ExplainContext> = {}): ExplainContext {
  return {
    situations: [],
    events: [],
    savedPlaces: [],
    ...overrides,
  };
}

// ── 1. Domain templates (8 tests) ────────────────────────────────────────

test('earthquake template references seismic / aftershock follow-on signals', () => {
  const exp = explainAlert(mkAlert(), ctx());
  assert.ok(exp.whatToWatch.some((s) => /tsunami/i.test(s)));
  assert.ok(exp.whatToWatch.some((s) => /aftershock/i.test(s)));
  assert.equal(exp.whatToWatch.length, 3);
});

test('weather (nws) template references storm strengthening + power outage', () => {
  const exp = explainAlert(mkAlert({ source: 'nws', title: 'Tornado Warning' }), ctx());
  assert.ok(exp.whatToWatch.some((s) => /strengthening|weakening/i.test(s)));
  assert.ok(exp.whatToWatch.some((s) => /power outage|utility/i.test(s)));
});

test('aviation (oref) template references transponder + ATC + diversion', () => {
  const exp = explainAlert(mkAlert({ source: 'oref', title: 'Aviation anomaly' }), ctx());
  assert.ok(exp.whatToWatch.some((s) => /transponder/i.test(s)));
  assert.ok(exp.whatToWatch.some((s) => /ATC/i.test(s)));
});

test('maritime template references AIS gap + port state + sanctions', () => {
  const exp = explainAlert(mkAlert({ source: 'maritime', title: 'AIS gap on tanker' }), ctx());
  assert.ok(exp.whatToWatch.some((s) => /AIS gap/i.test(s)));
  assert.ok(exp.whatToWatch.some((s) => /port state/i.test(s)));
  assert.ok(exp.whatToWatch.some((s) => /sanctions/i.test(s)));
});

test('wildfire (fire) template references containment + wind + evacuation', () => {
  const exp = explainAlert(mkAlert({ source: 'fire', title: 'NIFC perimeter expansion' }), ctx());
  assert.ok(exp.whatToWatch.some((s) => /containment/i.test(s)));
  assert.ok(exp.whatToWatch.some((s) => /wind/i.test(s)));
  assert.ok(exp.whatToWatch.some((s) => /evacuation/i.test(s)));
});

test('space-weather template references G-scale + HF radio + auroral oval', () => {
  const exp = explainAlert(mkAlert({ source: 'space-weather', title: 'G4 storm' }), ctx());
  assert.ok(exp.whatToWatch.some((s) => /G-scale|escalation/i.test(s)));
  assert.ok(exp.whatToWatch.some((s) => /HF radio/i.test(s)));
});

test('cyber template references KEV + honeypot + ISAC', () => {
  const exp = explainAlert(mkAlert({ source: 'cyber', title: 'New CVE' }), ctx());
  assert.ok(exp.whatToWatch.some((s) => /KEV/i.test(s)));
  assert.ok(exp.whatToWatch.some((s) => /honeypot/i.test(s)));
});

test('breaking-news (unknown) falls back to generic follow-on signals', () => {
  const exp = explainAlert(mkAlert({ source: 'breaking-news', title: 'Headline' }), ctx());
  assert.ok(exp.whatToWatch.some((s) => /follow-up reporting/i.test(s)));
  assert.equal(exp.whatToWatch.length, 2);
});

// ── 2. Confidence scoring (5 tests) ──────────────────────────────────────

test('high severity + corroboration + trusted source → high confidence', () => {
  const alert = mkAlert({ severity: 'high', source: 'earthquake' });
  const corroborating = mkAlert({ id: 'a-2', source: 'tsunami' });
  // Put both alerts in the same Situation so relatedAlerts picks one up.
  const situation: Situation = {
    id: 's-1', name: 'Compound', status: 'active', severity: 'high',
    domain: 'earthquake', startedAt: 0, updatedAt: 0,
    observationIds: ['a-1', 'a-2'], correlationIds: [],
    summary: '', tags: [], confidence: 0.9,
  };
  const exp = explainAlert(alert, ctx({ situations: [situation], events: [alert, corroborating] }));
  assert.equal(exp.confidence, 'high');
  assert.match(exp.confidenceReason, /corroborating/i);
});

test('high severity without corroboration → medium confidence', () => {
  const exp = explainAlert(mkAlert({ severity: 'high' }), ctx());
  assert.equal(exp.confidence, 'medium');
  assert.match(exp.confidenceReason, /single-source|no corroborating/i);
});

test('medium severity → medium confidence', () => {
  const exp = explainAlert(mkAlert({ severity: 'medium' }), ctx());
  assert.equal(exp.confidence, 'medium');
});

test('low severity → low confidence + informational reason', () => {
  const exp = explainAlert(mkAlert({ severity: 'low' }), ctx());
  assert.equal(exp.confidence, 'low');
  assert.match(exp.confidenceReason, /informational|treat as/i);
});

test('correlation source never reaches high confidence on its own', () => {
  const exp = explainAlert(mkAlert({ severity: 'high', source: 'correlation' }), ctx());
  assert.notEqual(exp.confidence, 'high');
});

// ── 3. Saved-place proximity (4 tests) ───────────────────────────────────

test('alert within 500km of a saved place reports "Xkm from <name>"', () => {
  const exp = explainAlert(mkAlert(), ctx({ savedPlaces: [place(35.68, 139.69, 'Apartment')] }));
  assert.match(exp.whyItMatters, /from "Apartment"/);
});

test('alert > 500km from saved place falls through to severity / interest', () => {
  // Tokyo earthquake, saved place in Iceland.
  const exp = explainAlert(mkAlert({ severity: 'high' }), ctx({ savedPlaces: [place(64.13, -21.94, 'Reykjavik')] }));
  assert.doesNotMatch(exp.whyItMatters, /from "Reykjavik"/);
});

test('saved-place radius constant exposed for downstream callers', () => {
  assert.equal(SAVED_PLACE_NEAR_KM, 500);
});

test('alert with no location can never match a saved place', () => {
  const exp = explainAlert(mkAlert({ location: undefined, severity: 'medium' }), ctx({ savedPlaces: [place(0, 0)] }));
  assert.doesNotMatch(exp.whyItMatters, /saved-place/);
});

// ── 4. Why-it-matters precedence (3 tests) ───────────────────────────────

test('watchlist hit fires even without saved-place match', () => {
  const exp = explainAlert(
    mkAlert({ severity: 'medium', body: 'Storm impacts the AAPL Cupertino HQ.' }),
    ctx({ savedPlaces: [], watchlist: ['AAPL'] }),
  );
  assert.match(exp.whyItMatters, /AAPL/);
});

test('interest-domain match fires when no saved-place / watchlist match', () => {
  const exp = explainAlert(
    mkAlert({ severity: 'medium', source: 'cyber', title: 'Unrelated', body: 'something' }),
    ctx({ savedPlaces: [], watchlist: [], interestDomains: ['cyber'] }),
  );
  assert.match(exp.whyItMatters, /cyber.*interest/i);
});

test('background context wording when no matches and severity is low', () => {
  const exp = explainAlert(mkAlert({ severity: 'low' }), ctx());
  assert.match(exp.whyItMatters, /background|no direct match/i);
});

// ── 5. Related alerts (2 tests) ──────────────────────────────────────────

test('correlationMembers explicit ids populate relatedAlerts', () => {
  const member = mkAlert({ id: 'm-1', title: 'Tsunami advisory' });
  const exp = explainAlert(
    mkAlert({ correlationMembers: ['m-1'] }),
    ctx({ events: [member] }),
  );
  assert.deepEqual(exp.relatedAlerts, ['m-1']);
});

test('situation co-membership populates relatedAlerts', () => {
  const other = mkAlert({ id: 'a-2', title: 'Aftershock' });
  const situation: Situation = {
    id: 's-1', name: 'EQ', status: 'active', severity: 'high',
    domain: 'earthquake', startedAt: 0, updatedAt: 0,
    observationIds: ['a-1', 'a-2'], correlationIds: [],
    summary: '', tags: [], confidence: 0.9,
  };
  const exp = explainAlert(
    mkAlert(),
    ctx({ situations: [situation], events: [other] }),
  );
  assert.ok(exp.relatedAlerts.includes('a-2'));
});

// ── 6. Shape + headline (3 tests) ────────────────────────────────────────

test('headline mirrors alert.title verbatim', () => {
  const exp = explainAlert(mkAlert({ title: 'Specific Title' }), ctx());
  assert.equal(exp.headline, 'Specific Title');
});

test('sources entry includes domain + timestamp for downstream attribution', () => {
  const exp = explainAlert(mkAlert({ timestamp: 12345 }), ctx());
  assert.equal(exp.sources[0]?.timestamp, 12345);
  assert.equal(exp.sources[0]?.domain, 'earthquake');
});

test('whatHappened includes coordinates when location has no label', () => {
  const exp = explainAlert(
    mkAlert({ location: { lat: 41.6, lon: -86.7 } }),
    ctx(),
  );
  assert.match(exp.whatHappened, /41\.60.*-86\.70/);
});
