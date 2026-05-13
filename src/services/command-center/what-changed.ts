/**
 * "What changed in the last hour" diff engine.
 *
 * Pure, deterministic service. The Command Center records periodic
 * state snapshots (alerts, situations, feeds); `getWhatChanged()`
 * diffs the latest known state against the snapshot at-or-before
 * `sinceMs` and emits at most 20 most-recent change events.
 *
 * No DOM, no fetch — safe to unit-test under tsx --test.
 */

export type ChangeDomain = 'weather' | 'cyber' | 'finance' | 'conflict' | 'seismic' | 'energy' | 'system' | 'other';

export type ChangeType =
  | 'new-alert'
  | 'escalated'
  | 'resolved'
  | 'new-situation'
  | 'feed-restored'
  | 'feed-degraded';

export type AlertSeverityLike = 'INFO' | 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';

export interface AlertState {
  id: string;
  domain: ChangeDomain;
  severity: AlertSeverityLike;
  summary: string;
}

export interface SituationState {
  id: string;
  domain: ChangeDomain;
  title: string;
}

export type FeedHealthLike = 'healthy' | 'degraded' | 'down';

export interface FeedState {
  id: string;
  status: FeedHealthLike;
  label?: string;
}

export interface WhatChangedSnapshot {
  takenAt: number;
  alerts: AlertState[];
  situations: SituationState[];
  feeds: FeedState[];
}

export interface WhatChangedEvent {
  id: string;
  timestamp: number;
  domain: ChangeDomain;
  type: ChangeType;
  summary: string;
}

const SEVERITY_RANK: Record<AlertSeverityLike, number> = {
  INFO: 0,
  LOW: 1,
  MODERATE: 2,
  HIGH: 3,
  CRITICAL: 4,
};

const MAX_EVENTS = 20;
const MAX_SNAPSHOTS = 240;

interface SnapshotStore {
  ring: WhatChangedSnapshot[];
}

const store: SnapshotStore = { ring: [] };

export function recordSnapshot(snapshot: WhatChangedSnapshot): void {
  store.ring.push({
    takenAt: snapshot.takenAt,
    alerts: snapshot.alerts.map((a) => cloneAlert(a)),
    situations: snapshot.situations.map((s) => cloneSituation(s)),
    feeds: snapshot.feeds.map((f) => cloneFeed(f)),
  });
  if (store.ring.length > MAX_SNAPSHOTS) {
    store.ring.splice(0, store.ring.length - MAX_SNAPSHOTS);
  }
}

export function resetWhatChangedStore(): void {
  store.ring.length = 0;
}

export function getSnapshotCount(): number {
  return store.ring.length;
}

/**
 * Diff the latest snapshot against the snapshot at-or-before `sinceMs`.
 * Returns up to `MAX_EVENTS` change events, newest first. If there is
 * only one snapshot, returns []. If `sinceMs` is older than the oldest
 * snapshot, uses the oldest as the baseline.
 */
export function getWhatChanged(sinceMs: number): WhatChangedEvent[] {
  if (store.ring.length < 2) return [];
  const sorted = [...store.ring].sort((a, b) => a.takenAt - b.takenAt);
  const current = sorted[sorted.length - 1];
  if (!current) return [];
  const baseline = pickBaseline(sorted, sinceMs, current);
  if (!baseline || baseline === current) return [];
  return diffSnapshots(baseline, current);
}

/**
 * Pure version exposed for tests + replay: takes two snapshots directly
 * and emits the same event list (without touching the in-memory ring).
 */
export function diffSnapshots(
  baseline: WhatChangedSnapshot,
  current: WhatChangedSnapshot,
): WhatChangedEvent[] {
  const events: WhatChangedEvent[] = [];
  const seen = new Set<string>();
  const push = (event: WhatChangedEvent): void => {
    if (seen.has(event.id)) return;
    seen.add(event.id);
    events.push(event);
  };
  diffAlerts(baseline, current, push);
  diffSituations(baseline, current, push);
  diffFeeds(baseline, current, push);
  events.sort((a, b) => {
    if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
    return changeTypePriority(b.type) - changeTypePriority(a.type);
  });
  return events.slice(0, MAX_EVENTS);
}

type PushEvent = (event: WhatChangedEvent) => void;

