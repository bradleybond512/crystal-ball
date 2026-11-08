import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import ts from 'typescript';

const original = readFileSync(new URL('./fixtures/advisor-json-original.ts.txt', import.meta.url), 'utf8');
const current = readFileSync(new URL('../survival-advisor.ts', import.meta.url), 'utf8');
function code(source: string): string {
  const ast = ts.createSourceFile('advisor.ts', source, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === 'parseAIResponse');
  assert.ok(node, 'test must compile the actual private function');
  return ts.transpileModule(node.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
function parser(source: string, json = JSON) {
  return new Function('JSON', code(source) + ';return parseAIResponse;')(json) as (value: string) => unknown;
}
const actual = parser(current);
const legacy = parser(original);
const item = { priority: 'high', action: 'Fixture action', rationale: 'Fixture rationale', category: 'family-safety' };
const valid = JSON.stringify({ items: [item] });
const examples = ['', 'plain', '{}', '[]', 'null', '42', '{', '}', '}{', '{{', '}}', valid,
  'prefix\n' + valid + '\nsuffix', '{"items":[]}' + valid, valid + '{"items":[]}',
  JSON.stringify({ items: [{ ...item, action: 'nested { braces } and "quote"\\escape\n🛰' }] }),
  JSON.stringify({ items: [item, { priority: 'low' }] }), '{"items":[null]}', '{"items":[42]}',
  '{"items":"not-array"}', '{"items":{}}', '\ud800' + valid + '\udfff', 'before } ' + valid];
const corpus = [...examples];
const alphabet = ['{', '}', 'x', '\n', '🛰'];
for (let n = 0; n < 3125; n++) {
  let value = n; let text = '';
  for (let i = 0; i < 5; i++) { text += alphabet[value % 5]; value = Math.floor(value / 5); }
  corpus.push(text);
}
test('actual advice parser preserves returned items, invalid-input fallback and order', () => {
  for (const input of corpus) assert.deepEqual(actual(input), legacy(input), JSON.stringify(input));
  assert.deepEqual(actual(valid), [item]);
  assert.deepEqual(actual('{"items":[null]}'), []);
  assert.deepEqual(actual(valid + '{"items":[]}'), []);
});
test('actual extraction preserves first-open last-close and the no-match parse input', () => {
  const captured = (source: string, input: string) => {
    const calls: string[] = [];
    const json = { ...JSON, parse(value: string) { calls.push(value); return { items: [] }; } };
    parser(source, json)(input);
    return calls;
  };
  // Reuse the compiled function for the exhaustive substring oracle.
  const actualCalls: string[] = []; const legacyCalls: string[] = [];
  const a = parser(current, { ...JSON, parse(value: string) { actualCalls.push(value); return { items: [] }; } });
  const b = parser(original, { ...JSON, parse(value: string) { legacyCalls.push(value); return { items: [] }; } });
  for (const input of corpus) { a(input); b(input); }
  assert.deepEqual(actualCalls, legacyCalls);
  assert.deepEqual(captured(current, '}{'), ['}{']);
  assert.deepEqual(captured(current, 'prefix {a}{b} suffix'), ['{a}{b}']);
});
test('actual parser completes a bounded unmatched-opening response', async () => {
  const js = code(current) + `
    console.log('READY');
    process.stdin.once('data', () => {
      const value = parseAIResponse('{'.repeat(200000));
      if (!Array.isArray(value) || value.length) process.exitCode = 2;
      process.stdin.pause();
    });`;
  const result = await new Promise<{ ready: boolean; status: number | null; error?: string; stderr: string }>(resolve => {
    const child = spawn(process.execPath, ['-e', js]);
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
        timer = setTimeout(() => { error = 'actual parser work exceeded 2s after READY'; child.kill('SIGKILL'); }, 2000);
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
test('normal selection includes the actual advisor regression', async () => {
  const { deriveScriptIndex, selectScripts } = await import('../../../scripts/targeted-tests.mjs');
  const scripts = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).scripts;
  for (const file of ['src/services/survival-advisor.ts', 'src/services/__tests__/advisor-json-extraction.test.mts']) {
    const selected = selectScripts([file], deriveScriptIndex(scripts), {});
    assert.ok(selected.scripts.includes('test:advisor-json-extraction'), file);
    assert.deepEqual(selected.unmapped, []);
  }
  assert.ok(scripts['test:advisor-json-extraction'].includes('advisor-json-extraction.test.mts'));
});
