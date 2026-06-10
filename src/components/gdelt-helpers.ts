// gdelt-helpers.ts
// Pure logic for GdeltPanel -- no DOM, no Panel imports.
//
// GDELT "tone" runs -100..+100 in theory but in practice clusters around
// -10..+10. Band boundaries follow the GDELT remediation spec: crisis is
// strictly below -5; exact boundary values (-5, -2, +2) belong to the
// *less severe* band.

export interface GdeltSummary {
  tone: number;
  topThemes: { theme: string; count: number }[];
  topLocations: { name: string; count: number }[];
  topPeople: { name: string; count: number }[];
  topOrgs: { name: string; count: number }[];
  fetchedAt: string;
}

export type ToneClass = 'positive' | 'neutral' | 'negative' | 'crisis';

const FILLED = '█';
const EMPTY = '░';

/** Human-readable tone band. */
export function parseToneDescription(tone: number): string {
  switch (getToneClass(tone)) {
    case 'crisis': { return 'Extremely Negative';
    }
    case 'negative': { return 'Negative';
    }
    case 'positive': { return 'Positive';
    }
    default: { return 'Neutral';
    }
  }
}

/** Four-band severity class. crisis < -5 <= negative < -2 <= neutral <= 2 < positive. */
export function getToneClass(tone: number): ToneClass {
  if (tone < -5) return 'crisis';
  if (tone < -2) return 'negative';
  if (tone <= 2) return 'neutral';
  return 'positive';
}

/** Fixed-width unicode bar. Always returns exactly `width` chars. */
export function buildBarChart(value: number, max: number, width = 10): string {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0 || width <= 0) {
    return EMPTY.repeat(Math.max(0, width));
  }
  const ratio = Math.min(1, Math.max(0, value / max));
  const filled = Math.min(width, Math.max(0, Math.round(ratio * width)));
  return FILLED.repeat(filled) + EMPTY.repeat(width - filled);
}

// Leading taxonomy prefixes GDELT GKG themes carry before the readable label.
const THEME_PREFIXES = new Set([
  'WB', 'TAX', 'FNCACT', 'EPU', 'ECON', 'CRISISLEX', 'UNGP', 'SOC', 'EDU', 'ENV', 'USPEC', 'GEN',
]);

function isStrippablePrefix(token: string): boolean {
  return (
    THEME_PREFIXES.has(token) ||
    /^\d+$/.test(token) ||          // numeric segment, e.g. 635, 2024
    /^[A-Z]+\d+$/.test(token)       // code segment, e.g. C03
  );
}

