import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import type { PersonalProfile } from '../../services/personal/personal-impact.ts';
import type { WorldSnapshot } from '../../services/survival/survival-types.ts';

const NOW = Date.UTC(2026, 8, 7, 12);
const COVERAGE_NOTE = 'Available reports only · coverage unverified · evidence age unknown.';
const DIGEST_NOTE = 'Recorded changes only · source coverage and evidence age unverified.';
const REVIEW_NOTE = 'Review source status before relying on this summary.';
const HOME = { placeId: 'home', label: 'Home', latitude: 41.6, longitude: -86.7 };
const EMPTY_PROFILE: PersonalProfile = { savedPlaces: [], watchedEntities: [], portfolio: [], travelRoutes: [], utilities: [] };

function installDom(): Window {
  const happyWindow = new Window({ url: 'https://crystalball.app/' });
  const globals = globalThis as unknown as Record<string, unknown>;
  for (const key of [
    'window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'HTMLButtonElement',
    'HTMLInputElement', 'Element', 'Node', 'Event', 'CustomEvent', 'KeyboardEvent', 'FocusEvent',
    'MutationObserver',
  ] as const) {
    globals[key] = key === 'window' ? happyWindow : happyWindow[key];
  }
  globals.getComputedStyle = happyWindow.getComputedStyle.bind(happyWindow);
  globals.matchMedia = happyWindow.matchMedia;
  Object.defineProperty(globalThis, 'navigator', { value: happyWindow.navigator, configurable: true });
  Object.defineProperty(globalThis, 'location', { value: happyWindow.location, configurable: true });
  return happyWindow;
}

async function mountShell(t: test.TestContext) {
  const window = installDom();
  const [overlay, insights, changes, recurring, freshness, contextual] = await Promise.all([
    import('../HomeShellOverlay.ts'),
    import('../../services/insights/insights-state.ts'),
    import('../../services/command-center/what-changed.ts'),
    import('../../services/diagnostics/recurring-loops.ts'),
    import('../../services/data-freshness.ts'),
    import('../../services/home-shell/contextual-deck-view.ts'),
  ]);
  insights.resetInsightsState();
  changes.resetWhatChangedStore();
  recurring.resetRecurringLoopsForTests();
  let now = NOW;
  let snapshot: WorldSnapshot | null = null;
  const parent = window.document.createElement('main');
  window.document.body.append(parent);
  const shell = new overlay.HomeShellOverlay({
    getPanel: () => undefined,
    ensurePanel: async () => undefined,
    now: () => now,
    contextualProjection: { kind: 'ready', build: contextual.buildContextualDeckView },
    contextualSnapshotSource: {
      get: () => snapshot,
      subscribe: () => () => {},
      hydrate: async () => {},
    },
  });
  t.after(async () => {
    shell.destroy();
    recurring.resetRecurringLoopsForTests();
    insights.resetInsightsState();
    changes.resetWhatChangedStore();
    await window.happyDOM.close();
  });
  shell.mount(parent);
  return {
    shell, parent, window, insights, changes,
    freshness: freshness.dataFreshness,
    advance(ms: number) { now += ms; },
    setSnapshot(value: WorldSnapshot) { snapshot = value; },
    refresh() { shell.hide(); shell.show(); },
    availableDigest() {
      changes.recordSnapshot({ takenAt: now - 60_000, alerts: [], situations: [], feeds: [] });
      changes.recordSnapshot({ takenAt: now, alerts: [], situations: [], feeds: [] });
    },
  };
}

function bands(parent: Window['document']['body']) {
  const result = [...parent.querySelectorAll('.home-shell-briefing .hs-band')];
  assert.equal(result.length, 3, 'personal, digest and worldwide context must remain visible');
  return result;
}

function assertNotes(parent: Window['document']['body'], zeroPlaces = false): void {
  const current = bands(parent);
  assert.deepEqual(current.map((band) => band.querySelector('.hs-band-label')?.textContent), [
    'Personal', 'What changed', 'Critical worldwide',
  ]);
  assert.deepEqual(current.map((band) => band.querySelector('.hs-band-stale')?.textContent), [
    zeroPlaces ? COVERAGE_NOTE : `${COVERAGE_NOTE} ${REVIEW_NOTE}`,
    `${DIGEST_NOTE} ${REVIEW_NOTE}`,
    `${COVERAGE_NOTE} ${REVIEW_NOTE}`,
  ]);
  for (const band of current) {
    const note = band.querySelector('.hs-band-stale');
    assert.ok(note?.isConnected);
    assert.equal(note?.closest('[hidden]'), null);
  }
  assert.doesNotMatch(parent.querySelector('.home-shell-briefing')?.textContent ?? '', /all clear|nothing critical worldwide|last good|successful update/i);
}

