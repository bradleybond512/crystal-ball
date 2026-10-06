// R4-BUG-001 review (Sol, 2b58defee): the paused notice mounted against the
// real iMessage bridge. Native IPC and storage are fakes; the bridge, its
// stored pause marker and the mounted notice are real.
import assert from 'node:assert/strict';
import test, { after, afterEach, beforeEach } from 'node:test';
import { Window } from 'happy-dom';

type Invoke = (command: string) => Promise<unknown>;
const browser = new Window({ url: 'http://127.0.0.1/' });
const native: string[] = [];
let invoke: Invoke = async () => { throw new Error('native unavailable'); };
Object.assign(browser, {
  __TAURI_INTERNALS__: { invoke: (command: string) => { native.push(command); return invoke(command); } },
});
Object.assign(globalThis, {
  window: browser, document: browser.document, localStorage: browser.localStorage,
  HTMLElement: browser.HTMLElement, CustomEvent: browser.CustomEvent,
});
after(() => browser.happyDOM.abort());

const bridge = await import('../../services/imessage-bridge.ts');
const { mountImessagePausedNotice, resetImessagePausedNoticeSession } = await import('../ImessagePausedNotice.ts');

const KEY = 'crystalball-imessage-settings';
const READY_OFF = { enabled: false, recipient: null, ready: true, migrationAvailable: false };
const READY_ON = { enabled: true, recipient: '+15551234567', ready: true, migrationAvailable: false };
// Already notified: the one-time macOS notice will not fire again, so the
// in-app notice is the only place this pause can surface on this launch.
const MARKER = { hint: '…4567', since: 1_700_000_000_000, notifiedAt: 1_700_000_100_000 };
const PERSISTENCE_FAILED = 'Settings could not be saved. Sending is blocked for this session; previous settings may return after restart.';

const unmounts: Array<() => void> = [];
const mount = (host: HTMLElement): void => { unmounts.push(mountImessagePausedNotice(host)); };
const notice = (host: Element) => host.querySelector<HTMLElement>('.cb-imessage-paused')!;
const text = (host: Element) => notice(host).querySelector('.cb-imessage-paused-text')?.textContent ?? '';
const button = (host: Element, action: string) => host.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
const storedMarker = () => (JSON.parse(localStorage.getItem(KEY) ?? '{}') as { paused?: unknown }).paused;
const storeMarker = (paused: unknown): void => { localStorage.setItem(KEY, JSON.stringify({ threshold: 'critical', paused })); };
/** Fake native calls settle in microtasks; a few macrotask turns drain them. */
const settle = async (): Promise<void> => { for (let i = 0; i < 3; i += 1) await new Promise((r) => setTimeout(r, 0)); };
function host(): HTMLElement {
  const el = document.createElement('div');
  el.append(document.createElement('p'));
  document.body.append(el);
  return el;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(async () => {
  invoke = async () => { throw new Error('native unavailable'); };
  await bridge.refreshImessageSettings(); // native state is unknown again
  localStorage.clear();
  native.length = 0;
  resetImessagePausedNoticeSession();
});

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
  document.body.replaceChildren();
});

test('a stored pause mounted before hydration becomes visible once native state is known', async () => {
  storeMarker(MARKER);
  const hydration = deferred<unknown>();
  invoke = async (command) => {
    if (command === 'get_imessage_settings') return hydration.promise;
    throw new Error(`unexpected ${command}`);
  };
  const h = host();
  mount(h);
  assert.equal(notice(h).hidden, true, 'native state is not known yet');

  const refreshed = bridge.refreshImessageSettings();
  hydration.resolve(READY_OFF);
  assert.deepEqual(await refreshed, { ok: true });

  assert.equal(bridge.getImessagePauseState().paused, true, 'the real getter reports the pause');
  assert.equal(notice(h).hidden, false, 'the already-mounted notice shows it');
  assert.equal(text(h), 'iMessage alerts are paused. Confirm the recipient (…4567) to resume.');
  assert.deepEqual(storedMarker(), MARKER, 'hydration leaves the stored marker unchanged');
});

test('a failed Keep off stays visible with its reason while the pause marker is retained', async () => {
  storeMarker(MARKER);
  invoke = async (command) => {
    if (command === 'get_imessage_settings') return READY_OFF;
    if (command === 'disable_imessage') throw { code: 'persistence_failed' };
    throw new Error(`unexpected ${command}`);
  };
  await bridge.refreshImessageSettings();
  const h = host();
  mount(h);
  assert.equal(notice(h).hidden, false);

  button(h, 'keep-off').click();
  await settle();

  assert.deepEqual(native.filter((c) => c === 'disable_imessage'), ['disable_imessage']);
  assert.equal(notice(h).hidden, false, 'the failed decision stays visible');
  assert.equal(text(h), PERSISTENCE_FAILED);
  assert.equal(button(h, 'keep-off').disabled, false, 'Keep off can be retried');
  assert.deepEqual(storedMarker(), MARKER, 'a failed decision keeps the pause marker');
  assert.equal(bridge.getImessageSettings().enabled, false, 'sending stays fail-closed');
  assert.equal((await bridge.sendImessage('test')).ok, false);
  assert.equal(native.includes('send_imessage'), false);
});

test('a Keep off that succeeds after a failure clears the marker and hides every copy', async () => {
  storeMarker(MARKER);
  let disableFails = true;
  invoke = async (command) => {
    if (command === 'get_imessage_settings') return READY_OFF;
    if (command === 'disable_imessage') {
      if (disableFails) throw { code: 'persistence_failed' };
      return READY_OFF;
    }
    throw new Error(`unexpected ${command}`);
  };
  await bridge.refreshImessageSettings();
  const home = host();
  const classic = host();
  mount(home);
  mount(classic);

  button(home, 'keep-off').click();
  await settle();
  assert.equal(text(home), PERSISTENCE_FAILED);

  disableFails = false;
  button(home, 'keep-off').click();
  await settle();

  assert.equal(storedMarker(), undefined, 'an explicit successful off ends the pause');
  assert.deepEqual(bridge.getImessagePauseState(), { paused: false });
  assert.equal(notice(home).hidden, true);
  assert.equal(notice(classic).hidden, true, 'the other mounted copy hears the change');
});

test('a failure is dropped once its pause has ended, so a later pause shows its own hint', async () => {
  storeMarker(MARKER);
  let settings: unknown = READY_OFF;
  invoke = async (command) => {
    if (command === 'get_imessage_settings') return settings;
    if (command === 'disable_imessage') throw { code: 'persistence_failed' };
    throw new Error(`unexpected ${command}`);
  };
  await bridge.refreshImessageSettings();
  const h = host();
  mount(h);
  button(h, 'keep-off').click();
  await settle();
  assert.equal(text(h), PERSISTENCE_FAILED);

  settings = READY_ON; // confirmed elsewhere: native sending is on
  await bridge.refreshImessageSettings();
  assert.equal(storedMarker(), undefined);
  assert.equal(notice(h).hidden, true);

  storeMarker({ hint: '…0000', since: 1_700_000_200_000 });
  settings = READY_OFF;
  await bridge.refreshImessageSettings();
  assert.equal(notice(h).hidden, false);
  assert.equal(text(h), 'iMessage alerts are paused. Confirm the recipient (…0000) to resume.');
});
