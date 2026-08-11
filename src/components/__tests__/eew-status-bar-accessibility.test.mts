import assert from 'node:assert/strict';
import test from 'node:test';

import { Window } from 'happy-dom';

import type { EewAlert } from '../../services/seismic/eew-alert-engine.ts';
import type { SpaceWxStatus } from '../../services/spaceweather/swpc-monitor.ts';

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
    const dragRegion = happyWindow.document.querySelector<HTMLElement>('.eew-bar-drag-region');
    assert.ok(dragRegion, 'macOS titlebar should retain a noninteractive drag surface');
    assert.equal(dragRegion.getAttribute('aria-hidden'), 'true');

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

test('space weather and iMessage failures remain in the accessible status', () => {
  const bar = mountBar();

  try {
    const live = happyWindow.document.querySelector<HTMLElement>('.eew-bar-live');
    const button = happyWindow.document.querySelector<HTMLButtonElement>('.eew-bar-main');
    assert.ok(live);
    assert.ok(button);

    const spaceWeather: SpaceWxStatus = {
      xray: null,
      geomag: {
        kp: 8,
        level: 'G4',
        auroraVisibilityLatN: 50,
        observedAt: new Date(NOW).toISOString(),
        kpMax24h: 8,
      },
      gpsDisruption: 'high',
      hfRadioBlackout: true,
      earthwardCmes: [],
      asOf: new Date(NOW).toISOString(),
    };
    bar.setSpaceWeatherStatus(spaceWeather);

    assert.match(button.getAttribute('aria-label') ?? '', /GEOMAGNETIC G4/i);
    assert.match(live.textContent, /GEOMAGNETIC G4/i);

    const active = alert({
      tier: 'TIER_5_EXTREME',
      imessageStatus: 'failed',
      imessageError: 'Messages.app unavailable',
    });
    bar.applyPayload({
      activeAlerts: [active],
      highestTier: active.tier,
      lastEventId: active.eventId,
      asOf: NOW,
    });

    assert.match(button.getAttribute('aria-label') ?? '', /iMessage failed/i);
    assert.match(live.textContent, /iMessage failed/i);
    assert.match(live.textContent, /Messages\.app unavailable/i);
    assert.match(live.textContent, /GEOMAGNETIC G4/i);
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
