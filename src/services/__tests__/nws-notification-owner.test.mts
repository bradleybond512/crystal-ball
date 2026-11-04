import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { normalizeWeatherAlertsResponse } from '../weather.ts';
import { normalizeNWSAlert, normalizeSiteWarning } from '../alert-normalizer.ts';
import { acquireWarningSession } from '../warning-notification-session.ts';
import { fetchNWSAlerts, captureNwsObservation, _resetNwsAlertsForTest } from '../nws-alerts.ts';

const now = Date.now();
const cap = 'nws-provider-literal';
const sent = new Date(now - 2000).toISOString();
const onset = new Date(now - 20_000).toISOString();
const expires = new Date(now + 60_000).toISOString();
const props = { id: cap, event: 'Fixture warning', headline: 'Fixture', description: '', severity: 'Severe' as const,
  areaDesc: 'Test', sent, effective: onset, onset, expires, status: 'Actual' as const, messageType: 'Alert' as const, urgency: 'Immediate' as const };
function weather(extra: Record<string, unknown> = {}) {
  return normalizeWeatherAlertsResponse({ features: [{ id: 'https://api.weather.gov/alerts/fixture', geometry: null, properties: { ...props, ...extra } }] })[0]!;
}
const state = { mode: 'live' as const, timestamp: now };

test('both NWS feeds retain one CAP identity and the provider issuance distinct from onset', () => {
  const site = normalizeSiteWarning(weather(), 'network', state, now)!;
  const national = normalizeNWSAlert({ ...props, centroid: null, retrievedAt: now }, { kind:'verified-response', observedAt: now });
  assert.equal(site.id, 'nws-' + cap);
  assert.equal(site.id, national.id);
  assert.equal(site.timestamp, national.timestamp);
  assert.deepEqual(site.retentionEvidence, national.retentionEvidence);
  assert.equal(site.retentionEvidence?.issuedAt, Date.parse(sent));
});

test('site notification requires current verified observation and provider CAP identity', () => {
  for (const row of [weather({ id: undefined }), weather({ id: ' ' }), weather({ expires: new Date(now).toISOString() })]) {
    assert.equal(normalizeSiteWarning(row, 'network', state, now), undefined);
  }
  for (const [source, mode, timestamp] of [['offline-cache','live',now], ['network','cached',now], ['network','unavailable',null], ['network','live',now+1]] as const) {
    assert.equal(normalizeSiteWarning(weather(), source, { mode, timestamp }, now), undefined);
  }
});

test('only the fresh NWS request issued during this load qualifies, cached rows never gain fresh ownership', async (t) => {
  _resetNwsAlertsForTest();
  t.mock.method(globalThis, 'fetch', async () => Response.json([{ ...props, centroid: null }]));
  const fresh = captureNwsObservation();
  const first = await fetchNWSAlerts();
  assert.ok(fresh(first));
  const memory = captureNwsObservation();
  assert.equal(memory(await fetchNWSAlerts()), false);
  assert.equal(fresh(structuredClone(first)), false);
  _resetNwsAlertsForTest();
});

test('last workspace releases notification ownership exactly once', () => {
  let ended = 0;
  const a = acquireWarningSession(() => { ended++; });
  const b = acquireWarningSession(() => { ended++; });
  a(); a();
  assert.equal(ended, 0);
  b(); b();
  assert.equal(ended, 1);
});

test('both production NWS entry points use the inbox owner and discard obsolete workspace work', () => {
  const loader = readFileSync(new URL('../../app/data-loader.ts', import.meta.url), 'utf8');
  const site = loader.slice(loader.indexOf('async loadWeatherAlerts()'), loader.indexOf('const action = RUNG_ACTION') + 1300);
  assert.match(site, /normalizeSiteWarning\(alert, snapshot.source, weatherFeedState\)/);
  assert.match(site, /unifiedAlertStore\.ingest\(\[warning\],/);
  assert.doesNotMatch(site, /notificationDispatcher\.dispatchNotification/);
  assert.match(site, /recordDispatch: false/);
  assert.match(site, /!this\.ctx\.isDestroyed/);
  assert.match(loader, /this\.releaseWarningSession\?\.\(\)/);
});
