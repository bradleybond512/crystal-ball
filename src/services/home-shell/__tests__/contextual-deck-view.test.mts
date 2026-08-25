import assert from 'node:assert/strict';
import test from 'node:test';

import { PANEL_METADATA } from '../../../config/panel-metadata.ts';
import type { PanelMeta } from '../../../config/panel-metadata.ts';
import type { WorldSnapshot } from '../../survival/survival-types.ts';
import {
  CONTEXTUAL_PANEL_RULES,
  GUIDANCE_LEVEL,
  MAX_CONTEXTUAL_PANELS,
  buildContextualDeckView,
} from '../contextual-deck-view.ts';
import type { ContextualPanelRules } from '../contextual-deck-view.ts';

const NOW = Date.UTC(2026, 7, 25, 15);
const AXES = [
  'physical_safety', 'supply', 'financial', 'mobility',
  'comms', 'health', 'energy_water', 'security',
] as const;

function snapshot(
  levels: Partial<Record<(typeof AXES)[number], number>> = {},
  capturedAtMs = NOW,
): WorldSnapshot {
  const axes = AXES.map((axis) => {
    const level = levels[axis] ?? 0;
    return {
      axis,
      level,
      band: level >= 80 ? 'critical' : level >= 60 ? 'high' : level >= 40 ? 'elevated' : level >= 20 ? 'guarded' : 'secure',
      trend: 'steady',
      threats: [],
      confidence: { score: 1, factors: [] },
      explanation: { summary: '', factors: [], limitations: [] },
      drivers: [],
    };
  });
  const worst = [...axes].sort((a, b) => b.level - a.level)[0]!;
  return {
    version: 1,
    capturedAtMs,
    freshness: [{ domain: 'weather', fetchedAtMs: capturedAtMs, ageMs: 0, ok: true }],
    weatherAlerts: [],
    savedPlaces: [],
    posture: {
      axes,
      overallLevel: worst.level,
      overallBand: worst.band,
      worstAxis: worst.axis,
      headline: '',
      capturedAtMs,
      staleInputs: [],
    },
    plan: { committed: [] },
  } as WorldSnapshot;
}

function activePanels(...ids: string[]): Record<string, { name: string; enabled: boolean }> {
  return Object.fromEntries(ids.map((id) => [id, { name: `Panel ${id}`, enabled: true }]));
}

function metadata(...ids: string[]): Record<string, PanelMeta> {
  return Object.fromEntries(ids.map((id) => [id, {
    domain: 'personal-safety', tags: [], tier: 'library',
  } satisfies PanelMeta]));
}

function directRules(
  overrides: Partial<Record<(typeof AXES)[number], readonly string[]>>,
): ContextualPanelRules {
  return Object.fromEntries(AXES.map((axis) => [
    axis,
    (overrides[axis] ?? []).map((panelId) => [panelId] as const),
  ])) as unknown as ContextualPanelRules;
}

test('39 stays quiet while the elevated boundary at 40 reveals guidance', () => {
  const panels = activePanels('local-logistics');
  const metas = metadata('local-logistics');
  const rules = directRules({ physical_safety: ['local-logistics'] });

  assert.equal(GUIDANCE_LEVEL, 40);
  assert.equal(buildContextualDeckView({ snapshot: snapshot({ physical_safety: 39 }), pins: [], panels, metadata: metas, rules }, NOW).state, 'quiet');
  const elevated = buildContextualDeckView({ snapshot: snapshot({ physical_safety: 40 }), pins: [], panels, metadata: metas, rules }, NOW);
  assert.equal(elevated.state, 'active');
  assert.deepEqual(elevated.cards.map((card) => card.panelId), ['local-logistics']);
});

test('worst axes lead each mapping slot in round-robin order and suggestions cap at six', () => {
  const ids = ['security-1', 'security-2', 'supply-1', 'supply-2', 'health-1', 'health-2', 'health-3'];
  const view = buildContextualDeckView({
    snapshot: snapshot({ security: 90, supply: 70, health: 40 }),
    pins: [],
    panels: activePanels(...ids),
    metadata: metadata(...ids),
    rules: directRules({
      security: ['security-1', 'security-2'],
      supply: ['supply-1', 'supply-2'],
      health: ['health-1', 'health-2', 'health-3'],
    }),
  }, NOW);

  assert.equal(view.cards.length, MAX_CONTEXTUAL_PANELS);
  assert.deepEqual(view.cards.map((card) => card.panelId), [
    'security-1', 'supply-1', 'health-1',
    'security-2', 'supply-2', 'health-2',
  ]);
});

