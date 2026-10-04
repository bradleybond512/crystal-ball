// SMS command security model.
//
// Allowlist entries are AllowedNumber objects:
//   { phoneNumber: '+15551234567', name: 'Brad', tier: 'admin' | 'readonly' }
//
// Persisted to ~/.config/crystalball/sms-allowlist.json with mode 0600.
// Backward compatible: bare string entries from the legacy config format are
// upcast to readonly entries with an empty name.
//
// Rate limit: 10 commands per hour per phone number (fixed window). The
// window starts on the first command after expiry. Memoryless caller passes
// in a shared Map so the sidecar can reset state for tests.
//
// Tier rules: WATCH and ALERT mutate observation state, so they require
// admin. Everything else is readonly-safe.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const DEFAULT_ALLOWLIST_PATH = path.join(homedir(), '.config', 'crystalball', 'sms-allowlist.json');
export const RATE_LIMIT_MAX = 10;
export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const DESTRUCTIVE_COMMANDS = new Set(['WATCH', 'ALERT']);

export function normalizePhone(num) {
  return String(num ?? '').replace(/\D/g, '');
}

function normalizeEntry(raw) {
  if (typeof raw === 'string') {
    return { phoneNumber: raw, name: '', tier: 'readonly' };
  }
  if (raw && typeof raw === 'object') {
    const tier = raw.tier === 'admin' ? 'admin' : 'readonly';
    return {
      phoneNumber: String(raw.phoneNumber ?? raw.phone ?? ''),
      name: String(raw.name ?? ''),
      tier,
    };
  }
  return null;
}

export function loadAllowlist(filePath = DEFAULT_ALLOWLIST_PATH) {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    let list = [];
    if (Array.isArray(parsed)) list = parsed;
    else if (Array.isArray(parsed?.allowlist)) list = parsed.allowlist;
    return list.map((raw) => normalizeEntry(raw)).filter(entry => entry && entry.phoneNumber);
  } catch {
    return [];
  }
}

export function saveAllowlist(list, filePath = DEFAULT_ALLOWLIST_PATH) {
  const normalized = (list ?? [])
    .map((raw) => normalizeEntry(raw))
    .filter(entry => entry && entry.phoneNumber);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(normalized, null, 2), { mode: 0o600 });
}

export function isDestructiveCommand(command) {
  return DESTRUCTIVE_COMMANDS.has(String(command ?? '').toUpperCase());
}

export function isAllowed(phoneNumber, allowlist, requiredTier = 'readonly') {
  if (!allowlist || allowlist.length === 0) {
    return { allowed: false, reason: 'not_allowlisted' };
  }
  const target = normalizePhone(phoneNumber);
  if (!target) return { allowed: false, reason: 'invalid_phone' };
  const entry = (allowlist ?? [])
    .map((raw) => normalizeEntry(raw))
    .find(item => item && normalizePhone(item.phoneNumber) === target);
  if (!entry) return { allowed: false, reason: 'not_allowlisted' };
  if (requiredTier === 'admin' && entry.tier !== 'admin') {
    return { allowed: false, reason: 'tier_required', entry };
  }
  return { allowed: true, entry };
}

export function checkRateLimit(phoneNumber, rateLimitMap, now = Date.now()) {
  const key = normalizePhone(phoneNumber);
  const entry = rateLimitMap.get(key);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    return { allowed: true, remaining: RATE_LIMIT_MAX, resetInMin: 60 };
  }
  const elapsed = now - entry.windowStart;
  const resetInMin = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - elapsed) / 60_000));
  const remaining = Math.max(0, RATE_LIMIT_MAX - entry.count);
  return { allowed: entry.count < RATE_LIMIT_MAX, remaining, resetInMin };
}

export function recordRateLimit(phoneNumber, rateLimitMap, now = Date.now()) {
  const key = normalizePhone(phoneNumber);
  const entry = rateLimitMap.get(key);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(key, { windowStart: now, count: 1 });
  } else {
    entry.count += 1;
  }
}

export function logCommand(phoneNumber, command, outcome, commandLog, now = Date.now()) {
  if (!commandLog) return;
  commandLog.unshift({
    from: normalizePhone(phoneNumber),
    command: String(command ?? ''),
    outcome: String(outcome ?? ''),
    at: now,
  });
  if (commandLog.length > 50) commandLog.length = 50;
}

