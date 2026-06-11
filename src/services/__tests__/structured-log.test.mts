import assert from 'node:assert/strict';
import test from 'node:test';

import { formatRecord } from '../structured-log.ts';
import type { SlogRecord } from '../structured-log.ts';

function base(overrides: Partial<SlogRecord> = {}): SlogRecord {
  return {
    at: 1_000_000,
    level: 'info',
    category: 'pipeline',
    message: 'test message',
    ...overrides,
  };
}

test('formatRecord: single-line JSON output', () => {
  const out = formatRecord(base());
  assert.equal(typeof out, 'string');
  assert.ok(!out.includes('\n'), 'must be single-line');
});

test('formatRecord: parses as valid JSON', () => {
  const out = formatRecord(base());
  const parsed = JSON.parse(out) as Record<string, unknown>;
  assert.equal(parsed['at'], 1_000_000);
  assert.equal(parsed['level'], 'info');
  assert.equal(parsed['cat'], 'pipeline');
  assert.equal(parsed['msg'], 'test message');
});

test('formatRecord: trace key absent when traceId is undefined', () => {
  const out = formatRecord(base({ traceId: undefined }));
  const parsed = JSON.parse(out) as Record<string, unknown>;
  assert.ok(!Object.prototype.hasOwnProperty.call(parsed, 'trace'), 'trace key must be absent when undefined');
});

test('formatRecord: trace key present when traceId is provided', () => {
  const out = formatRecord(base({ traceId: 'abc-123' }));
  const parsed = JSON.parse(out) as Record<string, unknown>;
  assert.equal(parsed['trace'], 'abc-123');
});

test('formatRecord: fields are flattened into the top-level object', () => {
  const out = formatRecord(base({ fields: { count: 5, ok: true, name: 'foo' } }));
  const parsed = JSON.parse(out) as Record<string, unknown>;
  assert.equal(parsed['count'], 5);
  assert.equal(parsed['ok'], true);
  assert.equal(parsed['name'], 'foo');
});

test('formatRecord: stable key order — at, level, cat, msg', () => {
  const out = formatRecord(base({ fields: { z: 1, a: 2 } }));
  const keys = Object.keys(JSON.parse(out) as Record<string, unknown>);
  assert.equal(keys[0], 'at');
  assert.equal(keys[1], 'level');
  assert.equal(keys[2], 'cat');
  assert.equal(keys[3], 'msg');
});
