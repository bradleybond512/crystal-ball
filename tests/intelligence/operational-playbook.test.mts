import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  OperationalPlaybookEngine,
  resetForTests,
  type Playbook,
  type PlaybookTemplate,
  type TriggerCondition,
} from '../../src/services/intelligence/operational-playbook.ts';
import type { Situation } from '../../src/services/intelligence/situation-store-v2.ts';

const NOW = 1_745_000_000_000;

function makeSituation(overrides: Partial<Situation> = {}): Situation {
  return {
    id: 'sit-1',
    name: 'Test Situation',
    domain: 'earthquake',
    relatedDomains: [],
    severity: 'high',
    status: 'active',
    summary: '',
    observations: [],
    edges: [],
    entityIds: [],
    confidence: 0.7,
    startedAt: new Date(NOW),
    updatedAt: new Date(NOW),
    tags: [],
    ...overrides,
  };
}

function makeTemplate(overrides: Partial<PlaybookTemplate> = {}): PlaybookTemplate {
  return {
    id: 'tpl-test',
    name: 'Test Template',
    domain: 'earthquake',
    severity: 'high',
    triggerConditions: [
      { field: 'domain', operator: 'eq', value: 'earthquake' },
      { field: 'severity', operator: 'gte', value: 'high' },
    ],
    stepBlueprints: [
      { order: 1, action: 'Verify epicenter', responsible: 'analyst', estimatedMinutes: 5 },
      { order: 2, action: 'Notify oncall', responsible: 'system', estimatedMinutes: 1 },
      { order: 3, action: 'Coordinate with USGS', responsible: 'external', estimatedMinutes: 30 },
    ],
    ...overrides,
  };
}

// ── evaluate ─────────────────────────────────────────────────────────

describe('OperationalPlaybookEngine.evaluate — matching', () => {
  beforeEach(() => { resetForTests(); });

  it('returns a Playbook when all trigger conditions match', () => {
    const e = new OperationalPlaybookEngine({ now: () => NOW, templates: [makeTemplate()] });
    const pb = e.evaluate(makeSituation());
    assert.ok(pb);
    assert.equal(pb.situationId, 'sit-1');
    assert.equal(pb.status, 'active');
    assert.equal(pb.steps.length, 3);
    assert.equal(pb.activatedAt, NOW);
  });

  it('returns null when no template matches', () => {
    const e = new OperationalPlaybookEngine({
      now: () => NOW,
      templates: [makeTemplate({ triggerConditions: [{ field: 'domain', operator: 'eq', value: 'cyber' }] })],
    });
    const pb = e.evaluate(makeSituation({ domain: 'earthquake' }));
    assert.equal(pb, null);
  });

  it('returns null when a situation already has an active playbook', () => {
    const e = new OperationalPlaybookEngine({ now: () => NOW, templates: [makeTemplate()] });
    const first = e.evaluate(makeSituation());
    assert.ok(first);
    const second = e.evaluate(makeSituation());
    assert.equal(second, null);
  });

  it('matches domain via "eq" operator', () => {
    const e = new OperationalPlaybookEngine({
      now: () => NOW,
      templates: [makeTemplate({ triggerConditions: [{ field: 'domain', operator: 'eq', value: 'maritime' }] })],
    });
    assert.ok(e.evaluate(makeSituation({ id: 'a', domain: 'maritime' })));
  });

  it('does not match when domain differs under "eq" operator', () => {
    const e = new OperationalPlaybookEngine({
      now: () => NOW,
      templates: [makeTemplate({ triggerConditions: [{ field: 'domain', operator: 'eq', value: 'maritime' }] })],
    });
    assert.equal(e.evaluate(makeSituation({ id: 'a', domain: 'cyber' })), null);
  });

  it('matches severity via "gte" operator (high >= high)', () => {
    const e = new OperationalPlaybookEngine({
      now: () => NOW,
      templates: [makeTemplate({ triggerConditions: [{ field: 'severity', operator: 'gte', value: 'high' }] })],
    });
    assert.ok(e.evaluate(makeSituation({ id: 'a', severity: 'high' })));
    assert.ok(e.evaluate(makeSituation({ id: 'b', severity: 'critical' })));
    assert.equal(e.evaluate(makeSituation({ id: 'c', severity: 'medium' })), null);
  });

  it('matches severity via "lte" operator', () => {
    const e = new OperationalPlaybookEngine({
      now: () => NOW,
      templates: [makeTemplate({ triggerConditions: [{ field: 'severity', operator: 'lte', value: 'medium' }] })],
    });
    assert.ok(e.evaluate(makeSituation({ id: 'a', severity: 'low' })));
    assert.equal(e.evaluate(makeSituation({ id: 'b', severity: 'critical' })), null);
  });

  it('matches correlationCount via "gte" operator', () => {
    const e = new OperationalPlaybookEngine({
      now: () => NOW,
      templates: [makeTemplate({ triggerConditions: [{ field: 'correlationCount', operator: 'gte', value: 2 }] })],
    });
    const sit = makeSituation({
      id: 'multi',
      edges: [
        { type: 'caused_by', sourceEventId: 'a', targetEventId: 'b', confidence: 0.8 },
        { type: 'confirms',  sourceEventId: 'c', targetEventId: 'b', confidence: 0.7 },
      ],
    });
    assert.ok(e.evaluate(sit));
    assert.equal(e.evaluate(makeSituation({ id: 'single' })), null);
  });

  it('matches entityType via "contains" operator (entityIds includes the value)', () => {
    const e = new OperationalPlaybookEngine({
      now: () => NOW,
      templates: [makeTemplate({ triggerConditions: [{ field: 'entityType', operator: 'contains', value: 'IRGCN' }] })],
    });
    assert.ok(e.evaluate(makeSituation({ id: 'a', entityIds: ['IRGCN-vessel-001'] })));
    assert.equal(e.evaluate(makeSituation({ id: 'b', entityIds: ['CMA-CGM-001'] })), null);
  });

  it('every step has order, action, responsible, estimatedMinutes, status=pending', () => {
    const e = new OperationalPlaybookEngine({ now: () => NOW, templates: [makeTemplate()] });
    const pb = e.evaluate(makeSituation())!;
    for (const step of pb.steps) {
      assert.ok(step.id.length > 0);
      assert.ok(step.order > 0);
      assert.ok(step.action.length > 0);
      assert.ok(['analyst', 'system', 'external'].includes(step.responsible));
      assert.equal(step.status, 'pending');
    }
  });

  it('steps are ordered ascending', () => {
    const e = new OperationalPlaybookEngine({ now: () => NOW, templates: [makeTemplate()] });
    const pb = e.evaluate(makeSituation())!;
    for (let i = 1; i < pb.steps.length; i++) {
      assert.ok(pb.steps[i].order > pb.steps[i - 1].order);
    }
  });
});

