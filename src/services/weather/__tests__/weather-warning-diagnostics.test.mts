import assert from 'node:assert/strict';
import test from 'node:test';

import { diagnoseAlert } from '../weather-warning-diagnostics.ts';
import type { DiagnosticTrace } from '../weather-warning-diagnostics.ts';
import type { PolygonMatchResult } from '../weather-threat-types.ts';

const NOW = 1_745_000_000_000;

function match(overrides: Partial<PolygonMatchResult> = {}): PolygonMatchResult {
  return {
    alertId: 'urn:test',
    placeId: 'home',
    matchKind: 'inside_polygon',
    isInside: true,
    distanceKm: 0,
    hazardKind: 'severe_thunderstorm',
    event: 'Severe Thunderstorm Warning',
    severity: 'severe',
    threatLevel: 'warning',
    msUntilExpires: 30 * 60 * 1000,
    isUpdate: false,
    isCancellation: false,
    reason: 'Inside warning polygon',
    ...overrides,
  };
}

function trace(overrides: Partial<DiagnosticTrace> = {}): DiagnosticTrace {
  return {
    alertId: 'urn:test',
    alertReceived: true,
    alertReceivedAt: NOW,
    sidecarStored: true,
    normalized: true,
    polygonMatch: match(),
    placesEvaluated: [{ id: 'home', label: 'Home', lat: 41.6, lon: -86.7 }],
    routerDispatched: true,
    routerReason: 'Notification dispatched',
    quietHoursActive: false,
    quietHoursBypassEnabled: false,
    locationMissing: false,
    relevanceBelowThreshold: false,
    ...overrides,
  };
}

// ── Verdict: delivered ─────────────────────────────────────────────────

test('verdict: full happy path → delivered', () => {
  const d = diagnoseAlert(trace());
  assert.equal(d.verdict, 'delivered');
  assert.match(d.headline, /delivered/i);
});

test('verdict: stages all "ok" on happy path', () => {
  const d = diagnoseAlert(trace());
  for (const s of d.stages) {
    assert.notEqual(s.outcome, 'failed', `stage ${s.id} failed`);
  }
});

// ── Verdict: undelivered_pipeline ──────────────────────────────────────

test('verdict: NWS alert never received → undelivered_pipeline', () => {
  const d = diagnoseAlert(trace({ alertReceived: false }));
  assert.equal(d.verdict, 'undelivered_pipeline');
  assert.match(d.remediation.join(' '), /NWS API/i);
});

test('verdict: sidecar failed to store → undelivered_pipeline', () => {
  const d = diagnoseAlert(trace({ sidecarStored: false }));
  assert.equal(d.verdict, 'undelivered_pipeline');
});

test('verdict: normalization failed → undelivered_pipeline', () => {
  const d = diagnoseAlert(trace({
    normalized: false,
    normalizationError: 'Missing required field "expires"',
  }));
  assert.equal(d.verdict, 'undelivered_pipeline');
  const norm = d.stages.find((s) => s.id === 'normalized');
  assert.match(norm!.reason, /Missing required field/);
});

test('verdict: no saved places → undelivered_pipeline', () => {
  const d = diagnoseAlert(trace({ placesEvaluated: [] }));
  assert.equal(d.verdict, 'undelivered_pipeline');
  assert.match(d.remediation.join(' '), /Add a saved place/);
});

// ── Verdict: undelivered_no_match ──────────────────────────────────────

test('verdict: polygon no_match → undelivered_no_match', () => {
  const d = diagnoseAlert(trace({
    polygonMatch: match({
      matchKind: 'no_match',
      isInside: false,
      distanceKm: 250,
      reason: '250.0 km outside polygon',
    }),
  }));
  assert.equal(d.verdict, 'undelivered_no_match');
  assert.match(d.headline, /did not match/);
});

test('remediation: distance offered when no_match has a distance', () => {
  const d = diagnoseAlert(trace({
    polygonMatch: match({
      matchKind: 'no_match',
      isInside: false,
      distanceKm: 80,
      reason: '80.0 km outside polygon',
    }),
  }));
  assert.match(d.remediation.join(' '), /80 km/);
  assert.match(d.remediation.join(' '), /buffer radius/);
});

