/**
 * Episodic Memory Bridge — thin adapter for non-async callers.
 *
 * hypothesis-accuracy.ts grades hypotheses synchronously in a loop.
 * This bridge exposes a fire-and-forget wrapper that resolves episodes
 * by their signature (which is what hypothesis-accuracy tracks) without
 * requiring the caller to hold an episode ID.
 *
 * No circular imports: this module imports from episodic-memory.ts, not
 * from analyst-loop.ts or hypothesis-accuracy.ts.
 */

import { getAllEpisodes, resolveEpisode } from './episodic-memory';
import type { Episode } from './episodic-memory';

/**
 * Resolve the first pending episode that matches the given signature.
 * Fire-and-forget — errors are swallowed so gradeOne() never throws.
 * Called from hypothesis-accuracy.gradeOne() after a hit/miss determination.
 */
export function resolveEpisodeForSignature(
  signature: string,
  outcome: Episode['outcome'],
  note?: string,
): void {
  const episodes = getAllEpisodes();
  const ep = episodes.find(
    e => e.signature === signature && e.resolvedAt === undefined,
  );
  if (!ep) return;
  void resolveEpisode(ep.id, outcome, note).catch(() => {
    // Never propagate errors from episodic memory into the accuracy grader.
  });
}
