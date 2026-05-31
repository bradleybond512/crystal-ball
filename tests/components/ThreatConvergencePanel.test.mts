/**
 * Tests for ThreatConvergencePanel — pure helpers + bridge.
 *
 * Run with: npx tsx --test tests/components/ThreatConvergencePanel.test.mts
 *
 * Pure-logic tests only; no DOM required. We exercise the panel's
 * rendering through the helper module so we don't drag in Panel + Vite
 * worker imports.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __resetThreatConvergenceBridgeForTests,
  ageLabel,
  colorForScore,
  computeActiveWindowStats,
  CRITICAL_FLOOR,
  getThreatConvergenceDetector,
  labelForScore,
  recommendationForScore,
  registerThreatConvergenceDetector,
  severityColor,
  severityLabel,
  THREAT_FLOOR,
  type ConvergenceEvent,
  type DomainElevation,
  type ThreatConvergenceDetectorBridge,
} from '../../src/services/intelligence/mission-bridges/threat-convergence-bridge.ts';
import {
  ELEVATION_FEED_LIMIT,
  HISTORY_LIMIT,
  RECOMMENDATION_DETAIL,
  RECOMMENDATION_LABEL,
  renderAlert,
  renderElevationFeed,
  renderHistory,
  renderUnavailable,
  renderWindowStatus,
  resolveFatigueScore,
  safe,
  WINDOW_MS,
} from '../../src/components/threat-convergence-panel-helpers.ts';

const NOW = 1_780_000_000_000;

function fakeDetector(
  elevations: DomainElevation[],
  history: ConvergenceEvent[],
  current: ConvergenceEvent | null,
): ThreatConvergenceDetectorBridge {
  return {
    recordElevation: (domain, severity, ts) => ({ domain, severity, timestamp: ts ?? NOW }),
    detect: () => current,
    getElevations: () => [...elevations],
    getHistory: (limit?: number) => history.slice(0, limit ?? history.length),
  };
}

function elevation(domain: string, severity: number, ageMin: number): DomainElevation {
  return { domain, severity, timestamp: NOW - ageMin * 60_000 };
}

function event(opts: Partial<ConvergenceEvent> & Pick<ConvergenceEvent, 'score'>): ConvergenceEvent {
  return {
    id: opts.id ?? `ev-${Math.random().toString(36).slice(2, 8)}`,
    detectedAt: opts.detectedAt ?? NOW - 5 * 60_000,
    domains: opts.domains ?? ['cyber', 'maritime', 'weather'],
    minSeverity: opts.minSeverity ?? 2,
    windowMs: opts.windowMs ?? 60 * 60 * 1000,
    score: opts.score,
    label: opts.label ?? labelForScore(opts.score),
  };
}

function reset(): void { __resetThreatConvergenceBridgeForTests(); }

// ── Bridge helpers ────────────────────────────────────────────────────

test('labelForScore: critical above 0.7, threat above 0.4, elevated otherwise', () => {
  assert.equal(labelForScore(0.75), 'CRITICAL CONVERGENCE');
  assert.equal(labelForScore(0.5),  'THREAT CONVERGENCE');
  assert.equal(labelForScore(0.2),  'ELEVATED CONVERGENCE');
  assert.equal(labelForScore(CRITICAL_FLOOR), 'THREAT CONVERGENCE'); // strict >
  assert.equal(labelForScore(THREAT_FLOOR),   'ELEVATED CONVERGENCE');
});

test('colorForScore: red ⇒ critical, amber ⇒ threat, blue ⇒ elevated', () => {
  assert.equal(colorForScore(0.9), '#ef4444');
  assert.equal(colorForScore(0.5), '#f59e0b');
  assert.equal(colorForScore(0.1), '#3b82f6');
});

test('recommendationForScore: crisis / elevate / monitor map cleanly', () => {
  assert.equal(recommendationForScore(0.9), 'crisis');
  assert.equal(recommendationForScore(0.5), 'elevate');
  assert.equal(recommendationForScore(0.1), 'monitor');
});

test('severityLabel: maps 0..4 onto INFO..CRITICAL', () => {
  assert.equal(severityLabel(0), 'INFO');
  assert.equal(severityLabel(1), 'LOW');
  assert.equal(severityLabel(2), 'MEDIUM');
  assert.equal(severityLabel(3), 'HIGH');
  assert.equal(severityLabel(4), 'CRITICAL');
});

test('severityColor: returns distinct hex per band', () => {
  const colors = [0, 1, 2, 3, 4].map(severityColor);
  assert.equal(new Set(colors).size, 5);
});

test('ageLabel: respects seconds / minutes / hours / days thresholds', () => {
  assert.match(ageLabel(NOW - 5_000, NOW), /^\d+s ago$/);
  assert.match(ageLabel(NOW - 2 * 60_000, NOW), /^\d+m ago$/);
  assert.match(ageLabel(NOW - 2 * 3_600_000, NOW), /^\d+h ago$/);
  assert.match(ageLabel(NOW - 3 * 86_400_000, NOW), /^\d+d ago$/);
});

test('computeActiveWindowStats: empty list → zeros + null', () => {
  const stats = computeActiveWindowStats([], 60_000, NOW);
  assert.equal(stats.elevatedDomains, 0);
  assert.equal(stats.peakSeverity, 0);
  assert.equal(stats.msSinceLastElevation, null);
});

test('computeActiveWindowStats: counts distinct domains in window', () => {
  const els = [
    elevation('cyber', 2, 1),
    elevation('cyber', 4, 2),   // same domain, dedupe in count
    elevation('maritime', 3, 5),
  ];
  const stats = computeActiveWindowStats(els, 60 * 60_000, NOW);
  assert.equal(stats.elevatedDomains, 2);
  assert.equal(stats.peakSeverity, 4);
});

test('computeActiveWindowStats: peakSeverity tracks the strongest signal', () => {
  const els = [elevation('a', 1, 1), elevation('b', 4, 1), elevation('c', 2, 1)];
  assert.equal(computeActiveWindowStats(els, 60 * 60_000, NOW).peakSeverity, 4);
});

test('computeActiveWindowStats: msSinceLastElevation = newest timestamp', () => {
  const els = [
    elevation('a', 2, 30),
    elevation('b', 2, 2),
  ];
  const stats = computeActiveWindowStats(els, 60 * 60_000, NOW);
  // newest is 2 minutes ago = 120_000 ms
  assert.equal(stats.msSinceLastElevation, 2 * 60_000);
});

test('computeActiveWindowStats: drops elevations outside the window', () => {
  const els = [elevation('inside', 2, 5), elevation('outside', 2, 90)];
  const stats = computeActiveWindowStats(els, 60 * 60_000, NOW);
  assert.equal(stats.elevatedDomains, 1);
});

test('registerThreatConvergenceDetector + getThreatConvergenceDetector round-trip', () => {
  reset();
  assert.equal(getThreatConvergenceDetector(), null);
  const fake = fakeDetector([], [], null);
  registerThreatConvergenceDetector(fake);
  assert.equal(getThreatConvergenceDetector(), fake);
});

test('__resetThreatConvergenceBridgeForTests clears the slot', () => {
  registerThreatConvergenceDetector(fakeDetector([], [], null));
  reset();
  assert.equal(getThreatConvergenceDetector(), null);
});

// ── Module-level constants ────────────────────────────────────────────

test('WINDOW_MS is one hour by default', () => {
  assert.equal(WINDOW_MS, 60 * 60 * 1000);
});

test('HISTORY_LIMIT and ELEVATION_FEED_LIMIT are sane defaults', () => {
  assert.ok(HISTORY_LIMIT > 0 && HISTORY_LIMIT <= 100);
  assert.ok(ELEVATION_FEED_LIMIT > 0 && ELEVATION_FEED_LIMIT <= 100);
});

test('RECOMMENDATION_LABEL covers all three recommendations', () => {
  assert.equal(RECOMMENDATION_LABEL.monitor, 'Monitor');
  assert.equal(RECOMMENDATION_LABEL.elevate, 'Elevate posture');
  assert.equal(RECOMMENDATION_LABEL.crisis, 'Crisis response');
});

test('RECOMMENDATION_DETAIL has non-empty copy for each tier', () => {
  for (const key of ['monitor', 'elevate', 'crisis'] as const) {
    assert.ok(RECOMMENDATION_DETAIL[key].length > 20);
  }
});

// ── safe() wrapper ────────────────────────────────────────────────────

test('safe: returns the value when fn does not throw', () => {
  assert.equal(safe(() => 42), 42);
});

test('safe: returns undefined when fn throws', () => {
  assert.equal(safe(() => { throw new Error('boom'); }), undefined);
});

// ── resolveFatigueScore ───────────────────────────────────────────────

test('resolveFatigueScore: returns undefined when no detector is registered globally', () => {
  delete (globalThis as { __crystalballFatigueDetector?: unknown }).__crystalballFatigueDetector;
  assert.equal(resolveFatigueScore(60_000), undefined);
});

test('resolveFatigueScore: reads the score from a registered detector', () => {
  (globalThis as { __crystalballFatigueDetector?: unknown }).__crystalballFatigueDetector = {
    AlertFatigueDetector: { getInstance: () => ({ getFatigueReport: () => ({ fatigueScore: 0.55 }) }) },
  };
  try {
    assert.equal(resolveFatigueScore(60_000), 0.55);
  } finally {
    delete (globalThis as { __crystalballFatigueDetector?: unknown }).__crystalballFatigueDetector;
  }
});

test('resolveFatigueScore: returns undefined if the detector throws', () => {
  (globalThis as { __crystalballFatigueDetector?: unknown }).__crystalballFatigueDetector = {
    AlertFatigueDetector: { getInstance: () => { throw new Error('boom'); } },
  };
  try {
    assert.equal(resolveFatigueScore(60_000), undefined);
  } finally {
    delete (globalThis as { __crystalballFatigueDetector?: unknown }).__crystalballFatigueDetector;
  }
});

// ── renderUnavailable ─────────────────────────────────────────────────

test('renderUnavailable: surfaces the "not registered" message', () => {
  assert.match(renderUnavailable(), /not registered yet/i);
});

// ── renderAlert (section 1) ───────────────────────────────────────────

test('renderAlert: null current → "No active convergence" copy', () => {
  assert.match(renderAlert(null), /No active convergence detected/i);
});

test('renderAlert: critical event → CRITICAL label + crisis recommendation', () => {
  const html = renderAlert(event({ score: 0.85, domains: ['cyber', 'maritime', 'weather', 'aviation'] }));
  assert.match(html, /CRITICAL CONVERGENCE/);
  assert.match(html, /data-recommendation="crisis"/);
});

test('renderAlert: shows score, domain count, and recommendation copy', () => {
  const html = renderAlert(event({ score: 0.55 }));
  assert.match(html, /score 0\.55/);
  assert.match(html, /Elevate posture/);
  assert.match(html, /data-recommendation="elevate"/);
});

test('renderAlert: lists each contributing domain as a chip', () => {
  const html = renderAlert(event({ score: 0.5, domains: ['cyber', 'maritime', 'weather'] }));
  for (const d of ['cyber', 'maritime', 'weather']) {
    assert.ok(html.includes(d), `expected domain chip "${d}" in rendered alert`);
  }
});

test('renderAlert: elevated tier (low score) → monitor recommendation', () => {
  const html = renderAlert(event({ score: 0.2 }));
  assert.match(html, /data-recommendation="monitor"/);
  assert.match(html, /ELEVATED CONVERGENCE/);
});

// ── renderWindowStatus (section 2) ────────────────────────────────────

test('renderWindowStatus: surfaces elevatedDomains + peakSeverity', () => {
  const html = renderWindowStatus({ elevatedDomains: 4, peakSeverity: 3, msSinceLastElevation: 2 * 60_000 });
  assert.match(html, /data-stat="elevated"[\s\S]*>4</);
  assert.match(html, /data-stat="peak"[\s\S]*HIGH/);
});

test('renderWindowStatus: reports "no elevations in window" when empty', () => {
  const html = renderWindowStatus({ elevatedDomains: 0, peakSeverity: 0, msSinceLastElevation: null });
  assert.match(html, /no elevations in window/);
});

test('renderWindowStatus: omits the fatigue chip when fatigueScore is undefined', () => {
  const html = renderWindowStatus({ elevatedDomains: 1, peakSeverity: 2, msSinceLastElevation: 1000 });
  assert.equal(/data-stat="fatigue"/.test(html), false);
});

test('renderWindowStatus: renders the fatigue chip when fatigueScore is provided', () => {
  const html = renderWindowStatus({
    elevatedDomains: 1, peakSeverity: 2, msSinceLastElevation: 1000, fatigueScore: 0.42,
  });
  assert.match(html, /data-stat="fatigue"/);
  assert.match(html, />42%</);
});

test('renderWindowStatus: fatigue color escalates with the score', () => {
  const red = renderWindowStatus({ elevatedDomains: 1, peakSeverity: 2, msSinceLastElevation: 1000, fatigueScore: 0.9 });
  const amber = renderWindowStatus({ elevatedDomains: 1, peakSeverity: 2, msSinceLastElevation: 1000, fatigueScore: 0.5 });
  const green = renderWindowStatus({ elevatedDomains: 1, peakSeverity: 2, msSinceLastElevation: 1000, fatigueScore: 0.1 });
  assert.match(red,   /color:#ef4444/);
  assert.match(amber, /color:#f59e0b/);
  assert.match(green, /color:#22c55e/);
});

// ── renderHistory (section 3) ─────────────────────────────────────────

test('renderHistory: empty list → "No prior convergence events" hint', () => {
  assert.match(renderHistory([]), /No prior convergence events/i);
});

test('renderHistory: one row per event in input order (caller pre-sorts)', () => {
  const history = [
    event({ id: 'h-new', score: 0.5, detectedAt: NOW - 60_000 }),
    event({ id: 'h-old', score: 0.3, detectedAt: NOW - 10 * 60_000 }),
  ];
  const html = renderHistory(history);
  assert.ok(html.includes('data-history-id="h-new"'));
  assert.ok(html.includes('data-history-id="h-old"'));
  // First-in renders first.
  assert.ok(html.indexOf('h-new') < html.indexOf('h-old'));
});

test('renderHistory: critical-band rows show red border', () => {
  assert.match(renderHistory([event({ id: 'h-crit', score: 0.9 })]), /border-left:3px solid #ef4444/);
});

test('renderHistory: header reflects the row count', () => {
  const h = [event({ score: 0.5 }), event({ score: 0.5 }), event({ score: 0.5 })];
  assert.match(renderHistory(h), /Convergence history \(3\)/);
});

// ── renderElevationFeed (section 4) ───────────────────────────────────

test('renderElevationFeed: empty list → "No domain elevations" hint', () => {
  assert.match(renderElevationFeed([]), /No domain elevations recorded/i);
});

test('renderElevationFeed: sorts newest first', () => {
  const elevations = [
    elevation('older', 2, 30),
    elevation('newest', 3, 1),
    elevation('middle', 2, 10),
  ];
  const html = renderElevationFeed(elevations);
  const newestIdx = html.indexOf('newest');
  const middleIdx = html.indexOf('middle');
  const olderIdx = html.indexOf('older');
  assert.ok(newestIdx > 0 && middleIdx > newestIdx && olderIdx > middleIdx);
});

test('renderElevationFeed: row shows the severity label badge', () => {
  const html = renderElevationFeed([elevation('cyber', 4, 1)]);
  assert.match(html, />CRITICAL</);
});

test('renderElevationFeed: caps the row count at ELEVATION_FEED_LIMIT', () => {
  const many = Array.from({ length: ELEVATION_FEED_LIMIT + 5 }, (_, i) => elevation(`d${i}`, 2, i));
  const html = renderElevationFeed(many);
  const rowCount = (html.match(/border-left:3px solid/g) ?? []).length;
  assert.equal(rowCount, ELEVATION_FEED_LIMIT);
});

test('renderElevationFeed: header reflects rendered row count (after cap)', () => {
  const many = Array.from({ length: ELEVATION_FEED_LIMIT + 5 }, (_, i) => elevation(`d${i}`, 2, i));
  assert.match(renderElevationFeed(many), new RegExp(`Domain elevations \\(${ELEVATION_FEED_LIMIT}\\)`));
});

// ── Sanity: defensive composition through safe() ──────────────────────

test('safe: composes with helper functions when used to guard detector calls', () => {
  const broken: ThreatConvergenceDetectorBridge = {
    recordElevation: () => ({ domain: '', severity: 0, timestamp: 0 }),
    detect: () => { throw new Error('boom'); },
    getElevations: () => { throw new Error('boom'); },
    getHistory: () => { throw new Error('boom'); },
  };
  assert.equal(safe(() => broken.detect()), undefined);
  assert.equal(safe(() => broken.getElevations()), undefined);
  assert.equal(safe(() => broken.getHistory()), undefined);
});
