import assert from 'node:assert/strict';
import test from 'node:test';
import { createSidecarClient } from '../sidecar-client.mjs';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('discoverPort reads port from file', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mcp-test-'));
  writeFileSync(join(tmp, 'sidecar.port'), '46123');
  writeFileSync(join(tmp, 'sidecar.token'), 'abc123');

  const client = createSidecarClient(tmp);
  assert.equal(client.discoverPort(), 46123);
  assert.equal(client.discoverToken(), 'abc123');

  rmSync(tmp, { recursive: true });
});

test('discoverPort returns null when file missing', () => {
  const client = createSidecarClient('/nonexistent/path');
  assert.equal(client.discoverPort(), null);
});

test('discoverToken returns null when file missing', () => {
  const client = createSidecarClient('/nonexistent/path');
  assert.equal(client.discoverToken(), null);
});

test('checkHealth returns false when sidecar not running', async () => {
  const client = createSidecarClient('/nonexistent/path');
  const healthy = await client.checkHealth();
  assert.equal(healthy, false);
});

test('buildUrl constructs correct URL with params', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mcp-test-'));
  writeFileSync(join(tmp, 'sidecar.port'), '46123');
  writeFileSync(join(tmp, 'sidecar.token'), 'tok');

  const client = createSidecarClient(tmp);
  const url = client.buildUrl('/api/acled-events', { limit: '10' });
  assert.equal(url, 'http://127.0.0.1:46123/api/acled-events?limit=10');

  rmSync(tmp, { recursive: true });
});

test('buildUrl rejects SSRF routes that escape the loopback host (query_raw endpoint)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mcp-test-'));
  writeFileSync(join(tmp, 'sidecar.port'), '46123');
  writeFileSync(join(tmp, 'sidecar.token'), 'tok');
  const client = createSidecarClient(tmp);

  // @-userinfo turns 127.0.0.1:<port> into userinfo + the attacker host into the
  // real host — would ship the bearer token off-box. Must be rejected (null).
  assert.equal(client.buildUrl('@169.254.169.254/latest/meta-data'), null);
  assert.equal(client.buildUrl('@evil.example.com/x'), null);
  // protocol-relative + absolute + non-string routes also rejected.
  assert.equal(client.buildUrl('//evil.example.com/x'), null);
  assert.equal(client.buildUrl('http://evil.example.com/x'), null);
  assert.equal(client.buildUrl('api/no-leading-slash'), null);
  assert.equal(client.buildUrl(undefined), null);
  // Legit relative routes still build against loopback.
  assert.equal(client.buildUrl('/api/situation'), 'http://127.0.0.1:46123/api/situation');

  rmSync(tmp, { recursive: true });
});

test('get returns error when sidecar not running', async () => {
  const client = createSidecarClient('/nonexistent/path');
  const result = await client.get('/api/health');
  assert.ok(result.error);
  assert.equal(result.healthy, false);
});

test('getAll returns map with results for each route', async () => {
  const client = createSidecarClient('/nonexistent/path');
  const results = await client.getAll(['/api/health', '/api/status']);
  assert.ok(results instanceof Map);
  assert.equal(results.size, 2);
  assert.ok(results.get('/api/health').error);
  assert.ok(results.get('/api/status').error);
});
