// R3-SEC-004: CSP violations reach the desktop log once each, with the
// blocked origin only — never a path or query that could carry user data.
import assert from 'node:assert/strict';
import test from 'node:test';

import { createCspViolationReporter, installCspViolationReporter, summarizeViolation } from '../csp-violation-reporter.ts';

test('only the origin of a blocked URL is kept', () => {
  const summary = summarizeViolation({
    effectiveDirective: 'img-src',
    blockedURI: 'https://tracker.example/pixel.gif?lat=41.6&lon=-86.7&q=secret',
    sourceFile: 'tauri://localhost/assets/index-abc.js?v=1#x',
  });
  assert.deepEqual(summary, {
    key: 'img-src https://tracker.example',
    directive: 'img-src',
    blocked: 'https://tracker.example',
    source: 'tauri://localhost/assets/index-abc.js',
  });
});

test('keyword, data, blob and malformed sources are normalized', () => {
  assert.equal(summarizeViolation({ effectiveDirective: 'script-src', blockedURI: 'eval' }).blocked, 'eval');
  assert.equal(summarizeViolation({ effectiveDirective: 'img-src', blockedURI: 'data:image/png;base64,AAAA' }).blocked, 'data');
  assert.equal(summarizeViolation({ effectiveDirective: 'worker-src', blockedURI: 'blob:tauri://localhost/123' }).blocked, 'blob');
  assert.equal(summarizeViolation({ violatedDirective: 'connect-src https://a', blockedURI: '::nope' }).blocked, 'unknown');
  assert.equal(summarizeViolation({ violatedDirective: 'connect-src https://a' }).directive, 'connect-src');
  assert.equal(summarizeViolation({ effectiveDirective: '', violatedDirective: 'img-src https://a' }).directive, 'img-src', 'empty falls through');
  assert.equal(summarizeViolation({ effectiveDirective: '  ', violatedDirective: '' }).directive, 'unknown');
});

test('each directive and origin is logged once, up to a cap', () => {
  const logged: [string, Record<string, unknown>][] = [];
  const report = createCspViolationReporter((message, context) => { logged.push([message, context]); }, 3);
  assert.equal(report({ effectiveDirective: 'img-src', blockedURI: 'https://a.example/x?1' }), true);
  assert.equal(report({ effectiveDirective: 'img-src', blockedURI: 'https://a.example/y?2' }), false, 'same origin again');
  assert.equal(report({ effectiveDirective: 'connect-src', blockedURI: 'https://a.example/' }), true);
  assert.equal(report({ effectiveDirective: 'img-src', blockedURI: 'https://b.example/' }), true);
  assert.equal(report({ effectiveDirective: 'img-src', blockedURI: 'https://c.example/' }), false, 'cap reached');
  assert.deepEqual(logged.map(([m]) => m), [
    'CSP blocked img-src: https://a.example',
    'CSP blocked connect-src: https://a.example',
    'CSP blocked img-src: https://b.example',
  ]);
  assert.doesNotMatch(JSON.stringify(logged), /\?1|\/x/);
  assert.equal(logged[0]![1].disposition, 'enforce');
});

test('install listens for securitypolicyviolation and uninstall stops it', () => {
  const target = new EventTarget();
  const logged: string[] = [];
  const uninstall = installCspViolationReporter(target as unknown as Document, (message) => { logged.push(message); });
  const event = Object.assign(new Event('securitypolicyviolation'), { effectiveDirective: 'img-src', blockedURI: 'https://a.example/x' });
  target.dispatchEvent(event);
  uninstall();
  target.dispatchEvent(Object.assign(new Event('securitypolicyviolation'), { effectiveDirective: 'img-src', blockedURI: 'https://z.example/' }));
  assert.deepEqual(logged, ['CSP blocked img-src: https://a.example']);
});
