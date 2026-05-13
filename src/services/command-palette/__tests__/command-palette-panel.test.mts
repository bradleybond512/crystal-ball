/**
 * Panel-level integration tests using happy-dom. Covers the keyboard model
 * (↑/↓/Enter/Escape) and the show/hide visibility lifecycle.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { Window } from 'happy-dom';

// Install happy-dom onto globalThis BEFORE importing the panel module.
const happyWindow = new Window({ url: 'http://127.0.0.1/' });
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
