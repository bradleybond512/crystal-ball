import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import '../../../tests/panels/register-hook.mjs';
import { clearFetchCalls, getFetchCalls, happyWindow, POST_MOUNT_ERRORS } from '../../../tests/panels/setup-dom.mts';
import type { UnifiedAlert } from '../../services/unified-alerts.ts';

const { UnifiedAlertInboxPanel } = await import('../UnifiedAlertInboxPanel.ts');
const { unifiedAlertStore } = await import('../../services/unified-alerts.ts');

function warning(id: string): UnifiedAlert {
  return { id, source: 'nws', severity: 'high', title: 'United States storm ' + id,
    timestamp: Date.now(), body: 'Synthetic warning', relevanceScore: 0.8, pinned: false, acknowledged: false };
}

async function waitFor(check: () => boolean) {
  const end = Date.now() + 4_000;
  while (!check() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 15));
  assert.ok(check(), 'requested inbox render completed');
}

async function mount(t: TestContext, items = [warning('first'), warning('second')]) {
  const dispositions = new Map<string, { heldDuringCooldown: boolean; updatedTo?: UnifiedAlert['severity'] }>();
  const state = { items, count: 0 };
  let notify!: () => void;
  t.mock.method(unifiedAlertStore, 'subscribe', (fn: () => void) => { notify = fn; return () => {}; });
  t.mock.method(unifiedAlertStore, 'getAll', () => [...state.items]);
  t.mock.method(unifiedAlertStore, 'getUnacknowledgedCount', () => state.items.filter(v => !v.acknowledged).length);
  Object.assign(unifiedAlertStore, {
    getDisposition: (a: UnifiedAlert) => dispositions.get(a.id),
    getHeldWarningCount: () => state.count,
  });
  const errorsBefore = POST_MOUNT_ERRORS.length;
  clearFetchCalls();
  const panel = new UnifiedAlertInboxPanel();
  document.body.append(panel.getElement());
  const el = panel.getContentElement();
  t.after(() => {
    panel.destroy(); panel.getElement().remove();
    Reflect.deleteProperty(unifiedAlertStore, 'getDisposition');
    Reflect.deleteProperty(unifiedAlertStore, 'getHeldWarningCount');
    assert.deepEqual(POST_MOUNT_ERRORS.slice(errorsBefore), []);
    assert.deepEqual(getFetchCalls(), []);
  });
  await waitFor(() => !!el.querySelector('table'));
  return { el, notify, state, dispositions, panel };
}

test('held and escalated warnings keep individual rows even in an entity cluster', async t => {
  const { el, state, dispositions, notify } = await mount(t, ['first', 'second', 'third', 'fourth', 'fifth'].map(warning));
  assert.equal(el.querySelectorAll('tr[data-alert-id]').length, 1, 'ordinary related alerts stay grouped');
  dispositions.set('second', { heldDuringCooldown: true });
  dispositions.set('third', { heldDuringCooldown: false, updatedTo: 'critical' });
  state.items[2]!.severity = 'critical';
  state.count = 1;
  notify();
  await waitFor(() => !!el.querySelector('tr[data-alert-id="third"]'));
  const held = el.querySelector('tr[data-alert-id="second"]');
  const escalated = el.querySelector('tr[data-alert-id="third"]');
  assert.ok(held, 'the held warning has an individually reachable inbox row');
  assert.ok(escalated, 'the escalation has an individually reachable inbox row');
  assert.match(held.textContent ?? '', /System notification held during cooldown/);
  assert.match(escalated.textContent ?? '', /Updated to critical/);
  assert.equal(el.querySelectorAll('tr[data-alert-id]').length, 3);
  assert.match(el.textContent!, /1 warning held during cooldown this session/);
  assert.equal(el.querySelector('[role="alert"]'), null, 'passive accounting stays non-interruptive');
});

test('session count survives filters and an empty inbox; clearing the session removes it', async t => {
  const { el, state, notify } = await mount(t);
  state.count = 2;
  el.querySelector<HTMLButtonElement>('[data-filter-sev="critical"]')!.click();
  await waitFor(() => el.querySelectorAll('tr[data-alert-id]').length === 0);
  assert.match(el.textContent!, /2 warnings held during cooldown this session/);
  state.items = [];
  notify();
  await waitFor(() => !!el.querySelector('.panel-empty'));
  assert.match(el.textContent!, /2 warnings held during cooldown this session/);
  state.count = 0;
  notify();
  await waitFor(() => !el.textContent?.includes('held during cooldown'));
});

test('debounced updates restore the latest focused control and never take focus from outside', async t => {
  const { panel, el, state, notify } = await mount(t);
  el.querySelector<HTMLButtonElement>('[data-pin="first"]')!.focus();
  state.items[0]!.body = 'first update';
  notify();
  el.querySelector<HTMLButtonElement>('[data-ack="second"]')!.focus();
  await waitFor(() => el.textContent!.includes('first update'));
  assert.ok(document.activeElement === el.querySelector('[data-ack="second"]'), 'the latest focused row action survives');
  state.items[0]!.body = 'second update';
  notify();
  const outside = document.createElement('button');
  document.body.append(outside); t.after(() => outside.remove()); outside.focus();
  await waitFor(() => el.textContent!.includes('second update'));
  assert.ok(document.activeElement === outside);
  el.querySelector<HTMLButtonElement>('[data-sort="time"]')!.focus();
  state.items = []; notify();
  await waitFor(() => !!el.querySelector('.panel-empty'));
  assert.ok(document.activeElement === panel.getElement(), 'removed target falls back to its original panel');
});

test('keyboard selection stays on the same warning after reordering', async t => {
  const { panel, el, state, notify } = await mount(t);
  const button = el.querySelector<HTMLButtonElement>('[data-sort="time"]')!;
  button.click(); await waitFor(() => !!el.querySelector('[data-sort="time"].uai-active'));
  const key = (value: string) => panel.getElement().dispatchEvent(new happyWindow.KeyboardEvent('keydown', { key: value, bubbles: true }));
  key('j');
  await waitFor(() => !!el.querySelector('.uai-selected'));
  const selected = el.querySelector<HTMLElement>('.uai-selected')!.dataset.alertId!;
  const target = state.items.find(row => row.id !== selected)!;
  target.timestamp += 30_000; target.body = 'newer live report';
  notify(); await waitFor(() => el.textContent!.includes('newer live report'));
  const ack = t.mock.method(unifiedAlertStore, 'acknowledge', () => {});
  key('a');
  assert.equal(el.querySelector<HTMLElement>('.uai-selected')?.dataset.alertId, selected);
  assert.deepEqual(ack.mock.calls.map(c => c.arguments), [[selected]]);
});

test('a malformed stored source stays text and cannot inject a focusable control or row attribute', async t => {
  const item = warning('saved');
  item.source = 'bad" data-poison="1"><button data-evil="yes">X</button>' as UnifiedAlert['source'];
  const { el } = await mount(t, [item]);
  const row = el.querySelector<HTMLElement>('tr[data-alert-id="saved"]')!;
  assert.equal(el.querySelectorAll('[data-poison],[data-evil]').length, 0);
  assert.equal(row.dataset.alertSource, item.source);
});
