import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildOfflinePlaybookBoardView } from '../offline-playbook-view.ts';
import type {
  OfflinePlaybookResult,
  AxisOfflinePlaybook,
  OfflinePlayItem,
} from '../offline-playbook.ts';
import type { SurvivalAxis, SurvivalBand } from '../survival-types.ts';

function action(over: Partial<OfflinePlayItem> = {}): OfflinePlayItem {
  return {
    id: over.id ?? 'act',
    label: over.label ?? 'Move to the lowest interior room',
    rationale: 'rationale' in over ? over.rationale : 'Interior rooms survive wind best.',
    priority: over.priority ?? 1,
    estimatedMinutes: over.estimatedMinutes ?? 0,
    source: over.source ?? 'axis_playbook',
  };
}

function playbook(over: Partial<AxisOfflinePlaybook> = {}): AxisOfflinePlaybook {
  return {
    axis: over.axis ?? 'physical_safety',
    level: over.level ?? 82,
    band: over.band ?? 'critical',
    triggers: over.triggers ?? ['Tornado warning'],
    actions: over.actions ?? [action()],
  };
}

function result(over: Partial<OfflinePlaybookResult> = {}): OfflinePlaybookResult {
  const playbooks = over.playbooks ?? [];
  return {
    capturedAtMs: over.capturedAtMs ?? 0,
    playbooks,
    unresolvedAxes: over.unresolvedAxes ?? [],
    headline: over.headline ?? 'test headline',
  };
}

test('empty result → neutral, empty, headline passed through', () => {
  const view = buildOfflinePlaybookBoardView(result({ headline: 'No axis needs an offline play.' }));
  assert.equal(view.isEmpty, true);
  assert.equal(view.tone, 'neutral');
  assert.equal(view.cards.length, 0);
  assert.equal(view.headline, 'No axis needs an offline play.');
});

test('title is the constant board title', () => {
  const view = buildOfflinePlaybookBoardView(result());
  assert.equal(view.title, 'If the grid goes down');
});

test('band → tone: critical is danger, high is caution, elevated is muted', () => {
  const bands: Array<[SurvivalBand, string]> = [
    ['critical', 'danger'],
    ['high', 'caution'],
    ['elevated', 'muted'],
  ];
  for (const [band, tone] of bands) {
    const view = buildOfflinePlaybookBoardView(result({ playbooks: [playbook({ band })] }));
    assert.equal(view.cards[0]!.tone, tone, `band ${band}`);
  }
});

test('card-set tone is the worst band across cards', () => {
  const view = buildOfflinePlaybookBoardView(
    result({
      playbooks: [
        playbook({ axis: 'supply', band: 'elevated' }),
        playbook({ axis: 'comms', band: 'critical' }),
        playbook({ axis: 'health', band: 'high' }),
      ],
    }),
  );
  assert.equal(view.tone, 'danger');
});

test('urgencyLabel: priority 1 → Do now, 2-3 → Soon, 4-5 → When able', () => {
  const view = buildOfflinePlaybookBoardView(
    result({
      playbooks: [
        playbook({
          actions: [
            action({ id: 'a', priority: 1 }),
            action({ id: 'b', priority: 3 }),
            action({ id: 'c', priority: 5 }),
          ],
        }),
      ],
    }),
    { maxActionsPerAxis: 3 },
  );
  assert.deepEqual(
    view.cards[0]!.actions.map((a) => a.urgencyLabel),
    ['Do now', 'Soon', 'When able'],
  );
});

test('timeLabel: 0 minutes → now, otherwise ~N min', () => {
  const view = buildOfflinePlaybookBoardView(
    result({
      playbooks: [
        playbook({
          actions: [action({ id: 'a', estimatedMinutes: 0 }), action({ id: 'b', estimatedMinutes: 15 })],
        }),
      ],
    }),
    { maxActionsPerAxis: 2 },
  );
  assert.equal(view.cards[0]!.actions[0]!.timeLabel, 'now');
  assert.equal(view.cards[0]!.actions[1]!.timeLabel, '~15 min');
});

test('triggerSummary shows first two and a +N overflow', () => {
  const view = buildOfflinePlaybookBoardView(
    result({
      playbooks: [playbook({ triggers: ['Tornado warning', 'Power outage', 'Flash flood', 'Hail'] })],
    }),
  );
  assert.equal(view.cards[0]!.triggerSummary, 'Tornado warning, Power outage +2');
});

