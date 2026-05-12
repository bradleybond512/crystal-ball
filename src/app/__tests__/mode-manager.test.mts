import assert from 'node:assert/strict';
import test from 'node:test';

// ── Minimal DOM + localStorage stubs ──────────────────────────────────────

const _store: Record<string, string> = {};
const _events: Array<{ type: string; detail: unknown }> = [];

(globalThis as unknown as Record<string, unknown>).localStorage = {
  getItem: (k: string) => _store[k] ?? null,
  setItem: (k: string, v: string) => { _store[k] = v; },
  removeItem: (k: string) => { delete _store[k]; },
};

(globalThis as unknown as Record<string, unknown>).document = {
  dispatchEvent: (e: { type: string; detail?: unknown }) => {
    _events.push({ type: e.type, detail: e.detail });
  },
};

// Helper that builds a CustomEvent-like object the stub can capture.
const OrigCustomEvent = (globalThis as unknown as Record<string, unknown>).CustomEvent as
  (new (type: string, init?: { detail?: unknown }) => { type: string; detail?: unknown }) | undefined;

if (!OrigCustomEvent) {
  (globalThis as unknown as Record<string, unknown>).CustomEvent = class CustomEvent {
    type: string;
    detail: unknown;
    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
}

// ── Import under test (after stubs are in place) ───────────────────────────

const {
  getCurrentMode,
  setMode,
  setAutoMode,
  getAutoMode,
  isAutoMode,
  initSituationalMode,
  clearManualMode,
  resetSituationalModeState,
} = await import('../mode-manager.ts');

// ── Helpers ────────────────────────────────────────────────────────────────

function reset(): void {
  resetSituationalModeState();
  for (const k of Object.keys(_store)) delete _store[k];
  _events.length = 0;
}

const NOW = 1_000_000_000_000; // fixed ms timestamp for deterministic tests

function alertLike(severity: string, ageMs = 0) {
  return { severity, timestamp: NOW - ageMs };
}

// ── Tests ─────────────────────────────────────────────────────────────────

test('initial mode is monitoring', () => {
  reset();
  assert.equal(getCurrentMode(), 'monitoring');
});

test('isAutoMode returns true initially', () => {
  reset();
  assert.ok(isAutoMode());
});

test('setMode changes current mode', () => {
  reset();
  setMode('alert');
  assert.equal(getCurrentMode(), 'alert');
});

test('setMode marks manual override (isAutoMode = false)', () => {
  reset();
  setMode('investigation');
  assert.ok(!isAutoMode());
});

test('setMode persists to localStorage', () => {
  reset();
  setMode('briefing');
  assert.equal(_store['wm-situational-mode'], 'briefing');
});

test('setMode emits wm:situational-mode-changed event', () => {
  reset();
  setMode('alert');
  const ev = _events.find((e) => e.type === 'wm:situational-mode-changed');
  assert.ok(ev, 'event not dispatched');
  const detail = ev!.detail as { mode: string; prev: string; auto: boolean };
  assert.equal(detail.mode, 'alert');
  assert.equal(detail.prev, 'monitoring');
  assert.equal(detail.auto, false);
});

test('setMode does not emit event when mode is unchanged', () => {
  reset();
  setMode('monitoring'); // same as initial
  const evCount = _events.filter((e) => e.type === 'wm:situational-mode-changed').length;
  assert.equal(evCount, 0);
});

test('setAutoMode applies mode when not in manual override', () => {
  reset();
  setAutoMode('briefing');
  assert.equal(getCurrentMode(), 'briefing');
});

test('setAutoMode is a no-op when manual override is active', () => {
  reset();
  setMode('investigation');
  setAutoMode('monitoring');
  assert.equal(getCurrentMode(), 'investigation');
});

test('clearManualMode restores auto-mode flag', () => {
  reset();
  setMode('alert');
  assert.ok(!isAutoMode());
  clearManualMode();
  assert.ok(isAutoMode());
});

test('clearManualMode removes localStorage entry', () => {
  reset();
  setMode('briefing');
  clearManualMode();
  assert.equal(_store['wm-situational-mode'], undefined);
});

// ── getAutoMode pure logic ────────────────────────────────────────────────

test('getAutoMode: CRITICAL alert → alert mode', () => {
  reset();
  const alerts = [alertLike('high'), alertLike('critical')];
  assert.equal(getAutoMode(alerts, NOW), 'alert');
});

test('getAutoMode: no alerts in last 2h → briefing', () => {
  reset();
  const twoHoursAgo = 2 * 60 * 60 * 1000 + 1;
  const alerts = [alertLike('high', twoHoursAgo)];
  assert.equal(getAutoMode(alerts, NOW), 'briefing');
});

test('getAutoMode: empty alert list → briefing', () => {
  reset();
  assert.equal(getAutoMode([], NOW), 'briefing');
});

test('getAutoMode: recent non-critical alerts → monitoring', () => {
  reset();
  const alerts = [alertLike('high', 30_000), alertLike('medium', 60_000)];
  assert.equal(getAutoMode(alerts, NOW), 'monitoring');
});

test('getAutoMode: manual investigation is preserved', () => {
  reset();
  setMode('investigation');
  // Even with critical alerts, stays investigation when manually set
  const alerts = [alertLike('critical', 100)];
  assert.equal(getAutoMode(alerts, NOW), 'investigation');
});

// ── initSituationalMode persistence ──────────────────────────────────────

test('initSituationalMode restores saved mode from localStorage', () => {
  reset();
  _store['wm-situational-mode'] = 'briefing';
  const restored = initSituationalMode();
  assert.equal(restored, 'briefing');
  assert.equal(getCurrentMode(), 'briefing');
  assert.ok(!isAutoMode(), 'restored mode should be marked manual');
});

test('initSituationalMode ignores unknown saved values', () => {
  reset();
  _store['wm-situational-mode'] = 'ghost'; // belongs to operational mode, not situational
  const restored = initSituationalMode();
  assert.equal(restored, 'monitoring');
  assert.ok(isAutoMode());
});

test('CSS data-mode attribute follows setAutoMode', () => {
  // Verify that the event payload carries the correct mode — the panel-layout
  // wires the actual DOM update; here we confirm the event detail is correct.
  reset();
  setAutoMode('briefing');
  const ev = _events.find((e) => e.type === 'wm:situational-mode-changed');
  assert.ok(ev);
  const detail = ev!.detail as { mode: string; auto: boolean };
  assert.equal(detail.mode, 'briefing');
  assert.equal(detail.auto, true);
});
