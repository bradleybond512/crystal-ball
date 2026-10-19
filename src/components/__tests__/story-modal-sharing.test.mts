import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import type { StoryData } from '../../services/story-data';

test('disabled story actions cannot open, share or copy, and local PNG save stays enabled', async () => {
  const browser = new Window({ url: 'http://localhost:3000/' });
  const globals = ['window', 'document', 'navigator', 'requestAnimationFrame'] as const;
  const saved = globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const effects: string[] = [];
  Object.defineProperty(globalThis, 'window', { value: browser, configurable: true });
  Object.defineProperty(globalThis, 'document', { value: browser.document, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: {
    share: async () => { effects.push('share'); },
    canShare: () => true,
    clipboard: { write: async () => { effects.push('image'); }, writeText: async () => { effects.push('link'); } },
  }, configurable: true });
  // Leave rendering pending: dispatching share clicks must still be harmless.
  Object.defineProperty(globalThis, 'requestAnimationFrame', { value: () => 1, configurable: true });
  browser.open = (() => { effects.push('open'); return null; }) as typeof browser.open;
  const { openStoryModal, closeStoryModal } = await import('../StoryModal');
  const data: StoryData = {
    countryCode: 'US', countryName: 'United States', cii: null, news: [], theater: null,
    markets: [], convergence: null,
    threats: { critical: 0, high: 0, medium: 0, categories: [] },
    signals: { protests: 0, militaryFlights: 0, militaryVessels: 0, outages: 0, gpsJammingHexes: 0 },
  };
  try {
    openStoryModal(data);
    for (const selector of ['.story-whatsapp', '.story-twitter', '.story-linkedin', '.story-copy']) {
      const button = browser.document.querySelector(selector) as HTMLButtonElement;
      assert.equal(button.disabled, true, selector);
      button.dispatchEvent(new browser.Event('click'));
    }
    await Promise.resolve();
    assert.deepEqual(effects, []);
    assert.equal((browser.document.querySelector('.story-save') as HTMLButtonElement).disabled, false);
  } finally {
    closeStoryModal();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    await browser.happyDOM.abort();
  }
});
