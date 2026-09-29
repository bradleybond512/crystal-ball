import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { notifyNative, type NativeNotifyDeps } from '../native-notify.ts';

function deps(result: unknown, calls: Array<[string, Record<string, unknown> | undefined]> = []): NativeNotifyDeps {
  return {
    hasBridge: () => true,
    invoke: async <T,>(command: string, payload?: Record<string, unknown>): Promise<T> => {
      calls.push([command, payload]);
      if (result instanceof Error) throw result;
      return result as T;
    },
  };
}

describe('notifyNative', () => {
  it('reports delivered only when the native layer says delivered', async () => {
    assert.equal(await notifyNative({ title: 't', body: 'b' }, deps('delivered')), 'delivered');
  });

  it('reports rate_limited instead of pretending delivery', async () => {
    assert.equal(await notifyNative({ title: 't', body: 'b', priority: 'normal' }, deps('rate_limited')), 'rate_limited');
  });

  it('maps unsupported to unavailable and a missing bridge to unavailable', async () => {
    assert.equal(await notifyNative({ title: 't', body: 'b' }, deps('unsupported')), 'unavailable');
    const noBridge: NativeNotifyDeps = { hasBridge: () => false, invoke: async () => { throw new Error('unreachable'); } };
    assert.equal(await notifyNative({ title: 't', body: 'b' }, noBridge), 'unavailable');
  });

  it('never treats an unexpected result or a thrown invoke as delivery', async () => {
    assert.equal(await notifyNative({ title: 't', body: 'b' }, deps(null)), 'failed');
    assert.equal(await notifyNative({ title: 't', body: 'b' }, deps(undefined)), 'failed');
    assert.equal(await notifyNative({ title: 't', body: 'b' }, deps(new Error('spawn failed'))), 'failed');
  });

  it('forwards the priority and defaults to normal', async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    await notifyNative({ title: 't', body: 'b', sound: 'Basso', priority: 'critical' }, deps('delivered', calls));
    await notifyNative({ title: 't', body: 'b' }, deps('delivered', calls));
    assert.equal(calls[0]?.[0], 'send_notification');
    assert.deepEqual(calls[0]?.[1], { title: 't', body: 'b', sound: 'Basso', priority: 'critical' });
    assert.equal(calls[1]?.[1]?.priority, 'normal');
  });
});
