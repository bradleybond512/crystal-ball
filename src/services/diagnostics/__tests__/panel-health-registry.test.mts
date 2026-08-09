import assert from 'node:assert/strict';
import test from 'node:test';

import { createPanelHealthRegistry } from '../panel-health-registry.ts';

const NOW = 1_745_000_000_000;

function makeRegistry(now: number = NOW) {
  let t = now;
  const reg = createPanelHealthRegistry({ now: () => t });
  return {
    reg,
    advance(ms: number) {
      t += ms;
    },
    setTime(ms: number) {
      t = ms;
    },
  };
}

// ── Registration + defaults ─────────────────────────────────────────────

test('register: assigns default thresholds and reports unknown when never observed but mounted', () => {
  const { reg } = makeRegistry();
  reg.register({ panelId: 'weather' });
  reg.recordMount('weather');
  const h = reg.get('weather');
  assert.ok(h);
  assert.equal(h?.status, 'unknown');
  assert.equal(h?.mounted, true);
  assert.equal(h?.enabled, true);
  assert.equal(h?.staleAgeMs, undefined);
});

test('register: unmounted + never observed → blind', () => {
  const { reg } = makeRegistry();
  reg.register({ panelId: 'shortage-watch' });
  const h = reg.get('shortage-watch');
  assert.equal(h?.status, 'blind');
  assert.equal(h?.mounted, false);
});

test('register: re-registering merges label and dependencies but preserves observed state', () => {
  const { reg, advance } = makeRegistry();
  reg.register({ panelId: 'flights' });
  reg.recordRender('flights');
  advance(1000);
  reg.register({ panelId: 'flights', label: 'Flights', dependencies: ['adsb-merge'] });
  const h = reg.get('flights');
  assert.equal(h?.label, 'Flights');
  assert.deepEqual(h?.dependencies, ['adsb-merge']);
  assert.equal(h?.lastRenderAt, NOW);
});

// ── Render / data / heartbeat → healthy ────────────────────────────────

test('recordRender: marks panel healthy and clears staleAge to zero', () => {
  const { reg } = makeRegistry();
  reg.register({ panelId: 'p' });
  reg.setVisible('p', true);
  reg.recordRender('p');
  const h = reg.get('p');
  assert.equal(h?.status, 'healthy');
  assert.equal(h?.lastRenderAt, NOW);
  assert.equal(h?.staleAgeMs, 0);
});

test('recordRender hadData: bumps lastDataUpdateAt', () => {
  const { reg } = makeRegistry();
  reg.register({ panelId: 'p' });
  reg.recordRender('p', { hadData: true });
  const h = reg.get('p');
  assert.equal(h?.lastDataUpdateAt, NOW);
});

test('recordHeartbeat does not mask stale data', () => {
  const { reg, advance } = makeRegistry();
  reg.register({ panelId: 'p', staleAfterMs: 60_000, failingAfterMs: 600_000 });
  reg.setVisible('p', true);
  reg.recordRender('p', { hadData: true });
  advance(60_001);
  reg.recordHeartbeat('p');
  const h = reg.get('p');
  assert.equal(h?.status, 'stale');
  assert.equal(h?.staleAgeMs, 60_001);
});

// ── Stale + failing transitions ────────────────────────────────────────

test('staleAfterMs: panel goes stale after threshold', () => {
  const { reg, advance } = makeRegistry();
  reg.register({ panelId: 'p', staleAfterMs: 60_000, failingAfterMs: 600_000 });
  reg.setVisible('p', true);
  reg.recordRender('p');
  advance(60_001);
  assert.equal(reg.get('p')?.status, 'stale');
});

test('failingAfterMs: panel goes failing after the larger threshold', () => {
  const { reg, advance } = makeRegistry();
  reg.register({ panelId: 'p', staleAfterMs: 60_000, failingAfterMs: 600_000 });
  reg.setVisible('p', true);
  reg.recordRender('p');
  advance(600_001);
  assert.equal(reg.get('p')?.status, 'failing');
});

// ── Errors ─────────────────────────────────────────────────────────────

test('recordError: failing trumps stale age', () => {
  const { reg } = makeRegistry();
  reg.register({ panelId: 'p' });
  reg.setVisible('p', true);
  reg.recordRender('p');
  reg.recordError('p', 'NWS fetch 500');
  const h = reg.get('p');
  assert.equal(h?.status, 'failing');
  assert.equal(h?.lastError, 'NWS fetch 500');
  assert.equal(h?.lastErrorAt, NOW);
});

