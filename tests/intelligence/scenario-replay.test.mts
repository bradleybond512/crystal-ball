import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  __TEST_HOOKS__,
  replayScenario,
  runScenario,
  validateReplay,
  type CreatedSituation,
  type ReplayPipeline,
  type ScenarioFixture,
} from '../../src/services/intelligence/scenario-replay.ts';
import {
  BUILT_IN_SCENARIOS,
  CYBER_INCIDENT,
  EARTHQUAKE_TSUNAMI,
  PORT_CLOSURE_SHORTAGE,
  TORNADO_NEAR_HOME,
  WILDFIRE_AIR_QUALITY,
} from '../../src/services/intelligence/scenarios/index.ts';
import type {
  ObservationEvent,
  Situation,
  SituationSeverity,
} from '../../src/types/intelligence.ts';

// ── Test pipeline ──────────────────────────────────────────────────────
// A pure in-memory pipeline that mirrors the real one's behaviour without
// touching the module-level state in observation-store / situation-store.
// Auto-creates a Situation for HIGH/CRITICAL events; updates an existing
// matching one (same domain) otherwise.

function severityToSitSeverity(s: ObservationEvent['severity']): SituationSeverity {
  switch (s) {
    case 'CRITICAL': return 'critical';
    case 'HIGH': return 'high';
    case 'MEDIUM': return 'moderate';
    case 'LOW': return 'low';
    case 'INFO': return 'info';
  }
}

function buildTestPipeline(): { pipeline: ReplayPipeline; ingested: ObservationEvent[] } {
  const ingested: ObservationEvent[] = [];
  const situations: Situation[] = [];
  return {
    ingested,
    pipeline: {
      resetStores: () => {
        ingested.length = 0;
        situations.length = 0;
      },
      ingest: (e) => { ingested.push(e); },
      detect: (event, nowMs) => {
        const existing = situations.find((s) => s.domain === event.domain);
        if (existing) {
          existing.observationIds.push(event.id);
          existing.updatedAt = nowMs;
          return existing;
        }
        if (event.severity !== 'HIGH' && event.severity !== 'CRITICAL') return null;
        const situation: Situation = {
          id: `sit-${event.id}`,
          name: event.title,
          status: 'active',
          severity: severityToSitSeverity(event.severity),
          domain: event.domain,
          startedAt: event.timestamp,
          updatedAt: event.timestamp,
          observationIds: [event.id],
          correlationIds: [],
          summary: event.title,
          tags: event.tags,
          confidence: 0.6,
        };
        situations.push(situation);
        return situation;
      },
      getSituations: () => [...situations],
    },
  };
}

function fixedNow(start = 1_700_000_000_000): () => number {
  let n = start;
  return () => {
    const v = n;
    n += 1;
    return v;
  };
}

// ── Engine-level tests ─────────────────────────────────────────────────

