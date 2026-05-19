import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ScenarioLibrary,
  type Scenario,
} from '../../src/services/intelligence/scenario-library.js';
import type { ObservationEvent } from '../../src/types/intelligence.js';

// ── Storage mock ──────────────────────────────────────────────────────

function makeStorage(): {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  store: Map<string, string>;
} {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  };
}

function makeScenario(id: string): Scenario {
  const obs: ObservationEvent = {
    id: `${id}-obs-1`,
    sourceId: 'test-source',
    domain: 'natural_disaster',
    timestamp: Date.parse('2025-01-01T00:00:00Z'),
    severity: 'HIGH',
    title: `Test event for ${id}`,
    raw: {},
    entityIds: ['entity-1'],
    tags: ['test'],
  };
  return {
    id,
    name: `Scenario ${id}`,
    description: `Test scenario ${id}`,
    domain: 'natural_disaster',
    region: 'Test Region',
    startDate: '2025-01-01',
    durationHours: 24,
    observations: [obs],
    expectedSituations: ['Test situation expected'],
    tags: ['test'],
  };
}

// ── getScenarios ──────────────────────────────────────────────────────

describe('getScenarios', () => {
  it('returns exactly 5 built-in scenarios with empty storage', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    const scenarios = lib.getScenarios();
    assert.equal(scenarios.length, 5);
  });

  it('all built-in scenarios have required fields', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    for (const s of lib.getScenarios()) {
      assert.ok(typeof s.id === 'string' && s.id.length > 0, `${s.id} id`);
      assert.ok(typeof s.name === 'string' && s.name.length > 0, `${s.id} name`);
      assert.ok(typeof s.description === 'string', `${s.id} description`);
      assert.ok(typeof s.domain === 'string' && s.domain.length > 0, `${s.id} domain`);
      assert.ok(typeof s.region === 'string', `${s.id} region`);
      assert.ok(typeof s.startDate === 'string', `${s.id} startDate`);
      assert.ok(typeof s.durationHours === 'number', `${s.id} durationHours`);
      assert.ok(Array.isArray(s.observations), `${s.id} observations`);
      assert.ok(Array.isArray(s.expectedSituations), `${s.id} expectedSituations`);
      assert.ok(Array.isArray(s.tags), `${s.id} tags`);
    }
  });

  it('all built-in scenarios have observations', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    for (const s of lib.getScenarios()) {
      assert.ok(s.observations.length > 0, `${s.id} should have at least one observation`);
    }
  });

  it('each built-in scenario has at least 3 observations', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    for (const s of lib.getScenarios()) {
      assert.ok(s.observations.length >= 3, `${s.id} should have at least 3 observations, got ${s.observations.length}`);
    }
  });
});

// ── startReplay ──────────────────────────────────────────────────────

describe('startReplay', () => {
  it('returns a replay with the correct scenarioId', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    const replay = lib.startReplay('fukushima-2011');
    assert.equal(replay.scenarioId, 'fukushima-2011');
  });

  it('returns a replay with status running', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    const replay = lib.startReplay('fukushima-2011');
    assert.equal(replay.status, 'running');
  });

  it('returns a replay with currentIndex 0', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    const replay = lib.startReplay('fukushima-2011');
    assert.equal(replay.currentIndex, 0);
  });

  it('returns a replay with empty emittedObservations', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    const replay = lib.startReplay('fukushima-2011');
    assert.deepEqual(replay.emittedObservations, []);
  });

  it('totalEvents matches the scenario observation count', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    const scenarios = lib.getScenarios();
    const fukushima = scenarios.find((s) => s.id === 'fukushima-2011')!;
    const replay = lib.startReplay('fukushima-2011');
    assert.equal(replay.totalEvents, fukushima.observations.length);
  });

  it('throws on unknown scenarioId', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    assert.throws(() => lib.startReplay('nonexistent-scenario-xyz'), /unknown scenarioId/);
  });
});

// ── tick ──────────────────────────────────────────────────────────────