test('cold Home keeps zero-place, unavailable digest and worldwide notes visible', async (t) => {
  const h = await mountShell(t);
  h.shell.show();
  const current = bands(h.parent);
  assert.deepEqual(current.map((band) => band.querySelector('.hs-band-headline')?.textContent), [
    'No saved places for a local assessment.', 'Change digest unavailable', 'No critical items in available reports.',
  ]);
  assert.ok(current.every((band) => band.classList.contains('hs-tone-info')));
  assert.equal(current[0]!.querySelector('.hs-band-line')?.textContent, 'Add a place in Settings.');
  assert.equal(current[0]!.querySelector('button'), null);
  assertNotes(h.parent, true);
  h.insights.setPersonalProfile({ ...EMPTY_PROFILE, savedPlaces: [HOME] });
  h.refresh();
  assert.equal(bands(h.parent)[0]!.querySelector('.hs-band-headline')?.textContent, 'No personal impacts identified in available reports.');
  assertNotes(h.parent);
});

test('healthy sources, recalculation, errors and offline reopening cannot refresh unknown evidence age', async (t) => {
  const h = await mountShell(t);
  h.insights.setPersonalProfile({ ...EMPTY_PROFILE, savedPlaces: [HOME] });
  h.availableDigest();
  for (const source of ['usgs', 'nws-alerts', 'open-meteo'] as const) h.freshness.recordUpdate(source, 3, NOW);
  h.shell.show();
  assertNotes(h.parent);
  assert.equal(bands(h.parent)[1]!.querySelector('.hs-band-headline')?.textContent, 'No changes recorded in the available digest.');
  for (const elapsed of [60_000, 86_400_000]) {
    h.advance(elapsed);
    h.refresh();
    assertNotes(h.parent);
    assert.ok(bands(h.parent).every((band) => band.classList.contains('hs-tone-info')));
  }
  h.freshness.recordError('nws-alerts', 'Fixture source unavailable');
  Object.defineProperty(h.window.navigator, 'onLine', { value: false, configurable: true });
  h.window.dispatchEvent(new h.window.Event('offline'));
  h.refresh();
  assertNotes(h.parent);
  assert.equal(bands(h.parent)[0]!.querySelector('.hs-band-headline')?.textContent, 'No personal impacts identified in available reports.');
});

test('a failed personal refresh stays unavailable without suppressing a known worldwide event', async (t) => {
  const h = await mountShell(t);
  h.insights.setPersonalProfile({ ...EMPTY_PROFILE, savedPlaces: [HOME] });
  h.insights.setRecentEvents([{ eventId: 'world-event', description: 'Distant critical event', severity: 90, domain: 'conflict', at: NOW }]);
  h.shell.show();
  assertNotes(h.parent);
  h.insights.setPersonalProfile({
    ...EMPTY_PROFILE,
    savedPlaces: [HOME],
    get watchedEntities() { throw new Error('Fixture personal input unavailable'); },
  });
  h.advance(60_000);
  h.refresh();
  const current = bands(h.parent);
  assert.equal(current[0]!.querySelector('.hs-band-headline')?.textContent, 'Personal status unavailable.');
  assert.equal(current[0]!.querySelectorAll('.hs-band-line').length, 0);
  assert.equal(current[2]!.querySelector('button')?.dataset.situationId, 'world-event');
  assert.match(current[2]!.querySelector('button')?.textContent ?? '', /Distant critical event/);
  assert.equal(current[2]!.classList.contains('hs-tone-critical'), true);
  assertNotes(h.parent);
  h.insights.setPersonalProfile({ ...EMPTY_PROFILE, savedPlaces: [HOME] });
  h.refresh();
  assertNotes(h.parent);
  assert.equal(bands(h.parent)[0]!.querySelector('.hs-band-headline')?.textContent, 'No personal impacts identified in available reports.');
});

