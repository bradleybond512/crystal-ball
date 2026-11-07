import type { RuntimeSecretKey } from './runtime-config';

const PREFIX = 'cb:credential-evidence:v1:';
const DAY = 86_400_000;
const EVENT = 'cb:credential-evidence-changed';
const reasons = {
  'provider-accepted': 'verified',
  'provider-rejected': 'rejected',
  'rate-limited': 'unavailable',
  'provider-unavailable': 'unavailable',
  'inconclusive-response': 'unavailable',
  'timeout': 'unavailable',
  'unsupported-probe': 'not-probed',
  'invalid-format': 'invalid-format',
} as const;

type Reason = keyof typeof reasons;
type Outcome = typeof reasons[Reason];
type EvidenceState = Outcome | 'unset' | 'unverified' | 'stale' | 'historical';
interface Stamp { outcome: Outcome; reason: Reason; at: number; scope?: 'sidecar-copy' }
interface Receipt { version: 1; latest: Stamp; previous?: Stamp }
interface Attempt { key: RuntimeSecretKey; id: string; epoch: string | null; global: string | null }
interface Display { state: EvidenceState; text: string; title: string }

const pending = new Map<RuntimeSecretKey, Attempt>();
const current = new Map<RuntimeSecretKey, { attempt: Attempt; raw: string }>();
const pairs: Partial<Record<RuntimeSecretKey, RuntimeSecretKey>> = {
  OPENSKY_CLIENT_SECRET: 'OPENSKY_CLIENT_ID',
  OLLAMA_MODEL: 'OLLAMA_API_URL',
};

function epochKey(key: RuntimeSecretKey): string {
  return PREFIX + 'epoch:' + (pairs[key] ?? key);
}

function notify(): void {
  if (typeof window !== 'undefined') window.dispatchEvent?.(new Event(EVENT));
}

if (typeof window !== 'undefined') {
  window.addEventListener?.('storage', event => {
    if (event.key === null || event.key.startsWith(PREFIX)) notify();
  });
}

function forgetBindings<T>(cache: Map<RuntimeSecretKey, T>, key?: RuntimeSecretKey): void {
  if (!key) {
    cache.clear();
    return;
  }
  for (const slot of cache.keys()) {
    if (epochKey(slot) === epochKey(key)) cache.delete(slot);
  }
}

export function invalidateCredentialEvidence(key?: RuntimeSecretKey, publish = true): void {
  forgetBindings(current, key);
  forgetBindings(pending, key);
  if (publish) {
    try {
      localStorage.setItem(key ? epochKey(key) : PREFIX + 'epoch', crypto.randomUUID());
    } catch { /* This window has already dropped its bindings. */ }
  }
  notify();
}

export function beginStoredCredentialCheck(key: RuntimeSecretKey): Attempt | null {
  pending.delete(key);
  try {
    const attempt = {
      key, id: crypto.randomUUID(),
      epoch: localStorage.getItem(epochKey(key)), global: localStorage.getItem(PREFIX + 'epoch'),
    };
    localStorage.setItem(PREFIX + 'attempt:' + key, attempt.id);
    pending.set(key, attempt);
    return attempt;
  } catch {
    return null;
  }
}

function matchesEpoch(attempt: Attempt): boolean {
  return attempt.epoch === localStorage.getItem(epochKey(attempt.key))
    && attempt.global === localStorage.getItem(PREFIX + 'epoch');
}

