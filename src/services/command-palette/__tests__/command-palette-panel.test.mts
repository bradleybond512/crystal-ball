/**
 * Panel-level integration tests using happy-dom. Covers the keyboard model
 * (↑/↓/Enter/Escape) and the show/hide visibility lifecycle.
 */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';

import { Window } from 'happy-dom';
import type { PaletteCommand } from '../command-registry.ts';

// Install happy-dom onto globalThis BEFORE importing the panel module.
const happyWindow = new Window({ url: 'http://127.0.0.1/' });
after(() => happyWindow.happyDOM.abort());
const G = globalThis as unknown as Record<string, unknown>;
G.window = happyWindow;
G.document = happyWindow.document;
G.HTMLElement = happyWindow.HTMLElement;
G.HTMLInputElement = happyWindow.HTMLInputElement;
G.HTMLButtonElement = happyWindow.HTMLButtonElement;
G.Element = happyWindow.Element;
G.Node = happyWindow.Node;
G.Event = happyWindow.Event;
G.CustomEvent = happyWindow.CustomEvent;
G.KeyboardEvent = happyWindow.KeyboardEvent;

const { CommandPalettePanel } = await import('../../../components/CommandPalettePanel.ts');
const { createCommandRegistry } = await import('../command-registry.ts');
const { buildBuiltinCommands } = await import('../built-in-commands.ts');
const builtinCatalog = await import('../built-in-commands.ts');

class DeferredCatalogPanel extends CommandPalettePanel {
  readonly requests: {
    promise: Promise<typeof builtinCatalog>;
    resolve: (catalog: typeof builtinCatalog) => void;
    reject: (error: Error) => void;
  }[] = [];

  constructor(registry: ReturnType<typeof createCommandRegistry>) {
    super({ registry, lazyBuiltins: true });
  }

  protected override loadBuiltinCatalog(): Promise<typeof builtinCatalog> {
    let resolve!: (catalog: typeof builtinCatalog) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<typeof builtinCatalog>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    this.requests.push({ promise, resolve, reject });
    return promise;
  }

  async resolveCatalog(index = 0): Promise<void> {
    const request = this.requests[index]!;
    request.resolve(builtinCatalog);
    await request.promise;
    await Promise.resolve();
  }

  async rejectCatalog(error: Error, index = 0): Promise<void> {
    const request = this.requests[index]!;
    request.reject(error);
    await assert.rejects(request.promise, error);
    await Promise.resolve();
  }

  retainedRow(command: PaletteCommand): HTMLElement {
    // Exercise the real row-click closure even while partial rows are hidden.
    return (this as unknown as { makeRow: (entry: PaletteCommand, index: number) => HTMLElement }).makeRow(command, 0);
  }
}

function buildPanel() {
  const registry = createCommandRegistry();
  let aCalls = 0; let bCalls = 0; let cCalls = 0;
  registry.register({ id: 'a', title: 'Run Self-Test', keywords: ['diagnostic'], category: 'action', action: () => { aCalls += 1; } });
  registry.register({ id: 'b', title: 'Open Markets',  keywords: ['mark'],       category: 'panel',  action: () => { bCalls += 1; } });
  registry.register({ id: 'c', title: 'Go to Globe',   keywords: ['nav'],        category: 'navigation', action: () => { cCalls += 1; } });
  const panel = new CommandPalettePanel({ registry });
  panel.mount(happyWindow.document.body as unknown as HTMLElement);
  return {
    panel,
    counts: () => ({ a: aCalls, b: bCalls, c: cCalls }),
  };
}

test('show() makes the overlay visible and hide() hides it', () => {
  const { panel } = buildPanel();
  assert.equal(panel.isVisible(), false);
  panel.show();
  assert.equal(panel.isVisible(), true);
  assert.equal(panel.element().hidden, false);
  panel.hide();
  assert.equal(panel.isVisible(), false);
  assert.equal(panel.element().hidden, true);
});

