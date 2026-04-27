/**
 * Change-memory store — captures snapshots of situations so the
 * "What Changed Digest" (PR 2 of the insights plan) can compute
 * meaningful deltas between user visits.
 *
 * Per docs/INSIGHTS_NOTIFICATIONS_PRESENTATION_PLAN.md PR 2 (lines
 * 379-388): "Track meaningful changes since the user last checked."
 *
 * Pure deterministic in-memory store with a serialize/deserialize pair
 * so callers can persist to IDB / localStorage / a JSON file. No DOM,
 * no fetch, no globals.
 *
 * Plan invariant: "Never notify repeatedly for the same unchanged
 * situation." The digest's job is to surface DIFFERENCES, so the
 * store must remember enough to compute them.
 */

// ── Snapshot shape ───────────────────────────────────────────────────────

/** Minimum we need to remember about a situation to detect change.
 *  This is intentionally a subset of `intelligence/Situation` so the
 *  insights layer can record snapshots from any source — situation
 *  clustering output, raw alerts, weather urgency decisions — without
 *  pulling on the algorithm types directly. */
export interface SituationSnapshot {
  id: string;
  /** Display label for the digest line. */
  title: string;
  /** Short categorical bucket the UI groups by ("weather", "markets",
   *  "shortage:wheat"). Free-form by design. */
  category: string;
  /** 0-100 risk-or-severity score. */
  score: number;
  /** Categorical tier (FYI / Watch / Elevated / Critical / Emergency
   *  in the plan, but typed as string here so callers can use whatever
   *  label vocabulary they want). */
  tier: string;
  /** Confidence label or score. Free-form to keep this layer
   *  vocabulary-agnostic. */
  confidence?: string | number;
  /** ms timestamp when the snapshot was recorded. */
  recordedAt: number;
  /** Distinct providers attesting to the underlying claim(s). */
  sources?: string[];
  /** Summary line for the UI ("storm path overlaps saved place +
   *  outage risk + airport disruption"). Optional. */
  summary?: string;
  /** Free-form key/value bag for things callers want to diff but
   *  don't fit elsewhere (e.g. polygon centroid, eventType, region). */
  meta?: Record<string, unknown>;
}

// ── Store ────────────────────────────────────────────────────────────────

export interface ChangeMemoryStore {
  /** Record (or overwrite) the most recent snapshot for a situation id. */
  record: (snapshot: SituationSnapshot) => void;
  /** Get the most recent snapshot for `id`, or undefined when none. */
  get: (id: string) => SituationSnapshot | undefined;
  /** All recorded ids. */
  ids: () => string[];
  /** Drop the snapshot for `id`. No-op when not present. */
  forget: (id: string) => void;
  /** Drop snapshots older than `cutoffMs` (recordedAt < cutoffMs). */
  prune: (cutoffMs: number) => number;
  /** Serialize all snapshots to a JSON-friendly array. */
  toJson: () => SituationSnapshot[];
  /** Bulk-load snapshots from a previous toJson result. Replaces
   *  current contents. */
  loadJson: (snapshots: readonly SituationSnapshot[]) => void;
  /** Number of snapshots currently held. */
  size: () => number;
}

export function createChangeMemoryStore(initial?: readonly SituationSnapshot[]): ChangeMemoryStore {
  const store = new Map<string, SituationSnapshot>();
  if (initial) {
    for (const s of initial) store.set(s.id, { ...s });
  }
  return {
    record(snapshot) { store.set(snapshot.id, { ...snapshot }); },
    get(id) {
      const s = store.get(id);
      return s ? { ...s } : undefined;
    },
    ids() { return [...store.keys()]; },
    forget(id) { store.delete(id); },
    prune(cutoffMs) {
      let removed = 0;
      for (const [id, s] of store) {
        if (s.recordedAt < cutoffMs) {
          store.delete(id);
          removed += 1;
        }
      }
      return removed;
    },
    toJson() { return [...store.values()].map((s) => ({ ...s })); },
    loadJson(snapshots) {
      store.clear();
      for (const s of snapshots) store.set(s.id, { ...s });
    },
    size() { return store.size; },
  };
}
