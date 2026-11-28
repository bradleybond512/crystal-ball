import '../helpers/loopback-only.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { graphRequire, ownedRuntimeFixture, websocketExchange } from '../helpers/dependency-runtime-fixture.mjs';

test('scripts installed dependency graph', { timeout: 20_000 }, async (t) => {
  ownedRuntimeFixture(t);
  const require = graphRequire('scripts');
  await t.test('ws exchanges messages on an owned loopback server', { timeout: 5000 }, async (child) => {
    const reply = await websocketExchange(child, require('ws'), 'scripts-fixture-response');
    assert.equal(reply, 'scripts-fixture-response');
  });
  await t.test('Telegram serializes and reloads an offline synthetic session', async () => {
    const { StringSession } = require('telegram/sessions/index.js');
    const { AuthKey } = require('telegram/crypto/AuthKey.js');
    const session = new StringSession('');
    assert.equal(session.save(), '');
    session.setDC(2, '127.0.0.1', 443);
    const key = new AuthKey();
    const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    await key.setKey(bytes);
    session.authKey = key;
    const encoded = session.save();
    assert.ok(encoded.length > 256);
    const restored = new StringSession(encoded);
    await restored.load();
    assert.equal(restored.dcId, 2);
    assert.equal(restored.serverAddress, '127.0.0.1');
    assert.equal(restored.port, 443);
    assert.deepEqual(restored.authKey.getKey(), bytes);
    assert.equal(restored.save(), encoded);
    assert.throws(() => new StringSession('invalid-fixture'), /Not a valid string/);
  });
});