test('toggle() flips visibility', () => {
  const { panel } = buildPanel();
  panel.toggle();
  assert.equal(panel.isVisible(), true);
  panel.toggle();
  assert.equal(panel.isVisible(), false);
});

test('Escape closes the palette', () => {
  const { panel } = buildPanel();
  panel.show();
  const handled = panel.handleKey({ key: 'Escape' });
  assert.equal(handled, true);
  assert.equal(panel.isVisible(), false);
});

test('handleKey returns false when palette is hidden', () => {
  const { panel } = buildPanel();
  assert.equal(panel.handleKey({ key: 'ArrowDown' }), false);
});

test('ArrowDown advances the cursor, ArrowUp retreats', () => {
  const { panel } = buildPanel();
  panel.show();
  // First active row by default
  const active0 = panel.element().querySelector('.is-active');
  assert.ok(active0, 'expected an initially active row');
  panel.handleKey({ key: 'ArrowDown' });
  const active1 = panel.element().querySelector('.is-active');
  assert.notEqual(active0?.getAttribute('data-command-id'), active1?.getAttribute('data-command-id'));
  panel.handleKey({ key: 'ArrowUp' });
  const active2 = panel.element().querySelector('.is-active');
  assert.equal(active2?.getAttribute('data-command-id'), active0?.getAttribute('data-command-id'));
});

test('Enter runs the selected command and closes the palette', () => {
  const { panel, counts } = buildPanel();
  panel.show();
  // First row in render order is the navigation one (category order: navigation, panel, action, search).
  panel.handleKey({ key: 'Enter' });
  assert.equal(panel.isVisible(), false);
  // Exactly one command should have fired.
  const c = counts();
  const fired = (c.a ? 1 : 0) + (c.b ? 1 : 0) + (c.c ? 1 : 0);
  assert.equal(fired, 1);
});

test('Cmd+1 jumps directly to the first visible result', () => {
  const { panel, counts } = buildPanel();
  panel.show();
  panel.handleKey({ key: '1', metaKey: true });
  assert.equal(panel.isVisible(), false);
  const c = counts();
  const fired = (c.a ? 1 : 0) + (c.b ? 1 : 0) + (c.c ? 1 : 0);
  assert.equal(fired, 1);
});

test('rendered results are grouped with category section headers', () => {
  const { panel } = buildPanel();
  panel.show();
  const sections = [...panel.element().querySelectorAll('.cmdk-v2-section')].map(el => el.textContent);
  // Section labels follow PALETTE_CATEGORY_ORDER (navigation, panel, action, search).
  assert.deepEqual(sections, ['Navigate', 'Panels', 'Actions']);
});

test('rendered rows include a category badge', () => {
  const { panel } = buildPanel();
  panel.show();
  const badges = [...panel.element().querySelectorAll('.cmdk-v2-badge')].map(el => el.textContent);
  assert.ok(badges.length >= 3);
  assert.ok(badges.includes('NAV'));
  assert.ok(badges.includes('PANEL'));
  assert.ok(badges.includes('ACTION'));
});

test('rows expose data-command-id for selection assertions', () => {
  const { panel } = buildPanel();
  panel.show();
  const ids = [...panel.element().querySelectorAll('[data-command-id]')].map(el => el.getAttribute('data-command-id'));
  assert.deepEqual(new Set(ids), new Set(['a', 'b', 'c']));
});

test('unmount() removes the overlay from the DOM', () => {
  const { panel } = buildPanel();
  panel.mount(happyWindow.document.body as unknown as HTMLElement);
  panel.unmount();
  // Overlay should no longer be in the body.
  assert.equal(panel.element().isConnected, false);
});