describe('replayScenario / engine', () => {
  it('orders events chronologically by offsetMs even when fixture lists them out of order', () => {
    const { pipeline, ingested } = buildTestPipeline();
    const fixture: ScenarioFixture = {
      id: 'order-test',
      name: 'Order test',
      description: '',
      startTime: 0,
      events: [
        { id: 'b', sourceId: 's', domain: 'd', offsetMs: 100, severity: 'LOW', title: 'second' },
        { id: 'a', sourceId: 's', domain: 'd', offsetMs: 0, severity: 'LOW', title: 'first' },
      ],
      expectedAlerts: [],
      expectedSituations: [],
    };
    replayScenario(fixture, { pipeline, nowMs: fixedNow() });
    assert.deepEqual(ingested.map((e) => e.id), ['a', 'b']);
    assert.deepEqual(ingested.map((e) => e.timestamp), [0, 100]);
  });

  it('returns ingestedEventCount equal to the fixture event count', () => {
    const { pipeline } = buildTestPipeline();
    const result = replayScenario(TORNADO_NEAR_HOME, { pipeline, nowMs: fixedNow() });
    assert.equal(result.ingestedEventCount, TORNADO_NEAR_HOME.events.length);
  });

  it('treats only HIGH/CRITICAL events as alerts', () => {
    const { pipeline } = buildTestPipeline();
    const result = replayScenario(TORNADO_NEAR_HOME, { pipeline, nowMs: fixedNow() });
    // Fixture has 1 MEDIUM + 1 HIGH + 1 CRITICAL; only the latter two fire.
    assert.equal(result.alertsFired.length, 2);
    assert.ok(result.alertsFired.every((a) => a.severity === 'HIGH' || a.severity === 'CRITICAL'));
  });

  it('resets stores before each replay (idempotent)', () => {
    const { pipeline, ingested } = buildTestPipeline();
    replayScenario(TORNADO_NEAR_HOME, { pipeline, nowMs: fixedNow() });
    const firstSize = ingested.length;
    replayScenario(TORNADO_NEAR_HOME, { pipeline, nowMs: fixedNow() });
    // Same fixture, same observed count — not doubled.
    assert.equal(ingested.length, firstSize);
  });

  it('records elapsedMs from the injected clock', () => {
    const { pipeline } = buildTestPipeline();
    const result = replayScenario(TORNADO_NEAR_HOME, {
      pipeline,
      nowMs: fixedNow(),
    });
    assert.ok(result.elapsedMs >= 0);
  });

  it('handles an empty fixture without crashing', () => {
    const { pipeline } = buildTestPipeline();
    const empty: ScenarioFixture = {
      id: 'empty',
      name: 'Empty',
      description: '',
      startTime: 0,
      events: [],
      expectedAlerts: [],
      expectedSituations: [],
    };
    const result = replayScenario(empty, { pipeline, nowMs: fixedNow() });
    assert.deepEqual(result.alertsFired, []);
    assert.deepEqual(result.situationsCreated, []);
    assert.equal(result.ingestedEventCount, 0);
  });

  it('computes absolute timestamps from startTime + offsetMs', () => {
    const start = Date.parse('2026-01-01T00:00:00Z');
    const { pipeline, ingested } = buildTestPipeline();
    const fixture: ScenarioFixture = {
      id: 't',
      name: 't',
      description: '',
      startTime: start,
      events: [
        { id: 'x', sourceId: 's', domain: 'weather', offsetMs: 5 * 60_000, severity: 'CRITICAL', title: 'x' },
      ],
      expectedAlerts: [],
      expectedSituations: [],
    };
    replayScenario(fixture, { pipeline, nowMs: fixedNow() });
    assert.equal(ingested[0]!.timestamp, start + 5 * 60_000);
  });

  it('passes optional location through to the ingest pipeline', () => {
    const { pipeline, ingested } = buildTestPipeline();
    replayScenario(TORNADO_NEAR_HOME, { pipeline, nowMs: fixedNow() });
    const tornadoEvent = ingested.find((e) => e.id === 'nws-tor-warn-laporte');
    assert.ok(tornadoEvent?.location);
    assert.ok(tornadoEvent.location.lat > 41 && tornadoEvent.location.lat < 42);
  });
});

// ── Severity helpers ───────────────────────────────────────────────────

describe('severityRank / isAlertSeverity helpers', () => {
  it('orders severities low → critical', () => {
    const { severityRank } = __TEST_HOOKS__;
    assert.ok(severityRank('INFO') < severityRank('LOW'));
    assert.ok(severityRank('LOW') < severityRank('MEDIUM'));
    assert.ok(severityRank('MEDIUM') < severityRank('HIGH'));
    assert.ok(severityRank('HIGH') < severityRank('CRITICAL'));
  });
  it('flags HIGH and CRITICAL as alerts; lower as non-alerts', () => {
    const { isAlertSeverity } = __TEST_HOOKS__;
    assert.equal(isAlertSeverity('INFO'), false);
    assert.equal(isAlertSeverity('LOW'), false);
    assert.equal(isAlertSeverity('MEDIUM'), false);
    assert.equal(isAlertSeverity('HIGH'), true);
    assert.equal(isAlertSeverity('CRITICAL'), true);
  });
});

