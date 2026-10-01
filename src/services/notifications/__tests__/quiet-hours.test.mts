// R4-BUG-003: one quiet-hours rule, run through every call site, plus the
// master-mute bypass, save-time rejection, the one-time migration and the
// removal of the unwritten legacy stores.
process.env.TZ = 'America/New_York'; // DST rows below assume US Eastern.

import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';

import { hourToQuietTime, isWithinQuietWindow, minutesOfDay, parseQuietTime, validateQuietWindow } from '../quiet-hours.ts';
import { traceAlert } from '../alert-trace.ts';
import type { NotificationSettings } from '../notification-settings-service.ts';
import type { ObservationEvent } from '@/types/intelligence';

const SETTINGS_KEY = 'wm-notification-settings-v1';
const MIGRATION_KEY = 'wm-quiet-hours-unified-v1';
const PREFS_KEY = 'wm-notification-preferences';

// [label, start, end, now (HH:MM), quiet?]
const CASES: ReadonlyArray<readonly [string, string, string, string, boolean]> = [
  ['same-day inside', '09:00', '17:00', '12:00', true],
  ['same-day start is inclusive', '09:00', '17:00', '09:00', true],
  ['same-day end is exclusive', '09:00', '17:00', '17:00', false],
  ['same-day before', '09:00', '17:00', '08:59', false],
  ['overnight, late evening', '22:00', '07:00', '23:30', true],
  ['overnight, at midnight', '22:00', '07:00', '00:00', true],
  ['overnight, early morning', '22:00', '07:00', '06:59', true],
  ['overnight end is exclusive', '22:00', '07:00', '07:00', false],
  ['overnight, midday', '22:00', '07:00', '12:00', false],
  ['equal at midnight is never quiet', '00:00', '00:00', '12:00', false],
  ['equal elsewhere is never quiet', '13:00', '13:00', '13:00', false],
  ['blank start', '', '07:00', '03:00', false],
  ['blank window', '', '', '00:00', false],
  ['24:00 is invalid', '22:00', '24:00', '23:00', false],
  ['single digits are invalid', '7:05', '09:00', '08:00', false],
  ['letters are invalid', 'ab:cd', '07:00', '03:00', false],
];

function at(hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2026, 0, 15, h, m);
}

function settingsWith(start: string, end: string, overrides: Partial<NotificationSettings['global']> = {}): NotificationSettings {
  const domain = { enabled: true, threshold: 'medium' as const, channel: 'both' as const, quietHoursEnabled: false };
  const domains = Object.fromEntries(['earthquakes', 'wildfire', 'aviation', 'maritime', 'biosurveillance', 'space_weather',
    'infrastructure', 'geopolitical', 'weather', 'cyber', 'supply'].map((d) => [d, { ...domain }])) as NotificationSettings['domains'];
  domains.earthquakes.quietHoursEnabled = true;
  return { version: 1, global: { masterMute: false, quietHoursStart: start, quietHoursEnd: end, dailySummaryEnabled: false, ...overrides }, domains };
}

function storage(entries: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (i: number) => [...values.keys()][i] ?? null,
    get length() { return values.size; },
  } as Storage;
}

/** A fresh settings service over `entries`, so stored (even invalid) windows load as-is. */
async function freshService(entries: Record<string, string>) {
  Object.assign(globalThis, { localStorage: storage(entries) });
  const url = new URL('../notification-settings-service.ts', import.meta.url).href + `?t=${Math.random()}`;
  return (await import(url)) as typeof import('../notification-settings-service.ts');
}

const EVENT: ObservationEvent = {
  id: 'evt-q', sourceId: 'usgs-earthquake', domain: 'seismic', timestamp: 0,
  location: { lat: 0, lon: 0 }, severity: 'MEDIUM', title: 'M5', raw: {}, entityIds: [], tags: [],
};

beforeEach(() => { Reflect.deleteProperty(globalThis, 'localStorage'); });

test('the pure rule matches the table', () => {
  for (const [label, start, end, now, quiet] of CASES) {
    assert.equal(isWithinQuietWindow(parseQuietTime(now)!, start, end), quiet, label);
  }
});

