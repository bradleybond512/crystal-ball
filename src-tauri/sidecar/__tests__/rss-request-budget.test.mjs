import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import net from 'node:net';
import https from 'node:https';
import dns from 'node:dns/promises';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// DNS-only fixtures; actual sockets are restricted to owned loopback servers.
// eslint-disable-next-line sonarjs/no-hardcoded-ip
const PUBLIC_IP = '93.184.216.34';
// eslint-disable-next-line sonarjs/no-hardcoded-ip
const PRIVATE_IP = '10.0.0.1';
// eslint-disable-next-line sonarjs/no-hardcoded-ip
const PUBLIC_IPV6 = '2606:4700:4700::1111';
const guardedFetch = globalThis.fetch;
const sidecar = await import('../local-api-server.mjs');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function within(promise, ms = 1000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((resolve) => { timer = setTimeout(() => resolve('still pending'), ms); })]);
  } finally { clearTimeout(timer); }
}

async function rejectsWithin(promise, expected) {
  const outcome = await within(promise.then((value) => ({ value }), (error) => ({ error })));
  assert.notEqual(outcome, 'still pending', 'operation must reject after cancellation');
  assert.ok(Object.hasOwn(outcome, 'error'), 'operation must reject, not resolve');
  await assert.rejects(Promise.reject(outcome.error), expected);
}

