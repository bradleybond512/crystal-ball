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

let currentSettings: NotificationSettings = mergeWithDefaults(loadFromStorage());

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

export function updateGlobalSettings(patch: Partial<GlobalSettings>): void {
  currentSettings = {
    ...currentSettings,
    global: { ...currentSettings.global, ...patch },
  };
  saveToStorage(currentSettings);
  emitChange();
}

function isInQuietHours(start: string, end: string): boolean {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startParts = start.split(':').map((s) => { const n = Number.parseInt(s, 10); return Number.isNaN(n) ? 0 : n; });
  const endParts = end.split(':').map((s) => { const n = Number.parseInt(s, 10); return Number.isNaN(n) ? 0 : n; });
  const startMinutes = (startParts[0] ?? 0) * 60 + (startParts[1] ?? 0);
  const endMinutes = (endParts[0] ?? 0) * 60 + (endParts[1] ?? 0);

  // Identical start and end means all 24 hours are quiet
  if (startMinutes === endMinutes) return true;

  // Window wraps midnight when start > end (e.g. 22:00–07:00)
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

export function evaluateNotificationPreference(
  domain: NotificationDomain,
  severity: NotificationSeverity,
): NotificationPreferenceDecision {
  const { global, domains } = currentSettings;
  if (global.masterMute) return { allowed: false, reason: 'master-mute' };

  const domainSettings = domains[domain];
  if (!domainSettings.enabled) return { allowed: false, reason: 'domain-disabled' };

  const severityIndex = Math.max(0, SEVERITY_ORDER.indexOf(severity));
  const thresholdIndex = Math.max(0, SEVERITY_ORDER.indexOf(domainSettings.threshold));
  if (severityIndex < thresholdIndex) return { allowed: false, reason: 'below-threshold' };

  // Critical always bypasses quiet hours
  if (domainSettings.quietHoursEnabled && severity !== 'critical' && isInQuietHours(global.quietHoursStart, global.quietHoursEnd)) {
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
