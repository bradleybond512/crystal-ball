import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Window } from 'happy-dom';
import ts from 'typescript';

test('saved rows age in place, explicit Test uses only the saved key name, and editing stays local', async () => {
  const win = new Window();
  const { document } = win;
  const source = readFileSync(new URL('../../settings-main.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  const calls: string[][] = [];
  const drafts = new Map();
  const manager = {
    hasPending: (key: string) => drafts.has(key),
    getValidationState: () => ({}),
    setPending: (key: string, value: string) => drafts.set(key, value),
  };
  let state = 'verified';
  const modules: Record<string, unknown> = {
    '@/services/runtime-config': {
      getSecretState: () => ({ present: true, valid: true }),
      verifyStoredSecretWithApi: async (...args: string[]) => { calls.push(args); return { outcome: 'verified', message: 'Provider verified' }; },
    },
    '@/services/credential-evidence': { getCredentialEvidenceDisplay: () => ({ state, text: state, title: '2026-01-01T00:00:00.000Z' }) },
    '@/services/settings-constants': { HUMAN_LABELS: {}, SIGNUP_URLS: {}, PLAINTEXT_KEYS: new Set(), MASKED_SENTINEL: '••••' },
    '@/utils/sanitize': { escapeHtml: (value: string) => value },
  };
  const script = compiled.outputText.slice(0, compiled.outputText.lastIndexOf("localStorage.setItem('wm-settings-open'"));
  assert.ok(script.length < compiled.outputText.length - 80, 'omits only automatic window startup');
  const start = new Function('require','exports','document','window','manager', script +
    "\nsettingsManager = manager; return { renderSecretInput, initFeatureSectionListeners, refreshCredentialRows };");
  const api = start((id: string) => modules[id] || {}, {}, document, win, manager);
  const area = document.createElement('section');
  document.body.append(area);
  const feedback = document.createElement('p');
  feedback.id = 'settingsActionStatus';
  document.body.append(feedback);
  area.innerHTML = api.renderSecretInput('GROQ_API_KEY','aiGroq');
  api.initFeatureSectionListeners(area);
  const badge = area.querySelector('[data-evidence]')!;
  const input = area.querySelector('input')!;
  const button = area.querySelector('button')!;
  assert.equal(badge.textContent, 'verified');
  assert.equal(badge.getAttribute('title'), '2026-01-01T00:00:00.000Z');
  state = 'stale';
  api.refreshCredentialRows();
  assert.equal(badge.textContent, 'stale');
  assert.deepEqual(calls, []);
  button.click();
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  assert.deepEqual(calls, [['GROQ_API_KEY']]);
  assert.match(feedback.textContent ?? '', /^Test at [\dT:.Z-]+ · Provider verified$/i);
  for (const change of ['verified', 'stale', 'historical']) {
    state = change;
    api.refreshCredentialRows();
    assert.equal(badge.textContent, change);
    assert.equal(feedback.textContent, '', 'aged or replaced evidence clears the prior test message');
    button.click();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  input.focus();
  input.value = 'synthetic-draft';
  input.dispatchEvent(new win.Event('input'));
  input.setSelectionRange(4, 4);
  api.refreshCredentialRows();
  assert.equal(document.activeElement, input);
  assert.equal(input.selectionStart, 4);
  assert.equal(input.value, 'synthetic-draft');
  assert.equal(badge.textContent, 'Draft');
  assert.ok(button.hidden);
  assert.equal(feedback.textContent, '');
  assert.deepEqual(calls, Array(4).fill(['GROQ_API_KEY']));
  await win.happyDOM.abort();
});