// Validate a Twilio webhook request signature.
//
// Twilio signs each request with HMAC-SHA1 over (full request URL + the POST
// params concatenated in lexical key order, as key1value1key2value2...), keyed
// by the account's auth token, then base64-encodes the digest into the
// X-Twilio-Signature header. Caller-ID (the From number) is spoofable, so this
// signature is the only thing that proves the request actually came from Twilio.
//
// Returns false (never throws) when the token or signature is missing, or when
// the digests differ. The comparison is constant-time once lengths match.
export function validateTwilioSignature(authToken, url, params, signature) {
  if (!authToken || !signature) return false;
  const sortedKeys = Object.keys(params ?? {}).sort();
  const paramString = sortedKeys.reduce((acc, k) => acc + k + params[k], '');
  const expected = createHmac('sha1', authToken)
    .update(url + paramString)
    .digest('base64');
  let sigBuf;
  try {
    sigBuf = Buffer.from(signature, 'base64');
  } catch {
    return false;
  }
  const expBuf = Buffer.from(expected, 'base64');
  if (sigBuf.length !== expBuf.length) return false;
  return timingSafeEqual(sigBuf, expBuf);
}

// ── Config patch validation (R3-SEC-006) ────────────────────────────────────
// POST /api/sms/config used to spread any JSON into the live config. Only two
// keys are accepted now, each with a strict shape. New or changed numbers must
// be E.164 once formatting characters are stripped; numbers already saved are
// kept as they are, so an older config can still be edited.

export const SMS_ALLOWLIST_MAX = 25;
const SMS_CONFIG_KEYS = new Set(['enabled', 'allowlist']);
const SMS_ENTRY_KEYS = new Set(['phoneNumber', 'name', 'tier']);
const E164_RE = /^\+[1-9]\d{6,14}$/;
const NAME_MAX = 64;

function hasControlChar(value) {
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/** Strip spaces, dashes, dots and parentheses: "+1 (555) 000-0000" → "+15550000000". */
export function toE164(raw) {
  const compact = String(raw ?? '').replaceAll(/[\s().-]/g, '');
  return E164_RE.test(compact) ? compact : null;
}

function validateEntry(raw, savedNumbers) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'allowlist entries must be objects' };
  for (const key of Object.keys(raw)) {
    if (!SMS_ENTRY_KEYS.has(key)) return { error: `unknown allowlist field: ${key}` };
  }
  const given = typeof raw.phoneNumber === 'string' ? raw.phoneNumber.trim() : '';
  if (!given) return { error: 'phoneNumber is required' };
  const phoneNumber = savedNumbers.has(given) ? given : toE164(given);
  if (!phoneNumber) return { error: 'phoneNumber must be E.164, for example +15551234567' };
  if (raw.name !== undefined && typeof raw.name !== 'string') return { error: 'name must be a string' };
  const name = (raw.name ?? '').trim();
  if (name.length > NAME_MAX || hasControlChar(name)) return { error: `name must be at most ${NAME_MAX} plain characters` };
  if (raw.tier !== undefined && raw.tier !== 'admin' && raw.tier !== 'readonly') return { error: 'tier must be admin or readonly' };
  return { entry: { phoneNumber, name, tier: raw.tier ?? 'readonly' } };
}

/**
 * Validate a POST /api/sms/config body against the current config.
 * Returns `{ config }` (the merged result) or `{ error }` (a value-free reason).
 */
export function validateSmsConfigPatch(patch, current) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { error: 'config must be a JSON object' };
  for (const key of Object.keys(patch)) {
    if (!SMS_CONFIG_KEYS.has(key)) return { error: `unknown config field: ${key}` };
  }
  const next = { enabled: Boolean(current?.enabled), allowlist: [...(current?.allowlist ?? [])] };
  if (patch.enabled !== undefined) {
    if (typeof patch.enabled !== 'boolean') return { error: 'enabled must be a boolean' };
    next.enabled = patch.enabled;
  }
  if (patch.allowlist !== undefined) {
    const result = validateAllowlist(patch.allowlist, current?.allowlist ?? []);
    if (result.error) return { error: result.error };
    next.allowlist = result.entries;
  }
  return { config: next };
}

function validateAllowlist(list, savedList) {
  if (!Array.isArray(list)) return { error: 'allowlist must be an array' };
  if (list.length > SMS_ALLOWLIST_MAX) return { error: `allowlist holds at most ${SMS_ALLOWLIST_MAX} numbers` };
  const savedNumbers = new Set(savedList.map((entry) => entry?.phoneNumber).filter(Boolean));
  const entries = [];
  for (const raw of list) {
    const result = validateEntry(raw, savedNumbers);
    if (result.error) return { error: result.error };
    entries.push(result.entry);
  }
  return { entries };
}