test('selection hides palette before action and its pending focus cannot steal the destination', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const registry = createCommandRegistry();
  const destination = document.createElement('button'); document.body.append(destination);
  let calls = 0;
  const panel = new CommandPalettePanel({ registry });
  registry.register({ id: 'diagnostics', title: 'Open Diagnostics', keywords: [], category: 'navigation', action: () => {
    calls++; assert.equal(panel.isVisible(), false); destination.focus();
  } });
  panel.mount(document.body); panel.show();
  const nested = panel.element().querySelector('.cmdk-v2-row span') as HTMLElement;
  nested.click();
  t.mock.timers.tick(5);
  assert.equal(calls, 1);
  assert.equal(document.activeElement === destination, true);
  panel.unmount(); destination.remove();
});

test('live built-in commands dispatch exactly once through nested palette clicks after it closes', () => {
  for (const [id, event] of [
    ['navigation:diagnostics', 'cb:open-diagnostics'], ['nav:gods-vision', 'cb:toggle-gods-vision'],
    ['action:toggle-analyst-hud', 'cb:toggle-analyst-hud'], ['action:toggle-ghost-mode', 'wm:toggle-ghost-mode'],
  ]) {
    const registry = createCommandRegistry();
    const panel = new CommandPalettePanel({ registry });
    const calls = [];
    const command = buildBuiltinCommands({ panels: {}, dispatch: (name) => {
      calls.push([name, panel.isVisible()]);
    } }).find((entry) => entry.id === id);
    assert.ok(command); registry.register(command);
    panel.mount(document.body); panel.show();
    (panel.element().querySelector('.cmdk-v2-row span') as HTMLElement).click();
    assert.deepEqual(calls, [[event, false]]); panel.unmount();
  }
});

test('lazy catalog admission opens the real input immediately and preserves buffered query, focus and live commands', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const registry = createCommandRegistry();
  for (const id of ['place:home', 'guide:tornado', 'situation:active']) {
    registry.register({ id, title: id, keywords: [], category: 'navigation', action: () => {} });
  }
  const panel = new DeferredCatalogPanel(registry);
  t.after(() => panel.unmount());
  panel.mount(document.body);
  assert.equal(panel.requests.length, 0, 'mount does not acquire the builtin catalog');
  panel.show();
  const input = panel.element().querySelector<HTMLInputElement>('input')!;
  assert.equal(panel.requests.length, 1);
  assert.equal(panel.isVisible(), true);
  assert.equal(panel.element().hidden, false);
  assert.equal(panel.element().getAttribute('aria-busy'), 'true');
  const loadingStatus = panel.element().querySelector('[role="status"]');
  assert.equal(loadingStatus !== null, true, 'pending catalog has a visible status');
  assert.match(loadingStatus!.textContent!, /Loading commands/);
  assert.equal(panel.element().querySelectorAll('[data-command-id]').length, 0, 'partial catalog is not presented');
  t.mock.timers.tick(0);
  assert.equal(document.activeElement === input, true);
  input.value = 'diagnostics';
  input.dispatchEvent(new happyWindow.Event('input', { bubbles: true }));
  t.mock.timers.tick(50);
  await panel.resolveCatalog();
  assert.equal(input.value, 'diagnostics', 'catalog readiness does not call show or reset the query');
  assert.equal(document.activeElement === input, true, 'catalog readiness does not change focus');
  assert.equal(panel.element().getAttribute('aria-busy'), 'false');
  assert.ok(panel.currentResults().some((entry) => entry.command.id === 'navigation:diagnostics'));
  assert.equal(panel.element().querySelector('[role="status"]') === null, true);
  for (const id of ['place:home', 'guide:tornado', 'situation:active']) {
    assert.ok(registry.getAll().some((command) => command.id === id), `${id} survives builtin registration`);
  }
  panel.hide(); panel.show();
  assert.equal(panel.requests.length, 1, 'the live owner registers builtins only once');
});