test('the dispatcher preference check and the ladder follow the same table', async () => {
  for (const [label, start, end, now, quiet] of CASES) {
    const svc = await freshService({ [SETTINGS_KEY]: JSON.stringify(settingsWith(start, end)), [MIGRATION_KEY]: '1' });
    const decision = svc.evaluateNotificationPreference('earthquakes', 'high', at(now));
    assert.equal(decision.reason === 'domain-quiet-hours', quiet, `evaluate: ${label}`);
    assert.equal(svc.isDomainInQuietHours('earthquakes', at(now)), quiet, `domain: ${label}`);
    assert.deepEqual(svc.ladderQuietHours('earthquakes', at(now)), { quietHoursActive: quiet, quietHoursBypassEnabled: false }, `ladder: ${label}`);
    assert.equal(svc.isDomainInQuietHours('weather', at(now)), false, `a domain with quiet hours off is never quiet: ${label}`);
  }
});

test('the alert-trace explanation follows the same table', () => {
  for (const [label, start, end, now, quiet] of CASES) {
    const [hourOverride, minuteOverride] = now.split(':').map(Number);
    const trace = traceAlert(EVENT, settingsWith(start, end), [], { nowMs: 0, hourOverride, minuteOverride });
    const stage = trace.stages.find((s) => s.name === 'quiet-hours')!;
    assert.equal(stage.status === 'fail', quiet, `trace: ${label}`);
    if (validateQuietWindow(start, end) !== 'ok') assert.match(stage.detail, /not valid, so it never silences/, label);
  }
});

test('DST days follow the wall clock', () => {
  // 2026-03-08 spring-forward: 02:00–03:00 does not exist.
  const afterJump = new Date('2026-03-08T07:30:00Z'); // 03:30 EDT
  assert.equal(minutesOfDay(afterJump), 210);
  assert.equal(isWithinQuietWindow(minutesOfDay(afterJump), '01:00', '04:00'), true);
  assert.equal(isWithinQuietWindow(minutesOfDay(afterJump), '02:00', '03:00'), false);
  // 2026-11-01 fall-back: 01:30 happens twice; both are inside 01:00–02:00.
  const firstPass = new Date('2026-11-01T05:30:00Z'); // 01:30 EDT
  const secondPass = new Date('2026-11-01T06:30:00Z'); // 01:30 EST
  assert.equal(minutesOfDay(firstPass), 90);
  assert.equal(minutesOfDay(secondPass), 90);
  assert.equal(isWithinQuietWindow(90, '01:00', '02:00'), true);
});

test('time parsing is strict', () => {
  assert.equal(parseQuietTime('00:00'), 0);
  assert.equal(parseQuietTime('23:59'), 1439);
  for (const bad of ['24:00', '23:60', '7:05', '07:5', ' 07:05', '07:05 ', '', null, 705]) {
    assert.equal(parseQuietTime(bad), null, String(bad));
  }
  assert.equal(validateQuietWindow('22:00', '07:00'), 'ok');
  assert.equal(validateQuietWindow('07:00', '07:00'), 'equal');
  assert.equal(validateQuietWindow('', '07:00'), 'invalid');
  assert.equal(hourToQuietTime(7), '07:00');
  for (const bad of [24, -1, 1.5, '7']) assert.equal(hourToQuietTime(bad), null, String(bad));
});

test('invalid and equal windows are refused at save time and the old window is kept', async () => {
  const svc = await freshService({ [MIGRATION_KEY]: '1' });
  let events = 0;
  const doc = new EventTarget();
  doc.addEventListener('wm:notification-settings-changed', () => { events += 1; });
  Object.assign(globalThis, { document: doc });
  try {
    assert.deepEqual(svc.updateGlobalSettings({ quietHoursStart: '07:00' }), { ok: false, reason: 'equal' });
    assert.deepEqual(svc.updateGlobalSettings({ quietHoursStart: '', quietHoursEnd: '06:00' }), { ok: false, reason: 'invalid' });
    assert.deepEqual(svc.updateGlobalSettings({ quietHoursEnd: '24:00' }), { ok: false, reason: 'invalid' });
    assert.equal(events, 0, 'a refused window is not announced');
    assert.deepEqual([svc.getSettings().global.quietHoursStart, svc.getSettings().global.quietHoursEnd], ['22:00', '07:00']);
    assert.deepEqual(svc.updateGlobalSettings({ quietHoursStart: '23:00', quietHoursEnd: '06:00' }), { ok: true });
    assert.equal(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).global.quietHoursStart, '23:00');
  } finally { Reflect.deleteProperty(globalThis, 'document'); }
});

test('other global changes still save while a stored window is invalid', async () => {
  const svc = await freshService({ [SETTINGS_KEY]: JSON.stringify(settingsWith('', '')), [MIGRATION_KEY]: '1' });
  assert.deepEqual(svc.updateGlobalSettings({ masterMute: true }), { ok: true });
  assert.equal(svc.getSettings().global.masterMute, true);
});

