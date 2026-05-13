/**
 * Notification preferences — per-domain mute / threshold / channel /
 * quiet-hours-override settings, plus global toggles.
 *
 * This is a thin, deterministic store: pure functions over an in-memory
 * Preferences object, persisted to localStorage on every mutation. The
 * Panel layer calls the singleton; tests inject their own Storage.
 *
 * Coexists with the older notification-settings-service.ts (different
 * channel taxonomy + threshold model). Producers can opt into this
 * service for the new fine-grained per-channel surface.
 */

export type NotificationChannel = 'system' | 'sms' | 'email' | 'menubar';
export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface DomainPreference {
  domain: string;
  enabled: boolean;
  minSeverity: Severity;
  channels: NotificationChannel[];
  /** true = send even during quiet hours (overrides the global window). */
  quietHoursOverride: boolean;
}

export interface QuietHours {
  enabled: boolean;
  /** Inclusive — quiet at startHour:00. */
  startHour: number;
  /** Exclusive — first non-quiet hour. Supports midnight rollover when
   *  start > end (e.g. start=22, end=6 covers 22:00 → 05:59). */
  endHour: number;
}

export interface NotificationPreferences {
  domains: DomainPreference[];
  quietHours: QuietHours;
  globalEnabled: boolean;
  rateLimitPerHour: number;
}

export const STORAGE_KEY = 'wm-notification-preferences';

export const DEFAULT_DOMAINS = [
  'earthquake',
  'weather',
  'wildfire',
  'maritime',
  'aviation',
  'biosurveillance',
  'space-weather',
  'cyber',
  'sanctions',
  'intelligence',
] as const;

const SEVERITY_RANK: Record<Severity, number> = {
  low: 0, medium: 1, high: 2, critical: 3,
};

