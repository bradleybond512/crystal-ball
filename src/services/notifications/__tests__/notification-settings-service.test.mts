import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getSettings,
  updateDomainSettings,
  updateGlobalSettings,
  shouldNotify,
  evaluateNotificationPreference,
  resetSettings,
  type NotificationDomain,
  type NotificationSeverity,
} from '../notification-settings-service.js';

// ── 1. Default settings have all 11 domains enabled ──────────────────────────
test('default settings have all 11 domains enabled', () => {
  resetSettings();
  const { domains } = getSettings();
  const domainKeys = Object.keys(domains) as NotificationDomain[];
  assert.equal(domainKeys.length, 11);
  for (const key of domainKeys) {
    assert.equal(domains[key].enabled, true, `${key} should be enabled by default`);
  }
});

// ── 2. Default threshold is 'medium' ─────────────────────────────────────────
test('default threshold is medium for every domain', () => {
  resetSettings();
  const { domains } = getSettings();
  for (const key of Object.keys(domains) as NotificationDomain[]) {
    assert.equal(domains[key].threshold, 'medium', `${key} threshold should default to medium`);
  }
});

// ── 3. Default channel is 'both' ──────────────────────────────────────────────
test('default delivery channel is both for every domain', () => {
  resetSettings();
  const { domains } = getSettings();
  for (const key of Object.keys(domains) as NotificationDomain[]) {
    assert.equal(domains[key].channel, 'both', `${key} channel should default to both`);
  }
});

// ── 4. Default masterMute is false ────────────────────────────────────────────
test('default masterMute is false', () => {
  resetSettings();
  assert.equal(getSettings().global.masterMute, false);
});

// ── 5. shouldNotify true at exactly the threshold severity ────────────────────
test('shouldNotify returns true when severity equals threshold (medium + medium)', () => {
  resetSettings();
  assert.equal(shouldNotify('weather', 'medium'), true);
});

// ── 6. shouldNotify false below threshold ─────────────────────────────────────
test('shouldNotify returns false when severity is below threshold (low + medium)', () => {
  resetSettings();
  assert.equal(shouldNotify('weather', 'low'), false);
});

// ── 7. shouldNotify true above threshold ──────────────────────────────────────
test('shouldNotify returns true when severity is above threshold (high + medium)', () => {
  resetSettings();
  assert.equal(shouldNotify('weather', 'high'), true);
});

// ── 8. shouldNotify false when domain is disabled ─────────────────────────────
test('shouldNotify returns false when domain is disabled', () => {
  resetSettings();
  updateDomainSettings('earthquakes', { enabled: false });
  assert.equal(shouldNotify('earthquakes', 'critical'), false);
});

// ── 9. shouldNotify false when masterMute is true ─────────────────────────────
test('shouldNotify returns false when masterMute is true, except for critical (R4-BUG-003)', () => {
  resetSettings();
  updateGlobalSettings({ masterMute: true });
  assert.equal(shouldNotify('weather', 'high'), false);
  assert.equal(shouldNotify('weather', 'critical'), true);
});

// ── 10. updateDomainSettings persists enabled=false for 'weather' ─────────────
test('updateDomainSettings persists enabled=false for weather', () => {
  resetSettings();
  updateDomainSettings('weather', { enabled: false });
  assert.equal(getSettings().domains.weather.enabled, false);
});

// ── 11. updateDomainSettings persists threshold='critical' for 'cyber' ────────
test('updateDomainSettings persists threshold critical for cyber', () => {
  resetSettings();
  updateDomainSettings('cyber', { threshold: 'critical' });
  assert.equal(getSettings().domains.cyber.threshold, 'critical');
});

// ── 12. updateGlobalSettings persists masterMute=true ─────────────────────────
test('updateGlobalSettings persists masterMute true', () => {
  resetSettings();
  updateGlobalSettings({ masterMute: true });
  assert.equal(getSettings().global.masterMute, true);
});

// ── 13. Per-domain quietHours: suppressed inside the window ──────────────────
// R4-BUG-003: an equal start/end used to mean "24 h quiet"; it is now refused
// at save time and never silences anything (see quiet-hours.test.mts).
test('evaluateNotificationPreference suppresses non-critical inside the quiet window', () => {
  resetSettings();
  assert.deepEqual(updateGlobalSettings({ quietHoursStart: '00:00', quietHoursEnd: '00:00' }), { ok: false, reason: 'equal' });
  assert.deepEqual(updateGlobalSettings({ quietHoursStart: '22:00', quietHoursEnd: '06:00' }), { ok: true });
  updateDomainSettings('wildfire', { quietHoursEnabled: true });
  const night = new Date(2026, 0, 15, 23, 0);
  assert.deepEqual(evaluateNotificationPreference('wildfire', 'high', night), { allowed: false, reason: 'domain-quiet-hours' });
  assert.deepEqual(evaluateNotificationPreference('wildfire', 'high', new Date(2026, 0, 15, 12, 0)), { allowed: true, reason: 'allowed' });
});

// ── 14. Critical severity bypasses quiet hours ────────────────────────────────
test('evaluateNotificationPreference lets critical through inside the quiet window', () => {
  resetSettings();
  updateGlobalSettings({ quietHoursStart: '22:00', quietHoursEnd: '06:00' });
  updateDomainSettings('wildfire', { quietHoursEnabled: true });
  assert.deepEqual(evaluateNotificationPreference('wildfire', 'critical', new Date(2026, 0, 15, 23, 0)), { allowed: true, reason: 'allowed' });
});

// ── 15. resetSettings restores defaults after mutation ────────────────────────
test('resetSettings restores defaults after mutations', () => {
  resetSettings();
  updateGlobalSettings({ masterMute: true });
  updateDomainSettings('aviation', { enabled: false, threshold: 'critical' });
  resetSettings();
  const s = getSettings();
  assert.equal(s.global.masterMute, false);
  assert.equal(s.domains.aviation.enabled, true);
  assert.equal(s.domains.aviation.threshold, 'medium');
});

// ── 16. Serialization round-trip ──────────────────────────────────────────────
test('serialization round-trip: two domain mutations are both visible via getSettings', () => {
  resetSettings();
  updateDomainSettings('maritime', { threshold: 'high' });
  const snap = getSettings();
  assert.equal(snap.domains.maritime.threshold, 'high');

  updateDomainSettings('maritime', { channel: 'in_app' });
  const snap2 = getSettings();
  // First mutation still present
  assert.equal(snap2.domains.maritime.threshold, 'high');
  // Second mutation also present
  assert.equal(snap2.domains.maritime.channel, 'in_app');
});

// ── 17. shouldNotify returns true for 'info' when threshold is 'info' ─────────
test('shouldNotify returns true for info severity when threshold is info', () => {
  resetSettings();
  updateDomainSettings('geopolitical', { threshold: 'info' });
  assert.equal(shouldNotify('geopolitical', 'info'), true);
});

// ── 18. Unknown severity clamped to 'info' (indexOf returns -1 → Math.max → 0) ─
test('unknown severity does not crash and is treated as lowest severity', () => {
  resetSettings();
  // threshold is 'medium' by default; unknown severity → clamped to index 0 → below threshold
  const result = shouldNotify('space_weather', 'UNKNOWN' as NotificationSeverity);
  // Should return false (clamped to info < medium) and must not throw
  assert.equal(result, false);
});
