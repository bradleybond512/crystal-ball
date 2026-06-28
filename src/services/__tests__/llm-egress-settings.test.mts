import assert from 'node:assert/strict';
import test from 'node:test';

// ── Minimal browser stubs ──────────────────────────────────────────────────────

const storage = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => { storage.set(k, v); },
  removeItem: (k: string) => { storage.delete(k); },
  clear: () => { storage.clear(); },
  get length() { return storage.size; },
  key: (i: number) => [...storage.keys()][i] ?? null,
} as Storage;

const windowListeners = new Map<string, EventListener[]>();
(globalThis as unknown as { window: { addEventListener: (t: string, h: EventListener) => void; removeEventListener: (t: string, h: EventListener) => void; dispatchEvent: (e: Event) => boolean } }).window = {
  addEventListener: (type: string, handler: EventListener) => {
    const list = windowListeners.get(type) ?? [];
    list.push(handler);
    windowListeners.set(type, list);
  },
  removeEventListener: (type: string, handler: EventListener) => {
    const list = windowListeners.get(type) ?? [];
    windowListeners.set(type, list.filter(h => h !== handler));
  },
  dispatchEvent: (e: Event) => {
    for (const h of windowListeners.get(e.type) ?? []) h(e);
    return true;
  },
};

class StubCE<T = unknown> extends (class {} as unknown as typeof Event) {
  type: string;
  detail: T | undefined;
  constructor(type: string, init?: { detail?: T }) {
    super();
    this.type = type;
    this.detail = init?.detail;
  }
}
(globalThis as unknown as { CustomEvent: unknown }).CustomEvent = StubCE;

const docListeners = new Map<string, EventListener[]>();
(globalThis as unknown as { document: { dispatchEvent: (e: Event) => boolean; addEventListener: (t: string, h: EventListener) => void } }).document = {
  dispatchEvent: (e: Event) => {
    for (const h of docListeners.get(e.type) ?? []) h(e);
    return true;
  },
  addEventListener: (type: string, handler: EventListener) => {
    const list = docListeners.get(type) ?? [];
    list.push(handler);
    docListeners.set(type, list);
  },
};

// ── Imports ────────────────────────────────────────────────────────────────────

import {
  isLlmEgressDisclosed,
  setLlmEgressDisclosed,
  isLocalModelOnly,
  setLocalModelOnly,
  subscribeLlmEgressChange,
} from '../ai-flow-settings.ts';

// ── ai-flow-settings tests ─────────────────────────────────────────────────────

test('llmEgressDisclosed defaults to false', () => {
  storage.clear();
  assert.equal(isLlmEgressDisclosed(), false);
});

test('setLlmEgressDisclosed persists to localStorage', () => {
  storage.clear();
  setLlmEgressDisclosed(true);
  assert.equal(isLlmEgressDisclosed(), true);
  // Survives "reload" (fresh read from localStorage)
  assert.equal(storage.get('crystalball-llm-egress-disclosed'), 'true');
});

test('setLlmEgressDisclosed(false) clears the flag', () => {
  storage.clear();
  setLlmEgressDisclosed(true);
  setLlmEgressDisclosed(false);
  assert.equal(isLlmEgressDisclosed(), false);
  assert.equal(storage.get('crystalball-llm-egress-disclosed'), 'false');
});

test('localModelOnly defaults to false', () => {
  storage.clear();
  assert.equal(isLocalModelOnly(), false);
});

test('setLocalModelOnly persists to localStorage', () => {
  storage.clear();
  setLocalModelOnly(true);
  assert.equal(isLocalModelOnly(), true);
  assert.equal(storage.get('crystalball-local-model-only'), 'true');
});

test('settings survive simulated reload (read fresh from storage)', () => {
  storage.clear();
  setLlmEgressDisclosed(true);
  setLocalModelOnly(true);
  // Simulate a fresh module read from the same localStorage
  assert.equal(isLlmEgressDisclosed(), true);
  assert.equal(isLocalModelOnly(), true);
});

// ── llm-adapter gate tests ─────────────────────────────────────────────────────
// We test the gates indirectly by importing generateText and checking its
// return value when the cloud path would otherwise be taken.
// The cloud path requires runClaudeAgent which is not available in tests,
// but the gates fire BEFORE reserveCloudCall so we never reach it.

// Stub llm-budget so reserveCloudCall always returns false (belt-and-suspenders;
// gates should fire before we get there).
const budgetStorage = new Map<string, string>();
(globalThis as unknown as { performance: { now: () => number } }).performance = { now: () => Date.now() };

import { resetBudget, setCloudCap } from '../llm-budget.ts';

test('localModelOnly blocks cloud call before reserveCloudCall', async () => {
  storage.clear();
  resetBudget();
  setCloudCap(100);

  setLocalModelOnly(true);
  setLlmEgressDisclosed(true); // disclosed so only localModelOnly gate fires

  // Import after stubs are in place
  const { generateText } = await import('../llm-adapter.ts');

  // Stub tryLocal to always fail (return null) so cloud path is attempted
  // We can't easily stub the module internals, but we can verify the
  // returned provider is 'none' — meaning the cloud gate fired.
  const result = await generateText('test prompt', { preferCloud: true });
  assert.equal(result.provider, 'none');
  assert.equal(result.text, '');
});

