import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const key = 'wm-app-mode';
let context = 0;

async function fresh(saved: string | null = null, canRead = true) {
  const values = new Map<string, string>();
  if (saved !== null) values.set(key, saved);
  let writes = 0;
  const control = { canRead, canWrite: true, dropWrite: false };
  const storage = {
    getItem(k: string) {
      if (!control.canRead) throw new Error('read denied');
      return values.get(k) ?? null;
    },
    setItem(k: string, value: string) {
      writes++;
      if (!control.canWrite) throw new Error('write denied');
      if (!control.dropWrite) values.set(k, value);
    },
    removeItem(k: string) {
      writes++;
      if (!control.canWrite) throw new Error('remove denied');
      if (!control.dropWrite) values.delete(k);
    },
  };
  const win = new EventTarget();
  Object.assign(globalThis, { localStorage: storage, window: win, document: new EventTarget() });
  const mode = await import(`../mode-manager.ts?context=${++context}`) as typeof import('../mode-manager.ts');
  function remote(k: string | null, value: string | null, area: unknown = storage) {
    if (area === storage) {
      if (k === null) values.clear();
      else if (value === null) values.delete(k);
      else values.set(k, value);
    }
    win.dispatchEvent(Object.assign(new Event('storage'), { key: k, newValue: value, storageArea: area }));
  }
  return { mode, remote, control, storage, writes: () => writes };
}

test('all legacy mode readers synchronously see a saved Ghost preference before boot', async () => {
  const { mode, writes } = await fresh('ghost');
  assert.equal(mode.getMode(), 'ghost');
  assert.equal(mode.isGhostMode(), true);
  assert.equal(mode.getGhostRefreshMultiplier(), 5);
  assert.equal(mode.initMode(), 'ghost');
  assert.equal(mode.getGhostModeState().preference, 'saved');
  assert.equal(writes(), 0);
});

test('restored modes are allowlisted; reading invalid storage never rewrites it', async () => {
  const { mode, writes } = await fresh('GHOST');
  assert.equal(mode.initMode(), null);
  assert.equal(mode.getGhostModeState().preference, 'saved');
  assert.equal(mode.isGodsVisionMode(), false);
  assert.equal(writes(), 0);
  assert.equal((await fresh('gods-vision')).mode.isGodsVisionMode(), true);
});

test('read failure holds the covered policy as unknown until the operator selects a mode', async () => {
  const { mode, control, writes } = await fresh('ghost', false);
  assert.equal(mode.getGhostModeState().preference, 'unknown');
  mode.recordGhostSuppression(true);
  assert.equal(mode.getGhostModeState().muted, 0);
  assert.equal(writes(), 0);
  control.canWrite = false;
  mode.setMode(null);
  assert.equal(mode.getGhostModeState().preference, 'window-only');
  assert.equal(mode.isGhostMode(), false);
  control.canRead = true; control.canWrite = true;
  mode.setMode(null);
  assert.equal(mode.getGhostModeState().preference, 'saved');
  assert.equal(mode.getMode(), null);
});

test('a silently rejected persistence write keeps the manual choice, counts and feedback in this window', async () => {
  const { mode, control, storage } = await fresh('gods-vision');
  control.dropWrite = true;
  mode.toggleGhostMode();
  assert.equal(mode.getMode(), 'ghost');
  assert.equal(storage.getItem(key), 'gods-vision');
  assert.equal(mode.getGhostModeState().preference, 'window-only');
  mode.recordGhostSuppression(true);
  control.dropWrite = false;
  mode.setMode('ghost');
  assert.equal(storage.getItem(key), 'ghost');
  assert.equal(mode.getGhostModeState().muted, 1);
  mode.toggleGhostMode();
  assert.equal(mode.getMode(), 'gods-vision');
});

