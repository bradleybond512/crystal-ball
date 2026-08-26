import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSnapshot } from '../../services/survival/world-snapshot.ts';
import type { WorldSnapshot } from '../../services/survival/survival-types.ts';

const NOW = Date.parse('2026-08-25T16:00:00.000Z');

interface ReadinessApi {
  projectEmergencyReadiness?: (...args: unknown[]) => {
    cards: Array<{ id: string }>;
    pack: unknown;
  };
  renderEmergencyReadiness?: (view: unknown) => string;
}

const api = await import('../emergency-readiness-view.ts').catch(() => ({} as ReadinessApi)) as ReadinessApi;

function requireFunction<K extends keyof ReadinessApi>(name: K): NonNullable<ReadinessApi[K]> {
  const value = api[name];
  assert.equal(typeof value, 'function', `${String(name)} should be exported`);
  return value as NonNullable<ReadinessApi[K]>;
}

function assertMarkup(html: string, pattern: RegExp, message: string): void {
  assert.equal(pattern.test(html), true, message);
}

function refuteMarkup(html: string, pattern: RegExp, message: string): void {
  assert.equal(pattern.test(html), false, message);
}

function snapshot(): WorldSnapshot {
  return buildSnapshot({
    weatherAlerts: [],
    savedPlaces: [{ id: 'home', label: 'Home', lat: 41.6111, lon: -86.7225, radiusKm: 25 }],
    weatherFetchedAtMs: NOW - 60_000,
  }, { now: NOW });
}

function packInput(overrides: Record<string, unknown> = {}) {
  return {
    places: [
      { id: 'home', name: 'Home <script>window.pwned=true</script>' },
      { id: 'work', name: 'Work' },
    ],
    selectedPlaceId: 'home',
    readiness: {
      status: 'partial',
      packId: 'pack-1',
      requiredKinds: ['lifelines', 'alerts', 'route-primary', 'offline-map', 'comms-plan', 'contacts'],
      optionalKinds: ['route-alternate'],
      receipts: [{
        kind: 'lifelines',
        capturedAt: new Date(NOW - 60_000).toISOString(),
        expiresAt: new Date(NOW + 60 * 60_000).toISOString(),
        semanticState: 'verified',
        summary: 'Exact Lifelines snapshot',
      }],
      missingKinds: ['alerts', 'route-primary', 'offline-map', 'comms-plan', 'contacts'],
      expiredKinds: [],
    },
    contactConsent: false,
    captureState: { status: 'idle', completed: 1, total: 6, message: 'Five required artifacts missing.' },
    ...overrides,
  };
}

