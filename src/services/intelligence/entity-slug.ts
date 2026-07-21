/** Shared normalizer converging the episode-entity and situation-entityId
 *  vocabularies (they evolved independently; see the PR 14 contradiction
 *  bridge in cognition/episodic-memory.ts). */
export function slugifyEntity(raw: string): string {
  return raw
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    // Collapsing runs of non-alphanumerics first guarantees at most a single
    // leading/trailing '-' below, so the boundary trim can stay unquantified
    // (avoids the anchored-quantifier-alternation shape sonarjs/slow-regex flags).
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
