import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const TEST_TOKEN = 'agent-monitor-projection-test-token';
process.env.LOCAL_API_TOKEN ??= TEST_TOKEN;
const { createLocalApiServer } = await import('../local-api-server.mjs');

const silentLogger = { log() {}, warn() {}, error() {} };

async function withApp(t, contents, eventContents = null) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agent-monitor-projection-'));
  const statePath = path.join(tempDir, 'state.json');
  const eventsPath = path.join(tempDir, 'events.json');
  if (contents !== null) await writeFile(statePath, contents, { mode: 0o600 });
  if (eventContents !== null) await writeFile(eventsPath, eventContents, { mode: 0o600 });
  const app = await createLocalApiServer({
    port: 0,
    logger: silentLogger,
    agentMonitorStatePath: statePath,
    agentMonitorEventsPath: eventsPath,
  });
  const { port } = await app.start();
  t.after(async () => {
    await app.close();
    await rm(tempDir, { recursive: true, force: true });
  });
  return `http://127.0.0.1:${port}/api/local-agent-monitor`;
}

function validState(now = Date.now()) {
  return {
    schemaVersion: 1,
    generationId: 'monitor-generation-v1-1785000000000',
    available: true,
    lastRunAt: now - 1000,
    nextRunAt: now + 60_000,
    status: 'red',
    summary: 'Authorization: Bearer must-not-leak /Users/private/raw.json',
    findings: [{
      id: 'drift.feed./api/nws-alerts',
      severity: 'red',
      summary: 'secret payload must-not-leak',
      nextAction: '/Users/private/token.txt',
      payload: { token: 'must-not-leak' },
    }],
    recovered: ['drift.feed.weather'],
    snapshot: {
      sidecarAvailable: true,
      algorithmDiagnosticsAvailable: true,
      feeds: { weather: 'ok', markets: 'degraded' },
      quarantinedAlgorithms: ['warning-verification'],
      rawFile: '/Users/private/raw.json',
      environment: { LOCAL_API_TOKEN: 'must-not-leak' },
    },
  };
}

function validEvents(now = Date.now()) {
  return {
    schemaVersion: 1,
    generationId: 'monitor-generation-v1-1785000000000',
    schedule: {
      expectedIntervalMs: 15 * 60_000,
      stoppedGraceMs: 0,
      lastRunAt: now - 1000,
      nextRunAt: now + 60_000,
      stoppedAt: null,
    },
    activeFindings: {},
    cooldowns: {},
    events: [{
      schemaVersion: 1,
      id: 'monitor-event-v1-0123456789abcdef01234567',
      type: 'opened',
      subject: 'drift.feed./api/nws-alerts',
      occurredAt: now - 1000,
      toSeverity: 'red',
      summary: 'Authorization: Bearer must-not-leak /Users/private/raw.json',
      headers: { authorization: 'Bearer must-not-leak' },
    }],
  };
}

test('agent monitor projection requires bearer auth and returns no monitor payload on failure', async (t) => {
  const url = await withApp(t, JSON.stringify(validState()), JSON.stringify(validEvents()));
  const response = await fetch(url);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Unauthorized' });
});

