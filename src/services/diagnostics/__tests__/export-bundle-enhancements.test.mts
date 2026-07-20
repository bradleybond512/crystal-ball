/**
 * Tests for the Phase 2 diagnostic-export enhancements:
 *   - panelHealthSummary    — rendered/degraded/errored counts + entries
 *   - situations            — active situation inventory with confidence
 *   - correlations          — active correlation chains
 *   - algorithmTrace        — per-situation algorithm provenance
 *   - markdown rendering    — human-readable sections for the above
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildExportBundle,
  exportBundleToJson,
  exportBundleToMarkdown,
  type AlgorithmTraceEntry,
  type CorrelationSummary,
  type PanelHealthSummary,
  type SituationSummary,
} from '../export-bundle.ts';
import { createDiagnosticEventBus } from '../diagnostic-events.ts';
import { createNotificationTraceRegistry } from '../notification-trace.ts';
import type {
  NotificationTraceSummary,
  SystemHealthReport,
} from '../system-health-types.ts';

const NOW = 1_745_000_000_000;

function emptyNotifSummary(): NotificationTraceSummary {
  return {
    generatedAt: NOW,
    candidates: 0,
    dispatched: 0,
    suppressedByReason: {},
    unsafeSuppressions: [],
  };
}

function makeSystemHealth(): SystemHealthReport {
  return {
    generatedAt: NOW,
    status: 'healthy',
    summary: 'All features healthy.',
    features: [],
    panels: [],
    sources: [],
    providers: [],
    notifications: emptyNotifSummary(),
    sidecar: { status: 'healthy', authenticated: true, reason: 'OK' },
    recommendations: [],
  };
}

function baseInput() {
  return {
    now: () => NOW,
    app: { variant: 'full', version: '2.16.0', runtime: 'desktop' as const },
    systemHealth: makeSystemHealth(),
    notifications: { registry: createNotificationTraceRegistry() },
    events: createDiagnosticEventBus(),
  };
}

// ── Panel health summary ───────────────────────────────────────────────

test('panelHealthSummary surfaces rendered/degraded/errored counts', () => {
  const panelHealthSummary: PanelHealthSummary = {
    total: 5,
    rendered: 3,
    degraded: 1,
    errored: 1,
    entries: [
      { panelId: 'map', label: 'Global Map', status: 'healthy', lastRenderAt: NOW - 10_000 },
      { panelId: 'alerts', label: 'Alerts', status: 'degraded', lastRenderAt: NOW - 600_000, reason: 'stale' },
      { panelId: 'gov', label: 'Gov', status: 'failing', lastErrorAt: NOW - 1_000, reason: 'fetch failed' },
    ],
  };
  const bundle = buildExportBundle({ ...baseInput(), panelHealthSummary });
  assert.ok(bundle.panelHealthSummary);
  assert.equal(bundle.panelHealthSummary?.total, 5);
  assert.equal(bundle.panelHealthSummary?.rendered, 3);
  assert.equal(bundle.panelHealthSummary?.degraded, 1);
  assert.equal(bundle.panelHealthSummary?.errored, 1);
  assert.equal(bundle.panelHealthSummary?.entries.length, 3);
});

test('panelHealthSummary is omitted when not supplied', () => {
  const bundle = buildExportBundle(baseInput());
  assert.equal(bundle.panelHealthSummary, undefined);
});

test('panelHealthSummary entries redact free-text reason fields', () => {
  const panelHealthSummary: PanelHealthSummary = {
    total: 1,
    rendered: 0,
    degraded: 0,
    errored: 1,
    entries: [{
      panelId: 'gov',
      status: 'failing',
      reason: 'fetch user@example.com password=hunter2 failed',
    }],
  };
  const bundle = buildExportBundle({ ...baseInput(), panelHealthSummary });
  const entry = bundle.panelHealthSummary?.entries[0];
  assert.ok(entry);
  assert.ok(!entry.reason?.includes('user@example.com'), `email leaked: ${entry.reason}`);
  assert.ok(!entry.reason?.includes('hunter2'), `password leaked: ${entry.reason}`);
});

// ── Situations inventory ───────────────────────────────────────────────

test('situations inventory carries id, name, status, severity, confidence', () => {
  const situations: SituationSummary[] = [{
    id: 'sit-1',
    name: 'Hurricane Milton',
    status: 'active',
    severity: 'critical',
    domain: 'weather',
    startedAt: NOW - 3_600_000,
    updatedAt: NOW - 60_000,
    observationIds: ['ev-1', 'ev-2'],
    correlationIds: ['corr-1'],
    confidence: 0.82,
    tags: ['hurricane'],
  }];
  const bundle = buildExportBundle({ ...baseInput(), situations });
  assert.equal(bundle.situations?.length, 1);
  const s = bundle.situations?.[0];
  assert.equal(s?.id, 'sit-1');
  assert.equal(s?.severity, 'critical');
  assert.equal(s?.confidence, 0.82);
  assert.deepEqual(s?.observationIds, ['ev-1', 'ev-2']);
});

test('situations is omitted when not supplied', () => {
  const bundle = buildExportBundle(baseInput());
  assert.equal(bundle.situations, undefined);
});

test('situations summary field is redacted for embedded PII', () => {
  const situations: SituationSummary[] = [{
    id: 'sit-1',
    name: 'Test',
    status: 'active',
    severity: 'high',
    domain: 'weather',
    startedAt: NOW,
    updatedAt: NOW,
    observationIds: [],
    correlationIds: [],
    confidence: 0.5,
    tags: [],
    summary: 'Reach out to user@example.com',
  }];
  const bundle = buildExportBundle({ ...baseInput(), situations });
  assert.ok(!bundle.situations?.[0]?.summary?.includes('user@example.com'));
});

test('situations name and tags are redacted for embedded PII', () => {
  const situations: SituationSummary[] = [{
    id: 'sit-1',
    name: 'Outage flagged by user@example.com',
    status: 'active',
    severity: 'high',
    domain: 'weather',
    startedAt: NOW,
    updatedAt: NOW,
    observationIds: [],
    correlationIds: [],
    confidence: 0.5,
    // tags propagate from event.tags — must get the same scrub as name/summary.
    tags: ['contact:user@example.com', 'Bearer abcd1234abcd1234abcd1234abcd1234'],
    summary: 'x',
  }];
  const bundle = buildExportBundle({ ...baseInput(), situations });
  const s = bundle.situations?.[0];
  assert.ok(!s?.name?.includes('user@example.com'), `name leaked: ${s?.name}`);
  const tagsJson = JSON.stringify(s?.tags);
  assert.ok(!tagsJson.includes('user@example.com'), `tag email leaked: ${tagsJson}`);
  assert.ok(!tagsJson.includes('abcd1234abcd1234'), `tag token leaked: ${tagsJson}`);
});

// ── Correlations inventory ─────────────────────────────────────────────

test('correlations inventory carries chainType, title, confidence, eventIds', () => {
  const correlations: CorrelationSummary[] = [{
    id: 'corr-1',
    chainType: 'seismic-cascade',
    title: 'M6.0 → tsunami alert',
    confidence: 0.7,
    detectedAt: NOW - 120_000,
    eventIds: ['ev-1', 'ev-2', 'ev-3'],
  }];
  const bundle = buildExportBundle({ ...baseInput(), correlations });
  assert.equal(bundle.correlations?.length, 1);
  const c = bundle.correlations?.[0];
  assert.equal(c?.chainType, 'seismic-cascade');
  assert.equal(c?.confidence, 0.7);
  assert.equal(c?.eventIds.length, 3);
});

test('correlations title is redacted for embedded PII', () => {
  const correlations: CorrelationSummary[] = [{
    id: 'corr-1',
    chainType: 'seismic-cascade',
    title: 'chain flagged by user@example.com',
    confidence: 0.7,
    detectedAt: NOW,
    eventIds: [],
  }];
  const bundle = buildExportBundle({ ...baseInput(), correlations });
  assert.ok(
    !bundle.correlations?.[0]?.title?.includes('user@example.com'),
    `title leaked: ${bundle.correlations?.[0]?.title}`,
  );
});

test('correlations is omitted when not supplied', () => {
  const bundle = buildExportBundle(baseInput());
  assert.equal(bundle.correlations, undefined);
});

// ── Algorithm trace ────────────────────────────────────────────────────

test('algorithmTrace links a situation to the algorithm + evidence chain', () => {
  const algorithmTrace: AlgorithmTraceEntry[] = [{
    situationId: 'sit-1',
    algorithmId: 'situation-clustering',
    confidence: 0.82,
    evidenceChain: [
      { kind: 'observation', id: 'ev-1', summary: 'M6.0 earthquake offshore' },
      { kind: 'observation', id: 'ev-2', summary: 'Tsunami advisory' },
      { kind: 'correlation', id: 'corr-1', summary: 'seismic-cascade chain' },
    ],
  }];
  const bundle = buildExportBundle({ ...baseInput(), algorithmTrace });
  assert.equal(bundle.algorithmTrace?.length, 1);
  const t = bundle.algorithmTrace?.[0];
  assert.equal(t?.situationId, 'sit-1');
  assert.equal(t?.algorithmId, 'situation-clustering');
  assert.equal(t?.evidenceChain.length, 3);
  assert.equal(t?.evidenceChain[0]?.kind, 'observation');
  assert.equal(t?.evidenceChain[2]?.kind, 'correlation');
});

test('algorithmTrace evidence summaries are redacted for PII', () => {
  const algorithmTrace: AlgorithmTraceEntry[] = [{
    situationId: 'sit-1',
    algorithmId: 'situation-clustering',
    confidence: 0.5,
    evidenceChain: [
      { kind: 'observation', id: 'ev-1', summary: 'Contact attacker@malicious.com' },
    ],
  }];
  const bundle = buildExportBundle({ ...baseInput(), algorithmTrace });
  const summary = bundle.algorithmTrace?.[0]?.evidenceChain[0]?.summary;
  assert.ok(!summary?.includes('attacker@malicious.com'), `email leaked: ${summary}`);
});

test('algorithmTrace is omitted when not supplied', () => {
  const bundle = buildExportBundle(baseInput());
  assert.equal(bundle.algorithmTrace, undefined);
});

// ── JSON round-trip ────────────────────────────────────────────────────

test('exportBundleToJson preserves all new sections', () => {
  const situations: SituationSummary[] = [{
    id: 'sit-1',
    name: 'X',
    status: 'active',
    severity: 'high',
    domain: 'weather',
    startedAt: NOW,
    updatedAt: NOW,
    observationIds: [],
    correlationIds: [],
    confidence: 0.5,
    tags: [],
  }];
  const correlations: CorrelationSummary[] = [{
    id: 'corr-1', chainType: 'x', title: 't', confidence: 0.5, detectedAt: NOW, eventIds: [],
  }];
  const algorithmTrace: AlgorithmTraceEntry[] = [{
    situationId: 'sit-1', algorithmId: 'x', confidence: 0.5, evidenceChain: [],
  }];
  const panelHealthSummary: PanelHealthSummary = {
    total: 1, rendered: 1, degraded: 0, errored: 0,
    entries: [{ panelId: 'map', status: 'healthy' }],
  };
  const bundle = buildExportBundle({
    ...baseInput(),
    situations,
    correlations,
    algorithmTrace,
    panelHealthSummary,
  });
  const round = JSON.parse(exportBundleToJson(bundle));
  assert.equal(round.situations?.length, 1);
  assert.equal(round.correlations?.length, 1);
  assert.equal(round.algorithmTrace?.length, 1);
  assert.equal(round.panelHealthSummary?.entries.length, 1);
});

// ── Markdown rendering ─────────────────────────────────────────────────

test('exportBundleToMarkdown includes a Situations section when present', () => {
  const situations: SituationSummary[] = [{
    id: 'sit-hurricane', name: 'Hurricane Milton', status: 'active',
    severity: 'critical', domain: 'weather', startedAt: NOW, updatedAt: NOW,
    observationIds: ['ev-1'], correlationIds: [], confidence: 0.82, tags: [],
  }];
  const md = exportBundleToMarkdown(buildExportBundle({ ...baseInput(), situations }));
  assert.match(md, /Active situations/i);
  assert.match(md, /Hurricane Milton/);
  assert.match(md, /critical/);
});

test('exportBundleToMarkdown includes a Panel health section when present', () => {
  const panelHealthSummary: PanelHealthSummary = {
    total: 2, rendered: 1, degraded: 1, errored: 0,
    entries: [
      { panelId: 'map', label: 'Map', status: 'healthy' },
      { panelId: 'alerts', label: 'Alerts', status: 'degraded', reason: 'stale' },
    ],
  };
  const md = exportBundleToMarkdown(buildExportBundle({ ...baseInput(), panelHealthSummary }));
  assert.match(md, /Panel health/i);
  assert.match(md, /1 degraded/);
});

test('exportBundleToMarkdown omits new sections when sources are absent', () => {
  const md = exportBundleToMarkdown(buildExportBundle(baseInput()));
  assert.ok(!/Active situations/i.test(md), 'should not render Situations heading');
  assert.ok(!/Correlation chains/i.test(md), 'should not render Correlations heading');
  assert.ok(!/Algorithm trace/i.test(md), 'should not render Algorithm trace heading');
});

test('exportBundleToMarkdown includes Algorithm trace + Correlations when present', () => {
  const correlations: CorrelationSummary[] = [{
    id: 'corr-1', chainType: 'seismic-cascade', title: 'M6 → tsunami',
    confidence: 0.7, detectedAt: NOW, eventIds: ['e1', 'e2'],
  }];
  const algorithmTrace: AlgorithmTraceEntry[] = [{
    situationId: 'sit-1', algorithmId: 'situation-clustering',
    confidence: 0.82, evidenceChain: [
      { kind: 'observation', id: 'e1', summary: 'quake' },
    ],
  }];
  const md = exportBundleToMarkdown(buildExportBundle({
    ...baseInput(), correlations, algorithmTrace,
  }));
  assert.match(md, /Correlation chains/i);
  assert.match(md, /seismic-cascade/);
  assert.match(md, /Algorithm trace/i);
  assert.match(md, /situation-clustering/);
});

// ── Bounded growth ────────────────────────────────────────────────────

test('truncations record is added when more than the cap of situations are passed', () => {
  const many: SituationSummary[] = Array.from({ length: 60 }, (_, i) => ({
    id: `s-${i}`, name: `S${i}`, status: 'active' as const,
    severity: 'low' as const, domain: 'weather',
    startedAt: NOW, updatedAt: NOW,
    observationIds: [], correlationIds: [], confidence: 0.1, tags: [],
  }));
  const bundle = buildExportBundle({
    ...baseInput(),
    situations: many,
    caps: { maxSituations: 25 },
  });
  assert.equal(bundle.situations?.length, 25);
  const note = bundle.truncations.find((t) => t.field === 'situations');
  assert.ok(note, 'expected truncation note for situations');
  assert.equal(note?.originalCount, 60);
  assert.equal(note?.keptCount, 25);
});

test('default cap on algorithmTrace prevents unbounded growth', () => {
  const many: AlgorithmTraceEntry[] = Array.from({ length: 200 }, (_, i) => ({
    situationId: `s-${i}`,
    algorithmId: 'x',
    confidence: 0.1,
    evidenceChain: [],
  }));
  const bundle = buildExportBundle({ ...baseInput(), algorithmTrace: many });
  // Default cap is 100
  assert.ok(bundle.algorithmTrace!.length <= 100, `expected ≤100, got ${bundle.algorithmTrace?.length}`);
  const note = bundle.truncations.find((t) => t.field === 'algorithmTrace');
  assert.ok(note, 'expected truncation note for algorithmTrace');
});

// Round-1 audit #6/#8: redactSystemHealth spread `...report` through, leaking the
// free-text panels[].lastError and notifications.unsafeSuppressions[].reason
// (which can carry a thrown URL / token / PII) into the GitHub-paste bundle.
test('redactSystemHealth scrubs free text in panels[].lastError + unsafeSuppressions[].reason', () => {
  const EMAIL = 'panel-canary@example.invalid';
  const TOKEN = 'aaaabbbbccccddddeeeeffff00001111';
  const systemHealth: SystemHealthReport = {
    ...makeSystemHealth(),
    panels: [{
      panelId: 'nws-alerts',
      label: 'Weather',
      status: 'failing',
      mounted: true,
      enabled: true,
      visible: true,
      lastError: `render failed for ${EMAIL} (Bearer ${TOKEN})`,
      dependencies: [],
    }] as SystemHealthReport['panels'],
    notifications: {
      ...emptyNotifSummary(),
      unsafeSuppressions: [{ candidateId: 'c1', reason: `suppressed alert from ${EMAIL}`, at: NOW }],
    },
  };
  const json = exportBundleToJson(buildExportBundle({ ...baseInput(), systemHealth }));
  assert.doesNotMatch(json, /panel-canary@example\.invalid/, 'panel/suppression email must be redacted');
  assert.doesNotMatch(json, /aaaabbbbccccddddeeeeffff00001111/, 'panel lastError token must be redacted');
});
