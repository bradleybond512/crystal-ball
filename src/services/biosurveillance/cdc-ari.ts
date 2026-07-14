/**
 * CDC Acute Respiratory Illness (ARI) by state — pure helpers.
 *
 * Source: https://data.cdc.gov/resource/f3zz-zga5.json (SODA, no auth).
 * Each row is one state-week with a categorical activity label.
 *
 * Sidecar endpoint: /api/cdc-ari proxies the SODA query.
 *
 * Pure-deterministic. No fetch, no globals.
 */

export type AriLevel =
  | 'Minimal'
  | 'Very Low'
  | 'Low'
  | 'Moderate'
  | 'High'
  | 'Very High'
  | 'Data Unavailable';

export interface AriRowRaw {
  /** ISO datetime — start of the reporting week (CDC reports week-ending). */
  week_end?: string;
  geography?: string;
  label?: string;
  buildnumber?: string;
}

export interface AriStateLevel {
  state: string;
  weekEnd: string;
  level: AriLevel;
  /** Numeric severity 0..5, or null when label is "Data Unavailable". */
  severity: number | null;
}

export interface AriSnapshot {
  weekEnd: string | null;
  rows: AriStateLevel[];
  /** Counts by level. */
  byLevel: Record<AriLevel, number>;
  /** Number of states (excluding territories without data). */
  reportingStates: number;
  /** Sum of states whose level is High or Very High. */
  hotStates: number;
}

const ALL_LEVELS: readonly AriLevel[] = [
  'Minimal',
  'Very Low',
  'Low',
  'Moderate',
  'High',
  'Very High',
  'Data Unavailable',
];

/** Maps the categorical CDC label to a 0..5 severity score so the
 *  panel can color-code consistently. "Data Unavailable" returns null. */
export function severityForLevel(level: AriLevel): number | null {
  switch (level) {
    case 'Minimal':
    case 'Very Low': {
      return 0;
    }
    case 'Low': {
      return 1;
    }
    case 'Moderate': {
      return 2;
    }
    case 'High': {
      return 4;
    }
    case 'Very High': {
      return 5;
    }
    default: {
      return null;
    }
  }
}

function isAriLevel(s: unknown): s is AriLevel {
  return typeof s === 'string' && (ALL_LEVELS as readonly string[]).includes(s);
}

/** Parse a single SODA row. Returns null when fields are missing or
 *  the label is not a recognized AriLevel. */
export function parseAriRow(raw: AriRowRaw): AriStateLevel | null {
  if (!raw.geography || !raw.week_end) return null;
  if (!isAriLevel(raw.label)) return null;
  // Trim the time portion if present; CDC publishes "YYYY-MM-DDT00:00:00.000".
  const weekEnd = raw.week_end.slice(0, 10);
  return {
    state: raw.geography,
    weekEnd,
    level: raw.label,
    severity: severityForLevel(raw.label),
  };
}

/**
 * Reduce a SODA response to an AriSnapshot. Keeps only the most-recent
 * week per state (in case the response includes history).
 */
export function buildAriSnapshot(rows: readonly AriRowRaw[]): AriSnapshot {
  const latestByState = new Map<string, AriStateLevel>();
  for (const raw of rows) {
    const parsed = parseAriRow(raw);
    if (!parsed) continue;
    const cur = latestByState.get(parsed.state);
    if (!cur || parsed.weekEnd > cur.weekEnd) {
      latestByState.set(parsed.state, parsed);
    }
  }

  const out = [...latestByState.values()];
  // Sort by severity desc (nulls last), then state name.
  out.sort((a, b) => {
    const sa = a.severity ?? -1;
    const sb = b.severity ?? -1;
    if (sb !== sa) return sb - sa;
    return a.state.localeCompare(b.state);
  });

  const byLevel = Object.fromEntries(ALL_LEVELS.map((l) => [l, 0])) as Record<AriLevel, number>;
  let weekEnd: string | null = null;
  let reportingStates = 0;
  for (const r of out) {
    byLevel[r.level] += 1;
    if (r.level !== 'Data Unavailable') reportingStates += 1;
    if (!weekEnd || r.weekEnd > weekEnd) weekEnd = r.weekEnd;
  }
  const hotStates = byLevel.High + byLevel['Very High'];

  return { weekEnd, rows: out, byLevel, reportingStates, hotStates };
}

/** Returns a CSS hex color for a level — used by the panel. */
export function colorForLevel(level: AriLevel): string {
  switch (level) {
    case 'Very High': {
      return '#ff453a';
    }
    case 'High': {
      return '#ff5722';
    }
    case 'Moderate': {
      return '#ff9800';
    }
    case 'Low': {
      return '#ffeb3b';
    }
    case 'Very Low':
    case 'Minimal': {
      return '#4caf50';
    }
    default: {
      return '#666666';
    }
  }
}
