// R4-SEC-001: the key dashboard works from presence. It never shows part of a
// saved secret, and "Test" on a saved key asks the sidecar to check its own copy.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { Window } from 'happy-dom';

const browser = new Window({ url: 'http://127.0.0.1/' });
Object.assign(globalThis, { window: browser, document: browser.document, HTMLElement: browser.HTMLElement });
after(() => browser.happyDOM.abort());

const verified: unknown[][] = [];
const deps: Record<string, unknown> = {
  '../services/settings-constants': {
    KEY_CATEGORIES: [{ id: 'llm', label: 'Core LLMs', tier: 1, keys: ['GROQ_API_KEY', 'OLLAMA_API_URL', 'ANTHROPIC_API_KEY'] }],
    HUMAN_LABELS: {}, KEY_DESCRIPTIONS: {}, SIGNUP_URLS: {}, KEY_SETUP_STEPS: {},
    PLAINTEXT_KEYS: new Set(['OLLAMA_API_URL']),
  },
  '../services/wizard-state': { getKeyStatus: () => undefined, setKeyStatus: () => {} },
  '../services/runtime-config': {
    setSecretValue: async () => {},
    verifySecretWithApi: async (...args: unknown[]) => { verified.push(['typed', ...args]); return { valid: true, message: 'ok' }; },
    verifyStoredSecretWithApi: async (...args: unknown[]) => { verified.push(['stored', ...args]); return { valid: true, message: 'ok' }; },
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