test('master mute lets critical through; the trace says so', async () => {
  const svc = await freshService({ [MIGRATION_KEY]: '1' });
  svc.updateGlobalSettings({ masterMute: true });
  assert.deepEqual(svc.evaluateNotificationPreference('earthquakes', 'critical'), { allowed: true, reason: 'allowed' });
  assert.deepEqual(svc.evaluateNotificationPreference('earthquakes', 'high'), { allowed: false, reason: 'master-mute' });
  svc.updateDomainSettings('earthquakes', { enabled: false });
  assert.deepEqual(svc.evaluateNotificationPreference('earthquakes', 'critical'), { allowed: false, reason: 'domain-disabled' });

  const muted = settingsWith('22:00', '07:00', { masterMute: true });
  const threshold = (severity: ObservationEvent['severity']) =>
    traceAlert({ ...EVENT, severity }, muted, [], { nowMs: 0, hourOverride: 12, minuteOverride: 0 }).stages.find((s) => s.name === 'threshold-check')!;
  assert.equal(threshold('CRITICAL').status, 'pass');
  assert.equal(threshold('HIGH').status, 'fail');
  assert.match(threshold('HIGH').detail, /critical alerts still come through/);
});

const PREFS = (quietHours: Record<string, unknown>, weatherOverride = false) => JSON.stringify({
  quietHours, domains: [{ domain: 'weather', quietHoursOverride: weatherOverride }, { domain: 'cyber', quietHoursOverride: false }],
});

test('migration carries the Preferences window into weather only, once', async () => {
  const svc = await freshService({ [PREFS_KEY]: PREFS({ enabled: true, startHour: 21, endHour: 6 }) });
  const s = svc.getSettings();
  assert.deepEqual([s.global.quietHoursStart, s.global.quietHoursEnd], ['21:00', '06:00']);
  assert.equal(s.domains.weather.quietHoursEnabled, true);
  assert.deepEqual(Object.entries(s.domains).filter(([, d]) => d.quietHoursEnabled).map(([k]) => k), ['weather'], 'no other domain gains silence');
  assert.equal(localStorage.getItem(MIGRATION_KEY), '1');
  assert.equal(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).domains.weather.quietHoursEnabled, true);

  // A second start with the marker present never migrates again.
  const again = await freshService({ [MIGRATION_KEY]: '1', [PREFS_KEY]: PREFS({ enabled: true, startHour: 1, endHour: 5 }) });
  assert.equal(again.getSettings().global.quietHoursStart, '22:00');
  assert.equal(again.getSettings().domains.weather.quietHoursEnabled, false);
});

test('migration never adds silence', async () => {
  {
    const svc = await freshService({ [MIGRATION_KEY]: '1' });
    const base = svc.getSettings();
    const cases: Array<[string, string | null, NotificationSettings]> = [
      ['no preferences', null, base],
      ['malformed preferences', '{', base],
      ['preferences window off', PREFS({ enabled: false, startHour: 21, endHour: 6 }), base],
      ['weather was overridden', PREFS({ enabled: true, startHour: 21, endHour: 6 }, true), base],
      ['equal hours (24 h quiet before) are dropped', PREFS({ enabled: true, startHour: 5, endHour: 5 }), base],
      ['out-of-range hours', PREFS({ enabled: true, startHour: 25, endHour: 6 }), base],
      ['shared window already in use', PREFS({ enabled: true, startHour: 21, endHour: 6 }),
        { ...base, domains: { ...base.domains, cyber: { ...base.domains.cyber, quietHoursEnabled: true } } }],
    ];
    for (const [label, raw, settings] of cases) {
      assert.equal(svc.migratePreferencesQuietHours(settings, raw), null, label);
    }
  }
});

test('the unwritten legacy quiet-hours stores have no readers left', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  for (const path of ['../../notification-dispatcher.ts', '../../alerting-prefs.ts', '../../alert-rules-engine.ts']) {
    assert.doesNotMatch(read(path), /wm-quiet-hours'|crystalball-quiet-hours-v1|isQuietHoursActive|inQuietHours/, path);
  }
  const loader = read('../../../app/data-loader.ts');
  assert.match(loader, /ladderQuietHours\('weather'\)/);
  assert.doesNotMatch(loader, /isQuietHour\(|quietHoursOverride/);
});