describe('tick', () => {
  it('advances currentIndex on each call', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    const replay = lib.startReplay('fukushima-2011');
    lib.tick(replay.replayId);
    lib.tick(replay.replayId);
    // Check that the second tick returns a different observation from the first
    const third = lib.tick(replay.replayId);
    assert.ok(third !== null);
  });

  it('returns correct ObservationEvent in order', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    const scenarios = lib.getScenarios();
    const fukushima = scenarios.find((s) => s.id === 'fukushima-2011')!;
    const replay = lib.startReplay('fukushima-2011');
    const first = lib.tick(replay.replayId);
    assert.equal(first?.id, fukushima.observations[0]!.id);
    const second = lib.tick(replay.replayId);
    assert.equal(second?.id, fukushima.observations[1]!.id);
  });

  it('returns null when all events have been emitted', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    const replay = lib.startReplay('morocco-2023');
    const scenarios = lib.getScenarios();
    const morocco = scenarios.find((s) => s.id === 'morocco-2023')!;
    // Exhaust all events
    for (let i = 0; i < morocco.observations.length; i++) {
      lib.tick(replay.replayId);
    }
    const result = lib.tick(replay.replayId);
    assert.equal(result, null);
  });

  it('returns null when paused', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    const replay = lib.startReplay('fukushima-2011');
    lib.pauseReplay(replay.replayId);
    const result = lib.tick(replay.replayId);
    assert.equal(result, null);
  });

  it('sets status to completed after last event', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    const replay = lib.startReplay('morocco-2023');
    const scenarios = lib.getScenarios();
    const morocco = scenarios.find((s) => s.id === 'morocco-2023')!;
    for (let i = 0; i < morocco.observations.length; i++) {
      lib.tick(replay.replayId);
    }
    assert.equal(lib.getReplay(replay.replayId)!.status, 'completed');
  });

  it('emittedObservations grows with each tick', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    const replay = lib.startReplay('suez-2021');
    lib.tick(replay.replayId);
    assert.equal(lib.getReplay(replay.replayId)!.emittedObservations.length, 1);
    lib.tick(replay.replayId);
    assert.equal(lib.getReplay(replay.replayId)!.emittedObservations.length, 2);
    lib.tick(replay.replayId);
    assert.equal(lib.getReplay(replay.replayId)!.emittedObservations.length, 3);
  });

  it('returns null for unknown replayId', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    assert.equal(lib.tick('nonexistent-replay-id'), null);
  });
});

// ── pauseReplay / resumeReplay ────────────────────────────────────────

describe('pauseReplay / resumeReplay', () => {
  it('pause sets status to paused', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    const replay = lib.startReplay('fukushima-2011');
    lib.pauseReplay(replay.replayId);
    assert.equal(lib.tick(replay.replayId), null);
  });

  it('tick returns null while paused', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    const replay = lib.startReplay('fukushima-2011');
    lib.pauseReplay(replay.replayId);
    assert.equal(lib.tick(replay.replayId), null);
    assert.equal(lib.tick(replay.replayId), null);
  });

  it('resume allows tick to emit observations again', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    const replay = lib.startReplay('fukushima-2011');
    lib.pauseReplay(replay.replayId);
    assert.equal(lib.tick(replay.replayId), null);
    lib.resumeReplay(replay.replayId);
    const event = lib.tick(replay.replayId);
    assert.ok(event !== null);
  });

  it('resume on completed replay is a no-op (tick still returns null)', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    const replay = lib.startReplay('morocco-2023');
    const scenarios = lib.getScenarios();
    const morocco = scenarios.find((s) => s.id === 'morocco-2023')!;
    for (let i = 0; i < morocco.observations.length; i++) {
      lib.tick(replay.replayId);
    }
    lib.resumeReplay(replay.replayId);
    assert.equal(lib.tick(replay.replayId), null);
  });
});

// ── addScenario ──────────────────────────────────────────────────────

describe('addScenario', () => {
  it('custom scenario appears in getScenarios', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    const custom = makeScenario('my-custom-scenario');
    lib.addScenario(custom);
    const found = lib.getScenarios().find((s) => s.id === 'my-custom-scenario');
    assert.ok(found !== undefined);
  });

  it('persists custom scenario to storage', () => {
    const storage = makeStorage();
    const lib = ScenarioLibrary.createForTesting(storage);
    lib.addScenario(makeScenario('persist-test'));
    const raw = storage.store.get('wm-scenario-library');
    assert.ok(raw !== undefined, 'storage should have a value after addScenario');
    const parsed = JSON.parse(raw!) as Scenario[];
    assert.ok(Array.isArray(parsed));
    assert.ok(parsed.some((s) => s.id === 'persist-test'));
  });

  it('enforces max 50 total — drops oldest custom, never built-ins', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    // 5 built-ins already; add 46 custom = 51 total → should drop to 50
    for (let i = 0; i < 46; i++) {
      lib.addScenario(makeScenario(`overflow-${i}`));
    }
    const scenarios = lib.getScenarios();
    assert.equal(scenarios.length, 50);
    // All built-ins must be present
    const ids = new Set(scenarios.map((s) => s.id));
    assert.ok(ids.has('fukushima-2011'), 'fukushima built-in must survive cap enforcement');
    assert.ok(ids.has('covid-2020'), 'covid built-in must survive cap enforcement');
    assert.ok(ids.has('suez-2021'), 'suez built-in must survive cap enforcement');
    assert.ok(ids.has('ukraine-2022'), 'ukraine built-in must survive cap enforcement');
    assert.ok(ids.has('morocco-2023'), 'morocco built-in must survive cap enforcement');
    // The oldest custom should have been dropped (overflow-0)
    assert.ok(!ids.has('overflow-0'), 'oldest custom scenario should have been dropped');
  });
});

// ── storage ───────────────────────────────────────────────────────────

