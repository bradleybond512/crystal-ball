/**
 * Geopolitical Event Calendar — tracks scheduled events that may trigger
 * intelligence alerts (elections, summits, treaty deadlines, sanctions
 * reviews, military exercises). Each event carries a risk tag, an
 * explanation, the affected domains, and a country/region tag so the
 * Crystal Ball UI can give operators advance warning.
 *
 * Pure store: injectable Storage + clock. Events persist in a 500-record
 * ring buffer under `wm-geopolitical-calendar`. Twelve built-in events
 * seed on first use; reseeding is idempotent (gated by a separate
 * `wm-geopolitical-calendar-seeded` flag so manual deletes don't reseed
 * across instances).
 */

// ── Public types ─────────────────────────────────────────────────────────

export type CalendarEventType =
  | 'election'
  | 'summit'
  | 'treaty-deadline'
  | 'sanctions-review'
  | 'military-exercise'
  | 'economic-release'
  | 'other';

export type CalendarEventRisk = 'low' | 'medium' | 'high' | 'critical';

export interface CalendarEvent {
  id: string;
  type: CalendarEventType;
  title: string;
  description: string;
  country: string;
  region: string;
  scheduledAt: number;
  domains: string[];
  riskLevel: CalendarEventRisk;
  riskRationale: string;
  tags: string[];
  source: string;
  createdAt: number;
  acknowledged: boolean;
}

export interface CalendarSummary {
  upcoming7Days: CalendarEvent[];
  upcoming30Days: CalendarEvent[];
  highRiskCount: number;
  byType: Record<CalendarEventType, number>;
}

