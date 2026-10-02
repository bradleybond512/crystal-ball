// Quota Governor (R4-BUG-005 step 2).
//
// Counts every sidecar call to a quota-limited provider *before* it is sent,
// keeps those counts across restarts, and honors the provider's own signals
// (429, Retry-After, X-Rate-Limit-Remaining / X-RateLimit-Reset). Step 1 chose
// safe TTLs; this makes the budget durable and visible:
//
// - Rolling windows (the last 24 h, not "today"), at most 1,440 buckets each,
//   so no window ever exceeds a limit and memory stays bounded.
// - Background refreshes stop at QUOTA_TARGET_SHARE (80%) of each limit. The
//   rest is a reserve for things Bradley triggers (key tests, manual lookups):
//   those are counted but never blocked — the provider is the final judge, and
//   a newly entered key has its own quota.
// - A provider cooldown is clamped to [1 min, the rule's longest window], so a
//   hostile or broken header can never pause a feed indefinitely.
// - The ledger holds rule ids, counts and times only: no URLs, keys or bodies.
//   It is written 0600 with an atomic replace, read only from a regular file
//   within a size cap, and every field is validated on load.

import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import {
  QUOTA_DEFAULT_COOLDOWN_MS,
  QUOTA_GENERIC_COOLDOWN_MAX_MS,
  QUOTA_LEDGER_WRITE_DELAY_MS,
  QUOTA_MIN_COOLDOWN_MS,
  QUOTA_PACING_FACTOR,
  QUOTA_PACING_SHARE,
  QUOTA_RULES,
  QUOTA_TARGET_SHARE,
} from './quota-policy.mjs';

export const QUOTA_LEDGER_FILE = 'quota-ledger.json';
export const QUOTA_LEDGER_MAX_BYTES = 2 * 1024 * 1024;
const LEDGER_VERSION = 1;
const MAX_BUCKETS = 1440;
const MIN_BUCKET_MS = 1000;
const FUTURE_SKEW_MS = 60_000;
const MAX_GENERIC_HOSTS = 64;
const MAX_COST = 1e9;
const MAX_TOKENS_PER_RESPONSE = 10_000_000;
const MAX_SETTLE_BODY_CHARS = 32 * 1024 * 1024;
const HOST_RE = /^[a-z\d.-]{1,253}$/;

export class QuotaExhaustedError extends Error {
  constructor({ ruleId = null, host = null, reason, retryAt = null }) {
    super(`quota_exhausted: ${ruleId ?? host} (${reason})`);
    this.name = 'QuotaExhaustedError';
    this.code = 'QUOTA_EXHAUSTED';
    this.provider = ruleId ?? host;
    this.reason = reason;
    this.retryAt = retryAt;
  }
}

export function isQuotaExhausted(error) {
  return error?.code === 'QUOTA_EXHAUSTED';
}

export function bucketMsFor(windowMs) {
  return Math.max(MIN_BUCKET_MS, Math.ceil(windowMs / MAX_BUCKETS));
}

/** The part of a limit background refreshes may use; null = no limit. */
export function backgroundCeiling(limit) {
  return limit == null ? null : Math.floor(limit * QUOTA_TARGET_SHARE);
}

function headerValue(headers, name) {
  if (!headers) return null;
  const value = typeof headers.get === 'function' ? headers.get(name) : headers[name];
  if (Array.isArray(value)) return value[0] == null ? null : String(value[0]);
  return value == null ? null : String(value);
}

/** `Retry-After`: delay in seconds or an HTTP date → absolute ms, else null. */
export function parseRetryAfter(value, nowMs) {
  if (value == null) return null;
  const text = String(value).trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return nowMs + Math.round(Number(text) * 1000);
  if (!/[a-z]/i.test(text)) return null;
  const date = Date.parse(text);
  return Number.isFinite(date) ? date : null;
}

/** `X-RateLimit-Reset`: epoch seconds or ms, or a small delta in seconds. */
export function parseRateLimitReset(value, nowMs) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const n = Number(text);
  if (n > 1e12) return n;
  if (n > 1e9) return n * 1000;
  return nowMs + n * 1000;
}

function providerRetryAt(headers, nowMs) {
  return parseRetryAfter(headerValue(headers, 'retry-after'), nowMs)
    ?? parseRetryAfter(headerValue(headers, 'x-rate-limit-retry-after-seconds'), nowMs)
    ?? parseRateLimitReset(headerValue(headers, 'x-ratelimit-reset'), nowMs)
    ?? parseRateLimitReset(headerValue(headers, 'x-rate-limit-reset'), nowMs);
}

