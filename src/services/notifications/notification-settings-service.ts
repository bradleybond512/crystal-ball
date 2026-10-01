import { hourToQuietTime, isWithinQuietWindow, minutesOfDay, validateQuietWindow } from './quiet-hours';

export type NotificationSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type DeliveryChannel = 'in_app' | 'native' | 'both';

export type NotificationDomain =
  | 'earthquakes'
  | 'wildfire'
  | 'aviation'
  | 'maritime'
  | 'biosurveillance'
  | 'space_weather'
  | 'infrastructure'
  | 'geopolitical'
  | 'weather'
  | 'cyber'
  | 'supply';

export interface DomainSettings {
  enabled: boolean;
  threshold: NotificationSeverity;
  channel: DeliveryChannel;
  quietHoursEnabled: boolean;
}

export interface GlobalSettings {
  masterMute: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  dailySummaryEnabled: boolean;
}

export interface NotificationSettings {
  version: 1;
  global: GlobalSettings;
  domains: Record<NotificationDomain, DomainSettings>;
}

export type NotificationPreferenceReason =
  | 'allowed'
  | 'master-mute'
  | 'domain-disabled'
  | 'below-threshold'
  | 'domain-quiet-hours';

/** `invalid`/`equal` windows are refused at save time (R4-BUG-003). */
export type GlobalSettingsUpdate = { ok: true } | { ok: false; reason: 'invalid' | 'equal' };

export interface NotificationPreferenceDecision {
  allowed: boolean;
  reason: NotificationPreferenceReason;
}

const STORAGE_KEY = 'wm-notification-settings-v1';

const SEVERITY_ORDER: NotificationSeverity[] = ['info', 'low', 'medium', 'high', 'critical'];

const ALL_DOMAINS: NotificationDomain[] = [
  'earthquakes',
  'wildfire',
  'aviation',
  'maritime',
  'biosurveillance',
  'space_weather',
  'infrastructure',
  'geopolitical',
  'weather',
  'cyber',
  'supply',
];

const DEFAULT_DOMAIN_SETTINGS: DomainSettings = {
  enabled: true,
  threshold: 'medium',
  channel: 'both',
  quietHoursEnabled: false,
};

const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  masterMute: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
  dailySummaryEnabled: false,
};

function buildDefaultSettings(): NotificationSettings {
  const domains = {} as Record<NotificationDomain, DomainSettings>;
  for (const domain of ALL_DOMAINS) {
    domains[domain] = { ...DEFAULT_DOMAIN_SETTINGS };
  }
  return {
    version: 1,
    global: { ...DEFAULT_GLOBAL_SETTINGS },
    domains,
  };
}

function loadFromStorage(): NotificationSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NotificationSettings;
    if (parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveToStorage(settings: NotificationSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing or storage quota exceeded — operate in-memory only
  }
}

function mergeWithDefaults(saved: NotificationSettings | null): NotificationSettings {
  const defaults = buildDefaultSettings();
  if (!saved) return defaults;
  const domains = { ...defaults.domains };
  for (const domain of ALL_DOMAINS) {
    if (saved.domains?.[domain]) {
      domains[domain] = { ...DEFAULT_DOMAIN_SETTINGS, ...saved.domains[domain] };
    }
  }
  return {
    version: 1,
    global: { ...DEFAULT_GLOBAL_SETTINGS, ...saved.global },
    domains,
  };
}

/** Set once the Preferences-panel window has been considered for migration. */
export const QUIET_HOURS_MIGRATION_KEY = 'wm-quiet-hours-unified-v1';
const PREFERENCES_KEY = 'wm-notification-preferences';

/**
 * R4-BUG-003: the Notification Preferences window only ever reached the
 * weather ladder. Carry it into the canonical store for weather only, and
 * never add silence: skip when weather was overridden, when the shared
 * window already serves another domain, or when the window is unusable.
 * Returns null when nothing should change.
 */
