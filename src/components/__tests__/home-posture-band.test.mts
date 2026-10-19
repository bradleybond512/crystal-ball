import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Window } from 'happy-dom';
import { HomePostureBand } from '../HomePostureBand.ts';
import { bindStormMoveActions } from '../StormMoveActions.ts';
import { projectView } from '../../services/survival/world-snapshot.ts';
import { availableMoves } from '../../services/survival/survival-moves.ts';
import { buildSurvivalOutlook } from '../../services/survival/survival-outlook.ts';
import { buildSurvivalPostureBoardView } from '../../services/survival/survival-posture-view.ts';
import { bandForLevel, SURVIVAL_AXES } from '../../services/survival/survival-types.ts';
import type { AxisState, SurvivalMove, WorldSnapshot } from '../../services/survival/survival-types.ts';
import { deriveScriptIndex } from '../../../scripts/targeted-tests.mjs';

const NOW = Date.UTC(2026, 9, 18, 12);

test('the Home posture suite is eligible in the actual targeted test index', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
  const index = deriveScriptIndex(packageJson.scripts);
  assert.equal(index.has('test:home-posture'), true, 'the actual package command must enter the trusted selector index');
  assert.deepEqual([...index.get('test:home-posture')!.testFiles], [
    'src/components/__tests__/home-posture-band.test.mts',
    'src/components/__tests__/home-shell-reassurance.test.mts',
  ]);
});

function snapshot(physical = 50, supply = 85, financial = 0): WorldSnapshot {
  const axes: AxisState[] = SURVIVAL_AXES.map((axis) => {
    const level = axis === 'physical_safety' ? physical : axis === 'supply' ? supply : axis === 'financial' ? financial : 0;
    return {
      axis, level, band: bandForLevel(level), trend: 'steady',
      confidence: { total: level, max: 100, items: [] },
      explanation: { headline: axis, lines: [], missingConfirmation: [] },
      drivers: level ? ['Synthetic modeled context'] : [],
      threats: level ? [{
        sourceEventId: `${axis}-synthetic-source`, axis, severity: level,
        threatLevel: 'warning', hazardKind: 'tornado', hazardLabel: `${axis} synthetic threat`,
        timeToImpactMins: null, arrivalLabel: null, why: 'Synthetic test context', confidenceLabel: 'high',
      }] : [],
    };
  });
  const worst = axes.reduce((a, b) => a.level >= b.level ? a : b);
  return {
    version: 1, capturedAtMs: NOW,
    freshness: [{ domain: 'weather', fetchedAtMs: NOW - 60_000, ageMs: 60_000, ok: true }],
    weatherAlerts: [], savedPlaces: [], plan: { committed: [] },
    posture: { axes, overallLevel: worst.level, overallBand: worst.band, worstAxis: worst.axis,
      headline: 'All clear — unsupported fixture headline', capturedAtMs: NOW, staleInputs: [] },
  };
}