function providerRemaining(headers) {
  for (const name of ['x-rate-limit-remaining', 'x-ratelimit-remaining']) {
    const value = headerValue(headers, name);
    if (value != null && /^-?\d+(?:\.\d+)?$/.test(value.trim())) return Number(value);
  }
  return null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampCost(value) {
  return Number.isFinite(value) && value > 0 ? Math.min(MAX_COST, Math.ceil(value)) : 1;
}

function toUrl(input) {
  try {
    const url = input instanceof URL ? input : new URL(String(input));
    return url;
  } catch {
    return null;
  }
}

function normalizedHost(url) {
  return url.hostname.toLowerCase().replace(/\.$/, '');
}

function compileRules(rules) {
  return rules.map((rule) => Object.freeze({
    ...rule,
    host: rule.host.toLowerCase(),
    maxWindowMs: Math.max(...rule.windows.map((w) => w.ms)),
    windows: rule.windows.map((w) => Object.freeze({ ...w, bucketMs: bucketMsFor(w.ms), ceiling: backgroundCeiling(w.limit) })),
  }));
}

function emptyState(rule) {
  return {
    series: rule.windows.map(() => new Map()),
    tokens: rule.tracksTokens ? new Map() : null,
    cooldownUntil: 0,
    cooldownReason: null,
    remaining: null,
    last429At: null,
    lastRows: null,
  };
}

function bucketStart(time, bucketMs) {
  return Math.floor(time / bucketMs) * bucketMs;
}

/** Buckets overlapping (now - window, now]; older ones are pruned. */
function usedIn(series, window, now) {
  let used = 0;
  for (const [start, cost] of series) {
    if (start + window.bucketMs <= now - window.ms) series.delete(start);
    else used += cost;
  }
  return used;
}

/** When enough old buckets expire that `excess` more units fit. */
function freeAt(series, window, now, excess) {
  let freed = 0;
  for (const start of [...series.keys()].sort((a, b) => a - b)) {
    freed += series.get(start);
    if (freed >= excess) return Math.max(now + 1, start + window.bucketMs + window.ms);
  }
  return now + window.ms;
}

function readSeries(raw, window, now) {
  const series = new Map();
  if (!Array.isArray(raw)) return series;
  for (const entry of raw.slice(-(MAX_BUCKETS + 2))) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const [start, cost] = entry;
    if (!Number.isSafeInteger(start) || start <= 0 || start > now + FUTURE_SKEW_MS) continue;
    if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0 || cost > MAX_COST) continue;
    if (start + window.bucketMs <= now - window.ms) continue;
    series.set(start, (series.get(start) ?? 0) + cost);
  }
  return series;
}

function readRuleState(rule, raw, t) {
  const state = emptyState(rule);
  if (Array.isArray(raw.windows) && raw.windows.length === rule.windows.length) {
    state.series = rule.windows.map((w, i) => readSeries(raw.windows[i], w, t));
  }
  if (state.tokens) state.tokens = readSeries(raw.tokens, rule.windows[0], t);
  if (typeof raw.cooldownUntil === 'number' && Number.isFinite(raw.cooldownUntil) && raw.cooldownUntil > t) {
    // A tampered or skewed ledger can never pause a feed beyond its window.
    state.cooldownUntil = Math.min(raw.cooldownUntil, t + rule.maxWindowMs);
    state.cooldownReason = typeof raw.cooldownReason === 'string' ? raw.cooldownReason.slice(0, 40) : 'provider';
  }
  const rem = raw.remaining;
  if (rem && typeof rem.value === 'number' && Number.isFinite(rem.value) && Number.isSafeInteger(rem.at) && rem.at <= t + FUTURE_SKEW_MS) {
    state.remaining = { value: rem.value, at: rem.at };
  }
  if (Number.isSafeInteger(raw.last429At) && raw.last429At <= t + FUTURE_SKEW_MS) state.last429At = raw.last429At;
  if (Number.isSafeInteger(raw.lastRows) && raw.lastRows >= 0 && raw.lastRows <= MAX_COST) state.lastRows = raw.lastRows;
  return state;
}

function readHostCooldowns(raw, t, into) {
  if (!Array.isArray(raw)) return;
  for (const entry of raw.slice(0, MAX_GENERIC_HOSTS)) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const [host, until] = entry;
    if (typeof host === 'string' && HOST_RE.test(host) && typeof until === 'number' && until > t) {
      into.set(host, Math.min(until, t + QUOTA_GENERIC_COOLDOWN_MAX_MS));
    }
  }
}

