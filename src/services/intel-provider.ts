 
/**
 * Intel provider — abstraction over local LLM (LM Studio / Ollama via the
 * sidecar) with optional fallback to the cloud Claude agent.
 *
 * Routing:
 *   1. If `crystalball-intel-provider` localStorage is 'claude', use Claude.
 *   2. Otherwise try the local OpenAI-compatible endpoint via /api/intel-generate.
 *   3. On local failure, fall through to Claude (only if not in 'local-only' mode).
 *
 * Default provider is 'local' — assumes LM Studio is running on :1234.
 */

import { getApiBaseUrl } from './runtime';
import { runClaudeAgent } from './claude-agent';

export type IntelProvider = 'local' | 'local-only' | 'claude';

const PROVIDER_KEY = 'crystalball-intel-provider';

export function getIntelProvider(): IntelProvider {
  const v = localStorage.getItem(PROVIDER_KEY);
  if (v === 'claude' || v === 'local' || v === 'local-only') return v;
  return 'local';
}

export function setIntelProvider(p: IntelProvider): void {
  localStorage.setItem(PROVIDER_KEY, p);
}

export interface IntelOptions {
  system?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface IntelResponse {
  response: string;
  model: string;
  provider: 'local' | 'claude';
}

// Circuit breaker: trips after consecutive failures, prevents sidecar flood
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 90_000;
let consecutiveFailures = 0;
let breakerOpenUntil = 0;

async function callLocal(prompt: string, opts: IntelOptions): Promise<IntelResponse> {
  if (Date.now() < breakerOpenUntil) {
    throw new Error('local intel circuit breaker open');
  }

  const url = `${getApiBaseUrl()}/api/intel-generate`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        system: opts.system,
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
      }),
      signal: opts.signal,
    });
  } catch (error) {
    consecutiveFailures++;
    if (consecutiveFailures >= BREAKER_THRESHOLD) {
      breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS;
      console.warn(`[IntelProvider] Circuit breaker open after ${consecutiveFailures} failures — cooling down ${BREAKER_COOLDOWN_MS / 1000}s`); // eslint-disable-line no-console
    }
    throw error;
  }
  if (!res.ok) {
    consecutiveFailures++;
    if (consecutiveFailures >= BREAKER_THRESHOLD) {
      breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS;
      console.warn(`[IntelProvider] Circuit breaker open after ${consecutiveFailures} failures — cooling down ${BREAKER_COOLDOWN_MS / 1000}s`); // eslint-disable-line no-console
    }
    const errText = await res.text().catch(() => '');
    throw new Error(`local intel ${res.status}: ${errText.slice(0, 200)}`);
  }
  consecutiveFailures = 0;
  const data = await res.json() as { response: string; model: string };
  if (!data || typeof data !== 'object' || typeof data.response !== 'string') {
    throw new Error('local intel malformed response');
  }
  return { response: data.response, model: data.model, provider: 'local' };
}

async function callClaude(prompt: string, opts: IntelOptions): Promise<IntelResponse> {
  const r = await runClaudeAgent(prompt, opts.signal);
  return { response: r.response, model: r.model, provider: 'claude' };
}

export async function runIntel(prompt: string, opts: IntelOptions = {}): Promise<IntelResponse> {
  const provider = getIntelProvider();
  if (provider === 'claude') return callClaude(prompt, opts);
  try {
    return await callLocal(prompt, opts);
  } catch (error) {
    if (provider === 'local-only') throw error;
    // Best-effort fallback to cloud.
    return callClaude(prompt, opts);
  }
}

/** Cheap availability probe — does the local model respond at all? */
export async function isLocalIntelReachable(): Promise<boolean> {
  try {
    const r = await callLocal('ping', { maxTokens: 4, temperature: 0 });
    return typeof r.response === 'string';
  } catch { return false; }
}