test('counter is session-local, updates subscribers once and does not serialize metadata', async () => {
  const { mode, writes } = await fresh();
  const original = mode.getGhostModeState().generation;
  mode.setMode('ghost');
  const entered = mode.getGhostModeState().generation;
  assert.ok(entered > original);
  let changes = 0;
  const unsubscribe = mode.subscribeGhostMode(() => { changes++; });
  mode.recordGhostSuppression(true);
  mode.recordGhostSuppression(false);
  assert.equal(changes, 2);
  assert.deepEqual(mode.getGhostModeState(), { mode: 'ghost', preference: 'saved', generation: entered, muted: 2, critical: 1 });
  assert.equal(writes(), 1);
  unsubscribe();
  mode.setMode(null);
  mode.recordGhostSuppression(true);
  assert.equal(changes, 2);
  assert.equal(mode.getGhostModeState().muted, 0);
  assert.equal(mode.getGhostModeState().critical, 0);
  assert.notEqual(mode.getGhostModeState().generation, original);
  assert.equal((await fresh('ghost')).mode.getGhostModeState().muted, 0);
});

test('storage sync handles mode changes, removal and clear, and ignores unrelated keys and storage areas', async () => {
  const { mode, remote, writes } = await fresh('gods-vision');
  mode.initMode(); mode.initMode();
  let updates = 0;
  mode.subscribeGhostMode(() => { updates++; });
  remote(key, 'ghost', {});
  remote('other', 'ghost');
  assert.equal(mode.getMode(), 'gods-vision');
  remote(key, 'ghost');
  mode.recordGhostSuppression(false);
  remote(key, 'ghost');
  assert.equal(updates, 2);
  assert.equal(mode.getGhostModeState().muted, 1);
  remote(key, null);
  assert.equal(mode.getGhostModeState().muted, 0);
  assert.equal(mode.getMode(), null);
  remote(key, 'ghost');
  remote(null, null);
  assert.equal(mode.getMode(), null);
  assert.equal(writes(), 0);
});

test('an older queued storage event cannot undo a newer manual choice or count a previous session', async () => {
  const { mode, storage } = await fresh();
  mode.setMode('ghost');
  mode.recordGhostSuppression(true);
  window.dispatchEvent(Object.assign(new Event('storage'), { key, newValue: null, storageArea: storage }));
  assert.equal(mode.getMode(), 'ghost');
  assert.equal(mode.getGhostModeState().muted, 1);
});

test('muted and critical counts saturate independently and stop notifying at the cap', async () => {
  const { mode } = await fresh('ghost');
  for (let i = 0; i <= 10_000; i++) mode.recordGhostSuppression(false);
  assert.equal(mode.getGhostModeState().muted, 9999);
  assert.equal(mode.getGhostModeState().critical, 0);
  for (let i = 0; i <= 10_000; i++) mode.recordGhostSuppression(true);
  let updates = 0;
  mode.subscribeGhostMode(() => { updates++; });
  mode.recordGhostSuppression(true);
  assert.equal(updates, 0);
  assert.equal(mode.getGhostModeState().critical, 9999);
});

test('unrelated storage events and delayed evidence of the last saved choice leave window-only Ghost intact', async () => {
  const { mode, control, storage } = await fresh('gods-vision');
  control.canWrite = false;
  mode.setMode('ghost');
  const ignored = [
    { key: 'unrelated', newValue: null, storageArea: storage },
    { key, newValue: 'gods-vision', storageArea: {} },
    { key, oldValue: null, newValue: 'gods-vision', storageArea: storage },
  ];
  for (const event of ignored) {
    window.dispatchEvent(Object.assign(new Event('storage'), event));
    assert.equal(mode.getMode(), 'ghost');
    assert.equal(mode.getGhostModeState().preference, 'window-only');
  }
});

test('a newly saved choice in another window supersedes a window-only choice', async () => {
  const { mode, control, remote } = await fresh('gods-vision');
  control.canWrite = false;
  mode.setMode('ghost');
  remote(key, null);
  assert.equal(mode.getMode(), null);
  assert.equal(mode.getGhostModeState().preference, 'saved');
});

