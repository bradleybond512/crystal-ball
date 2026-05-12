import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getSettings,
  updateDomainSettings,
  updateGlobalSettings,
  shouldNotify,
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
test('shouldNotify returns false when masterMute is true', () => {
  resetSettings();
  updateGlobalSettings({ masterMute: true });
  assert.equal(shouldNotify('weather', 'critical'), false);
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

// ── 13. Per-domain quietHours: shouldNotify returns false during quiet window ──
// '00:00' === '00:00' → isInQuietHours returns true (all-day quiet window)
test('shouldNotify returns false during all-day quiet window when quietHoursEnabled', () => {
  resetSettings();
  updateGlobalSettings({ quietHoursStart: '00:00', quietHoursEnd: '00:00' });
  updateDomainSettings('wildfire', { quietHoursEnabled: true });
  // severity below critical so quiet hours are not bypassed
  assert.equal(shouldNotify('wildfire', 'high'), false);
});

// ── 14. Critical severity bypasses quiet hours ────────────────────────────────
test('shouldNotify returns true for critical even during all-day quiet window', () => {
  resetSettings();
  updateGlobalSettings({ quietHoursStart: '00:00', quietHoursEnd: '00:00' });
  updateDomainSettings('wildfire', { quietHoursEnabled: true });
  assert.equal(shouldNotify('wildfire', 'critical'), true);
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