// ── advanceStep / skipStep ───────────────────────────────────────────

describe('OperationalPlaybookEngine.advanceStep', () => {
  beforeEach(() => { resetForTests(); });

  it('marks step complete and sets completedAt', () => {
    const e = new OperationalPlaybookEngine({ now: () => NOW, templates: [makeTemplate()] });
    const pb = e.evaluate(makeSituation())!;
    e.advanceStep(pb.id, pb.steps[0].id);
    const after = e.getActive().find((p) => p.id === pb.id)!;
    assert.equal(after.steps[0].status, 'complete');
    assert.equal(after.steps[0].completedAt, NOW);
  });

  it('persists optional notes', () => {
    const e = new OperationalPlaybookEngine({ now: () => NOW, templates: [makeTemplate()] });
    const pb = e.evaluate(makeSituation())!;
    e.advanceStep(pb.id, pb.steps[0].id, 'verified at M6.5');
    const after = e.getActive().find((p) => p.id === pb.id)!;
    assert.equal(after.steps[0].notes, 'verified at M6.5');
  });

  it('does nothing for unknown playbook id', () => {
    const e = new OperationalPlaybookEngine({ now: () => NOW, templates: [makeTemplate()] });
    const pb = e.evaluate(makeSituation())!;
    e.advanceStep('not-a-real-id', pb.steps[0].id);
    const after = e.getActive().find((p) => p.id === pb.id)!;
    assert.equal(after.steps[0].status, 'pending');
  });

  it('completes the playbook when the last step is advanced', () => {
    const e = new OperationalPlaybookEngine({ now: () => NOW, templates: [makeTemplate()] });
    const pb = e.evaluate(makeSituation())!;
    for (const step of pb.steps) e.advanceStep(pb.id, step.id);
    assert.equal(e.getActive().length, 0);
    assert.equal(e.getCompleted().length, 1);
    assert.equal(e.getCompleted()[0]?.status, 'complete');
  });

  it('completing all-skipped also marks playbook complete', () => {
    const e = new OperationalPlaybookEngine({ now: () => NOW, templates: [makeTemplate()] });
    const pb = e.evaluate(makeSituation())!;
    for (const step of pb.steps) e.skipStep(pb.id, step.id, 'not applicable');
    assert.equal(e.getCompleted().length, 1);
  });
});

