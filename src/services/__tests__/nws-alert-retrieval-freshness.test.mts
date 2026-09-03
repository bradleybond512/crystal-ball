import assert from 'node:assert/strict';
import test from 'node:test';

const nws = await import('../nws-alerts.ts') as typeof import('../nws-alerts.ts') & {
  _resetNwsAlertsForTest?: () => void;
};

function validAlert(id = 'nws-1'): Record<string, unknown> {
  return {
    id,
    event: 'Red Flag Warning',
    headline: 'Dry fuels and strong winds',
    description: 'Elevated fire danger',
    severity: 'Severe',
    urgency: 'Expected',
    areaDesc: 'Test County',
    sent: '2026-09-03T11:55:00.000Z',
    onset: '2026-09-03T11:59:00.000Z',
    expires: '2026-09-03T13:00:00.000Z',
    status: 'Actual',
    messageType: 'Alert',
    centroid: [-86.7, 41.6],
    geometry: { type: 'Polygon', coordinates: [[[-87, 41], [-86, 41], [-86, 42], [-87, 41]]] },
  };
}

test('NWS retrieval evidence is stamped once and preserved by the client cache', async () => {
  assert.equal(typeof nws._resetNwsAlertsForTest, 'function', 'test requires an isolated NWS cache seam');
  nws._resetNwsAlertsForTest?.();
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let calls = 0;
  try {
    Date.now = () => 1_788_437_600_000;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify([validAlert()]), { status: 200 });
    };

    const first = await nws.fetchNWSAlerts();
    assert.equal(first[0]?.retrievedAt, 1_788_437_600_000);
    Date.now = () => 1_788_437_660_000;
    const cached = await nws.fetchNWSAlerts();
    assert.equal(calls, 1, 'fresh client cache must avoid a second network request');
    assert.equal(cached[0]?.retrievedAt, 1_788_437_600_000,
      'cache reads must preserve the original retrieval evidence instead of making it look newer');
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    nws._resetNwsAlertsForTest?.();
  }
});

test('malformed HTTP-200 NWS rows are never cached as current evidence', async () => {
  assert.equal(typeof nws._resetNwsAlertsForTest, 'function', 'test requires an isolated NWS cache seam');
  nws._resetNwsAlertsForTest?.();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls += 1;
      const body = calls === 1 ? [{ id: 'missing-required-fields' }] : [validAlert('valid-after-malformed')];
      return new Response(JSON.stringify(body), { status: 200 });
    };

    assert.deepEqual(await nws.fetchNWSAlerts(), []);
    const recovered = await nws.fetchNWSAlerts();
    assert.equal(calls, 2, 'a malformed response must not populate the success cache');
    assert.equal(recovered[0]?.id, 'valid-after-malformed');
    assert.equal(typeof recovered[0]?.retrievedAt, 'number');
  } finally {
    globalThis.fetch = originalFetch;
    nws._resetNwsAlertsForTest?.();
  }
});
