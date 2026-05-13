import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createNotificationPreferencesService,
  DEFAULT_DOMAINS,
  STORAGE_KEY,
  type NotificationChannel,
} from '../../src/services/notifications/notification-preferences.ts';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem(key: string) { return store.get(key) ?? null; },
    setItem(key: string, value: string) { store.set(key, String(value)); },
    removeItem(key: string) { store.delete(key); },
    clear() { store.clear(); },
    key(i: number) { return [...store.keys()][i] ?? null; },
    get length() { return store.size; },
  };
}

// ── Defaults ──────────────────────────────────────────────────────────────

test('defaults: 10 domains in the standard order', () => {
  const svc = createNotificationPreferencesService(createMemoryStorage());
  const prefs = svc.getPreferences();
  assert.equal(prefs.domains.length, 10);
  assert.deepEqual(prefs.domains.map(d => d.domain), [
    'earthquake', 'weather', 'wildfire', 'maritime', 'aviation',
    'biosurveillance', 'space-weather', 'cyber', 'sanctions', 'intelligence',
  ]);
});

test('defaults: every domain enabled', () => {
  const svc = createNotificationPreferencesService(createMemoryStorage());
  for (const d of svc.getPreferences().domains) assert.equal(d.enabled, true);
});

test('defaults: every domain minSeverity=medium', () => {
  const svc = createNotificationPreferencesService(createMemoryStorage());
  for (const d of svc.getPreferences().domains) assert.equal(d.minSeverity, 'medium');
});

test('defaults: every domain channels=[system, menubar]', () => {
  const svc = createNotificationPreferencesService(createMemoryStorage());
  for (const d of svc.getPreferences().domains) {
    assert.deepEqual([...d.channels].sort(), ['menubar', 'system']);
  }
});

test('defaults: quietHours disabled, 22→6', () => {
  const svc = createNotificationPreferencesService(createMemoryStorage());
  const qh = svc.getPreferences().quietHours;
  assert.equal(qh.enabled, false);
  assert.equal(qh.startHour, 22);
  assert.equal(qh.endHour, 6);
});

test('defaults: globalEnabled=true', () => {
  const svc = createNotificationPreferencesService(createMemoryStorage());
  assert.equal(svc.getPreferences().globalEnabled, true);
});

test('defaults: rateLimitPerHour=20', () => {
  const svc = createNotificationPreferencesService(createMemoryStorage());
  assert.equal(svc.getPreferences().rateLimitPerHour, 20);
});

test('DEFAULT_DOMAINS exposes the 10 canonical domain names', () => {
  assert.equal(DEFAULT_DOMAINS.length, 10);
  assert.ok(DEFAULT_DOMAINS.includes('earthquake'));
  assert.ok(DEFAULT_DOMAINS.includes('intelligence'));
});

// ── setDomainPreference ──────────────────────────────────────────────────

test('setDomainPreference persists enabled toggle', () => {
  const svc = createNotificationPreferencesService(createMemoryStorage());
  svc.setDomainPreference('earthquake', { enabled: false });
  const d = svc.getPreferences().domains.find(x => x.domain === 'earthquake')!;
  assert.equal(d.enabled, false);
});

test('setDomainPreference partial update preserves untouched fields', () => {
  const svc = createNotificationPreferencesService(createMemoryStorage());
  svc.setDomainPreference('weather', { minSeverity: 'high' });
  const d = svc.getPreferences().domains.find(x => x.domain === 'weather')!;
  assert.equal(d.minSeverity, 'high');
  assert.equal(d.enabled, true);
  assert.deepEqual([...d.channels].sort(), ['menubar', 'system']);
});

test('setDomainPreference replaces channels array when provided', () => {
  const svc = createNotificationPreferencesService(createMemoryStorage());
  svc.setDomainPreference('cyber', { channels: ['sms', 'email'] });
  const d = svc.getPreferences().domains.find(x => x.domain === 'cyber')!;
  assert.deepEqual([...d.channels].sort(), ['email', 'sms']);
});