describe('OperationalPlaybookEngine.skipStep', () => {
  beforeEach(() => { resetForTests(); });

  it('marks step skipped with reason in notes', () => {
    const e = new OperationalPlaybookEngine({ now: () => NOW, templates: [makeTemplate()] });
    const pb = e.evaluate(makeSituation())!;
    e.skipStep(pb.id, pb.steps[0].id, 'not applicable in this case');
    const after = e.getActive().find((p) => p.id === pb.id)!;
    assert.equal(after.steps[0].status, 'skipped');
    assert.match(after.steps[0].notes ?? '', /not applicable/);
  });
});

// ── abandonPlaybook ──────────────────────────────────────────────────

describe('OperationalPlaybookEngine.abandonPlaybook', () => {
  beforeEach(() => { resetForTests(); });

  it('moves playbook to abandoned status and out of active list', () => {
    const e = new OperationalPlaybookEngine({ now: () => NOW, templates: [makeTemplate()] });
    const pb = e.evaluate(makeSituation())!;
    e.abandonPlaybook(pb.id, 'situation deescalated');
    assert.equal(e.getActive().length, 0);
    const all = e.getAll();
    const found = all.find((p) => p.id === pb.id)!;
    assert.equal(found.status, 'abandoned');
  });

  it('re-evaluating the same situation after abandonment is allowed', () => {
    const e = new OperationalPlaybookEngine({ now: () => NOW, templates: [makeTemplate()] });
    const first = e.evaluate(makeSituation())!;
    e.abandonPlaybook(first.id, 'reset');
    const second = e.evaluate(makeSituation());
    assert.ok(second, 'should allow new playbook after abandonment');
    assert.notEqual(second.id, first.id);
  });
});

// ── getActive / getCompleted / stats ─────────────────────────────────

describe('OperationalPlaybookEngine — accessors', () => {
  beforeEach(() => { resetForTests(); });

  it('getActive filters to status=active', () => {
    const e = new OperationalPlaybookEngine({ now: () => NOW, templates: [makeTemplate()] });
    const a = e.evaluate(makeSituation({ id: 'a' }))!;
    const b = e.evaluate(makeSituation({ id: 'b' }))!;
    for (const step of b.steps) e.advanceStep(b.id, step.id);
    const active = e.getActive();
    assert.equal(active.length, 1);
    assert.equal(active[0]?.id, a.id);
  });

  it('getCompleted filters to status=complete', () => {
    const e = new OperationalPlaybookEngine({ now: () => NOW, templates: [makeTemplate()] });
    const a = e.evaluate(makeSituation({ id: 'a' }))!;
    for (const step of a.steps) e.advanceStep(a.id, step.id);
    e.evaluate(makeSituation({ id: 'b' }));
    const completed = e.getCompleted();
    assert.equal(completed.length, 1);
    assert.equal(completed[0]?.id, a.id);
  });

  it('stats includes totalActivated and totalCompleted counts', () => {
    const e = new OperationalPlaybookEngine({ now: () => NOW, templates: [makeTemplate()] });
    const a = e.evaluate(makeSituation({ id: 'a' }))!;
    for (const step of a.steps) e.advanceStep(a.id, step.id);
    e.evaluate(makeSituation({ id: 'b' }));
    const s = e.stats();
    assert.equal(s.totalActivated, 2);
    assert.equal(s.totalCompleted, 1);
  });

  it('stats avgCompletionMinutes computed across completed playbooks', () => {
    let t = NOW;
    const clock = () => t;
    const e = new OperationalPlaybookEngine({ now: clock, templates: [makeTemplate()] });
    const pb = e.evaluate(makeSituation({ id: 'a' }))!;
    t = NOW + 10 * 60_000;
    for (const step of pb.steps) e.advanceStep(pb.id, step.id);
    const s = e.stats();
    assert.ok(Math.abs(s.avgCompletionMinutes - 10) < 0.01);
  });

  it('stats stepCompletionRate = completed steps / total steps across all playbooks', () => {
    const e = new OperationalPlaybookEngine({ now: () => NOW, templates: [makeTemplate()] });
    const pb = e.evaluate(makeSituation())!;
    e.advanceStep(pb.id, pb.steps[0].id);
    // 1 of 3 → ~0.33
    const s = e.stats();
    assert.ok(Math.abs(s.stepCompletionRate - 1 / 3) < 0.01);
  });
});

// ── Built-in templates ───────────────────────────────────────────────

