import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Window } from 'happy-dom';

const layoutSource = readFileSync(
  new URL('../../app/layout/html.ts', import.meta.url),
  'utf8',
);
const replaySource = readFileSync(
  new URL('../AlertReplayScrubber.ts', import.meta.url),
  'utf8',
);
const summarySource = readFileSync(
  new URL('../SummaryStrip.ts', import.meta.url),
  'utf8',
);
const cssSource = readFileSync(
  new URL('../../styles/main.css', import.meta.url),
  'utf8',
);

test('shared shell controls have stable accessible names', () => {
  const regionSelects = layoutSource.match(/<select id="regionSelect"[^>]+aria-label="Region"/g) ?? [];
  assert.equal(regionSelects.length, 2);
  assert.match(replaySource, /this\.slider\.setAttribute\('aria-label', 'Replay time'\)/);
  assert.match(replaySource, /close\.setAttribute\('aria-label', 'Close alert replay'\)/);
  assert.match(summarySource, /data-seg="alerts"[^>]+aria-description=/);
  assert.match(summarySource, /data-seg="fresh"[^>]+aria-description=/);
  assert.doesNotMatch(summarySource, /data-seg="alerts"[^>]+aria-label=/);
  assert.doesNotMatch(summarySource, /data-seg="fresh"[^>]+aria-label=/);
});

test('compact ACTIVE badge uses a WCAG-AA foreground color', () => {
  assert.match(cssSource, /\.cbs-badge-active\s*\{[^}]*color:\s*#ff8f8f/s);
  assert.match(cssSource, /\.cbs-removed\s*\{[^}]*opacity:\s*0\.6/s);
  assert.match(cssSource, /\.cbs-scenario-removed\s*\{[^}]*opacity:\s*0\.6/s);
});

test('analytics consent dialog takes focus and traps Tab within its choices', async () => {
  const happyWindow = new Window({ url: 'https://crystalball.app/' });
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.window = happyWindow;
  globals.document = happyWindow.document;
  globals.localStorage = happyWindow.localStorage;
  globals.HTMLElement = happyWindow.HTMLElement;
  globals.HTMLButtonElement = happyWindow.HTMLButtonElement;
  globals.Event = happyWindow.Event;
  globals.CustomEvent = happyWindow.CustomEvent;
  globals.KeyboardEvent = happyWindow.KeyboardEvent;

  const { mountAnalyticsConsentBanner } = await import('../AnalyticsConsentBanner.ts');
  mountAnalyticsConsentBanner();

  const dialog = happyWindow.document.getElementById('analytics-consent-banner');
  const buttons = [...dialog!.querySelectorAll('button')];
  assert.equal(dialog?.getAttribute('aria-modal'), 'true');
  assert.equal(happyWindow.document.activeElement, buttons[0]);

  buttons[1]!.focus();
  dialog!.dispatchEvent(new happyWindow.KeyboardEvent('keydown', {
    key: 'Tab',
    bubbles: true,
  }));
  assert.equal(happyWindow.document.activeElement, buttons[0]);
});
