import test from 'node:test';
import assert from 'node:assert/strict';

import { makeCapabilityTools } from '../tools/capabilities.mjs';

test('get_capabilities reports domain readiness and credential coverage', async () => {
  const feedHealth = {
    data: {
      sidecar: {
        keys_configured: 5,
        keys_total: 38,
        keys_missing_count: 33,
      },
      feeds: [
        { route: '/api/acled-events', status: 'not_configured', reasonCode: 'credential_missing', action: 'Configure ACLED credentials.' },
        { route: '/api/market-quotes', status: 'ok', error: null },
        { route: '/api/fear-greed', status: 'ok', error: null },
        { route: '/api/nws-alerts', status: 'ok', error: null },
        { route: '/api/owm-current', status: 'error', error: 'upstream timeout' },
        { route: '/api/threatfox-iocs', status: 'not_configured', reasonCode: 'credential_missing', action: 'Configure ThreatFox credentials.' },
        { route: '/api/cisa-kev', status: 'ok', error: null },
        { route: '/api/adsb-military', status: 'ok', error: null },
        { route: '/api/ais-snapshot', status: 'not_configured', reasonCode: 'credential_missing', action: 'Configure AIS credentials.' },
        { route: '/api/isw-reports', status: 'error', error: 'upstream 403' },
      ],
    },
    sources: ['/api/health'],
  };
  const tools = makeCapabilityTools({ check_feed_health: async () => feedHealth });

  const result = await tools.get_capabilities();

  assert.equal(result.data.domains.conflicts.status, 'unavailable');
  assert.equal(result.data.domains.markets.status, 'ready');
  assert.equal(result.data.domains.weather.status, 'partial');
  assert.equal(result.data.domains.cyber.status, 'partial');
  assert.equal(result.data.domains.military.status, 'partial');
  assert.deepEqual(result.data.domains.conflicts.unavailable, [{
    route: '/api/acled-events',
    status: 'not_configured',
    reason: 'not configured',
    reasonCode: 'credential_missing',
    action: 'Configure ACLED credentials.',
  }]);
  assert.deepEqual(result.data.credentials, {
    configured: 5,
    total: 38,
    missing: 33,
  });
  assert.deepEqual(result.data.server, {
    name: 'crystalball',
    version: '0.3.0',
    skillContractVersion: 1,
      tools: 61,
    categories: 9,
  });
  assert.match(result.summary, /2 ready, 3 partial, 1 unavailable/);
});

test('get_capabilities fails closed when sidecar health is unavailable', async () => {
  const tools = makeCapabilityTools({
    check_feed_health: async () => ({
      data: { sidecar: { error: 'unreachable' }, feeds: [] },
      sources: [],
    }),
  });

  const result = await tools.get_capabilities();

  assert.equal(result.healthy, false);
  assert.equal(result.data.domains.core.status, 'unavailable');
  assert.match(result.warnings[0], /unreachable/);
});
