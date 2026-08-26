import assert from 'node:assert/strict';
import test from 'node:test';

interface ProtocolApi {
  createEmergencyPackMapProtocolHandler?: (dependencies: {
    resolveTile(url: string): Promise<{ data: ArrayBuffer; contentType: string } | null>;
    fetchTile(url: string, init: RequestInit): Promise<Response>;
    timeoutMs?: number;
  }) => (parameters: { url: string }, controller: AbortController) => Promise<{ data: ArrayBuffer }>;
  registerEmergencyPackMapProtocolOnce?: (
    addProtocol: (name: string, handler: unknown) => void,
    handler: unknown,
  ) => void;
  transformEmergencyPackMapRequest?: (url: string, resourceType: string) => { url: string };
  unwrapEmergencyPackMapUrl?: (url: string) => string | null;
}

const ORIGINAL_URL = 'https://a.basemaps.cartocdn.com/rastertiles/dark_nolabels/4/1/2.png';
const MAX_TILE_BYTES = 1024 * 1024;

const api = await import('../emergency-pack-map-protocol.ts').catch(() => ({} as ProtocolApi)) as ProtocolApi;

function requireFunction<K extends keyof ProtocolApi>(name: K): NonNullable<ProtocolApi[K]> {
  const value = api[name];
  assert.equal(typeof value, 'function', `${String(name)} should be exported`);
  return value as NonNullable<ProtocolApi[K]>;
}

test('a Carto raster tile is wrapped without changing unrelated or non-tile requests', () => {
  const transform = requireFunction('transformEmergencyPackMapRequest');
  const unwrap = requireFunction('unwrapEmergencyPackMapUrl');
  const transformed = transform(ORIGINAL_URL, 'Tile');
  assert.notEqual(transformed.url, ORIGINAL_URL);
  assert.equal(unwrap(transformed.url), ORIGINAL_URL);
  assert.deepEqual(transform(ORIGINAL_URL, 'Source'), { url: ORIGINAL_URL });
  assert.deepEqual(transform('https://example.com/4/1/2.png', 'Tile'), { url: 'https://example.com/4/1/2.png' });
  assert.deepEqual(
    transform('https://a.basemaps.cartocdn.com/rastertiles/voyager/4/1/2.png', 'Tile'),
    { url: 'https://a.basemaps.cartocdn.com/rastertiles/voyager/4/1/2.png' },
  );
});

test('protocol serves verified offline bytes without network and preserves exact HTTPS fallback', async () => {
  const create = requireFunction('createEmergencyPackMapProtocolHandler');
  const transform = requireFunction('transformEmergencyPackMapRequest');
  const offlineBytes = new Uint8Array([1, 2, 3, 4]);
  let networkCalls = 0;
  const offlineHandler = create({
    resolveTile: async (url) => {
      assert.equal(url, ORIGINAL_URL);
      return { data: offlineBytes.slice().buffer, contentType: 'image/png' };
    },
    fetchTile: async () => { networkCalls += 1; throw new Error('network disabled'); },
  });
  const offline = await offlineHandler(transform(ORIGINAL_URL, 'Tile'), new AbortController());
  assert.deepEqual(new Uint8Array(offline.data), offlineBytes);
  assert.equal(networkCalls, 0);

  const controller = new AbortController();
  const onlineBytes = new Uint8Array([5, 6, 7, 8]);
  const fetches: Array<{ url: string; init: RequestInit }> = [];
  const fallbackHandler = create({
    resolveTile: async () => null,
    fetchTile: async (url, init) => {
      fetches.push({ url, init });
      return new Response(onlineBytes.slice(), {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': String(onlineBytes.byteLength) },
      });
    },
  });
  const online = await fallbackHandler(transform(ORIGINAL_URL, 'Tile'), controller);
  assert.deepEqual(new Uint8Array(online.data), onlineBytes);
  assert.equal(fetches.length, 1);
  assert.equal(fetches[0]?.url, ORIGINAL_URL);
  assert.equal(fetches[0]?.init.mode, 'cors');
  assert.equal(fetches[0]?.init.credentials, 'omit');
  assert.equal(fetches[0]?.init.redirect, 'error');
  assert.equal(fetches[0]?.init.referrerPolicy, 'no-referrer');
  assert.ok(fetches[0]?.init.signal instanceof AbortSignal);
  assert.equal(fetches[0]?.init.signal?.aborted, false);
});

