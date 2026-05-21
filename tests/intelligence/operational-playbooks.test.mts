import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  OperationalPlaybookLibrary,
  STORAGE_KEY,
  MAX_TOTAL_PLAYBOOKS,
  type OperationalPlaybook,
  type StorageLike,
} from '../../src/services/intelligence/operational-playbooks.js';

// ── Test helpers ─────────────────────────────────────────────────────

interface MockStorage extends StorageLike {
  store: Map<string, string>;
}

function makeStorage(): MockStorage {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, v);
    },
  };
}

function makePlaybook(id: string, domain = 'custom'): OperationalPlaybook {
  return {
    id,
    domain,
    triggerCondition: `trigger for ${id}`,
    title: `Playbook ${id}`,
    severity: 'medium',
    estimatedMinutes: 30,
    lastUpdated: Date.parse('2026-05-01T00:00:00Z'),
    steps: [
      { order: 1, action: 'Do thing 1', responsible: 'analyst', timeoutMinutes: 5 },
      { order: 2, action: 'Do thing 2', responsible: 'system',  timeoutMinutes: 10 },
    ],
  };
}

const BUILT_IN_IDS = [
  'earthquake-response',
  'cyber-incident',
  'pandemic-escalation',
  'severe-weather',
  'maritime-incident',
  'civil-unrest',
  'infrastructure-failure',
  'financial-contagion',
];

// ── Catalog: built-ins ───────────────────────────────────────────────

describe('OperationalPlaybookLibrary — seeded catalog', () => {
  it('seeds exactly 8 built-in playbooks', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    assert.equal(lib.getPlaybooks().length, 8);
  });

  it('ships all expected built-in domain ids', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    const ids = lib.getPlaybooks().map((p) => p.id).sort();
    assert.deepEqual(ids, [...BUILT_IN_IDS].sort());
  });

  it('every built-in playbook has at least 1 step', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    for (const p of lib.getPlaybooks()) {
      assert.ok(p.steps.length >= 1, `${p.id} should have ≥1 step`);
    }
  });

  it('built-in steps have strictly-increasing order numbers starting at 1', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    for (const p of lib.getPlaybooks()) {
      const orders = p.steps.map((s) => s.order);
      assert.equal(orders[0], 1, `${p.id} first step.order should be 1`);
      for (let i = 1; i < orders.length; i++) {
        assert.ok(orders[i]! > orders[i - 1]!, `${p.id} step order must strictly increase`);
      }
    }
  });

  it('every built-in playbook has a non-empty title and triggerCondition', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    for (const p of lib.getPlaybooks()) {
      assert.ok(p.title.length > 0, `${p.id} title`);
      assert.ok(p.triggerCondition.length > 0, `${p.id} triggerCondition`);
    }
  });

  it('every built-in step has positive timeoutMinutes', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    for (const p of lib.getPlaybooks()) {
      for (const s of p.steps) {
        assert.ok(s.timeoutMinutes > 0, `${p.id} step ${s.order} should have timeoutMinutes > 0`);
      }
    }
  });

  it('severity is one of the 4 allowed values', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    const allowed = new Set(['low', 'medium', 'high', 'critical']);
    for (const p of lib.getPlaybooks()) {
      assert.ok(allowed.has(p.severity));
    }
  });
});

// ── Catalog: filtering + lookup ──────────────────────────────────────

describe('OperationalPlaybookLibrary — getPlaybooks(domain) filter', () => {
  it('returns only playbooks for the requested domain', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    const weather = lib.getPlaybooks('weather');
    assert.equal(weather.length, 1);
    assert.equal(weather[0]!.id, 'severe-weather');
  });

  it('returns an empty array for an unknown domain', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    assert.deepEqual(lib.getPlaybooks('does-not-exist'), []);
  });

  it('returns custom playbooks alongside built-ins when domain matches', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    lib.addPlaybook(makePlaybook('custom-weather', 'weather'));
    const weather = lib.getPlaybooks('weather');
    assert.equal(weather.length, 2);
    assert.ok(weather.some((p) => p.id === 'severe-weather'));
    assert.ok(weather.some((p) => p.id === 'custom-weather'));
  });

  it('returns deep copies — caller mutation does not leak into the catalog', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    const list1 = lib.getPlaybooks();
    list1[0]!.title = 'mutated';
    list1[0]!.steps[0]!.action = 'mutated';
    const list2 = lib.getPlaybooks();
    assert.notEqual(list2[0]!.title, 'mutated');
    assert.notEqual(list2[0]!.steps[0]!.action, 'mutated');
  });
});

