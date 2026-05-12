/**
 * Playbook engine tests — Act stage.
 *
 * RED: all tests fail until playbook-engine.ts and playbooks/ exist.
 * Run: tsx --test src/services/intelligence/__tests__/playbook-engine.test.mts
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getPlaybook,
  executeAutomatedSteps,
  formatPlaybookForNotification,
  registerPlaybook,
  clearRegistry,
} from '../playbook-engine.ts';
import {
  EARTHQUAKE_PLAYBOOK,
  WILDFIRE_PLAYBOOK,
  AVIATION_EMERGENCY_PLAYBOOK,
  HURRICANE_PLAYBOOK,
  CYBER_BREACH_PLAYBOOK,
} from '../playbooks/index.ts';
import type { ObservationEvent } from '../../../types/intelligence.ts';
import type { Playbook } from '../../../types/intelligence.ts';

const NOW = 1_746_000_000_000;

function obs(overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  return {
    id: 'test-1',
    sourceId: 'test-source',
    domain: 'weather',
    timestamp: NOW,
    severity: 'HIGH',
    title: 'Test event',
    raw: {},
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

// ── Registry helpers ─────────────────────────────────────────────────────────

test('clearRegistry + registerPlaybook resets to fresh state', () => {
  clearRegistry();
  registerPlaybook(EARTHQUAKE_PLAYBOOK);
  const result = getPlaybook(obs({ domain: 'infra', tags: ['earthquake'] }));
  assert.ok(result !== null);
  assert.equal(result?.id, EARTHQUAKE_PLAYBOOK.id);
  clearRegistry(); // restore
});

// ── getPlaybook — matching ───────────────────────────────────────────────────

test('getPlaybook returns null for unknown domain with no matching tags', () => {
  clearRegistry();
  registerPlaybook(EARTHQUAKE_PLAYBOOK);
  const result = getPlaybook(obs({ domain: 'markets', severity: 'INFO', tags: [] }));
  assert.equal(result, null);
  clearRegistry();
});

test('getPlaybook returns earthquake playbook for seismic event', () => {
  clearRegistry();
  registerPlaybook(EARTHQUAKE_PLAYBOOK);
  const event = obs({ domain: 'infra', severity: 'HIGH', tags: ['earthquake', 'seismic'] });
  const result = getPlaybook(event);
  assert.ok(result !== null);
  assert.equal(result?.id, 'earthquake');
  clearRegistry();
});

test('getPlaybook returns wildfire playbook for fire event', () => {
  clearRegistry();
  registerPlaybook(WILDFIRE_PLAYBOOK);
  const event = obs({ domain: 'other', severity: 'HIGH', tags: ['wildfire', 'fire'] });
  const result = getPlaybook(event);
  assert.ok(result !== null);
  assert.equal(result?.id, 'wildfire');
  clearRegistry();
});

test('getPlaybook returns aviation emergency playbook for squawk-7700', () => {
  clearRegistry();
  registerPlaybook(AVIATION_EMERGENCY_PLAYBOOK);
  const event = obs({ domain: 'aviation', severity: 'HIGH', tags: ['squawk-7700'] });
  const result = getPlaybook(event);
  assert.ok(result !== null);
  assert.equal(result?.id, 'aviation-emergency');
  clearRegistry();
});

test('getPlaybook returns hurricane playbook for nhc event', () => {
  clearRegistry();
  registerPlaybook(HURRICANE_PLAYBOOK);
  const event = obs({ domain: 'weather', severity: 'HIGH', tags: ['hurricane', 'nhc'] });
  const result = getPlaybook(event);
  assert.ok(result !== null);
  assert.equal(result?.id, 'hurricane');
  clearRegistry();
});

test('getPlaybook returns cyber breach playbook for high cyber event', () => {
  clearRegistry();
  registerPlaybook(CYBER_BREACH_PLAYBOOK);
  const event = obs({ domain: 'cyber', severity: 'HIGH', tags: [] });
  const result = getPlaybook(event);
  assert.ok(result !== null);
  assert.equal(result?.id, 'cyber-breach');
  clearRegistry();
});

test('getPlaybook returns null when severity below playbook threshold', () => {
  clearRegistry();
  registerPlaybook(EARTHQUAKE_PLAYBOOK);
  // earthquake triggers on HIGH/CRITICAL — LOW should not match
  const event = obs({ domain: 'infra', severity: 'LOW', tags: ['earthquake'] });
  const result = getPlaybook(event);
  assert.equal(result, null);
  clearRegistry();
});

test('getPlaybook prefers tag-matched playbook over domain-only match', () => {
  clearRegistry();
  const genericWeather: Playbook = {
    id: 'generic-weather',
    name: 'Generic Weather',
    triggerDomains: ['weather'],
    triggerTags: [],
    triggerSeverity: ['HIGH', 'CRITICAL'],
    steps: [{ order: 1, action: 'Monitor', category: 'monitor', automated: false }],
  };
  registerPlaybook(genericWeather);
  registerPlaybook(HURRICANE_PLAYBOOK);
  const event = obs({ domain: 'weather', severity: 'HIGH', tags: ['hurricane'] });
  const result = getPlaybook(event);
  // hurricane has matching tags — it should win
  assert.equal(result?.id, 'hurricane');
  clearRegistry();
});

// ── Playbook structure validation ────────────────────────────────────────────

test('earthquake playbook has at least 3 steps', () => {
  assert.ok(EARTHQUAKE_PLAYBOOK.steps.length >= 3);
});

test('wildfire playbook has at least 3 steps', () => {
  assert.ok(WILDFIRE_PLAYBOOK.steps.length >= 3);
});

test('aviation emergency playbook has at least 3 steps', () => {
  assert.ok(AVIATION_EMERGENCY_PLAYBOOK.steps.length >= 3);
});

test('all steps have required fields', () => {
  const all = [
    ...EARTHQUAKE_PLAYBOOK.steps,
    ...WILDFIRE_PLAYBOOK.steps,
    ...AVIATION_EMERGENCY_PLAYBOOK.steps,
    ...HURRICANE_PLAYBOOK.steps,
    ...CYBER_BREACH_PLAYBOOK.steps,
  ];
  for (const step of all) {
    assert.ok(typeof step.order === 'number', `step.order must be number: ${JSON.stringify(step)}`);
    assert.ok(typeof step.action === 'string' && step.action.length > 0, `step.action must be non-empty: ${JSON.stringify(step)}`);
    assert.ok(['monitor', 'notify', 'prepare', 'act', 'verify'].includes(step.category), `invalid category: ${step.category}`);
    assert.ok(typeof step.automated === 'boolean', `step.automated must be boolean: ${JSON.stringify(step)}`);
  }
});

test('steps are sorted by order within each playbook', () => {
  for (const playbook of [EARTHQUAKE_PLAYBOOK, WILDFIRE_PLAYBOOK, AVIATION_EMERGENCY_PLAYBOOK, HURRICANE_PLAYBOOK, CYBER_BREACH_PLAYBOOK]) {
    const orders = playbook.steps.map(s => s.order);
    for (let i = 1; i < orders.length; i++) {
      assert.ok(orders[i]! > orders[i - 1]!, `${playbook.id}: steps not ordered at index ${i}`);
    }
  }
});

test('earthquake playbook includes a monitor step for aftershocks', () => {
  const step = EARTHQUAKE_PLAYBOOK.steps.find(s => s.category === 'monitor');
  assert.ok(step !== undefined, 'should have at least one monitor step');
});

test('wildfire playbook includes wind direction check', () => {
  const hasWind = WILDFIRE_PLAYBOOK.steps.some(s => s.action.toLowerCase().includes('wind'));
  assert.ok(hasWind, 'wildfire playbook must mention wind direction');
});

test('aviation emergency playbook addresses squawk codes', () => {
  const hasSquawk = AVIATION_EMERGENCY_PLAYBOOK.steps.some(
    s => s.action.toLowerCase().includes('track') || s.action.toLowerCase().includes('aircraft')
  );
  assert.ok(hasSquawk, 'aviation playbook must track aircraft');
});

test('cyber breach playbook has notify step', () => {
  const step = CYBER_BREACH_PLAYBOOK.steps.find(s => s.category === 'notify');
  assert.ok(step !== undefined, 'cyber breach playbook must have a notify step');
});

// ── executeAutomatedSteps ────────────────────────────────────────────────────

test('executeAutomatedSteps returns entries only for automated steps', () => {
  const playbook: Playbook = {
    id: 'test',
    name: 'Test',
    triggerDomains: ['*'],
    triggerTags: [],
    triggerSeverity: ['HIGH'],
    steps: [
      { order: 1, action: 'Manual step', category: 'monitor', automated: false },
      { order: 2, action: 'Automated step', category: 'monitor', automated: true, automationFn: 'fetchAftershocks' },
    ],
  };
  const event = obs();
  const results = executeAutomatedSteps(playbook, event);
  assert.equal(results.length, 1);
  assert.equal(results[0]?.stepOrder, 2);
  assert.equal(results[0]?.automationFn, 'fetchAftershocks');
});

test('executeAutomatedSteps returns empty array when no automated steps', () => {
  const playbook: Playbook = {
    id: 'test',
    name: 'Test',
    triggerDomains: ['*'],
    triggerTags: [],
    triggerSeverity: ['HIGH'],
    steps: [
      { order: 1, action: 'Manual only', category: 'monitor', automated: false },
    ],
  };
  const results = executeAutomatedSteps(playbook, obs());
  assert.equal(results.length, 0);
});

// ── formatPlaybookForNotification ────────────────────────────────────────────

test('formatPlaybookForNotification includes playbook name', () => {
  const event = obs({ title: 'M6.5 earthquake near Tokyo' });
  const text = formatPlaybookForNotification(EARTHQUAKE_PLAYBOOK, event);
  assert.ok(text.includes(EARTHQUAKE_PLAYBOOK.name), `expected playbook name in: ${text}`);
});

test('formatPlaybookForNotification includes first two step actions', () => {
  const event = obs();
  const text = formatPlaybookForNotification(EARTHQUAKE_PLAYBOOK, event);
  const first = EARTHQUAKE_PLAYBOOK.steps[0]?.action ?? '';
  assert.ok(text.includes(first.substring(0, 20)), `expected first step in: ${text}`);
});

test('formatPlaybookForNotification returns compact single-line-ish string under 300 chars', () => {
  const event = obs({ title: 'Test' });
  const text = formatPlaybookForNotification(CYBER_BREACH_PLAYBOOK, event);
  assert.ok(text.length <= 300, `too long (${text.length} chars): ${text}`);
});