test('restored duplicate and extra axes cannot add panels or replace the fixed known-axis contribution', () => {
  const restored = snapshot({ security: 80, supply: 70 });
  const security = restored.posture.axes.find((axis) => axis.axis === 'security')!;
  restored.posture.axes = [
    ...restored.posture.axes,
    { ...security, level: 99 },
    { ...security, axis: 'rogue', level: 100 },
  ] as WorldSnapshot['posture']['axes'];
  const rules = {
    ...directRules({ security: ['security-1'], supply: ['supply-1'] }),
    rogue: [['rogue-1']],
  } as unknown as ContextualPanelRules;

  const view = buildContextualDeckView({
    snapshot: restored,
    pins: [],
    panels: activePanels('security-1', 'supply-1', 'rogue-1'),
    metadata: metadata('security-1', 'supply-1', 'rogue-1'),
    rules,
  }, NOW);

  assert.deepEqual(view.cards.map((card) => card.panelId), ['security-1', 'supply-1']);
  assert.deepEqual(view.cards[0]?.axes, [{ axis: 'security', band: 'critical', level: 80 }]);
});

test('a canonical suggestion keeps earliest rank while explaining every qualifying contributing axis', () => {
  const rules = directRules({
    physical_safety: ['local-logistics'],
    supply: ['local-logistics'],
    mobility: ['local-logistics'],
    health: ['local-logistics'],
    energy_water: ['local-logistics'],
  });
  const view = buildContextualDeckView({
    snapshot: snapshot({
      physical_safety: 90.4,
      supply: 69.6,
      mobility: 50.2,
      health: 44.4,
      energy_water: 40,
    }),
    pins: [],
    panels: activePanels('local-logistics'),
    metadata: metadata('local-logistics'),
    rules,
  }, NOW);

  assert.equal(view.cards.length, 1);
  assert.deepEqual(view.cards[0]?.axes, [
    { axis: 'physical_safety', band: 'critical', level: 90 },
    { axis: 'supply', band: 'high', level: 70 },
    { axis: 'mobility', band: 'elevated', level: 50 },
    { axis: 'health', band: 'elevated', level: 44 },
    { axis: 'energy_water', band: 'elevated', level: 40 },
  ]);
  assert.equal(
    view.cards[0]?.reason,
    'Physical safety critical (90) · Supply high (70) · Mobility elevated (50) · Health elevated (44) · Energy & water elevated (40).',
  );
});

test('Disaster Lifelines is mapped to exactly the five physical logistics axes', () => {
  const mapped = AXES.filter((axis) => CONTEXTUAL_PANEL_RULES[axis].some(([panelId]) => panelId === 'local-logistics'));
  assert.deepEqual(mapped, ['physical_safety', 'supply', 'mobility', 'health', 'energy_water']);
});

test('category-backed mapping rules agree with PanelMeta.evidenceFor', () => {
  for (const rules of Object.values(CONTEXTUAL_PANEL_RULES)) {
    for (const rule of rules) {
      const [panelId, category] = rule;
      if (!category) continue;
      assert.ok(
        PANEL_METADATA[panelId]?.evidenceFor?.includes(category),
        `${panelId} must declare evidenceFor ${category}`,
      );
    }
  }
});

test('canonical aliases dedupe candidates and exclude canonical persisted pins', () => {
  const rules = directRules({ security: ['alias-a', 'canonical', 'other'] });
  const metas = {
    ...metadata('canonical', 'other'),
    'alias-a': { ...metadata('alias-a')['alias-a']!, aliasOf: 'alias-b' },
    'alias-b': { ...metadata('alias-b')['alias-b']!, aliasOf: 'canonical' },
  };
  const panels = activePanels('canonical', 'other');

  const deduped = buildContextualDeckView({ snapshot: snapshot({ security: 80 }), pins: [], panels, metadata: metas, rules }, NOW);
  assert.deepEqual(deduped.cards.map((card) => card.panelId), ['canonical', 'other']);

  const pinned = buildContextualDeckView({ snapshot: snapshot({ security: 80 }), pins: ['alias-a'], panels, metadata: metas, rules }, NOW);
  assert.deepEqual(pinned.cards.map((card) => card.panelId), ['other']);
});

