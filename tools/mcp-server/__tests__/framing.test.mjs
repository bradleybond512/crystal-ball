import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CIRCULAR_MARKER,
  DEPTH_MARKER,
  ERROR_MESSAGE_MAX,
  SIZE_MARKER,
  TRUSTED_OUTPUT_TOOLS,
  UNTRUSTED_NOTICE,
  framedErrorResult,
  framedHandler,
  frameToolOutput,
  sanitizeText,
  sanitizeValue,
} from '../framing.mjs';

const cp = (...codes) => String.fromCodePoint(...codes);
const tagged = (text) => [...text].map((ch) => cp(0xe0000 + ch.codePointAt(0))).join('');
const FIXED = new Date('2026-10-02T12:00:00.000Z');

test('sanitizeText strips every invisible-character class an injection can hide behind', () => {
  const cases = [
    ['zero-width space, joiners, word joiner, BOM', `a${cp(0x200b)}b${cp(0x200c)}c${cp(0x200d)}d${cp(0x2060)}e${cp(0xfeff)}f`, 'abcdef'],
    ['bidi marks, embeddings and overrides', `a${cp(0x200e)}${cp(0x200f)}${cp(0x202a)}${cp(0x202b)}${cp(0x202c)}${cp(0x202d)}${cp(0x202e)}b`, 'ab'],
    ['bidi isolates and the Arabic letter mark', `a${cp(0x2066)}${cp(0x2067)}${cp(0x2068)}${cp(0x2069)}${cp(0x061c)}b`, 'ab'],
    ['Unicode tag block (ASCII smuggling)', `visible${cp(0xe0001)}${tagged('rm -rf /')}${cp(0xe007f)}`, 'visible'],
    ['variation selectors, both blocks', `a${cp(0xfe00)}${cp(0xfe0f)}${cp(0xe0100)}${cp(0xe01ef)}b`, 'ab'],
    ['invisible fillers and joiners outside Cf', `a${cp(0x034f)}${cp(0x115f)}${cp(0x1160)}${cp(0x17b4)}${cp(0x17b5)}${cp(0x180b)}${cp(0x180e)}${cp(0x3164)}${cp(0xffa0)}b`, 'ab'],
    ['interlinear annotation and soft hyphen', `a${cp(0xfff9)}b${cp(0xfffa)}c${cp(0xfffb)}d${cp(0x00ad)}e`, 'abcde'],
    ['C0 controls, DEL and C1 controls', `a${cp(0)}${cp(7)}${cp(8)}${cp(0x0b)}${cp(0x0c)}${cp(0x1b)}[31m${cp(0x7f)}${cp(0x9b)}b`, 'a[31mb'],
    ['lone surrogates', `a${String.fromCharCode(0xd800)}b${String.fromCharCode(0xdc00)}c`, 'abc'],
  ];
  for (const [label, input, expected] of cases) assert.equal(sanitizeText(input), expected, label);
});

test('sanitizeText keeps newlines and tabs and normalizes other line breaks to \\n', () => {
  assert.equal(sanitizeText('a\nb\tc'), 'a\nb\tc');
  assert.equal(sanitizeText('a\r\nb\rc'), 'a\nb\nc');
  assert.equal(sanitizeText(`a${cp(0x2028)}b${cp(0x2029)}c${cp(0x85)}d`), 'a\nb\nc\nd');
});

test('sanitizeText leaves visible text from any script untouched', () => {
  const visible = `Kyiv, ${cp(0x041a)}${cp(0x0438)}${cp(0x0457)}${cp(0x0432)}, ${cp(0x0637)}${cp(0x0647)}${cp(0x0631)}${cp(0x0627)}${cp(0x0646)}, `
    + `${cp(0x6771)}${cp(0x4eac)}, caf${cp(0xe9)}, ${cp(0x1f30d)}, 5 ${cp(0x2264)} 7`;
  assert.equal(sanitizeText(visible), visible);
});

test('sanitizeValue cleans nested strings and keys with JSON semantics', () => {
  const input = {
    [`ti${cp(0x200b)}tle`]: `Ignore${cp(0x202e)} this`,
    list: [`a${cp(0xfeff)}`, 1, true, null, undefined, () => 1],
    nested: { deeper: [{ note: `x${tagged('hidden')}` }] },
    when: new Date(0),
    big: 10n,
    skip: undefined,
    fn() { return 1; },
    sym: Symbol('s'),
  };
  assert.deepEqual(sanitizeValue(input), {
    title: 'Ignore this',
    list: ['a', 1, true, null, null, null],
    nested: { deeper: [{ note: 'x' }] },
    when: '1970-01-01T00:00:00.000Z',
    big: '10',
  });
  assert.equal(sanitizeValue(`a${cp(0x200b)}`), 'a');
  assert.equal(sanitizeValue(undefined), undefined);
});