test('agent monitor projection allowlists bounded operational metadata and redacts raw state', async (t) => {
  const url = await withApp(t, JSON.stringify(validState()), JSON.stringify(validEvents()));
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${process.env.LOCAL_API_TOKEN}` },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.schemaVersion, 1);
  assert.equal(body.state, 'degraded');
  assert.equal(body.compatibility.status, 'compatible');
  assert.deepEqual(body.quarantine.algorithmIds, ['warning-verification']);
  assert.equal(body.capabilities.feeds.total, 2);
  assert.equal(body.findings[0].id, 'drift.feed./api/nws-alerts');
  assert.equal(body.events[0].type, 'opened');
  assert.deepEqual(body.recovered, ['drift.feed.weather']);
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /must-not-leak|Authorization|Bearer|LOCAL_API_TOKEN/);
  assert.doesNotMatch(serialized, /\/Users\/private|rawFile|environment|headers|payload|nextAction/);
});

test('missing, corrupt, invalid, future, and oversized monitor state never projects healthy', async (t) => {
  const cases = [
    { name: 'missing', contents: null, expected: 'unavailable' },
    { name: 'corrupt', contents: '{bad json', expected: 'unknown' },
    { name: 'corrupt events', contents: JSON.stringify(validState()), events: '{bad json', expected: 'unknown' },
    { name: 'malformed event', contents: JSON.stringify(validState()), events: JSON.stringify({ ...validEvents(), events: [{ id: 'bad' }] }), expected: 'unknown' },
    { name: 'invalid timestamp', contents: JSON.stringify({ ...validState(), lastRunAt: 'today' }), events: JSON.stringify(validEvents()), expected: 'unknown' },
    { name: 'future schema', contents: JSON.stringify(validState()), events: JSON.stringify({ ...validEvents(), schemaVersion: 2 }), expected: 'incompatible' },
    { name: 'unversioned state', contents: JSON.stringify({ ...validState(), schemaVersion: undefined }), events: JSON.stringify(validEvents()), expected: 'unknown' },
    { name: 'mismatched generation', contents: JSON.stringify(validState()), events: JSON.stringify({ ...validEvents(), generationId: 'monitor-generation-v1-other' }), expected: 'unknown' },
    { name: 'oversized', contents: JSON.stringify({ ...validState(), padding: 'x'.repeat(300_000) }), expected: 'unknown' },
  ];

  for (const row of cases) {
    await t.test(row.name, async (st) => {
      const url = await withApp(st, row.contents, row.events ?? null);
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${process.env.LOCAL_API_TOKEN}` },
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.state, row.expected);
      assert.notEqual(body.state, 'live');
      assert.deepEqual(body.findings, []);
      assert.deepEqual(body.events, []);
    });
  }
});

test('agent monitor projection bounds widespread findings instead of hiding all degradation', async (t) => {
  const state = validState();
  state.findings = Array.from({ length: 20 }, (_, index) => ({
    id: `drift.feed./api/feed-${index}`,
    severity: index < 3 ? 'red' : 'yellow',
  }));
  const url = await withApp(t, JSON.stringify(state), JSON.stringify(validEvents()));
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${process.env.LOCAL_API_TOKEN}` },
  });
  const body = await response.json();
  assert.equal(body.state, 'degraded');
  assert.equal(body.findings.length, 16);
  assert.equal(body.findings.filter((finding) => finding.severity === 'red').length, 3);
});

test('missed monitor windows project stale and then stopped without exposing raw state', async (t) => {
  const now = Date.now();
  const staleUrl = await withApp(t, JSON.stringify({
    ...validState(now),
    status: 'green',
    lastRunAt: now - 31 * 60_000,
    findings: [],
  }), JSON.stringify({
    ...validEvents(now),
    schedule: {
      ...validEvents(now).schedule,
      lastRunAt: now - 31 * 60_000,
      nextRunAt: now - 16 * 60_000,
    },
    events: [],
  }));
  const stoppedUrl = await withApp(t, JSON.stringify({
    ...validState(now),
    status: 'green',
    lastRunAt: now - 61 * 60_000,
    findings: [],
  }), JSON.stringify({
    ...validEvents(now),
    schedule: {
      ...validEvents(now).schedule,
      lastRunAt: now - 61 * 60_000,
      nextRunAt: now - 46 * 60_000,
      stoppedAt: now - 1000,
    },
    events: [],
  }));
  const headers = { authorization: `Bearer ${process.env.LOCAL_API_TOKEN}` };
  const staleResponse = await fetch(staleUrl, { headers });
  const stoppedResponse = await fetch(stoppedUrl, { headers });
  const staleBody = await staleResponse.json();
  const stoppedBody = await stoppedResponse.json();
  assert.equal(staleBody.state, 'stale');
  assert.equal(stoppedBody.state, 'stopped');
});
