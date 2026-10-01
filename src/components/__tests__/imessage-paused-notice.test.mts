// R4-BUG-001: the paused-iMessage notice is visible outside Settings and can
// never enable sending by itself.
import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

const browser = new Window({ url: 'http://127.0.0.1/' });
Object.assign(globalThis, {
  window: browser, document: browser.document, localStorage: browser.localStorage,
  HTMLElement: browser.HTMLElement, CustomEvent: browser.CustomEvent,
});
after(() => browser.happyDOM.abort());

const { IMESSAGE_PAUSE_EVENT } = await import('../../services/imessage-bridge.ts');
const { mountImessagePausedNotice, resetImessagePausedNoticeSession } = await import('../ImessagePausedNotice.ts');

type PauseState = { paused: false } | { paused: true; hint: string; since: number; notified: boolean };
let state: PauseState;
const calls: string[] = [];
let keepOffResult: Record<string, unknown> = { ok: true };
const deps = {
  pauseState: () => state,
  keepOff: async () => { calls.push('keep-off'); return keepOffResult as never; },
  review: () => { calls.push('review'); },
};
const notice = (host: Element) => host.querySelector<HTMLElement>('.cb-imessage-paused')!;
const button = (host: Element, action: string) => host.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
function host(): HTMLElement {
  const el = document.createElement('div');
  el.append(document.createElement('p'));
  document.body.append(el);
  return el;
}

beforeEach(() => {
  state = { paused: true, hint: '…9999', since: 1, notified: false };
  calls.length = 0;
  keepOffResult = { ok: true };
  resetImessagePausedNoticeSession();
  document.body.replaceChildren();
});

test('hidden when iMessage is not paused', () => {
  state = { paused: false };
  const h = host(); mountImessagePausedNotice(h, deps);
  assert.equal(notice(h).hidden, true);
});

test('shown first in its host with the redacted hint and three actions', () => {
  const h = host(); mountImessagePausedNotice(h, deps);
  assert.ok(h.firstElementChild === notice(h), 'the notice is the first child');
  assert.equal(notice(h).hidden, false);
  assert.equal(notice(h).getAttribute('role'), 'status');
  assert.match(notice(h).textContent ?? '', /iMessage alerts are paused\. Confirm the recipient \(…9999\) to resume\./);
  assert.deepEqual([...h.querySelectorAll('button')].map(b => b.textContent), ['Review', 'Keep off', 'Not now']);
});

test('the hint is rendered as text, never markup', () => {
  state = { paused: true, hint: '<b>…9999</b>', since: 1, notified: false };
  const h = host(); mountImessagePausedNotice(h, deps);
  assert.ok(h.querySelector('b') === null, 'no element was parsed from the hint');
  assert.match(notice(h).textContent ?? '', /<b>…9999<\/b>/);
});

test('Review asks Settings for the iMessage section and changes nothing itself', () => {
  const h = host(); mountImessagePausedNotice(h, deps);
  button(h, 'review').click();
  assert.deepEqual(calls, ['review']);
  assert.equal(notice(h).hidden, false);
});

test('the default Review opens Settings → General → iMessage', () => {
  const seen: unknown[] = [];
  document.addEventListener('wm:open-settings', (event) => { seen.push((event as CustomEvent).detail); }, { once: true });
  const real = host(); const unmount = mountImessagePausedNotice(real);
  button(real, 'review').click();
  assert.deepEqual(seen, [{ focus: 'imessage' }]);
  unmount();
});

test('Keep off records an explicit off and disables the buttons while pending', async () => {
  const h = host(); mountImessagePausedNotice(h, deps);
  button(h, 'keep-off').click();
  assert.equal(button(h, 'review').disabled, true);
  button(h, 'keep-off').click();
  await flush();
  assert.deepEqual(calls, ['keep-off'], 'one request only');
  state = { paused: false };
  document.dispatchEvent(new CustomEvent(IMESSAGE_PAUSE_EVENT));
  assert.equal(notice(h).hidden, true);
  assert.equal(button(h, 'review').disabled, false);
});

test('a failed Keep off shows the reason and keeps the notice', async () => {
  keepOffResult = { ok: false, code: 'persistence_failed', reason: 'Settings could not be saved.' };
  const h = host(); mountImessagePausedNotice(h, deps);
  button(h, 'keep-off').click();
  await flush();
  assert.equal(notice(h).hidden, false);
  assert.equal(notice(h).querySelector('.cb-imessage-paused-text')?.textContent, 'Settings could not be saved.');
});

test('Not now hides every copy for this session only', () => {
  const a = host(); const b = host();
  mountImessagePausedNotice(a, deps); mountImessagePausedNotice(b, deps);
  button(a, 'later').click();
  assert.equal(notice(a).hidden, true);
  assert.equal(notice(b).hidden, true);
  resetImessagePausedNoticeSession();
  const next = host(); mountImessagePausedNotice(next, deps);
  assert.equal(notice(next).hidden, false, 'a new session shows it again');
});

test('unmount removes the notice and stops listening', () => {
  let reads = 0;
  const h = host(); const unmount = mountImessagePausedNotice(h, { ...deps, pauseState: () => { reads += 1; return state; } });
  unmount();
  assert.ok(h.querySelector('.cb-imessage-paused') === null, 'removed');
  const before = reads;
  document.dispatchEvent(new CustomEvent(IMESSAGE_PAUSE_EVENT));
  assert.equal(reads, before);
});

test('wired into the Home Shell, the classic stack and the Settings deep link', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.match(read('../HomeShellOverlay.ts'), /this\.unmountImessageNotice = mountImessagePausedNotice\(viewport\);/);
  assert.match(read('../HomeShellOverlay.ts'), /destroy\(\): void \{\n\s+this\.hide\(\);\n\s+this\.unmountImessageNotice\?\.\(\);/);
  assert.match(read('../../main.ts'), /mountImessagePausedNotice\(notificationStack\.element\);/);
  assert.match(read('../../app/panel-layout.ts'), /detail\?\.focus === 'imessage'\) this\.ctx\.unifiedSettings\?\.open\('general', 'imessage'\);/);
});
