import assert from 'node:assert/strict';
import test from 'node:test';

interface ProtocolApi {
  createEmergencyPackMapProtocolHandler?: (dependencies: {
    resolveTile(url: string): Promise<{ data: ArrayBuffer; contentType: string } | null>;
    fetchTile(url: string, signal: AbortSignal): Promise<Response>;
  }) => (parameters: { url: string }, controller: AbortController) => Promise<{ data: ArrayBuffer }>;
  registerEmergencyPackMapProtocolOnce?: (
    addProtocol: (name: string, handler: unknown) => void,
    handler: unknown,
  ) => void;
  transformEmergencyPackMapRequest?: (url: string, resourceType: string) => { url: string };
  unwrapEmergencyPackMapUrl?: (url: string) => string | null;
}

const api = await import('../emergency-pack-map-protocol.ts').catch(() => ({} as ProtocolApi)) as ProtocolApi;

function requireFunction<K extends keyof ProtocolApi>(name: K): NonNullable<ProtocolApi[K]> {
  const value = api[name];
  assert.equal(typeof value, 'function', `${String(name)} should be exported`);
  return value as NonNullable<ProtocolApi[K]>;
}

test('a Carto raster tile is wrapped without changing unrelated or non-tile requests', () => {
  const transform = requireFunction('transformEmergencyPackMapRequest');
  const unwrap = requireFunction('unwrapEmergencyPackMapUrl');
  const original = 'https://a.basemaps.cartocdn.com/rastertiles/dark_nolabels/4/1/2.png';
  const transformed = transform(original, 'Tile');
  assert.notEqual(transformed.url, original);
  assert.equal(unwrap(transformed.url), original);
  assert.deepEqual(transform(original, 'Source'), { url: original });
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
  const original = 'https://a.basemaps.cartocdn.com/rastertiles/dark_nolabels/4/1/2.png';
  let networkCalls = 0;
  const offlineHandler = create({
    resolveTile: async (url) => {
      assert.equal(url, original);
      return { data: offlineBytes.slice().buffer, contentType: 'image/png' };
    },
    fetchTile: async () => { networkCalls += 1; throw new Error('network disabled'); },
  });
  const offline = await offlineHandler(transform(original, 'Tile'), new AbortController());
  assert.deepEqual(new Uint8Array(offline.data), offlineBytes);
  assert.equal(networkCalls, 0);

  const controller = new AbortController();
  const onlineBytes = new Uint8Array([5, 6, 7, 8]);
  const fetches: Array<{ url: string; signal: AbortSignal }> = [];
  const fallbackHandler = create({
    resolveTile: async () => null,
    fetchTile: async (url, signal) => {
      fetches.push({ url, signal });
      return new Response(onlineBytes.slice(), { status: 200, headers: { 'content-type': 'image/png' } });
    },
  });
  const online = await fallbackHandler(transform(original, 'Tile'), controller);
  assert.deepEqual(new Uint8Array(online.data), onlineBytes);
  assert.deepEqual(fetches, [{ url: original, signal: controller.signal }]);
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
