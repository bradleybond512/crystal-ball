import { strict as assert } from 'node:assert';
import { describe, it, beforeEach } from 'node:test';
import {
  ModeManager,
  STORAGE_KEY,
  type AppMode,
  type ModeChangeCallback,
  type StorageLike,
} from '../../src/utils/mode-manager.ts';

class MockStorage implements StorageLike {
  readonly store = new Map<string, string>();
  getItem(key: string): string | null { return this.store.get(key) ?? null; }
  setItem(key: string, value: string): void { this.store.set(key, value); }
}

function makeManager(storage = new MockStorage()): ModeManager {
  ModeManager.resetForTests();
  return ModeManager.getInstance(storage);
}

// ── Singleton ─────────────────────────────────────────────────────────────

describe('ModeManager singleton', () => {
  beforeEach(() => { ModeManager.resetForTests(); });

  it('returns the same instance on repeated calls', () => {
    const s = new MockStorage();
    const a = ModeManager.getInstance(s);
    const b = ModeManager.getInstance(s);
    assert.equal(a, b);
  });

  it('resetForTests clears the instance so next call gets a fresh one', () => {
    const a = ModeManager.getInstance(new MockStorage());
    ModeManager.resetForTests();
    const b = ModeManager.getInstance(new MockStorage());
    assert.notEqual(a, b);
  });
});

// ── Default mode ──────────────────────────────────────────────────────────

describe('ModeManager defaults', () => {
  it('starts in normal mode when storage is empty', () => {
    const m = makeManager();
    assert.equal(m.getMode(), 'normal');
  });

  it('restores persisted mode from storage on construction', () => {
    const s = new MockStorage();
    s.setItem(STORAGE_KEY, 'crisis');
    const m = makeManager(s);
    assert.equal(m.getMode(), 'crisis');
  });

  it('falls back to normal when storage holds an unrecognised value', () => {
    const s = new MockStorage();
    s.setItem(STORAGE_KEY, 'turbo-mode');
    const m = makeManager(s);
    assert.equal(m.getMode(), 'normal');
  });

  it('falls back to normal when storage holds an empty string', () => {
    const s = new MockStorage();
    s.setItem(STORAGE_KEY, '');
    const m = makeManager(s);
    assert.equal(m.getMode(), 'normal');
  });
});

// ── setMode ───────────────────────────────────────────────────────────────

describe('ModeManager.setMode', () => {
  it('updates getMode()', () => {
    const m = makeManager();
    m.setMode('elevated');
    assert.equal(m.getMode(), 'elevated');
  });

  it('persists to storage', () => {
    const s = new MockStorage();
    const m = makeManager(s);
    m.setMode('blackout');
    assert.equal(s.getItem(STORAGE_KEY), 'blackout');
  });

  it('sets all four modes without error', () => {
    const m = makeManager();
    const modes: AppMode[] = ['normal', 'elevated', 'crisis', 'blackout'];
    for (const mode of modes) {
      m.setMode(mode);
      assert.equal(m.getMode(), mode);
    }
  });

  it('persists each mode correctly', () => {
    const s = new MockStorage();
    const m = makeManager(s);
    const modes: AppMode[] = ['elevated', 'crisis', 'blackout', 'normal'];
    for (const mode of modes) {
      m.setMode(mode);
      assert.equal(s.getItem(STORAGE_KEY), mode);
    }
  });

  it('setting same mode twice does not throw', () => {
    const m = makeManager();
    assert.doesNotThrow(() => {
      m.setMode('crisis');
      m.setMode('crisis');
    });
  });
});

// ── onModeChange / offModeChange ──────────────────────────────────────────

