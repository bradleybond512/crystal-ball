import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCommandRegistry,
  type PaletteCommand,
} from '../command-registry.ts';
import { buildBuiltinCommands } from '../built-in-commands.ts';

function noop(): void { /* no-op */ }

function cmd(partial: Partial<PaletteCommand> & Pick<PaletteCommand, 'id' | 'title' | 'category'>): PaletteCommand {
  return {
    keywords: [],
    action: noop,
    ...partial,
  };
}

test('register + getAll + getByCategory round-trips a command', () => {
  const reg = createCommandRegistry();
  reg.register(cmd({ id: 'a', title: 'Alpha', category: 'action', keywords: ['one'] }));
  reg.register(cmd({ id: 'p', title: 'Pulse', category: 'panel' }));
  assert.equal(reg.getAll().length, 2);
  assert.equal(reg.getByCategory('action').length, 1);
  assert.equal(reg.getByCategory('panel').length, 1);
  assert.equal(reg.getByCategory('action')[0]!.id, 'a');
});

test('register with same id overwrites', () => {
  const reg = createCommandRegistry();
  reg.register(cmd({ id: 'x', title: 'First', category: 'action' }));
  reg.register(cmd({ id: 'x', title: 'Second', category: 'action' }));
  const all = reg.getAll();
  assert.equal(all.length, 1);
  assert.equal(all[0]!.title, 'Second');
});

test('unregister removes a command', () => {
  const reg = createCommandRegistry();
  reg.register(cmd({ id: 'x', title: 'X', category: 'action' }));
  reg.unregister('x');
  assert.equal(reg.getAll().length, 0);
});

test('clear empties the registry', () => {
  const reg = createCommandRegistry();
  reg.register(cmd({ id: 'a', title: 'A', category: 'action' }));
  reg.register(cmd({ id: 'b', title: 'B', category: 'action' }));
  reg.clear();
  assert.equal(reg.getAll().length, 0);
});

test('search with empty query returns commands by category weight', () => {
  const reg = createCommandRegistry();
  reg.register(cmd({ id: 's', title: 'Search alerts', category: 'search' }));
  reg.register(cmd({ id: 'a', title: 'Run probe', category: 'action' }));
  reg.register(cmd({ id: 'p', title: 'Open Map', category: 'panel' }));
  const out = reg.search('');
  // action (3) > navigation (2.5) > panel (2) > search (1)
  assert.equal(out[0]!.command.category, 'action');
  assert.equal(out[out.length - 1]!.command.category, 'search');
});

test('search matches by title prefix', () => {
  const reg = createCommandRegistry();
  reg.register(cmd({ id: 'a', title: 'Markets feed',  category: 'panel' }));
  reg.register(cmd({ id: 'b', title: 'Network Markets', category: 'panel' }));
  const out = reg.search('mark', 8);
  assert.equal(out.length, 2);
  // Prefix-match scores PREFIX_BONUS = 12, mid-string match is much smaller.
  assert.equal(out[0]!.command.id, 'a');
});

test('search matches by keyword when title does not contain query', () => {
  const reg = createCommandRegistry();
  reg.register(cmd({ id: 'q', title: 'Run Self-Test', category: 'action', keywords: ['diagnostic', 'health'] }));
  const out = reg.search('diag', 8);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.command.id, 'q');
});

test('search matches by subtitle', () => {
  const reg = createCommandRegistry();
  reg.register(cmd({ id: 'q', title: 'Open ABC', subtitle: 'Run the full probe', category: 'action' }));
  const out = reg.search('probe', 8);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.command.id, 'q');
});

test('search filters out commands with no match', () => {
  const reg = createCommandRegistry();
  reg.register(cmd({ id: 'a', title: 'Alpha', category: 'action' }));
  reg.register(cmd({ id: 'b', title: 'Beta', category: 'action' }));
  const out = reg.search('zzz');
  assert.equal(out.length, 0);
});

test('search respects the limit', () => {
  const reg = createCommandRegistry();
  for (let i = 0; i < 20; i++) {
    reg.register(cmd({ id: `c${i}`, title: `Open Panel ${i}`, category: 'panel' }));
  }
  const out = reg.search('panel', 5);
  assert.equal(out.length, 5);
});

test('keywords are lowercased on registration', () => {
  const reg = createCommandRegistry();
  reg.register(cmd({ id: 'a', title: 'Alpha', category: 'action', keywords: ['DIAGNOSTIC', '  Probe  '] }));
  // Should still match a lowercase query because keywords are lowercased and trimmed
  assert.equal(reg.search('diagnostic').length, 1);
  assert.equal(reg.search('probe').length, 1);
});

test('action() is the same reference returned via search', () => {
  let calls = 0;
  const reg = createCommandRegistry();
  reg.register(cmd({ id: 'a', title: 'Run', category: 'action', action: () => { calls += 1; } }));
  const [hit] = reg.search('run');
  hit!.command.action();
  assert.equal(calls, 1);
});

