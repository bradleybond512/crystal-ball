import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { RUNTIME_FEATURES } from '../../services/runtime-config.ts';

function installDom(): Window {
  const happyWindow = new Window({ url: 'https://crystalball.app/' });
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.window = happyWindow;
  globals.document = happyWindow.document;
  globals.localStorage = happyWindow.localStorage;
  globals.HTMLElement = happyWindow.HTMLElement;
  globals.HTMLButtonElement = happyWindow.HTMLButtonElement;
  globals.Element = happyWindow.Element;
  globals.Event = happyWindow.Event;
  globals.CustomEvent = happyWindow.CustomEvent;
  globals.KeyboardEvent = happyWindow.KeyboardEvent;
  globals.getComputedStyle = happyWindow.getComputedStyle.bind(happyWindow);
  globals.requestAnimationFrame = (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0);
  globals.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  return happyWindow;
}

test('source-connect step separates auth wiring and derives optional unlocks from runtime metadata', async () => {
  const happyWindow = installDom();
  const { WelcomeFlow, WELCOME_SOURCE_GROUPS } = await import('../WelcomeFlow.ts');
  const flow = new WelcomeFlow();
  const testFlow = flow as unknown as { backdrop: HTMLElement; step: number; renderStep(): void };
  happyWindow.document.body.append(testFlow.backdrop);
  testFlow.step = 2;
  testFlow.renderStep();

  const groups = [...happyWindow.document.querySelectorAll<HTMLElement>('[data-source-access]')];
  assert.deepEqual(groups.map((group) => group.dataset.sourceAccess), ['no-auth', 'optional-credential']);
  assert.match(groups[0]!.textContent, /No configured credentials required/);
  assert.match(groups[1]!.textContent, /Optional service credentials/);
  assert.match(happyWindow.document.body.textContent, /Network access and upstream availability still apply/i);
  assert.doesNotMatch(happyWindow.document.body.textContent, /work right away|no key needed/i);

  const rowText = [...happyWindow.document.querySelectorAll<HTMLElement>('[data-source-name]')]
    .map((row) => row.textContent ?? '');
  const newsApi = rowText.find((text) => text.includes('NewsAPI')) ?? '';
  const openWeather = rowText.find((text) => text.includes('OpenWeatherMap')) ?? '';
  const newsFeature = RUNTIME_FEATURES.find((feature) => feature.id === 'newsApiHeadlines')!;
  const owmFeature = RUNTIME_FEATURES.find((feature) => feature.id === 'owmWeatherTiles')!;
  const optionalSources = WELCOME_SOURCE_GROUPS.find((group) => group.access === 'optional-credential')!.sources;
  assert.equal(optionalSources.find((source) => source.name === 'NewsAPI')!.unlocks, newsFeature.description);
  assert.equal(optionalSources.find((source) => source.name === 'OpenWeatherMap')!.unlocks, owmFeature.description);
  assert.match(newsApi, /credential.*global headline search/i);
  assert.match(openWeather, /credential.*weather.*tile.*overlays/i);
  assert.doesNotMatch(openWeather, /redundancy/i);
  assert.doesNotMatch(newsApi, /no key|works/i);
  assert.doesNotMatch(openWeather, /no key|works/i);

  happyWindow.document.body.replaceChildren();
});

test('first-run backdrop blocks the full app stack while its native controls remain reachable', async () => {
  const happyWindow = installDom();
  const { WelcomeFlow } = await import('../WelcomeFlow.ts');
  let underlyingClicks = 0;
  const underlying = happyWindow.document.createElement('button');
  underlying.textContent = 'Underlying Home Shell control';
  underlying.addEventListener('click', () => { underlyingClicks += 1; });

  const flow = new WelcomeFlow();
  const testFlow = flow as unknown as { backdrop: HTMLElement; renderStep(): void };
  happyWindow.document.body.append(underlying, testFlow.backdrop);
  testFlow.renderStep();

  assert.equal(testFlow.backdrop.style.position, 'fixed');
  assert.equal(testFlow.backdrop.style.inset, '0');
  assert.ok(Number(testFlow.backdrop.style.zIndex) > 10_005, 'onboarding must stack above the Home Shell and command palette');
  assert.equal(testFlow.backdrop.style.pointerEvents, 'auto');

  const skip = [...testFlow.backdrop.querySelectorAll('button')]
    .find((candidate) => candidate.textContent === 'Skip for now');
  assert.ok(skip instanceof happyWindow.HTMLButtonElement);
  assert.equal(skip.disabled, false);
  happyWindow.document.body.classList.add('animations-paused');
  skip.click();
  assert.match(testFlow.backdrop.textContent, /What interests you\?/);
  assert.equal(underlyingClicks, 0);

  happyWindow.document.body.replaceChildren();
});

