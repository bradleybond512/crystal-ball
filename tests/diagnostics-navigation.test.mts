import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { after, afterEach } from 'node:test';
import { Window } from 'happy-dom';
import ts from 'typescript';
import vm from 'node:vm';
import { buildBuiltinCommands } from '../src/services/command-palette/built-in-commands.ts';
import { PANEL_METADATA, LIBRARY_DOMAIN_LABELS } from '../src/config/panel-metadata.ts';
import { DEFAULT_PANELS } from '../src/config/panels.ts';
import { buildLibraryView } from '../src/services/home-shell/library-view.ts';
import { parseDeckPins } from '../src/services/home-shell/deck-view.ts';
import { bindGodsVisionControls } from '../src/app/gods-vision-events.ts';

const browser = new Window({ url: 'http://127.0.0.1/' });
Object.assign(globalThis, {
  window: browser, document: browser.document, HTMLElement: browser.HTMLElement,
  Element: browser.Element, CustomEvent: browser.CustomEvent,
  Node: browser.Node, CSS: browser.CSS, localStorage: browser.localStorage,
  MutationObserver: browser.MutationObserver,
  requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
  cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
});
const { installShortcuts } = await import('../src/services/keyboard/shortcut-bootstrap.ts');
const { HelpOverlay } = await import('../src/components/HelpOverlay.ts');
after(() => browser.happyDOM.abort());
const forbiddenActions: string[] = [];
for (const name of ['cb:run-self-test', 'cb:export-diagnostic-bundle', 'cb:restart-local-engine', 'cb:clear-traffic', 'cb:toggle-verbose-log']) {
  document.addEventListener(name, () => forbiddenActions.push(name));
}
afterEach(() => {
  document.body.replaceChildren();
  assert.deepEqual(forbiddenActions.splice(0), [], 'navigation never triggers privileged or diagnostic actions');
});
const source = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
function methods(file, className, names, globals = {}) {
  const parsed = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true);
  const declaration = parsed.statements.find((entry) => ts.isClassDeclaration(entry) && entry.name?.text === className);
  const members = names.map((name) => {
    const method = declaration.members.find((entry) => entry.name?.getText(parsed) === name);
    assert.ok(method, `${className}.${name} exists`); return method.getText(parsed);
  });
  return vm.runInNewContext(ts.transpileModule(`class Subject { ${members.join('\n')} }; Subject.prototype;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, { document, CustomEvent, HTMLElement, ...globals });
}

test('Diagnostics port reaches the existing panel before Home exists and visibly respects disabled/unavailable panels', async () => {
  const toasts = [];
  const prototype = methods('src/app/panel-layout.ts', 'PanelLayoutManager', ['openDiagnostics', 'navigateToPanel'], {
    DEFAULT_PANELS, showToast: (toast) => toasts.push(toast), flashPanelHighlight: () => {},
  });
  let mounts = 0; let scrolls = 0;
  const element = document.createElement('section'); document.body.append(element);
  Object.defineProperty(element, 'offsetParent', { get: () => document.body });
  element.scrollIntoView = () => scrolls++;
  const panel = { getElement: () => element };
  const enabled = { enabled: true };
  const subject = Object.assign(Object.create(prototype), {
    homeShell: null, ctx: { panels: { 'system-diagnostic': panel }, panelSettings: { 'system-diagnostic': enabled } },
    mountLazyPanel: async () => { mounts++; return null; },
  });
  subject.openDiagnostics(); await Promise.resolve();
  subject.openDiagnostics(); await Promise.resolve();
  assert.deepEqual([scrolls, mounts, toasts.length], [2, 0, 0], 'same mounted panel is reused');
  delete subject.ctx.panels['system-diagnostic']; enabled.enabled = false;
  subject.openDiagnostics(); await Promise.resolve();
  assert.equal(mounts, 0, 'navigation never enables or constructs a disabled panel');
  assert.match(toasts.at(-1).title, /turned off/);
  enabled.enabled = true;
  subject.openDiagnostics(); await new Promise((done) => setTimeout(done, 0));
  assert.equal(mounts, 1); assert.match(toasts.at(-1).message, /unavailable/);
  assert.deepEqual(enabled, { enabled: true });
});

test('visible Home receives the same Diagnostics ID; hidden Home uses classic navigation', () => {
  const prototype = methods('src/app/panel-layout.ts', 'PanelLayoutManager', ['openDiagnostics']);
  const calls = [];
  const listener = (event) => calls.push(['home', event.detail.panelKey]);
  document.addEventListener('cb:open-panel', listener);
  try {
    let visible = true;
    const subject = Object.assign(Object.create(prototype), {
      homeShell: { isVisible: () => visible }, navigateToPanel: (id) => calls.push(['classic', id]),
    });
    subject.openDiagnostics(); visible = false; subject.openDiagnostics();
    assert.deepEqual(calls, [['home', 'system-diagnostic'], ['classic', 'system-diagnostic']]);
  } finally { document.removeEventListener('cb:open-panel', listener); }
});

test('actual navigation owner reinstall/destroy leaves one Diagnostics listener and one registry-backed Help', () => {
  let navigations = 0;
  const prototype = methods('src/app/panel-layout.ts', 'PanelLayoutManager', [
    'openDiagnostics', 'installNavigationShortcuts', 'destroyNavigationShortcuts',
  ], { installShortcuts, HelpOverlay, getMode: () => null, setMode: () => assert.fail('navigation changed Ghost mode') });
  const subject = Object.assign(Object.create(prototype), {
    ctx: { isDesktopApp: false }, homeShell: null,
    navigateToPanel: (id) => { assert.equal(id, 'system-diagnostic'); navigations++; },
  });
  try {
    subject.installNavigationShortcuts();
    document.dispatchEvent(new CustomEvent('cb:open-diagnostics'));
    subject.installNavigationShortcuts();
    document.dispatchEvent(new CustomEvent('cb:open-diagnostics'));
    assert.equal(navigations, 2);
    assert.equal(document.querySelectorAll('.help-overlay').length, 1);
    document.dispatchEvent(new CustomEvent('cb:toggle-help'));
    assert.equal(document.querySelector<HTMLElement>('.help-overlay').hidden, false);
    subject.destroyNavigationShortcuts();
    document.dispatchEvent(new CustomEvent('cb:open-diagnostics'));
    document.dispatchEvent(new CustomEvent('cb:toggle-help'));
    assert.equal(navigations, 2);
    assert.equal(document.querySelector('.help-overlay') === null, true);
  } finally { subject.destroyNavigationShortcuts(); }
});

test('isolated panel boot installs the real globe shortcut and releases its owned listener', () => {
  class IsolatedPanel {
    private readonly element = document.createElement('section');
    getElement(): HTMLElement { return this.element; }
  }
  const prototype = methods('src/app/panel-layout.ts', 'PanelLayoutManager', [
    'createPanels', 'installNavigationShortcuts', 'destroyNavigationShortcuts',
  ], {
    LiveWebcamsPanel: IsolatedPanel, UnifiedWebcamPanel: IsolatedPanel, PinnedWebcamsPanel: IsolatedPanel,
    installShortcuts, HelpOverlay, getMode: () => null,
    setMode: () => assert.fail('globe shortcut changed Ghost mode'),
  });
  document.body.innerHTML = '<div id="panelsGrid"></div>';
  const leaves: string[] = [];
  const subject = Object.assign(Object.create(prototype), {
    isolatedPanelKeys: ['live-webcams', 'unified-webcams', 'pinned-webcams'],
    ctx: { isDesktopApp: false, panels: {} },
    mountAlertShelf: () => leaves.push('alerts'),
    bindSidebarNavigation: () => leaves.push('sidebar'),
    openDiagnostics: () => assert.fail('globe shortcut opened Diagnostics'),
  });
  let globeActions = 0;
  const releaseControls = bindGodsVisionControls(document, () => { globeActions++; });
  try {
    subject.createPanels();
    const key = new browser.KeyboardEvent('keydown', { key: 'g', bubbles: true, cancelable: true });
    document.body.dispatchEvent(key);
    assert.equal(globeActions, 1, 'isolated boot must route G through the actual globe action owner once');
    assert.equal(key.defaultPrevented, true);
    assert.deepEqual(leaves, ['alerts', 'sidebar']);
    assert.deepEqual(Object.keys(subject.ctx.panels), ['live-webcams', 'unified-webcams', 'pinned-webcams']);
    assert.equal(document.querySelectorAll('#panelsGrid > section').length, 3);
    assert.equal(document.querySelectorAll('.help-overlay').length, 1);
    subject.destroyNavigationShortcuts();
    const afterDestroy = new browser.KeyboardEvent('keydown', { key: 'g', bubbles: true, cancelable: true });
    document.body.dispatchEvent(afterDestroy);
    assert.equal(globeActions, 1, 'owned teardown must remove the isolated boot shortcut');
    assert.equal(afterDestroy.defaultPrevented, false);
    assert.equal(document.querySelector('.help-overlay') === null, true);
  } finally {
    subject.destroyNavigationShortcuts();
    releaseControls();
  }
});

test('registry primary Ghost restores the prior mode while the actual desktop alias retains legacy clearing', () => {
  const exports = {};
  const compiled = ts.transpileModule(source('src/services/mode-manager.ts'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function('require', 'exports', compiled)((id) => {
    assert.equal(id, '@/services/comms-plan'); return { buildPrimaryCommsMessage: () => assert.fail('no clipboard action') };
  }, exports);
  const mode = exports as typeof import('../src/services/mode-manager.ts');
  const prototype = methods('src/app/panel-layout.ts', 'PanelLayoutManager', [
    'openDiagnostics', 'installNavigationShortcuts', 'destroyNavigationShortcuts',
  ], { installShortcuts, HelpOverlay, getMode: mode.getMode, setMode: mode.setMode });
  const subject = Object.assign(Object.create(prototype), { ctx: { isDesktopApp: true }, homeShell: null });
  const primary = () => mode.toggleGhostMode();
  document.addEventListener('wm:toggle-ghost-mode', primary);
  const button = document.createElement('button'); document.body.append(button); button.focus();
  const key = (init) => button.dispatchEvent(new browser.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  try {
    subject.installNavigationShortcuts(); mode.setMode('gods-vision');
    key({ key: 'G', metaKey: true, shiftKey: true });
    assert.equal(mode.getMode(), 'ghost'); assert.equal(mode.getGhostRefreshMultiplier(), 5);
    key({ key: 'G', ctrlKey: true, shiftKey: true }); assert.equal(mode.getMode(), 'gods-vision');
    key({ key: 'm', metaKey: true }); assert.equal(mode.getMode(), 'ghost');
    key({ key: 'm', metaKey: true }); assert.equal(mode.getMode(), null);
  } finally {
    subject.destroyNavigationShortcuts(); document.removeEventListener('wm:toggle-ghost-mode', primary);
  }
});

test('nested Home Diagnostics button dispatches only the navigation intent', () => {
  assert.match(source('src/components/HomeShellOverlay.ts'), /button\('home-shell-diagnostics', 'diagnostics', 'Diagnostics'\)/);
  const prototype = methods('src/components/HomeShellOverlay.ts', 'HomeShellOverlay', ['onClick']);
  const target = document.createElement('span');
  const button = document.createElement('button'); button.dataset.action = 'diagnostics'; button.append(target);
  const events = [];
  const listener = () => events.push('diagnostics');
  document.addEventListener('cb:open-diagnostics', listener);
  try { prototype.onClick.call({}, { target }); } finally { document.removeEventListener('cb:open-diagnostics', listener); }
  assert.deepEqual(events, ['diagnostics']);
});

test('live palette Diagnostics/HUD/Ghost/globe commands dispatch the existing action intents only', () => {
  const calls = [];
  const commands = buildBuiltinCommands({ dispatch: (event, detail) => calls.push([event, detail]), panels: DEFAULT_PANELS });
  const expected = [
    ['navigation:diagnostics', 'Open Diagnostics', 'cb:open-diagnostics'],
    ['action:toggle-analyst-hud', 'Toggle Analyst HUD', 'cb:toggle-analyst-hud'],
    ['action:toggle-ghost-mode', 'Toggle Ghost Mode', 'wm:toggle-ghost-mode'],
    ['nav:gods-vision', "Go to God's Vision", 'cb:toggle-gods-vision'],
  ];
  for (const [id, title, event] of expected) {
    const command = commands.find((entry) => entry.id === id);
    assert.ok(command, id); assert.equal(command.title, title); command.action();
    assert.deepEqual(calls.at(-1), [event, undefined]);
  }
  assert.ok(commands.find((entry) => entry.id === 'nav:gods-vision').keywords.includes("god's eye"));
  assert.equal(calls.length, 4);
  assert.ok(calls.every(([event]) => !/self-test|export|restart|debug|clear/.test(event)));
});

test('actual Library projection keeps specialists in More/search and their direct panel commands', () => {
  const inputs = { metadata: PANEL_METADATA, names: DEFAULT_PANELS, domainLabels: LIBRARY_DOMAIN_LABELS };
  const before = JSON.stringify(DEFAULT_PANELS);
  const view = buildLibraryView(inputs, '');
  const system = view.domains.find((domain) => domain.domain === 'system-health');
  assert.deepEqual(system.featured.map(({ panelId }) => panelId).sort(), ['source-confidence', 'system-diagnostic']);
  const calls = [];
  const commands = buildBuiltinCommands({ dispatch: (name, detail) => calls.push([name, detail]), panels: DEFAULT_PANELS });
  for (const panelId of ['algorithm-diagnostic', 'feed-health', 'self-test']) {
    assert.ok(PANEL_METADATA[panelId]);
    assert.ok(system.rest.some((panel) => panel.panelId === panelId), `${panelId} in More`);
    const result = buildLibraryView(inputs, panelId).domains.find((domain) => domain.domain === 'system-health');
    assert.ok(result.rest.some((panel) => panel.panelId === panelId), `${panelId} searchable`);
    commands.find((command) => command.id === `panel:${panelId}`).action();
    assert.deepEqual(calls.at(-1), ['cb:navigate-panel', { panelKey: panelId }]);
  }
  assert.equal(JSON.stringify(DEFAULT_PANELS), before, 'projection and commands preserve enable state');
  const pins = ['self-test', 'feed-health', 'algorithm-diagnostic'];
  assert.deepEqual(parseDeckPins(JSON.stringify(pins), new Set(Object.keys(DEFAULT_PANELS))), pins, 'existing specialist pins survive');
});

test('navigation listener, shortcut handles and Help have explicit teardown owners and old key owners are absent', () => {
  const layout = source('src/app/panel-layout.ts');
  const handlers = source('src/app/event-handlers.ts');
  assert.match(layout, /addEventListener\('cb:open-diagnostics', this\._onOpenDiagnostics\)/);
  assert.match(layout, /removeEventListener\('cb:open-diagnostics', this\._onOpenDiagnostics\)/);
  assert.match(layout, /removeEventListener\('cb:toggle-help', this\._onHelpToggle\)/);
  assert.match(layout, /this\.shortcuts\?\.destroy\(\)/);
  assert.match(layout, /this\.helpOverlay\?\.destroy\(\)/);
  assert.doesNotMatch(layout, /_onAnalystHudKey/);
  assert.doesNotMatch(handlers, /toggleGhostMode|e\.key === 'g'.*!e\.ctrlKey|e\.key === 'G'.*!e\.altKey/);
  assert.match(layout, /toggleLegacyGhost:\s*\(\) => setMode\(getMode\(\) === 'ghost' \? null : 'ghost'\)/);
});

test('the actual layout opts into deferred builtins while its live pending or failed palette blocks background feature keys', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { CommandPalettePanel } = await import('../src/components/CommandPalettePanel.ts');
  const catalog = await import('../src/services/command-palette/built-in-commands.ts');
  let reject!: (error: Error) => void;
  let loads = 0;
  const pending = new Promise<typeof catalog>((_resolve, onReject) => { reject = onReject; });
  class OwnedPalette extends CommandPalettePanel {
    protected override loadBuiltinCatalog(): Promise<typeof catalog> { loads++; return pending; }
  }
  const file = 'src/app/panel-layout.ts';
  const parsed = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true);
  const owner = parsed.statements.find((entry) => ts.isClassDeclaration(entry) && entry.name?.text === 'PanelLayoutManager') as ts.ClassDeclaration | undefined;
  assert.ok(owner);
  const create = owner.members.find((entry) => entry.name?.getText(parsed) === 'createPanels') as ts.MethodDeclaration;
  const assignments = create.body!.statements.filter((entry) => ts.isExpressionStatement(entry)
    && ts.isBinaryExpression(entry.expression) && ts.isNewExpression(entry.expression.right)
    && entry.expression.right.expression.getText(parsed) === 'CommandPalettePanel');
  assert.equal(assignments.length, 1, 'test executes the actual single palette constructor site');
  const subject: { cmdkPanel?: InstanceType<typeof OwnedPalette> } = {};
  vm.runInNewContext(ts.transpileModule(`function install() { ${assignments[0]!.getText(parsed)} }; install.call(subject);`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, { subject, CommandPalettePanel: OwnedPalette });
  const panel = subject.cmdkPanel!;
  t.after(() => panel.unmount());
  panel.mount(document.body);
  assert.equal(loads, 0);
  panel.show();
  assert.equal(loads, 1, 'the actual owner opts into first-show catalog loading');
  assert.equal(panel.element().hidden, false);
  assert.equal(panel.element().getAttribute('aria-busy'), 'true');
  assert.equal(create.body!.statements.some((entry) => ts.isExpressionStatement(entry)
    && ts.isCallExpression(entry.expression) && entry.expression.expression.getText(parsed) === 'registerBuiltinCommands'), false,
  'the owner does not seed the builtin factory at boot');
  const calls: string[] = [];
  const listeners = ['cb:toggle-analyst-hud', 'wm:toggle-ghost-mode', 'cb:toggle-gods-vision'].map((name) => {
    const listener = () => calls.push(name);
    document.addEventListener(name, listener);
    return () => document.removeEventListener(name, listener);
  });
  const handles = installShortcuts();
  try {
    for (const phase of ['pending', 'failed']) {
      for (const init of [{ key: 'g' }, { key: 'G', metaKey: true, shiftKey: true }, { key: 'A', metaKey: true, shiftKey: true }]) {
        document.body.dispatchEvent(new browser.KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true }));
      }
      assert.deepEqual(calls, [], `${phase}: the real visible palette claims foreground before and after input focus`);
      if (phase === 'pending') {
        reject(new Error('Synthetic catalog rejection'));
        await assert.rejects(pending, /Synthetic catalog rejection/);
        await Promise.resolve();
      }
    }
    const status = panel.element().querySelector('[role="status"]');
    assert.equal(status !== null, true, 'failed catalog keeps its foreground status visible');
    assert.match(status!.textContent!, /Commands unavailable/);
  } finally { handles.destroy(); listeners.forEach((remove) => remove()); }
});