function diffAlerts(
  baseline: WhatChangedSnapshot,
  current: WhatChangedSnapshot,
  push: PushEvent,
): void {
  const baseAlerts = new Map(baseline.alerts.map((a) => [a.id, a]));
  const curAlerts = new Map(current.alerts.map((a) => [a.id, a]));
  for (const [id, alert] of curAlerts) {
    const prior = baseAlerts.get(id);
    if (!prior) {
      push({
        id: `new-alert:${id}`,
        timestamp: current.takenAt,
        domain: alert.domain,
        type: 'new-alert',
        summary: alert.summary,
      });
    } else if (SEVERITY_RANK[alert.severity] > SEVERITY_RANK[prior.severity]) {
      push({
        id: `escalated:${id}`,
        timestamp: current.takenAt,
        domain: alert.domain,
        type: 'escalated',
        summary: `${prior.severity} → ${alert.severity}: ${alert.summary}`,
      });
    }
  }
  for (const [id, prior] of baseAlerts) {
    if (curAlerts.has(id)) continue;
    push({
      id: `resolved:${id}`,
      timestamp: current.takenAt,
      domain: prior.domain,
      type: 'resolved',
      summary: prior.summary,
    });
  }
}

function diffSituations(
  baseline: WhatChangedSnapshot,
  current: WhatChangedSnapshot,
  push: PushEvent,
): void {
  const baseSituations = new Map(baseline.situations.map((s) => [s.id, s]));
  for (const sit of current.situations) {
    if (baseSituations.has(sit.id)) continue;
    push({
      id: `new-situation:${sit.id}`,
      timestamp: current.takenAt,
      domain: sit.domain,
      type: 'new-situation',
      summary: sit.title,
    });
  }
}

function diffFeeds(
  baseline: WhatChangedSnapshot,
  current: WhatChangedSnapshot,
  push: PushEvent,
): void {
  const baseFeeds = new Map(baseline.feeds.map((f) => [f.id, f]));
  for (const feed of current.feeds) {
    const prior = baseFeeds.get(feed.id);
    if (!prior) continue;
    const wasHealthy = prior.status === 'healthy';
    const isHealthy = feed.status === 'healthy';
    if (!wasHealthy && isHealthy) {
      push({
        id: `feed-restored:${feed.id}`,
        timestamp: current.takenAt,
        domain: 'system',
        type: 'feed-restored',
        summary: `${feed.label ?? feed.id} back online`,
      });
    } else if (wasHealthy && !isHealthy) {
      push({
        id: `feed-degraded:${feed.id}`,
        timestamp: current.takenAt,
        domain: 'system',
        type: 'feed-degraded',
        summary: `${feed.label ?? feed.id} ${feed.status}`,
      });
    }
  }
}

const TYPE_EMOJI: Record<ChangeType, string> = {
  'new-alert': '🔴',
  escalated: '⬆️',
  resolved: '✅',
  'new-situation': '🆕',
  'feed-restored': '🟢',
  'feed-degraded': '⚠️',
};

export function formatDelta(event: WhatChangedEvent): string {
  switch (event.type) {
    case 'new-alert': {
      return `${TYPE_EMOJI[event.type]} New ${event.domain.toUpperCase()}: ${event.summary}`;
    }
    case 'escalated': {
      return `${TYPE_EMOJI[event.type]} Escalated · ${event.summary}`;
    }
    case 'resolved': {
      return `${TYPE_EMOJI[event.type]} Resolved · ${event.summary}`;
    }
    case 'new-situation': {
      return `${TYPE_EMOJI[event.type]} New situation · ${event.summary}`;
    }
    case 'feed-restored': {
      return `${TYPE_EMOJI[event.type]} Feed restored · ${event.summary}`;
    }
    case 'feed-degraded': {
      return `${TYPE_EMOJI[event.type]} Feed ${event.summary}`;
    }
  }
}

function changeTypePriority(type: ChangeType): number {
  switch (type) {
    case 'new-alert': { return 5;
    }
    case 'escalated': { return 4;
    }
    case 'new-situation': { return 3;
    }
    case 'feed-degraded': { return 2;
    }
    case 'resolved': { return 1;
    }
    case 'feed-restored': { return 0;
    }
  }
}

function pickBaseline(
  sorted: WhatChangedSnapshot[],
  sinceMs: number,
  current: WhatChangedSnapshot,
): WhatChangedSnapshot | null {
  let baseline: WhatChangedSnapshot | null = null;
  for (const snap of sorted) {
    if (snap === current) break;
    if (snap.takenAt <= sinceMs) baseline = snap;
  }
  if (!baseline) {
    const oldest = sorted[0];
    if (!oldest || oldest === current) return null;
    return oldest;
  }
  return baseline;
}

function cloneAlert(a: AlertState): AlertState {
  return { id: a.id, domain: a.domain, severity: a.severity, summary: a.summary };
}

function cloneSituation(s: SituationState): SituationState {
  return { id: s.id, domain: s.domain, title: s.title };
}

function cloneFeed(f: FeedState): FeedState {
  const next: FeedState = { id: f.id, status: f.status };
  if (f.label !== undefined) next.label = f.label;
  return next;
}
