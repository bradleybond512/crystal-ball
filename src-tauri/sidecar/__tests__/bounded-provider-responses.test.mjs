import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';

const { ipv4Fetch } = await import('../local-api-server.mjs');

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('desktop IPv4 transport rejects an oversized declared provider body before buffering', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-length': '65' });
    res.end(Buffer.alloc(65));
  }, async (url) => {
    await assert.rejects(ipv4Fetch(url, { maxResponseBytes: 64 }), /byte limit/);
  });
});

test('desktop IPv4 transport rejects oversized streamed chunks before buffering', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write(Buffer.alloc(40));
    res.end(Buffer.alloc(40));
  }, async (url) => {
    await assert.rejects(ipv4Fetch(url, { maxResponseBytes: 64 }), /byte limit/);
  });
});

test('desktop IPv4 transport keeps the abort deadline active while a body stalls', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{');
    const finish = setTimeout(() => res.end('}'), 100);
    res.on('close', () => clearTimeout(finish));
  }, async (url) => {
    await assert.rejects(
      ipv4Fetch(url, { maxResponseBytes: 64, signal: AbortSignal.timeout(25) }),
      /abort|timeout/i,
    );
  });
});
