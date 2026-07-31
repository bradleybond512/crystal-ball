import test from 'node:test';
import assert from 'node:assert/strict';

import { isAgentQueryRouteAllowed } from '../route-policy.mjs';
import { makeFoundationTools } from '../tools/foundation.mjs';

test('agent query policy allows catalogued intelligence routes', () => {
  assert.equal(isAgentQueryRouteAllowed('/api/acled-events'), true);
  assert.equal(isAgentQueryRouteAllowed('/api/military/v1/get-theater-posture'), true);
});

test('agent query policy denies unlisted, administrative, and malformed routes', () => {
  assert.equal(isAgentQueryRouteAllowed('/api/secrets'), false);
  assert.equal(isAgentQueryRouteAllowed('/api/analyst-commands'), false);
  assert.equal(isAgentQueryRouteAllowed('/api/acled-events/../secrets'), false);
  assert.equal(isAgentQueryRouteAllowed('//evil.example/x'), false);
});

test('query_raw fails closed without calling the sidecar for a denied route', async () => {
  let called = false;
  const tools = makeFoundationTools({
    get: async () => {
      called = true;
      return {};
    },
  });

  const result = await tools.query_raw({ endpoint: '/api/secrets' });

  assert.equal(called, false);
  assert.equal(result.healthy, false);
  assert.match(result.warnings[0], /not approved/);
});

test('chain_query stops before executing a denied route', async () => {
  const calls = [];
  const tools = makeFoundationTools({
    get: async (route) => {
      calls.push(route);
      return { ok: true };
    },
  });

  const result = await tools.chain_query({
    steps: [
      { endpoint: '/api/acled-events' },
      { endpoint: '/api/analyst-commands' },
      { endpoint: '/api/nws-alerts' },
    ],
  });

  assert.deepEqual(calls, []);
  assert.equal(result.healthy, false);
  assert.match(result.warnings[0], /analyst-commands/);
});