describe('OperationalPlaybookLibrary — getPlaybook(id)', () => {
  it('returns the requested built-in', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    const p = lib.getPlaybook('cyber-incident');
    assert.ok(p);
    assert.equal(p!.domain, 'cyber');
  });

  it('returns null for an unknown id', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    assert.equal(lib.getPlaybook('nope'), null);
  });

  it('returns a defensive copy', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    const p = lib.getPlaybook('cyber-incident')!;
    p.title = 'mutated';
    assert.notEqual(lib.getPlaybook('cyber-incident')!.title, 'mutated');
  });
});

// ── Custom playbooks ─────────────────────────────────────────────────

describe('OperationalPlaybookLibrary — addPlaybook', () => {
  it('appends a valid custom playbook to the catalog', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    lib.addPlaybook(makePlaybook('custom-1'));
    assert.equal(lib.getPlaybooks().length, 9);
    assert.ok(lib.getPlaybook('custom-1'));
  });

  it('throws on id collision with a built-in', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    assert.throws(
      () => lib.addPlaybook(makePlaybook('earthquake-response')),
      /already exists/,
    );
  });

  it('throws on id collision with another custom entry', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    lib.addPlaybook(makePlaybook('dup'));
    assert.throws(() => lib.addPlaybook(makePlaybook('dup')), /already exists/);
  });

  it('throws on shape-invalid input (missing title)', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    const bad = makePlaybook('bad-1');
    (bad as Partial<OperationalPlaybook>).title = '';
    assert.throws(() => lib.addPlaybook(bad), /shape validation/);
  });

  it('throws on shape-invalid input (no steps)', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    const bad = makePlaybook('bad-2');
    bad.steps = [];
    assert.throws(() => lib.addPlaybook(bad), /shape validation/);
  });

  it('throws on shape-invalid input (duplicate step order)', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    const bad = makePlaybook('bad-3');
    bad.steps[1]!.order = 1;
    assert.throws(() => lib.addPlaybook(bad), /shape validation/);
  });

  it('throws on shape-invalid severity', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    const bad = makePlaybook('bad-4');
    (bad as { severity: string }).severity = 'catastrophic';
    assert.throws(() => lib.addPlaybook(bad), /shape validation/);
  });
});

// ── Persistence ──────────────────────────────────────────────────────

describe('OperationalPlaybookLibrary — persistence', () => {
  it('writes custom playbooks to storage on add', () => {
    const storage = makeStorage();
    const lib = OperationalPlaybookLibrary.createForTesting(storage);
    lib.addPlaybook(makePlaybook('persist-1'));
    const raw = storage.store.get(STORAGE_KEY);
    assert.ok(raw, 'storage should contain the custom playbook payload');
    const parsed = JSON.parse(raw!) as OperationalPlaybook[];
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]!.id, 'persist-1');
  });

  it('rehydrates custom playbooks from storage on next instance', () => {
    const storage = makeStorage();
    const first = OperationalPlaybookLibrary.createForTesting(storage);
    first.addPlaybook(makePlaybook('persist-2'));
    const second = OperationalPlaybookLibrary.createForTesting(storage);
    assert.ok(second.getPlaybook('persist-2'));
    assert.equal(second.getPlaybooks().length, 9);
  });

  it('does not throw when storage.getItem returns malformed JSON', () => {
    const storage = makeStorage();
    storage.store.set(STORAGE_KEY, '{not valid json');
    const lib = OperationalPlaybookLibrary.createForTesting(storage);
    assert.equal(lib.getPlaybooks().length, 8);
  });

  it('ignores persisted entries that fail shape validation', () => {
    const storage = makeStorage();
    storage.store.set(STORAGE_KEY, JSON.stringify([{ id: 'bad' }, makePlaybook('good')]));
    const lib = OperationalPlaybookLibrary.createForTesting(storage);
    assert.equal(lib.getPlaybooks().length, 9);
    assert.ok(lib.getPlaybook('good'));
    assert.equal(lib.getPlaybook('bad'), null);
  });

  it('drops persisted entries that collide with a built-in id (built-in wins)', () => {
    const storage = makeStorage();
    storage.store.set(STORAGE_KEY, JSON.stringify([
      { ...makePlaybook('earthquake-response'), title: 'IMPOSTOR' },
    ]));
    const lib = OperationalPlaybookLibrary.createForTesting(storage);
    assert.notEqual(lib.getPlaybook('earthquake-response')!.title, 'IMPOSTOR');
  });

  it('does not throw when storage.setItem fails', () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
    };
    const lib = OperationalPlaybookLibrary.createForTesting(storage);
    assert.doesNotThrow(() => lib.addPlaybook(makePlaybook('safe-on-error')));
    assert.ok(lib.getPlaybook('safe-on-error'));
  });
});