export interface UpcomingFilter {
  type?: CalendarEventType;
  riskLevel?: CalendarEventRisk;
  domain?: string;
  country?: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface GeopoliticalEventCalendarOptions {
  storage?: StorageLike | null;
  now?: () => number;
}

export interface GeopoliticalEventCalendar {
  add(event: Omit<CalendarEvent, 'id' | 'createdAt' | 'acknowledged'>): CalendarEvent;
  acknowledge(id: string): void;
  getUpcoming(withinMs: number, filter?: UpcomingFilter): CalendarEvent[];
  getPast(limit?: number): CalendarEvent[];
  getSummary(): CalendarSummary;
  subscribe(cb: (events: CalendarEvent[]) => void): void;
  unsubscribe(cb: (events: CalendarEvent[]) => void): void;
}

export type SeedEvent = Omit<CalendarEvent, 'id' | 'createdAt' | 'acknowledged' | 'scheduledAt'> & {
  /** Days until event from service init time. */
  daysUntil: number;
};

// ── Constants ────────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-geopolitical-calendar';
export const SEEDED_FLAG_KEY = 'wm-geopolitical-calendar-seeded';
export const MAX_EVENTS = 500;

const DAY_MS = 24 * 60 * 60 * 1000;

export const BUILT_IN_SEED: readonly SeedEvent[] = [
  {
    type: 'summit',
    title: 'G7 leaders summit',
    description: 'Annual G7 heads-of-state meeting; agenda touches energy, sanctions, AI policy.',
    country: 'Italy',
    region: 'Europe',
    daysUntil: 90,
    domains: ['geopolitical'],
    riskLevel: 'high',
    riskRationale: 'Summit communiqués historically shift sanctions and trade posture inside 72h.',
    tags: ['g7', 'summit'],
    source: 'seed',
  },
  {
    type: 'election',
    title: 'United States midterm elections',
    description: 'House + Senate cycles; outcome reshapes committee chairs handling defense + intel.',
    country: 'USA',
    region: 'North America',
    daysUntil: 180,
    domains: ['geopolitical'],
    riskLevel: 'high',
    riskRationale: 'Power balance shift; post-election lame-duck sessions tend to push major bills.',
    tags: ['election', 'usa'],
    source: 'seed',
  },
  {
    type: 'military-exercise',
    title: 'NATO Baltic Operations (BALTOPS)',
    description: 'Annual joint maritime exercise across the Baltic Sea.',
    country: 'Multinational',
    region: 'Europe',
    daysUntil: 45,
    domains: ['geopolitical', 'maritime'],
    riskLevel: 'medium',
    riskRationale: 'Heightened Russian air/maritime shadowing; AIS noise + airspace incidents.',
    tags: ['nato', 'baltops', 'exercise'],
    source: 'seed',
  },
  {
    type: 'economic-release',
    title: 'IMF World Economic Outlook update',
    description: 'IMF refreshes global growth + inflation forecasts.',
    country: 'Global',
    region: 'Global',
    daysUntil: 14,
    domains: ['geopolitical'],
    riskLevel: 'medium',
    riskRationale: 'Major revisions move FX + commodity markets and reframe sanctions feasibility.',
    tags: ['imf', 'macro'],
    source: 'seed',
  },
  {
    type: 'summit',
    title: 'UN Security Council quarterly review',
    description: 'Sanctions regime + peacekeeping mandate reviews.',
    country: 'USA',
    region: 'North America',
    daysUntil: 30,
    domains: ['geopolitical'],
    riskLevel: 'medium',
    riskRationale: 'Vetoes and resolutions shift conflict trajectories within days.',
    tags: ['unsc', 'sanctions'],
    source: 'seed',
  },
  {
    type: 'military-exercise',
    title: 'Taiwan strait PLA drill window',
    description: 'Expected PLA Eastern Theater drill; flashpoint for cross-strait posture.',
    country: 'China',
    region: 'Asia-Pacific',
    daysUntil: 60,
    domains: ['geopolitical', 'maritime', 'aviation'],
    riskLevel: 'critical',
    riskRationale: 'Air defense intercepts + ADIZ incursions; civil aviation reroutes.',
    tags: ['taiwan', 'pla', 'flashpoint'],
    source: 'seed',
  },
  {
    type: 'summit',
    title: 'OPEC+ ministerial meeting',
    description: 'Production-quota review; outcome drives crude pricing.',
    country: 'Austria',
    region: 'Europe',
    daysUntil: 21,
    domains: ['geopolitical'],
    riskLevel: 'high',
    riskRationale: 'Quota surprises drive ±5% crude moves and reshape sanctions enforceability.',
    tags: ['opec', 'oil'],
    source: 'seed',
  },
  {
    type: 'military-exercise',
    title: 'North Korea missile test window',
    description: 'Pattern-matched window for IRBM/ICBM tests around politically symbolic dates.',
    country: 'North Korea',
    region: 'Asia-Pacific',
    daysUntil: 30,
    domains: ['geopolitical', 'aviation'],
    riskLevel: 'critical',
    riskRationale: 'NOTAM closures; Japan/SoKo air defense activation; UNSC emergency sessions.',
    tags: ['dprk', 'missile'],
    source: 'seed',
  },
  {
    type: 'sanctions-review',
    title: 'EU sanctions package renewal',
    description: 'Periodic EU Council vote to renew/extend Russia + Belarus sanctions.',
    country: 'Belgium',
    region: 'Europe',
    daysUntil: 45,
    domains: ['geopolitical'],
    riskLevel: 'medium',
    riskRationale: 'Renewal failures or new tranches cascade through compliance + trade flows.',
    tags: ['eu', 'sanctions'],
    source: 'seed',
  },
  {
    type: 'summit',
    title: 'African Union summit',
    description: 'AU heads-of-state assembly; agenda includes coup recognition + trade pact.',
    country: 'Ethiopia',
    region: 'Africa',
    daysUntil: 60,
    domains: ['geopolitical'],
    riskLevel: 'low',
    riskRationale: 'Low immediate market impact but shapes Sahel stability narratives.',
    tags: ['au', 'africa'],
    source: 'seed',
  },
  {
    type: 'summit',
    title: 'WHO pandemic preparedness review',
    description: 'WHO Executive Board review of IHR amendments + pandemic accord progress.',
    country: 'Switzerland',
    region: 'Europe',
    daysUntil: 90,
    domains: ['biosurv'],
    riskLevel: 'medium',
    riskRationale: 'Treaty progress changes biosurveillance + travel restriction calculus.',
    tags: ['who', 'biosurveillance'],
    source: 'seed',
  },
  {
    type: 'summit',
    title: 'Indo-Pacific security forum (Shangri-La Dialogue)',
    description: 'Defense ministers + senior officials track convene in Singapore.',
    country: 'Singapore',
    region: 'Asia-Pacific',
    daysUntil: 120,
    domains: ['geopolitical', 'maritime'],
    riskLevel: 'high',
    riskRationale: 'Posture statements from US/PRC/regional players reshape SCS expectations.',
    tags: ['shangrila', 'indo-pacific'],
    source: 'seed',
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────

let _idCounter = 0;
function nextId(nowMs: number): string {
  _idCounter += 1;
  return `cal-${nowMs.toString(36)}-${_idCounter.toString(36)}`;
}

function resolveLocalStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof globalThis !== 'undefined') {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (ls && typeof ls.getItem === 'function') return ls;
  }
  return null;
}

function isType(t: unknown): t is CalendarEventType {
  return (
    t === 'election' ||
    t === 'summit' ||
    t === 'treaty-deadline' ||
    t === 'sanctions-review' ||
    t === 'military-exercise' ||
    t === 'economic-release' ||
    t === 'other'
  );
}

function isRisk(r: unknown): r is CalendarEventRisk {
  return r === 'low' || r === 'medium' || r === 'high' || r === 'critical';
}

function cloneEvent(e: CalendarEvent): CalendarEvent {
  return { ...e, domains: [...e.domains], tags: [...e.tags] };
}

function deserialize(raw: unknown): CalendarEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string') return null;
  if (!isType(r.type)) return null;
  if (!isRisk(r.riskLevel)) return null;
  if (typeof r.scheduledAt !== 'number') return null;
  if (typeof r.createdAt !== 'number') return null;
  return {
    id: r.id,
    type: r.type,
    title: typeof r.title === 'string' ? r.title : '',
    description: typeof r.description === 'string' ? r.description : '',
    country: typeof r.country === 'string' ? r.country : '',
    region: typeof r.region === 'string' ? r.region : '',
    scheduledAt: r.scheduledAt,
    domains: Array.isArray(r.domains) ? r.domains.filter((d): d is string => typeof d === 'string') : [],
    riskLevel: r.riskLevel,
    riskRationale: typeof r.riskRationale === 'string' ? r.riskRationale : '',
    tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string') : [],
    source: typeof r.source === 'string' ? r.source : 'unknown',
    createdAt: r.createdAt,
    acknowledged: r.acknowledged === true,
  };
}

