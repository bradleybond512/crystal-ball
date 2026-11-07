import type { RuntimeSecretKey } from './runtime-config';

const reasons = {
  'provider-accepted': ['verified', 'Provider verified.'],
  'provider-rejected': ['rejected', 'Provider rejected the credential.'],
  'provider-unavailable': ['unavailable', 'Could not reach the verification service.'],
  'inconclusive-response': ['unavailable', 'Could not verify the credential.'],
  'rate-limited': ['unavailable', 'The provider limited this check.'],
  'concurrency-limit': ['unavailable', 'Two credential checks are already running.'],
  cooldown: ['unavailable', 'Wait one minute between checks for this credential.'],
  timeout: ['unavailable', 'The credential check timed out.'],
  'invalid-format': ['invalid-format', 'A well-formed value is required.'],
  'unsupported-probe': ['not-probed', 'No supported credential check.'],
} as const;

export type CredentialProbeReason = keyof typeof reasons;
export interface SecretVerificationResult {
  outcome: typeof reasons[CredentialProbeReason][0];
  reason: CredentialProbeReason;
  canSave: boolean;
  message: string;
}

export function probeResult(reason: CredentialProbeReason): SecretVerificationResult {
  const [outcome, message] = reasons[reason];
  return { reason, outcome, message, canSave: outcome !== 'rejected' && outcome !== 'invalid-format' };
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export async function readProbeBody(response: Response, signal: AbortSignal): Promise<Record<string, unknown> | undefined> {
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const limit = 128 * 1024;
    if (signal.aborted || Number(response.headers.get('Content-Length')) > limit) {
      cancel();
      return undefined;
    }
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let text = '';
    let bytes = 0;
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) return signal.aborted ? undefined : object(JSON.parse(text + decoder.decode()));
      bytes += value.byteLength;
      if (bytes > limit) {
        cancel();
        return undefined;
      }
      text += decoder.decode(value, { stream: true });
    }
    return undefined;
  } catch {
    cancel();
    return undefined;
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

export function sidecarProbeResult(body: Record<string, unknown> | undefined): SecretVerificationResult {
  if (body && Object.keys(body).length === 2 && typeof body.reason === 'string' && Object.prototype.hasOwnProperty.call(reasons, body.reason)) {
    const result = probeResult(body.reason as CredentialProbeReason);
    if (result.outcome === body.outcome) {
      // A different window may just have received a definitive rejection.
      if (result.reason === 'cooldown' || result.reason === 'concurrency-limit') return { ...result, canSave: false };
      return result;
    }
  }
  return probeResult('inconclusive-response');
}

const browserProviders = {
  GROQ_API_KEY: 'https://api.groq.com/openai/v1/models',
  ANTHROPIC_API_KEY: 'https://api.anthropic.com/v1/models',
  CESIUM_ION_TOKEN: 'https://api.cesium.com/v1/assets?limit=1',
} as const;

const PROBE_LOCK = 'cb:credential-probe:v1:';

function refused(reason: 'cooldown' | 'concurrency-limit'): SecretVerificationResult {
  return { ...probeResult(reason), canSave: false };
}

async function withBrowserCapacity(key: string, signal: AbortSignal, send: () => Promise<SecretVerificationResult>): Promise<SecretVerificationResult> {
  for (const slot of [0, 1]) {
    const result = await navigator.locks.request(PROBE_LOCK + 'slot:' + slot, { ifAvailable: true }, async lock => {
      if (!lock) return null;
      if (signal.aborted) return probeResult('timeout');
      localStorage.setItem(PROBE_LOCK + 'last:' + key, String(Date.now()));
      let onAbort!: () => void;
      const deadline = new Promise<SecretVerificationResult>(resolve => {
        onAbort = () => resolve(probeResult('timeout'));
        signal.addEventListener('abort', onAbort, { once: true });
      });
      try { return await Promise.race([send(), deadline]); }
      finally { signal.removeEventListener('abort', onAbort); }
    });
    if (result) return result;
  }
  return refused('concurrency-limit');
}

async function scheduleBrowserProbe(key: string, signal: AbortSignal, send: () => Promise<SecretVerificationResult>): Promise<SecretVerificationResult> {
  try {
    return await navigator.locks.request(PROBE_LOCK + 'key:' + key, { ifAvailable: true }, async lock => {
      if (!lock) return refused('cooldown');
      const raw = localStorage.getItem(PROBE_LOCK + 'last:' + key);
      if (raw !== null && (!/^\d{1,15}$/.test(raw) || Date.now() - Number(raw) < 60_000)) return refused('cooldown');
      return withBrowserCapacity(key, signal, send);
    });
  } catch {
    return probeResult('provider-unavailable');
  }
}

export async function probeBrowser(key: RuntimeSecretKey, value: string, signal: AbortSignal, begin?: () => boolean): Promise<SecretVerificationResult> {
  if (key !== 'GROQ_API_KEY' && key !== 'ANTHROPIC_API_KEY' && key !== 'CESIUM_ION_TOKEN') {
    return probeResult(begin && !begin() ? 'inconclusive-response' : 'unsupported-probe');
  }
  return scheduleBrowserProbe(key, signal, async () => {
    if (begin && !begin()) return probeResult('inconclusive-response');
    return fetchBrowserProbe(key, value, signal);
  });
}

async function fetchBrowserProbe(key: keyof typeof browserProviders, value: string, signal: AbortSignal): Promise<SecretVerificationResult> {
  const headers: Record<string, string> = key === 'ANTHROPIC_API_KEY'
    ? { 'x-api-key': value, 'anthropic-version': '2023-06-01' }
    : { Authorization: `Bearer ${value}` };
  const response = await fetch(browserProviders[key], {
    headers, signal, redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
  });
  if (response.status !== 200 && response.status !== 401) {
    void response.body?.cancel().catch(() => undefined);
    return probeResult(response.status === 429 ? 'rate-limited' : 'provider-unavailable');
  }
  const body = await readProbeBody(response, signal);
  return classifyBrowser(key, response.status, body);
}

function classifyBrowser(key: keyof typeof browserProviders, status: number, body: Record<string, unknown> | undefined): SecretVerificationResult {
  if (!body) return probeResult('inconclusive-response');
  if (status === 401) {
    const error = object(body.error);
    const denied = (key === 'GROQ_API_KEY' && error?.code === 'invalid_api_key')
      || (key === 'ANTHROPIC_API_KEY' && body.type === 'error' && error?.type === 'authentication_error');
    return probeResult(denied ? 'provider-rejected' : 'inconclusive-response');
  }
  if ('error' in body) return probeResult('inconclusive-response');
  if (key === 'CESIUM_ION_TOKEN') {
    const assets = body.items;
    return probeResult(Array.isArray(assets) && assets.length > 0 && assets.every(a =>
      Number.isSafeInteger(object(a)?.id) && typeof object(a)?.name === 'string') ? 'provider-accepted' : 'inconclusive-response');
  }
  const models = body.data;
  const modelTag = key === 'GROQ_API_KEY' ? 'object' : 'type';
  const isModel = (value: unknown) => {
    const model = object(value);
    return model?.[modelTag] === 'model' && typeof model.id === 'string' && model.id.trim() !== '';
  };
  const valid = (key !== 'GROQ_API_KEY' || body.object === 'list') && Array.isArray(models) && models.length > 0
    && models.every(model => isModel(model));
  return probeResult(valid ? 'provider-accepted' : 'inconclusive-response');
}

interface Attempt {
  value?: string;
  companion?: string;
  stored: boolean;
  promise: Promise<SecretVerificationResult>;
}

export function createCredentialScheduler() {
  const running = new Map<RuntimeSecretKey, Attempt>();
  const last = new Map<RuntimeSecretKey, { at: number; canSave: boolean }>();
  return (key: RuntimeSecretKey, identity: Omit<Attempt, 'promise'>, deadlineMs: number,
    run: (signal: AbortSignal) => Promise<SecretVerificationResult>,
    finish?: (result: SecretVerificationResult) => SecretVerificationResult): Promise<SecretVerificationResult> => {
    const active = running.get(key);
    if (active && active.value === identity.value && active.companion === identity.companion && active.stored === identity.stored) {
      return active.promise;
    }
    const previous = last.get(key);
    if (active || (previous && performance.now() - previous.at < 60_000)) {
      return Promise.resolve({ ...probeResult('cooldown'), canSave: !active && previous?.canSave === true });
    }
    if (running.size >= 2) return Promise.resolve({ ...probeResult('concurrency-limit'), canSave: previous?.canSave !== false });
    const controller = new AbortController();
    const stamp = { at: performance.now(), canSave: false };
    last.set(key, stamp);
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<SecretVerificationResult>(resolve => {
      timer = setTimeout(() => { resolve(probeResult('timeout')); controller.abort(); }, deadlineMs);
    });
    const promise = Promise.race([timeout, Promise.resolve().then(() => run(controller.signal))])
      .catch(() => probeResult('provider-unavailable'))
      .then(result => finish ? finish(result) : result)
      .then(result => {
        if (result.reason === 'cooldown' || result.reason === 'concurrency-limit') last.delete(key);
        else stamp.canSave = result.canSave;
        return result;
      })
      .finally(() => { clearTimeout(timer); running.delete(key); });
    running.set(key, { ...identity, promise });
    return promise;
  };
}
