import assert from 'node:assert/strict';
import test from 'node:test';
import { createSecretUpdateReceiver, parseRevision } from './secret-sync.mjs';

function fixture({ native = true, floor = '0' } = {}) {
  const env = new Map(); const effects = [];
  const receive = createSecretUpdateReceiver({ native, floor, allowedKeys: new Set(['A', 'B']),
    apply(key, value) { effects.push([key, value]); if (value == null || value === '') env.delete(key); else env.set(key, String(value)); } });
  return { env, effects, receive };
}
function deferred() {
  let release; const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
}

test('old timed-out body released after a new unset cannot restore a credential', { timeout: 2000 }, async () => {
  const { receive, env, effects } = fixture(); const body = deferred();
  const pending = (async () => receive(await body.promise))();
  try {
    assert.equal(receive({ key: 'A', value: null, revision: '2' }).status, 200);
    body.release({ key: 'A', value: 'old', revision: '1' });
    const delayed = await pending;
    assert.equal(delayed.status, 200);
    assert.equal(env.has('A'), false); assert.equal(effects.length, 1);
  } finally { body.release({ key: 'A', value: 'old', revision: '1' }); await pending; }
});

test('stale and duplicate revisions have zero effects; key ordering is independent', () => {
  const { receive, env, effects } = fixture();
  receive({ key: 'A', value: 'new', revision: '50' });
  receive({ key: 'B', value: 'other', revision: '1' });
  receive({ key: 'A', value: 'stale', revision: '49' });
  receive({ key: 'A', value: null, revision: '50' });
  assert.equal(env.get('A'), 'new'); assert.equal(env.get('B'), 'other'); assert.equal(effects.length, 2);
});

test('launch seed floor fences prelaunch bodies even for absent keys', () => {
  const { receive, env, effects } = fixture({ floor: '10' });
  for (const key of ['A', 'B']) {
    assert.equal(receive({ key, value: 'old', revision: '9' }).status, 200);
    assert.equal(receive({ key, value: 'old', revision: '10' }).status, 200);
  }
  assert.equal(env.size, 0); assert.equal(effects.length, 0);
  receive({ key: 'A', value: 'fresh', revision: '11' }); assert.equal(env.get('A'), 'fresh');
});

test('native missing, malformed, noncanonical and overflowing revisions have zero effects', () => {
  const { receive, effects } = fixture();
  for (const revision of [undefined, null, 1, '', '01', '-1', '+1', '1.0', '1e3', ' 1', '18446744073709551616', '999999999999999999999', {}, []]) {
    assert.equal(receive({ key: 'A', value: 'private', revision }).status, 400);
  }
  assert.equal(effects.length, 0);
  assert.equal(parseRevision('18446744073709551615'), 18_446_744_073_709_551_615n);
  assert.throws(() => fixture({ floor: 'bad' }), /revision floor/);
  assert.throws(() => createSecretUpdateReceiver({ native: true, allowedKeys: new Set(['A']), apply() {} }), /revision floor/);
});

test('web and development keep unrevisioned updates and existing value/unset semantics', () => {
  const { receive, env, effects } = fixture({ native: false });
  assert.equal(receive({ key: 'A', value: 'v' }).status, 200);
  assert.equal(env.get('A'), 'v'); receive({ key: 'A', value: null }); assert.equal(env.has('A'), false);
  assert.equal(receive({ key: 'outside', value: 'private' }).status, 403);
  assert.equal(receive(null).status, 400); assert.equal(effects.length, 2);
});


test('late boot and reload bodies cannot replace newer Settings rotation', { timeout: 2000 }, async () => {
  for (const producer of ['boot', 'reload', 'recovery']) {
    const { receive, env, effects } = fixture(); const body = deferred();
    const pending = (async () => receive(await body.promise))();
    try {
      receive({ key: 'A', value: 'rotated', revision: '3' });
      receive({ key: 'B', value: 'independent', revision: '1' });
      body.release({ key: 'A', value: 'snapshot', revision: '2' }); await pending;
      assert.equal(env.get('A'), 'rotated', producer);
      assert.equal(env.get('B'), 'independent', producer); assert.equal(effects.length, 2, producer);
    } finally { body.release({ key: 'A', value: 'snapshot', revision: '2' }); await pending; }
  }
});