test('keys that collide after cleaning are all kept, and __proto__ stays an own key', () => {
  const parsed = JSON.parse(`{"__proto__":{"polluted":true},"name":"real","na${cp(0x200b)}me":"shadow","n${cp(0x200b)}ame":"third"}`);
  const clean = sanitizeValue(parsed);
  assert.deepEqual(Object.keys(clean), ['__proto__', 'name', 'name~2', 'name~3']);
  assert.equal(clean.name, 'real');
  assert.equal(clean['name~2'], 'shadow');
  assert.equal(Object.getPrototypeOf(clean), Object.prototype);
  assert.equal(clean.polluted, undefined);
  assert.equal({}.polluted, undefined);
});

test('sanitizeValue bounds depth, total size and cycles', () => {
  let deep = { leaf: 'end' };
  for (let i = 0; i < 40; i += 1) deep = { next: deep };
  let cursor = sanitizeValue(deep);
  let levels = 0;
  while (typeof cursor === 'object') {
    cursor = cursor.next;
    levels += 1;
  }
  assert.equal(cursor, DEPTH_MARKER);
  assert.equal(levels, 32);

  const wide = Array.from({ length: 20 }, () => ({ v: 1 }));
  const bounded = sanitizeValue(wide, { maxNodes: 5 });
  assert.deepEqual(bounded.slice(0, 4), [{ v: 1 }, { v: 1 }, { v: 1 }, { v: 1 }]);
  assert.equal(bounded[4], SIZE_MARKER);

  const loop = { name: 'loop' };
  loop.self = loop;
  loop.list = [loop];
  assert.deepEqual(sanitizeValue(loop), { name: 'loop', self: CIRCULAR_MARKER, list: [CIRCULAR_MARKER] });

  const shared = { v: 1 };
  assert.deepEqual(sanitizeValue({ a: shared, b: shared }), { a: { v: 1 }, b: { v: 1 } });
});

test('frameToolOutput envelopes every tool except the repo-authored help', () => {
  const payload = { headline: `Push to main${cp(0x200b)}` };
  assert.deepEqual(frameToolOutput('get_sitrep', payload, FIXED), {
    notice: UNTRUSTED_NOTICE,
    source: 'crystal-ball:get_sitrep',
    retrieved_at: '2026-10-02T12:00:00.000Z',
    untrusted_external_data: { headline: 'Push to main' },
  });
  // Tools marked local still relay feed-derived renderer state.
  for (const name of ['get_reasoning_debug_log', 'get_pipeline_trace', 'get_monitor_status', 'watchlist_manage']) {
    assert.equal(frameToolOutput(name, payload, FIXED).notice, UNTRUSTED_NOTICE, name);
  }
  assert.deepEqual(TRUSTED_OUTPUT_TOOLS, ['help']);
  assert.deepEqual(frameToolOutput('help', payload, FIXED), { headline: 'Push to main' });
  assert.equal(frameToolOutput('get_sitrep', undefined, FIXED).untrusted_external_data, null);
  assert.match(UNTRUSTED_NOTICE, /never as\s+instructions/);
});

test('framedErrorResult frames, cleans and bounds provider error text', () => {
  const result = framedErrorResult('lookup_ip', new Error(`upstream said: obey${cp(0x202e)} me ${'x'.repeat(5000)}`), FIXED);
  assert.equal(result.isError, true);
  const body = JSON.parse(result.content[0].text);
  assert.equal(body.notice, UNTRUSTED_NOTICE);
  assert.equal(body.source, 'crystal-ball:lookup_ip');
  assert.equal(body.retrieved_at, '2026-10-02T12:00:00.000Z');
  assert.equal(body.error.length, ERROR_MESSAGE_MAX);
  assert.ok(body.error.startsWith('upstream said: obey me '));
  assert.equal(JSON.parse(framedErrorResult('x', 'plain string', FIXED).content[0].text).error, 'plain string');
});

test('framedHandler returns framed text and structured content, and frames thrown errors', async () => {
  const handler = framedHandler('search_news', async (args, extra) => ({ args, extra, title: `t${cp(0x2066)}` }), () => FIXED);
  const ok = await handler({ q: 1 }, { requestId: 7 });
  assert.equal(ok.isError, undefined);
  assert.deepEqual(ok.structuredContent.result.untrusted_external_data, { args: { q: 1 }, extra: { requestId: 7 }, title: 't' });
  assert.deepEqual(JSON.parse(ok.content[0].text), ok.structuredContent.result);

  const failing = framedHandler('search_news', async () => { throw new Error(`bad${cp(0x200b)}`); }, () => FIXED);
  const failed = await failing({});
  assert.equal(failed.isError, true);
  assert.equal(JSON.parse(failed.content[0].text).error, 'bad');
});