test('variant absence, default-off targets, missing aliases, and alias cycles fail closed', () => {
  const rules = directRules({ supply: ['variant-missing', 'default-off', 'missing-target', 'cycle-a', 'valid'] });
  const metas = {
    ...metadata('variant-missing', 'default-off', 'missing-target', 'cycle-a', 'cycle-b', 'valid'),
    'missing-target': { ...metadata('missing-target')['missing-target']!, aliasOf: 'absent' },
    'cycle-a': { ...metadata('cycle-a')['cycle-a']!, aliasOf: 'cycle-b' },
    'cycle-b': { ...metadata('cycle-b')['cycle-b']!, aliasOf: 'cycle-a' },
  };
  const panels = {
    'default-off': { name: 'Off', enabled: false },
    'missing-target': { name: 'Missing alias', enabled: true },
    'cycle-a': { name: 'Cycle', enabled: true },
    valid: { name: 'Valid', enabled: true },
  };

  const view = buildContextualDeckView({ snapshot: snapshot({ supply: 70 }), pins: [], panels, metadata: metas, rules }, NOW);
  assert.deepEqual(view.cards.map((card) => card.panelId), ['valid']);
});

test('state copy distinguishes checking, unavailable, quiet, active, and stale without claiming restoration', () => {
  const panels = activePanels('local-logistics');
  const metas = metadata('local-logistics');
  const rules = directRules({ physical_safety: ['local-logistics'] });
  const checking = buildContextualDeckView({ snapshot: undefined, pins: [], panels, metadata: metas, rules }, NOW);
  assert.equal(checking.state, 'checking');
  assert.equal(checking.summary, 'Checking saved posture…');

  const unavailable = buildContextualDeckView({ snapshot: null, pins: [], panels, metadata: metas, rules }, NOW);
  assert.equal(unavailable.state, 'unavailable');
  assert.equal(unavailable.summary, 'No posture snapshot yet; suggestions begin at elevated.');

  const quiet = buildContextualDeckView({ snapshot: snapshot(), pins: [], panels, metadata: metas, rules }, NOW);
  assert.equal(quiet.state, 'quiet');
  assert.equal(quiet.headline, 'No elevated posture axes');
  assert.equal(quiet.summary, 'Suggestions appear when an axis reaches elevated.');

  const active = buildContextualDeckView({ snapshot: snapshot({ physical_safety: 40 }), pins: [], panels, metadata: metas, rules }, NOW);
  assert.equal(active.state, 'active');
  assert.equal(active.headline, 'Suggested panels');
  assert.equal(active.cards[0]?.reason, 'Physical safety elevated (40).');

  const staleSnapshot = snapshot({ physical_safety: 40 }, NOW - 20 * 60_000);
  const stale = buildContextualDeckView({ snapshot: staleSnapshot, pins: [], panels, metadata: metas, rules }, NOW);
  assert.equal(stale.state, 'stale');
  assert.equal(stale.headline, 'Suggestions from last known posture');
  assert.match(stale.summary, /snapshot 20m old/i);
  assert.doesNotMatch(JSON.stringify(stale), /restored/i);
});

test('a stale secure snapshot reports last-known age and asks for current verification', () => {
  const panels = activePanels('local-logistics');
  const metas = metadata('local-logistics');
  const rules = directRules({ physical_safety: ['local-logistics'] });
  const view = buildContextualDeckView({
    snapshot: snapshot({}, NOW - 20 * 60_000),
    pins: [],
    panels,
    metadata: metas,
    rules,
  }, NOW);

  assert.equal(view.state, 'stale');
  assert.equal(view.headline, 'Last known posture—verify now');
  assert.equal(
    view.summary,
    'Snapshot 20m old · no elevated axes then; verify current conditions.',
  );
  assert.deepEqual(view.cards, []);
});

test('stale elevated posture without an available card does not imply current safety', () => {
  const metas = metadata('local-logistics');
  const rules = directRules({ physical_safety: ['local-logistics'] });
  const view = buildContextualDeckView({
    snapshot: snapshot({ physical_safety: 40 }, NOW - 20 * 60_000),
    pins: [],
    panels: {},
    metadata: metas,
    rules,
  }, NOW);

  assert.equal(view.state, 'stale');
  assert.equal(view.headline, 'Last known suggestions unavailable');
  assert.equal(
    view.summary,
    'Snapshot 20m old · elevated axes had no available panel; verify current conditions.',
  );
  assert.deepEqual(view.cards, []);
});
