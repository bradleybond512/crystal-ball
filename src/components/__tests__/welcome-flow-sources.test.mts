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