test('recordRender after error clears the error and recovers panel', () => {
  const { reg } = makeRegistry();
  reg.register({ panelId: 'p' });
  reg.setVisible('p', true);
  reg.recordError('p', 'transient');
  reg.recordRender('p');
  const h = reg.get('p');
  assert.equal(h?.status, 'healthy');
  assert.equal(h?.lastError, undefined);
});

// ── Disabled / visibility ──────────────────────────────────────────────

test('setEnabled false: panel becomes unknown regardless of stale age', () => {
  const { reg, advance } = makeRegistry();
  reg.register({ panelId: 'p' });
  reg.setVisible('p', true);
  reg.recordRender('p');
  advance(60 * 60 * 1000);
  reg.setEnabled('p', false);
  assert.equal(reg.get('p')?.status, 'unknown');
});

test('hidden panels stay unknown instead of aging into false failures', () => {
  const { reg, advance } = makeRegistry();
  reg.register({ panelId: 'p', staleAfterMs: 60_000, failingAfterMs: 600_000 });
  reg.recordRender('p');
  reg.setVisible('p', false);
  advance(600_001);
  assert.equal(reg.get('p')?.visible, false);
  assert.equal(reg.get('p')?.status, 'unknown');
});

test('recordError preserves hidden visibility and stays suppressed', () => {
  const { reg } = makeRegistry();
  reg.register({ panelId: 'p' });
  reg.recordMount('p');
  reg.setVisible('p', false);
  reg.recordError('p', 'background fetch failed');
  assert.equal(reg.get('p')?.visible, false);
  assert.equal(reg.get('p')?.status, 'unknown');
});

test('recordRender preserves explicit hidden visibility', () => {
  const { reg } = makeRegistry();
  reg.register({ panelId: 'p' });
  reg.setVisible('p', false);
  reg.recordRender('p', { hadData: true });
  assert.equal(reg.get('p')?.visible, false);
  assert.equal(reg.get('p')?.status, 'unknown');
});

test('recordHeartbeat preserves explicit hidden visibility', () => {
  const { reg } = makeRegistry();
  reg.register({ panelId: 'p' });
  reg.recordMount('p');
  reg.setVisible('p', false);
  reg.recordHeartbeat('p');
  assert.equal(reg.get('p')?.visible, false);
  assert.equal(reg.get('p')?.status, 'unknown');
});

test('previously observed unmounted panels become unknown', () => {
  const { reg } = makeRegistry();
  reg.register({ panelId: 'p' });
  reg.setVisible('p', true);
  reg.recordRender('p');
  reg.recordUnmount('p');
  assert.equal(reg.get('p')?.mounted, false);
  assert.equal(reg.get('p')?.status, 'unknown');
});

test('late render, heartbeat, and error callbacks do not remount a destroyed panel', () => {
  const { reg, advance } = makeRegistry();
  reg.register({ panelId: 'p' });
  reg.recordMount('p');
  reg.recordRender('p');
  const renderedAt = reg.get('p')?.lastRenderAt;
  reg.recordUnmount('p');

  advance(1_000);
  reg.recordRender('p', { hadData: true });
  reg.recordHeartbeat('p');
  reg.recordError('p', 'late callback');

  const health = reg.get('p');
  assert.equal(health?.mounted, false);
  assert.equal(health?.lastRenderAt, renderedAt);
  assert.equal(health?.lastDataUpdateAt, undefined);
  assert.equal(health?.lastError, undefined);
});

// ── all / byStatus / clear ─────────────────────────────────────────────

test('all: returns sorted list, byStatus filters', () => {
  const { reg, advance } = makeRegistry();
  reg.register({ panelId: 'b', staleAfterMs: 60_000 });
  reg.register({ panelId: 'a' });
  reg.setVisible('a', true);
  reg.setVisible('b', true);
  reg.recordRender('a');
  reg.recordRender('b');
  advance(60_001);
  reg.recordRender('a'); // a stays fresh, b goes stale
  const list = reg.all();
  assert.deepEqual(
    list.map((h) => h.panelId),
    ['a', 'b'],
  );
  const stale = reg.byStatus('stale');
  assert.deepEqual(stale.map((h) => h.panelId), ['b']);
});

test('clear: empties the registry', () => {
  const { reg } = makeRegistry();
  reg.register({ panelId: 'p' });
  reg.recordRender('p');
  reg.clear();
  assert.equal(reg.get('p'), undefined);
  assert.deepEqual(reg.all(), []);
});

// ── Auto-registration via record* ──────────────────────────────────────

test('recordRender on unregistered panel auto-creates a mounted but not visible entry', () => {
  const { reg } = makeRegistry();
  reg.recordRender('untracked');
  const h = reg.get('untracked');
  assert.equal(h?.status, 'unknown');
  assert.equal(h?.mounted, true);
  assert.equal(h?.visible, false);
});
