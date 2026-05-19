/**
 * PersonalResilienceModel — derives a per-user risk and resilience
 * profile from saved places, active travel windows, the domains the
 * user has opted into, and their historical alert exposure.
 *
 * Pure, no DOM, no fetch. Storage is optional — when localStorage is
 * available, profiles hydrate on construction and persist on every
 * mutation. Tests call `resetForTests()` to drop the singleton.
 *
 * Scoring (per opted-in domain):
 *   alertsNormalized = min(alertsReceivedForDomain / 50, 1)
 *   regionOverlap    = travelWindows.filter(savedPlaces ∋ region).length
 *                      / max(savedPlaces.length, 1)
 *   domainInterest   = 1 (any domain in this loop is opted-in by
 *                         definition; non-interest domains never enter)
 *   exposure         = alertsNormalized * 0.4
 *                    + regionOverlap   * 0.4
 *                    + domainInterest  * 0.2
 *
 * Overall resilience = 1 − mean(exposure) across opted-in domains,
 * clamped to [0,1]. No opted-in domains ⇒ resilience 1.0.
 */

export const PERSONAL_RESILIENCE_KEY = 'wm-personal-resilience';
export const MAX_PROFILES = 10;
export const DEFAULT_USER_ID = 'default';
export const ALERT_COUNT_CEILING = 50;

export type PreparednessLevel = 'low' | 'medium' | 'high';

export interface DomainExposure {
  domain: string;
  /** 0–1 — overall exposure score for this domain. */
  exposureLevel: number;
  /** Regions the user has presence in for this domain (saved places). */
  relevantRegions: string[];
  /** Raw count of alerts in `alertHistory` whose `domain` matches. */
  alertsReceived: number;
}

export interface ResilienceProfile {
  userId: string;
  /** 0–1 — higher is better. 1 − mean(exposureLevel). */
  overallResilienceScore: number;
  riskExposure: DomainExposure[];
  preparednessLevel: PreparednessLevel;
  /** Domains sorted by exposureLevel desc, capped at 3. */
  topRisks: string[];
  /** Actionable suggestions derived from the top-exposure domains. */
  recommendations: string[];
  /** ms-epoch when this profile was last computed. */
  lastUpdated: number;
}

export interface TravelWindow {
  region: string;
  startMs: number;
  endMs: number;
}

export interface AlertHistoryEntry {
  domain: string;
  /** 0–1 — kept on the API surface so future scoring tweaks can weight
   *  the alert stream by severity. The current model uses raw count. */
  severity: number;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    const g = globalThis as { localStorage?: StorageLike };
    return g.localStorage ?? null;
  } catch {
    return null;
  }
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function preparednessLevelFor(resilience: number): PreparednessLevel {
  const r = clampUnit(resilience);
  if (r >= 0.7) return 'high';
  if (r >= 0.4) return 'medium';
  return 'low';
}

function isPreparednessLevel(value: unknown): value is PreparednessLevel {
  return value === 'low' || value === 'medium' || value === 'high';
}

function coerceDomainExposure(raw: unknown): DomainExposure | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.domain !== 'string'
    || typeof r.exposureLevel !== 'number'
    || !Array.isArray(r.relevantRegions)
    || typeof r.alertsReceived !== 'number'
  ) {
    return null;
  }
  const regions = r.relevantRegions.filter((x): x is string => typeof x === 'string');
  return {
    domain: r.domain,
    exposureLevel: clampUnit(r.exposureLevel),
    relevantRegions: regions,
    alertsReceived: Math.max(0, Math.floor(r.alertsReceived)),
  };
}

function coerceProfile(raw: unknown): ResilienceProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.userId !== 'string'
    || typeof r.overallResilienceScore !== 'number'
    || !Array.isArray(r.riskExposure)
    || !isPreparednessLevel(r.preparednessLevel)
    || !Array.isArray(r.topRisks)
    || !Array.isArray(r.recommendations)
    || typeof r.lastUpdated !== 'number'
  ) {
    return null;
  }
  const exposures: DomainExposure[] = [];
  for (const entry of r.riskExposure) {
    const coerced = coerceDomainExposure(entry);
    if (coerced) exposures.push(coerced);
  }
  return {
    userId: r.userId,
    overallResilienceScore: clampUnit(r.overallResilienceScore),
    riskExposure: exposures,
    preparednessLevel: r.preparednessLevel,
    topRisks: r.topRisks.filter((x): x is string => typeof x === 'string'),
    recommendations: r.recommendations.filter((x): x is string => typeof x === 'string'),
    lastUpdated: r.lastUpdated,
  };
}

function recommendationFor(domain: string, exposure: number, topRegion: string | undefined): string {
  const region = topRegion ? ` for ${topRegion}` : '';
  if (exposure >= 0.7) {
    return `High ${domain} exposure${region}: review your preparedness checklist and confirm alert thresholds.`;
  }
  if (exposure >= 0.4) {
    return `Moderate ${domain} exposure${region}: keep an eye on incoming alerts and refresh your contact tree.`;
  }
  return `Low ${domain} exposure${region}: stay subscribed and revisit monthly.`;
}

