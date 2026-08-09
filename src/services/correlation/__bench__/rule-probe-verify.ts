/**
 * The gate's OWN execution of the rule-coverage fixtures.
 *
 * `probeBuiltInRules()` (rule-probes.ts) produces the probe verdicts that ship
 * inside the benchmark report. The gate used to read those verdicts and check
 * their shape — which is a check on a claim, not on a matcher. The reviewer
 * replaced every near-miss execution with the constant `rejected: true`, and
 * the report digest, the four ledger digests and `compareCorrelationBenchToBaseline`
 * were all byte-identical: 73 negative engine executions had been deleted and
 * nothing in the benchmark could tell. The fixture digests pin the QUESTIONS,
 * but a question nobody asks has no answer to pin.
 *
 * So the gate stops trusting the report on this and runs the fixtures itself.
 * The producer and this module share the fixture DATA — that is the point, the
 * data is what the digests freeze — and share no execution path: separate
 * engine construction, separate rule registration, separate emission lookup.
 * A producer that stops consulting the engine now disagrees with a gate that
 * still does, and disagreement is a FAIL.
 *
 * Pure deterministic. No DOM, no fetch, no clock reads.
 */

import type { ObservationEvent } from '@/types/intelligence';
import { CorrelateEngine } from '../../intelligence/correlate-engine';
import { builtInCorrelationRules } from '../../intelligence/built-in-correlation-rules';
import { LEARNED_RULE_PREFIX, syncLearnedRules } from '../learned-rules';
import type { CorrelationRule } from '../../intelligence/correlate-engine';
import type { BenchResyncProbe } from '../bench-correlation';
import {
  RESYNC_FIXTURE_RULES,
  RULE_FIXTURES,
  positiveEvents,
  nearMissEvents,
  disjunctEvents,
  digestRuleFixture,
  type BenchRuleProbe,
} from './rule-probes';

/**
 * Deliberately NOT the producer's `emissionOf`.
 *
 * Sharing that helper would put both witnesses on one execution path, and one
 * path silently short-circuiting is exactly the defect this module exists to
 * catch. The duplication is the independence.
 */
function verifyEmission(
  ruleId: string,
  observations: readonly ObservationEvent[],
  now: Date,
): { edgeType: string; fromId: string; toId: string } | null {
  const engine = new CorrelateEngine({ timer: () => 0 });
  for (const rule of builtInCorrelationRules) engine.registerRule(rule);
  for (const pair of engine.correlate(observations, now).pairs) {
    if (pair.ruleId === ruleId) {
      return { edgeType: pair.edgeType, fromId: pair.eventA.id, toId: pair.eventB.id };
    }
  }
  return null;
}

/**
 * The evaluation instant the fixtures are graded at.
 *
 * Recomputed here from the fixtures rather than imported: every fixture offset
 * is under 96 h, and `CorrelateEngine.correlate` uses `now` only for
 * `detectedAt`, so any instant produces the same verdicts. Taken as a parameter
 * so a test can prove that.
 */
export const VERIFY_NOW = new Date(Date.UTC(2026, 5, 1, 13, 0, 0));

/**
 * Re-derive every probe verdict from the fixtures, ignoring the report.
 *
 * Returns the same shape `probeBuiltInRules()` returns, in the same order, so
 * the gate can compare the two field by field.
 */
export function verifyRuleProbes(now: Date = VERIFY_NOW): BenchRuleProbe[] {
  const out: BenchRuleProbe[] = [];
  for (const f of RULE_FIXTURES) {
    const pos = positiveEvents(f);
    const hit = verifyEmission(f.ruleId, pos, now);
    const rev = verifyEmission(f.ruleId, [...pos].reverse(), now);
    out.push({
      ruleId: f.ruleId,
      positiveMatched: hit !== null,
      positiveEdgeType: hit?.edgeType ?? null,
      positiveDirection: hit === null ? null : `${hit.fromId}→${hit.toId}`,
      reversedMatched: rev !== null,
      reversedDirection: rev === null ? null : `${rev.fromId}→${rev.toId}`,
      nearMisses: f.nearMisses.map((nm) => ({
        clause: nm.clause,
        rejected: verifyEmission(f.ruleId, nearMissEvents(f, nm), now) === null,
      })),
      disjuncts: f.disjuncts.map((d) => ({
        branch: d.branch,
        matched: verifyEmission(f.ruleId, disjunctEvents(f, d), now) !== null,
      })),
      fixtureDigest: digestRuleFixture(f),
    });
  }
  return out.sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}

/**
 * The gate's OWN execution of the learned-rule retirement.
 *
 * Same reason as `verifyRuleProbes` above, and the reviewer found the same
 * defect shape here: `afterRetirement: installed.filter(id => id !== retiredId)`
 * leaves the report, every digest and the whole gate byte-identical while the
 * probe stops reading the engine entirely. Only a second executor that really
 * calls `getRules()` can tell.
 *
 * Shares the frozen rule set (`RESYNC_FIXTURE_RULES` — that is the pinned
 * question) and no execution path: its own engine, its own sync calls, its own
 * inventory reads.
 */
export function verifyResyncProbe(
  learned: readonly CorrelationRule[] = RESYNC_FIXTURE_RULES,
): BenchResyncProbe {
  const engine = new CorrelateEngine({ timer: () => 0 });
  for (const rule of builtInCorrelationRules) engine.registerRule(rule);
  const builtInsBefore = engine.getRules()
    .map((r) => r.id)
    .filter((id) => !id.startsWith(LEARNED_RULE_PREFIX))
    .sort((a, b) => a.localeCompare(b));

  const learnedNow = (): string[] => engine.getRules()
    .map((r) => r.id)
    .filter((id) => id.startsWith(LEARNED_RULE_PREFIX))
    .sort((a, b) => a.localeCompare(b));

  syncLearnedRules(engine, learned);
  const installed = learnedNow();
  const retiredId = installed[installed.length - 1] ?? '';
  const { added, removed } = syncLearnedRules(
    engine,
    learned.filter((r) => r.id !== retiredId),
  );
  const builtInsAfter = engine.getRules()
    .map((r) => r.id)
    .filter((id) => !id.startsWith(LEARNED_RULE_PREFIX))
    .sort((a, b) => a.localeCompare(b));

  return {
    installed,
    retiredId,
    afterRetirement: learnedNow(),
    reportedAdded: added,
    reportedRemoved: removed,
    builtInsIntact: builtInsAfter.length === builtInsBefore.length
      && builtInsAfter.every((id, i) => id === builtInsBefore[i]),
  };
}
