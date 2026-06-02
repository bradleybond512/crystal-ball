// Regression tests for the IPv4-pinned fetch monkeypatch's redirect handling.
// Before the fix it issued a single request and returned the raw 3xx, so any
// upstream that began redirecting (OFAC's sdn.xml -> presigned S3) failed with
// "upstream HTTP 302". These tests stand up local HTTP servers and assert the
// patched fetch follows redirects per the fetch contract.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import http from 'node:http';
import { ipv4Fetch } from '../local-api-server.mjs';

function startServer(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}
const addr = (srv) => `http://127.0.0.1:${srv.address().port}`;

test('follows a 302 to a different origin and returns the final 200 body', async () => {
  const target = await startServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('FINAL-BODY');
  });
  const redirector = await startServer((req, res) => {
    res.writeHead(302, { Location: `${addr(target)}/final` });
    res.end();
  });
  try {
    const r = await ipv4Fetch(`${addr(redirector)}/start`);
    assert.equal(r.status, 200);
    assert.equal(r.ok, true);
    assert.equal(await r.text(), 'FINAL-BODY');
  } finally {
    target.close();
    redirector.close();
  }
});

test('honors redirect:"manual" by returning the raw 3xx', async () => {
  const redirector = await startServer((req, res) => {
    res.writeHead(302, { Location: 'http://127.0.0.1:9/none' });
    res.end();
  });
  try {
    const r = await ipv4Fetch(`${addr(redirector)}/x`, { redirect: 'manual' });
    assert.equal(r.status, 302);
  } finally {
    redirector.close();
  }
});

test('throws on redirect:"error"', async () => {
  const redirector = await startServer((req, res) => {
    res.writeHead(302, { Location: 'http://127.0.0.1:9/none' });
    res.end();
  });
  try {
    await assert.rejects(() => ipv4Fetch(`${addr(redirector)}/x`, { redirect: 'error' }), /redirect: "error"/);
  } finally {
    redirector.close();
  }
});

test('follows a relative Location and downgrades POST->GET on 303', async () => {
  let secondMethod = null;
  const srv = await startServer((req, res) => {
    if (req.url === '/post') {
      res.writeHead(303, { Location: '/result' });
      res.end();
      return;
    }
    secondMethod = req.method;
    res.writeHead(200);
    res.end('done');
  });
  try {
    const r = await ipv4Fetch(`${addr(srv)}/post`, { method: 'POST', body: 'payload' });
    assert.equal(r.status, 200);
    assert.equal(secondMethod, 'GET');
  } finally {
    srv.close();
  }
});

test('rejects without sending a request when the signal is already aborted', async () => {
  const ac = new AbortController();
  ac.abort();
  let hits = 0;
  const srv = await startServer((req, res) => {
    hits += 1;
    res.writeHead(200);
    res.end('x');
  });
  try {
    await assert.rejects(
      () => ipv4Fetch(`${addr(srv)}/`, { signal: ac.signal }),
      (e) => e.name === 'AbortError' || /abort/i.test(e.message),
    );
    assert.equal(hits, 0, 'no request should be sent when pre-aborted');
  } finally {
    srv.close();
  }
});

test('throws on a redirect loop exceeding the hop cap', async () => {
  const srv = await startServer((req, res) => {
    // Relative Location resolves against the current origin -> same server -> loops.
    res.writeHead(302, { Location: '/loop' });
    res.end();
  });
  try {
    await assert.rejects(() => ipv4Fetch(`${addr(srv)}/loop`), /Too many redirects/);
  } finally {
    srv.close();
  }
});
