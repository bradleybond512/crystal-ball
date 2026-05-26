/**
 * ClimateSuperpowerPanel — pure-helper unit tests.
 *
 * No DOM, no fetch: each test calls a helper with fixture
 * ObservationEvent records and asserts the returned view-model.
 * The renderer is exercised through renderClimateSuperpowerHtml().
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  obsSeverityScore,
  severityToBadgeClass,
  classifyExtremeEvent,
  buildExtremeEvents,
  buildSeaIceMonitor,
  buildMigrationRisk,
  buildTippingPoints,
  buildClimateSecurityIndex,
  renderClimateSuperpowerHtml,
  type ClimatePanelState,
} from '../../src/components/climate-superpower-helpers.ts';
import type {
  ObservationEvent,
  ObservationSeverity,
} from '../../src/types/intelligence.ts';

const NOW = 1_748_000_000_000;
const H = 3_600_000;
const D = 24 * H;

function makeEvent(o: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: o.id ?? 'ev-1',
    sourceId: o.sourceId ?? 'climate-feed',
    domain: o.domain ?? 'climate',
    timestamp: o.timestamp ?? NOW,
    severity: o.severity ?? 'MEDIUM',
    title: o.title ?? 'test event',
    raw: o.raw ?? {},
    entityIds: o.entityIds ?? [],
    tags: o.tags ?? [],
    location: o.location,
  };
}

// ── severity helpers ───────────────────────────────────────────────

describe('severity helpers', () => {
  it('obsSeverityScore is monotonic', () => {
    const order: ObservationSeverity[] = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    const scores = order.map(obsSeverityScore);
    for (let i = 1; i < scores.length; i++) {
      assert.ok(scores[i] > scores[i - 1], `${order[i]} > ${order[i - 1]}`);
    }
  });
  it('severityToBadgeClass returns sev-N class', () => {
    assert.equal(severityToBadgeClass('CRITICAL'), 'sev-4');
    assert.equal(severityToBadgeClass('HIGH'), 'sev-3');
    assert.equal(severityToBadgeClass('MEDIUM'), 'sev-2');
    assert.equal(severityToBadgeClass('LOW'), 'sev-1');
    assert.equal(severityToBadgeClass('INFO'), 'sev-0');
  });
});

// ── classifyExtremeEvent ───────────────────────────────────────────

describe('classifyExtremeEvent', () => {
  it('matches wildfire tag', () => {
    assert.equal(classifyExtremeEvent(makeEvent({ tags: ['wildfire'] })), 'wildfire');
  });
  it('matches flash-flood tag as flood', () => {
    assert.equal(classifyExtremeEvent(makeEvent({ tags: ['flash-flood'] })), 'flood');
  });
  it('matches heatwave variant tag', () => {
    assert.equal(classifyExtremeEvent(makeEvent({ tags: ['heat-wave'] })), 'heatwave');
  });
  it('falls back to title keyword', () => {
    assert.equal(classifyExtremeEvent(makeEvent({ tags: [], title: 'Severe drought reported' })), 'drought');
  });
  it('returns other when nothing matches', () => {
    assert.equal(classifyExtremeEvent(makeEvent({ tags: ['random'], title: 'noise' })), 'other');
  });
});

// ── buildExtremeEvents ─────────────────────────────────────────────

describe('buildExtremeEvents', () => {
  it('keeps only classifiable kinds', () => {
    const out = buildExtremeEvents([
      makeEvent({ id: 'a', tags: ['wildfire'], severity: 'HIGH' }),
      makeEvent({ id: 'b', tags: ['random'], severity: 'HIGH' }),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 'a');
    assert.equal(out[0].kind, 'wildfire');
  });

  it('sorts by severity then timestamp', () => {
    const out = buildExtremeEvents([
      makeEvent({ id: 'low', tags: ['flood'], severity: 'LOW', timestamp: NOW }),
      makeEvent({ id: 'crit', tags: ['flood'], severity: 'CRITICAL', timestamp: NOW - H }),
      makeEvent({ id: 'newer', tags: ['flood'], severity: 'CRITICAL', timestamp: NOW }),
    ]);
    assert.deepEqual(out.map((e) => e.id), ['newer', 'crit', 'low']);
  });

  it('extracts areaAffectedKm2 from raw', () => {
    const out = buildExtremeEvents([
      makeEvent({ tags: ['wildfire'], raw: { areaAffectedKm2: 2500 } }),
    ]);
    assert.equal(out[0].areaAffectedKm2, 2500);
  });

  it('derives durationDays from startedAt in raw', () => {
    const out = buildExtremeEvents(
      [makeEvent({ tags: ['drought'], raw: { startedAt: NOW - 7 * D } })],
      { now: NOW },
    );
    assert.equal(out[0].durationDays, 7);
  });

  it('uses metadata.region when present', () => {
    const out = buildExtremeEvents([
      makeEvent({ tags: ['wildfire'], raw: { region: 'California' } }),
    ]);
    assert.equal(out[0].region, 'California');
  });

  it('derives region from lat/lon', () => {
    const out = buildExtremeEvents([
      makeEvent({ tags: ['wildfire'], location: { lat: 45, lon: 10 } }),
    ]);
    assert.equal(out[0].region, 'Europe');
  });

  it('respects limit parameter', () => {
    const events = Array.from({ length: 12 }, (_, i) =>
      makeEvent({ id: `e${i}`, tags: ['flood'], severity: 'MEDIUM' }),
    );
    assert.equal(buildExtremeEvents(events, { limit: 5 }).length, 5);
  });
});

// ── buildSeaIceMonitor ─────────────────────────────────────────────

describe('buildSeaIceMonitor', () => {
  it('classifies sea-level readings', () => {
    const out = buildSeaIceMonitor([
      makeEvent({ tags: ['sea-level'], raw: { deviationCm: 3.5 } }),
    ]);
    assert.equal(out[0].kind, 'sea-level');
    assert.equal(out[0].unit, 'cm');
    assert.equal(out[0].deviation, 3.5);
  });

  it('classifies arctic-ice anomaly with million_km2 unit', () => {
    const out = buildSeaIceMonitor([
      makeEvent({ tags: ['arctic-ice'], raw: { anomalyMillionKm2: -1.2 } }),
    ]);
    assert.equal(out[0].kind, 'arctic-ice');
    assert.equal(out[0].unit, 'million_km2');
    assert.equal(out[0].deviation, -1.2);
  });

  it('infers trend from sign and magnitude', () => {
    const out = buildSeaIceMonitor([
      makeEvent({ id: 'r', tags: ['sea-level'], raw: { deviationCm: 5 } }),
      makeEvent({ id: 'f', tags: ['arctic-ice'], raw: { anomalyMillionKm2: -2 } }),
      makeEvent({ id: 's', tags: ['sea-level'], raw: { deviationCm: 0 } }),
    ]);
    const byId = new Map(out.map((x) => [x.id, x.trend]));
    assert.equal(byId.get('r'), 'rising');
    assert.equal(byId.get('f'), 'falling');
    assert.equal(byId.get('s'), 'steady');
  });

  it('ignores unrelated events', () => {
    const out = buildSeaIceMonitor([makeEvent({ tags: ['wildfire'] })]);
    assert.equal(out.length, 0);
  });

  it('sorts by absolute deviation', () => {
    const out = buildSeaIceMonitor([
      makeEvent({ id: 'small', tags: ['sea-level'], raw: { deviationCm: 1 } }),
      makeEvent({ id: 'big', tags: ['sea-level'], raw: { deviationCm: 10 } }),
      makeEvent({ id: 'neg', tags: ['sea-level'], raw: { deviationCm: -8 } }),
    ]);
    assert.deepEqual(out.map((r) => r.id), ['big', 'neg', 'small']);
  });
});

// ── buildMigrationRisk ─────────────────────────────────────────────

describe('buildMigrationRisk', () => {
  it('groups events by region and sums severity', () => {
    const out = buildMigrationRisk([
      makeEvent({ tags: ['drought'], severity: 'HIGH', raw: { region: 'Sahel' } }),
      makeEvent({ tags: ['drought'], severity: 'CRITICAL', raw: { region: 'Sahel', displacedEstimate: 50000 } }),
      makeEvent({ tags: ['flood'], severity: 'MEDIUM', raw: { region: 'Bangladesh', displacedEstimate: 12000 } }),
    ]);
    assert.equal(out.length, 2);
    assert.equal(out[0].region, 'Sahel');
    assert.equal(out[0].displacedEstimate, 50_000);
  });

  it('reports primary driver when one dominates', () => {
    const out = buildMigrationRisk([
      makeEvent({ tags: ['drought'], severity: 'CRITICAL', raw: { region: 'Sahel' } }),
    ]);
    assert.equal(out[0].primaryDriver, 'drought');
  });

  it('reports mixed when 3+ drivers contribute', () => {
    const out = buildMigrationRisk([
      makeEvent({ tags: ['drought'], severity: 'HIGH', raw: { region: 'X' } }),
      makeEvent({ tags: ['flood'], severity: 'HIGH', raw: { region: 'X' } }),
      makeEvent({ tags: ['heatwave'], severity: 'HIGH', raw: { region: 'X' } }),
    ]);
    assert.equal(out[0].primaryDriver, 'mixed');
  });

  it('clamps riskScore to 0–100', () => {
    const many = Array.from({ length: 20 }, () =>
      makeEvent({ tags: ['flood'], severity: 'CRITICAL', raw: { region: 'X' } }),
    );
    const out = buildMigrationRisk(many);
    assert.ok(out[0].riskScore <= 100);
    assert.ok(out[0].riskScore >= 0);
  });

  it('ignores events without a region', () => {
    const out = buildMigrationRisk([
      makeEvent({ tags: ['drought'], severity: 'HIGH' }),
    ]);
    assert.equal(out.length, 0);
  });
});

// ── buildTippingPoints ─────────────────────────────────────────────

describe('buildTippingPoints', () => {
  it('returns all six elements even with no observations', () => {
    const out = buildTippingPoints([]);
    assert.equal(out.length, 6);
    assert.ok(out.every((t) => t.status === 'stable'));
    assert.ok(out.every((t) => t.evidenceCount === 0));
  });

  it('marks element critical when mean severity is high', () => {
    const out = buildTippingPoints([
      makeEvent({ tags: ['amoc'], severity: 'CRITICAL' }),
      makeEvent({ tags: ['amoc'], severity: 'CRITICAL' }),
    ]);
    const amoc = out.find((t) => t.element === 'AMOC');
    assert.equal(amoc?.status, 'critical');
    assert.equal(amoc?.evidenceCount, 2);
  });

  it('marks element stressed at moderate mean', () => {
    const out = buildTippingPoints([
      makeEvent({ tags: ['permafrost'], severity: 'MEDIUM' }),
    ]);
    const p = out.find((t) => t.element === 'Permafrost');
    assert.equal(p?.status, 'stressed');
  });

  it('records latest observed timestamp', () => {
    const out = buildTippingPoints([
      makeEvent({ tags: ['greenland-ice-sheet'], severity: 'HIGH', timestamp: NOW - 5 * H }),
      makeEvent({ tags: ['greenland-melt'], severity: 'HIGH', timestamp: NOW }),
    ]);
    const g = out.find((t) => t.element === 'Greenland');
    assert.equal(g?.lastObservedAt, NOW);
  });

  it('does not match unrelated tags', () => {
    const out = buildTippingPoints([makeEvent({ tags: ['wildfire'], severity: 'CRITICAL' })]);
    assert.ok(out.every((t) => t.evidenceCount === 0));
  });
});

// ── buildClimateSecurityIndex ──────────────────────────────────────

describe('buildClimateSecurityIndex', () => {
  it('returns all six security regions', () => {
    const out = buildClimateSecurityIndex([]);
    assert.equal(out.length, 6);
    const regions = out.map((r) => r.region);
    assert.ok(regions.includes('Sub-Saharan Africa'));
    assert.ok(regions.includes('Pacific Islands'));
    assert.ok(regions.includes('Arctic'));
  });

  it('elevates index when severe events accumulate', () => {
    const out = buildClimateSecurityIndex([
      makeEvent({ tags: ['drought', 'sub-saharan-africa'], severity: 'CRITICAL' }),
      makeEvent({ tags: ['heatwave', 'sub-saharan-africa'], severity: 'CRITICAL' }),
    ]);
    const ssa = out.find((r) => r.region === 'Sub-Saharan Africa');
    assert.equal(ssa?.index, 4);
    assert.equal(ssa?.eventCount, 2);
  });

  it('returns 0 for regions with no events', () => {
    const out = buildClimateSecurityIndex([
      makeEvent({ tags: ['drought', 'sub-saharan-africa'], severity: 'CRITICAL' }),
    ]);
    const arctic = out.find((r) => r.region === 'Arctic');
    assert.equal(arctic?.index, 0);
    assert.equal(arctic?.driverSummary, '—');
  });

  it('summarizes contributing drivers', () => {
    const out = buildClimateSecurityIndex([
      makeEvent({ tags: ['drought', 'south-asia'], severity: 'HIGH' }),
      makeEvent({ tags: ['flood', 'south-asia'], severity: 'HIGH' }),
    ]);
    const sa = out.find((r) => r.region === 'South Asia');
    assert.ok(sa);
    assert.ok(sa!.driverSummary.includes('drought'));
    assert.ok(sa!.driverSummary.includes('flood'));
  });

  it('matches Arctic via derived lat/lon', () => {
    const out = buildClimateSecurityIndex([
      makeEvent({ tags: ['wildfire'], severity: 'CRITICAL', location: { lat: 75, lon: 90 } }),
    ]);
    const arctic = out.find((r) => r.region === 'Arctic');
    assert.equal(arctic?.eventCount, 1);
  });
});

// ── renderClimateSuperpowerHtml ────────────────────────────────────

describe('renderClimateSuperpowerHtml', () => {
  const blankState: ClimatePanelState = {
    extreme: [],
    seaIce: [],
    migration: [],
    tipping: buildTippingPoints([]),
    security: buildClimateSecurityIndex([]),
    generatedAt: NOW,
  };

  it('renders all five sections', () => {
    const html = renderClimateSuperpowerHtml(blankState, () => NOW);
    assert.match(html, /data-section="extreme-events"/);
    assert.match(html, /data-section="sea-ice"/);
    assert.match(html, /data-section="migration-risk"/);
    assert.match(html, /data-section="tipping-points"/);
    assert.match(html, /data-section="security-index"/);
  });

  it('shows empty states for sections with no data', () => {
    const html = renderClimateSuperpowerHtml(blankState, () => NOW);
    assert.match(html, /No active extreme climate events/);
    assert.match(html, /No anomalous readings/);
    assert.match(html, /No regions flagged/);
  });

  it('escapes hostile titles', () => {
    const state: ClimatePanelState = {
      ...blankState,
      extreme: buildExtremeEvents([
        makeEvent({ tags: ['wildfire'], title: '<script>alert(1)</script>' }),
      ]),
    };
    const html = renderClimateSuperpowerHtml(state, () => NOW);
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.match(html, /&lt;script&gt;/);
  });

  it('emits Climate Security Index with sev-N color tokens', () => {
    const security = buildClimateSecurityIndex([
      makeEvent({ tags: ['drought', 'sub-saharan-africa'], severity: 'CRITICAL' }),
      makeEvent({ tags: ['heatwave', 'sub-saharan-africa'], severity: 'CRITICAL' }),
    ]);
    const state: ClimatePanelState = { ...blankState, security };
    const html = renderClimateSuperpowerHtml(state, () => NOW);
    assert.match(html, /color:var\(--severity-4\)/);
  });

  it('includes generatedAt footer', () => {
    const html = renderClimateSuperpowerHtml(blankState, () => NOW + 5_000);
    assert.match(html, /Updated 5s ago/);
  });
});