export interface UpdateProfileInput {
  savedPlaces: string[];
  travelWindows: TravelWindow[];
  domainInterests: string[];
  alertHistory: AlertHistoryEntry[];
}

export class PersonalResilienceModel {
  private static instance: PersonalResilienceModel | null = null;
  private profiles = new Map<string, ResilienceProfile>();
  private storage: StorageLike | null;

  private constructor(storage: StorageLike | null) {
    this.storage = storage;
    this.load();
  }

  static getInstance(): PersonalResilienceModel {
    PersonalResilienceModel.instance ??= new PersonalResilienceModel(defaultStorage());
    return PersonalResilienceModel.instance;
  }

  /** Test helper — drops the singleton and re-hydrates from the given storage. */
  static resetForTests(storage: StorageLike | null = null): PersonalResilienceModel {
    PersonalResilienceModel.instance = new PersonalResilienceModel(storage);
    return PersonalResilienceModel.instance;
  }

  /**
   * Compute a fresh profile for the default user. Each opted-in
   * domain produces one `DomainExposure` row; the overall resilience
   * is `1 − mean(exposure)` across those rows.
   *
   * `userId` is fixed to DEFAULT_USER_ID per the current product
   * shape — `MAX_PROFILES` reserves room for a future per-user API.
   */
  updateProfile(
    savedPlaces: string[],
    travelWindows: TravelWindow[],
    domainInterests: string[],
    alertHistory: AlertHistoryEntry[],
    now: number = Date.now(),
  ): ResilienceProfile {
    const uniqueDomains = uniqueStrings(domainInterests);
    const uniquePlaces = uniqueStrings(savedPlaces);

    const exposures: DomainExposure[] = uniqueDomains.map((domain) => {
      const alertsReceived = alertHistory.filter((a) => a.domain === domain).length;
      const exposureLevel = computeExposure(alertsReceived, uniquePlaces, travelWindows);
      return {
        domain,
        exposureLevel,
        relevantRegions: [...uniquePlaces],
        alertsReceived,
      };
    });

    const meanExposure = exposures.length === 0
      ? 0
      : exposures.reduce((sum, e) => sum + e.exposureLevel, 0) / exposures.length;
    const overallResilienceScore = round4(clampUnit(1 - meanExposure));
    const preparednessLevel = preparednessLevelFor(overallResilienceScore);

    const sorted = [...exposures].sort((a, b) => b.exposureLevel - a.exposureLevel);
    const topRisks = sorted.slice(0, 3).map((e) => e.domain);
    const recommendations = sorted
      .slice(0, 3)
      .map((e) => recommendationFor(e.domain, e.exposureLevel, e.relevantRegions[0]));

    const profile: ResilienceProfile = {
      userId: DEFAULT_USER_ID,
      overallResilienceScore,
      riskExposure: exposures,
      preparednessLevel,
      topRisks,
      recommendations,
      lastUpdated: now,
    };

    this.profiles.set(profile.userId, profile);
    this.evictIfNeeded();
    this.persist();
    return profile;
  }

  getProfile(userId: string = DEFAULT_USER_ID): ResilienceProfile | undefined {
    return this.profiles.get(userId);
  }

  getRecommendations(userId: string = DEFAULT_USER_ID): string[] {
    return this.profiles.get(userId)?.recommendations ?? [];
  }

  getAllProfiles(): ResilienceProfile[] {
    return [...this.profiles.values()];
  }

  clear(): void {
    this.profiles.clear();
    this.persist();
  }

  private evictIfNeeded(): void {
    if (this.profiles.size <= MAX_PROFILES) return;
    const sorted = [...this.profiles.entries()]
      .sort((a, b) => a[1].lastUpdated - b[1].lastUpdated);
    const toEvict = this.profiles.size - MAX_PROFILES;
    for (let i = 0; i < toEvict; i++) {
      const entry = sorted[i];
      if (entry) this.profiles.delete(entry[0]);
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(PERSONAL_RESILIENCE_KEY, JSON.stringify([...this.profiles.values()]));
    } catch {
      // Quota errors and the like — drop the write rather than crash a render.
    }
  }

  private load(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(PERSONAL_RESILIENCE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      for (const entry of parsed) {
        const profile = coerceProfile(entry);
        if (profile) this.profiles.set(profile.userId, profile);
      }
    } catch {
      // Malformed storage → start empty; alternative is leaving the
      // user stuck with no profile and no clear recovery path.
    }
  }
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (typeof v !== 'string' || v.length === 0) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export function computeExposure(
  alertsReceived: number,
  savedPlaces: readonly string[],
  travelWindows: readonly TravelWindow[],
): number {
  const safeAlerts = Math.max(0, Math.floor(alertsReceived));
  const alertsNormalized = Math.min(safeAlerts / ALERT_COUNT_CEILING, 1);
  const placeSet = new Set(savedPlaces);
  const overlapCount = travelWindows.reduce(
    (n, w) => (placeSet.has(w.region) ? n + 1 : n),
    0,
  );
  const regionOverlap = clampUnit(overlapCount / Math.max(savedPlaces.length, 1));
  const domainInterest = 1;
  return round4(clampUnit(alertsNormalized * 0.4 + regionOverlap * 0.4 + domainInterest * 0.2));
}
