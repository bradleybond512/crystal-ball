import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { beforeEach } from 'node:test';

import { Window } from 'happy-dom';

import type { WeatherDispatchDecision } from '../../services/weather/weather-warning-router.ts';

const NOW = 2_000_000_000_000;
const happyWindow = new Window({ url: 'http://127.0.0.1/' });
const globals = globalThis as unknown as Record<string, unknown>;

class TestResizeObserver {
  static last: TestResizeObserver | undefined;
  readonly targets: Element[] = [];

  constructor(private readonly callback: ResizeObserverCallback) {
    TestResizeObserver.last = this;
  }

  observe(target: Element): void {
    this.targets.push(target);
  }

  disconnect(): void {}

  unobserve(): void {}

  trigger(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

Object.assign(globals, {
  window: happyWindow,
  document: happyWindow.document,
  HTMLElement: happyWindow.HTMLElement,
  HTMLDivElement: happyWindow.HTMLDivElement,
  HTMLButtonElement: happyWindow.HTMLButtonElement,
  Element: happyWindow.Element,
  Node: happyWindow.Node,
  Event: happyWindow.Event,
  CustomEvent: happyWindow.CustomEvent,
  localStorage: happyWindow.localStorage,
  ResizeObserver: TestResizeObserver,
});

const { PersonalStormMode } = await import('../PersonalStormMode.ts');
const { NotificationStack } = await import('../NotificationStack.ts');

const panelLayoutSource = readFileSync(
  new URL('../../app/panel-layout.ts', import.meta.url),
  'utf8',
);
const notificationStackSource = readFileSync(
  new URL('../NotificationStack.ts', import.meta.url),
  'utf8',
);

beforeEach(() => {
  happyWindow.document.body.replaceChildren();
  happyWindow.localStorage.clear();
  happyWindow.document.documentElement.style.removeProperty('--notification-stack-h');
  TestResizeObserver.last = undefined;
});

function persistentDecision(threatLevel: 'warning' | 'emergency'): WeatherDispatchDecision {
  const alertId = `urn:test:${threatLevel}`;
  const hazardKind = threatLevel === 'emergency' ? 'tornado' : 'high_wind';
  const event = threatLevel === 'emergency' ? 'Tornado Warning' : 'High Wind Warning';
  const reason = `${event} includes Home`;

  return {
    alertId,
    matchedPlaceId: 'home',
    matchedPlaceLabel: 'Home',
    match: {
      alertId,
      placeId: 'home',
      matchKind: 'inside_polygon',
      isInside: true,
      distanceKm: 0,
      hazardKind,
      event,
      severity: threatLevel === 'emergency' ? 'extreme' : 'severe',
      threatLevel,
      msUntilExpires: 30 * 60 * 1000,
      isUpdate: false,
      isCancellation: false,
      reason,
    },
    urgency: {
      alertId,
      placeId: 'home',
      hazardKind,
      threatLevel,
      priority: 'persistent_critical',
      persistentInApp: true,
      bypassQuietHours: true,
      minRepeatIntervalMs: 5 * 60 * 1000,
      requiresAcknowledgment: threatLevel === 'emergency',
      acknowledgmentDeadlineMs: threatLevel === 'emergency' ? 5 * 60 * 1000 : undefined,
      reason,
    },
    payload: {
      activation: threatLevel === 'emergency' ? 'critical' : 'active',
      title: `${event} - Home`,
      primaryHazard: hazardKind,
      mainThreatLabel: threatLevel === 'emergency' ? 'confirmed tornado' : 'damaging wind',
      closestPlaceLabel: 'Home',
      distanceKm: 0,
      confidenceLabel: 'high',
      threatLevel,
      actions: [{
        id: 'shelter-now',
        label: 'Move to shelter now',
        priority: 1,
        estimatedMinutes: 1,
        rationale: 'Protect yourself from the primary hazard.',
      }],
      nextUpdateLabel: 'Radar scan in 5 min',
      reason,
      expiresAtMs: NOW + 30 * 60 * 1000,
      generatedAtMs: NOW,
    },
    diagnostic: {} as WeatherDispatchDecision['diagnostic'],
    dispatchActions: ['persistent_strip', 'request_acknowledgment'],
    shouldSuppress: false,
    reason,
  };
}

function renderStorm(threatLevel: 'warning' | 'emergency' = 'warning'): {
  component: InstanceType<typeof PersonalStormMode>;
  mount: HTMLDivElement;
} {
  const mount = happyWindow.document.createElement('div');
  happyWindow.document.body.append(mount);
  const component = new PersonalStormMode({ mount });
  component.update(persistentDecision(threatLevel), NOW);
  return { component, mount };
}

function requiredElement<T extends Element>(parent: ParentNode, selector: string): T {
  const element = parent.querySelector<T>(selector);
  assert.ok(element, `${selector} should be rendered`);
  return element;
}

for (const threatLevel of ['warning', 'emergency'] as const) {
  test(`persistent ${threatLevel} starts as a compact collapsed shelf row`, () => {
    const { component, mount } = renderStorm(threatLevel);

    try {
      const root = requiredElement<HTMLElement>(mount, '.cb-storm-mode');
      assert.ok(root.querySelector('.cb-storm-mode__strip'), 'compact shelf row should remain visible');
      assert.ok(
        !root.querySelector('.cb-storm-mode__card'),
        'persistent alert details should not render expanded by default',
      );
    } finally {
      component.clear();
    }
  });
}

test('critical headline and details use an accessible disclosure contract', () => {
  const { component, mount } = renderStorm('emergency');

  try {
    const headline = requiredElement<HTMLElement>(mount, '.critical-title');
    assert.match(headline.tagName, /^H[1-6]$/, 'critical title should be a semantic heading');
    assert.match(headline.textContent ?? '', /tornado/i);

    const disclosure = requiredElement<HTMLButtonElement>(mount, 'button[aria-expanded][aria-controls]');
    assert.match(`${disclosure.textContent} ${disclosure.getAttribute('aria-label') ?? ''}`, /details/i);
    assert.equal(disclosure.getAttribute('aria-expanded'), 'false');

    const detailsId = disclosure.getAttribute('aria-controls');
    assert.ok(detailsId, 'disclosure should identify the details it controls');
    const details = happyWindow.document.getElementById(detailsId);
    assert.ok(details, 'controlled details should exist in the DOM');
    assert.equal(details.hidden, true, 'details should start collapsed');

    disclosure.click();
    assert.equal(disclosure.getAttribute('aria-expanded'), 'true');
    assert.equal(details.hidden, false, 'disclosure should reveal details');

    disclosure.click();
    assert.equal(disclosure.getAttribute('aria-expanded'), 'false');
    assert.equal(details.hidden, true, 'second disclosure click should collapse details');
  } finally {
    component.clear();
  }
});

test('refreshing the same alert preserves expanded details and keyboard focus', () => {
  const { component, mount } = renderStorm('emergency');

  try {
    const disclosure = requiredElement<HTMLButtonElement>(mount, '.cb-storm-mode__btn--details');
    disclosure.click();
    disclosure.focus();

    const refreshedDecision = {
      ...persistentDecision('emergency'),
      reason: 'Updated warning still includes Home',
    };
    component.update(refreshedDecision, NOW + 1_000);

    const refreshedDisclosure = requiredElement<HTMLButtonElement>(mount, '.cb-storm-mode__btn--details');
    const detailsId = refreshedDisclosure.getAttribute('aria-controls');
    assert.ok(detailsId);
    assert.equal(refreshedDisclosure.getAttribute('aria-expanded'), 'true');
    assert.equal(happyWindow.document.getElementById(detailsId)?.hidden, false);
    assert.equal(happyWindow.document.activeElement, refreshedDisclosure);

    const refreshedRoot = requiredElement<HTMLElement>(mount, '.cb-storm-mode');
    component.update({ ...refreshedDecision }, NOW + 2_000);
    assert.ok(
      requiredElement<HTMLElement>(mount, '.cb-storm-mode') === refreshedRoot,
      'an unchanged refresh should not replace the live alert DOM',
    );
  } finally {
    component.clear();
  }
});

test('collapsed shelf keeps acknowledge primary and snooze independently accessible', () => {
  const { component, mount } = renderStorm('warning');

  try {
    const acknowledge = requiredElement<HTMLButtonElement>(mount, '.cb-storm-mode__btn--ack');
    const snooze = requiredElement<HTMLButtonElement>(mount, '.cb-storm-mode__btn--snooze');
    const disclosure = requiredElement<HTMLButtonElement>(mount, 'button[aria-expanded][aria-controls]');

    assert.equal(acknowledge.type, 'button');
    assert.equal(acknowledge.getAttribute('aria-label'), 'Acknowledge alert');
    assert.notEqual(acknowledge, disclosure, 'acknowledge should not double as the details disclosure');
    assert.equal(snooze.type, 'button');
    assert.match(snooze.getAttribute('aria-label') ?? '', /snooze.+15 minutes/i);
    assert.ok(!mount.querySelector('.cb-storm-mode__card'));
  } finally {
    component.clear();
  }
});

test('destroy clears its pending transition timer and removes mount content', () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  const clearedTimers: ReturnType<typeof setTimeout>[] = [];
  let rendered: ReturnType<typeof renderStorm> | undefined;

  globals.setTimeout = (handler: () => void, delay?: number) => {
    const timer = originalSetTimeout(handler, delay);
    pendingTimers.add(timer);
    return timer;
  };
  globals.clearTimeout = (timer: ReturnType<typeof setTimeout>) => {
    if (pendingTimers.delete(timer)) clearedTimers.push(timer);
    originalClearTimeout(timer);
  };

  try {
    rendered = renderStorm('warning');
    const { component, mount } = rendered;
    const destroy = (component as unknown as { destroy?: () => void }).destroy;

    assert.equal(pendingTimers.size, 1, 'visible alert should arm one expiry transition');
    assert.equal(typeof destroy, 'function', 'PersonalStormMode should expose destroy()');
    destroy!.call(component);

    assert.equal(pendingTimers.size, 0, 'destroy should leave no scheduled transitions');
    assert.equal(clearedTimers.length, 1, 'destroy should clear the active transition timer');
    assert.equal(mount.childElementCount, 0, 'destroy should remove owned mount content');
  } finally {
    rendered?.component.clear();
    globals.setTimeout = originalSetTimeout;
    globals.clearTimeout = originalClearTimeout;
  }
});

test('NotificationStack exposes and measures the alert shelf below EEW chrome', () => {
  const stack = new NotificationStack();
  stack.mount(happyWindow.document.body as unknown as HTMLElement);

  try {
    assert.ok(
      /top:\s*'var\(--below-eew\)'/.test(notificationStackSource),
      'notification shelf should anchor at var(--below-eew)',
    );
    assert.ok(stack.element.classList.contains('alert-shelf'));
    assert.equal(stack.element.style.maxHeight, 'calc(100dvh - var(--below-eew))');
    assert.equal(stack.element.style.overflowY, 'auto');

    const stormMount = happyWindow.document.createElement('div');
    const triageMount = happyWindow.document.createElement('div');
    stormMount.id = 'cb-storm-mode-mount';
    triageMount.className = 'triage-bar';
    stack.element.append(stormMount, triageMount);
    Object.defineProperty(stack.element, 'offsetHeight', { value: 72, configurable: true });

    const observer = TestResizeObserver.last;
    assert.ok(observer, 'stack should create a ResizeObserver');
    assert.equal(observer.targets[0], stack.element, 'shared in-flow shelf should be the measured element');
    observer.trigger();
    assert.equal(
      happyWindow.document.documentElement.style.getPropertyValue('--notification-stack-h'),
      '72px',
    );
  } finally {
    stack.destroy();
  }
});

test('panel layout mounts storm mode in the measured shelf before triage', () => {
  const stormMountPattern = /notificationStack\.element\.append(?:Child)?\(stormMount\)/;
  const triageMountPattern = /this\.triageBar\.mount\(notificationStack\.element\)/;
  const stormMountIndex = panelLayoutSource.search(stormMountPattern);
  const triageMountIndex = panelLayoutSource.search(triageMountPattern);

  assert.ok(stormMountIndex >= 0, 'storm mount should be appended to the notification shelf');
  assert.doesNotMatch(
    panelLayoutSource,
    /document\.body\.append(?:Child)?\(stormMount\)/,
    'storm mode should not use a separate fixed body host',
  );
  assert.ok(triageMountIndex >= 0, 'triage should share the notification shelf');
  assert.ok(stormMountIndex < triageMountIndex, 'storm shelf row should precede triage in flow');
});
