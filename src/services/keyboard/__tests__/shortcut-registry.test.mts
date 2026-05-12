import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseChord,
  normalizeKey,
  matchesChord,
  isTypingTarget,
  createShortcutRegistry,
  buildPanelFocusBindings,
} from '../shortcut-registry.ts';

test('parseChord handles plus-separated Cmd+K', () => {
  const c = parseChord('Cmd+K');
  assert.equal(c.key, 'k');
  assert.equal(c.meta, true);
  assert.equal(c.shift, false);
  assert.equal(c.ctrl, false);
  assert.equal(c.alt, false);
});

test('parseChord handles unicode-glued ⌘⇧/', () => {
  const c = parseChord('⌘⇧/');
  assert.equal(c.key, '/');
  assert.equal(c.meta, true);
  assert.equal(c.shift, true);
});

test('parseChord rejects empty spec', () => {
  assert.throws(() => parseChord(''));
  assert.throws(() => parseChord('   '));
});

test('parseChord rejects two non-modifier keys', () => {
  assert.throws(() => parseChord('Cmd+K+L'));
});

test('normalizeKey maps named tokens', () => {
  assert.equal(normalizeKey('Esc'), 'Escape');
  assert.equal(normalizeKey('Enter'), 'Enter');
  assert.equal(normalizeKey('Slash'), '/');
  assert.equal(normalizeKey('Up'), 'ArrowUp');
  assert.equal(normalizeKey('A'), 'a');
});

test('matchesChord accepts ⌘K on mac and Ctrl+K on win for the same meta binding', () => {
  const chord = parseChord('Cmd+K');
  assert.equal(matchesChord({ key: 'k', metaKey: true }, chord), true);
  assert.equal(matchesChord({ key: 'k', ctrlKey: true }, chord), true);
  assert.equal(matchesChord({ key: 'k', metaKey: true, shiftKey: true }, chord), false);
});

test('matchesChord on bare key requires no meta/ctrl', () => {
  const chord = parseChord('Escape');
  assert.equal(matchesChord({ key: 'Escape' }, chord), true);
  assert.equal(matchesChord({ key: 'Escape', metaKey: true }, chord), false);
});

test('matchesChord ctrl-only does not fire when meta is held', () => {
  const chord = parseChord('Ctrl+I');
  // Pure Ctrl matches.
  assert.equal(matchesChord({ key: 'i', ctrlKey: true }, chord), true);
  // Cmd+Ctrl+I should NOT match a ctrl-only chord on macOS.
  assert.equal(matchesChord({ key: 'i', ctrlKey: true, metaKey: true }, chord), false);
});

test('isTypingTarget recognizes inputs and contenteditable', () => {
  assert.equal(isTypingTarget({ tagName: 'INPUT' } as unknown as EventTarget), true);
  assert.equal(isTypingTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget), true);
  assert.equal(isTypingTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget), true);
  assert.equal(isTypingTarget({ tagName: 'DIV' } as unknown as EventTarget), false);
  assert.equal(isTypingTarget(null), false);
});

test('registry dispatches to the matching binding and suppresses in inputs', () => {
  const reg = createShortcutRegistry();
  let fired = 0;
  reg.register({
    id: 'cmd-k',
    label: 'Open palette',
    group: 'Navigation',
    display: '⌘K',
    chord: parseChord('Cmd+K'),
    run: () => { fired += 1; },
  });
  assert.equal(reg.dispatch({ key: 'k', metaKey: true }), true);
  assert.equal(fired, 1);
  // Same chord while typing in INPUT — suppressed by default.
  assert.equal(reg.dispatch({ key: 'k', metaKey: true, target: { tagName: 'INPUT' } as unknown as EventTarget }), false);
  assert.equal(fired, 1);
});

test('registry passes through dispatch when no binding matches', () => {
  const reg = createShortcutRegistry();
  reg.register({
    id: 'cmd-k',
    label: 'palette',
    group: 'g',
    display: '⌘K',
    chord: parseChord('Cmd+K'),
    run: () => { /* noop */ },
  });
  assert.equal(reg.dispatch({ key: 'z', metaKey: true }), false);
});

test('registry unregister removes the binding', () => {
  const reg = createShortcutRegistry();
  let fired = 0;
  reg.register({
    id: 'cmd-slash', label: 'help', group: 'g', display: '⌘/',
    chord: parseChord('Cmd+/'), run: () => { fired += 1; },
  });
  assert.equal(reg.list().length, 1);
  reg.unregister('cmd-slash');
  assert.equal(reg.list().length, 0);
  assert.equal(reg.dispatch({ key: '/', metaKey: true }), false);
  assert.equal(fired, 0);
});

test('buildPanelFocusBindings caps at 9 panels and uses 1-indexed display', () => {
  const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k']; // 11 inputs
  const calls: Array<{ key: string; idx: number }> = [];
  const bindings = buildPanelFocusBindings(keys, (key, idx) => { calls.push({ key, idx }); });
  assert.equal(bindings.length, 9);
  assert.equal(bindings[0]?.display, '⌘1');
  assert.equal(bindings[8]?.display, '⌘9');
  // Firing the 3rd binding calls the focus callback with the 3rd panel key + index 2.
  bindings[2]?.run();
  assert.deepEqual(calls, [{ key: 'c', idx: 2 }]);
});

test('buildPanelFocusBindings handles fewer than 9 panels gracefully', () => {
  const bindings = buildPanelFocusBindings(['only'], () => { /* noop */ });
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0]?.id, 'panel-focus-1');
});

test('registry suppressInTextInputs=false allows firing in inputs (e.g., Escape)', () => {
  const reg = createShortcutRegistry();
  let fired = 0;
  reg.register({
    id: 'esc', label: 'close', group: 'g', display: 'Esc',
    chord: parseChord('Escape'), run: () => { fired += 1; },
    suppressInTextInputs: false,
  });
  assert.equal(reg.dispatch({ key: 'Escape', target: { tagName: 'INPUT' } as unknown as EventTarget }), true);
  assert.equal(fired, 1);
});
