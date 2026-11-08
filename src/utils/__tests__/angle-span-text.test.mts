import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import ts from 'typescript';

const consumers = ['congress-defense'];
// Exact original function bodies from main3245ce41; never derive the oracle from modified consumers.
const originalSource = readFileSync(new URL('../../services/__tests__/fixtures/congress-defense-original.ts.txt', import.meta.url), 'utf8');
const originalBodies: Record<string, string> = { 'congress-defense': originalSource.match(/function stripHtml\(html: string\): string \{[\s\S]*?\n\}/)![0] };
const helper = new URL('../angle-span-text.ts', import.meta.url);
function compiledConsumer(name: string, original = false): string {
  const source = readFileSync(new URL('../../services/' + name + '.ts', import.meta.url), 'utf8');
  const body = source.match(/function stripHtml\(html: string\): string \{[\s\S]*?\n\}/)?.[0];
  assert.ok(body, 'actual production stripHtml must be found');
  const helperSource = existsSync(helper) ? readFileSync(helper, 'utf8').replace('export function', 'function') : '';
  const selected = original ? originalBodies[name] : body;
  return ts.transpileModule(helperSource + '\n' + selected, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
const corpus = ['', '<>', 'a<>b', '<<>', '<><a>', '<a><b>', '<<tail', 'a<b\nc>d', '🛰<x>é', '\ud800<q>\udfff', '&lt;x&gt;', '&amp;lt;', '&#039;', 'a\n\nb', '< >', 'x>y<z'];
const alphabet = ['<', '>', 'x', '\n', 'é'];
for (let n = 0; n < 3125; n++) {
  let value = n;
  let text = '';
  for (let i = 0; i < 5; i++) { text += alphabet[value % alphabet.length]; value = Math.floor(value / alphabet.length); }
  corpus.push(text);
}
for (const name of consumers) {
  test(name + ': actual text extraction preserves bounded legacy outputs', () => {
    const actual = new Function(compiledConsumer(name) + ';return stripHtml;')() as (input: string) => string;
    const legacy = new Function(compiledConsumer(name, true) + ';return stripHtml;')() as (input: string) => string;
    for (const value of corpus) assert.equal(actual(value), legacy(value), JSON.stringify(value));
    assert.equal(actual('<>'), '<>');
    assert.equal(actual('<<tail'), '<<tail');
  });
  test(name + ': actual unmatched opening-angle tail is bounded', async () => {
    const code = compiledConsumer(name) + `
      console.log('READY');
      process.stdin.once('data', () => {
        const input = '<'.repeat(200000);
        if (stripHtml(input) !== input) process.exitCode = 2;
        process.stdin.pause();
      });`;
    const result = await new Promise<{ ready: boolean; status: number | null; error?: string; stderr: string }>(resolve => {
      const child = spawn(process.execPath, ['-e', code]);
      let ready = false;
      let stdout = '';
      let stderr = '';
      let error: string | undefined;
      let timer = setTimeout(() => { error = 'separate startup exceeded 15s'; child.kill('SIGKILL'); }, 15000);
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
        if (!ready && stdout.includes('READY\n')) {
          ready = true;
          clearTimeout(timer);
          timer = setTimeout(() => { error = 'actual extractor work exceeded 2s after READY'; child.kill('SIGKILL'); }, 2000);
          child.stdin.end('go\n');
        }
      });
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      child.once('error', cause => { error = cause.message; });
      child.once('close', status => { clearTimeout(timer); resolve({ ready, status, error, stderr }); });
    });
    assert.equal(result.ready, true, result.stderr || result.error);
    assert.equal(result.error, undefined, result.error);
    assert.equal(result.status, 0, result.stderr);
  });
}

test('Congress and the helper select the actual regression suite', async () => {
  const { deriveScriptIndex, mergeOverrides, OVERRIDES, selectScripts } = await import('../../../scripts/targeted-tests.mjs');
  const scripts = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).scripts;
  const declarations = JSON.parse(readFileSync(new URL('../../../scripts/targeted-tests-overrides.json', import.meta.url), 'utf8'));
  const index = deriveScriptIndex(scripts);
  for (const file of [...consumers.map(name => 'src/services/' + name + '.ts'), 'src/utils/angle-span-text.ts', 'src/utils/__tests__/angle-span-text.test.mts', 'src/services/__tests__/fixtures/congress-defense-original.ts.txt']) {
    const selected = selectScripts([file], index, mergeOverrides(OVERRIDES, declarations));
    assert.ok(selected.scripts.includes('test:angle-span-text'), file);
    assert.deepEqual(selected.unmapped, []);
  }
});