function delayedBody(onCancel: () => void): ReadableStream<Uint8Array> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1]));
      timer = setTimeout(() => controller.close(), 100);
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      onCancel();
    },
  });
}

function handlerForResponse(response: Response, options: { timeoutMs?: number } = {}) {
  const create = requireFunction('createEmergencyPackMapProtocolHandler');
  return create({
    resolveTile: async () => null,
    fetchTile: async () => response,
    ...options,
  });
}

function protocolRequest(): { url: string } {
  return requireFunction('transformEmergencyPackMapRequest')(ORIGINAL_URL, 'Tile');
}

test('protocol cancels a chunked online tile as soon as it exceeds 1 MiB', async () => {
  let cancelled = 0;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_TILE_BYTES));
      controller.enqueue(new Uint8Array([1]));
      closeTimer = setTimeout(() => controller.close(), 100);
    },
    cancel() {
      if (closeTimer !== undefined) clearTimeout(closeTimer);
      cancelled += 1;
    },
  });
  const handler = handlerForResponse(new Response(body, {
    status: 200,
    headers: { 'content-type': 'image/png' },
  }));

  await assert.rejects(handler(protocolRequest(), new AbortController()), /byte cap/i);
  assert.equal(cancelled, 1);
});

for (const [name, headers] of [
  ['wrong', { 'content-type': 'image/svg+xml' }],
  ['missing', {}],
] as const) {
  test(`protocol rejects and cancels an online tile with ${name} MIME`, async () => {
    let cancelled = 0;
    const handler = handlerForResponse(new Response(delayedBody(() => { cancelled += 1; }), {
      status: 200,
      headers,
    }));

    await assert.rejects(handler(protocolRequest(), new AbortController()), /content type/i);
    assert.equal(cancelled, 1);
  });
}

test('protocol rejects and cancels redirected online tile responses', async () => {
  let cancelled = 0;
  const response = new Response(delayedBody(() => { cancelled += 1; }), {
    status: 200,
    headers: { 'content-type': 'image/png' },
  });
  Object.defineProperty(response, 'redirected', { value: true });
  const handler = handlerForResponse(response);

  await assert.rejects(handler(protocolRequest(), new AbortController()), /redirect/i);
  assert.equal(cancelled, 1);
});

test('protocol rejects online tiles whose declared length differs from streamed bytes', async () => {
  const handler = handlerForResponse(new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { 'content-type': 'image/png', 'content-length': '4' },
  }));

  await assert.rejects(handler(protocolRequest(), new AbortController()), /length mismatch/i);
});

test('protocol aborts and cancels a stalled tile stream on caller cancellation', async () => {
  let cancelled = 0;
  let fetchSignal: AbortSignal | null = null;
  const create = requireFunction('createEmergencyPackMapProtocolHandler');
  const handler = create({
    resolveTile: async () => null,
    fetchTile: async (_url, init) => {
      fetchSignal = init.signal as AbortSignal;
      return new Response(delayedBody(() => { cancelled += 1; }), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    },
    timeoutMs: 1_000,
  });
  const controller = new AbortController();
  const request = handler(protocolRequest(), controller);
  controller.abort();

  await assert.rejects(request, /aborted/i);
  assert.equal(fetchSignal?.aborted, true);
  assert.equal(cancelled, 1);
});

test('protocol times out and cancels a stalled tile stream', async () => {
  let cancelled = 0;
  const handler = handlerForResponse(new Response(delayedBody(() => { cancelled += 1; }), {
    status: 200,
    headers: { 'content-type': 'image/png' },
  }), { timeoutMs: 10 });

  await assert.rejects(handler(protocolRequest(), new AbortController()), /aborted/i);
  assert.equal(cancelled, 1);
});

test('protocol registration is idempotent', () => {
  const register = requireFunction('registerEmergencyPackMapProtocolOnce');
  const registrations: unknown[] = [];
  const addProtocol = (name: string, handler: unknown) => registrations.push({ name, handler });
  const handler = () => undefined;
  register(addProtocol, handler);
  register(addProtocol, handler);
  assert.deepEqual(registrations, [{ name: 'wm-emergency-pack-map', handler }]);
});