function validTime(value: unknown, now: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= now && value <= 8.64e15;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stamp(value: unknown, now: number): Stamp | undefined {
  if (!object(value) || !validTime(value.at, now) || typeof value.reason !== 'string'
      || !Object.prototype.hasOwnProperty.call(reasons, value.reason)) return;
  const reason = value.reason as Reason;
  if (reasons[reason] !== value.outcome) return;
  return { outcome: reasons[reason], reason, at: value.at, scope: value.scope === 'sidecar-copy' ? 'sidecar-copy' : undefined };
}

function isConclusive(check: Stamp): boolean {
  return check.outcome === 'verified' || check.outcome === 'rejected';
}

function parse(raw: string | null): unknown {
  try { return raw ? JSON.parse(raw) : undefined; } catch { return; }
}

function receipt(raw: string | null, now: number): Receipt | undefined {
  const value = parse(raw);
  if (!object(value) || value.version !== 1) return;
  const latest = stamp(value.latest, now);
  if (!latest) return;
  const previous = stamp(value.previous, latest.at);
  return { version: 1, latest, previous: previous && isConclusive(previous) ? previous : undefined };
}

export function completeStoredCredentialCheck(
  attempt: Attempt | null, result: { outcome: string; reason: string },
  { historicalOnly = false, now = Date.now() }: { historicalOnly?: boolean; now?: number } = {},
): boolean {
  if (!attempt || pending.get(attempt.key) !== attempt) return false;
  pending.delete(attempt.key);
  const latest = stamp({ outcome: result.outcome, reason: result.reason, at: now }, now);
  if (!latest) return false;
  if (historicalOnly) latest.scope = 'sidecar-copy';
  try {
    if (!matchesEpoch(attempt) || localStorage.getItem(PREFIX + 'attempt:' + attempt.key) !== attempt.id) return false;
    const key = PREFIX + attempt.key;
    const prior = receipt(localStorage.getItem(key), now);
    const previous = prior && (isConclusive(prior.latest) ? prior.latest : prior.previous);
    const raw = JSON.stringify({ version: 1, latest, previous: isConclusive(latest) ? undefined : previous });
    localStorage.setItem(key, raw);
    if (historicalOnly) current.delete(attempt.key);
    else current.set(attempt.key, { attempt, raw });
    localStorage.removeItem('cb:key-status:' + attempt.key);
  } catch {
    current.delete(attempt.key);
    return false;
  }
  notify();
  return true;
}

function age(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return minutes + ' min ago';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
  const days = Math.floor(hours / 24);
  return days + (days === 1 ? ' day ago' : ' days ago');
}

const labels: Record<Reason, string> = {
  'provider-accepted': 'Provider verified',
  'provider-rejected': 'Provider rejected',
  'rate-limited': 'Could not verify (rate limited)',
  'provider-unavailable': 'Could not verify (provider unavailable)',
  'inconclusive-response': 'Could not verify (inconclusive response)',
  'timeout': 'Could not verify (timed out)',
  'unsupported-probe': 'Not tested (no supported probe)',
  'invalid-format': 'Format invalid',
};

function describe(check: Stamp, now: number): string {
  const scope = check.scope === 'sidecar-copy' ? ' (sidecar copy)' : '';
  return labels[check.reason] + scope + ' · ' + age(check.at, now);
}

const unverified: Display = { state: 'unverified', text: 'Saved, not verified', title: '' };

function legacyDisplay(key: RuntimeSecretKey, now: number): Display {
  const old = parse(localStorage.getItem('cb:key-status:' + key));
  if (!object(old) || !validTime(old.lastChecked, now) || (old.state !== 'valid' && old.state !== 'invalid')) return unverified;
  return {
    state: 'historical',
    text: 'Saved, not verified · Previous check ' + age(old.lastChecked, now),
    title: 'Previous check: ' + new Date(old.lastChecked).toISOString(),
  };
}

function displayReceipt({ latest, previous }: Receipt, bound: boolean, now: number): Display {
  const stale = isConclusive(latest) && now - latest.at >= DAY;
  let state: EvidenceState = stale ? 'stale' : latest.outcome;
  if (!bound) state = 'historical';
  let text = (bound ? '' : 'Saved, not verified · Previous check: ') + describe(latest, now);
  let title = labels[latest.reason] + ': ' + new Date(latest.at).toISOString();
  if (stale) text += ' (stale)';
  if (previous) {
    text += ' · Previous result: ' + describe(previous, now);
    if (now - previous.at >= DAY) text += ' (stale)';
    title += ' · Previous result: ' + labels[previous.reason] + ', ' + new Date(previous.at).toISOString();
  }
  return { state, text, title };
}

export function getCredentialEvidenceDisplay(key: RuntimeSecretKey, present: boolean, now = Date.now()): Display {
  if (!present) return { state: 'unset', text: 'Not set', title: '' };
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return legacyDisplay(key, now);
    const stored = receipt(raw, now);
    if (!stored) return unverified;
    const binding = current.get(key);
    const bound = !!binding && binding.raw === raw && matchesEpoch(binding.attempt)
      && localStorage.getItem(PREFIX + 'attempt:' + key) === binding.attempt.id;
    return displayReceipt(stored, bound, now);
  } catch {
    return unverified;
  }
}