test('remediation: missing UGC fallback flagged when no polygon + no zone', () => {
  const d = diagnoseAlert(trace({
    polygonMatch: match({
      matchKind: 'no_match',
      isInside: false,
      distanceKm: undefined,
      reason: 'Alert has no polygon and no UGC zone overlap',
    }),
  }));
  assert.match(d.remediation.join(' '), /UGC zones/i);
});

// ── Verdict: suppressed ────────────────────────────────────────────────

test('verdict: quiet hours blocked → suppressed', () => {
  const d = diagnoseAlert(trace({
    routerDispatched: false,
    routerReason: 'Quiet hours active',
    quietHoursActive: true,
    quietHoursBypassEnabled: false,
  }));
  assert.equal(d.verdict, 'suppressed');
  assert.match(d.remediation.join(' '), /Bypass quiet hours/i);
});

test('verdict: relevance threshold filtered → suppressed', () => {
  const d = diagnoseAlert(trace({
    routerDispatched: false,
    routerReason: 'Below relevance threshold',
    relevanceBelowThreshold: true,
    relevanceScore: 25,
  }));
  assert.equal(d.verdict, 'suppressed');
  const relev = d.stages.find((s) => s.id === 'relevance');
  assert.match(relev!.reason, /25/);
});

test('verdict: router suppressed without quiet/relevance → suppressed', () => {
  const d = diagnoseAlert(trace({
    routerDispatched: false,
    routerReason: 'Custom rule X blocked dispatch',
  }));
  assert.equal(d.verdict, 'suppressed');
  // Remediation surfaces the router's reason since quiet/relevance are fine.
  assert.match(d.remediation.join(' '), /Custom rule X/);
});

test('quiet hours: bypass enabled means quiet hours are NOT a failure even when active', () => {
  const d = diagnoseAlert(trace({
    quietHoursActive: true,
    quietHoursBypassEnabled: true,
  }));
  const quiet = d.stages.find((s) => s.id === 'quiet-hours');
  assert.equal(quiet!.outcome, 'ok');
});

// ── Plan worked example ────────────────────────────────────────────────

test('integration: plan example "quiet hours suppressed inside-polygon warning"', () => {
  // Plan section 12 example:
  //   - NWS alert: received
  //   - polygon match: inside Home polygon
  //   - normalized severity: critical
  //   - notification route: suppressed
  //   - reason: quiet hours active and weather bypass disabled
  const d = diagnoseAlert(trace({
    polygonMatch: match({
      matchKind: 'inside_polygon',
      isInside: true,
      distanceKm: 0,
      severity: 'extreme',
      threatLevel: 'emergency',
      reason: 'Inside warning polygon',
    }),
    routerDispatched: false,
    routerReason: 'Quiet hours active and weather bypass disabled',
    quietHoursActive: true,
    quietHoursBypassEnabled: false,
  }));
  assert.equal(d.verdict, 'suppressed');
  const quiet = d.stages.find((s) => s.id === 'quiet-hours');
  assert.equal(quiet!.outcome, 'failed');
  assert.match(quiet!.reason, /bypass is disabled/i);
  assert.match(d.remediation.join(' '), /Bypass quiet hours for severe weather/i);
});

// ── Edge cases ─────────────────────────────────────────────────────────

test('unknown stages: untraced fields produce "unknown" outcome but verdict still computes', () => {
  const minimal: DiagnosticTrace = {
    alertId: 'urn:bare',
    alertReceived: true,
  };
  const d = diagnoseAlert(minimal);
  // No specific failure → verdict is unknown; still emits headline + stages.
  assert.ok(d.headline.length > 0);
  assert.equal(d.stages.length, 7);
});

test('locationMissing: surfaces "no saved place location" reason', () => {
  const d = diagnoseAlert(trace({ locationMissing: true, placesEvaluated: undefined }));
  const polygon = d.stages.find((s) => s.id === 'polygon-match');
  assert.match(polygon!.reason, /No saved place location/i);
});

// ── Determinism ────────────────────────────────────────────────────────

test('determinism: same trace → same diagnostic', () => {
  const t = trace({
    routerDispatched: false,
    quietHoursActive: true,
  });
  const a = diagnoseAlert(t);
  const b = diagnoseAlert(t);
  assert.deepEqual(a, b);
});

// ── Remediation completeness ───────────────────────────────────────────

test('remediation: delivered case still emits a positive line', () => {
  const d = diagnoseAlert(trace());
  assert.ok(d.remediation.length > 0);
  assert.match(d.remediation.join(' '), /no remediation needed|operated as designed/i);
});
