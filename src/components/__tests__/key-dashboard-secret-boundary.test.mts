// R4-SEC-001: the key dashboard works from presence. It never shows part of a
// saved secret, and "Test" on a saved key asks the sidecar to check its own copy.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { Window } from 'happy-dom';

const browser = new Window({ url: 'http://127.0.0.1/' });
Object.assign(globalThis, { window: browser, document: browser.document, HTMLElement: browser.HTMLElement, Event: browser.Event });
after(() => browser.happyDOM.abort());

const verified: unknown[][] = [];
let displayState = 'verified';
let draftResult = async () => ({ outcome: 'verified', message: 'Provider verified' });
const deps: Record<string, any> = {
  '../services/credential-evidence': {
    getCredentialEvidenceDisplay: (_key: string, present: boolean) => ({
      text: present ? displayState : 'Not configured', state: present ? displayState : 'unset',
      title: present ? '2026-11-02T00:00:00.000Z' : '',
    }),
  },
  '../services/settings-constants': {
    KEY_CATEGORIES: [{ id: 'llm', label: 'Core LLMs', tier: 1, keys: ['GROQ_API_KEY', 'OLLAMA_API_URL', 'ANTHROPIC_API_KEY'] }],
    HUMAN_LABELS: {}, KEY_DESCRIPTIONS: {}, SIGNUP_URLS: {}, KEY_SETUP_STEPS: {},
    PLAINTEXT_KEYS: new Set(['OLLAMA_API_URL']),
  },
  '../services/wizard-state': { getKeyStatus: () => undefined, setKeyStatus: () => {} },
  '../services/runtime-config': {
    validateSecret: () => ({ valid: true }),
    setSecretValue: async () => {},
    verifySecretWithApi: async (...args: unknown[]) => { verified.push(['typed', ...args]); return draftResult(); },
    verifyStoredSecretWithApi: async (...args: unknown[]) => { verified.push(['stored', ...args]); return draftResult(); },
  },
  '../services/key-feature-index': { featuresFor: () => [] },
  '../services/tauri-bridge': { invokeTauri: async () => null },
};
const compiled = ts.transpileModule(readFileSync(new URL('../KeyDashboard.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const mod: Record<string, any> = {};
new Function('require', 'exports', compiled)((id: string) => {
  assert.ok(id in deps, `unexpected import ${id}`);
  return deps[id];
}, mod);

function mount(set: Set<string>, plaintext: Record<string, string> = {}) {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  const dashboard = new mod.KeyDashboard(root, {
    isSet: (key: string) => set.has(key),
    plaintextValue: (key: string) => plaintext[key],
    onRunWizard: () => {},
  });
  dashboard.render();
  return root;
}
const input = (root: HTMLElement, key: string) => root.querySelector<HTMLInputElement>(`input[data-input-for="${key}"]`)!;
const testButton = (root: HTMLElement, key: string) =>
  root.querySelector<HTMLElement>(`.key-card[data-key="${key}"] .key-card-test`)!;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test('counts come from presence', () => {
  const root = mount(new Set(['GROQ_API_KEY', 'ANTHROPIC_API_KEY']));
  assert.match(root.textContent ?? '', /2 of 3 configured/);
});

test('a saved secret shows a mask only; a plaintext setting shows its value', () => {
  const root = mount(new Set(['GROQ_API_KEY', 'OLLAMA_API_URL']), { OLLAMA_API_URL: 'http://127.0.0.1:11434' });
  assert.equal(input(root, 'GROQ_API_KEY').placeholder, '••••••');
  assert.equal(input(root, 'OLLAMA_API_URL').placeholder, 'http://127.0.0.1:11434');
  assert.equal(input(root, 'ANTHROPIC_API_KEY').placeholder, 'Paste key here');
});

test('Test on a saved key verifies the stored copy; a typed value is sent as typed', async () => {
  verified.length = 0;
  const root = mount(new Set(['GROQ_API_KEY']));
  testButton(root, 'GROQ_API_KEY').click();
  await flush();
  assert.deepEqual(verified, [['stored', 'GROQ_API_KEY']]);
  verified.length = 0;
  input(root, 'GROQ_API_KEY').value = 'gsk-typed';
  testButton(root, 'GROQ_API_KEY').click();
  await flush();
  assert.deepEqual(verified, [['typed', 'GROQ_API_KEY', 'gsk-typed']]);
});

test('Test on an unset key sends nothing', async () => {
  verified.length = 0;
  const root = mount(new Set());
  testButton(root, 'ANTHROPIC_API_KEY').click();
  await flush();
  assert.deepEqual(verified, []);
});

test('age refresh updates saved evidence in place without checking or stealing focus', () => {
  verified.length = 0;
  const root = mount(new Set(['GROQ_API_KEY']));
  const field = input(root, 'GROQ_API_KEY');
  field.focus();
  displayState = 'stale';
  window.dispatchEvent(new browser.Event('cb:credential-evidence-changed'));
  const evidence = root.querySelector<HTMLElement>('[data-key="GROQ_API_KEY"] .key-card-evidence');
  assert.equal(evidence?.textContent, 'stale');
  assert.equal(evidence?.title, '2026-11-02T00:00:00.000Z');
  assert.equal(document.activeElement, field);
  assert.equal(root.querySelector('[data-key="ANTHROPIC_API_KEY"]')?.getAttribute('data-status'), 'unset');
  assert.deepEqual(verified, []);
  displayState = 'verified';
});

test('an edited draft discards its in-flight result and cannot label the saved credential', async () => {
  const root = mount(new Set(['GROQ_API_KEY']));
  const field = input(root, 'GROQ_API_KEY');
  field.value = 'synthetic-canary-A';
  let finish!: () => void;
  const original = draftResult;
  draftResult = () => new Promise(resolve => { finish = () => resolve({ outcome: 'rejected', message: 'synthetic-canary-error' }); });
  try {
    testButton(root, 'GROQ_API_KEY').click();
    field.value = 'synthetic-canary-B';
    field.dispatchEvent(new browser.Event('input'));
    finish();
    await flush();
    assert.doesNotMatch(root.textContent ?? '', /synthetic-canary|Testing…|Draft.*rejected/i);
    assert.equal(root.querySelector('[data-key="GROQ_API_KEY"] .key-card-evidence')?.textContent, 'verified');
  } finally { draftResult = original; }
});

test('draft feedback is separate from saved provider evidence', async () => {
  const root = mount(new Set(['GROQ_API_KEY']));
  input(root, 'GROQ_API_KEY').value = 'synthetic-only';
  testButton(root, 'GROQ_API_KEY').click();
  await flush();
  assert.match(root.querySelector('[data-feedback-for="GROQ_API_KEY"]')?.textContent ?? '', /draft.*provider verified/i);
  assert.equal(root.querySelector('[data-key="GROQ_API_KEY"] .key-card-evidence')?.textContent, 'verified');
});

const wizardDeps = {
  ...deps,
  '../services/settings-constants': { ...deps['../services/settings-constants'], OAUTH_CONNECT_KEYS: new Set() },
  '../services/wizard-state': {
    getPosition: () => null, getDontAsk: () => [], getSkipped: () => [], clearSkipped: () => {}, setPosition: () => {},
  },
  '../services/clipboard-watcher': { startWatching: () => {}, stopWatching: () => {}, markConsumed: () => {} },
};
const wizardModule: Record<string, any> = {};
new Function('require', 'exports', ts.transpileModule(readFileSync(new URL('../SetupWizard.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)((id: keyof typeof wizardDeps) => wizardDeps[id], wizardModule);

function mountWizard() {
  document.body.replaceChildren();
  let saved = false;
  const wizard = new wizardModule.SetupWizard(document.body, { isSet: () => saved, onClose: () => {} });
  wizard.open();
  saved = true;
  const field = document.querySelector<HTMLInputElement>('.setup-wizard-input')!;
  field.value = 'synthetic-only';
  return { wizard, save: document.querySelector<HTMLElement>('.setup-wizard-footer .primary')! };
}

test('wizard explicitly saves before testing the stored copy and does not expose storage errors', async () => {
  const runtime = deps['../services/runtime-config'];
  const original = runtime.setSecretValue;
  try {
    const { wizard, save } = mountWizard();
    verified.length = 0;
    runtime.setSecretValue = async () => { throw new Error('synthetic-canary-error'); };
    save.click();
    await flush();
    assert.deepEqual(verified, []);
    assert.match(document.body.textContent ?? '', /save failed/i);
    assert.doesNotMatch(document.body.textContent ?? '', /synthetic-canary-error/);
    runtime.setSecretValue = async () => { verified.push(['save']); };
    save.click();
    await flush();
    assert.deepEqual(verified, [['save'], ['stored', 'GROQ_API_KEY']]);
    wizard.close();
  } finally { runtime.setSecretValue = original; }
});

test('closing the wizard while saving never starts a probe on a retired step', async () => {
  const runtime = deps['../services/runtime-config'];
  const original = runtime.setSecretValue;
  let finish!: () => void;
  try {
    runtime.setSecretValue = () => new Promise<void>(resolve => { finish = resolve; });
    const { wizard, save } = mountWizard();
    verified.length = 0;
    save.click();
    wizard.close();
    finish();
    await flush();
    assert.deepEqual(verified, []);
  } finally { runtime.setSecretValue = original; }
});

test('wizard evidence follows a later change while the user reads the saved result', async () => {
  const { wizard, save } = mountWizard();
  save.click();
  await flush();
  try {
    displayState = 'historical';
    window.dispatchEvent(new browser.Event('cb:credential-evidence-changed'));
    assert.match(document.querySelector('.setup-wizard-feedback')?.textContent ?? '', /historical/);
    assert.doesNotMatch(document.querySelector('.setup-wizard-feedback')?.textContent ?? '', /Provider verified/);
  } finally {
    displayState = 'verified';
    wizard.close();
  }
});

test('in-app save preserves focus, expanded tier and a different draft across the runtime notification', async () => {
  const runtime = deps['../services/runtime-config'];
  let listener = () => {};
  const saved = new Set<string>();
  const service = {
    ...runtime,
    isSecretSet: (key: string) => saved.has(key), RUNTIME_FEATURES: [],
    getRuntimeConfigSnapshot: () => ({ secrets: {} }), subscribeRuntimeConfig: (cb: () => void) => { listener = cb; return () => {}; },
  };
  const panelDeps: Record<string, any> = {
    './Panel': { Panel: class { content = document.createElement('div'); destroy() {} } },
    './KeyDashboard': mod, './SetupWizard': wizardModule, '@/services/runtime-config': service,
    '@/services/settings-manager': { SettingsManager: class { destroy() {} } },
    '@/services/runtime': { isDesktopRuntime: () => true }, '@/services/web-secret-store': { isVaultUnlocked: () => false },
    '@/services/i18n': { t: (key: string) => key }, '@/utils/sanitize': { escapeHtml: String },
    '@/services/registration-profile': { getRegistrationProfile: () => null },
    '@/services/settings-constants': deps['../services/settings-constants'],
  };
  const panelModule: Record<string, any> = {};
  new Function('require', 'exports', ts.transpileModule(readFileSync(new URL('../RuntimeConfigPanel.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText)((id: string) => panelDeps[id] ?? {}, panelModule);
  const panel = new panelModule.RuntimeConfigPanel({ mode: 'full' });
  document.body.replaceChildren(panel.content);
  const original = runtime.setSecretValue;
  try {
    runtime.setSecretValue = async (key: string) => { saved.add(key); listener(); };
    const key = 'GROQ_API_KEY';
    input(panel.content, key).value = 'synthetic-to-save';
    const other = input(panel.content, 'ANTHROPIC_API_KEY');
    other.value = 'synthetic-unsaved';
    const button = panel.content.querySelector(`[data-key="${key}"] .key-card-save`)!;
    button.focus();
    button.click();
    await flush();
    assert.ok(input(panel.content, 'ANTHROPIC_API_KEY') === other, 'other draft input was replaced');
    assert.equal(other.value, 'synthetic-unsaved');
    assert.equal(input(panel.content, key).value, '');
    assert.ok(document.activeElement === button, 'save lost focus');
    assert.match(panel.content.querySelector(`[data-feedback-for="${key}"]`).textContent, /saved, not verified/i);
    assert.equal(panel.content.querySelector('details.key-tier').open, true);
  } finally {
    runtime.setSecretValue = original;
    panel.destroy();
  }
});

test('keyboard focus stays in the wizard and Escape returns to the invoking control', () => {
  const opener = document.createElement('button');
  document.body.replaceChildren(opener);
  opener.focus();
  const wizard = new wizardModule.SetupWizard(document.body, { isSet: () => false, onClose: () => {} });
  const confirmBefore = globalThis.confirm;
  globalThis.confirm = () => true;
  try {
    wizard.open();
    const field = document.querySelector<HTMLInputElement>('.setup-wizard-input')!;
    const last = document.querySelector<HTMLElement>('.setup-wizard-footer .primary')!;
    assert.ok(document.activeElement === field);
    last.focus();
    last.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    assert.ok(document.activeElement === field);
    field.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.ok(document.activeElement === opener);
  } finally { wizard.close(); globalThis.confirm = confirmBefore; }
});

test('real dated receipt is stale at 24 hours and removal clears the visible evidence', async () => {
  const service = await import('../../services/credential-evidence.ts');
  const key = 'GROQ_API_KEY';
  const checked = Date.now() - 86_400_000;
  const saved = new Set([key]);
  const original = deps['../services/credential-evidence'];
  const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: browser.localStorage });
  deps['../services/credential-evidence'] = service;
  // Read-time injection keeps the component fixture's other transports synthetic.
  const component: Record<string, any> = {};
  new Function('require', 'exports', compiled)((id: string) => deps[id], component);
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  const dashboard = new component.KeyDashboard(root, { isSet: (k: string) => saved.has(k), plaintextValue: () => undefined, onRunWizard: () => {} });
  try {
    const handle = service.beginStoredCredentialCheck(key);
    assert.equal(service.completeStoredCredentialCheck(handle, { outcome: 'rejected', reason: 'provider-rejected' }, { now: checked }), true);
    verified.length = 0;
    dashboard.render();
    const line = root.querySelector<HTMLElement>(`[data-key="${key}"] .key-card-evidence`)!;
    assert.match(line.textContent, /provider rejected.*1 day ago.*stale/i);
    assert.match(line.getAttribute('aria-label') ?? '', new RegExp(new Date(checked).toISOString()));
    saved.clear();
    dashboard.refresh();
    assert.equal(line.textContent, 'Not set');
    assert.equal(line.title, '');
    assert.deepEqual(verified, []);
  } finally {
    dashboard.destroy();
    deps['../services/credential-evidence'] = original;
    browser.localStorage.clear();
    if (storage) Object.defineProperty(globalThis, 'localStorage', storage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