test('the common execution sink blocks partial Enter, both number modifiers and real row clicks while pending or failed', async (t) => {
  t.mock.method(console, 'error', () => {});
  const registry = createCommandRegistry();
  let calls = 0;
  const command: PaletteCommand = { id: 'place:partial', title: 'Partial place', keywords: [], category: 'navigation', action: () => { calls++; } };
  registry.register(command);
  const panel = new DeferredCatalogPanel(registry);
  t.after(() => panel.unmount());
  panel.mount(document.body); panel.show();
  const row = panel.retainedRow(command);
  for (const phase of ['pending', 'failed']) {
    panel.handleKey({ key: 'Enter' });
    panel.handleKey({ key: '1', metaKey: true });
    panel.handleKey({ key: '1', ctrlKey: true });
    row.click();
    assert.equal(calls, 0, `${phase}: every activation path must reject the partial catalog`);
    assert.equal(panel.isVisible(), true, `${phase}: blocked activation does not close the palette`);
    if (phase === 'pending') await panel.rejectCatalog(new Error('Synthetic catalog import rejection'));
  }
});

test('Escape, double toggle and backdrop cancellation cannot be undone or focused by hidden catalog completion', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const cancellation of ['escape', 'double-toggle', 'backdrop']) {
    const registry = createCommandRegistry();
    const panel = new DeferredCatalogPanel(registry);
    panel.mount(document.body); panel.show();
    if (cancellation === 'escape') panel.handleKey({ key: 'Escape' });
    else if (cancellation === 'double-toggle') panel.toggle();
    else panel.element().click();
    const destination = document.createElement('button'); document.body.append(destination); destination.focus();
    await panel.resolveCatalog();
    t.mock.timers.tick(5);
    assert.equal(panel.isVisible(), false, cancellation);
    assert.equal(document.activeElement === destination, true, cancellation);
    assert.ok(registry.getAll().some((command) => command.id === 'navigation:diagnostics'), 'hidden live completion may register');
    panel.show();
    assert.equal(panel.requests.length, 1, 'warm reopening uses the completed catalog');
    panel.unmount(); destination.remove();
  }
});

test('unmount and remount invalidate old catalog registration, rendering and focus without cancelling the new owner', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const registry = createCommandRegistry();
  const registration = t.mock.method(registry, 'register');
  const panel = new DeferredCatalogPanel(registry);
  t.after(() => panel.unmount());
  panel.mount(document.body); panel.show(); panel.unmount();
  const destination = document.createElement('button'); document.body.append(destination); destination.focus();
  panel.mount(document.body); panel.show();
  assert.equal(panel.requests.length, 2);
  const pendingMarkup = panel.element().innerHTML;
  await panel.resolveCatalog(0);
  assert.equal(registration.mock.callCount(), 0, 'the old owner may not register into the shared registry');
  assert.equal(panel.element().innerHTML, pendingMarkup, 'the old owner may not render into the replacement session');
  assert.equal(document.activeElement === destination, true, 'the old resolution cannot focus');
  await panel.resolveCatalog(1);
  assert.equal(registration.mock.callCount(), buildBuiltinCommands({ dispatch: () => {} }).length);
  assert.equal(panel.element().getAttribute('aria-busy'), 'false');
  destination.remove();
});

test('an unmounted palette rejects a retained ready row and late catalog completion cannot register', async (t) => {
  const { panel, counts } = buildPanel();
  panel.show();
  const row = panel.element().querySelector<HTMLElement>('[data-command-id]')!;
  panel.unmount(); row.click();
  assert.deepEqual(counts(), { a: 0, b: 0, c: 0 }, 'detached row callbacks cannot execute after owner teardown');
  const registry = createCommandRegistry();
  const registration = t.mock.method(registry, 'register');
  const pending = new DeferredCatalogPanel(registry);
  pending.mount(document.body); pending.show(); pending.unmount();
  const markup = pending.element().innerHTML;
  await pending.resolveCatalog();
  assert.equal(registration.mock.callCount(), 0);
  assert.equal(pending.element().innerHTML, markup, 'late completion does not render a detached owner');
});