function costFor(rule, state, url) {
  if (rule.cost) return clampCost(rule.cost(url));
  if (rule.pointsPerRow) return clampCost(rule.pointsPerRow(url) * Math.max(1, state.lastRows ?? 1));
  return 1;
}

function deny(rule, host, reason, retryAt) {
  return { allowed: false, ruleId: rule?.id ?? null, host, reason, retryAt };
}

/** The first window a background call of `cost` would overrun, as a denial; else null. */
function budgetDenial(rule, state, host, cost, t) {
  for (const [i, w] of rule.windows.entries()) {
    if (w.ceiling == null) continue;
    const used = usedIn(state.series[i], w, t);
    if (used + cost > w.ceiling) return deny(rule, host, 'budget', freeAt(state.series[i], w, t, used + cost - w.ceiling));
  }
  return null;
}

/** When a background call of `cost` could next go out; null = now. */
function nextAllowedAt(rule, state, cost, t) {
  let until = state.cooldownUntil > t ? state.cooldownUntil : null;
  for (const [i, w] of rule.windows.entries()) {
    if (w.ceiling == null) continue;
    const used = usedIn(state.series[i], w, t);
    if (used + cost > w.ceiling) until = Math.max(until ?? 0, freeAt(state.series[i], w, t, used + cost - w.ceiling));
  }
  return until;
}

function usageRatio(rule, state, t) {
  let ratio = 0;
  for (const [i, w] of rule.windows.entries()) {
    if (w.ceiling) ratio = Math.max(ratio, usedIn(state.series[i], w, t) / w.ceiling);
  }
  return ratio;
}

function settle(rule, state, ticket, actual) {
  const delta = clampCost(actual) - ticket.cost;
  if (delta === 0) return;
  for (const [i, series] of state.series.entries()) {
    const start = ticket.marks[i];
    series.set(start, Math.max(0, (series.get(start) ?? 0) + delta));
  }
}

function parseJson(bodyText) {
  if (typeof bodyText !== 'string' || bodyText.length > MAX_SETTLE_BODY_CHARS) return null;
  try {
    return JSON.parse(bodyText);
  } catch {
    return null;
  }
}

/** 429 / 402 / "remaining: 0" start a cooldown, clamped to [1 min, the longest window]. */
function applyProviderSignals(rule, state, status, headers, t) {
  const remaining = providerRemaining(headers);
  if (remaining != null) state.remaining = { value: remaining, at: t };
  if (status !== 429 && status !== 402 && !(remaining != null && remaining <= 0)) return;
  const at = providerRetryAt(headers, t) ?? t + QUOTA_DEFAULT_COOLDOWN_MS;
  state.cooldownUntil = clamp(at, t + QUOTA_MIN_COOLDOWN_MS, t + rule.maxWindowMs);
  if (status === 429) {
    state.cooldownReason = 'provider_429';
    state.last429At = t;
  } else {
    state.cooldownReason = status === 402 ? 'provider_out_of_credit' : 'provider_remaining_0';
  }
}

/** Estimated points settle to the rows actually returned; token usage is tallied. */
function applyBody(rule, state, ticket, bodyText, t) {
  if (!rule.pointsPerRow && !state.tokens) return;
  const body = parseJson(bodyText);
  if (rule.pointsPerRow && Array.isArray(body?.data)) {
    state.lastRows = body.data.length;
    settle(rule, state, ticket, rule.pointsPerRow(ticket.url) * Math.max(1, body.data.length));
  }
  if (state.tokens) {
    const usage = body?.usage;
    const tokens = [usage?.input_tokens, usage?.output_tokens]
      .filter((n) => Number.isSafeInteger(n) && n >= 0)
      .reduce((sum, n) => sum + n, 0);
    if (tokens > 0) {
      const start = bucketStart(t, rule.windows[0].bucketMs);
      state.tokens.set(start, (state.tokens.get(start) ?? 0) + Math.min(tokens, MAX_TOKENS_PER_RESPONSE));
    }
  }
}