test('triggerSummary with two or fewer has no overflow', () => {
  const view = buildOfflinePlaybookBoardView(
    result({ playbooks: [playbook({ triggers: ['Tornado warning', 'Power outage'] })] }),
  );
  assert.equal(view.cards[0]!.triggerSummary, 'Tornado warning, Power outage');
});

test('cards preserve the resolver worst-first order', () => {
  const view = buildOfflinePlaybookBoardView(
    result({
      playbooks: [
        playbook({ axis: 'physical_safety' }),
        playbook({ axis: 'supply' }),
        playbook({ axis: 'comms' }),
      ],
    }),
  );
  assert.deepEqual(
    view.cards.map((c) => c.axis),
    ['physical_safety', 'supply', 'comms'],
  );
});

test('maxAxes caps cards and reports overflow', () => {
  const axes: SurvivalAxis[] = ['physical_safety', 'supply', 'comms', 'health', 'financial', 'mobility'];
  const playbooks = axes.map((axis) => playbook({ axis }));
  const view = buildOfflinePlaybookBoardView(result({ playbooks }), { maxAxes: 2 });
  assert.equal(view.cards.length, 2);
  assert.equal(view.cardOverflow, 4);
  assert.equal(view.cardOverflowLabel, '+4 more');
});

test('default axis cap is 4', () => {
  const axes: SurvivalAxis[] = ['physical_safety', 'supply', 'comms', 'health', 'financial', 'mobility'];
  const playbooks = axes.map((axis) => playbook({ axis }));
  const view = buildOfflinePlaybookBoardView(result({ playbooks }));
  assert.equal(view.cards.length, 4);
  assert.equal(view.cardOverflow, 2);
});

test('maxActionsPerAxis caps action rows and reports per-card overflow', () => {
  const actions = Array.from({ length: 5 }, (_, i) => action({ id: `a${i}`, priority: 2 }));
  const view = buildOfflinePlaybookBoardView(
    result({ playbooks: [playbook({ actions })] }),
    { maxActionsPerAxis: 2 },
  );
  assert.equal(view.cards[0]!.actions.length, 2);
  assert.equal(view.cards[0]!.actionOverflow, 3);
  assert.equal(view.cards[0]!.actionOverflowLabel, '+3 more');
});

test('non-positive maxActionsPerAxis is floored to 1 so a card always shows its top action', () => {
  const actions = [action({ id: 'a' }), action({ id: 'b' })];
  const view = buildOfflinePlaybookBoardView(
    result({ playbooks: [playbook({ actions })] }),
    { maxActionsPerAxis: 0 },
  );
  assert.equal(view.cards[0]!.actions.length, 1);
  assert.equal(view.cards[0]!.actionOverflow, 1);
});

test('unresolvedCount surfaces axes that resolved to zero actions', () => {
  const view = buildOfflinePlaybookBoardView(
    result({ playbooks: [playbook()], unresolvedAxes: ['energy_water', 'security'] }),
  );
  assert.equal(view.unresolvedCount, 2);
});

test('action rationale is carried verbatim, absent → empty string', () => {
  const view = buildOfflinePlaybookBoardView(
    result({
      playbooks: [
        playbook({
          actions: [
            action({ id: 'a', rationale: 'Keeps you off flooded roads.' }),
            action({ id: 'b', rationale: undefined }),
          ],
        }),
      ],
    }),
    { maxActionsPerAxis: 2 },
  );
  assert.equal(view.cards[0]!.actions[0]!.rationale, 'Keeps you off flooded roads.');
  assert.equal(view.cards[0]!.actions[1]!.rationale, '');
});

test('axis card carries level, band, and a human axis title', () => {
  const view = buildOfflinePlaybookBoardView(
    result({ playbooks: [playbook({ axis: 'supply', level: 71, band: 'high' })] }),
  );
  const card = view.cards[0]!;
  assert.equal(card.axis, 'supply');
  assert.equal(card.level, 71);
  assert.equal(card.band, 'high');
  assert.equal(typeof card.axisTitle, 'string');
  assert.ok(card.axisTitle.length > 0);
});

test('action source is preserved for weather-hazard vs static plays', () => {
  const view = buildOfflinePlaybookBoardView(
    result({
      playbooks: [
        playbook({
          actions: [
            action({ id: 'a', source: 'weather_hazard' }),
            action({ id: 'b', source: 'axis_playbook' }),
          ],
        }),
      ],
    }),
    { maxActionsPerAxis: 2 },
  );
  assert.equal(view.cards[0]!.actions[0]!.source, 'weather_hazard');
  assert.equal(view.cards[0]!.actions[1]!.source, 'axis_playbook');
});