// ── validateReplay ─────────────────────────────────────────────────────

describe('validateReplay', () => {
  it('returns ok=true with empty diffs when all expectations are met', () => {
    const { pipeline } = buildTestPipeline();
    const result = replayScenario(TORNADO_NEAR_HOME, { pipeline, nowMs: fixedNow() });
    const validation = validateReplay(result, TORNADO_NEAR_HOME);
    assert.equal(validation.ok, true);
    assert.deepEqual(validation.diffs, []);
    assert.match(validation.summary, /Tornado near saved place/);
  });

  it('flags missing alerts as missed-alert diffs', () => {
    const { pipeline } = buildTestPipeline();
    const inflated: ScenarioFixture = {
      ...TORNADO_NEAR_HOME,
      expectedAlerts: [
        ...TORNADO_NEAR_HOME.expectedAlerts,
        { domain: 'cyber', severity: 'CRITICAL', titleContains: 'this will never fire' },
      ],
    };
    const result = replayScenario(inflated, { pipeline, nowMs: fixedNow() });
    const validation = validateReplay(result, inflated);
    assert.equal(validation.ok, false);
    assert.equal(validation.diffs.length, 1);
    assert.equal(validation.diffs[0]!.kind, 'missed-alert');
  });

  it('flags missing situations as missed-situation diffs', () => {
    const { pipeline } = buildTestPipeline();
    const inflated: ScenarioFixture = {
      ...TORNADO_NEAR_HOME,
      expectedSituations: [
        ...TORNADO_NEAR_HOME.expectedSituations,
        { domain: 'maritime', titleContains: 'tsunami' },
      ],
    };
    const result = replayScenario(inflated, { pipeline, nowMs: fixedNow() });
    const validation = validateReplay(result, inflated);
    assert.equal(validation.ok, false);
    assert.deepEqual(validation.diffs.map((d) => d.kind), ['missed-situation']);
  });

  it('matches expected titles case-insensitively', () => {
    const { pipeline } = buildTestPipeline();
    const fixture: ScenarioFixture = {
      ...TORNADO_NEAR_HOME,
      expectedAlerts: [
        { domain: 'weather', severity: 'CRITICAL', titleContains: 'TORNADO WARNING' },
      ],
    };
    const result = replayScenario(fixture, { pipeline, nowMs: fixedNow() });
    assert.equal(result.missedAlerts.length, 0);
  });

  it('does not match expected alerts whose severity does not align', () => {
    const { pipeline } = buildTestPipeline();
    const fixture: ScenarioFixture = {
      ...TORNADO_NEAR_HOME,
      expectedAlerts: [
        // The tornado fires CRITICAL — expecting HIGH should NOT match.
        { domain: 'weather', severity: 'HIGH', titleContains: 'Tornado Warning' },
      ],
    };
    const result = replayScenario(fixture, { pipeline, nowMs: fixedNow() });
    assert.equal(result.missedAlerts.length, 1);
  });
});

// ── Per-scenario tests ─────────────────────────────────────────────────

function expectAllExpectationsMet(fixture: ScenarioFixture): void {
  const { pipeline } = buildTestPipeline();
  const { result, validation } = runScenario(fixture, { pipeline, nowMs: fixedNow() });
  // Useful debugging info on failure:
  if (!validation.ok) {
    console.log('Replay diff', validation.diffs, 'fired:', result.alertsFired);
  }
  assert.equal(validation.ok, true, `${fixture.id} expected to pass replay`);
  assert.ok(result.alertsFired.length > 0, `${fixture.id} should fire at least one alert`);
}

