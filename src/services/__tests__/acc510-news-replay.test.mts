import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { beforeEach, test } from 'node:test';
import type { CorrelationSignalCore } from '../analysis-core.ts';
import type { Situation } from '../situation-types.ts';
import { correlateSignalToSituation, signalDomainOf } from '../situation-correlator.ts';

interface ReplayCase {
  id: string;
  title: string;
  groundTruthUnrest: boolean;
  expectedDomain: string;
  expectedReason: string;
  type: CorrelationSignalCore['type'];
  relatedTopics: string[];
  articles: unknown[] | null;
}

const rawFixture = readFileSync(new URL('./fixtures/acc510-news-domain-replay.json', import.meta.url));
const fixture: { now: number; cases: ReplayCase[] } = JSON.parse(rawFixture.toString());
const frozenHash = '28284a984f9b8202173c8cc93a06d10efc942c55199fff9168dc52ba3f21dc05';

beforeEach((t) => {
  t.mock.method(Date, 'now', () => fixture.now);
});

function signal(entry: ReplayCase): CorrelationSignalCore {
  return {
    id: entry.id,
    type: entry.type,
    title: entry.title,
    description: entry.title,
    confidence: 0.8,
    timestamp: new Date(fixture.now),
    data: {
      relatedTopics: [...entry.relatedTopics],
      newsEvidence: entry.articles === null ? undefined : { articles: structuredClone(entry.articles) },
    },
  } as CorrelationSignalCore;
}

function replay(entry: ReplayCase) {
  const input = signal(entry);
  const before = structuredClone(input);
  const situations: Situation[] = [];
  const result = correlateSignalToSituation(input, situations);
  assert.equal(result.isNew, true, 'unknown evidence must remain visible as a situation');
  assert.equal(situations.length, 1);
  assert.deepEqual(input, before, 'classification cannot rewrite its contributing input');
  return { signalDomain: signalDomainOf(input), situation: situations[0]! };
}

test('ACC510 corpus labels and policy expectations remain frozen before implementation', () => {
  assert.equal(createHash('sha256').update(rawFixture).digest('hex'), frozenHash);
  assert.equal(fixture.cases.length, 20);
  assert.equal(fixture.cases.filter((entry) => entry.groundTruthUnrest).length, 7);
});

for (const entry of fixture.cases) {
  test(`frozen replay: ${entry.id} → ${entry.expectedDomain} / ${entry.expectedReason}`, () => {
    const { signalDomain, situation } = replay(entry);
    assert.equal(signalDomain, entry.expectedDomain, 'the actual signal classifier must follow the frozen policy');
    assert.equal(situation.domain, entry.expectedDomain, 'the actual correlator must preserve the classification');
    assert.equal(situation.signals[0]!.domain, entry.expectedDomain);
    assert.equal(situation.signals[0]!.domainClassification?.reason, entry.expectedReason);
    if (entry.expectedDomain === 'unknown') {
      assert.equal(situation.domainDiversity, 0, 'abstention is not a supporting domain');
      assert.equal(situation.causalChainId, null, 'unsupported news must not satisfy a causal template');
    }
  });
}

test('frozen replay exposes all four added unrest misses while eliminating thirteen false positives', () => {
  const outcomes = fixture.cases.map((entry) => {
    const { signalDomain, situation } = replay(entry);
    return {
      id: entry.id,
      groundTruthUnrest: entry.groundTruthUnrest,
      signalDomain,
      situationDomain: situation.domain,
      reason: situation.signals[0]!.domainClassification?.reason,
      falseUnrestPositive: !entry.groundTruthUnrest && situation.domain === 'civil_unrest',
      missedUnrest: entry.groundTruthUnrest && situation.domain !== 'civil_unrest',
      abstained: situation.domain === 'unknown',
    };
  });
  const metrics = {
    fixtureSha256: createHash('sha256').update(rawFixture).digest('hex'),
    total: outcomes.length,
    falseUnrestPositives: outcomes.filter((entry) => entry.falseUnrestPositive).length,
    missedUnrest: outcomes.filter((entry) => entry.missedUnrest).length,
    abstentions: outcomes.filter((entry) => entry.abstained).length,
    addedMisses: outcomes.filter((entry) => entry.missedUnrest).map((entry) => entry.id),
    outcomes,
  };
  if (process.env.ACC510_REPLAY_METRICS) {
    writeFileSync(process.env.ACC510_REPLAY_METRICS, JSON.stringify(metrics, null, 2) + '\n');
  }
  assert.equal(metrics.falseUnrestPositives, 0, 'baseline had thirteen false unrest positives');
  assert.equal(metrics.missedUnrest, 4, 'baseline had zero misses; abstentions must count as misses');
  assert.equal(metrics.abstentions, 15, 'abstentions must be reported, including negative cases');
  assert.deepEqual(metrics.addedMisses, [
    'mixed-protest-tech', 'one-source-unrest', 'conflicting-supported', 'overflow-unrest',
  ]);
});
