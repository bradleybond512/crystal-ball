import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSidecarClient, SidecarRuntimeFiles } from '../tools/mcp-server/sidecar-client.mjs';
import { summarizeSidecarHealth } from './sidecar-health-contract.mjs';

test('published-port health targets and doctor client authenticate to the same owned listener', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'health-consumers-'));
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ path: req.url, authorization: req.headers.authorization });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, authenticated: true, keys_configured: 0, keys_total: 1,
      feeds: [{ key: 'private-feed-canary', lastError: 'private-error-canary' }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    writeFileSync(path.join(root, 'sidecar.port'), String(port));
    writeFileSync(path.join(root, 'sidecar.token'), 'fixture-only-consumer-token');
    const target = SidecarRuntimeFiles.healthRequest(root);
    const scripted = await new Promise((resolve, reject) => {
      const request = http.get(target.url, { timeout: 2000, headers: target.headers }, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => resolve(JSON.parse(body)));
      });
      request.on('error', reject);
      request.on('timeout', () => { request.destroy(new Error('fixture timeout')); });
    });
    const doctored = await createSidecarClient(root).get('/api/health');
    assert.deepEqual(scripted, doctored);
    assert.deepEqual(seen, Array.from({ length: 2 }, () => ({
      path: '/api/health', authorization: 'Bearer fixture-only-consumer-token',
    })));
    const summary = summarizeSidecarHealth(scripted);
    assert.equal(summary.authenticated, true);
    assert.equal(summary.failedFeedCount, 1);
    assert.equal(summary.keysMissing, 1);
    assert.equal(JSON.stringify(summary).includes('canary'), false);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});

test('checkup and smoke consume shared discovery, preserve timeouts, and print aggregates only', () => {
  for (const name of ['checkup.mjs', 'smoke.mts']) {
    const source = readFileSync(new URL(name, import.meta.url), 'utf8');
    assert.match(source, /SidecarRuntimeFiles\.healthRequest\(\)/);
    assert.match(source, /http\.get\(target\.url, \{ timeout: 2000, headers: target\.headers \}/);
    assert.match(source, /summarizeSidecarHealth\(/);
    assert.match(source, /authenticated diagnostics pending/);
    assert.match(source, /summary\.failedFeedCount/);
    assert.match(source, /summary\.keysMissing/);
    assert.doesNotMatch(source, /127\.0\.0\.1:46123|JSON\.stringify\((?:body|data|parsed)|failingFeeds|\.lastError|\.key\b/);
  }
  const smoke = readFileSync(new URL('smoke.mts', import.meta.url), 'utf8');
  assert.match(smoke, /if \(offline\) \{[\s\S]*?skipped \(--offline\)[\s\S]*?\} else \{/);
});
