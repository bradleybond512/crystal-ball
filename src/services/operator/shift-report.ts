/**
 * Operator shift handoff report — generates a markdown summary of the
 * last 8 hours for the outgoing operator to share with whoever is
 * picking up the shift.
 *
 * Pure / deterministic. Takes an `ShiftReportInput` snapshot of the
 * three data sources (situations, notifications, feeds), returns a
 * markdown string. No clock dependence — the host passes `now` and
 * `windowMs`.
 */

import type { NotificationHistoryEntry, HistoryDomain } from '@/services/notifications/notification-history-service';

export const DEFAULT_WINDOW_MS = 8 * 60 * 60 * 1000;
export const TOP_SITUATIONS_LIMIT = 5;

export interface SituationSummary {
  id: string;
  title: string;
  /** Free-form severity string ("critical", "high", "medium", "low", "info",
   *  or any caller-supplied label). */
  severity: string;
  timestamp: number;
  /** Optional one-line context shown beneath the title. */
  subtitle?: string;
}

export interface DegradedFeed {
  id: string;
  name: string;
  /** Human-readable reason: "stale (last poll 4h ago)", "HTTP 503", etc. */
  reason: string;
}

export interface ShiftReportInput {
  /** ms-since-epoch the report is generated at. */
  now: number;
  /** Look-back window in ms. Defaults to 8h. */
  windowMs?: number;
  /** Display name of the operator handing off (optional). */
  operator?: string;
  situations: readonly SituationSummary[];
  notifications: readonly NotificationHistoryEntry[];
  degradedFeeds: readonly DegradedFeed[];
}

export interface ShiftReportStats {
  windowStart: number;
  windowEnd: number;
  totalSituations: number;
  topSituations: SituationSummary[];
  notificationsByDomain: Record<string, number>;
  notificationsFired: number;
  notificationsSuppressed: number;
  notificationsEscalated: number;
  degradedFeedCount: number;
}

/** Pure: produce the structured stats independent of formatting. */
export function buildShiftReportStats(input: ShiftReportInput): ShiftReportStats {
  const windowMs = input.windowMs ?? DEFAULT_WINDOW_MS;
  const windowStart = input.now - windowMs;
  const windowEnd = input.now;

  const recentSituations = input.situations.filter((s) => s.timestamp >= windowStart && s.timestamp <= windowEnd);
  const topSituations = [...recentSituations]
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.timestamp - a.timestamp)
    .slice(0, TOP_SITUATIONS_LIMIT);

  const recentNotifications = input.notifications.filter((n) => n.recordedAt >= windowStart && n.recordedAt <= windowEnd);
  const byDomain: Record<string, number> = {};
  let fired = 0;
  let suppressed = 0;
  let escalated = 0;
  for (const n of recentNotifications) {
    byDomain[n.domain] = (byDomain[n.domain] ?? 0) + 1;
    if (n.action === 'fired') fired += 1;
    else if (n.action === 'suppressed') suppressed += 1;
    else if (n.action === 'escalated') escalated += 1;
  }

  return {
    windowStart,
    windowEnd,
    totalSituations: recentSituations.length,
    topSituations,
    notificationsByDomain: byDomain,
    notificationsFired: fired,
    notificationsSuppressed: suppressed,
    notificationsEscalated: escalated,
    degradedFeedCount: input.degradedFeeds.length,
  };
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

function severityRank(s: string): number {
  return SEVERITY_RANK[s.toLowerCase()] ?? 0;
}

function renderTopSituations(situations: readonly SituationSummary[]): string[] {
  if (situations.length === 0) return ['_No situations in window._'];
  const out: string[] = [];
  for (const sit of situations) {
    const sev = sit.severity.toUpperCase();
    const when = new Date(sit.timestamp).toISOString();
    out.push(`- **[${sev}]** ${sit.title} — ${when}`);
    if (sit.subtitle) out.push(`  - ${sit.subtitle}`);
  }
  return out;
}

function renderAlertsByDomain(byDomain: Record<string, number>): string[] {
  const entries = Object.entries(byDomain).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return ['_No notifications in window._'];
  return entries.map(([domain, count]) => `- ${domain}: ${count}`);
}

function renderDegradedFeeds(feeds: readonly DegradedFeed[]): string[] {
  if (feeds.length === 0) return ['_All feeds nominal._'];
  return feeds.map((f) => `- **${f.name}** (\`${f.id}\`) — ${f.reason}`);
}

/** Render the stats as a markdown document. */
export function renderShiftReportMarkdown(input: ShiftReportInput, stats?: ShiftReportStats): string {
  const s = stats ?? buildShiftReportStats(input);
  const operator = input.operator ? ` — ${input.operator}` : '';
  const windowHours = Math.round((s.windowEnd - s.windowStart) / (60 * 60 * 1000));
  return [
    `# Shift handoff${operator}`,
    '',
    `Window: ${new Date(s.windowStart).toISOString()} → ${new Date(s.windowEnd).toISOString()} (${windowHours}h)`,
    '',
    '## Top situations',
    ...renderTopSituations(s.topSituations),
    '',
    '## Alerts by domain',
    ...renderAlertsByDomain(s.notificationsByDomain),
    '',
    '## Notification delivery',
    `- fired: ${s.notificationsFired}`,
    `- suppressed: ${s.notificationsSuppressed}`,
    `- escalated: ${s.notificationsEscalated}`,
    '',
    '## Degraded feeds',
    ...renderDegradedFeeds(input.degradedFeeds),
    '',
    `_Generated ${new Date(input.now).toISOString()} by Crystal Ball operator mode._`,
  ].join('\n');
}

/** Convenience: parse a {@link HistoryDomain} → user-facing label. */
export function labelForHistoryDomain(d: HistoryDomain): string {
  switch (d) {
    case 'seismic': { return 'Seismic';
    }
    case 'geomagnetic': { return 'Geomagnetic';
    }
    case 'solar_flare': { return 'Solar Flare';
    }
    case 'cap': { return 'CAP';
    }
    case 'hurricane': { return 'Hurricane';
    }
    case 'wildfire': { return 'Wildfire';
    }
    case 'air_quality': { return 'Air Quality';
    }
    case 'market': { return 'Market';
    }
    case 'cyber': { return 'Cyber';
    }
    default: { return 'Unknown';
    }
  }
}
