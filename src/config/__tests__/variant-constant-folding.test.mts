import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { build } from 'esbuild';

const source = readFileSync(new URL('../variant.ts', import.meta.url), 'utf8');

async function loadVariant(value: string | undefined) {
  const env = value === undefined ? {} : { VITE_VARIANT: value };
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText.replaceAll('import.meta.env', JSON.stringify(env));
  return await import(`data:text/javascript,${encodeURIComponent(compiled)}`) as {
    SITE_VARIANT: string;
    initializeVariant(): void;
  };
}

for (const [input, expected] of [
  ['full', 'full'], ['tech', 'tech'], ['finance', 'finance'], ['happy', 'happy'],
  [undefined, 'full'], ['', 'full'], ['invalid', 'full'],
] as const) {
  test(`actual variant module resolves ${String(input)} to ${expected}`, async () => {
    assert.equal((await loadVariant(input)).SITE_VARIANT, expected);
  });
}

test('explicit full variant folds without runtime Set validation in a bundled consumer', async () => {
  const result = await build({
    stdin: {
      contents: "export { SITE_VARIANT as default } from './src/config/variant.ts';",
      resolveDir: path.resolve('.'),
    },
    bundle: true, write: false, format: 'esm', minify: true,
    define: { 'import.meta.env': JSON.stringify({ VITE_VARIANT: 'full' }) },
  });
  const output = result.outputFiles[0]!.text;
  assert.doesNotMatch(output, /\bSet\b|\.has\(/);
  assert.equal((await import(`data:text/javascript,${encodeURIComponent(output)}`)).default, 'full');
});

test('initialization preserves configured variant, storage, hostname, and full fallback', async () => {
  const names = ['document', 'localStorage', 'location'] as const;
  const previous = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const dataset: Record<string, string> = {};
  let stored: string | null = null;
  let hostname = 'full.example.test';
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: { documentElement: { dataset } } },
    localStorage: { configurable: true, value: { getItem: () => stored } },
    location: { configurable: true, value: { get hostname() { return hostname; } } },
  });
  try {
    for (const value of ['full', 'tech', 'finance', 'happy']) {
      stored = value;
      (await loadVariant('full')).initializeVariant();
      assert.equal(dataset.variant, value === 'full' ? undefined : value);
      stored = null;
      hostname = `${value}.example.test`;
      (await loadVariant('full')).initializeVariant();
      assert.equal(dataset.variant, value === 'full' ? undefined : value);
    }
    stored = 'invalid';
    hostname = 'invalid.example.test';
    (await loadVariant('full')).initializeVariant();
    assert.equal(dataset.variant, undefined);
    stored = 'happy';
    hostname = 'happy.example.test';
    for (const value of ['tech', 'finance', 'happy']) {
      (await loadVariant(value)).initializeVariant();
      assert.equal(dataset.variant, value);
    }
  } finally {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