async function upstream(t, handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('HTTP caller abort closes a real upstream socket during a buffered body', async (t) => {
  const started = deferred();
  const closed = deferred();
  const url = await upstream(t, (req, res) => {
    req.socket.once('close', () => closed.resolve('closed'));
    res.writeHead(200, { 'content-type': 'application/xml' });
    res.write('<rss>');
    started.resolve();
  });
  const controller = new AbortController();
  const result = sidecar._fetchWithTimeoutForTests(url, { signal: controller.signal }, 3000)
    .then(() => 'resolved', () => 'rejected');
  await started.promise;
  controller.abort(new Error('fixture caller cancelled'));
  assert.equal(await within(result), 'rejected', 'caller abort must reject without waiting for the transport timeout');
  assert.equal(await within(closed.promise), 'closed', 'caller abort must close the actual upstream socket');
});

test('HTTP caller abort remains attached after native fetch returns headers', async (t) => {
  const closed = deferred();
  const url = await upstream(t, (req, res) => {
    req.socket.once('close', () => closed.resolve('closed'));
    res.writeHead(200, { 'content-type': 'application/xml' });
    res.write('<rss>');
  });
  t.mock.method(globalThis, 'fetch', guardedFetch);
  const controller = new AbortController();
  const response = await sidecar._fetchWithTimeoutForTests(url, { signal: controller.signal }, 3000);
  const result = response.text().then(() => 'resolved', () => 'rejected');
  controller.abort(new Error('fixture body cancelled'));
  assert.equal(await within(result), 'rejected');
  assert.equal(await within(closed.promise), 'closed');
});

async function flush() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

function clock() {
  let time = 0;
  let scheduled = 0;
  const timers = new Map();
  return {
    now: () => time,
    setTimer(callback, delay) {
      const handle = { unref() {} };
      timers.set(handle, { at: time + delay, callback });
      scheduled++;
      return handle;
    },
    clearTimer: (handle) => timers.delete(handle),
    elapse: (ms) => { time += ms; },
    async advance(ms) {
      time += ms;
      for (const [handle, timer] of timers) {
        if (timer.at <= time) { timers.delete(handle); timer.callback(); }
      }
      await flush();
    },
    pending: () => timers.size,
    scheduled: () => scheduled,
  };
}

let hostnameNumber = 0;
const freshUrl = () => `https://rss-${++hostnameNumber}.example.org/feed`;
const response = (status = 200, body = '<rss/>', location = null) => ({
  status,
  headers: { get: (name) => ({ location, 'content-type': 'application/xml' })[name] ?? null },
  text: async () => body,
});
function resolver(overrides = {}) {
  const calls = [];
  return {
    calls,
    async resolve4(host) { calls.push(['A', host]); return [PUBLIC_IP]; },
    async resolve6(host) { calls.push(['AAAA', host]); return []; },
    cancel() { calls.push(['cancel']); },
    ...overrides,
  };
}
function operation(deps = {}, request = new http.IncomingMessage(new net.Socket())) {
  const time = clock();
  const ownedResolver = resolver();
  const fetches = [];
  const promise = sidecar.fetchRssWithBudget(freshUrl(), { request, headers: { accept: 'application/xml' } }, {
    ...time,
    createResolver: () => ownedResolver,
    fetchImpl: async (...args) => { fetches.push(args); return response(); },
    ...deps,
  });
  return { time, ownedResolver, fetches, request, promise };
}
function assertReleased(run) {
  assert.equal(run.time.pending(), 0);
  assert.equal(run.request.listenerCount('aborted'), 0);
  assert.equal(run.request.listenerCount('close'), 0);
  assert.equal(run.request.socket.listenerCount('close'), 0);
}

test('one deadline spans all four permitted requests and succeeds at7999ms', async () => {
  const time = clock();
  let calls = 0;
  const signals = [];
  const ownedResolver = resolver({
    async resolve4() { time.elapse(500); return [PUBLIC_IP]; },
    async resolve6() { time.elapse(500); return []; },
  });
  const run = operation({ ...time, createResolver: () => ownedResolver, fetchImpl: async (_url, options, timeout) => {
    calls++;
    signals.push(options.signal);
    assert.equal(options.resolvedAddress, PUBLIC_IP);
    assert.equal(options.redirect, 'manual');
    assert.equal(timeout, 8000);
    time.elapse(calls === 4 ? 999 : 1000);
    return calls === 4 ? response(201, '<rss>done</rss>') : response(302, '', freshUrl());
  } });
  assert.deepEqual(await run.promise, { status: 201, contentType: 'application/xml', body: '<rss>done</rss>' });
  assert.equal(time.now(), 7999);
  assert.equal(calls, 4);
  assert.ok(signals.every((signal) => signal === signals[0] && !signal.aborted));
  assert.equal(time.scheduled(), 1);
  assert.equal(time.pending(), 0);
  assert.equal(ownedResolver.calls.filter(([kind]) => kind === 'cancel').length, 1);
  assertReleased(run);
});

test('cumulative redirect DNS expires before another lookup or outbound request', async () => {
  const time = clock();
  let dnsCalls = 0;
  let fetches = 0;
  const ownedResolver = resolver({
    async resolve4() { dnsCalls++; time.elapse(2000); return [PUBLIC_IP]; },
    async resolve6() { dnsCalls++; time.elapse(1000); return []; },
  });
  const run = operation({ ...time, createResolver: () => ownedResolver, fetchImpl: async () => {
    fetches++;
    time.elapse(3000);
    return response(302, '', freshUrl());
  } });
  await rejectsWithin(run.promise, { code: 'RSS_DEADLINE' });
  assert.equal(time.now(), 8000);
  assert.equal(dnsCalls, 3, 'no redirect AAAA lookup after the shared budget expires');
  assert.equal(fetches, 1, 'no second outbound request');
  assert.equal(time.scheduled(), 1);
  assert.equal(time.pending(), 0);
});

for (const completion of ['resolve', 'reject']) {
  test(`initial DNS deadline cancels ownership and blocks late ${completion} continuation`, async () => {
    const pending = deferred();
    const ownedResolver = resolver({ resolve4() { this.calls.push(['A']); return pending.promise; } });
    const run = operation({ createResolver: () => ownedResolver });
    const failed = rejectsWithin(run.promise, { code: 'RSS_DEADLINE' });
    await flush();
    await run.time.advance(8000);
    await failed;
    pending[completion](completion === 'resolve' ? [PUBLIC_IP] : new Error('late private diagnostic'));
    await flush();
    assert.deepEqual(ownedResolver.calls, [['A'], ['cancel']]);
    assert.equal(run.fetches.length, 0);
    assertReleased(run);
  });
}

test('late AAAA completion cannot publish a cancelled DNS cache entry', async () => {
  const pending = deferred();
  const url = freshUrl();
  const controller = new AbortController();
  const ownedResolver = resolver({ resolve6() { return pending.promise; } });
  const check = sidecar.isSafeUrl(url, { resolver: ownedResolver, signal: controller.signal });
  const failed = rejectsWithin(check, /cancelled/);
  await flush();
  controller.abort(new Error('cancelled'));
  pending.resolve([PUBLIC_IPV6]);
  await failed;
  const next = resolver();
  const nextVerdict = await sidecar.isSafeUrl(url, { resolver: next });
  assert.equal(nextVerdict.safe, true);
  assert.deepEqual(next.calls.map(([kind]) => kind), ['A', 'AAAA'], 'cancelled operation must not populate the shared cache');
});

for (const stage of ['headers', 'body']) {
  test(`deadline stops an uncooperative pending ${stage} promise and cleans resources`, async () => {
    const pending = deferred();
    let signal;
    const run = operation({ fetchImpl: async (_url, options) => {
      signal = options.signal;
      return stage === 'headers' ? pending.promise : { ...response(), text: () => pending.promise };
    } });
    const failed = rejectsWithin(run.promise, { code: 'RSS_DEADLINE' });
    await flush();
    await run.time.advance(8000);
    await failed;
    assert.equal(signal.aborted, true);
    pending.resolve(stage === 'headers' ? response(302, '', freshUrl()) : 'late body');
    await flush();
    assertReleased(run);
  });
}

test('normal request close is harmless; socket disconnect cancels only its own operation', async () => {
  const pendingA = deferred();
  const pendingB = deferred();
  const first = operation({ fetchImpl: () => pendingA.promise });
  const second = operation({ fetchImpl: () => pendingB.promise });
  const failed = rejectsWithin(first.promise, { code: 'RSS_CLIENT_DISCONNECTED' });
  await flush();
  second.request.emit('close');
  assert.equal(second.ownedResolver.calls.filter(([kind]) => kind === 'cancel').length, 0);
  first.request.socket.emit('close');
  await failed;
  assert.equal(second.ownedResolver.calls.filter(([kind]) => kind === 'cancel').length, 0);
  pendingB.resolve(response());
  const secondResponse = await second.promise;
  assert.equal(secondResponse.body, '<rss/>');
  pendingA.resolve(response(302, '', freshUrl()));
  await flush();
  assertReleased(first);
  assertReleased(second);
});

test('request abort rejects before a late fetch result can redirect', async () => {
  const pending = deferred();
  let fetches = 0;
  const run = operation({ fetchImpl: () => { fetches++; return pending.promise; } });
  const failed = rejectsWithin(run.promise, { code: 'RSS_CLIENT_DISCONNECTED' });
  await flush();
  run.request.emit('aborted');
  await failed;
  pending.resolve(response(302, '', freshUrl()));
  await flush();
  assert.equal(fetches, 1);
  assertReleased(run);
});

test('a client already disconnected at entry performs no DNS or transport work', async () => {
  for (const state of ['aborted', 'destroyed']) {
    const request = new http.IncomingMessage(new net.Socket());
    if (state === 'aborted') request.aborted = true;
    else request.socket.destroyed = true;
    const run = operation({}, request);
    await rejectsWithin(run.promise, { code: 'RSS_CLIENT_DISCONNECTED' });
    assert.deepEqual(run.ownedResolver.calls, [['cancel']]);
    assert.equal(run.fetches.length, 0);
    assertReleased(run);
  }
});

test('redirect limit remains three and rejects a fourth redirect without another DNS lookup', async () => {
  let fetches = 0;
  const run = operation({ fetchImpl: async () => { fetches++; return response(302, '', freshUrl()); } });
  await rejectsWithin(run.promise, { code: 'RSS_REDIRECT_LIMIT' });
  assert.equal(fetches, 4);
  assert.equal(run.ownedResolver.calls.filter(([kind]) => kind === 'A').length, 4);
  assertReleased(run);
});

test('all-address validation rejects private A and AAAA records and unsafe redirect targets', async () => {
  for (const addresses of [[PUBLIC_IP, '127.0.0.1'], [PUBLIC_IP, PRIVATE_IP]]) {
    const verdict = await sidecar.isSafeUrl(freshUrl(), { resolver: resolver({ resolve4: async () => addresses }) });
    assert.equal(verdict.safe, false);
  }
  const privateV6 = await sidecar.isSafeUrl(freshUrl(), { resolver: resolver({ resolve6: async () => ['::1'] }) });
  assert.equal(privateV6.safe, false);
  for (const url of ['file:///etc/passwd', 'http://user:secret@example.org', 'http://127.0.0.1/']) {
    const run = operation({ fetchImpl: async () => response(302, '', url) });
    await rejectsWithin(run.promise, (error) => error instanceof sidecar.SsrfBlockedError);
    assertReleased(run);
  }
});

function routeHttpsToOwnedSocket(t, target) {
  const destination = new URL(target);
  const requests = [];
  t.mock.method(https, 'request', (options, onResponse) => {
    assert.match(options.hostname, /^rss-\d+\.example\.org$/);
    assert.equal(options.servername ?? options.hostname, options.hostname, 'original hostname remains the TLS name');
    assert.equal(options.family, 4);
    assert.notEqual(options.rejectUnauthorized, false);
    assert.notEqual(options.agent?.options?.rejectUnauthorized, false);
    assert.equal(typeof options.lookup, 'function', 'validated IPv4 pin must reach HTTPS');
    let pinned;
    options.lookup(options.hostname, {}, (error, address, family) => {
      assert.equal(error, null);
      assert.equal(family, 4);
      pinned = address;
    });
    assert.equal(pinned, PUBLIC_IP);
    const request = http.request({
      ...options, hostname: destination.hostname, port: destination.port,
      agent: false, lookup: undefined, servername: undefined,
    }, onResponse);
    requests.push(request);
    return request;
  });
  return requests;
}

for (const stage of ['stalled headers', 'trickling body']) {
  test(`HTTPS branch deadline destroys a real ClientRequest and socket during ${stage}`, async (t) => {
    const started = deferred();
    const closed = deferred();
    const url = await upstream(t, (req, res) => {
      req.socket.once('close', () => closed.resolve('closed'));
      if (stage === 'trickling body') {
        res.writeHead(200, { 'content-type': 'application/xml' });
        res.write('<rss>');
        res.write('<channel>');
      }
      started.resolve();
    });
    const requests = routeHttpsToOwnedSocket(t, url);
    const run = operation({ fetchImpl: sidecar._fetchWithTimeoutForTests });
    const failed = rejectsWithin(run.promise, { code: 'RSS_DEADLINE' });
    assert.notEqual(await within(started.promise), 'still pending');
    await run.time.advance(8000);
    await failed;
    assert.equal(requests.length, 1);
    assert.equal(requests[0].destroyed, true, 'the actual HTTPS-branch ClientRequest must be destroyed');
    assert.equal(await within(closed.promise), 'closed');
    assertReleased(run);
  });
}

async function localRoute(t) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'rss-budget-route-'));
  const app = await sidecar.createLocalApiServer({
    port: 0, apiDir: path.resolve('api'), dataDir, resourceDir: dataDir,
    agentMonitorStatePath: path.join(dataDir, 'monitor-state.json'),
    agentMonitorEventsPath: path.join(dataDir, 'monitor-events.json'),
    littleSnitchExportPath: null, littleSnitchBaselinePath: null,
    logger: { log() {}, warn() {}, error() {} },
  });
  const { port } = await app.start();
  t.after(async () => {
    await app.close();
    sidecar.initQuotaGovernor(null);
    await rm(dataDir, { recursive: true, force: true });
  });
  return {
    url: `http://127.0.0.1:${port}/api/rss-proxy?url=${encodeURIComponent(freshUrl())}`,
    headers: { authorization: `Bearer ${process.env.LOCAL_API_TOKEN}` },
  };
}