describe('storage', () => {
  it('custom scenarios survive getInstance() reconstruction from storage', () => {
    const storage = makeStorage();
    const lib1 = ScenarioLibrary.createForTesting(storage);
    lib1.addScenario(makeScenario('survives-restart'));

    const lib2 = ScenarioLibrary.createForTesting(storage);
    const found = lib2.getScenarios().find((s) => s.id === 'survives-restart');
    assert.ok(found !== undefined, 'custom scenario should survive reconstruction');
  });

  it('built-ins are always present even with empty storage', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    const scenarios = lib.getScenarios();
    assert.equal(scenarios.length, 5);
  });

  it('corrupt storage blob is ignored and built-ins still load', () => {
    const storage = makeStorage();
    storage.store.set('wm-scenario-library', 'NOT_VALID_JSON{{{');
    const lib = ScenarioLibrary.createForTesting(storage);
    assert.equal(lib.getScenarios().length, 5);
  });
});

// ── built-in scenario content ─────────────────────────────────────────

describe('built-in scenario content', () => {
  it('fukushima has domain natural_disaster', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    const s = lib.getScenarios().find((x) => x.id === 'fukushima-2011')!;
    assert.equal(s.domain, 'natural_disaster');
  });

  it('ukraine has domain geopolitical', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    const s = lib.getScenarios().find((x) => x.id === 'ukraine-2022')!;
    assert.equal(s.domain, 'geopolitical');
  });

  it('covid has domain health', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    const s = lib.getScenarios().find((x) => x.id === 'covid-2020')!;
    assert.equal(s.domain, 'health');
  });

  it('suez has domain logistics', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    const s = lib.getScenarios().find((x) => x.id === 'suez-2021')!;
    assert.equal(s.domain, 'logistics');
  });

  it('morocco has domain natural_disaster', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    const s = lib.getScenarios().find((x) => x.id === 'morocco-2023')!;
    assert.equal(s.domain, 'natural_disaster');
  });

  it('fukushima startDate is 2011-03-11', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    const s = lib.getScenarios().find((x) => x.id === 'fukushima-2011')!;
    assert.equal(s.startDate, '2011-03-11');
  });

  it('ukraine startDate is 2022-02-24', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    const s = lib.getScenarios().find((x) => x.id === 'ukraine-2022')!;
    assert.equal(s.startDate, '2022-02-24');
  });

  it('suez has region Suez Canal', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    const s = lib.getScenarios().find((x) => x.id === 'suez-2021')!;
    assert.equal(s.region, 'Suez Canal');
  });

  it('fukushima has expectedSituations mentioning nuclear', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    const s = lib.getScenarios().find((x) => x.id === 'fukushima-2011')!;
    const hasNuclear = s.expectedSituations.some((e) => e.toLowerCase().includes('nuclear'));
    assert.ok(hasNuclear, 'fukushima should have a nuclear-related expected situation');
  });
});

// ── ObservationEvent shape ────────────────────────────────────────────

describe('ObservationEvent shape', () => {
  const VALID_SEVERITIES = new Set(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

  it('all built-in observations have valid severity', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    for (const s of lib.getScenarios()) {
      for (const obs of s.observations) {
        assert.ok(
          VALID_SEVERITIES.has(obs.severity),
          `${s.id}/${obs.id} has invalid severity "${obs.severity}"`,
        );
      }
    }
  });

  it('all built-in observations have entityIds array', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    for (const s of lib.getScenarios()) {
      for (const obs of s.observations) {
        assert.ok(
          Array.isArray(obs.entityIds),
          `${s.id}/${obs.id} entityIds must be an array`,
        );
      }
    }
  });

  it('all built-in observations have tags array', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    for (const s of lib.getScenarios()) {
      for (const obs of s.observations) {
        assert.ok(
          Array.isArray(obs.tags),
          `${s.id}/${obs.id} tags must be an array`,
        );
      }
    }
  });

  it('all built-in observations have timestamp as a number', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    for (const s of lib.getScenarios()) {
      for (const obs of s.observations) {
        assert.ok(
          typeof obs.timestamp === 'number' && Number.isFinite(obs.timestamp),
          `${s.id}/${obs.id} timestamp must be a finite number`,
        );
      }
    }
  });

  it('all built-in observations have a non-empty id', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    for (const s of lib.getScenarios()) {
      for (const obs of s.observations) {
        assert.ok(
          typeof obs.id === 'string' && obs.id.length > 0,
          `${s.id} has observation with empty id`,
        );
      }
    }
  });

  it('all built-in observations have a non-empty title', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    for (const s of lib.getScenarios()) {
      for (const obs of s.observations) {
        assert.ok(
          typeof obs.title === 'string' && obs.title.length > 0,
          `${s.id}/${obs.id} title must be non-empty`,
        );
      }
    }
  });

  it('all built-in observations have a sourceId string', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    for (const s of lib.getScenarios()) {
      for (const obs of s.observations) {
        assert.ok(
          typeof obs.sourceId === 'string' && obs.sourceId.length > 0,
          `${s.id}/${obs.id} sourceId must be non-empty`,
        );
      }
    }
  });

  it('CRITICAL severity observations exist across built-in scenarios', () => {
    const lib = ScenarioLibrary.createForTesting(makeStorage());
    let criticalCount = 0;
    for (const s of lib.getScenarios()) {
      for (const obs of s.observations) {
        if (obs.severity === 'CRITICAL') criticalCount++;
      }
    }
    assert.ok(criticalCount > 0, 'should have at least one CRITICAL observation across all built-ins');
  });
});
