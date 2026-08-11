import assert from 'node:assert/strict';
import test from 'node:test';

import { Window } from 'happy-dom';

import type { EewAlert } from '../../services/seismic/eew-alert-engine.ts';

const happyWindow = new Window({ url: 'http://127.0.0.1/' });
const globals = globalThis as unknown as Record<string, unknown>;
globals.window = happyWindow;
globals.document = happyWindow.document;
globals.HTMLElement = happyWindow.HTMLElement;
globals.HTMLButtonElement = happyWindow.HTMLButtonElement;
globals.Element = happyWindow.Element;
globals.Node = happyWindow.Node;
globals.Event = happyWindow.Event;
globals.KeyboardEvent = happyWindow.KeyboardEvent;
globals.MouseEvent = happyWindow.MouseEvent;

const { EEWStatusBar } = await import('../EEWStatusBar.ts');

const NOW = 1_745_000_000_000;

function alert(overrides: Partial<EewAlert> = {}): EewAlert {
  return {
    eventId: overrides.eventId ?? 'event-1',
    tier: overrides.tier ?? 'TIER_4_SEVERE',
    reason: overrides.reason ?? 'Strong shaking expected',
    triggeredAt: overrides.triggeredAt ?? NOW,
    upgradedFrom: overrides.upgradedFrom,
    imessageStatus: overrides.imessageStatus,
    imessageError: overrides.imessageError,
  };
}

function mountBar(): EEWStatusBar {
  happyWindow.document.body.replaceChildren();
  const bar = new EEWStatusBar();
  bar.mount(happyWindow.document.body as unknown as HTMLElement);
  return bar;
}

test('weather status uses source-aware details and an accessible disclosure', () => {
  const bar = mountBar();

  try {
    bar.setCompositeStatusProvider(() => ({ weatherSeverity: 'severe' }));
    bar.applyPayload({ activeAlerts: [], highestTier: null, lastEventId: null, asOf: NOW });

    const button = happyWindow.document.querySelector<HTMLButtonElement>('.eew-bar-main');
    const details = happyWindow.document.querySelector<HTMLElement>('.eew-bar-expanded');
    assert.ok(button, 'status disclosure should be a real button');
    assert.ok(details, 'status details should render');
    assert.equal(button.tagName, 'BUTTON');
    assert.match(button.getAttribute('aria-label') ?? '', /Severe weather.*Show alert details/i);
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(button.getAttribute('aria-controls'), details.id);
    assert.equal(details.hidden, true);
    const chevron = button.querySelector<HTMLElement>('.eew-bar-chevron');
    assert.ok(chevron, 'status disclosure should show a familiar chevron');
    assert.equal(chevron.getAttribute('aria-hidden'), 'true');

    button.click();
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    assert.equal(details.hidden, false);
    assert.match(details.textContent, /Severe weather affects a saved place/i);
    assert.match(details.textContent, /No recent earthquake alerts/i);
    assert.doesNotMatch(details.textContent, /^No active alerts$/i);
  } finally {
    bar.destroy();
  }
});

test('Escape closes status details and returns focus to the disclosure', () => {
  const bar = mountBar();

  try {
    const active = alert();
    bar.applyPayload({
      activeAlerts: [active],
      highestTier: active.tier,
      lastEventId: active.eventId,
      asOf: NOW,
    });

    const button = happyWindow.document.querySelector<HTMLButtonElement>('.eew-bar-main');
    const details = happyWindow.document.querySelector<HTMLElement>('.eew-bar-expanded');
    assert.ok(button);
    assert.ok(details);

    button.click();
    assert.equal(details.hidden, false);
    happyWindow.document.body.dispatchEvent(new happyWindow.KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
    }));

    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(details.hidden, true);
    assert.equal(happyWindow.document.activeElement, button);
  } finally {
    bar.destroy();
  }
});
