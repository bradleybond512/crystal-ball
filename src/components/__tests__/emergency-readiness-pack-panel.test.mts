import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import '../../../tests/panels/register-hook.mjs';
import { happyWindow } from '../../../tests/panels/setup-dom.mts';
import type { SavedPlace } from '../../services/saved-places.ts';

const NOW = Date.parse('2026-08-25T16:00:00.000Z');
const moduleValue = await import('../EmergencyReadinessPanel.ts').catch(() => ({})) as {
  EmergencyReadinessPanel?: new (dependencies: Record<string, unknown>) => {
    getContentElement: () => HTMLElement;
    destroy: () => void;
  };
};

function PanelClass(): NonNullable<typeof moduleValue.EmergencyReadinessPanel> {
  assert.equal(typeof moduleValue.EmergencyReadinessPanel, 'function', 'EmergencyReadinessPanel should be exported');
  return moduleValue.EmergencyReadinessPanel as NonNullable<typeof moduleValue.EmergencyReadinessPanel>;
}

function place(id: string, name: string): SavedPlace {
  return {
    id, name, lat: 41.6111, lon: -86.7225, radiusKm: 25, tags: ['home'], priority: 0,
    notes: '', offlinePinned: false, primary: id === 'home', source: 'manual', sortIndex: 1,
    createdAt: NOW - 60_000, updatedAt: NOW - 60_000,
  };
}

function waitForRender(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 180));
}

beforeEach(() => {
  happyWindow.document.body.replaceChildren();
  happyWindow.localStorage.clear();
});

test('place selection, consent, and capture action stay explicit while the four cards remain read-only', async (context) => {
  const Panel = PanelClass();
  const places = [place('home', 'Home'), place('work', 'Work')];
  const captures: Array<{ placeId: string; contactConsent: boolean }> = [];
  const panel = new Panel({
    getSnapshot: () => null,
    subscribe: () => () => undefined,
    getPrimaryPlace: () => places[0],
    getPlaces: () => places,
    subscribeSavedPlaces: () => () => undefined,
    subscribeEmergencyPack: () => () => undefined,
    hydrate: () => Promise.resolve(),
    getReceipt: () => null,
    getEmergencyPackState: (candidate: SavedPlace) => ({
      status: 'partial', packId: null, profileFingerprint: candidate.id,
      requiredKinds: ['lifelines', 'alerts', 'route-primary', 'offline-map', 'comms-plan', 'contacts'],
      optionalKinds: ['route-alternate'], receipts: [], missingKinds: ['lifelines'], expiredKinds: [],
    }),
    captureEmergencyPack: async (candidate: SavedPlace, contactConsent: boolean) => {
      captures.push({ placeId: candidate.id, contactConsent });
      return { ok: false, failedKind: 'lifelines' };
    },
    now: () => NOW,
    deadlineScheduler: { track: () => undefined, destroy: () => undefined },
  });
  context.after(() => panel.destroy());
  await waitForRender();

  const content = panel.getContentElement();
  assert.equal(content.querySelectorAll('[data-readiness-card]').length, 4);
  const select = content.querySelector<HTMLSelectElement>('[name="emergency-pack-place"]');
  const consent = content.querySelector<HTMLInputElement>('[name="emergency-pack-contact-consent"]');
  const action = content.querySelector<HTMLButtonElement>('[data-pack-action]');
  assert.ok(select && consent && action);
  select.value = 'work';
  select.dispatchEvent(new happyWindow.Event('change', { bubbles: true }));
  consent.checked = true;
  consent.dispatchEvent(new happyWindow.Event('change', { bubbles: true }));
  action.click();
  await waitForRender();
  assert.deepEqual(captures, [{ placeId: 'work', contactConsent: true }]);
  assert.equal(content.querySelectorAll('[data-readiness-card] button').length, 0);
});

test('pack invalidation re-reads authoritative state, preserves action focus, and unsubscribes on destroy', async (context) => {
  const Panel = PanelClass();
  const home = place('home', 'Home');
  let packSubscriber: (() => void) | null = null;
  let state = 'partial';
  let stateReads = 0;
  let unsubscribes = 0;
  const panel = new Panel({
    getSnapshot: () => null,
    subscribe: () => () => undefined,
    getPrimaryPlace: () => home,
    getPlaces: () => [home],
    subscribeSavedPlaces: () => () => undefined,
    subscribeEmergencyPack: (callback: () => void) => {
      packSubscriber = callback;
      return () => { unsubscribes += 1; };
    },
    hydrate: () => Promise.resolve(),
    getReceipt: () => null,
    getEmergencyPackState: () => {
      stateReads += 1;
      return {
        status: state, packId: state === 'ready' ? 'pack-2' : null, profileFingerprint: 'home',
        requiredKinds: ['lifelines', 'alerts', 'route-primary', 'offline-map', 'comms-plan', 'contacts'],
        optionalKinds: ['route-alternate'], receipts: [], missingKinds: state === 'ready' ? [] : ['alerts'], expiredKinds: [],
      };
    },
    captureEmergencyPack: async () => ({ ok: true, packId: 'pack-2' }),
    now: () => NOW,
    deadlineScheduler: { track: () => undefined, destroy: () => undefined },
  });
  context.after(() => panel.destroy());
  await waitForRender();
  const beforeReads = stateReads;
  const initialAction = panel.getContentElement().querySelector<HTMLButtonElement>('[data-pack-action]');
  assert.ok(initialAction);
  initialAction.focus();

  state = 'ready';
  packSubscriber?.();
  await waitForRender();
  assert.ok(stateReads > beforeReads, 'invalidation must re-read the store instead of trusting event payloads');
  assert.equal(/Emergency Pack ready/i.test(panel.getContentElement().textContent ?? ''), true);
  assert.equal((happyWindow.document.activeElement as HTMLElement | null)?.hasAttribute('data-pack-action'), true);

  panel.destroy();
  assert.equal(unsubscribes, 1);
  state = 'partial';
  packSubscriber?.();
  await waitForRender();
  assert.equal(/Emergency Pack ready/i.test(panel.getContentElement().textContent ?? ''), true);
});