function writeAtomic(filePath, body, logger) {
  const tmp = `${filePath}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = openSync(tmp, 'wx', 0o600);
    writeSync(fd, body);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tmp, filePath);
  } catch (error) {
    logger.warn?.(`[quota-governor] ledger write failed: ${error?.code ?? error}`);
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* already closed */ }
    }
    try { unlinkSync(tmp); } catch { /* nothing to clean */ }
  }
}

function readLedgerFile(filePath, maxBytes, logger) {
  let text;
  try {
    const stat = lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) {
      logger.warn?.('[quota-governor] ignoring unsafe or oversized ledger');
      return null;
    }
    text = readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') logger.warn?.(`[quota-governor] ledger read failed: ${error?.code ?? error}`);
    return null;
  }
  const parsed = parseJson(text);
  if (!parsed) {
    logger.warn?.('[quota-governor] ignoring malformed ledger');
    return null;
  }
  if (parsed.version !== LEDGER_VERSION || typeof parsed.rules !== 'object' || parsed.rules === null) return null;
  return parsed;
}

function providerStatus(rule, state, t) {
  const windows = rule.windows.map((w, i) => ({
    windowMs: w.ms,
    limit: w.limit,
    backgroundCeiling: w.ceiling,
    used: usedIn(state.series[i], w, t),
  }));
  const full = windows.findIndex((w) => w.backgroundCeiling != null && w.used >= w.backgroundCeiling);
  const cooling = state.cooldownUntil > t;
  let stateName = 'ok';
  if (cooling) stateName = 'cooldown';
  else if (full !== -1) stateName = 'background_paused';
  else if (usageRatio(rule, state, t) >= QUOTA_PACING_SHARE) stateName = 'paced';
  return {
    id: rule.id,
    label: rule.label,
    unit: rule.unit,
    estimate: Boolean(rule.estimate),
    unverified: Boolean(rule.unverified),
    observeOnly: rule.windows.every((w) => w.limit == null),
    state: stateName,
    windows,
    cooldownUntil: cooling ? state.cooldownUntil : null,
    cooldownReason: cooling ? state.cooldownReason : null,
    budgetFreesAt: full === -1
      ? null
      : freeAt(state.series[full], rule.windows[full], t, windows[full].used + 1 - windows[full].backgroundCeiling),
    providerRemaining: state.remaining,
    last429At: state.last429At,
    ...(state.tokens && { tokens: usedIn(state.tokens, rule.windows[0], t) }),
  };
}

export function createQuotaGovernor({
  rules = QUOTA_RULES,
  filePath = null,
  now = () => Date.now(),
  logger = console,
  writeDelayMs = QUOTA_LEDGER_WRITE_DELAY_MS,
  maxBytes = QUOTA_LEDGER_MAX_BYTES,
} = {}) {
  const compiled = compileRules(rules);
  const byId = new Map(compiled.map((rule) => [rule.id, rule]));
  const states = new Map(compiled.map((rule) => [rule.id, emptyState(rule)]));
  const hostCooldowns = new Map();
  let timer = null;
  let loaded = false;

  function ensureLoaded() {
    if (loaded) return;
    loaded = true;
    if (!filePath) return;
    const parsed = readLedgerFile(filePath, maxBytes, logger);
    if (!parsed) return;
    const t = now();
    for (const [id, raw] of Object.entries(parsed.rules)) {
      const rule = byId.get(id);
      if (rule && raw && typeof raw === 'object') states.set(id, readRuleState(rule, raw, t));
    }
    readHostCooldowns(parsed.hosts, t, hostCooldowns);
  }

  function serialize() {
    const t = now();
    const out = { version: LEDGER_VERSION, savedAt: t, rules: {}, hosts: [] };
    for (const rule of compiled) {
      const state = states.get(rule.id);
      for (const [i, w] of rule.windows.entries()) usedIn(state.series[i], w, t);
      const cooling = state.cooldownUntil > t;
      out.rules[rule.id] = {
        windows: state.series.map((series) => [...series]),
        ...(state.tokens && { tokens: [...state.tokens] }),
        cooldownUntil: cooling ? state.cooldownUntil : 0,
        cooldownReason: cooling ? state.cooldownReason : null,
        remaining: state.remaining,
        last429At: state.last429At,
        lastRows: state.lastRows,
      };
    }
    for (const [host, until] of hostCooldowns) if (until > t) out.hosts.push([host, until]);
    return JSON.stringify(out);
  }

  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!filePath || !loaded) return;
    const body = serialize();
    if (Buffer.byteLength(body) > maxBytes) {
      logger.warn?.('[quota-governor] ledger exceeds size cap; keeping it in memory only');
      return;
    }
    writeAtomic(filePath, body, logger);
  }

  function scheduleWrite() {
    if (!filePath || timer) return;
    timer = setTimeout(flush, writeDelayMs);
    timer.unref?.();
  }

  function matchRule(url) {
    const host = normalizedHost(url);
    let best = null;
    for (const rule of compiled) {
      if (host !== rule.host || !url.pathname.startsWith(rule.pathPrefix)) continue;
      if (!best || rule.pathPrefix.length > best.pathPrefix.length) best = rule;
    }
    return best;
  }

  function admitUngoverned(url, host, interactive, t) {
    const https = url.protocol === 'https:';
    const until = hostCooldowns.get(host);
    if (!interactive && https && until > t) return deny(null, host, 'cooldown', until);
    return { allowed: true, ruleId: null, host, https };
  }

  /** Count a call before it is sent; a denial means "do not send". */
  function admit(input, { priority = 'background' } = {}) {
    ensureLoaded();
    const url = toUrl(input);
    if (!url) return { allowed: true, ruleId: null, host: null };
    const t = now();
    const host = normalizedHost(url);
    const interactive = priority === 'interactive';
    const rule = matchRule(url);
    if (!rule) return admitUngoverned(url, host, interactive, t);
    const state = states.get(rule.id);
    const cost = costFor(rule, state, url);
    if (!interactive) {
      if (state.cooldownUntil > t) return deny(rule, host, 'cooldown', state.cooldownUntil);
      const denial = budgetDenial(rule, state, host, cost, t);
      if (denial) return denial;
    }
    const marks = rule.windows.map((w, i) => {
      const start = bucketStart(t, w.bucketMs);
      state.series[i].set(start, (state.series[i].get(start) ?? 0) + cost);
      return start;
    });
    scheduleWrite();
    return { allowed: true, ruleId: rule.id, host, cost, marks, url, priority: interactive ? 'interactive' : 'background' };
  }

  /** A non-governed https host answering 429 + Retry-After is left alone briefly. */
  function observeUngoverned(ticket, status, headers, t) {
    if (status !== 429 || !ticket.https || !ticket.host) return;
    const at = providerRetryAt(headers, t);
    if (at == null) return;
    hostCooldowns.delete(ticket.host);
    hostCooldowns.set(ticket.host, clamp(at, t + QUOTA_MIN_COOLDOWN_MS, t + QUOTA_GENERIC_COOLDOWN_MAX_MS));
    while (hostCooldowns.size > MAX_GENERIC_HOSTS) hostCooldowns.delete(hostCooldowns.keys().next().value);
    scheduleWrite();
  }

  /** Update the ledger from the provider's response. */
  function observe(ticket, { status, headers, bodyText } = {}) {
    if (!ticket?.allowed) return;
    const t = now();
    if (!ticket.ruleId) {
      observeUngoverned(ticket, status, headers, t);
      return;
    }
    const rule = byId.get(ticket.ruleId);
    const state = states.get(ticket.ruleId);
    applyProviderSignals(rule, state, status, headers, t);
    if (status >= 200 && status < 300) applyBody(rule, state, ticket, bodyText, t);
    scheduleWrite();
  }

  return {
    admit,
    observe,
    flush,
    /** Refresh interval for a governed feed: doubled once background use reaches the pacing share. */
    ttlFor(ruleId, baseTtlMs) {
      ensureLoaded();
      const rule = byId.get(ruleId);
      if (!rule) return baseTtlMs;
      return usageRatio(rule, states.get(ruleId), now()) >= QUOTA_PACING_SHARE ? baseTtlMs * QUOTA_PACING_FACTOR : baseTtlMs;
    },
    /** When a background call costing `cost` could next go out; null = now. */
    blockedUntil(ruleId, cost = 1) {
      ensureLoaded();
      const rule = byId.get(ruleId);
      return rule ? nextAllowedAt(rule, states.get(ruleId), cost, now()) : null;
    },
    /** True when observe() needs the response body (estimated points, token usage). */
    wantsBody(ticket) {
      const rule = ticket?.ruleId ? byId.get(ticket.ruleId) : null;
      return Boolean(rule && (rule.pointsPerRow || rule.tracksTokens));
    },
    /** A changed key gets a fresh start from the provider's point of view; counts stay. */
    resetSignalsForSecret(secretKey) {
      ensureLoaded();
      let changed = false;
      for (const rule of compiled) {
        if (!rule.secretKeys?.includes(secretKey)) continue;
        const state = states.get(rule.id);
        state.cooldownUntil = 0;
        state.cooldownReason = null;
        state.remaining = null;
        changed = true;
      }
      if (changed) scheduleWrite();
      return changed;
    },
    status() {
      ensureLoaded();
      const t = now();
      const providers = compiled.map((rule) => providerStatus(rule, states.get(rule.id), t));
      const throttledHosts = [...hostCooldowns]
        .filter(([, until]) => until > t)
        .map(([host, until]) => ({ host, until }));
      return { asOf: t, targetShare: QUOTA_TARGET_SHARE, providers, throttledHosts };
    },
  };
}