function rehydrate(storage: StorageLike | null): CalendarEvent[] {
  if (!storage) return [];
  let raw: string | null;
  try { raw = storage.getItem(STORAGE_KEY); } catch { return []; }
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: CalendarEvent[] = [];
  for (const p of parsed) {
    const d = deserialize(p);
    if (d) out.push(d);
  }
  return out;
}

function emptyByType(): Record<CalendarEventType, number> {
  return {
    election: 0,
    summit: 0,
    'treaty-deadline': 0,
    'sanctions-review': 0,
    'military-exercise': 0,
    'economic-release': 0,
    other: 0,
  };
}

// ── Factory ──────────────────────────────────────────────────────────────

export function createGeopoliticalEventCalendar(
  options: GeopoliticalEventCalendarOptions = {},
): GeopoliticalEventCalendar {
  const storage = resolveLocalStorage(options.storage);
  const clock = options.now ?? (() => Date.now());
  const events: CalendarEvent[] = rehydrate(storage);
  const listeners = new Set<(events: CalendarEvent[]) => void>();

  function persist(): void {
    if (!storage) return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(events));
    } catch { /* quota / private-mode — non-critical */ }
  }

  function capRingBuffer(): void {
    if (events.length > MAX_EVENTS) {
      events.splice(0, events.length - MAX_EVENTS);
    }
  }

  function notify(): void {
    const snapshot = events.map((e) => cloneEvent(e));
    for (const cb of listeners) {
      try { cb(snapshot); } catch { /* listener crash isolation */ }
    }
  }

  function seedBuiltInIfNeeded(): void {
    if (!storage) return;
    let alreadySeeded: string | null = null;
    try { alreadySeeded = storage.getItem(SEEDED_FLAG_KEY); } catch { /* private-mode */ }
    if (alreadySeeded === '1') return;
    const nowMs = clock();
    for (const seed of BUILT_IN_SEED) {
      events.push({
        id: nextId(nowMs),
        type: seed.type,
        title: seed.title,
        description: seed.description,
        country: seed.country,
        region: seed.region,
        scheduledAt: nowMs + seed.daysUntil * DAY_MS,
        domains: [...seed.domains],
        riskLevel: seed.riskLevel,
        riskRationale: seed.riskRationale,
        tags: [...seed.tags],
        source: seed.source,
        createdAt: nowMs,
        acknowledged: false,
      });
    }
    capRingBuffer();
    persist();
    try { storage.setItem(SEEDED_FLAG_KEY, '1'); } catch { /* non-critical */ }
  }

  seedBuiltInIfNeeded();

  function matchesFilter(e: CalendarEvent, filter: UpcomingFilter | undefined): boolean {
    if (!filter) return true;
    if (filter.type !== undefined && e.type !== filter.type) return false;
    if (filter.riskLevel !== undefined && e.riskLevel !== filter.riskLevel) return false;
    if (filter.country !== undefined && e.country !== filter.country) return false;
    if (filter.domain !== undefined && !e.domains.includes(filter.domain)) return false;
    return true;
  }

  return {
    add(input): CalendarEvent {
      const nowMs = clock();
      const ev: CalendarEvent = {
        id: nextId(nowMs),
        type: input.type,
        title: input.title,
        description: input.description,
        country: input.country,
        region: input.region,
        scheduledAt: input.scheduledAt,
        domains: [...input.domains],
        riskLevel: input.riskLevel,
        riskRationale: input.riskRationale,
        tags: [...input.tags],
        source: input.source,
        createdAt: nowMs,
        acknowledged: false,
      };
      events.push(ev);
      capRingBuffer();
      persist();
      notify();
      return cloneEvent(ev);
    },

    acknowledge(id): void {
      const ev = events.find((e) => e.id === id);
      if (!ev) return;
      if (ev.acknowledged) return;
      ev.acknowledged = true;
      persist();
      notify();
    },

    getUpcoming(withinMs, filter): CalendarEvent[] {
      const nowMs = clock();
      const horizon = nowMs + withinMs;
      const out: CalendarEvent[] = [];
      for (const e of events) {
        if (e.scheduledAt <= nowMs) continue;
        if (e.scheduledAt > horizon) continue;
        if (!matchesFilter(e, filter)) continue;
        out.push(cloneEvent(e));
      }
      out.sort((a, b) => a.scheduledAt - b.scheduledAt);
      return out;
    },

    getPast(limit): CalendarEvent[] {
      const nowMs = clock();
      const past = events.filter((e) => e.scheduledAt <= nowMs).map((e) => cloneEvent(e));
      past.sort((a, b) => b.scheduledAt - a.scheduledAt);
      return limit === undefined ? past : past.slice(0, limit);
    },

    getSummary(): CalendarSummary {
      const nowMs = clock();
      const horizon7 = nowMs + 7 * DAY_MS;
      const horizon30 = nowMs + 30 * DAY_MS;
      const upcoming7Days: CalendarEvent[] = [];
      const upcoming30Days: CalendarEvent[] = [];
      const byType = emptyByType();
      let highRiskCount = 0;
      for (const e of events) {
        if (e.scheduledAt <= nowMs) continue;
        byType[e.type] += 1;
        if (e.riskLevel === 'high' || e.riskLevel === 'critical') highRiskCount += 1;
        if (e.scheduledAt <= horizon7) upcoming7Days.push(cloneEvent(e));
        if (e.scheduledAt <= horizon30) upcoming30Days.push(cloneEvent(e));
      }
      upcoming7Days.sort((a, b) => a.scheduledAt - b.scheduledAt);
      upcoming30Days.sort((a, b) => a.scheduledAt - b.scheduledAt);
      return { upcoming7Days, upcoming30Days, highRiskCount, byType };
    },

    subscribe(cb): void {
      listeners.add(cb);
    },

    unsubscribe(cb): void {
      listeners.delete(cb);
    },
  };
}

// ── Singleton ────────────────────────────────────────────────────────────

let _singleton: GeopoliticalEventCalendar | null = null;

export function getGeopoliticalEventCalendar(): GeopoliticalEventCalendar {
  _singleton ??= createGeopoliticalEventCalendar();
  return _singleton;
}

export function resetGeopoliticalEventCalendarForTests(): void {
  _singleton = null;
}
