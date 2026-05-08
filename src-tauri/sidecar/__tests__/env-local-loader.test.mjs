/**
 * Tests for the .env.local fallback loader. Pure parser is exhaustively
 * covered; loadEnvFile is exercised against a tmp file to validate the
 * "never overwrite a set var" + "missing file is silent" invariants.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseEnvFile, loadEnvFile } from '../env-local-loader.mjs';

// ── parseEnvFile ────────────────────────────────────────────────────

test('parseEnvFile: simple KEY=value', () => {
  const m = parseEnvFile('FOO=bar');
  assert.equal(m.get('FOO'), 'bar');
});

test('parseEnvFile: blank lines + comments are skipped', () => {
  const m = parseEnvFile('\n# comment\n\nFOO=bar\n# another\nBAZ=qux\n');
  assert.equal(m.size, 2);
  assert.equal(m.get('FOO'), 'bar');
  assert.equal(m.get('BAZ'), 'qux');
});

test('parseEnvFile: leading "export " is stripped', () => {
  const m = parseEnvFile('export FOO=bar\nBAZ=qux');
  assert.equal(m.get('FOO'), 'bar');
  assert.equal(m.get('BAZ'), 'qux');
});

test('parseEnvFile: surrounding double quotes are stripped', () => {
  const m = parseEnvFile('FOO="bar baz"');
  assert.equal(m.get('FOO'), 'bar baz');
});

test('parseEnvFile: surrounding single quotes are stripped', () => {
  const m = parseEnvFile("FOO='bar baz'");
  assert.equal(m.get('FOO'), 'bar baz');
});

test('parseEnvFile: trailing whitespace is trimmed', () => {
  const m = parseEnvFile('FOO=bar   \nBAZ=qux\t\n');
  assert.equal(m.get('FOO'), 'bar');
  assert.equal(m.get('BAZ'), 'qux');
});

test('parseEnvFile: whitespace around = is tolerated', () => {
  const m = parseEnvFile('FOO = bar');
  assert.equal(m.get('FOO'), 'bar');
});

test('parseEnvFile: lowercase / mixed-case keys are rejected', () => {
  const m = parseEnvFile('foo=bar\nFooBar=qux\nGOOD=val');
  assert.equal(m.has('foo'), false);
  assert.equal(m.has('FooBar'), false);
  assert.equal(m.get('GOOD'), 'val');
});

test('parseEnvFile: keys may contain digits and underscores', () => {
  const m = parseEnvFile('VITE_API_2=val\nA1B_C=val2');
  assert.equal(m.get('VITE_API_2'), 'val');
  assert.equal(m.get('A1B_C'), 'val2');
});

test('parseEnvFile: malformed lines are silently skipped', () => {
  const m = parseEnvFile('=novalue\n=KEYLESS\nNO_EQUAL\nFOO=bar');
  assert.equal(m.size, 1);
  assert.equal(m.get('FOO'), 'bar');
});

test('parseEnvFile: value containing = sign keeps everything after first =', () => {
  const m = parseEnvFile('TOKEN=abc=def=ghi');
  assert.equal(m.get('TOKEN'), 'abc=def=ghi');
});

test('parseEnvFile: BOM is tolerated', () => {
  const m = parseEnvFile('﻿FOO=bar');
  assert.equal(m.get('FOO'), 'bar');
});

test('parseEnvFile: non-string input returns empty map', () => {
  assert.equal(parseEnvFile(null).size, 0);
  assert.equal(parseEnvFile(undefined).size, 0);
  assert.equal(parseEnvFile(123).size, 0);
});

// ── loadEnvFile ─────────────────────────────────────────────────────

test('loadEnvFile: missing file returns 0 and does not throw', () => {
  const env = {};
  const n = loadEnvFile('/no/such/path/.env.local', env);
  assert.equal(n, 0);
  assert.deepEqual(env, {});
});

test('loadEnvFile: applies new keys, returns count', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'env-loader-'));
  const file = path.join(dir, '.env.local');
  writeFileSync(file, 'FOO=bar\nBAZ=qux\n');
  try {
    const env = {};
    const n = loadEnvFile(file, env);
    assert.equal(n, 2);
    assert.equal(env.FOO, 'bar');
    assert.equal(env.BAZ, 'qux');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadEnvFile: never overwrites an already-set env var', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'env-loader-'));
  const file = path.join(dir, '.env.local');
  writeFileSync(file, 'FOO=fromfile\nBAZ=fromfile\n');
  try {
    const env = { FOO: 'from-keychain' };
    const n = loadEnvFile(file, env);
    assert.equal(n, 1);
    assert.equal(env.FOO, 'from-keychain', 'set var must not be overwritten');
    assert.equal(env.BAZ, 'fromfile');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadEnvFile: empty-string env vars are treated as unset and overwritten', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'env-loader-'));
  const file = path.join(dir, '.env.local');
  writeFileSync(file, 'FOO=fromfile\n');
  try {
    const env = { FOO: '' };
    const n = loadEnvFile(file, env);
    assert.equal(n, 1);
    assert.equal(env.FOO, 'fromfile');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
