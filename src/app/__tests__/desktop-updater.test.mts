import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';
import ts from 'typescript';
import type { AppContext } from '../app-context.ts';
import { escapeHtml } from '../../utils/sanitize.ts';

const compiled = ts.transpileModule(readFileSync(new URL('../desktop-updater.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const checkedAt = 1_790_000_000_000;
const releasePage = 'https://github.com/bradleybond512/crystal-ball/releases/tag/v9.2.0';

function harness(result: unknown = { status: 'ready', version: '9.2.0', checkedAt }) {
  const browser = new Window({ url: 'http://127.0.0.1/' });
  const calls: Array<{ command: string; payload?: Record<string, unknown> }> = [];
  const ctx = { isDesktopApp: true, isDestroyed: false, updateState: null } as AppContext;
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  let fetches = 0;
  let response = result;
  const invoke = async (command: string, payload?: Record<string, unknown>) => {
    calls.push({ command, payload });
    if (command === 'staged_update_status') throw new Error('Unsupported command');
    if (command === 'stage_latest_update' || command === 'stage_update') {
      if (response instanceof Error) throw response;
      return response;
    }
    if (command === 'apply_staged_update' && response instanceof Error) throw response;
    return null;
  };
  const dependencies: Record<string, unknown> = {
    '@/services/tauri-bridge': { invokeTauri: invoke, tryInvokeTauri: invoke },
    // R4-BUG-002: native notifications go through the single notifyNative entry
    // point; record them under the native command name the assertions expect.
    '@/services/native-notify': {
      notifyNative: async (payload: Record<string, unknown>) => {
        calls.push({ command: 'send_notification', payload });
        return 'delivered';
      },
    },
    '@/services/analytics': { trackUpdateShown() {}, trackUpdateClicked() {}, trackUpdateDismissed() {} },
    '@/utils/sanitize': { escapeHtml },
  };
  const exports: Record<string, unknown> = {};
  runInNewContext(compiled, {
    exports, require: (id: string) => { assert.ok(id in dependencies, id); return dependencies[id]; },
    __APP_VERSION__: '9.1.0', window: browser, document: browser.document, localStorage: browser.localStorage,
    AbortSignal, Error, CustomEvent: browser.CustomEvent, console: { info() {}, warn() {} },
    requestAnimationFrame: (callback: () => void) => { callback(); return 1; },
    setTimeout: (callback: () => void) => { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout: (id: number) => timers.delete(id),
    setInterval: () => ++nextTimer, clearInterval() {},
    fetch: async (url: string) => {
      fetches++;
      return { ok: true, json: async () => url.endsWith('release-manifest.json')
        ? { assets: [{ name: 'Crystal.Ball_9.2.0_aarch64.dmg', sha256: 'a'.repeat(64) }] }
        : { tag_name: 'v9.2.0', assets: [
          { name: 'Crystal.Ball_9.2.0_aarch64.dmg', browser_download_url: `${releasePage}/Crystal.Ball_9.2.0_aarch64.dmg` },
          { name: 'release-manifest.json', browser_download_url: `${releasePage}/release-manifest.json` },
        ] } };
    },
  });
  const Updater = exports.DesktopUpdater as typeof import('../desktop-updater.ts').DesktopUpdater;
  const updater = new Updater(ctx);
  return {
    browser, calls, ctx, updater,
    check: (manual = true) => (updater as unknown as { checkForUpdate(manual: boolean): Promise<void> }).checkForUpdate(manual),
    respond: (next: unknown) => { response = next; },
    fetches: () => fetches,
    flushTimers: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); },
  };
}

test('native staging owns the version and readiness; renderer sends no selection arguments or fetches', async () => {
  const h = harness();
  await h.check();
  assert.equal(h.fetches(), 0);
  assert.equal(h.calls[0]?.command, 'stage_latest_update');
  assert.equal(h.calls[0]?.payload, undefined);
  assert.equal(h.ctx.updateState?.phase, 'ready');
  assert.equal(h.ctx.updateState?.version, '9.2.0');
  assert.equal(h.ctx.updateState?.lastCheckedAt, checkedAt);
  assert.match(h.browser.document.body.textContent, /9\.1\.0 → v9\.2\.0/);
  assert.match(String(h.calls.find(call => call.command === 'send_notification')?.payload?.body), /9\.2\.0/);
  assert.equal(h.browser.localStorage.getItem('wm-update-notified-9.2.0'), '1');
});

test('native failure cannot promote a forged localStorage staging hint or stale ready toast', async () => {
  const h = harness();
  await h.check();
  h.browser.localStorage.setItem('wm-update-staged-9.2.0', '1');
  h.respond(new Error('Unavailable'));
  await h.check();
  assert.equal(h.ctx.updateState, null);
  assert.equal(Boolean(h.browser.document.querySelector('[data-action="apply"]')), false);
  assert.match(h.browser.document.body.textContent, /Could not check for updates/);
  assert.equal(h.calls.filter(call => call.command === 'stage_latest_update').length, 2);
});

test('up-to-date result uses the native current version and check timestamp', async () => {
  const h = harness({ status: 'up_to_date', currentVersion: '9.3.0', checkedAt });
  await h.check();
  assert.equal(h.ctx.updateState?.phase, 'up-to-date');
  assert.equal(h.ctx.updateState?.lastCheckedAt, checkedAt);
  assert.match(h.browser.document.body.textContent, /9\.3\.0 is the latest/);
  assert.equal(h.calls.some(call => call.command === 'send_notification'), false);
});

test('ready dismissal and notification suppression follow the native version; manual check reopens it', async () => {
  const h = harness();
  await h.check();
  const dismiss = h.browser.document.querySelector<HTMLButtonElement>('[data-action="dismiss"]')!;
  dismiss.focus();
  assert.equal(h.browser.document.activeElement, dismiss);
  assert.equal(dismiss.tagName, 'BUTTON');
  dismiss.click();
  h.flushTimers();
  assert.equal(h.browser.localStorage.getItem('wm-update-dismissed-9.2.0'), '1');
  await h.check(false);
  assert.equal(Boolean(h.browser.document.querySelector('[data-action="apply"]')), false);
  await h.check(true);
  assert.ok(h.browser.document.querySelector('[data-action="apply"]'));
  assert.equal(h.calls.filter(call => call.command === 'send_notification').length, 1);
});

test('browser-only native outcome offers the canonical release page and never apply', async () => {
  const h = harness({ status: 'browser_download', version: '9.2.0', downloadUrl: releasePage, reason: 'no_signer_pin', checkedAt });
  await h.check();
  assert.equal(h.ctx.updateState?.phase, 'available');
  assert.equal(Boolean(h.browser.document.querySelector('[data-action="apply"]')), false);
  const button = h.browser.document.querySelector<HTMLButtonElement>('[data-action="install"]')!;
  button.focus();
  assert.equal(h.browser.document.activeElement, button);
  button.click();
  await Promise.resolve();
  assert.equal(h.calls.find(call => call.command === 'open_url')?.payload?.url, releasePage);
  assert.equal(h.calls.some(call => call.command === 'stage_update' || call.command === 'apply_staged_update'), false);
});

for (const result of [
  null, {}, { status: 'unknown', version: '9.2.0', checkedAt },
  { status: 'ready', version: '', checkedAt },
  { status: 'ready', version: '<img src=x>', checkedAt },
  { status: 'ready', version: '9.2.0', checkedAt: 'yesterday' },
  { status: 'ready', version: '9.2.0', checkedAt: -1 },
  { status: 'up_to_date', checkedAt },
  { status: 'browser_download', version: '9.2.0', downloadUrl: 'https://evil.example/update.dmg', reason: 'no_signer_pin', checkedAt },
  { status: 'browser_download', version: '9.2.0', downloadUrl: `${releasePage}?redirect=evil`, reason: 'no_signer_pin', checkedAt },
  { status: 'browser_download', version: '9.2.0', downloadUrl: releasePage, reason: 'unexpected', checkedAt },
]) {
  test(`malformed native result fails closed: ${JSON.stringify(result)}`, async () => {
    const h = harness(result);
    await h.check();
    assert.equal(h.ctx.updateState, null);
    assert.equal(h.calls.some(call => call.command === 'send_notification'), false);
    assert.equal(Boolean(h.browser.document.querySelector('[data-action="apply"], [data-action="install"]')), false);
    assert.match(h.browser.document.body.textContent, /Could not check for updates/);
  });
}

test('pending native work stays checking and completion after destroy cannot show readiness', async () => {
  let resolve!: (value: unknown) => void;
  const h = harness(new Promise(res => { resolve = res; }));
  const pending = h.check();
  assert.equal(h.ctx.updateState?.phase, 'checking');
  h.ctx.isDestroyed = true;
  h.updater.destroy();
  resolve({ status: 'ready', version: '9.2.0', checkedAt });
  await pending;
  assert.equal(Boolean(h.browser.document.querySelector('[data-action="apply"]')), false);
  assert.equal(h.calls.some(call => call.command === 'send_notification'), false);
});

test('web builds cannot initiate native staging', async () => {
  const h = harness();
  h.ctx.isDesktopApp = false;
  await h.check();
  assert.equal(h.calls.length, 0);
  assert.equal(h.fetches(), 0);
  assert.equal(h.ctx.updateState, null);
});

test('browser fallback clears an earlier ready prompt even when that version was dismissed', async () => {
  const h = harness();
  h.browser.localStorage.setItem('wm-update-dismissed-9.2.0', '1');
  await h.check(true);
  assert.ok(h.browser.document.querySelector('[data-action="apply"]'));
  h.respond({ status: 'browser_download', version: '9.2.0', downloadUrl: releasePage, reason: 'signer_mismatch', checkedAt });
  await h.check(false);
  assert.equal(h.ctx.updateState?.phase, 'available');
  assert.equal(Boolean(h.browser.document.querySelector('[data-action="apply"]')), false);
  await h.check(true);
  assert.ok(h.browser.document.querySelector('[data-action="install"]'));
});

test('concurrent focus/manual checks share the native operation and preserve manual feedback', async () => {
  let resolve!: (value: unknown) => void;
  const h = harness(new Promise(res => { resolve = res; }));
  const pending = h.check(false);
  const manual = h.check(true);
  assert.equal(h.calls.filter(call => call.command === 'stage_latest_update').length, 1);
  resolve({ status: 'up_to_date', currentVersion: '9.1.0', checkedAt });
  await Promise.all([pending, manual]);
  assert.match(h.browser.document.body.textContent, /9\.1\.0 is the latest/);
});

test('failed apply removes ready actions and asks for a fresh native check', async () => {
  const h = harness();
  await h.check();
  h.respond(new Error('Revalidation rejected'));
  const button = h.browser.document.querySelector<HTMLButtonElement>('[data-action="apply"]')!;
  button.click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.ctx.updateState, null);
  assert.equal(Boolean(h.browser.document.querySelector('[data-action="apply"]')), false);
  assert.match(h.browser.document.body.textContent, /Check for updates to try again/);
});

test('sidebar apply rejection clears shared ready state, toast and button, then allows a fresh check', async () => {
  const h = harness();
  await h.check();
  const layoutSource = ts.createSourceFile('panel-layout.ts', readFileSync(new URL('../panel-layout.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const layoutClass = layoutSource.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'PanelLayoutManager') as ts.ClassDeclaration;
  const render = layoutClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(layoutSource) === 'renderSidebarUpdateBtn');
  assert.ok(render);
  const htmlSource = ts.createSourceFile('html.ts', readFileSync(new URL('../layout/html.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const builders = ['formatCheckedAgo', 'buildSidebarUpdateBtnHtml'].map(name => {
    const node = htmlSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(node);
    return node.getText(htmlSource);
  }).join('\n');
  const sidebarCode = ts.transpileModule(`${builders}\nexport class Sidebar {
    constructor(public ctx: unknown) {}
    buildSidebarUpdateBtnHtml() { return buildSidebarUpdateBtnHtml(this.ctx); }
    ${render.getText(layoutSource)}
  }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, unknown> = {};
  runInNewContext(sidebarCode, {
    exports, document: h.browser.document, window: h.browser,
    localStorage: h.browser.localStorage, CustomEvent: h.browser.CustomEvent,
    __APP_VERSION__: '9.1.0', BETA_MODE: false, escapeHtml,
    invokeTauri: async (command: string) => {
      h.calls.push({ command });
      throw new Error('Native staged validation rejected');
    },
  });
  const Sidebar = exports.Sidebar as new (ctx: AppContext) => { renderSidebarUpdateBtn(): void };
  const sidebar = new Sidebar(h.ctx);
  const container = h.browser.document.createElement('div');
  container.id = 'sidebarUpdateBtn';
  h.browser.document.body.append(container);
  sidebar.renderSidebarUpdateBtn();
  h.browser.document.querySelector<HTMLButtonElement>('#sidebarUpdateApply')!.click();
  assert.equal(h.ctx.updateState?.phase, 'installing');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.ctx.updateState, null);
  assert.equal(Boolean(h.browser.document.querySelector('[data-action="apply"], #sidebarUpdateApply')), false);
  let rechecks = 0;
  h.browser.document.addEventListener('wm:check-for-updates', () => { rechecks++; });
  h.browser.document.querySelector<HTMLButtonElement>('#sidebarUpdateRecheck')!.click();
  assert.equal(rechecks, 1);
});
