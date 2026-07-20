/**
 * Tests for sidecar-logger.mjs — JSON file logging with size rotation.
 * Uses node --test runner (same pattern as other sidecar tests).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { join } = path;

import { createSidecarLogger } from '../sidecar-logger.mjs';

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), 'cb-sidecar-logger-test-'));
}

function readLog(dir, suffix = '') {
  const p = join(dir, `sidecar.log${suffix}`);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

// ── Basic write ────────────────────────────────────────────────────────

test('writes JSON lines to sidecar.log', () => {
  const dir = makeTmpDir();
  const logger = createSidecarLogger({ dir });
  logger.info('hello world', { count: 1 });
  const content = readLog(dir);
  assert.ok(content, 'log file must exist');
  const parsed = JSON.parse(content.trim().split('\n')[0]);
  assert.equal(parsed.level, 'info');
  assert.equal(parsed.msg, 'hello world');
  assert.equal(parsed.count, 1);
  assert.ok(typeof parsed.at === 'number', 'at must be a number');
});

test('all three levels write JSON', () => {
  const dir = makeTmpDir();
  const logger = createSidecarLogger({ dir });
  logger.info('i');
  logger.warn('w');
  logger.error('e');
  const lines = readLog(dir).trim().split('\n');
  assert.equal(lines.length, 3);
  const levels = lines.map(l => JSON.parse(l).level);
  assert.deepEqual(levels, ['info', 'warn', 'error']);
});

// ── Non-object fields coercion ─────────────────────────────────────────
// Regression: callers pass `logger.warn(msg, err.message)` (a bare string) in
// several LLM-proxy paths. `{ ...record, ...string }` spreads the string
// character-by-character into indexed keys, producing garbage log lines like
// {"0":"u","1":"p","2":"s",...}. Non-object fields must be wrapped, not spread.

test('string field is wrapped in detail, not spread char-by-char', () => {
  const dir = makeTmpDir();
  const logger = createSidecarLogger({ dir });
  logger.warn('Ollama unavailable', 'upstream 404 not found');
  const parsed = JSON.parse(readLog(dir).trim().split('\n')[0]);
  assert.equal(parsed.msg, 'Ollama unavailable');
  assert.equal(parsed.detail, 'upstream 404 not found');
  assert.equal(parsed['0'], undefined, 'string must NOT be spread into indexed keys');
});

test('Error field is wrapped as its message', () => {
  const dir = makeTmpDir();
  const logger = createSidecarLogger({ dir });
  logger.error('request failed', new Error('ECONNREFUSED'));
  const parsed = JSON.parse(readLog(dir).trim().split('\n')[0]);
  assert.equal(parsed.detail, 'ECONNREFUSED');
});

test('array field is wrapped in detail, not spread by index', () => {
  const dir = makeTmpDir();
  const logger = createSidecarLogger({ dir });
  logger.warn('regions', ['us', 'eu']);
  const parsed = JSON.parse(readLog(dir).trim().split('\n')[0]);
  assert.deepEqual(parsed.detail, ['us', 'eu']);
  assert.equal(parsed['0'], undefined, 'array must NOT be spread into indexed keys');
});

test('plain object field is still spread as top-level keys (unchanged)', () => {
  const dir = makeTmpDir();
  const logger = createSidecarLogger({ dir });
  logger.info('counts', { count: 3, region: 'us' });
  const parsed = JSON.parse(readLog(dir).trim().split('\n')[0]);
  assert.equal(parsed.count, 3);
  assert.equal(parsed.region, 'us');
  assert.equal(parsed.detail, undefined, 'plain objects must not be wrapped');
});

// ── Rotation ───────────────────────────────────────────────────────────

test('rotates when size exceeds maxBytes', () => {
  const dir = makeTmpDir();
  const logger = createSidecarLogger({ dir, maxBytes: 200, keep: 2 });
  // Write enough to exceed maxBytes
  for (let i = 0; i < 20; i++) {
    logger.info(`message number ${i}`, { i });
  }
  // After rotation, sidecar.log.1 must exist
  assert.ok(existsSync(join(dir, 'sidecar.log.1')), 'sidecar.log.1 must exist after rotation');
  // Current log must be smaller than before rotation
  const size = statSync(join(dir, 'sidecar.log')).size;
  assert.ok(size < 200 * 10, 'log should have been rotated');
});

test('overflow file deleted when keep=1 and second rotation happens', () => {
  const dir = makeTmpDir();
  // Very small maxBytes to force many rotations; keep=1 means only .1 survives
  const logger = createSidecarLogger({ dir, maxBytes: 60, keep: 1 });
  for (let i = 0; i < 50; i++) {
    logger.info(`x${i}`);
  }
  // .2 must NOT exist
  assert.ok(!existsSync(join(dir, 'sidecar.log.2')), 'sidecar.log.2 must be cleaned up when keep=1');
});

// ── Console mirror ─────────────────────────────────────────────────────

test('warn and error are mirrored to the injected console', () => {
  const dir = makeTmpDir();
  const calls = [];
  const fakeConsole = {
    log: () => {},
    warn: (...args) => calls.push({ level: 'warn', args }),
    error: (...args) => calls.push({ level: 'error', args }),
  };
  const logger = createSidecarLogger({ dir, console: fakeConsole });
  logger.info('silent'); // should NOT call console.warn/error
  logger.warn('important');
  logger.error('critical');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].level, 'warn');
  assert.equal(calls[1].level, 'error');
});

// ── Error resilience ───────────────────────────────────────────────────

test('throwing fs append does not propagate', () => {
  // Use a path that is a directory — writes to it will fail
  const badDir = makeTmpDir() + '/nonexistent/deep';
  const logger = createSidecarLogger({ dir: badDir });
  // Should not throw
  assert.doesNotThrow(() => logger.info('this will silently fail'));
});

test('circular-ref field does not propagate', () => {
  const dir = makeTmpDir();
  const logger = createSidecarLogger({ dir });
  const circular = {};
  circular.self = circular;
  assert.doesNotThrow(() => logger.info('circular', circular));
});

test('BigInt field does not propagate', () => {
  const dir = makeTmpDir();
  const logger = createSidecarLogger({ dir });
  assert.doesNotThrow(() => logger.warn('bigint', { n: 9_007_199_254_740_993n }));
});

test('throwing injected console does not propagate', () => {
  const dir = makeTmpDir();
  const throwingConsole = {
    warn: () => { throw new Error('console.warn broken'); },
    error: () => { throw new Error('console.error broken'); },
  };
  const logger = createSidecarLogger({ dir, console: throwingConsole });
  assert.doesNotThrow(() => logger.warn('will trigger console.warn'));
  assert.doesNotThrow(() => logger.error('will trigger console.error'));
});

// ── log() method (alias of info) ───────────────────────────────────────

test('returned logger has info, warn, error, and log methods', () => {
  const dir = makeTmpDir();
  const logger = createSidecarLogger({ dir });
  assert.equal(typeof logger.info, 'function', 'info must be callable');
  assert.equal(typeof logger.warn, 'function', 'warn must be callable');
  assert.equal(typeof logger.error, 'function', 'error must be callable');
  assert.equal(typeof logger.log, 'function', 'log must be callable');
});

test('log() writes at info level', () => {
  const dir = makeTmpDir();
  const logger = createSidecarLogger({ dir });
  logger.log('via log method', { x: 1 });
  const content = readLog(dir);
  assert.ok(content, 'log file must exist');
  const parsed = JSON.parse(content.trim().split('\n')[0]);
  assert.equal(parsed.level, 'info');
  assert.equal(parsed.msg, 'via log method');
});

test('child logger also has log() method', () => {
  const dir = makeTmpDir();
  const logger = createSidecarLogger({ dir });
  const child = logger.child({ component: 'test' });
  assert.equal(typeof child.log, 'function', 'child.log must be callable');
  assert.doesNotThrow(() => child.log('child log call'));
});
