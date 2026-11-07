import assert from 'node:assert/strict';
import test from 'node:test';
import './register-hook.mjs';
import { happyWindow } from './setup-dom.mts';

test('mounted panels feed the existing requests independently and discard completions after destruction', async (t) => {
  const { AviationIntelPanel } = await import('../../src/components/AviationIntelPanel.ts');
  const { MaritimeIntelPanel } = await import('../../src/components/MaritimeIntelPanel.ts');
  const { threatEvidence } = await import('../../src/services/synthesis/threat-aggregator.ts');
  const { clearAviationCache } = await import('../../src/services/aviation/aviation-intel-service.ts');
  clearAviationCache();
  const time = Date.now() - 1_000;
  const calls: string[] = [];
  const sig = { id: 'A', text: 'SIGMET', validFrom: time, validTo: time + 240_000, hazard: 'icing', severity: 'moderate', isAirmet: false, polygon: [] };
  const faa = { airport: 'FLL', startedAt: null, endsAt: time + 240_000, programType: 'ground_stop', reason: 'weather', avgDelayMinutes: null, maxDelayMinutes: null };
  const vessel = { mmsi: '366123456', name: 'FIRST', observedAt: time, lat: 0, lon: 110, zoneId: 'south-china-sea' };
  const pending = new Map<string, (r: Response) => void>();
  const json = (value: unknown, status = 200) => new happyWindow.Response(JSON.stringify(value), { status }) as unknown as Response;
  const response = (data: unknown[], source: string, at = time) => json({ data, source, fetchedAt: at, degraded: false });
  const settle = () => new Promise<void>((done) => setTimeout(done, 15));
  let holdAll = false;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    calls.push(path);
    if ((holdAll && ['/api/aviation/delays', '/api/aviation/sigmets', '/api/maritime/vessels'].includes(path))
      || path === '/api/aviation/sigmets') return new Promise<Response>((resolve) => pending.set(path, resolve));
    if (path === '/api/maritime/vessels') return json({ asOf: new Date(time).toISOString(), sampleSize: 1, vessels: [vessel] });
    if (path === '/api/aviation/delays') return response([faa], 'nasstatus.faa.gov');
    return json({ data: [], flights: [], events: [] });
  });
  let aviation = new AviationIntelPanel();
  let maritime = new MaritimeIntelPanel();
  try {
    await settle();
    for (const route of ['/api/aviation/delays', '/api/aviation/sigmets', '/api/maritime/vessels']) {
      assert.equal(calls.filter((c) => c === route).length, 1, route);
    }
    assert.equal(threatEvidence.sample().aviation.topAlert, 'FLL ground stop');
    assert.equal(threatEvidence.sample().maritime.topAlert, '1 in red zone: FIRST');
    pending.get('/api/aviation/sigmets')!(json({ error: 'unavailable' }, 503));
    await settle();
    const row = threatEvidence.sample().aviation;
    assert.equal(row.topAlert, 'FLL ground stop');
    assert.equal(row.coverage, 'partial');
    assert.equal(row.sources.find(s => s.source === 'AWC SIGMETs')?.lastAttempt, 'failed');
    aviation.destroy();
    maritime.destroy();
    clearAviationCache();
    holdAll = true;
    aviation = new AviationIntelPanel();
    maritime = new MaritimeIntelPanel();
    await settle();
    aviation.destroy();
    maritime.destroy();
    assert.equal(threatEvidence.sample().aviation.sources.find(s => s.source === 'AWC SIGMETs')?.lastAttempt, 'failed');
    const newer = time + 500;
    pending.get('/api/aviation/sigmets')!(response([sig], 'aviationweather.gov', newer));
    pending.get('/api/aviation/delays')!(response([{ ...faa, airport: 'LAX' }], 'nasstatus.faa.gov', newer));
    pending.get('/api/maritime/vessels')!(json({ asOf: new Date(newer).toISOString(), sampleSize: 1, vessels: [{ ...vessel, name: 'LATE', observedAt: newer }] }));
    await settle();
    assert.equal(threatEvidence.sample().aviation.topAlert, 'FLL ground stop');
    assert.equal(threatEvidence.sample().maritime.topAlert, '1 in red zone: FIRST');
    assert.equal(threatEvidence.sample().aviation.sources.find(s => s.source === 'AWC SIGMETs')?.lastAttempt, 'failed');
  } finally {
    aviation.destroy();
    maritime.destroy();
    clearAviationCache();
    happyWindow.close();
  }
});
