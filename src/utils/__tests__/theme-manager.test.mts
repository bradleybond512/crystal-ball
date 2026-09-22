import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

type Theme = 'dark' | 'light';
type ThemeModule = typeof import('../theme-manager.ts');
const source = readFileSync(new URL('../theme-manager.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(options: {
  variant?: string;
  stored?: string;
  dark?: boolean;
  storageMode?: 'normal' | 'throws' | 'drops';
  media?: boolean;
  mediaEvents?: boolean;
  store?: Map<string, string>;
} = {}) {
  const store = options.store ?? new Map<string, string>();
  if (options.stored !== undefined) store.set('crystalball-theme', options.stored);
  const root = { dataset: { theme: '' } as { theme: string; variant?: string } };
  if (options.variant && options.variant !== 'full') root.dataset.variant = options.variant;
  const meta = { content: '' };
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const events: Theme[] = [];
  let readsUnavailable = false;
  let invalidations = 0;
  let writes = 0;
  const mq = {
    matches: options.dark ?? false,
    addEventListener: options.mediaEvents === false ? undefined : (_type: string, listener: (event: { matches: boolean }) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => listeners.delete(listener),
  };
  const exports = {} as ThemeModule;
  runInNewContext(compiled, {
    exports,
    require: (name: string) => {
      assert.equal(name, './theme-colors');
      return { invalidateColorCache: () => { invalidations += 1; } };
    },
    document: { documentElement: root, querySelector: () => meta },
    window: {
      matchMedia: options.media === false ? undefined : () => mq,
      dispatchEvent: (event: { detail: { theme: Theme } }) => { events.push(event.detail.theme); },
    },
    CustomEvent: class {
      detail: { theme: Theme };
      constructor(_type: string, init: { detail: { theme: Theme } }) { this.detail = init.detail; }
    },
    localStorage: {
      getItem: (key: string) => {
        if (readsUnavailable || options.storageMode === 'throws') throw new Error('storage unavailable');
        return store.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        writes += 1;
        if (options.storageMode === 'throws') throw new Error('storage unavailable');
        if (options.storageMode !== 'drops') store.set(key, value);
      },
    },
  });
  return {
    theme: exports, root, meta, store, events, listeners,
    loseStorageReads() { readsUnavailable = true; },
    get invalidations() { return invalidations; },
    get writes() { return writes; },
    change(dark: boolean) {
      mq.matches = dark;
      for (const listener of listeners) listener({ matches: dark });
    },
  };
}

for (const variant of ['full', 'tech', 'finance']) {
  test(`${variant} follows repeated OS changes without persisting a choice`, () => {
    const f = fixture({ variant });
    f.theme.applyStoredTheme();
    f.theme.watchSystemTheme();
    assert.equal(f.root.dataset.theme, 'light');
    assert.equal(f.meta.content, '#f8f9fa');
    assert.equal(f.invalidations, 0);
    assert.deepEqual(f.events, []);
    f.change(true);
    assert.equal(f.root.dataset.theme, 'dark');
    assert.equal(f.meta.content, '#0a0f0a');
    f.change(false);
    assert.equal(f.root.dataset.theme, 'light');
    assert.equal(f.meta.content, '#f8f9fa');
    assert.deepEqual(f.events, ['dark', 'light']);
    assert.equal(f.invalidations, 2);
    assert.equal(f.writes, 0);
    assert.equal(f.store.has('crystalball-theme'), false);
  });
}

for (const choice of ['dark', 'light'] as const) {
  test(`manual ${choice} survives OS events and reload`, () => {
    const f = fixture();
    f.theme.applyStoredTheme();
    f.theme.watchSystemTheme();
    f.theme.setTheme(choice);
    f.change(choice !== 'dark');
    assert.equal(f.root.dataset.theme, choice);
    assert.equal(f.store.get('crystalball-theme'), choice);
    const reload = fixture({ store: f.store, dark: choice !== 'dark' });
    reload.theme.applyStoredTheme();
    reload.theme.watchSystemTheme();
    reload.change(choice !== 'dark');
    assert.equal(reload.root.dataset.theme, choice);
  });
}

test('a manual choice after a system event stops following the OS', () => {
  const f = fixture();
  f.theme.applyStoredTheme();
  f.theme.watchSystemTheme();
  f.change(true);
  f.theme.setTheme('light');
  f.change(true);
  assert.equal(f.root.dataset.theme, 'light');
  assert.deepEqual(f.events, ['dark', 'light']);
});

for (const storageMode of ['throws', 'drops'] as const) {
  test(`manual choice remains authoritative when storage ${storageMode}`, () => {
    const f = fixture({ storageMode });
    f.theme.applyStoredTheme();
    f.theme.watchSystemTheme();
    f.theme.setTheme('dark');
    f.change(false);
    assert.equal(f.root.dataset.theme, 'dark');
    f.theme.applyStoredTheme();
    assert.equal(f.root.dataset.theme, 'dark');
    assert.deepEqual(f.events, ['dark']);
    assert.equal(f.store.has('crystalball-theme'), false);
  });
}

test('happy stays light without preference and permits an explicit dark choice', () => {
  const f = fixture({ variant: 'happy', dark: true });
  f.theme.applyStoredTheme();
  f.theme.watchSystemTheme();
  f.change(false);
  f.change(true);
  assert.equal(f.root.dataset.theme, 'light');
  assert.equal(f.meta.content, '#FAFAF5');
  assert.deepEqual(f.events, []);
  f.theme.setTheme('dark');
  f.change(false);
  assert.equal(f.root.dataset.theme, 'dark');
  assert.equal(f.meta.content, '#1A2332');
});

test('missing matchMedia retains the dark fallback', () => {
  const f = fixture({ media: false });
  f.theme.applyStoredTheme();
  f.theme.watchSystemTheme();
  assert.equal(f.root.dataset.theme, 'dark');
  assert.equal(f.listeners.size, 0);
});

test('an invalid stored value does not disable OS following', () => {
  const f = fixture({ stored: 'auto' });
  f.theme.applyStoredTheme();
  f.theme.watchSystemTheme();
  f.change(true);
  f.change(false);
  assert.equal(f.root.dataset.theme, 'light');
  assert.equal(f.store.get('crystalball-theme'), 'auto');
});

test('repeated watcher setup installs only one media listener', () => {
  const f = fixture();
  f.theme.applyStoredTheme();
  f.theme.watchSystemTheme();
  f.theme.watchSystemTheme();
  assert.equal(f.listeners.size, 1);
  f.change(true);
  assert.deepEqual(f.events, ['dark']);
});

const variantSource = readFileSync(new URL('../../config/variant.ts', import.meta.url), 'utf8');
function resolveVariant(options: { build?: string; stored?: string; host?: string; storageThrows?: boolean; initialVariant?: string } = {}) {
  const exports = {} as typeof import('../../config/variant.ts');
  const root = { dataset: {} as Record<string, string> };
  if (options.initialVariant !== undefined) root.dataset.variant = options.initialVariant;
  const compiledVariant = ts.transpileModule(
    variantSource.replace('import.meta.env?.VITE_VARIANT', JSON.stringify(options.build ?? 'full')),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  runInNewContext(compiledVariant, {
    exports,
    document: { documentElement: root },
    location: { hostname: options.host ?? 'localhost' },
    localStorage: { getItem: () => {
      if (options.storageThrows) throw new Error('storage unavailable');
      return options.stored ?? null;
    } },
  });
  exports.initializeVariant();
  return root.dataset.variant;
}

for (const build of ['tech', 'finance', 'happy']) {
  test(`${build} build selection wins before theme bootstrap`, () => {
    assert.equal(resolveVariant({ build, stored: 'full', host: 'finance.crystalball.app' }), build);
  });
}

test('full build retains stored variant before hostname', () => {
  assert.equal(resolveVariant({ stored: 'happy', host: 'tech.crystalball.app' }), 'happy');
  assert.equal(resolveVariant({ stored: 'full', host: 'happy.crystalball.app' }), undefined);
});

test('default full identity has no variant attribute', () => {
  assert.equal(resolveVariant(), undefined);
});

test('stored full selection clears a stale non-full attribute', () => {
  assert.equal(resolveVariant({ stored: 'full', host: 'happy.crystalball.app', initialVariant: 'happy' }), undefined);
});

test('hostname selects a variant when storage is absent, invalid or unavailable', () => {
  assert.equal(resolveVariant({ host: 'happy.crystalball.app' }), 'happy');
  assert.equal(resolveVariant({ stored: 'invalid', host: 'tech.crystalball.app' }), 'tech');
  assert.equal(resolveVariant({ storageThrows: true, host: 'finance.crystalball.app' }), 'finance');
});

test('unknown build, hostname and stored variants clear an invalid stale attribute', () => {
  assert.equal(resolveVariant({ build: 'invalid', stored: 'invalid', host: 'other.crystalball.app', initialVariant: 'invalid-inline-value' }), undefined);
});


test('a stored manual choice survives storage becoming unreadable after startup', () => {
  const f = fixture({ stored: 'dark' });
  f.theme.applyStoredTheme();
  f.theme.watchSystemTheme();
  f.loseStorageReads();
  f.change(false);
  assert.equal(f.root.dataset.theme, 'dark');
  assert.deepEqual(f.events, []);
  assert.equal(f.writes, 0);
});


test('missing media change-listener API preserves startup and manual appearance', () => {
  const f = fixture({ mediaEvents: false });
  f.theme.applyStoredTheme();
  assert.equal(f.root.dataset.theme, 'light');
  assert.doesNotThrow(() => f.theme.watchSystemTheme());
  assert.equal(f.listeners.size, 0);
  f.theme.setTheme('dark');
  assert.equal(f.root.dataset.theme, 'dark');
  assert.equal(f.store.get('crystalball-theme'), 'dark');
  assert.deepEqual(f.events, ['dark']);
});
