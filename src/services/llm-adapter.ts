/**
 * LLM Adapter — unified text-generation entry point that prefers a local
 * LLM (Ollama / LM Studio) via the sidecar's /api/intel-generate route
 * before falling back to the Anthropic-backed /api/claude-agent.
 *
 * auto-brief and hypothesis-skeptic use this adapter so the reasoning
 * stack can run fully on-device when Ollama is configured, dropping to
 * the cloud only when the local LLM isn't available.
 *
 * Why this matters: the renderer can't read sidecar env, and we don't
 * want to force the user to think about which provider to use. We probe
 * the local endpoint first with a short timeout; the sidecar itself
 * handles Ollama → Groq → error. We only fall back to runClaudeAgent
 * (the full agentic, tool-using Claude path) if the sidecar returns a
 * non-OK response.
 */

import { runClaudeAgent } from './claude-agent';
import { getApiBaseUrl, isDesktopRuntime } from './runtime';
import { getRuntimeConfigSnapshot } from './runtime-config';
import { recordCall, refundCloudCall, reserveCloudCall } from './llm-budget';
import { logDebug } from './reasoning-debug';
import { recordLatency, incrementCounter } from './reasoning-metrics';
import { isLocalModelOnly, isLlmEgressDisclosed } from './ai-flow-settings';
import { isGhostMode } from './mode-manager';

export type LlmProvider = 'local' | 'cloud-groq' | 'cloud-agent' | 'cloud-chat' | 'none';

export interface LlmResult {
  text: string;
  provider: LlmProvider;
  model?: string;
}

export interface LlmOptions {
  /** Optional system prompt; ignored by runClaudeAgent which uses its own prompt. */
  system?: string;
  /** Max response tokens for the local path (default 400). */
  maxTokens?: number;
  /** Override preferences for testing. */
  preferCloud?: boolean;
  signal?: AbortSignal;
}

const LOCAL_TIMEOUT_MS = 20_000;
const LOCAL_ENDPOINT = '/api/intel-generate';

interface LocalResponseShape {
  response?: unknown;
  text?: unknown;
  model?: unknown;
  provider?: unknown;
  error?: unknown;
}

async function tryLocal(prompt: string, options: LlmOptions): Promise<LlmResult | null> {
  if (isDesktopRuntime()) return tryLocalViaSidecar(prompt, options);
  return tryLocalDirect(prompt, options);
}