function routeResolver(t) {
  let cancelled = 0;
  t.mock.method(dns.Resolver.prototype, 'resolve4', async () => [PUBLIC_IP]);
  t.mock.method(dns.Resolver.prototype, 'resolve6', async () => []);
  t.mock.method(dns.Resolver.prototype, 'cancel', () => { cancelled++; });
  return () => cancelled;
}

function observeRssWrites(t) {
  const calls = [];
  for (const method of ['writeHead', 'end']) {
    const original = http.ServerResponse.prototype[method];
    t.mock.method(http.ServerResponse.prototype, method, function (...args) {
      if (this.req?.url?.startsWith('/api/rss-proxy?')) calls.push(method);
      return original.apply(this, args);
    });
  }
  return calls;
}

test('actual RSS route emits one sanitized504 at its deadline and preserves auth ordering', async (t) => {
  const route = await localRoute(t);
  const writes = observeRssWrites(t);
  const cancels = routeResolver(t);
  const started = deferred();
  const closed = deferred();
  const target = await upstream(t, (req) => {
    req.socket.once('close', () => closed.resolve('closed'));
    started.resolve();
  });
  const requests = routeHttpsToOwnedSocket(t, target);
  const realTimer = globalThis.setTimeout;
  const deadlines = [];
  const ownedTimers = new Set();
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => {
    if (ms > 7900 && ms <= 8000) {
      deadlines.push(fn);
      const handle = { unref() {} };
      ownedTimers.add(handle);
      return handle;
    }
    return realTimer(fn, ms, ...args);
  });
  const realClear = globalThis.clearTimeout;
  t.mock.method(globalThis, 'clearTimeout', (handle) => {
    if (ownedTimers.delete(handle)) return;
    return realClear(handle);
  });
  const unauthorized = await guardedFetch(route.url);
  assert.equal(unauthorized.status, 401);
  assert.equal(requests.length, 0);
  assert.equal(deadlines.length, 0);
  writes.length = 0;
  const result = guardedFetch(route.url, { headers: route.headers });
  assert.notEqual(await within(started.promise), 'still pending');
  assert.equal(deadlines.length, 1);
  deadlines[0]();
  const response = await result;
  assert.equal(response.status, 504);
  assert.deepEqual(await response.json(), { error: 'Feed timeout' });
  assert.equal(requests.length, 1);
  assert.equal(await within(closed.promise), 'closed');
  assert.equal(cancels(), 1);
  assert.equal(ownedTimers.size, 0);
  assert.deepEqual(writes, ['writeHead', 'end'], 'one terminal response only');
});

