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
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.allowlist) ? parsed.allowlist : [];
    return list.map(normalizeEntry).filter(entry => entry && entry.phoneNumber);
  } catch {
    return [];
  }
}

export function saveAllowlist(list, filePath = DEFAULT_ALLOWLIST_PATH) {
  const normalized = (list ?? [])
    .map(normalizeEntry)
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
    .map(normalizeEntry)
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
