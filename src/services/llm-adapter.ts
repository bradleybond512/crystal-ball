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

export type LlmProvider = 'local' | 'cloud-agent' | 'cloud-chat' | 'none';

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
  error?: unknown;
}

async function tryLocal(prompt: string, options: LlmOptions): Promise<LlmResult | null> {
  if (!isDesktopRuntime()) return null;
  const base = getApiBaseUrl();
  if (!base) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOCAL_TIMEOUT_MS);
  const signal = options.signal
    ? combineSignals(controller.signal, options.signal)
    : controller.signal;

  try {
    const res = await fetch(`${base}${LOCAL_ENDPOINT}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt,
        system: options.system,
        maxTokens: options.maxTokens ?? 400,
      }),
      signal,
    });
    if (!res.ok) return null;
    const parsed = await res.json() as LocalResponseShape;
    let text = '';
    if (typeof parsed.response === 'string') text = parsed.response;
    else if (typeof parsed.text === 'string') text = parsed.text;
    if (!text || parsed.error) return null;
    return {
      text,
      provider: 'local',
      model: typeof parsed.model === 'string' ? parsed.model : undefined,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function tryCloudAgent(prompt: string, options: LlmOptions): Promise<LlmResult | null> {
  try {
    const res = await runClaudeAgent(prompt, options.signal);
    if (!res.response) return null;
    return { text: res.response, provider: 'cloud-agent', model: res.model };
  } catch {
    return null;
  }
}

/**
 * Generate text. Tries the local path first unless preferCloud is set.
 * Returns { provider: 'none' } if everything failed so callers can react.
 */
export async function generateText(prompt: string, options: LlmOptions = {}): Promise<LlmResult> {
  if (!options.preferCloud) {
    const local = await tryLocal(prompt, options);
    if (local) return local;
  }
  const cloud = await tryCloudAgent(prompt, options);
  if (cloud) return cloud;
  return { text: '', provider: 'none' };
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
