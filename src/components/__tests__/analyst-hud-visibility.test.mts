/**
 * AnalystHUD visibility regression tests (happy-dom).
 *
 * Covers the "ghost HUD" bug: the HUD auto-opened and Esc/X appeared dead
 * because a blocked cloud-LLM call kept re-dispatching the egress-disclosure
 * event, which force-opened the HUD right after the user closed it. Fixes:
 *   - onEgressDisclosure never force-opens a closed HUD.
 *   - remember-last-state auto-open goes through show() (Esc/X armed).
 *   - the replay-scrubber "now ago" label bug.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { Window } from 'happy-dom';

const happyWindow = new Window({ url: 'http://127.0.0.1/' });
const G = globalThis as unknown as Record<string, unknown>;
G.window = happyWindow;
G.document = happyWindow.document;
G.HTMLElement = happyWindow.HTMLElement;
G.HTMLInputElement = happyWindow.HTMLInputElement;
G.HTMLButtonElement = happyWindow.HTMLButtonElement;
G.HTMLSpanElement = happyWindow.HTMLSpanElement;
G.Element = happyWindow.Element;
G.Node = happyWindow.Node;
G.Event = happyWindow.Event;
G.CustomEvent = happyWindow.CustomEvent;
G.KeyboardEvent = happyWindow.KeyboardEvent;
G.localStorage = happyWindow.localStorage;
// Synchronous rAF so scheduleRender()/render() runs inline in the test.
G.requestAnimationFrame = (cb: (t: number) => void): number => { cb(0); return 0; };
G.cancelAnimationFrame = (): void => { /* noop */ };

const OPEN_KEY = 'cb:analyst-hud-open';

const { AnalystHUD, formatScrubberLabel } = await import('../AnalystHUD.ts');

function rootOf(hud: unknown): HTMLElement {
  return (hud as { root: HTMLElement }).root;
}

test('formatScrubberLabel: live snapshot shows "now", not "now ago"', () => {
  assert.equal(formatScrubberLabel(0, 120, 120), 'now · 120/120');
  assert.equal(formatScrubberLabel(null, 1, 1), 'now · 1/1');
  assert.equal(formatScrubberLabel(10_000, 120, 120), 'now · 120/120'); // <30s rounds to "now"
  assert.equal(formatScrubberLabel(5 * 60_000, 60, 120).includes(' ago'), true);
});

test('remember-last-state auto-open, then Esc closes it (Esc is armed)', () => {
  localStorage.setItem(OPEN_KEY, '1');
  const hud = new AnalystHUD();
  hud.mount(happyWindow.document.body as unknown as HTMLElement);

  // Restore path opened it via show() → visible + shown.
  assert.equal(rootOf(hud).hidden, false, 'HUD should auto-open when last state was open');

  // Esc must close it — the ghost bug was Esc being dead on auto-open.
  happyWindow.document.dispatchEvent(new happyWindow.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(rootOf(hud).hidden, true, 'Esc should close the auto-opened HUD');

  hud.destroy();
});

test('egress disclosure does NOT re-open a HUD the user closed', () => {
  localStorage.setItem(OPEN_KEY, '0');
  const hud = new AnalystHUD();
  hud.mount(happyWindow.document.body as unknown as HTMLElement);
  assert.equal(rootOf(hud).hidden, true, 'HUD starts closed when last state was closed');

  // The blocked-cloud-call event must not force it open (the dead-Esc root cause).
  happyWindow.document.dispatchEvent(new happyWindow.CustomEvent('cb:llm-egress-disclosure-needed'));
  assert.equal(rootOf(hud).hidden, true, 'egress disclosure must not force-open a closed HUD');

  hud.destroy();
});

test('closed HUD stays closed by default (no surprise auto-open)', () => {
  localStorage.removeItem(OPEN_KEY);
  const hud = new AnalystHUD();
  hud.mount(happyWindow.document.body as unknown as HTMLElement);
  assert.equal(rootOf(hud).hidden, true, 'HUD defaults closed when no remembered state');
  hud.destroy();
});
