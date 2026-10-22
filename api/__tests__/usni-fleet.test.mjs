import test from 'node:test';
import assert from 'node:assert/strict';
import { invokeHandler } from './_test-utils.mjs';

const ORIGIN = 'tauri://localhost';
let moduleId = 0;

async function freshHandler() {
  const url = new URL('../usni-fleet.js', import.meta.url);
  url.searchParams.set('test', String(moduleId++));
  return (await import(url.href)).default;
}

function upstreamPost(title = 'Fleet Tracker') {
  return [{
    title: { rendered: title },
    link: 'https://news.usni.org/fleet-tracker-fixture',
    date: '2026-10-18T12:00:00',
    excerpt: { rendered: '<p>Fleet&nbsp; <b>update</b></p>' },
    content: { rendered: '<p>Ships\n <strong>at sea</strong></p>' },
  }];
}

function json(payload, status = 200) {
  return Response.json(payload, { status });
}

function request(handler, options = {}) {
  return invokeHandler(handler, { ...options, headers: { origin: ORIGIN, ...options.headers } });
}

test('USNI allows Tauri OPTIONS and rejects unsupported methods without fetching', async (t) => {
  const handler = await freshHandler();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return json(upstreamPost()); });
  const options = await request(handler, { method: 'OPTIONS' });
  assert.equal(options.res.statusCode, 204);
  assert.equal(options.response.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(options.response.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
  assert.equal(options.res.body, '');
  for (const method of ['POST', 'DELETE']) {
    const { res } = await request(handler, { method });
    assert.equal(res.statusCode, 405);
    assert.deepEqual(res.body, { error: 'Method not allowed' });
  }
  assert.equal(calls, 0);
});

test('USNI denies unrelated origins before OPTIONS or upstream fetch', async (t) => {
  const handler = await freshHandler();
  const deniedOrigin = 'https://news.usni.org';
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return json(upstreamPost()); });
  for (const method of ['GET', 'OPTIONS']) {
    const { res, response } = await request(handler, { method, headers: { origin: deniedOrigin } });
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: 'Origin not allowed' });
    assert.notEqual(response.headers.get('access-control-allow-origin'), deniedOrigin);
  }
  assert.equal(calls, 0);
});

test('USNI normalizes upstream HTML and bounds excerpt and content lengths', async (t) => {
  const handler = await freshHandler();
  const post = upstreamPost();
  post[0].excerpt.rendered += ' x'.repeat(400);
  post[0].content.rendered += ' y'.repeat(2500);
  const seen = [];
  t.mock.method(globalThis, 'fetch', async (url) => { seen.push(new URL(url)); return json(post); });
  const { res, response } = await request(handler);
  assert.equal(res.statusCode, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(res.body.source, 'news.usni.org');
  assert.equal(res.body.degraded, undefined);
  assert.equal(res.body.fleet.length, 1);
  assert.deepEqual(res.body.fleet[0], {
    title: 'Fleet Tracker',
    link: post[0].link,
    date: post[0].date,
    excerpt: `Fleet update${' x'.repeat(400)}`.slice(0, 500),
    content: `Ships at sea${' y'.repeat(2500)}`.slice(0, 4000),
  });
  assert.ok(Number.isFinite(Date.parse(res.body.generatedAt)));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].origin, 'https://news.usni.org');
  assert.equal(seen[0].pathname, '/wp-json/wp/v2/posts');
  assert.equal(seen[0].searchParams.get('categories'), '4137');
  assert.equal(seen[0].searchParams.get('per_page'), '1');
});

test('USNI reuses successful data before the TTL and refreshes at the expiry boundary', async (t) => {
  const handler = await freshHandler();
  let now = 1_800_000_000_000;
  let calls = 0;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async () => json(upstreamPost(`Fleet ${++calls}`)));
  const first = await request(handler);
  now += 30 * 60_000 - 1;
  const cached = await request(handler);
  assert.equal(calls, 1);
  assert.deepEqual(cached.res.body, first.res.body);
  now++;
  const refreshed = await request(handler);
  assert.equal(refreshed.res.statusCode, 200);
  assert.equal(calls, 2);
  assert.equal(refreshed.res.body.fleet[0].title, 'Fleet 2');
});

const degradedCases = [
  ['upstream HTTP error', () => json({}, 503), /^USNI returned HTTP 503$/],
  ['empty posts', () => json([]), /^No USNI fleet post found$/],
  ['non-array posts', () => json({ posts: [] }), /^No USNI fleet post found$/],
  ['invalid JSON', () => new Response('<html>not JSON</html>'), /^USNI fetch failed:/],
  ['fetch rejection', () => { throw new Error('fixture transport failure'); }, /^USNI fetch failed:/],
];

for (const [name, failure, reason] of degradedCases) {
  test(`USNI ${name} degrades without caching the failure`, async (t) => {
    const handler = await freshHandler();
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => ++calls === 1 ? failure() : json(upstreamPost('Recovered fleet')));
    const degraded = await request(handler);
    assert.equal(degraded.res.statusCode, 200);
    assert.deepEqual(degraded.res.body.fleet, []);
    assert.equal(degraded.res.body.degraded, true);
    assert.equal(degraded.res.body.source, 'news.usni.org');
    assert.match(degraded.res.body.reason, reason);
    const recovered = await request(handler);
    assert.equal(recovered.res.statusCode, 200);
    assert.equal(calls, 2, 'the next request must retry the upstream');
    assert.equal(recovered.res.body.degraded, undefined);
    assert.equal(recovered.res.body.fleet[0].title, 'Recovered fleet');
  });
}
