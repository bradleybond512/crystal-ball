import assert from 'node:assert/strict';
import test from 'node:test';

interface InvokeCall {
  command: string;
}

type InvokeImpl = <T>(command: string, payload?: Record<string, unknown>) => Promise<T>;

const calls: InvokeCall[] = [];
let invokeImpl: InvokeImpl = async () => { throw new Error('no impl set'); };

(globalThis as unknown as { window: object }).window = {
  __TAURI__: {
    core: {
      invoke: <T>(command: string, payload?: Record<string, unknown>): Promise<T> => {
        calls.push({ command });
        return invokeImpl<T>(command, payload);
      },
    },
  },
};

const { locationService } = await import('../location.ts');

function reset(): void {
  calls.length = 0;
  locationService.invalidate();
}

test('getLocation() routes through Tauri IPC and caches the fix', async () => {
  reset();
  invokeImpl = (async () => [41.6, -86.7] as never) as InvokeImpl;

  const first = await locationService.getLocation();
  const second = await locationService.getLocation();

  assert.equal(first.lat, 41.6);
  assert.equal(first.lon, -86.7);
  assert.equal(first.source, 'native');
  assert.equal(second.lat, 41.6);
  assert.equal(
    calls.filter((c) => c.command === 'get_native_location').length,
    1,
    'cache hit must not reissue the IPC',
  );
});

test('concurrent getLocation() calls dedupe to one IPC', async () => {
  reset();
  let resolve: ((value: [number, number]) => void) | null = null;
  invokeImpl = (() => new Promise<[number, number]>((res) => { resolve = res; })) as InvokeImpl;

  const p1 = locationService.getLocation();
  const p2 = locationService.getLocation();
  const p3 = locationService.getLocation();

  assert.ok(resolve, 'IPC should have kicked off');
  resolve!([40.0, -74.0]);

  const results = await Promise.all([p1, p2, p3]);
  for (const r of results) {
    assert.equal(r.lat, 40.0);
    assert.equal(r.lon, -74.0);
  }
  assert.equal(
    calls.filter((c) => c.command === 'get_native_location').length,
    1,
    'three parallel callers must share one in-flight Promise',
  );
});

test('failed lookup does not poison the cache', async () => {
  reset();
  let attempt = 0;
  invokeImpl = (async () => {
    attempt += 1;
    if (attempt === 1) throw new Error('Location not available');
    return [37.5, -122.3] as never;
  }) as InvokeImpl;

  await assert.rejects(() => locationService.getLocation(), /Location not available/);
  const fix = await locationService.getLocation();

  assert.equal(fix.lat, 37.5);
  assert.equal(attempt, 2);
});

test('force: true bypasses the cache', async () => {
  reset();
  let counter = 0;
  invokeImpl = (async () => {
    counter += 1;
    return [counter, counter] as never;
  }) as InvokeImpl;

  const a = await locationService.getLocation();
  const b = await locationService.getLocation({ force: true });

  assert.equal(a.lat, 1);
  assert.equal(b.lat, 2, 'force=true must reissue the IPC');
});

test('maxAgeMs: 0 always treats the cache as stale', async () => {
  reset();
  let counter = 0;
  invokeImpl = (async () => {
    counter += 1;
    return [counter, counter] as never;
  }) as InvokeImpl;

  await locationService.getLocation();
  await locationService.getLocation({ maxAgeMs: 0 });

  assert.equal(counter, 2);
});

test('getCached() reflects the most recent fix without issuing IPC', async () => {
  reset();
  invokeImpl = (async () => [10, 20] as never) as InvokeImpl;

  assert.equal(locationService.getCached(), null);
  const fix = await locationService.getLocation();
  const cached = locationService.getCached();

  assert.ok(cached);
  assert.equal(cached.lat, fix.lat);
  assert.equal(cached.lon, fix.lon);
});

test('invalidate() drops the cached fix; next call refetches', async () => {
  reset();
  let counter = 0;
  invokeImpl = (async () => {
    counter += 1;
    return [counter, counter] as never;
  }) as InvokeImpl;

  await locationService.getLocation();
  locationService.invalidate();
  assert.equal(locationService.getCached(), null);

  await locationService.getLocation();
  assert.equal(counter, 2);
});