test('actual completed GET is not a disconnect and generic upstream errors stay private', async (t) => {
  const route = await localRoute(t);
  routeResolver(t);
  const target = await upstream(t, (_req, res) => {
    setImmediate(() => { res.writeHead(201, { 'content-type': 'application/atom+xml' }); res.end('<feed/>'); });
  });
  const requests = routeHttpsToOwnedSocket(t, target);
  const result = await guardedFetch(route.url, { headers: route.headers });
  assert.equal(result.status, 201);
  assert.equal(result.headers.get('content-type'), 'application/atom+xml');
  assert.equal(await result.text(), '<feed/>');
  assert.equal(requests.length, 1);
  t.mock.method(https, 'request', () => { throw new Error('synthetic secret DNS/token diagnostic'); });
  const failed = await guardedFetch(route.url, { headers: route.headers });
  assert.equal(failed.status, 502);
  assert.deepEqual(await failed.json(), { error: 'Failed to fetch feed' });
});

test('actual downstream socket disconnect cancels upstream work without a response', async (t) => {
  const route = await localRoute(t);
  const writes = observeRssWrites(t);
  const cancels = routeResolver(t);
  const started = deferred();
  const closed = deferred();
  const target = await upstream(t, (req) => {
    req.socket.once('close', () => closed.resolve('closed'));
    started.resolve();
  });
  const requests = routeHttpsToOwnedSocket(t, target);
  let responses = 0;
  const client = http.get(route.url, { headers: route.headers }, () => { responses++; });
  client.on('error', () => {});
  t.after(() => client.destroy());
  assert.notEqual(await within(started.promise), 'still pending');
  client.destroy();
  assert.equal(await within(closed.promise), 'closed');
  assert.equal(requests[0].destroyed, true);
  assert.equal(cancels(), 1);
  assert.equal(responses, 0);
  assert.deepEqual(writes, [], 'writer must not attempt headers or body after disconnect');
});