test('a queued Ghost entry invalidates a pending send even when storage already contains the later exit', async () => {
  const { mode, storage } = await fresh();
  const before = mode.getGhostModeState().generation;
  window.dispatchEvent(Object.assign(new Event('storage'), { key, newValue: 'ghost', storageArea: storage }));
  assert.equal(mode.getMode(), null);
  assert.notEqual(mode.getGhostModeState().generation, before);
  assert.equal(mode.getGhostModeState().muted, 0);
});

test('delivery sees another window’s saved choice before its queued storage event, once per transition', async () => {
  const { mode, storage } = await fresh();
  const initial = mode.getMode();
  const before = mode.getGhostModeState().generation;
  assert.equal(initial, null);
  storage.setItem(key, 'ghost');
  const decision = mode.getNotificationModeState();
  assert.equal(decision.mode, 'ghost');
  assert.ok(decision.generation > before);
  mode.recordGhostSuppression(true);
  window.dispatchEvent(Object.assign(new Event('storage'), { key, newValue: 'ghost', storageArea: storage }));
  assert.equal(mode.getNotificationModeState().generation, decision.generation);
  assert.equal(mode.getGhostModeState().critical, 1);
});

test('delivery holds on read failure, preserves last-known privacy and waits for an explicit choice', async () => {
  const { mode, control } = await fresh('ghost');
  mode.initMode();
  control.canRead = false;
  assert.equal(mode.getNotificationModeState().preference, 'unknown');
  assert.equal(mode.isGhostMode(), true);
  mode.recordGhostSuppression(true);
  assert.equal(mode.getGhostModeState().muted, 0);
  control.canRead = true;
  assert.equal(mode.getNotificationModeState().preference, 'unknown');
  mode.setMode('ghost');
  assert.equal(mode.getNotificationModeState().preference, 'saved');
});

test('delivery rechecks retain an unsaved local selection and unrelated events never consult storage', async () => {
  const { mode, control, storage } = await fresh();
  mode.initMode();
  control.canRead = false;
  for (const event of [
    { key: 'unrelated', storageArea: storage }, { key, storageArea: {} },
  ]) {
    window.dispatchEvent(Object.assign(new Event('storage'), event));
    assert.equal(mode.getGhostModeState().preference, 'saved');
  }
  control.canRead = true;
  control.dropWrite = true;
  mode.setMode('ghost');
  assert.equal(mode.getNotificationModeState().mode, 'ghost');
  assert.equal(mode.getNotificationModeState().preference, 'window-only');
});

test('an unknown preference stays held across clear and stale mode events until a genuine choice', async () => {
  const { mode, control, storage, remote } = await fresh('ghost');
  mode.initMode();
  control.canRead = false;
  assert.equal(mode.getNotificationModeState().preference, 'unknown');
  control.canRead = true;
  for (const event of [
    { key, oldValue: null, newValue: 'ghost' },
    { key: null, oldValue: null, newValue: null },
    { key, oldValue: 'ghost', newValue: null },
  ]) {
    window.dispatchEvent(Object.assign(new Event('storage'), { ...event, storageArea: storage }));
    assert.equal(mode.getNotificationModeState().preference, 'unknown');
  }
  remote(key, 'gods-vision');
  assert.equal(mode.getNotificationModeState().mode, 'gods-vision');
  assert.equal(mode.getNotificationModeState().preference, 'saved');
});

test('the product page loads the isolated mode bootstrap before the full application graph', () => {
  const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
  assert.match(html, /<script type="module" src="\/src\/entry\.ts"><\/script>/);
  assert.doesNotMatch(html, /<script[^>]+src="\/src\/main\.ts"/);
  const mode = readFileSync(new URL('../mode-manager.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(mode, /^import (?!type )/m, 'storage-safe bootstrap cannot load other service graphs');
});

test('an unreadable initial preference with no reliable baseline holds until a local choice', async () => {
  const { mode, control, remote } = await fresh(null, false);
  assert.equal(mode.getNotificationModeState().preference, 'unknown');
  control.canRead = true;
  remote(key, 'ghost');
  assert.equal(mode.getNotificationModeState().preference, 'unknown');
  mode.setMode(null);
  assert.equal(mode.getNotificationModeState().preference, 'saved');
  assert.equal(mode.getMode(), null);
});
