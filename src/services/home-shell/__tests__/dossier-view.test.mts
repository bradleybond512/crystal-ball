import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDossierView } from '../dossier-view.ts';
import type { DossierInputs } from '../dossier-view.ts';
import type { PanelMeta } from '../../../config/panel-metadata.ts';

const NOW = 1_752_500_000_000;

function meta(overrides: Partial<PanelMeta> = {}): PanelMeta {
  return { domain: 'hazards-weather', tags: ['weather'], tier: 'library', evidenceFor: ['severe_weather'], ...overrides };
}

function inputs(overrides: Partial<DossierInputs> = {}): DossierInputs {
  return {
    situation: {
      id: 'alert-1',
      title: 'Severe cell → NW Indiana',
      category: 'severe_weather',
      severityScore: 82,
      confidence: 'high',
      minutesUntilImpact: 40,
    },
    metadata: {
      'nws-alerts': meta({ featured: true, icon: '⚠️' }),
      'weather-radar': meta(),
      'power-grid': meta({ domain: 'cyber-infrastructure' }),
      'saved-places': meta({ domain: 'personal-safety' }),
      earthquakes: meta({ evidenceFor: ['earthquake'] }),
      'self-test': meta({ domain: 'system-health', tier: 'system' }),
    },
    names: {
      'nws-alerts': { name: 'NWS Alerts' },
      'weather-radar': { name: 'Weather Radar' },
      'power-grid': { name: 'Power Grid' },
      'saved-places': { name: 'Saved Places' },
      earthquakes: { name: 'Earthquakes' },
      'self-test': { name: 'Self-Test' },
    },
    health: [{ panelId: 'nws-alerts', status: 'healthy', lastRenderAt: NOW - 30_000 }],
    narratives: { 'nws-alerts': '1 warning · 2 watches' },
    pipelineEvents: [
      { at: NOW - 300_000, stage: 'ingested' },
      { at: NOW - 240_000, stage: 'evaluated', reason: 'big event (tier critical)' },
      { at: NOW - 200_000, stage: 'routed' },
    ],
    notificationEvents: [{ at: NOW - 190_000, kind: 'dispatched', reason: 'rung notify_now' }],
    ...overrides,
  };
}

test('header badge maps urgency and confidence', () => {
  const view = buildDossierView(inputs(), NOW);
  assert.equal(view.title, 'Severe cell → NW Indiana');
  assert.equal(view.badge.text, 'ACT SOON · HIGH CONF');
  assert.equal(view.badge.tone, 'critical');
  assert.ok(view.subline.includes('~40 min'));
});

test('low urgency maps to monitor/info', () => {
  const view = buildDossierView(
    inputs({ situation: { id: 's', title: 'T', category: 'severe_weather', severityScore: 20, confidence: 'low' } }),
    NOW,
  );
  assert.equal(view.badge.text, 'MONITOR · LOW CONF');
  assert.equal(view.badge.tone, 'info');
});

test('evidence composes only matching category, system tier excluded from top, capped with runners-up', () => {
  const many = inputs();
  for (let i = 0; i < 8; i++) {
    const key = `extra-${i}`;
    (many.metadata as Record<string, PanelMeta>)[key] = meta();
    (many.names as Record<string, { name: string }>)[key] = { name: `Extra ${i}` };
  }
  const view = buildDossierView(many, NOW);
  assert.ok(view.evidence.length <= 6);
  assert.ok(view.runnersUp.length <= 4);
  const all = [...view.evidence, ...view.runnersUp].map((c) => c.panelId);
  assert.ok(!all.includes('earthquakes'), 'wrong-category panel leaked in');
  assert.equal(view.evidence[0]!.panelId, 'nws-alerts', 'featured+healthy ranks first');
  assert.ok(view.evidence[0]!.reason.length > 0);
});

test('why-surfaced lines come from traces, honest fallback when absent', () => {
  const view = buildDossierView(inputs(), NOW);
  assert.ok(view.whySurfaced.some((l) => l.includes('big event')));
  assert.ok(view.whySurfaced.some((l) => l.includes('notify_now')));
  const bare = buildDossierView(inputs({ pipelineEvents: undefined, notificationEvents: undefined }), NOW);
  assert.equal(bare.whySurfaced.length, 1);
  assert.ok(bare.whySurfaced[0]!.includes('no pipeline trace recorded'));
});

test('timeline merges and sorts both trace sources', () => {
  const view = buildDossierView(inputs(), NOW);
  assert.equal(view.timeline.length, 4);
  const times = view.timeline.map((r) => r.at);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  assert.ok(view.timeline[3]!.label.includes('dispatched'));
});

test('variant gate: panels missing from names are skipped', () => {
  const view = buildDossierView(inputs({ names: { 'nws-alerts': { name: 'NWS Alerts' } } }), NOW);
  const all = [...view.evidence, ...view.runnersUp].map((c) => c.panelId);
  assert.deepEqual(all, ['nws-alerts']);
});