/** Minimal subset of the DOM Storage interface the service needs. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface NotificationPreferencesService {
  getPreferences(): NotificationPreferences;
  setDomainPreference(domain: string, patch: Partial<Omit<DomainPreference, 'domain'>>): void;
  setQuietHours(qh: QuietHours): void;
  setGlobalEnabled(enabled: boolean): void;
  setRateLimitPerHour(n: number): void;
  isDomainEnabled(domain: string): boolean;
  isChannelEnabled(domain: string, channel: NotificationChannel): boolean;
  meetsThreshold(domain: string, severity: Severity): boolean;
  isQuietHour(now?: Date): boolean;
  subscribe(cb: (prefs: NotificationPreferences) => void): () => void;
  reset(): void;
}

function buildDefaults(): NotificationPreferences {
  return {
    domains: DEFAULT_DOMAINS.map((domain) => ({
      domain,
      enabled: true,
      minSeverity: 'medium',
      channels: ['system', 'menubar'],
      quietHoursOverride: false,
    })),
    quietHours: { enabled: false, startHour: 22, endHour: 6 },
    globalEnabled: true,
    rateLimitPerHour: 20,
  };
}

function clampHour(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(23, Math.floor(v)));
}

function isSeverity(s: unknown): s is Severity {
  return s === 'low' || s === 'medium' || s === 'high' || s === 'critical';
}

function isChannel(c: unknown): c is NotificationChannel {
  return c === 'system' || c === 'sms' || c === 'email' || c === 'menubar';
}

function sanitizeDomain(
  raw: unknown,
  defaults: NotificationPreferences,
): DomainPreference | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const name = typeof d.domain === 'string' ? d.domain : null;
  if (!name) return null;
  const base = defaults.domains.find((x) => x.domain === name) ?? {
    domain: name, enabled: true, minSeverity: 'medium' as Severity,
    channels: ['system', 'menubar'] as NotificationChannel[], quietHoursOverride: false,
  };
  const channels = Array.isArray(d.channels)
    ? (d.channels.filter((c) => isChannel(c)) as NotificationChannel[])
    : base.channels;
  return {
    domain: name,
    enabled: typeof d.enabled === 'boolean' ? d.enabled : base.enabled,
    minSeverity: isSeverity(d.minSeverity) ? d.minSeverity : base.minSeverity,
    channels: [...channels],
    quietHoursOverride: typeof d.quietHoursOverride === 'boolean'
      ? d.quietHoursOverride : base.quietHoursOverride,
  };
}

function sanitizeQuietHours(raw: unknown, defaults: QuietHours): QuietHours {
  if (!raw || typeof raw !== 'object') return defaults;
  const q = raw as Record<string, unknown>;
  return {
    enabled: typeof q.enabled === 'boolean' ? q.enabled : defaults.enabled,
    startHour: clampHour(q.startHour ?? defaults.startHour),
    endHour: clampHour(q.endHour ?? defaults.endHour),
  };
}

function sanitizeStored(raw: unknown): NotificationPreferences | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const defaults = buildDefaults();
  const domainsByName = new Map<string, DomainPreference>();
  if (Array.isArray(obj.domains)) {
    for (const item of obj.domains) {
      const sanitized = sanitizeDomain(item, defaults);
      if (sanitized) domainsByName.set(sanitized.domain, sanitized);
    }
  }
  // Ensure every default domain is present (newly-introduced domains land
  // with default settings rather than disappearing).
  const domains = defaults.domains.map((d) => domainsByName.get(d.domain) ?? d);
  const quietHours = sanitizeQuietHours(obj.quietHours, defaults.quietHours);
  const globalEnabled = typeof obj.globalEnabled === 'boolean'
    ? obj.globalEnabled : defaults.globalEnabled;
  const rateLimitPerHour = Number.isFinite(Number(obj.rateLimitPerHour))
    ? Math.max(1, Math.min(100, Math.floor(Number(obj.rateLimitPerHour))))
    : defaults.rateLimitPerHour;
  return { domains, quietHours, globalEnabled, rateLimitPerHour };
}

function tryResolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof globalThis !== 'undefined') {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (ls && typeof ls.getItem === 'function') return ls;
  }
  return null;
}

export function createNotificationPreferencesService(
  storage?: StorageLike,
): NotificationPreferencesService {
  const resolvedStorage = tryResolveStorage(storage);
  let prefs: NotificationPreferences = buildDefaults();
  const listeners = new Set<(p: NotificationPreferences) => void>();

  // Rehydrate
  if (resolvedStorage) {
    try {
      const raw = resolvedStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        const sanitized = sanitizeStored(parsed);
        if (sanitized) prefs = sanitized;
      }
    } catch {
      // Corrupt — keep defaults.
    }
  }

  function persistAndNotify(): void {
    if (resolvedStorage) {
      try {
        resolvedStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
      } catch {
        // Quota / private-mode — silently ignore; in-memory state is the
        // source of truth for the current session.
      }
    }
    const snapshot = clone(prefs);
    for (const cb of listeners) {
      try { cb(snapshot); } catch {
        // Defensive — a bad subscriber must not break the others.
      }
    }
  }

  function clone(p: NotificationPreferences): NotificationPreferences {
    return {
      domains: p.domains.map((d) => ({ ...d, channels: [...d.channels] })),
      quietHours: { ...p.quietHours },
      globalEnabled: p.globalEnabled,
      rateLimitPerHour: p.rateLimitPerHour,
    };
  }

  function findDomain(domain: string): DomainPreference | undefined {
    return prefs.domains.find((d) => d.domain === domain);
  }

  return {
    getPreferences(): NotificationPreferences {
      return clone(prefs);
    },

    setDomainPreference(domain, patch): void {
      const existing = findDomain(domain);
      if (!existing) return;
      const updated: DomainPreference = {
        ...existing,
        ...patch,
        domain: existing.domain,
        channels: patch.channels
          ? [...patch.channels.filter((c) => isChannel(c))]
          : existing.channels,
        minSeverity: patch.minSeverity && isSeverity(patch.minSeverity)
          ? patch.minSeverity : existing.minSeverity,
      };
      prefs = {
        ...prefs,
        domains: prefs.domains.map((d) => d.domain === domain ? updated : d),
      };
      persistAndNotify();
    },

    setQuietHours(qh): void {
      prefs = {
        ...prefs,
        quietHours: {
          enabled: !!qh.enabled,
          startHour: clampHour(qh.startHour),
          endHour: clampHour(qh.endHour),
        },
      };
      persistAndNotify();
    },

    setGlobalEnabled(enabled): void {
      prefs = { ...prefs, globalEnabled: !!enabled };
      persistAndNotify();
    },

    setRateLimitPerHour(n): void {
      const v = Number.isFinite(Number(n))
        ? Math.max(1, Math.min(100, Math.floor(Number(n)))) : prefs.rateLimitPerHour;
      prefs = { ...prefs, rateLimitPerHour: v };
      persistAndNotify();
    },

    isDomainEnabled(domain): boolean {
      if (!prefs.globalEnabled) return false;
      const d = findDomain(domain);
      return !!d && d.enabled;
    },

    isChannelEnabled(domain, channel): boolean {
      if (!prefs.globalEnabled) return false;
      const d = findDomain(domain);
      if (!d?.enabled) return false;
      return d.channels.includes(channel);
    },

    meetsThreshold(domain, severity): boolean {
      const d = findDomain(domain);
      if (!d) return false;
      return SEVERITY_RANK[severity] >= SEVERITY_RANK[d.minSeverity];
    },

    isQuietHour(now): boolean {
      if (!prefs.quietHours.enabled) return false;
      const date = now ?? new Date();
      const hour = date.getHours();
      const { startHour, endHour } = prefs.quietHours;
      if (startHour === endHour) return false;
      if (startHour < endHour) return hour >= startHour && hour < endHour;
      // Midnight rollover (e.g. 22 → 6): quiet if hour is at/after start OR before end.
      return hour >= startHour || hour < endHour;
    },

    subscribe(cb): () => void {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },

    reset(): void {
      prefs = buildDefaults();
      persistAndNotify();
    },
  };
}

// ── Lazy singleton for runtime callers ───────────────────────────────────

let _singleton: NotificationPreferencesService | null = null;

export function getNotificationPreferencesService(): NotificationPreferencesService {
  _singleton ??= createNotificationPreferencesService();
  return _singleton;
}

/** Test seam — drop the cached singleton so the next call constructs fresh. */
export function _resetNotificationPreferencesSingletonForTests(): void {
  _singleton = null;
}