describe('built-in scenarios — alerts fire as expected', () => {
  it('tornado-near-home', () => expectAllExpectationsMet(TORNADO_NEAR_HOME));
  it('earthquake-tsunami', () => expectAllExpectationsMet(EARTHQUAKE_TSUNAMI));
  it('wildfire-air-quality', () => expectAllExpectationsMet(WILDFIRE_AIR_QUALITY));
  it('cyber-incident', () => expectAllExpectationsMet(CYBER_INCIDENT));
  it('port-closure-shortage', () => expectAllExpectationsMet(PORT_CLOSURE_SHORTAGE));
});

describe('built-in scenarios — situations land in the right domain', () => {
  function domainsCreated(fixture: ScenarioFixture): Set<string> {
    const { pipeline } = buildTestPipeline();
    const result = replayScenario(fixture, { pipeline, nowMs: fixedNow() });
    return new Set(result.situationsCreated.map((s: CreatedSituation) => s.domain));
  }
  it('tornado-near-home seeds a weather situation', () => {
    assert.ok(domainsCreated(TORNADO_NEAR_HOME).has('weather'));
  });
  it('earthquake-tsunami seeds both earthquake AND weather situations', () => {
    const domains = domainsCreated(EARTHQUAKE_TSUNAMI);
    assert.ok(domains.has('earthquake'));
    assert.ok(domains.has('weather'));
  });
  it('wildfire-air-quality seeds wildfire + air-quality + weather situations', () => {
    const domains = domainsCreated(WILDFIRE_AIR_QUALITY);
    assert.ok(domains.has('wildfire'));
    assert.ok(domains.has('air-quality'));
    assert.ok(domains.has('weather'));
  });
  it('cyber-incident seeds cyber + infrastructure situations', () => {
    const domains = domainsCreated(CYBER_INCIDENT);
    assert.ok(domains.has('cyber'));
    assert.ok(domains.has('infrastructure'));
  });
  it('port-closure-shortage seeds conflict + supply-chain + commodity situations', () => {
    const domains = domainsCreated(PORT_CLOSURE_SHORTAGE);
    assert.ok(domains.has('conflict'));
    assert.ok(domains.has('supply-chain'));
    assert.ok(domains.has('commodity'));
  });
});

// ── Built-in catalog integrity ─────────────────────────────────────────

describe('BUILT_IN_SCENARIOS catalog', () => {
  it('exposes exactly five scenarios with unique ids', () => {
    assert.equal(BUILT_IN_SCENARIOS.length, 5);
    const ids = new Set(BUILT_IN_SCENARIOS.map((f) => f.id));
    assert.equal(ids.size, 5);
  });
  it('every fixture has at least one expected alert AND one expected situation', () => {
    for (const fixture of BUILT_IN_SCENARIOS) {
      assert.ok(fixture.expectedAlerts.length > 0, `${fixture.id} expectedAlerts empty`);
      assert.ok(fixture.expectedSituations.length > 0, `${fixture.id} expectedSituations empty`);
    }
  });
  it('every event has a non-empty id, domain, sourceId, title', () => {
    for (const fixture of BUILT_IN_SCENARIOS) {
      for (const event of fixture.events) {
        assert.ok(event.id.length > 0, `${fixture.id} event id`);
        assert.ok(event.domain.length > 0, `${fixture.id} event domain`);
        assert.ok(event.sourceId.length > 0, `${fixture.id} event sourceId`);
        assert.ok(event.title.length > 0, `${fixture.id} event title`);
      }
    }
  });
  it('every offsetMs is a non-negative finite number', () => {
    for (const fixture of BUILT_IN_SCENARIOS) {
      for (const event of fixture.events) {
        assert.ok(Number.isFinite(event.offsetMs), `${fixture.id}/${event.id} offset not finite`);
        assert.ok(event.offsetMs >= 0, `${fixture.id}/${event.id} offset negative`);
      }
    }
  });
});