test('setDomainPreference is a no-op for unknown domain (does not insert ghost row)', () => {
  const svc = createNotificationPreferencesService(createMemoryStorage());
  svc.setDomainPreference('nuclear-fusion', { enabled: false });
  assert.equal(svc.getPreferences().domains.length, 10);
});

// ── setQuietHours / setGlobalEnabled ─────────────────────────────────────

test('setQuietHours persists', () => {
  const svc = createNotificationPreferencesService(createMemoryStorage());
  svc.setQuietHours({ enabled: true, startHour: 23, endHour: 7 });
  const qh = svc.getPreferences().quietHours;
  assert.equal(qh.enabled, true);
  assert.equal(qh.startHour, 23);
  assert.equal(qh.endHour, 7);
});

test('setGlobalEnabled persists', () => {
  const svc = createNotificationPreferencesService(createMemoryStorage());
  svc.setGlobalEnabled(false);
  assert.equal(svc.getPreferences().globalEnabled, false);
});

// ── isDomainEnabled ──────────────────────────────────────────────────────

test('isDomainEnabled returns true for default state', () => {
  const svc = createNotificationPreferencesService(createMemoryStorage());
  assert.equal(svc.isDomainEnabled('earthquake'), true);
});

test('isDomainEnabled returns false when domain disabled', () => {
  const svc = createNotificationPreferencesService(createMemoryStorage());
  svc.setDomainPreference('earthquake', { enabled: false });
  assert.equal(svc.isDomainEnabled('earthquake'), false);
});

test('isDomainEnabled returns false when globalEnabled=false regardless of domain pref', () => {
  const svc = createNotificationPreferencesService(createMemoryStorage());
  svc.setGlobalEnabled(false);
  assert.equal(svc.isDomainEnabled('earthquake'), false);
});

test('isDomainEnabled returns false for unknown domain', () => {
  const svc = createNotificationPreferencesService(createMemoryStorage());
  assert.equal(svc.isDomainEnabled('aliens'), false);
});

// ── isChannelEnabled ─────────────────────────────────────────────────────

test('isChannelEnabled true for default channel (system) on enabled domain', () => {
  const svc = createNotificationPreferencesService(createMemoryStorage());
  assert.equal(svc.isChannelEnabled('earthquake', 'system'), true);
});

test('isChannelEnabled false for channel not in array (e.g. sms by default)', () => {
  const svc = createNotificationPreferencesService(createMemoryStorage());
  assert.equal(svc.isChannelEnabled('earthquake', 'sms'), false);
});

test('isChannelEnabled false when domain disabled even if channel present', () => {
  const svc = createNotificationPreferencesService(createMemoryStorage());
  svc.setDomainPreference('earthquake', { enabled: false });
  assert.equal(svc.isChannelEnabled('earthquake', 'system'), false);
});

// ── meetsThreshold ───────────────────────────────────────────────────────

test('meetsThreshold true when severity equals minSeverity', () => {
  const svc = createNotificationPreferencesService(createMemoryStorage());
  assert.equal(svc.meetsThreshold('earthquake', 'medium'), true);
});

test('meetsThreshold true when severity > minSeverity', () => {
  const svc = createNotificationPreferencesService(createMemoryStorage());
  assert.equal(svc.meetsThreshold('earthquake', 'critical'), true);
});

test('meetsThreshold false when severity < minSeverity', () => {
  const svc = createNotificationPreferencesService(createMemoryStorage());
  assert.equal(svc.meetsThreshold('earthquake', 'low'), false);
});

test('meetsThreshold false for unknown domain', () => {
  const svc = createNotificationPreferencesService(createMemoryStorage());
  assert.equal(svc.meetsThreshold('aliens', 'critical'), false);
});

// ── isQuietHour ──────────────────────────────────────────────────────────

