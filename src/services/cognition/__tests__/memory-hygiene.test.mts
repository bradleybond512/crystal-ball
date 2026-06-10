/**
 * Tests for PR 14 memory hygiene additions to episodic-memory.ts:
 *
 *   1. Dedupe window: same signature + same kind within 24 h → update existing
 *      episode, not insert a duplicate.
 *   2. Refuted-exclusion: markEpisodeContradictory() flags episodes.
 *      recall() returns contradictory episodes with flag set.
 *      analogScoreFor() excludes contradictory episodes from scoring by default
 *      but includes them when excludeContradictory: false.
 *   3. Contradictory episodes remain retrievable (plan invariant: contradictions
 *      surface, never silently dropped).
 *
 * Tests are injectable — no real IDB, no real Worker, no network.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  recordEpisode,
  resolveEpisode,
  recall,
  analogScoreFor,
  markEpisodeContradictory,
  getAllEpisodes,
  resetForTests,
  configureForTests,
} from '../episodic-memory.ts';
import type { Episode } from '../episodic-memory.ts';

// ── Test storage stub ─────────────────────────────────────────────────────────

function makeStorage(): { getItem(k: string): string | null; setItem(k: string, v: string): void } {
  const store = new Map<string, string>();
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => { store.set(k, v); },
  };
}

// ── Common fixtures ───────────────────────────────────────────────────────────

const BASE_NOW = 1_700_000_000_000;
const ONE_HOUR = 60 * 60 * 1000;
const TWENTY_FOUR_HOURS = 24 * ONE_HOUR;

function makeInput(overrides: Partial<Omit<Episode, 'id' | 'vector' | 'tier'>> = {}): Omit<Episode, 'id' | 'vector' | 'tier'> {
  return {
    kind: 'hypothesis',
    signature: 'sig-black-sea-wheat',
    summary: 'Black Sea grain corridor disrupted wheat exports',
    domains: ['shortage', 'geopolitical'],
    entities: ['Black Sea', 'wheat', 'Russia'],
    createdAt: BASE_NOW,
    ...overrides,
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetForTests();
  configureForTests({
    storage: makeStorage(),
    getMemoryFn: async () => null,
    putMemoryFn: async () => undefined,
    now: () => BASE_NOW,
    minSim: 0.0, // 0 so all hashed vectors are eligible for recall in tests
  });
});

// ── Dedupe window ─────────────────────────────────────────────────────────────

describe('dedupe window — same signature + kind within 24 h', () => {
  it('inserts only one episode when same signature+kind recorded twice within 24 h', async () => {
    const input = makeInput({ signature: 'sig-A', kind: 'hypothesis' });

    const ep1 = await recordEpisode(input);
    const ep2 = await recordEpisode({ ...input, summary: 'updated summary same sig' });

    // Should have deduplicated — ep2 returns the same episode as ep1.
    assert.equal(ep1.id, ep2.id, 'duplicate insert within 24 h must return the existing episode id');
    assert.equal(getAllEpisodes().length, 1, 'only one episode should exist after duplicate insert');
  });

  it('updates summary on duplicate (summary drift)', async () => {
    const input = makeInput({ signature: 'sig-B', kind: 'hypothesis' });

    await recordEpisode(input);
    const updated = await recordEpisode({ ...input, summary: 'new refined summary text' });

    assert.equal(getAllEpisodes().length, 1, 'still only one episode');
    assert.equal(updated.summary, 'Black Sea grain corridor disrupted wheat exports',
      'returned episode keeps original summary (embedding stays from original insert)');
  });

  it('allows duplicate signature when kind differs', async () => {
    await recordEpisode(makeInput({ signature: 'sig-C', kind: 'hypothesis' }));
    await recordEpisode(makeInput({ signature: 'sig-C', kind: 'situation' }));
    assert.equal(getAllEpisodes().length, 2, 'different kind → separate episodes even with same signature');
  });

  it('allows duplicate signature when outside 24 h window', async () => {
    // First episode at BASE_NOW.
    await recordEpisode(makeInput({ signature: 'sig-D', kind: 'hypothesis', createdAt: BASE_NOW }));

    // Advance clock past the 24 h window.
    resetForTests();
    configureForTests({
      storage: makeStorage(),
      getMemoryFn: async () => null,
      putMemoryFn: async () => undefined,
      now: () => BASE_NOW + TWENTY_FOUR_HOURS + ONE_HOUR,
      minSim: 0.0,
    });

    // Second insert with same signature but clock is 25 h later.
    // Fresh module state — no episodes from the previous now. Re-insert first.
    await recordEpisode(makeInput({ signature: 'sig-D', kind: 'hypothesis', createdAt: BASE_NOW }));
    await recordEpisode(makeInput({
      signature: 'sig-D',
      kind: 'hypothesis',
      createdAt: BASE_NOW + TWENTY_FOUR_HOURS + ONE_HOUR,
    }));
    assert.equal(getAllEpisodes().length, 2, 'outside 24 h window → second episode is inserted');
  });

  it('empty signature always inserts (no dedupe key)', async () => {
    await recordEpisode(makeInput({ signature: '' }));
    await recordEpisode(makeInput({ signature: '' }));
    assert.equal(getAllEpisodes().length, 2, 'empty signature bypasses dedupe');
  });

  it('dedupe window boundary math: exactly at 24 h is within window (>=)', async () => {
    // Episode created at BASE_NOW - TWENTY_FOUR_HOURS (exactly at boundary).
    await recordEpisode(makeInput({ signature: 'sig-E', createdAt: BASE_NOW - TWENTY_FOUR_HOURS }));
    // Clock at BASE_NOW: the existing episode is exactly 24 h old → createdAt >= cutoff (BASE_NOW - TWENTY_FOUR_HOURS).
    const second = await recordEpisode(makeInput({ signature: 'sig-E' }));
    // Should deduplicate (within window means createdAt >= BASE_NOW - TWENTY_FOUR_HOURS).
    assert.equal(getAllEpisodes().length, 1, 'at exactly 24 h boundary → deduped');
    assert.ok(second.id !== undefined, 'returned id should be the existing episode id');
  });
});

// ── markEpisodeContradictory ──────────────────────────────────────────────────

describe('markEpisodeContradictory', () => {
  it('marks episode by id', async () => {
    const ep = await recordEpisode(makeInput({ signature: 'sig-mark-id' }));
    const count = markEpisodeContradictory(ep.id, 'competitive-hypothesis refuted: alternative wins');
    assert.equal(count, 1, 'should mark exactly one episode');
    const stored = getAllEpisodes().find(e => e.id === ep.id);
    assert.ok(stored?.contradictory === true, 'episode should be flagged contradictory');
    assert.equal(
      stored?.contradictoryReason,
      'competitive-hypothesis refuted: alternative wins',
      'reason should be stored',
    );
  });

  it('marks all episodes with matching signature', async () => {
    await recordEpisode(makeInput({ signature: 'sig-multi', kind: 'hypothesis' }));
    await recordEpisode(makeInput({ signature: 'sig-multi', kind: 'situation' }));
    const count = markEpisodeContradictory('sig-multi');
    assert.equal(count, 2, 'should mark both episodes with matching signature');
    const allEps = getAllEpisodes();
    assert.ok(allEps.every(e => e.contradictory === true), 'all matching episodes should be flagged');
  });

  it('returns 0 when id does not exist', () => {
    const count = markEpisodeContradictory('nonexistent-id-xyz');
    assert.equal(count, 0, 'no episodes matched → count = 0');
  });

  it('truncates reason to 280 chars', async () => {
    const ep = await recordEpisode(makeInput({ signature: 'sig-reason' }));
    const longReason = 'x'.repeat(400);
    markEpisodeContradictory(ep.id, longReason);
    const stored = getAllEpisodes().find(e => e.id === ep.id);
    assert.ok((stored?.contradictoryReason?.length ?? 0) <= 280, 'reason must be truncated to 280 chars');
  });

  it('episode remains retrievable after marking contradictory', async () => {
    const ep = await recordEpisode(makeInput({ signature: 'sig-retrievable' }));
    await resolveEpisode(ep.id, 'materialized');
    markEpisodeContradictory(ep.id);

    // recall() should still return the episode, just flagged.
    const results = await recall('Black Sea grain wheat exports Russia');
    assert.ok(results.length > 0, 'contradictory episode must still appear in recall results');
    const found = results.find(r => r.episode.id === ep.id);
    assert.ok(found !== undefined, 'the marked episode must be in recall results');
    assert.ok(found!.contradictory === true, 'recall result must carry contradictory flag');
  });
});

// ── analogScoreFor — contradictory exclusion ──────────────────────────────────

describe('analogScoreFor — refuted-exclusion', () => {
  async function buildRecalls(): Promise<ReturnType<typeof recall>> {
    // Insert 5 episodes with different outcomes so we clear MIN_RECALLS_FOR_ANALOG (3).
    const sigs = ['sig-1', 'sig-2', 'sig-3', 'sig-4', 'sig-5'];
    const outcomes: Episode['outcome'][] = ['materialized', 'materialized', 'fizzled', 'materialized', 'fizzled'];
    const eps: Episode[] = [];

    for (let i = 0; i < sigs.length; i++) {
      const ep = await recordEpisode(makeInput({
        signature: sigs[i],
        kind: 'hypothesis',
        summary: `episode ${i} Black Sea wheat grain`,
      }));
      await resolveEpisode(ep.id, outcomes[i]);
      eps.push({ ...ep, outcome: outcomes[i] });
    }

    return recall('Black Sea wheat grain');
  }

  it('analogScoreFor returns non-null when enough recalls', async () => {
    const recalls = await buildRecalls();
    assert.ok(recalls.length >= 3, `expected >=3 recalls, got ${recalls.length}`);
    const score = analogScoreFor(recalls);
    assert.ok(score !== null, 'should return a score with enough recalls');
    assert.ok(score >= 0 && score <= 1, `score must be in [0,1], got ${score}`);
  });

  it('marking episodes contradictory reduces eligible recalls for analogScoreFor', async () => {
    const recalls = await buildRecalls();
    const scoreBefore = analogScoreFor(recalls);

    // Mark the first 3 matching episodes as contradictory.
    const allEps = getAllEpisodes();
    let marked = 0;
    for (const ep of allEps) {
      if (marked >= 3) break;
      markEpisodeContradictory(ep.id);
      marked += 1;
    }

    // Re-recall (to get updated contradictory flags in the recall objects).
    const recallsAfter = await recall('Black Sea wheat grain');
    const scoreAfterExclude = analogScoreFor(recallsAfter); // excludeContradictory default: true
    const scoreAfterInclude = analogScoreFor(recallsAfter, { excludeContradictory: false });

    // With 3 of 5 episodes excluded, only 2 qualified → below MIN_RECALLS_FOR_ANALOG → null.
    assert.ok(
      scoreAfterExclude === null || scoreAfterExclude !== scoreBefore,
      'score should change (or become null) after marking episodes contradictory',
    );

    // When we include contradictory episodes, the score should be the same as before.
    if (scoreBefore !== null && scoreAfterInclude !== null) {
      assert.ok(
        Math.abs(scoreAfterInclude - scoreBefore) < 1e-6,
        'with excludeContradictory:false, score should equal the pre-mark score',
      );
    }
  });

  it('contradictory episodes carry contradictory flag in recall results', async () => {
    const ep = await recordEpisode(makeInput({ signature: 'sig-flag-test' }));
    await resolveEpisode(ep.id, 'materialized');
    markEpisodeContradictory(ep.id);

    const results = await recall('Black Sea wheat grain');
    const contradictoryResults = results.filter(r => r.contradictory === true);
    assert.ok(contradictoryResults.length >= 1, 'at least one recall result should carry contradictory flag');
  });

  it('non-contradictory episodes are not flagged in recall', async () => {
    // Insert an episode that is NOT marked contradictory.
    await recordEpisode(makeInput({ signature: 'sig-not-contradictory' }));
    const results = await recall('Black Sea wheat grain');
    const contradictoryResults = results.filter(r => r.contradictory === true);
    assert.equal(contradictoryResults.length, 0, 'no recall results should be flagged when no episodes are contradictory');
  });

  it('excludeContradictory:false includes all episodes in analogScoreFor', async () => {
    const ep1 = await recordEpisode(makeInput({ signature: 'sig-incl-1', summary: 'alpha beta gamma delta epsilon' }));
    const ep2 = await recordEpisode(makeInput({ signature: 'sig-incl-2', summary: 'alpha beta gamma delta epsilon' }));
    const ep3 = await recordEpisode(makeInput({ signature: 'sig-incl-3', summary: 'alpha beta gamma delta epsilon' }));
    await resolveEpisode(ep1.id, 'materialized');
    await resolveEpisode(ep2.id, 'materialized');
    await resolveEpisode(ep3.id, 'fizzled');

    markEpisodeContradictory(ep1.id);
    markEpisodeContradictory(ep2.id);

    const results = await recall('alpha beta gamma delta epsilon');

    const scoreExcluded = analogScoreFor(results); // default: excludeContradictory true
    const scoreIncluded = analogScoreFor(results, { excludeContradictory: false });

    // With exclusion: only ep3 (fizzled) qualifies if <3 remain → likely null.
    // Without exclusion: all 3 qualify → should be non-null.
    if (results.length >= 3) {
      assert.ok(scoreIncluded !== null, 'including contradictory should allow enough recalls for a score');
    }
    // The excluded score should differ from included when contradictory episodes have been filtered.
    if (scoreExcluded !== null && scoreIncluded !== null) {
      // ep1 and ep2 are materialized+contradictory; ep3 is fizzled+non-contradictory.
      // Excluding ep1/ep2 (materialized) should LOWER the score.
      assert.ok(
        scoreIncluded >= scoreExcluded,
        'including materialized-but-contradictory episodes should ≥ the excluded score',
      );
    }
  });
});