describe('OperationalPlaybookEngine — built-in templates', () => {
  beforeEach(() => { resetForTests(); });

  it('ships 6 built-in templates', () => {
    const e = new OperationalPlaybookEngine({ now: () => NOW });
    const templates = e.getTemplates();
    assert.equal(templates.length, 6);
  });

  it('templates cover earthquake / biosurv / maritime / aviation / cyber / severe-weather domains', () => {
    const e = new OperationalPlaybookEngine({ now: () => NOW });
    const domains = new Set(e.getTemplates().map((t) => t.domain));
    for (const expected of ['earthquake', 'biosurveillance', 'maritime', 'aviation', 'cyber', 'weather']) {
      assert.ok(domains.has(expected), `missing template for domain "${expected}"`);
    }
  });

  it('every built-in template has at least 3 steps', () => {
    const e = new OperationalPlaybookEngine({ now: () => NOW });
    for (const t of e.getTemplates()) assert.ok(t.stepBlueprints.length >= 3, `${t.id} has too few steps`);
  });

  it('a high-severity earthquake situation activates the earthquake-response template', () => {
    const e = new OperationalPlaybookEngine({ now: () => NOW });
    const pb = e.evaluate(makeSituation({ domain: 'earthquake', severity: 'critical' }));
    assert.ok(pb);
    assert.match(pb.name, /earthquake/i);
  });

  it('a cyber situation does not match the maritime template', () => {
    const e = new OperationalPlaybookEngine({ now: () => NOW });
    const pb = e.evaluate(makeSituation({ id: 'cyber-only', domain: 'cyber', severity: 'high' }));
    if (pb) {
      assert.notEqual(pb.domain, 'maritime');
      assert.equal(pb.domain, 'cyber');
    }
  });
});

// ── Subscribe ────────────────────────────────────────────────────────

describe('OperationalPlaybookEngine.subscribe', () => {
  beforeEach(() => { resetForTests(); });

  it('subscribe fires on evaluate when a playbook is activated', () => {
    const e = new OperationalPlaybookEngine({ now: () => NOW, templates: [makeTemplate()] });
    let calls = 0;
    let lastPlaybook: Playbook | null = null;
    e.subscribe((pb) => { calls++; lastPlaybook = pb; });
    e.evaluate(makeSituation());
    assert.equal(calls, 1);
    assert.equal(lastPlaybook?.situationId, 'sit-1');
  });

  it('subscribe does NOT fire when evaluate returns null', () => {
    const e = new OperationalPlaybookEngine({ now: () => NOW, templates: [makeTemplate()] });
    let calls = 0;
    e.subscribe(() => { calls++; });
    e.evaluate(makeSituation({ domain: 'aviation' }));
    assert.equal(calls, 0);
  });

  it('subscribe fires on advanceStep and abandonPlaybook', () => {
    const e = new OperationalPlaybookEngine({ now: () => NOW, templates: [makeTemplate()] });
    const pb = e.evaluate(makeSituation())!;
    let calls = 0;
    e.subscribe(() => { calls++; });
    e.advanceStep(pb.id, pb.steps[0].id);
    e.abandonPlaybook(pb.id, 'reset');
    assert.equal(calls, 2);
  });

  it('unsubscribe stops further callbacks', () => {
    const e = new OperationalPlaybookEngine({ now: () => NOW, templates: [makeTemplate()] });
    let calls = 0;
    const cb = () => { calls++; };
    e.subscribe(cb);
    e.evaluate(makeSituation({ id: 'a' }));
    e.unsubscribe(cb);
    e.evaluate(makeSituation({ id: 'b' }));
    assert.equal(calls, 1);
  });
});

// ── Persistence ──────────────────────────────────────────────────────

describe('OperationalPlaybookEngine — persistence', () => {
  beforeEach(() => { resetForTests(); });

  it('persists to and restores from a storage seam', () => {
    const fakeStorage: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => fakeStorage[k] ?? null,
      setItem: (k: string, v: string) => { fakeStorage[k] = v; },
    };
    const a = new OperationalPlaybookEngine({ now: () => NOW, storage, templates: [makeTemplate()] });
    a.evaluate(makeSituation());
    const b = new OperationalPlaybookEngine({ now: () => NOW, storage, templates: [makeTemplate()] });
    assert.equal(b.getActive().length, 1);
  });

  it('ring buffer caps at supplied capacity', () => {
    const e = new OperationalPlaybookEngine({
      now: () => NOW, capacity: 3,
      templates: [makeTemplate({ triggerConditions: [] satisfies TriggerCondition[] })],
    });
    for (let i = 0; i < 5; i++) {
      const pb = e.evaluate(makeSituation({ id: `s-${i}` }));
      if (pb) for (const step of pb.steps) e.advanceStep(pb.id, step.id);
    }
    assert.ok(e.getAll().length <= 3);
  });

  it('corrupted storage falls back to empty', () => {
    const storage = { getItem: () => '{not-json', setItem: () => {} };
    const e = new OperationalPlaybookEngine({ now: () => NOW, storage });
    assert.equal(e.getActive().length, 0);
  });
});