test('undisclosed egress blocks cloud call and emits disclosure event', async () => {
  storage.clear();
  resetBudget();
  setCloudCap(100);

  setLocalModelOnly(false);
  setLlmEgressDisclosed(false);

  let disclosureEventFired = false;
  docListeners.set('cb:llm-egress-disclosure-needed', [() => { disclosureEventFired = true; }]);

  const { generateText } = await import('../llm-adapter.ts');
  const result = await generateText('test prompt', { preferCloud: true });

  assert.equal(result.provider, 'none');
  assert.equal(result.text, '');
  assert.equal(disclosureEventFired, true);
});

test('disclosed + not local-only allows cloud path to proceed', async () => {
  storage.clear();
  resetBudget();
  setCloudCap(0); // exhaust the budget so we get 'none' without a real cloud call

  setLocalModelOnly(false);
  setLlmEgressDisclosed(true);

  const { generateText } = await import('../llm-adapter.ts');
  // With cap=0, reserveCloudCall returns false → provider:none.
  // The key assertion is that we reach reserveCloudCall (not blocked earlier).
  // We verify by checking that the disclosure event was NOT fired.
  let disclosureEventFired = false;
  docListeners.set('cb:llm-egress-disclosure-needed', [() => { disclosureEventFired = true; }]);

  const result = await generateText('test prompt', { preferCloud: true });
  assert.equal(disclosureEventFired, false, 'disclosure event should not fire when egress is disclosed');
  assert.equal(result.provider, 'none'); // cap=0 → exhausted
});

// ── runClaudeAgent() gate tests ───────────────────────────────────────────────
// These prove that direct callers (intel-provider, auto-brief, etc.) are
// protected by the gate inside runClaudeAgent() itself — not only via
// generateText(). The gate must throw before any fetch() call.

import { runClaudeAgent } from '../claude-agent.ts';

test('runClaudeAgent throws when localModelOnly is true', async () => {
  storage.clear();
  setLocalModelOnly(true);
  setLlmEgressDisclosed(true);

  await assert.rejects(
    () => runClaudeAgent('test query'),
    (err: Error) => {
      assert.ok(err.message.includes('local-model-only'), `unexpected message: ${err.message}`);
      return true;
    },
  );
});

test('runClaudeAgent throws and fires disclosure event when egress not acknowledged', async () => {
  storage.clear();
  setLocalModelOnly(false);
  setLlmEgressDisclosed(false);

  let disclosureEventFired = false;
  docListeners.set('cb:llm-egress-disclosure-needed', [() => { disclosureEventFired = true; }]);

  await assert.rejects(
    () => runClaudeAgent('test query'),
    (err: Error) => {
      assert.ok(err.message.includes('egress not yet acknowledged'), `unexpected message: ${err.message}`);
      return true;
    },
  );
  assert.equal(disclosureEventFired, true, 'disclosure event must fire when egress is undisclosed');
});

test('runClaudeAgent bypasses gate when both conditions pass (reaches fetch)', async () => {
  storage.clear();
  setLocalModelOnly(false);
  setLlmEgressDisclosed(true);

  // Stub fetch so we can prove the gate was cleared without a real network call.
  const FETCH_SENTINEL = new Error('stub-fetch-reached');
  const origFetch = (globalThis as unknown as { fetch?: unknown }).fetch;
  (globalThis as unknown as { fetch: () => Promise<never> }).fetch = () => Promise.reject(FETCH_SENTINEL);

  try {
    await assert.rejects(
      () => runClaudeAgent('test query'),
      (err: Error) => {
        // Must be our stub sentinel — not a gate error.
        assert.equal(err, FETCH_SENTINEL, 'should have reached fetch, not a gate error');
        return true;
      },
    );
  } finally {
    if (origFetch === undefined) {
      delete (globalThis as unknown as { fetch?: unknown }).fetch;
    } else {
      (globalThis as unknown as { fetch: unknown }).fetch = origFetch;
    }
  }
});

// ── subscribeLlmEgressChange() lifecycle tests ────────────────────────────────

test('subscribeLlmEgressChange fires callback when llmEgressDisclosed changes', () => {
  storage.clear();
  windowListeners.clear();

  let callCount = 0;
  const unsub = subscribeLlmEgressChange(() => { callCount++; });

  setLlmEgressDisclosed(true);
  assert.equal(callCount, 1, 'callback should fire on setLlmEgressDisclosed');

  setLocalModelOnly(true);
  assert.equal(callCount, 2, 'callback should fire on setLocalModelOnly too');

  unsub();
});

test('subscribeLlmEgressChange unsub stops further callbacks', () => {
  storage.clear();
  windowListeners.clear();

  let callCount = 0;
  const unsub = subscribeLlmEgressChange(() => { callCount++; });

  setLlmEgressDisclosed(true);
  assert.equal(callCount, 1);

  unsub();

  setLlmEgressDisclosed(false);
  assert.equal(callCount, 1, 'callback must not fire after unsubscribe');
});