test('dependency threats retain their real action and dossier link without saved places', async (t) => {
  const h = await mountShell(t);
  h.insights.setPersonalProfile({ ...EMPTY_PROFILE, portfolio: [{ symbol: 'TEST', weight: 0.5 }] });
  h.insights.setRecentEvents([{ eventId: 'dependency', description: 'Portfolio exposure', severity: 90, domain: 'market', affectedSymbols: ['TEST'], at: NOW }]);
  const expected = h.insights.getPersonalImpactReport().impacts[0]!;
  assert.equal(expected.severity, 'critical');
  h.shell.show();
  const personal = bands(h.parent)[0]!;
  assert.equal(personal.classList.contains('hs-tone-critical'), true);
  const link = personal.querySelector('button');
  assert.equal(link?.dataset.situationId, 'dependency');
  assert.equal(link?.textContent, `● ${expected.description} — ${expected.recommendedAction}`);
  assert.doesNotMatch(personal.textContent, /No saved places|Add a place/);
  assertNotes(h.parent);
});

test('a committed plan lowers modeled posture without upgrading empty-report reassurance', async (t) => {
  const h = await mountShell(t);
  const [{ buildSnapshot }, { availableMoves }, { commitMove, emptyPlan }] = await Promise.all([
    import('../../services/survival/world-snapshot.ts'),
    import('../../services/survival/survival-moves.ts'),
    import('../../services/survival/survival-plan.ts'),
  ]);
  const savedPlaces = [{ id: 'home', label: 'Home', lat: HOME.latitude, lon: HOME.longitude, radiusKm: 25 }];
  const weatherAlerts = [{
    id: 'storm', event: 'Tornado Warning',
    polygon: { rings: [[[-86.9, 41.4], [-86.5, 41.4], [-86.5, 41.8], [-86.9, 41.8], [-86.9, 41.4]]] },
    sent: new Date(NOW - 60_000).toISOString(), expires: new Date(NOW + 3_600_000).toISOString(),
  }];
  const base = buildSnapshot({ weatherAlerts, savedPlaces, weatherFetchedAtMs: NOW }, { now: NOW });
  const moves = availableMoves(base.posture, base, { now: NOW });
  assert.ok(moves.length >= 2);
  const plan = commitMove(commitMove(emptyPlan(), moves[0]!, NOW), moves[1]!, NOW);
  const planned = buildSnapshot({ weatherAlerts, savedPlaces, weatherFetchedAtMs: NOW, plan }, { now: NOW });
  assert.ok(planned.posture.overallLevel < base.posture.overallLevel);
  h.insights.setPersonalProfile({ ...EMPTY_PROFILE, savedPlaces: [HOME] });
  h.setSnapshot(base);
  h.shell.show();
  assertNotes(h.parent);
  const before = h.parent.querySelector('.home-shell-briefing')!.textContent;
  h.setSnapshot(planned);
  h.refresh();
  assert.equal(h.parent.querySelector('.home-shell-briefing')!.textContent, before);
  assertNotes(h.parent);
});

test('removing a saved place invalidates its previous personal match while preserving worldwide context', async (t) => {
  const h = await mountShell(t);
  h.insights.setPersonalProfile({ ...EMPTY_PROFILE, savedPlaces: [HOME] });
  h.insights.setRecentEvents([{
    eventId: 'nearby-storm', description: 'Nearby severe weather', severity: 90, domain: 'weather', at: NOW,
    location: { latitude: HOME.latitude, longitude: HOME.longitude, radiusKm: 20 },
  }]);
  h.shell.show();
  const first = bands(h.parent);
  assert.equal(first[0]!.querySelector('button')?.dataset.situationId, 'nearby-storm');
  assert.equal(first[0]!.classList.contains('hs-tone-critical'), true);
  assertNotes(h.parent);
  h.insights.setPersonalProfile(EMPTY_PROFILE);
  h.refresh();
  const current = bands(h.parent);
  assert.equal(current[0]!.querySelector('.hs-band-headline')?.textContent, 'No saved places for a local assessment.');
  assert.equal(current[0]!.querySelector('button'), null);
  assert.equal(current[2]!.querySelector('button')?.dataset.situationId, 'nearby-storm');
  assertNotes(h.parent, true);
});