// ── Cap enforcement ──────────────────────────────────────────────────

describe('OperationalPlaybookLibrary — cap enforcement', () => {
  it('enforces MAX_TOTAL_PLAYBOOKS by dropping oldest custom entries (FIFO)', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    const maxCustom = MAX_TOTAL_PLAYBOOKS - 8; // 8 built-ins
    for (let i = 0; i < maxCustom + 3; i++) {
      lib.addPlaybook(makePlaybook(`cap-${i}`));
    }
    assert.equal(lib.getPlaybooks().length, MAX_TOTAL_PLAYBOOKS);
    assert.equal(lib.getPlaybook('cap-0'), null);
    assert.equal(lib.getPlaybook('cap-1'), null);
    assert.equal(lib.getPlaybook('cap-2'), null);
    assert.ok(lib.getPlaybook(`cap-${maxCustom + 2}`));
  });
});

// ── startExecution ───────────────────────────────────────────────────

describe('OperationalPlaybookLibrary — startExecution', () => {
  it('creates an active execution for a known playbook', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    const exec = lib.startExecution('cyber-incident');
    assert.equal(exec.playbookId, 'cyber-incident');
    assert.equal(exec.status, 'active');
    assert.deepEqual(exec.completedSteps, []);
    assert.ok(exec.startedAt > 0);
    assert.ok(exec.id.startsWith('exec-'));
  });

  it('throws on unknown playbook id', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    assert.throws(() => lib.startExecution('nope'), /unknown playbookId/);
  });

  it('gives each execution a unique id', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    const a = lib.startExecution('cyber-incident');
    const b = lib.startExecution('cyber-incident');
    assert.notEqual(a.id, b.id);
  });
});

// ── completeStep ─────────────────────────────────────────────────────