test('keeps four independent readiness cards and renders a separate truthful Emergency Pack workflow', () => {
  const project = requireFunction('projectEmergencyReadiness');
  const render = requireFunction('renderEmergencyReadiness');
  const view = project(snapshot(), null, { now: NOW, emergencyPack: packInput() });
  const html = render(view);

  assert.deepEqual(view.cards.map((card) => card.id), [
    'grid-down', 'offline-playbook', 'comms-fallback', 'lifelines',
  ]);
  assert.equal((html.match(/data-readiness-card=/g) ?? []).length, 4);
  assert.equal((html.match(/data-emergency-pack=/g) ?? []).length, 1);
  assert.equal((html.match(/data-pack-artifact=/g) ?? []).length, 7);
  assertMarkup(html, /Emergency Pack/, 'pack section should be named');
  assertMarkup(html, /Home &lt;script&gt;window\.pwned=true&lt;\/script&gt;/, 'place labels should be escaped');
  refuteMarkup(html, /<script>/, 'place labels must not inject markup');
  assertMarkup(html, /name="emergency-pack-place"/, 'place selector should be rendered');
  assertMarkup(html, /Required/, 'required artifacts should be identified');
  assertMarkup(html, /Optional/, 'optional artifacts should be identified');
  assertMarkup(html, /Retry missing|required artifacts missing/i, 'partial state should offer a retry');
  assertMarkup(html, /<progress[^>]+max="6"[^>]+value="1"/, 'capture progress should be semantic');
  assertMarkup(html, /type="checkbox"[^>]+name="emergency-pack-contact-consent"/, 'contact consent should be explicit');
  assertMarkup(html, /stored locally|local device|private/i, 'private local contact storage should be disclosed');
  assertMarkup(html, /<time[^>]+datetime=/, 'artifact expiry should use semantic time markup');
  assertMarkup(html, /class="emergency-pack__live[^>]+aria-live="polite"[^>]+aria-atomic="true"/, 'pack status should use a stable live region');
  refuteMarkup(html, /Emergency Pack ready/i, 'partial evidence must not claim readiness');
});

test('ready copy is allowed only for all required exact receipts; an absent alternate route stays optional', () => {
  const project = requireFunction('projectEmergencyReadiness');
  const render = requireFunction('renderEmergencyReadiness');
  const required = ['lifelines', 'alerts', 'route-primary', 'offline-map', 'comms-plan', 'contacts'];
  const emergencyPack = packInput({
    readiness: {
      status: 'ready',
      packId: 'pack-2',
      requiredKinds: required,
      optionalKinds: ['route-alternate'],
      receipts: required.map((kind) => ({
        kind,
        capturedAt: new Date(NOW - 60_000).toISOString(),
        expiresAt: new Date(NOW + 60 * 60_000).toISOString(),
        semanticState: kind === 'alerts' ? 'verified-empty' : 'verified',
        summary: kind === 'alerts' ? 'No scoped alerts at capture; coverage not inferred.' : `${kind} verified`,
      })),
      missingKinds: [],
      expiredKinds: [],
    },
    contactConsent: true,
    captureState: { status: 'complete', completed: 6, total: 6, message: 'Required pack captured.' },
  });
  const html = render(project(snapshot(), null, { now: NOW, emergencyPack }));

  assertMarkup(html, /Emergency Pack ready/i, 'all current required evidence may claim pack readiness');
  assertMarkup(html, /No scoped alerts at capture; coverage not inferred\./, 'empty alerts must preserve the coverage disclaimer');
  assertMarkup(html, /Alternate route/, 'alternate route should remain visible');
  assertMarkup(html, /Optional.*not captured|not captured.*Optional/is, 'missing alternate route should stay optional');
  assert.equal((html.match(/data-readiness-card=/g) ?? []).length, 4);
});

test('an artifact that expires at render time revokes ready copy and offers an expired refresh', () => {
  const project = requireFunction('projectEmergencyReadiness');
  const render = requireFunction('renderEmergencyReadiness');
  const required = ['lifelines', 'alerts', 'route-primary', 'offline-map', 'comms-plan', 'contacts'];
  const emergencyPack = packInput({
    readiness: {
      status: 'ready',
      packId: 'pack-expiring',
      requiredKinds: required,
      optionalKinds: ['route-alternate'],
      receipts: required.map((kind) => ({
        kind,
        capturedAt: new Date(NOW - 60_000).toISOString(),
        expiresAt: new Date(kind === 'offline-map' ? NOW : NOW + 60 * 60_000).toISOString(),
        semanticState: 'verified',
        summary: `${kind} verified`,
      })),
      missingKinds: [],
      expiredKinds: [],
    },
    captureState: { status: 'complete', completed: 6, total: 6, message: 'Required pack captured.' },
  });
  const html = render(project(snapshot(), null, { now: NOW, emergencyPack }));

  refuteMarkup(html, /Emergency Pack ready/i, 'render-time expiry must revoke stale ready copy');
  assertMarkup(html, /data-emergency-pack="expired"/, 'the aggregate status must agree with expired artifacts');
  assertMarkup(html, /Emergency Pack expired/i, 'render-time expiry should be explicit');
  assertMarkup(html, /Refresh expired artifacts/i, 'expired evidence should have the correct action');
  assertMarkup(html, /value="5"/, 'progress must count only current required artifacts');
  refuteMarkup(html, /Required pack captured\./, 'the live message must not retain stale completion copy');
  assertMarkup(html, /Required artifacts have expired\./, 'the live message should explain the expiry transition');
});

test('an optional artifact expiring at render time does not revoke required-pack readiness', () => {
  const project = requireFunction('projectEmergencyReadiness');
  const render = requireFunction('renderEmergencyReadiness');
  const required = ['lifelines', 'alerts', 'route-primary', 'offline-map', 'comms-plan', 'contacts'];
  const emergencyPack = packInput({
    readiness: {
      status: 'ready',
      packId: 'pack-optional-expiring',
      requiredKinds: required,
      optionalKinds: ['route-alternate'],
      receipts: [...required, 'route-alternate'].map((kind) => ({
        kind,
        capturedAt: new Date(NOW - 60_000).toISOString(),
        expiresAt: new Date(kind === 'route-alternate' ? NOW : NOW + 60 * 60_000).toISOString(),
        semanticState: 'verified',
        summary: `${kind} verified`,
      })),
      missingKinds: [],
      expiredKinds: [],
    },
    captureState: { status: 'complete', completed: 6, total: 6, message: 'Required pack captured.' },
  });
  const html = render(project(snapshot(), null, { now: NOW, emergencyPack }));

  assertMarkup(html, /data-emergency-pack="ready"/, 'optional expiry must not downgrade required readiness');
  assertMarkup(html, /Emergency Pack ready/i, 'all current required receipts remain ready');
  assertMarkup(html, /data-pack-artifact="route-alternate"[\s\S]*?Expired/, 'the optional artifact should still show expiry');
  assertMarkup(html, /<progress[^>]+max="6"[^>]+value="6"/, 'optional expiry must not reduce required progress');
});