export function migratePreferencesQuietHours(
  settings: NotificationSettings,
  preferencesRaw: string | null,
): NotificationSettings | null {
  let parsed: unknown;
  try { parsed = JSON.parse(preferencesRaw ?? 'null'); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const prefs = parsed as { quietHours?: Record<string, unknown>; domains?: unknown };
  if (prefs.quietHours?.enabled !== true) return null;
  const weather = Array.isArray(prefs.domains)
    ? (prefs.domains as (Record<string, unknown> | null)[]).find((d) => d?.domain === 'weather')
    : undefined;
  if (weather?.quietHoursOverride === true) return null;
  if (ALL_DOMAINS.some((domain) => settings.domains[domain].quietHoursEnabled)) return null;
  const start = hourToQuietTime(prefs.quietHours.startHour);
  const end = hourToQuietTime(prefs.quietHours.endHour);
  if (!start || !end || validateQuietWindow(start, end) !== 'ok') return null;
  return {
    ...settings,
    global: { ...settings.global, quietHoursStart: start, quietHoursEnd: end },
    domains: { ...settings.domains, weather: { ...settings.domains.weather, quietHoursEnabled: true } },
  };
}

function initialSettings(): NotificationSettings {
  const settings = mergeWithDefaults(loadFromStorage());
  try {
    if (localStorage.getItem(QUIET_HOURS_MIGRATION_KEY) !== null) return settings;
    const migrated = migratePreferencesQuietHours(settings, localStorage.getItem(PREFERENCES_KEY));
    if (migrated) saveToStorage(migrated);
    localStorage.setItem(QUIET_HOURS_MIGRATION_KEY, '1');
    return migrated ?? settings;
  } catch {
    return settings; // No storage: nothing to migrate.
  }
}

let currentSettings: NotificationSettings = initialSettings();

function emitChange(): void {
  if (typeof document !== 'undefined') {
    document.dispatchEvent(
      new CustomEvent('wm:notification-settings-changed', { detail: getSettings() }),
    );
  }
}

export function getSettings(): NotificationSettings {
  return currentSettings;
}

export function updateDomainSettings(
  domain: NotificationDomain,
  patch: Partial<DomainSettings>,
): void {
  currentSettings = {
    ...currentSettings,
    domains: {
      ...currentSettings.domains,
      [domain]: { ...currentSettings.domains[domain], ...patch },
    },
  };
  saveToStorage(currentSettings);
  emitChange();
}

export function updateGlobalSettings(patch: Partial<GlobalSettings>): GlobalSettingsUpdate {
  const global = { ...currentSettings.global, ...patch };
  if ('quietHoursStart' in patch || 'quietHoursEnd' in patch) {
    const validity = validateQuietWindow(global.quietHoursStart, global.quietHoursEnd);
    if (validity !== 'ok') return { ok: false, reason: validity };
  }
  currentSettings = { ...currentSettings, global };
  saveToStorage(currentSettings);
  emitChange();
  return { ok: true };
}

/** True when `domain` has quiet hours on and `now` is inside the shared window. */
export function isDomainInQuietHours(domain: NotificationDomain, now: Date = new Date()): boolean {
  const { global, domains } = currentSettings;
  return domains[domain]?.quietHoursEnabled === true
    && isWithinQuietWindow(minutesOfDay(now), global.quietHoursStart, global.quietHoursEnd);
}

/**
 * Inputs for the notification ladder (weather path in data-loader). The
 * ladder's separate "bypass" flag is folded into the domain's own quiet-hours
 * toggle, so there is one switch per domain and one window (R4-BUG-003).
 */
export function ladderQuietHours(
  domain: NotificationDomain,
  now: Date = new Date(),
): { quietHoursActive: boolean; quietHoursBypassEnabled: boolean } {
  return { quietHoursActive: isDomainInQuietHours(domain, now), quietHoursBypassEnabled: false };
}

export function evaluateNotificationPreference(
  domain: NotificationDomain,
  severity: NotificationSeverity,
  now: Date = new Date(),
): NotificationPreferenceDecision {
  const { global, domains } = currentSettings;
  // Life-safety critical alerts come through a forgotten mute (R4-BUG-003).
  if (global.masterMute && severity !== 'critical') return { allowed: false, reason: 'master-mute' };

  const domainSettings = domains[domain];
  if (!domainSettings.enabled) return { allowed: false, reason: 'domain-disabled' };

  const severityIndex = Math.max(0, SEVERITY_ORDER.indexOf(severity));
  const thresholdIndex = Math.max(0, SEVERITY_ORDER.indexOf(domainSettings.threshold));
  if (severityIndex < thresholdIndex) return { allowed: false, reason: 'below-threshold' };

  // Critical always bypasses quiet hours
  if (severity !== 'critical' && isDomainInQuietHours(domain, now)) {
    return { allowed: false, reason: 'domain-quiet-hours' };
  }

  return { allowed: true, reason: 'allowed' };
}

export function shouldNotify(domain: NotificationDomain, severity: NotificationSeverity): boolean {
  return evaluateNotificationPreference(domain, severity).allowed;
}

export function resetSettings(): void {
  currentSettings = buildDefaultSettings();
  saveToStorage(currentSettings);
}