describe('ModeManager listeners', () => {
  it('fires callback with new mode and previous mode', () => {
    const m = makeManager();
    let received: [AppMode, AppMode] | undefined;
    const cb: ModeChangeCallback = (mode, prev) => { received = [mode, prev]; };
    m.onModeChange(cb);
    m.setMode('crisis');
    assert.deepEqual(received, ['crisis', 'normal']);
  });

  it('fires callback for each mode transition', () => {
    const m = makeManager();
    const calls: [AppMode, AppMode][] = [];
    m.onModeChange((mode, prev) => { calls.push([mode, prev]); });
    m.setMode('elevated');
    m.setMode('crisis');
    assert.deepEqual(calls, [
      ['elevated', 'normal'],
      ['crisis', 'elevated'],
    ]);
  });

  it('offModeChange stops delivery', () => {
    const m = makeManager();
    let count = 0;
    const cb: ModeChangeCallback = () => { count++; };
    m.onModeChange(cb);
    m.setMode('elevated');
    m.offModeChange(cb);
    m.setMode('crisis');
    assert.equal(count, 1);
  });

  it('adding same callback twice fires it only once per change', () => {
    const m = makeManager();
    let count = 0;
    const cb: ModeChangeCallback = () => { count++; };
    m.onModeChange(cb);
    m.onModeChange(cb);
    m.setMode('blackout');
    assert.equal(count, 1);
  });

  it('multiple distinct callbacks all fire', () => {
    const m = makeManager();
    let a = 0;
    let b = 0;
    m.onModeChange(() => { a++; });
    m.onModeChange(() => { b++; });
    m.setMode('elevated');
    assert.equal(a, 1);
    assert.equal(b, 1);
  });

  it('removing a listener that was never added does not throw', () => {
    const m = makeManager();
    const cb: ModeChangeCallback = () => { /* no-op */ };
    assert.doesNotThrow(() => { m.offModeChange(cb); });
  });

  it('callback removed during iteration does not affect delivery to others', () => {
    const m = makeManager();
    let secondFired = false;
    const second: ModeChangeCallback = () => { secondFired = true; };
    const first: ModeChangeCallback = () => { m.offModeChange(second); };
    m.onModeChange(first);
    m.onModeChange(second);
    m.setMode('crisis');
    assert.equal(secondFired, true, 'snapshot-copy means second still fires this round');
  });
});

// ── Storage persistence ───────────────────────────────────────────────────

describe('ModeManager storage integration', () => {
  it('a fresh instance reads the mode written by a previous instance', () => {
    const s = new MockStorage();
    const first = makeManager(s);
    first.setMode('blackout');
    ModeManager.resetForTests();
    const second = ModeManager.getInstance(s);
    assert.equal(second.getMode(), 'blackout');
  });

  it('writes only to wm-app-mode key, not other keys', () => {
    const s = new MockStorage();
    const m = makeManager(s);
    m.setMode('elevated');
    const keys = [...s.store.keys()];
    assert.deepEqual(keys, [STORAGE_KEY]);
  });

  it('STORAGE_KEY is the expected string', () => {
    assert.equal(STORAGE_KEY, 'wm-app-mode');
  });
});

// ── getMode consistency ───────────────────────────────────────────────────

describe('ModeManager getMode consistency', () => {
  it('getMode reflects the last setMode call in a chain', () => {
    const m = makeManager();
    m.setMode('elevated');
    m.setMode('blackout');
    m.setMode('normal');
    assert.equal(m.getMode(), 'normal');
  });

  it('callback prev matches getMode() from before the transition', () => {
    const m = makeManager();
    m.setMode('elevated');
    let prevAtCallTime: AppMode | undefined;
    m.onModeChange((_mode, prev) => { prevAtCallTime = prev; });
    m.setMode('crisis');
    assert.equal(prevAtCallTime, 'elevated');
  });
});

// ── DOM guard (no document in Node test environment) ─────────────────────

describe('ModeManager DOM guard', () => {
  it('setMode does not throw even though document is undefined in Node', () => {
    const m = makeManager();
    assert.doesNotThrow(() => {
      m.setMode('crisis');
      m.setMode('normal');
    });
  });

  it('getMode still returns correct value without a DOM', () => {
    const m = makeManager();
    m.setMode('blackout');
    assert.equal(m.getMode(), 'blackout');
  });
});