test('isQuietHour returns false when quietHours disabled regardless of time', () => {
  const svc = createNotificationPreferencesService(createMemoryStorage());
  const at03 = new Date(2026, 0, 1, 3, 0, 0);
  assert.equal(svc.isQuietHour(at03), false);
});

test('isQuietHour same-day range: inside → true, outside → false', () => {
  const svc = createNotificationPreferencesService(createMemoryStorage());
  svc.setQuietHours({ enabled: true, startHour: 9, endHour: 17 });
  assert.equal(svc.isQuietHour(new Date(2026, 0, 1, 12, 0, 0)), true);
  assert.equal(svc.isQuietHour(new Date(2026, 0, 1, 18, 0, 0)), false);
});

test('isQuietHour midnight rollover (22→6): 23:00 is quiet', () => {
  const svc = createNotificationPreferencesService(createMemoryStorage());
  svc.setQuietHours({ enabled: true, startHour: 22, endHour: 6 });
  assert.equal(svc.isQuietHour(new Date(2026, 0, 1, 23, 0, 0)), true);
});

test('isQuietHour midnight rollover (22→6): 03:00 is quiet', () => {
  const svc = createNotificationPreferencesService(createMemoryStorage());
  svc.setQuietHours({ enabled: true, startHour: 22, endHour: 6 });
  assert.equal(svc.isQuietHour(new Date(2026, 0, 1, 3, 0, 0)), true);
});

test('isQuietHour midnight rollover (22→6): 12:00 is NOT quiet', () => {
  const svc = createNotificationPreferencesService(createMemoryStorage());
  svc.setQuietHours({ enabled: true, startHour: 22, endHour: 6 });
  assert.equal(svc.isQuietHour(new Date(2026, 0, 1, 12, 0, 0)), false);
});

// ── subscribe / unsubscribe ──────────────────────────────────────────────

test('subscribe is called on setDomainPreference, setQuietHours, setGlobalEnabled', () => {
  const svc = createNotificationPreferencesService(createMemoryStorage());
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  svc.setDomainPreference('earthquake', { enabled: false });
  svc.setQuietHours({ enabled: true, startHour: 22, endHour: 6 });
  svc.setGlobalEnabled(false);
  assert.equal(calls, 3);
});

test('subscribe returns an unsubscribe function that stops further callbacks', () => {
  const svc = createNotificationPreferencesService(createMemoryStorage());
  let calls = 0;
  const off = svc.subscribe(() => { calls += 1; });
  svc.setGlobalEnabled(false);
  off();
  svc.setGlobalEnabled(true);
  assert.equal(calls, 1);
});

// ── localStorage persistence ─────────────────────────────────────────────

test('persists to localStorage under STORAGE_KEY', () => {
  const storage = createMemoryStorage();
  const svc = createNotificationPreferencesService(storage);
  svc.setDomainPreference('earthquake', { enabled: false });
  const raw = storage.getItem(STORAGE_KEY);
  assert.ok(raw);
  const parsed = JSON.parse(raw!);
  const eq = parsed.domains.find((d: { domain: string }) => d.domain === 'earthquake');
  assert.equal(eq.enabled, false);
});

test('rehydrates state from existing localStorage on construction', () => {
  const storage = createMemoryStorage();
  const svc1 = createNotificationPreferencesService(storage);
  svc1.setGlobalEnabled(false);
  svc1.setDomainPreference('weather', { minSeverity: 'critical', channels: ['sms'] satisfies NotificationChannel[] });
  const svc2 = createNotificationPreferencesService(storage);
  assert.equal(svc2.getPreferences().globalEnabled, false);
  const weather = svc2.getPreferences().domains.find(d => d.domain === 'weather')!;
  assert.equal(weather.minSeverity, 'critical');
  assert.deepEqual(weather.channels, ['sms']);
});

test('STORAGE_KEY is "wm-notification-preferences"', () => {
  assert.equal(STORAGE_KEY, 'wm-notification-preferences');
});