test('catalog rejection stays visible and explicit retry preserves the query until real canonical commands become ready', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const errors = t.mock.method(console, 'error', () => {});
  const registry = createCommandRegistry();
  const panel = new DeferredCatalogPanel(registry);
  t.after(() => panel.unmount());
  panel.mount(document.body); panel.show();
  const input = panel.element().querySelector<HTMLInputElement>('input')!;
  input.value = 'ghost';
  await panel.rejectCatalog(new Error('Synthetic catalog import rejection'));
  assert.equal(errors.mock.callCount(), 1);
  assert.equal(panel.isVisible(), true);
  assert.equal(panel.element().getAttribute('aria-busy'), 'false');
  const errorStatus = panel.element().querySelector('[role="status"]');
  assert.equal(errorStatus !== null, true, 'rejection remains visible');
  assert.match(errorStatus!.textContent!, /Commands unavailable/);
  const retry = panel.element().querySelector<HTMLButtonElement>('[data-action="retry-builtin-catalog"]')!;
  assert.equal(retry !== null, true, 'rejection exposes explicit retry');
  retry.focus(); retry.click();
  assert.equal(panel.requests.length, 2, 'retry starts one new request');
  assert.equal(input.value, 'ghost');
  assert.equal(document.activeElement === input, true, 'explicit retry returns typing to the real input');
  await panel.resolveCatalog(1);
  assert.equal(input.value, 'ghost');
  assert.ok(panel.currentResults().some((entry) => entry.command.id === 'action:toggle-ghost-mode'));
  for (const [id, event] of [
    ['navigation:diagnostics', 'cb:open-diagnostics'], ['nav:gods-vision', 'cb:toggle-gods-vision'],
    ['action:toggle-analyst-hud', 'cb:toggle-analyst-hud'], ['action:toggle-ghost-mode', 'wm:toggle-ghost-mode'],
  ]) {
    let calls = 0;
    const listener = () => { assert.equal(panel.isVisible(), false); calls++; };
    document.addEventListener(event, listener);
    try {
      panel.show();
      const command = registry.getAll().find((entry) => entry.id === id)!;
      assert.ok(command, `${id} is registered by the real factory`);
      input.value = command.title;
      input.dispatchEvent(new happyWindow.Event('input', { bubbles: true }));
      t.mock.timers.tick(50);
      const target = panel.element().querySelector<HTMLElement>(`[data-command-id="${id}"]`)!;
      assert.ok(target, `${id} appears after ready`);
      target.querySelector<HTMLElement>('span')!.click();
      assert.equal(calls, 1, `${id} dispatches its original intent once`);
    } finally { document.removeEventListener(event, listener); }
  }
});

test('the default lazy loader imports the existing builtin factory while custom fixture registries remain eager by default', async (t) => {
  class RealCatalogPanel extends CommandPalettePanel {
    catalogRequest: Promise<typeof builtinCatalog> | null = null;
    protected override loadBuiltinCatalog(): Promise<typeof builtinCatalog> {
      this.catalogRequest = super.loadBuiltinCatalog();
      return this.catalogRequest;
    }
  }
  const registry = createCommandRegistry();
  const panel = new RealCatalogPanel({ registry, lazyBuiltins: true });
  t.after(() => panel.unmount());
  panel.mount(document.body);
  assert.equal(panel.catalogRequest, null);
  panel.show();
  assert.ok(panel.catalogRequest);
  await panel.catalogRequest;
  await Promise.resolve();
  assert.ok(registry.getAll().some((command) => command.id === 'navigation:diagnostics'));
  assert.equal(panel.element().getAttribute('aria-busy'), 'false');
  const fixture = buildPanel();
  fixture.panel.show();
  assert.deepEqual(new Set(fixture.panel.currentResults().map((entry) => entry.command.id)), new Set(['a', 'b', 'c']));
  fixture.panel.unmount();
});