describe('OperationalPlaybookLibrary — completeStep', () => {
  it('records a completed step on the execution', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    const exec = lib.startExecution('severe-weather');
    const updated = lib.completeStep(exec.id, 1);
    assert.deepEqual(updated.completedSteps, [1]);
    assert.equal(updated.status, 'active');
  });

  it('keeps completedSteps sorted regardless of completion order', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    const exec = lib.startExecution('severe-weather');
    lib.completeStep(exec.id, 3);
    lib.completeStep(exec.id, 1);
    const updated = lib.completeStep(exec.id, 2);
    assert.deepEqual(updated.completedSteps, [1, 2, 3]);
  });

  it('is idempotent — completing the same step twice is a no-op', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    const exec = lib.startExecution('severe-weather');
    lib.completeStep(exec.id, 1);
    const second = lib.completeStep(exec.id, 1);
    assert.deepEqual(second.completedSteps, [1]);
  });

  it('auto-transitions execution to completed once all steps are ticked off', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    const exec = lib.startExecution('severe-weather');
    const pb = lib.getPlaybook('severe-weather')!;
    let last = exec;
    for (const step of pb.steps) {
      last = lib.completeStep(exec.id, step.order);
    }
    assert.equal(last.status, 'completed');
    assert.equal(last.completedSteps.length, pb.steps.length);
  });

  it('throws when given an unknown executionId', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    assert.throws(() => lib.completeStep('nope', 1), /unknown executionId/);
  });

  it('throws when given an unknown step order', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    const exec = lib.startExecution('severe-weather');
    assert.throws(() => lib.completeStep(exec.id, 999), /step order 999/);
  });

  it('throws when the execution is not active (already aborted)', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    const exec = lib.startExecution('severe-weather');
    lib.abortExecution(exec.id);
    assert.throws(() => lib.completeStep(exec.id, 1), /is aborted/);
  });

  it('throws when the execution is not active (already completed)', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    const exec = lib.startExecution('severe-weather');
    const pb = lib.getPlaybook('severe-weather')!;
    for (const step of pb.steps) lib.completeStep(exec.id, step.order);
    assert.throws(() => lib.completeStep(exec.id, 1), /is completed/);
  });
});

// ── abortExecution ───────────────────────────────────────────────────

describe('OperationalPlaybookLibrary — abortExecution', () => {
  it('transitions an active execution to aborted', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    const exec = lib.startExecution('cyber-incident');
    const result = lib.abortExecution(exec.id);
    assert.equal(result.status, 'aborted');
  });

  it('throws when aborting a completed execution', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    const exec = lib.startExecution('severe-weather');
    const pb = lib.getPlaybook('severe-weather')!;
    for (const step of pb.steps) lib.completeStep(exec.id, step.order);
    assert.throws(() => lib.abortExecution(exec.id), /already completed/);
  });

  it('is idempotent on an already-aborted execution', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    const exec = lib.startExecution('cyber-incident');
    lib.abortExecution(exec.id);
    const second = lib.abortExecution(exec.id);
    assert.equal(second.status, 'aborted');
  });

  it('throws on unknown executionId', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    assert.throws(() => lib.abortExecution('nope'), /unknown executionId/);
  });
});

// ── Execution lookup ─────────────────────────────────────────────────

describe('OperationalPlaybookLibrary — getExecution / listExecutions', () => {
  it('getExecution returns the live state of a started execution', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    const exec = lib.startExecution('cyber-incident');
    lib.completeStep(exec.id, 1);
    const fetched = lib.getExecution(exec.id)!;
    assert.deepEqual(fetched.completedSteps, [1]);
  });

  it('getExecution returns null for unknown ids', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    assert.equal(lib.getExecution('nope'), null);
  });

  it('getExecution returns a defensive copy', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    const exec = lib.startExecution('cyber-incident');
    const fetched = lib.getExecution(exec.id)!;
    fetched.completedSteps.push(999);
    assert.deepEqual(lib.getExecution(exec.id)!.completedSteps, []);
  });

  it('listExecutions returns every tracked execution', () => {
    const lib = OperationalPlaybookLibrary.createForTesting(makeStorage());
    lib.startExecution('cyber-incident');
    lib.startExecution('severe-weather');
    assert.equal(lib.listExecutions().length, 2);
  });
});

// ── Singleton plumbing ───────────────────────────────────────────────

describe('OperationalPlaybookLibrary — getInstance / _resetForTests', () => {
  it('getInstance returns the same instance across calls', () => {
    OperationalPlaybookLibrary._resetForTests();
    const a = OperationalPlaybookLibrary.getInstance();
    const b = OperationalPlaybookLibrary.getInstance();
    assert.equal(a, b);
    OperationalPlaybookLibrary._resetForTests();
  });

  it('_resetForTests forces getInstance to rebuild', () => {
    OperationalPlaybookLibrary._resetForTests();
    const a = OperationalPlaybookLibrary.getInstance();
    OperationalPlaybookLibrary._resetForTests();
    const b = OperationalPlaybookLibrary.getInstance();
    assert.notEqual(a, b);
    OperationalPlaybookLibrary._resetForTests();
  });
});