async function tryLocalViaSidecar(prompt: string, options: LlmOptions): Promise<LlmResult | null> {
  const base = getApiBaseUrl();
  if (!base) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOCAL_TIMEOUT_MS);
  const signal = options.signal
    ? combineSignals(controller.signal, options.signal)
    : controller.signal;

  const t0 = performance.now();
  try {
    const res = await fetch(`${base}${LOCAL_ENDPOINT}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt,
        system: options.system,
        maxTokens: options.maxTokens ?? 400,
        // Ghost Mode must also pin local-only so the sidecar never Groq-falls-back.
        localOnly: isLocalModelOnly() || isGhostMode() || !isLlmEgressDisclosed(),
      }),
      signal,
    });
    const latencyMs = performance.now() - t0;
    recordLatency('llm.local', latencyMs);
    if (!res.ok) {
      logDebug({ level: 'warn', category: 'llm', source: 'llm-adapter',
        message: `local ${res.status}`, latencyMs, data: { status: res.status, promptChars: prompt.length } });
      incrementCounter('llm.local.non-ok');
      return null;
    }
    const parsed = await res.json() as LocalResponseShape;
    if (!parsed || typeof parsed !== 'object') {
      incrementCounter('llm.local.empty');
      return null;
    }
    let text = '';
    if (typeof parsed.response === 'string') text = parsed.response;
    else if (typeof parsed.text === 'string') text = parsed.text;
    if (!text || parsed.error) {
      logDebug({ level: 'warn', category: 'llm', source: 'llm-adapter',
        message: 'local returned empty/error', latencyMs,
        data: { promptChars: prompt.length, hasError: !!parsed.error } });
      incrementCounter('llm.local.empty');
      return null;
    }
    const sidecarProvider: LlmProvider = parsed.provider === 'cloud-groq' ? 'cloud-groq' : 'local';
    logDebug({ level: 'info', category: 'llm', source: 'llm-adapter',
      message: 'local ok', latencyMs,
      data: { promptChars: prompt.length, responseChars: text.length,
              model: typeof parsed.model === 'string' ? parsed.model : undefined,
              provider: sidecarProvider } });
    incrementCounter(sidecarProvider === 'cloud-groq' ? 'llm.cloud-groq.success' : 'llm.local.success');
    return {
      text,
      provider: sidecarProvider,
      model: typeof parsed.model === 'string' ? parsed.model : undefined,
    };
  } catch (error) {
    const latencyMs = performance.now() - t0;
    recordLatency('llm.local', latencyMs);
    logDebug({ level: 'warn', category: 'llm', source: 'llm-adapter',
      message: 'local threw', latencyMs,
      data: { error: error instanceof Error ? error.message : String(error),
              promptChars: prompt.length } });
    incrementCounter('llm.local.error');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function tryCloudAgent(prompt: string, options: LlmOptions): Promise<LlmResult | null> {
  const t0 = performance.now();
  try {
    const res = await runClaudeAgent(prompt, options.signal);
    const latencyMs = performance.now() - t0;
    recordLatency('llm.cloud-agent', latencyMs);
    if (!res.response) {
      logDebug({ level: 'warn', category: 'llm', source: 'llm-adapter',
        message: 'cloud-agent empty', latencyMs,
        data: { promptChars: prompt.length } });
      incrementCounter('llm.cloud-agent.empty');
      return null;
    }
    logDebug({ level: 'info', category: 'llm', source: 'llm-adapter',
      message: 'cloud-agent ok', latencyMs,
      data: { promptChars: prompt.length, responseChars: res.response.length, model: res.model } });
    incrementCounter('llm.cloud-agent.success');
    return { text: res.response, provider: 'cloud-agent', model: res.model };
  } catch (error) {
    const latencyMs = performance.now() - t0;
    recordLatency('llm.cloud-agent', latencyMs);
    logDebug({ level: 'error', category: 'llm', source: 'llm-adapter',
      message: 'cloud-agent threw', latencyMs,
      data: { error: error instanceof Error ? error.message : String(error),
              promptChars: prompt.length } });
    incrementCounter('llm.cloud-agent.error');
    return null;
  }
}

// The disclosure prompt is a one-shot per session: many cadences (auto-brief,
// analyst-loop, skeptic, ensemble) call generateText, and firing the event on
// every blocked call spammed the HUD (and, before this fix, re-opened it right
// after the user closed it — Esc/X looked dead). Dispatch at most once.
let egressDisclosureDispatched = false;
function dispatchEgressDisclosureNeeded(): void {
  if (egressDisclosureDispatched) return;
  egressDisclosureDispatched = true;
  try { document.dispatchEvent(new CustomEvent('cb:llm-egress-disclosure-needed')); }
  catch { /* non-browser test environment */ }
}

/** Test seam — reset the one-shot dispatch guard. */
export function _resetEgressDisclosureForTest(): void {
  egressDisclosureDispatched = false;
}

const BLOCKED: LlmResult = { text: '', provider: 'none' };

/**
 * Reason cloud egress is disallowed right now, or null if it's permitted.
 * Single source of truth for the three privacy gates: Ghost Mode (the explicit
 * privacy mode), local-model-only, and the one-time egress disclosure. Logs +
 * counts the block and fires the disclosure prompt as a side effect.
 */
function cloudEgressBlocked(): LlmResult | null {
  if (isGhostMode()) {
    logDebug({ level: 'info', category: 'llm', source: 'llm-adapter',
      message: 'cloud call blocked: Ghost Mode active' });
    incrementCounter('llm.cloud-agent.blocked.ghost');
    return BLOCKED;
  }
  if (isLocalModelOnly()) {
    logDebug({ level: 'info', category: 'llm', source: 'llm-adapter',
      message: 'cloud call blocked: local-model-only mode active' });
    incrementCounter('llm.cloud-agent.blocked.local-only');
    return BLOCKED;
  }
  if (!isLlmEgressDisclosed()) {
    dispatchEgressDisclosureNeeded();
    logDebug({ level: 'warn', category: 'llm', source: 'llm-adapter',
      message: 'cloud call blocked: LLM egress not yet disclosed to user' });
    incrementCounter('llm.cloud-agent.blocked.undisclosed');
    return BLOCKED;
  }
  return null;
}

/**
 * Generate text. Tries the local path first unless preferCloud is set.
 * Returns { provider: 'none' } if everything failed or the daily cloud
 * budget is exhausted, so callers can react.
 *
 * Cloud calls go through reserveCloudCall() so that N parallel callers
 * (e.g. the multi-persona ensemble fan-out) cannot all race past the
 * cap and overshoot.
 */
export async function generateText(prompt: string, options: LlmOptions = {}): Promise<LlmResult> {
  if (!options.preferCloud) {
    // On desktop, tryLocal routes through the sidecar which can fall back to
    // Groq (cloud) — enforce disclosure before that happens. On web,
    // tryLocalDirect calls the user's own Ollama endpoint directly and never
    // touches a cloud API, so no disclosure is required for that path.
    // (Ghost / local-only still allow on-device inference here; the sidecar's
    // localOnly flag — set in tryLocalViaSidecar — prevents its Groq fallback.)
    if (isDesktopRuntime() && !isLlmEgressDisclosed()) {
      dispatchEgressDisclosureNeeded();
      logDebug({ level: 'warn', category: 'llm', source: 'llm-adapter',
        message: 'cloud call blocked: LLM egress not yet disclosed to user' });
      incrementCounter('llm.cloud-agent.blocked.undisclosed');
      return { text: '', provider: 'none' };
    }
    const local = await tryLocal(prompt, options);
    if (local) {
      recordCall(local.provider);
      return local;
    }
  }
  // No usable local result — gate the cloud fallback through the same checks.
  const blocked = cloudEgressBlocked();
  if (blocked) return blocked;
  // Atomically reserve a cloud-call slot before issuing the request.
  // If reserveCloudCall returns false, the cap is already hit; fail soft.
  if (!reserveCloudCall('cloud-agent')) return { text: '', provider: 'none' };
  let cloud: LlmResult | null = null;
  try {
    cloud = await tryCloudAgent(prompt, options);
    if (cloud) return cloud; // already counted by reserveCloudCall
    return { text: '', provider: 'none' };
  } finally {
    // The call never produced a usable result, so the reserved slot was
    // never actually spent — release it so a failed attempt doesn't
    // permanently burn budget.
    if (!cloud) refundCloudCall('cloud-agent');
  }
}

/**
 * Web build has no sidecar, so call the user-configured Ollama endpoint
 * directly. OLLAMA_API_URL / OLLAMA_MODEL are set via the web secret vault.
 * Requires the user to start Ollama with `OLLAMA_ORIGINS=*` (or the app's
 * origin) so the browser's fetch is CORS-permitted.
 */
async function tryLocalDirect(prompt: string, options: LlmOptions): Promise<LlmResult | null> {
  const secrets = getRuntimeConfigSnapshot().secrets;
  const baseUrl = secrets.OLLAMA_API_URL?.value?.replace(/\/$/, '') ?? '';
  const model = secrets.OLLAMA_MODEL?.value ?? '';
  if (!baseUrl || !model) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOCAL_TIMEOUT_MS);
  const signal = options.signal
    ? combineSignals(controller.signal, options.signal)
    : controller.signal;

  const t0 = performance.now();
  try {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: options.system ? `${options.system}\n\n${prompt}` : prompt,
        stream: false,
        options: { num_predict: options.maxTokens ?? 400 },
      }),
      signal,
    });
    const latencyMs = performance.now() - t0;
    recordLatency('llm.local', latencyMs);
    if (!res.ok) {
      logDebug({ level: 'warn', category: 'llm', source: 'llm-adapter',
        message: `local-direct ${res.status}`, latencyMs,
        data: { status: res.status, promptChars: prompt.length } });
      incrementCounter('llm.local.non-ok');
      return null;
    }
    const parsed = await res.json() as { response?: unknown; model?: unknown };
    if (!parsed || typeof parsed !== 'object') {
      incrementCounter('llm.local.empty');
      return null;
    }
    const text = typeof parsed.response === 'string' ? parsed.response : '';
    if (!text) {
      incrementCounter('llm.local.empty');
      return null;
    }
    incrementCounter('llm.local.success');
    return {
      text,
      provider: 'local',
      model: typeof parsed.model === 'string' ? parsed.model : model,
    };
  } catch (error) {
    const latencyMs = performance.now() - t0;
    recordLatency('llm.local', latencyMs);
    logDebug({ level: 'warn', category: 'llm', source: 'llm-adapter',
      message: 'local-direct threw', latencyMs,
      data: { error: error instanceof Error ? error.message : String(error),
              promptChars: prompt.length } });
    incrementCounter('llm.local.error');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function combineSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a;
  if (b.aborted) return b;
  const controller = new AbortController();
  const forward = (): void => controller.abort();
  a.addEventListener('abort', forward, { once: true });
  b.addEventListener('abort', forward, { once: true });
  return controller.signal;
}