test('actual Congress fetch/parser/cache outputs equal immutable original with synthetic feeds', async () => {
  const { runInNewContext } = await import('node:vm');
  const now = Date.parse('2026-11-08T12:00:00Z');
  const rows = [
    { title: 'Military AUMF NATO NATO alliance', description: '<b>Ukraine</b> &lt;x&gt;', pubDate: '2026-11-07', guid: 'g/one' },
    { title: 'NDAA defense budget', description: 'x'.repeat(600), pubDate: '2026-11-08', link: 'https://example.test/two' },
    { title: 'Military invalid', pubDate: 'nonsense' },
    { title: 'Military epoch', pubDate: '1970-01-01' },
    { title: 'Military absent date', description: '<> <<tail' },
    { title: 'Gardening unrelated', pubDate: '2026-11-08' },
    { title: 'Sanctions bill Iran', description: 'military', pubDate: '2026-11-08' },
    { title: 'Sanctions legislation', description: 'defense', pubDate: '2026-11-08' },
    { title: 'Military hearing vote statement', pubDate: '2026-11-08' },
    ...Array.from({ length: 45 }, (_, i) => ({ title: `Military vote ${i}`, pubDate: '2026-11-08' })),
  ];
  async function evaluate(source: string, mode: string) {
    let clock = now;
    const requests: unknown[] = [];
    class FixedDate extends Date {
      constructor(value?: string | number) { super(value === undefined ? clock : value); }
      static now() { return clock; }
    }
    class Parser {
      parseFromString(value: string) {
        const data = JSON.parse(value) as Record<string, string>[];
        return {
          querySelector: () => mode === 'malformed' ? {} : null,
          querySelectorAll: () => data.map(row => ({ querySelector: (key: string) => row[key] === undefined ? null : { textContent: row[key] } })),
        };
      }
    }
    const exports: Record<string, (...args: unknown[]) => unknown> = {};
    const context = { exports, Date: FixedDate, DOMParser: Parser,
      AbortSignal: { timeout: (ms: number) => ({ timeout: ms }) },
      fetch: async (url: string, options: unknown) => {
        requests.push({ url, options });
        if (mode === 'reject' || (mode === 'partial' && url.includes('house.gov'))) throw new Error('synthetic transport failure');
        return { ok: mode !== 'non-ok', text: async () => {
          if (mode === 'body-reject') throw new Error('synthetic body failure');
          return JSON.stringify(rows);
        } };
      },
    };
    const helperSource = existsSync(helper) ? readFileSync(helper, 'utf8').replace('export function', 'function') : '';
    const executable = source.replace(/^import .*angle-span-text.*;\n/m, '');
    runInNewContext(ts.transpileModule(helperSource + '\n' + executable + '\nexports.fixtureFetchFeed = fetchFeed;', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
    const first = await exports.fetchCongressDefense();
    const cached = await exports.fetchCongressDefense();
    assert.equal(first, cached, 'fresh cache preserves array identity');
    assert.equal(requests.length, 5);
    clock += 30 * 60 * 1000;
    const expired = await exports.fetchCongressDefense();
    assert.equal(requests.length, 10, 'exact TTL expires');
    const classes = ['critical', 'high', 'medium', 'low', 'unknown'].map(value => exports.congressSeverityClass(value));
    const rawFeed = await exports.fixtureFetchFeed('https://armedservices.house.gov/rss.xml');
    return JSON.parse(JSON.stringify({ first, expired, rawFeed, requests, classes }));
  }
  const actualSource = readFileSync(new URL('../../services/congress-defense.ts', import.meta.url), 'utf8');
  for (const mode of ['ok', 'partial', 'reject', 'non-ok', 'body-reject', 'malformed']) {
    assert.deepEqual(await evaluate(actualSource, mode), await evaluate(originalSource, mode), mode);
  }
  for (const value of [0, 1, -1, Infinity, -Infinity, NaN]) assert.equal(Number.isNaN(value), isNaN(value));
});