function installDom(t: test.TestContext): Window {
  const window = new Window({ url: 'https://example.invalid/' });
  const globals = globalThis as unknown as Record<string, unknown>;
  for (const key of ['window', 'document', 'localStorage', 'sessionStorage', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement', 'Element', 'Node', 'Event', 'CustomEvent', 'KeyboardEvent', 'FocusEvent', 'MutationObserver'] as const) {
    globals[key] = key === 'window' ? window : window[key];
  }
  globals.getComputedStyle = window.getComputedStyle.bind(window);
  globals.matchMedia = window.matchMedia;
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  Object.defineProperty(globalThis, 'location', { value: window.location, configurable: true });
  t.after(async () => { await window.happyDOM.close(); });
  return window;
}

function mountBand(t: test.TestContext) {
  installDom(t);
  const root = document.createElement('section');
  document.body.append(root);
  const commits: string[] = [];
  let evidence = 0;
  const band = new HomePostureBand(root, { commitMoveId: (id) => commits.push(id), openEvidence: () => { evidence++; } });
  t.after(() => band.destroy());
  return { root, band, commits, evidence: () => evidence };
}

test('selection uses the exact engine decision, not the first available candidate', () => {
  const current = snapshot();
  const before = JSON.stringify(current);
  const projected = projectView(current, { now: NOW });
  const moves = availableMoves(current.posture, current, { now: NOW });
  const expected = buildSurvivalOutlook(current, projected.posture, moves, { now: NOW }).decision;
  const actual = HomePostureBand.select(current, NOW);
  assert.ok(expected.recommendedMoveId);
  assert.notEqual(expected.recommendedMoveId, moves[0]!.id, 'fixture must distinguish first-candidate substitution');
  assert.equal(actual.move?.id, expected.recommendedMoveId);
  assert.deepEqual(actual.moves, moves);
  assert.deepEqual(actual.board, buildSurvivalPostureBoardView(projected.posture, { maxAxes: 3 }));
  assert.equal(JSON.stringify(current), before, 'selection is read-only');
});

test('pending and settled-null remain truthful without a fabricated band or action', (t) => {
  const h = mountBand(t);
  h.band.update(undefined, NOW);
  assert.equal(h.root.dataset.state, 'pending');
  assert.match(h.root.textContent!, /Checking saved posture/);
  h.band.update(null, NOW);
  assert.equal(h.root.dataset.state, 'unavailable');
  assert.match(h.root.textContent!, /No posture snapshot/);
  assert.equal(h.root.querySelector('[data-storm-move]'), null);
  assert.equal(h.root.querySelectorAll('button').length, 2);
  assert.deepEqual(h.commits, []);
});

test('modeled posture keeps worst axes, source references and unknown arrival without confidence, trend or all-clear copy', (t) => {
  const h = mountBand(t);
  const current = snapshot();
  h.band.update(current, NOW);
  assert.equal(h.root.dataset.band, current.posture.overallBand);
  const rows = [...h.root.querySelectorAll('.hs-posture-axis-title')].map((row) => row.textContent);
  const board = HomePostureBand.select(current, NOW).board;
  assert.deepEqual(rows, board.rows.map((row) => `${row.axisTitle} · ${row.band} · ${row.level}`));
  assert.equal(rows.length, 3);
  assert.match(h.root.textContent!, /arrival window unknown/);
  assert.match(h.root.textContent!, /supply-synthetic-source/);
  assert.match(h.root.textContent!, /Other domain source ages and coverage unknown/);
  assert.match(h.root.textContent!, /Modeled effect/);
  assert.doesNotMatch(h.root.textContent!, /confidence|steady|all clear|across all domains/i);
  assert.deepEqual(h.commits, []);
});

test('stale and missing weather retain the exact modeled decision without advancing evidence time', (t) => {
  const h = mountBand(t);
  const current = snapshot();
  const before = JSON.stringify(current);
  h.band.update(current, NOW + 20 * 60_000);
  assert.equal(h.root.dataset.state, 'last-known');
  assert.match(h.root.textContent!, /Recorded weather: 21 min old/);
  assert.equal(h.root.querySelector<HTMLElement>('[data-storm-move]')?.dataset.stormMove, HomePostureBand.select(current, NOW + 20 * 60_000).move?.id);
  h.band.update({ ...current, freshness: [] }, NOW);
  assert.match(h.root.textContent!, /Recorded weather: age unknown/);
  assert.equal(h.root.dataset.state, 'last-known');
  assert.equal(JSON.stringify(current), before);
});

test('Hold with evaluated candidates is distinct from an empty decision', (t) => {
  const h = mountBand(t);
  const hold = snapshot(50, 0, 95);
  const selected = HomePostureBand.select(hold, NOW);
  assert.ok(selected.moves.length > 0);
  assert.equal(selected.decision.recommendedMoveId, null);
  assert.equal(selected.decision.isEmpty, false);
  h.band.update(hold, NOW);
  assert.equal(h.root.querySelector('.hs-posture-move-title')?.textContent, 'Hold');
  assert.equal(h.root.querySelector('[data-storm-move]'), null);
  h.band.update(snapshot(0, 0, 0), NOW);
  assert.equal(h.root.querySelector('.hs-posture-move-title')?.textContent, 'No modeled candidate');
  assert.doesNotMatch(h.root.textContent!, /all clear/i);
});

for (const status of ['planned', 'in_progress', 'done', 'skipped'] as const) {
  test(`the exact committed recommendation remains visible as ${status}`, (t) => {
    const h = mountBand(t);
    const current = snapshot();
    const recommended = HomePostureBand.select(current, NOW).move!;
    current.plan.committed.push({ moveId: recommended.id, status, committedAtMs: NOW });
    h.band.update(current, NOW);
    assert.match(h.root.querySelector('.hs-posture-move-title')!.textContent!, new RegExp(recommended.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(h.root.textContent!, new RegExp(`Plan status: ${status}`));
    assert.equal(h.root.querySelector('[data-storm-move]'), null);
    assert.deepEqual(h.commits, []);
  });
}

test('controls keep focus and age-only changes do not announce; destroy releases callbacks', (t) => {
  const h = mountBand(t);
  const current = snapshot();
  h.band.update(current, NOW);
  const commit = h.root.querySelector<HTMLButtonElement>('[data-storm-move]')!;
  const evidence = [...h.root.querySelectorAll('button')].find((button) => button.textContent === 'Evidence and plan')!;
  commit.focus();
  const observer = new MutationObserver(() => {});
  observer.observe(h.root.querySelector('[role=status]')!, { childList: true, subtree: true, characterData: true });
  h.band.update(current, NOW + 60_000);
  assert.equal(document.activeElement, commit);
  assert.equal(observer.takeRecords().length, 0);
  observer.disconnect();
  commit.click();
  evidence.click();
  assert.equal(h.commits.length, 1);
  assert.equal(h.evidence(), 1);
  h.band.destroy();
  commit.click();
  evidence.click();
  assert.equal(h.commits.length, 1);
  assert.equal(h.evidence(), 1);
});

test('Home and panel scopes deliver exactly one commit per click and release delegation', (t) => {
  const h = mountBand(t);
  const current = snapshot();
  h.band.update(current, NOW);
  const selected = HomePostureBand.select(current, NOW).move!;
  const panel = document.createElement('section');
  const button = document.createElement('button');
  button.dataset.stormMove = selected.id;
  panel.append(button);
  document.body.append(panel);
  const panelCommits: SurvivalMove[] = [];
  const unbind = bindStormMoveActions(panel, { resolveMove: (id) => id === selected.id ? selected : undefined, commitMove: (move) => panelCommits.push(move) });
  h.root.querySelector<HTMLButtonElement>('[data-storm-move]')!.click();
  assert.equal(h.commits.length, 1);
  assert.equal(panelCommits.length, 0);
  button.click();
  assert.equal(h.commits.length, 1);
  assert.deepEqual(panelCommits, [selected]);
  unbind();
  button.click();
  assert.equal(panelCommits.length, 1);
  const source = readFileSync(new URL('../StormPosturePanel.ts', import.meta.url), 'utf8');
  assert.match(source, /bindStormMoveActions\(this\.getContentElement\(\)/);
  assert.match(source, /commitMove: commitStormMove/);
  assert.doesNotMatch(source, /document\.addEventListener\('click', this\.onCommitClick\)/);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function mountShell(t: test.TestContext, options: { initial?: WorldSnapshot | null; hydration?: Promise<void>; load?: () => Promise<typeof HomePostureBand>; evidenceAvailable?: boolean } = {}) {
  installDom(t);
  const [{ HomeShellOverlay }, recurring, contextual] = await Promise.all([
    import('../HomeShellOverlay.ts'), import('../../services/diagnostics/recurring-loops.ts'), import('../../services/home-shell/contextual-deck-view.ts'),
  ]);
  recurring.resetRecurringLoopsForTests();
  let current = options.initial ?? null;
  let now = NOW;
  let subscriptions = 0;
  let hydrations = 0;
  let notify: (() => void) | undefined;
  const commits: SurvivalMove[] = [];
  const openings: string[] = [];
  const parent = document.createElement('main');
  const panel = document.createElement('section');
  panel.dataset.fixture = 'actual-panel-element';
  document.body.append(parent, panel);
  const shell = new HomeShellOverlay({
    getPanel: () => undefined, now: () => now,
    ensurePanel: async (id) => { openings.push(id); return options.evidenceAvailable === false ? null : { getElement: () => panel }; },
    contextualProjection: { kind: 'ready', build: contextual.buildContextualDeckView },
    contextualSnapshotSource: {
      get: () => current,
      hydrate: () => { hydrations++; return options.hydration ?? Promise.resolve(); },
      subscribe: (callback) => { subscriptions++; notify = callback; return () => { subscriptions--; notify = undefined; }; },
    },
    postureBandLoader: options.load ?? (() => Promise.resolve(HomePostureBand)),
    commitPostureMove: (move) => commits.push(move),
  });
  shell.mount(parent);
  t.after(() => { shell.destroy(); recurring.resetRecurringLoopsForTests(); });
  return { shell, parent, panel, commits, openings, recurring,
    set(value: WorldSnapshot | null, publish = true) { current = value; if (publish) notify?.(); },
    advance(ms: number) { now += ms; },
    subscriptions: () => subscriptions, hydrations: () => hydrations,
    notify: () => notify?.(),
  };
}

test('shell shares one hydration/subscription, settles pending failure, and cancels visible work', async (t) => {
  const hydration = deferred<void>();
  const h = await mountShell(t, { hydration: hydration.promise });
  h.shell.show(); h.shell.show();
  await flush();
  assert.equal(h.subscriptions(), 1);
  assert.equal(h.hydrations(), 1);
  assert.equal(h.parent.querySelector('.hs-posture-band')?.getAttribute('data-state'), 'pending');
  assert.equal(h.parent.querySelectorAll('.home-shell-briefing .hs-band').length, 4);
  assert.deepEqual(h.recurring.getRecurringLoops().map((loop) => loop.name), ['home-shell-refresh']);
  hydration.reject(new Error('Synthetic malformed/invalid saved snapshot'));
  await flush();
  assert.equal(h.parent.querySelector('.hs-posture-band')?.getAttribute('data-state'), 'unavailable');
  h.set(snapshot());
  assert.match(h.parent.querySelector('.hs-posture-band')!.textContent!, /Modeled posture/);
  assert.deepEqual(h.commits, []);
  h.shell.hide();
  assert.equal(h.subscriptions(), 0);
  assert.equal(h.recurring.getRecurringLoops().length, 0);
  h.shell.show();
  assert.equal(h.hydrations(), 1);
  assert.equal(h.subscriptions(), 1);
});

test('shell refuses a changed selected ID and commits only the current displayed candidate once', async (t) => {
  const h = await mountShell(t, { initial: snapshot() });
  h.shell.show(); await flush();
  const original = h.parent.querySelector<HTMLButtonElement>('[data-storm-move]')!;
  const oldId = original.dataset.stormMove;
  h.set(snapshot(85, 0), false);
  const currentId = HomePostureBand.select(snapshot(85, 0), NOW).move!.id;
  assert.notEqual(currentId, oldId);
  original.click();
  assert.deepEqual(h.commits, []);
  assert.equal(h.parent.querySelector<HTMLElement>('[data-storm-move]')?.dataset.stormMove, currentId);
  h.parent.querySelector<HTMLButtonElement>('[data-storm-move]')!.click();
  assert.deepEqual(h.commits.map((move) => move.id), [currentId]);
});

test('the existing shell refresh ages the same snapshot and retains focused action controls', async (t) => {
  const current = snapshot();
  const before = JSON.stringify(current);
  const h = await mountShell(t, { initial: current });
  h.shell.show(); await flush();
  const commit = h.parent.querySelector<HTMLButtonElement>('[data-storm-move]')!;
  commit.focus();
  h.advance(20 * 60_000);
  (h.shell as unknown as { refresh(): void }).refresh();
  assert.equal(document.activeElement, commit);
  assert.match(h.parent.querySelector('.hs-posture-band')!.textContent!, /Recorded weather: 21 min old/);
  assert.equal(JSON.stringify(current), before);
  assert.deepEqual(h.commits, []);
  for (const file of ['../HomePostureBand.ts', '../StormMoveActions.ts']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\b(?:fetch|setInterval|setTimeout|saveSnapshot|recordSnapshot)\s*\(/, file);
  }
});

test('shell Evidence reparents the existing panel and preserves the existing disabled fallback', async (t) => {
  const h = await mountShell(t, { initial: snapshot() });
  h.shell.show(); await flush();
  [...h.parent.querySelectorAll('button')].find((button) => button.textContent === 'Evidence and plan')!.click();
  await flush();
  assert.deepEqual(h.openings, ['storm-posture']);
  assert.equal(h.parent.querySelector('.hs-focus-body')?.firstElementChild, h.panel);
  assert.deepEqual(h.commits, []);
});

test('absent evidence follows the existing classic navigation fallback', async (t) => {
  const h = await mountShell(t, { evidenceAvailable: false });
  const navigations: string[] = [];
  document.addEventListener('cb:navigate-panel', ((event: CustomEvent) => navigations.push(event.detail.panelKey)) as EventListener);
  h.shell.show(); await flush();
  [...h.parent.querySelectorAll('button')].find((button) => button.textContent === 'Evidence and plan')!.click();
  await flush();
  assert.deepEqual(navigations, ['storm-posture']);
  assert.equal(h.shell.isVisible(), false);
});

test('hide and destroy invalidate a late presentation import and retain first-screen context', async (t) => {
  const loading = deferred<typeof HomePostureBand>();
  const h = await mountShell(t, { load: () => loading.promise });
  h.shell.show();
  assert.equal(h.parent.querySelectorAll('.home-shell-briefing .hs-band').length, 4);
  h.shell.hide();
  loading.resolve(HomePostureBand);
  await flush();
  assert.equal(h.parent.querySelector('.hs-posture-band')?.querySelector('[role=status]'), null);
  h.shell.show(); await flush();
  assert.ok(h.parent.querySelector('.hs-posture-band [role=status]'));
  h.shell.destroy();
  h.notify();
  assert.equal(h.parent.querySelector('.home-shell'), null);
  assert.equal(h.subscriptions(), 0);
  assert.deepEqual(h.commits, []);
});

test('the loading Evidence control retains keyboard focus when the lazy band becomes ready', async (t) => {
  const loading = deferred<typeof HomePostureBand>();
  const h = await mountShell(t, { initial: snapshot(), load: () => loading.promise });
  h.shell.show();
  const pendingEvidence = h.parent.querySelector<HTMLButtonElement>('.hs-posture-evidence')!;
  pendingEvidence.focus();
  assert.equal(document.activeElement === pendingEvidence, true);
  loading.resolve(HomePostureBand);
  await flush();
  const evidence = [...h.parent.querySelectorAll('button')].find((button) => button.textContent === 'Evidence and plan');
  assert.equal(document.activeElement === evidence, true, 'lazy readiness must preserve the focused Evidence action');
});

test('presentation import failure does not block the three context bands or Evidence fallback', async (t) => {
  const h = await mountShell(t, { load: async () => { throw new Error('Synthetic chunk failure'); } });
  h.shell.show(); await flush();
  assert.equal(h.parent.querySelectorAll('.home-shell-briefing .hs-band').length, 4);
  assert.match(h.parent.querySelector('.hs-posture-band')!.textContent!, /Posture display unavailable/);
  assert.equal(h.commits.length, 0);
});

test('destroy during hydration and import cannot recreate or update the removed band', async (t) => {
  const hydration = deferred<void>();
  const loading = deferred<typeof HomePostureBand>();
  const h = await mountShell(t, { hydration: hydration.promise, load: () => loading.promise });
  h.shell.show();
  h.shell.destroy();
  hydration.resolve();
  loading.resolve(HomePostureBand);
  await flush();
  assert.equal(h.parent.querySelector('.home-shell'), null);
  assert.equal(h.subscriptions(), 0);
  assert.equal(h.recurring.getRecurringLoops().length, 0);
  assert.deepEqual(h.commits, []);
});