function titleCaseToken(token: string): string {
  if (token === 'AND') return '&';
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

/** 'WB_635_CONFLICT_AND_VIOLENCE' -> 'Conflict & Violence'. */
export function formatThemeName(gdeltTheme: string): string {
  if (!gdeltTheme) return '';
  const tokens = gdeltTheme.split('_').filter(Boolean);
  if (!tokens.length) return '';

  let start = 0;
  while (start < tokens.length && isStrippablePrefix(tokens[start]!)) start++;

  // If stripping consumed everything, fall back to the raw tokens.
  const meaningful = start < tokens.length ? tokens.slice(start) : tokens;
  return meaningful.map(t => titleCaseToken(t)).join(' ');
}

function normalizeCountRows<T extends { count: number }>(
  rows: T[] | undefined,
): T[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter(r => r && typeof r === 'object');
}

// ── Raw GDELT DOC API → GdeltSummary mapping ──────────────────────────
//
// The free GDELT 2.0 DOC API exposes tone (mode=timelinetone) and an article
// list (mode=artlist) as JSON. It does NOT surface the GKG theme/person/org
// rollups that the (HTML-only) summary endpoint shows. So we derive:
//   - tone         from the latest finite timelinetone value
//   - topLocations from article sourcecountry frequency (real)
//   - topThemes    from a transparent keyword tally over real headlines
//   - topPeople / topOrgs stay empty — not fabricated from a path that
//     cannot supply them honestly.
//
// THEME_SIGNALS is mirrored verbatim in the sidecar route
// (src-tauri/sidecar/local-api-server.mjs, fetchGdeltSummary). Keep in sync.
export const THEME_SIGNALS: [label: string, pattern: RegExp][] = [
  ['Conflict & Violence', /\b(war|wars|attack|attacks|strike|strikes|clash|clashes|fighting|killed|kills|troops|missile|missiles|shelling|combat|offensive)\b/i],
  ['Protest & Unrest', /\b(protest|protests|riot|riots|unrest|rally|uprising|demonstration|demonstrations)\b/i],
  ['Military & Defense', /\b(military|army|navy|defense|defence|nato|weapon|weapons|drone|drones|warship|warships|deploy|deployment)\b/i],
  ['Economy & Trade', /\b(economy|economic|inflation|trade|tariff|tariffs|market|markets|recession|currency|sanction|sanctions)\b/i],
  ['Diplomacy', /\b(talks|summit|treaty|negotiation|negotiations|diplomat|diplomatic|ceasefire|accord|envoy)\b/i],
  ['Disaster & Crisis', /\b(flood|floods|earthquake|storm|storms|wildfire|wildfires|hurricane|disaster|drought|famine)\b/i],
  ['Energy', /\b(oil|gas|pipeline|fuel|nuclear|grid|electricity|electric)\b/i],
  ['Security & Terror', /\b(terror|terrorist|bomb|bombing|hostage|insurgent|insurgency|extremist|militant|militants|kidnap)\b/i],
];

const MAX_LOCATIONS = 8;

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function latestFiniteTone(toneJson: unknown): number {
  const timeline = asArray((toneJson as { timeline?: unknown })?.timeline);
  const series = timeline.find(
    (s): s is { data?: unknown } => !!s && typeof s === 'object',
  );
  const data = asArray((series as { data?: unknown })?.data);
  let tone = 0;
  for (const point of data) {
    if (!point || typeof point !== 'object') continue;
    const v = (point as { value?: unknown }).value;
    if (typeof v === 'number' && Number.isFinite(v)) tone = v;
  }
  return tone;
}

function countLocations(articles: unknown[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const a of articles) {
    if (!a || typeof a !== 'object') continue;
    const raw = (a as { sourcecountry?: unknown }).sourcecountry;
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_LOCATIONS);
}

function tallyThemes(articles: unknown[]): { theme: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const a of articles) {
    if (!a || typeof a !== 'object') continue;
    const title = (a as { title?: unknown }).title;
    if (typeof title !== 'string' || !title) continue;
    for (const [label, pattern] of THEME_SIGNALS) {
      if (pattern.test(title)) counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([theme, count]) => ({ theme, count }))
    .filter(r => r.count > 0)
    .sort((a, b) => b.count - a.count);
}

/**
 * Maps raw GDELT DOC API responses (timelinetone + artlist) into a
 * GdeltSummary. Pure and deterministic — `fetchedAt` is supplied by the
 * caller. Tolerant of throttled/garbage input (returns a valid empty-ish
 * summary rather than throwing).
 */
export function mapGdeltResponse(
  toneJson: unknown,
  artlistJson: unknown,
  fetchedAt: string,
): GdeltSummary {
  const articles = asArray((artlistJson as { articles?: unknown })?.articles);
  return {
    tone: latestFiniteTone(toneJson),
    topThemes: tallyThemes(articles),
    topLocations: countLocations(articles),
    topPeople: [],
    topOrgs: [],
    fetchedAt,
  };
}

/** Defensive parse of untrusted sidecar JSON into a complete GdeltSummary. */
export function normalizeSummary(raw: Partial<GdeltSummary> | null | undefined): GdeltSummary {
  const r = raw ?? {};
  const tone = typeof r.tone === 'number' && Number.isFinite(r.tone) ? r.tone : 0;
  return {
    tone,
    topThemes: normalizeCountRows(r.topThemes),
    topLocations: normalizeCountRows(r.topLocations),
    topPeople: normalizeCountRows(r.topPeople),
    topOrgs: normalizeCountRows(r.topOrgs),
    fetchedAt: typeof r.fetchedAt === 'string' ? r.fetchedAt : '',
  };
}
