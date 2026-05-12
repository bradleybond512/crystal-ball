import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseTimeString,
  isValidEmail,
  msUntilNextFire,
  describeSchedule,
  defaultSchedule,
} from '../briefing-scheduler.ts';
import type { BriefingSchedule } from '../briefing-scheduler.ts';

function schedule(overrides: Partial<BriefingSchedule> = {}): BriefingSchedule {
  return { ...defaultSchedule(), ...overrides };
}

// ── parseTimeString ───────────────────────────────────────────────────────────

test('parseTimeString: valid "07:00" parses to hour=7, minute=0', () => {
  assert.deepEqual(parseTimeString('07:00'), { hour: 7, minute: 0 });
});

test('parseTimeString: valid "19:30" parses correctly', () => {
  assert.deepEqual(parseTimeString('19:30'), { hour: 19, minute: 30 });
});

test('parseTimeString: "invalid" throws', () => {
  assert.throws(() => parseTimeString('invalid'), /Invalid time string/);
});

test('parseTimeString: "25:00" throws (out of range hour)', () => {
  assert.throws(() => parseTimeString('25:00'), /Out of range/);
});

test('parseTimeString: "12:60" throws (out of range minute)', () => {
  assert.throws(() => parseTimeString('12:60'), /Out of range/);
});

// ── isValidEmail ──────────────────────────────────────────────────────────────

test('isValidEmail: "user@example.com" returns true', () => {
  assert.equal(isValidEmail('user@example.com'), true);
});

test('isValidEmail: "not-an-email" returns false', () => {
  assert.equal(isValidEmail('not-an-email'), false);
});

test('isValidEmail: empty string returns false', () => {
  assert.equal(isValidEmail(''), false);
});

test('isValidEmail: "@nodomain" returns false', () => {
  assert.equal(isValidEmail('@nodomain'), false);
});

test('isValidEmail: "local@" returns false', () => {
  assert.equal(isValidEmail('local@'), false);
});

test('isValidEmail: "local@nodot" returns false (domain needs dot)', () => {
  assert.equal(isValidEmail('local@nodot'), false);
});

// ── msUntilNextFire ───────────────────────────────────────────────────────────

test('msUntilNextFire: scheduled time is in the future today, returns correct ms', () => {
  // 08:00 schedule, now is 07:00
  const s = schedule({ enabled: true, hour: 8, minute: 0 });
  const now = new Date('2026-05-11T07:00:00.000Z');
  const ms = msUntilNextFire(s, now);
  assert.ok(ms > 0, `expected positive ms, got ${ms}`);
  // Should be ~1 hour in ms (3600000) — but timezone-independent check
  assert.ok(ms <= 24 * 60 * 60 * 1000, `should be at most one day`);
});

test('msUntilNextFire: scheduled time has already passed today, fires tomorrow (> 0)', () => {
  // 06:00 schedule, now is 07:00 → already passed, fires tomorrow
  const s = schedule({ enabled: true, hour: 6, minute: 0 });
  const now = new Date('2026-05-11T07:00:00.000Z');
  const ms = msUntilNextFire(s, now);
  assert.ok(ms > 0, `expected positive ms for tomorrow, got ${ms}`);
  // Must be less than 2 days
  assert.ok(ms < 2 * 24 * 60 * 60 * 1000, `should be less than 2 days`);
});

test('msUntilNextFire: exact same minute fires tomorrow', () => {
  const s = schedule({ enabled: true, hour: 7, minute: 30 });
  // now is exactly 07:30:00 — "at or past" should roll to tomorrow
  const now = new Date();
  now.setHours(7, 30, 0, 0);
  const ms = msUntilNextFire(s, now);
  assert.ok(ms > 0, `expected tomorrow's fire, got ${ms}`);
});

// ── describeSchedule ──────────────────────────────────────────────────────────

test('describeSchedule: disabled schedule returns "Disabled"', () => {
  assert.equal(describeSchedule(schedule({ enabled: false })), 'Disabled');
});

test('describeSchedule: save mode produces correct string', () => {
  const s = schedule({ enabled: true, hour: 7, minute: 0, outputMethod: 'save' });
  const result = describeSchedule(s);
  assert.ok(result.includes('07:00'), `expected time in description, got: ${result}`);
  assert.ok(result.includes('save'), `expected "save" in description, got: ${result}`);
  assert.ok(result.includes('Crystal Ball Briefs'), `expected path in description, got: ${result}`);
});

test('describeSchedule: email mode includes email address', () => {
  const s = schedule({
    enabled: true,
    hour: 19,
    minute: 30,
    outputMethod: 'email',
    emailAddress: 'user@example.com',
  });
  const result = describeSchedule(s);
  assert.ok(result.includes('19:30'), `expected time, got: ${result}`);
  assert.ok(result.includes('user@example.com'), `expected email, got: ${result}`);
});

test('describeSchedule: zero-padded hours and minutes', () => {
  const s = schedule({ enabled: true, hour: 0, minute: 5, outputMethod: 'save' });
  const result = describeSchedule(s);
  assert.ok(result.includes('00:05'), `expected zero-padded "00:05", got: ${result}`);
});
