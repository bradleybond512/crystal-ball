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
  | 'supply'
  | 'derived';

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
  | 'domain-quiet-hours'
  | 'preferences-unavailable';

/** `invalid`/`equal` windows are refused at save time (R4-BUG-003). */
export type GlobalSettingsUpdate = { ok: true } | { ok: false; reason: 'invalid' | 'equal' };

export interface NotificationPreferenceDecision {
  allowed: boolean;
  reason: NotificationPreferenceReason;
}

const STORAGE_KEY = 'wm-notification-settings-v1';

const SEVERITY_ORDER: NotificationSeverity[] = ['info', 'low', 'medium', 'high', 'critical'];

const LEGACY_DOMAINS: Exclude<NotificationDomain, 'derived'>[] = [
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
  for (const domain of LEGACY_DOMAINS) {
    domains[domain] = { ...DEFAULT_DOMAIN_SETTINGS };
  }
  domains.derived = { ...DEFAULT_DOMAIN_SETTINGS, threshold: 'high', quietHoursEnabled: true };
  return {
    version: 1,
    global: { ...DEFAULT_GLOBAL_SETTINGS },
    domains,
  };
}

type SavedSettings = Omit<NotificationSettings, 'domains'> & {
  domains: Omit<NotificationSettings['domains'], 'derived'> & { derived?: DomainSettings };
};

let preferencesAvailable = true;

export function areNotificationPreferencesAvailable(): boolean {
  return preferencesAvailable;
}

function validDomain(value: DomainSettings | undefined): value is DomainSettings {
  return typeof value?.enabled === 'boolean' && typeof value.quietHoursEnabled === 'boolean'
    && SEVERITY_ORDER.includes(value.threshold) && ['in_app', 'native', 'both'].includes(value.channel);
}

function validSavedSettings(saved: SavedSettings): boolean {
  return typeof saved.global?.masterMute === 'boolean' && typeof saved.global.dailySummaryEnabled === 'boolean'
    && validateQuietWindow(saved.global.quietHoursStart, saved.global.quietHoursEnd) === 'ok'
    && LEGACY_DOMAINS.every((domain) => validDomain(saved.domains?.[domain]))
    && (saved.domains.derived === undefined || validDomain(saved.domains.derived));
}

function saveToStorage(settings: NotificationSettings): boolean {
  if (!preferencesAvailable) return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false; // Private browsing or quota: use the established settings in memory.
  }
}

function mergeWithDefaults(saved: SavedSettings | null): NotificationSettings {
  const defaults = buildDefaultSettings();
  if (!saved) return defaults;
  const domains = { ...defaults.domains };
  for (const domain of LEGACY_DOMAINS) {
    if (saved.domains?.[domain]) {
      domains[domain] = { ...DEFAULT_DOMAIN_SETTINGS, ...saved.domains[domain] };
    }
  }
  if (validDomain(saved.domains?.derived)) {
    domains.derived = { ...saved.domains.derived };
  } else if (validDomain(saved.domains?.cyber)) {
    const { enabled, threshold, channel } = saved.domains.cyber;
    domains.derived = { ...domains.derived, enabled, channel, threshold: threshold === 'critical' ? 'critical' : 'high' };
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
  if (LEGACY_DOMAINS.some((domain) => settings.domains[domain].quietHoursEnabled)) return null;
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
  let settings = buildDefaultSettings();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const saved = raw === null ? null : JSON.parse(raw) as SavedSettings;
    if (raw !== null) {
      if (saved?.version === 1) settings = mergeWithDefaults(saved);
      if (saved?.version !== 1 || !validSavedSettings(saved)) {
        preferencesAvailable = false;
        return settings;
      }
    }
    const needsWeatherMigration = localStorage.getItem(QUIET_HOURS_MIGRATION_KEY) === null;
    const migrated = needsWeatherMigration
      ? migratePreferencesQuietHours(settings, localStorage.getItem(PREFERENCES_KEY))
      : null;
    settings = migrated ?? settings;
    if ((migrated || (saved && !saved.domains.derived)) && !saveToStorage(settings)) return settings;
    if (needsWeatherMigration) localStorage.setItem(QUIET_HOURS_MIGRATION_KEY, '1');
  } catch {
    preferencesAvailable = false;
  }
  return settings;
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
  if (domain === 'derived' && !preferencesAvailable) return { allowed: false, reason: 'preferences-unavailable' };
  const bypassMute = severity === 'critical' && domain !== 'derived';
  if (global.masterMute && !bypassMute) return { allowed: false, reason: 'master-mute' };

  const domainSettings = domains[domain];
  if (!domainSettings.enabled) return { allowed: false, reason: 'domain-disabled' };

  const severityIndex = Math.max(0, SEVERITY_ORDER.indexOf(severity));
  const thresholdIndex = Math.max(0, SEVERITY_ORDER.indexOf(domainSettings.threshold));
  if (severityIndex < thresholdIndex) return { allowed: false, reason: 'below-threshold' };

  if (!bypassMute && isDomainInQuietHours(domain, now)) {
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