test('Open Settings completes once and opens API-key settings', async () => {
  const happyWindow = installDom();
  const { WelcomeFlow } = await import('../WelcomeFlow.ts');
  let completions = 0;
  let settingsOpens = 0;
  happyWindow.document.addEventListener('wm:open-settings', () => { settingsOpens += 1; });
  const flow = new WelcomeFlow({ onComplete: () => { completions += 1; } });
  const testFlow = flow as unknown as { backdrop: HTMLElement; step: number; renderStep(): void };
  happyWindow.document.body.append(testFlow.backdrop);
  testFlow.step = 2;
  testFlow.renderStep();
  const settings = [...happyWindow.document.querySelectorAll('button')]
    .find((candidate) => candidate.textContent === 'Open Settings');
  settings?.click();

  assert.equal(completions, 1);
  assert.equal(settingsOpens, 1);
});

test('first-run onboarding behaves as a keyboard modal and restores focus on Escape', async () => {
  const happyWindow = installDom();
  const { WelcomeFlow } = await import('../WelcomeFlow.ts');
  let completions = 0;
  const trigger = happyWindow.document.createElement('button');
  trigger.textContent = 'Launch onboarding';
  happyWindow.document.body.append(trigger);
  trigger.focus();

  const flow = new WelcomeFlow({ onComplete: () => { completions += 1; } });
  flow.show();
  const testFlow = flow as unknown as { backdrop: HTMLElement; modal: HTMLElement };
  const buttons = [...testFlow.modal.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
  const first = buttons[0]!;
  const last = buttons[buttons.length - 1]!;

  assert.equal(testFlow.modal.getAttribute('role'), 'dialog');
  assert.equal(testFlow.modal.getAttribute('aria-modal'), 'true');
  const titleId = testFlow.modal.getAttribute('aria-labelledby');
  assert.ok(titleId);
  assert.equal(testFlow.modal.querySelector(`#${titleId}`)?.textContent, 'Set Your Location');
  assert.equal(happyWindow.document.activeElement, first);

  last.focus();
  last.dispatchEvent(new happyWindow.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  assert.equal(happyWindow.document.activeElement, first);
  first.dispatchEvent(new happyWindow.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
  assert.equal(happyWindow.document.activeElement, last);

  last.dispatchEvent(new happyWindow.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(completions, 1);
  assert.equal(happyWindow.localStorage.getItem('cb:onboarding-complete'), 'true');
  assert.equal(happyWindow.document.activeElement, trigger);
  happyWindow.document.body.replaceChildren();
});

test('Escape cancels onboarding effects from an outstanding location lookup', async () => {
  const happyWindow = installDom();
  const { locationService } = await import('../../services/location.ts');
  const { WelcomeFlow } = await import('../WelcomeFlow.ts');
  const originalGetLocation = locationService.getLocation.bind(locationService);
  let resolveLocation!: (value: { lat: number; lon: number; timestamp: number; source: 'browser' }) => void;
  const pendingLocation = new Promise<{ lat: number; lon: number; timestamp: number; source: 'browser' }>((resolve) => {
    resolveLocation = resolve;
  });
  locationService.getLocation = () => pendingLocation;
  let locations = 0;
  let completions = 0;

  try {
    const flow = new WelcomeFlow({
      onLocationSet: () => { locations += 1; },
      onComplete: () => { completions += 1; },
    });
    flow.show();
    const useLocation = [...happyWindow.document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Use My Location');
    assert.ok(useLocation);
    useLocation.click();
    useLocation.dispatchEvent(new happyWindow.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    resolveLocation({ lat: 41.8, lon: -87.6, timestamp: Date.now(), source: 'browser' });
    await pendingLocation;
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(completions, 1);
    assert.equal(locations, 0);
  } finally {
    locationService.getLocation = originalGetLocation;
    happyWindow.document.body.replaceChildren();
  }
});