test('search tie-breaks by alphabetical title at equal score', () => {
  const reg = createCommandRegistry();
  reg.register(cmd({ id: 'a', title: 'Zeta', category: 'action' }));
  reg.register(cmd({ id: 'b', title: 'Alpha', category: 'action' }));
  const out = reg.search('');
  assert.equal(out[0]!.command.title, 'Alpha');
});

test('buildBuiltinCommands wires panel commands from the panels map', () => {
  const dispatched: { name: string; detail?: unknown }[] = [];
  const cmds = buildBuiltinCommands({
    dispatch: (name, detail) => dispatched.push({ name, detail }),
    panels: { markets: { name: 'Markets' }, map: { name: 'Global Map' } },
  });
  const panelCmds = cmds.filter(c => c.category === 'panel');
  assert.equal(panelCmds.length, 2);
  assert.ok(panelCmds.some(c => c.id === 'panel:markets' && c.title === 'Open Markets'));
  assert.ok(panelCmds.some(c => c.id === 'panel:map' && c.title === 'Open Global Map'));
});

test('buildBuiltinCommands includes navigation, action, and search commands', () => {
  const cmds = buildBuiltinCommands({ dispatch: () => {}, panels: {} });
  const cats = new Set(cmds.map(c => c.category));
  assert.ok(cats.has('navigation'));
  assert.ok(cats.has('action'));
  assert.ok(cats.has('search'));
  // Specific required commands per the spec
  assert.ok(cmds.some(c => c.title === 'Run Self-Test'));
  assert.ok(cmds.some(c => c.title === 'Export Diagnostic Bundle'));
  assert.ok(cmds.some(c => c.title === 'Toggle Operator Mode'));
  assert.ok(cmds.some(c => c.title === 'Clear Notifications'));
  assert.ok(cmds.some(c => c.title === 'Go to Command Center'));
  assert.ok(cmds.some(c => c.title === 'Go to Globe'));
  assert.ok(cmds.some(c => c.title === 'Go to Map'));
  assert.ok(cmds.some(c => c.title === 'Go to Intelligence Feed'));
});

test('built-in action commands dispatch the expected events', () => {
  const dispatched: { name: string; detail?: unknown }[] = [];
  const cmds = buildBuiltinCommands({
    dispatch: (name, detail) => dispatched.push({ name, detail }),
    panels: {},
  });
  const selfTest = cmds.find(c => c.title === 'Run Self-Test');
  assert.ok(selfTest);
  selfTest.action();
  assert.deepEqual(dispatched.at(-1), { name: 'cb:run-self-test', detail: undefined });

  const clear = cmds.find(c => c.title === 'Clear Notifications');
  assert.ok(clear);
  clear.action();
  assert.deepEqual(dispatched.at(-1), { name: 'cb:clear-notifications', detail: undefined });
});

test('built-in panel commands dispatch cb:navigate-panel with panelKey detail', () => {
  const dispatched: { name: string; detail?: unknown }[] = [];
  const cmds = buildBuiltinCommands({
    dispatch: (name, detail) => dispatched.push({ name, detail }),
    panels: { 'intelligence-feed': { name: 'Intel Feed' } },
  });
  const panelCmd = cmds.find(c => c.id === 'panel:intelligence-feed');
  assert.ok(panelCmd);
  panelCmd.action();
  assert.deepEqual(dispatched.at(-1), { name: 'cb:navigate-panel', detail: { panelKey: 'intelligence-feed' } });
});

test('built-in search commands dispatch cb:palette-search-scope with the scope', () => {
  const dispatched: { name: string; detail?: unknown }[] = [];
  const cmds = buildBuiltinCommands({
    dispatch: (name, detail) => dispatched.push({ name, detail }),
    panels: {},
  });
  const alerts = cmds.find(c => c.id === 'search:search-alerts');
  assert.ok(alerts);
  alerts.action();
  assert.deepEqual(dispatched.at(-1), { name: 'cb:palette-search-scope', detail: { scope: 'alerts' } });
});

test('search ranks navigation > panel when tied on raw match', () => {
  const reg = createCommandRegistry();
  reg.register(cmd({ id: 'p', title: 'Open Globe', category: 'panel' }));
  reg.register(cmd({ id: 'n', title: 'Go to Globe', category: 'navigation' }));
  const out = reg.search('globe');
  // navigation (2.5) beats panel (2) at equal raw match
  assert.equal(out[0]!.command.category, 'navigation');
});

test('negative weight demotes a command below an otherwise-equal match', () => {
  const reg = createCommandRegistry();
  reg.register({ id: 'panel:a', title: 'Alpha Feed', keywords: ['feed'], category: 'panel', action: () => {} });
  reg.register({ id: 'panel:b', title: 'Alpha Feed Diagnostics', keywords: ['feed'], category: 'panel', weight: -1.5, action: () => {} });
  const results = reg.search('feed', 8);
  const ids = results.map((r) => r.command.id);
  assert.ok(ids.indexOf('panel:a') < ids.indexOf('panel:b'), `expected a before b, got ${ids.join(',')}`);
});
