/**
 * Crystal Ball Chat Service
 *
 * Conversational AI service for the "Ask Crystal Ball" panel.
 * Maintains conversation history, builds rich situational context from
 * live app state, and routes messages through Claude Agent (primary)
 * with Ollama streaming fallback.
 */

import { getApiBaseUrl } from './runtime';
import { getMode } from './mode-manager';
import { situationEngine } from './situation-engine';
import { unifiedAlertStore } from './unified-alerts';
import type { UnifiedAlert } from './unified-alerts';
import { loadProximityConfig } from './proximity-filter';
import { runIntel } from './intel-provider';
import { getActivity } from './alert-activity-log';
import { rankAlerts } from './alert-routing';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_HISTORY = 20;

export const QUICK_ASK_PRESETS: string[] = [
  'What\'s happening near me?',
  'Should I be worried?',
  'What should I prepare for?',
  'Explain the current threat level',
  'What\'s the economic outlook?',
];

// ── Conversation history ─────────────────────────────────────────────────────

const HISTORY_STORAGE_KEY = 'crystalball-chat-history-v1';

function loadHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ChatMessage[];
  } catch { return []; }
}
const MAX_STORED_HISTORY = 200;
function saveHistory(): void {
  if (history.length > MAX_STORED_HISTORY) history = history.slice(-MAX_STORED_HISTORY);
  try { localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history)); } catch { /* noop */ }
}

let history: ChatMessage[] = loadHistory();

export function getHistory(): ChatMessage[] {
  return [...history];
}

export function clearHistory(): void {
  history = [];
  saveHistory();
}

// ── Context builder ──────────────────────────────────────────────────────────

function buildSituationContext(): string {
  try {
 const situations = situationEngine.getActionableSituations();
 if (situations.length === 0) return 'No active situations detected.';
 const sitLines = situations.slice(0, 8).map(
 s => `- [${s.phase}] ${s.title}: ${s.summary} (confidence: ${(s.confidence * 100).toFixed(0)}%)`,
 );
 return `Active situations (${situations.length}):\n${sitLines.join('\n')}`;
  } catch {
 return '';
  }
}

function buildAlertContext(): string {
  try {
 const alerts = unifiedAlertStore.getAll();
 const sorted = [...alerts].sort((a: UnifiedAlert, b: UnifiedAlert) => b.timestamp - a.timestamp);
 const recent = sorted.slice(0, 10);
 if (recent.length === 0) return '';
 const alertLines = recent.map(a => {
 const loc = a.location?.label ? ` (${a.location.label})` : '';
 return `- [${a.severity}] ${a.title}${loc}`;
 });
 return `Recent alerts (${alerts.length} total, showing ${recent.length}):\n${alertLines.join('\n')}`;
  } catch {
 return '';
  }
}

function buildLocationContext(): string {
  try {
 const proxConfig = loadProximityConfig();
 if (!proxConfig.location) return '';
 const loc = proxConfig.location;
 return `User location: ${loc.label} (${loc.lat.toFixed(2)}, ${loc.lon.toFixed(2)}), radius: ${proxConfig.radiusKm} km`;
  } catch {
 return '';
  }
}

function buildActivityContext(): string {
  try {
    const recent = getActivity().slice(0, 15);
    if (recent.length === 0) return '';
    const lines = recent.map(e => {
      const ago = Math.max(0, Math.round((Date.now() - e.t) / 60_000));
      return `- ${e.kind} [${e.severity}] ${e.title} (${ago}m ago)`;
    });
    return `User-visible activity in the last hour (kind = new/ack/snooze/correlate/react):\n${lines.join('\n')}`;
  } catch { return ''; }
}

function buildSystemContext(): string {
  const mode = getMode();
  const parts = [
 `Current app mode: ${(mode ?? 'default').toUpperCase()}`,
 buildSituationContext(),
 buildAlertContext(),
 buildActivityContext(),
 buildLocationContext(),
  ].filter(Boolean);
  return parts.join('\n\n');
}

function buildFullPrompt(userMessage: string): string {
  const context = buildSystemContext();

  const systemPreamble = [
 'You are the Crystal Ball AI assistant — a senior intelligence analyst embedded in a real-time global situational awareness dashboard.',
 'You have access to the following live context from the dashboard:',
 '',
 context,
 '',
 'Answer the user\'s question based on this context. Be concise, factual, and actionable.',
 'If the context doesn\'t contain enough information, say so honestly.',
 'Use plain text — no markdown headers or bullet formatting beyond simple dashes.',
  ].join('\n');

  // Include recent conversation for continuity (last 6 messages)
  const recentHistory = history.slice(-6);
  const historyBlock = recentHistory.map(
 m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`,
  ).join('\n\n');

  if (historyBlock) {
 return `${systemPreamble}\n\nConversation so far:\n${historyBlock}\n\nUser: ${userMessage}`;
  }
  return `${systemPreamble}\n\nUser: ${userMessage}`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function trimHistory(): void {
  if (history.length > MAX_HISTORY) {
 history = history.slice(-MAX_HISTORY);
  }
}

function addToHistory(role: 'user' | 'assistant', content: string): void {
  history.push({ role, content, timestamp: Date.now() });
  trimHistory();
}

// ── SSE parser ───────────────────────────────────────────────────────────────

function* parseSseChunks(raw: string): Generator<{ token?: string; error?: string }> {
  const parts = raw.split('\n\n');
  for (const part of parts) {
 for (const line of part.split('\n')) {
 if (!line.startsWith('data: ')) continue;
 const payload = line.slice(6).trim();
 if (payload === '[DONE]') return;
 try {
 yield JSON.parse(payload) as { token?: string; error?: string };
 } catch {
 // skip malformed JSON chunks
 }
 }
  }
}

// ── Ollama streaming fallback ────────────────────────────────────────────────

async function* streamFromOllama(
  userMessage: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const baseUrl = getApiBaseUrl();
  const prompt = buildFullPrompt(userMessage);

  const resp = await fetch(`${baseUrl}/api/ollama-stream`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 headlines: [prompt],
 mode: 'chat',
 geoContext: 'ask-crystal-ball',
 lang: 'en',
 }),
 signal,
  });

  const ct = resp.headers.get('content-type') ?? '';

  if (!ct.includes('text/event-stream')) {
 const data = await resp.json() as { skipped?: boolean; error?: string };
 if (data.skipped) throw new Error('OLLAMA_NOT_CONFIGURED');
 throw new Error(data.error ?? 'Ollama returned non-streaming response');
  }

  const reader = (resp.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let sseBuffer = '';

  try {
 for (;;) {
 const { done, value } = await reader.read();
 if (done) break;
 sseBuffer += decoder.decode(value, { stream: true });
 const remaining = sseBuffer.split('\n\n');
 sseBuffer = remaining.pop() ?? '';
 const toParse = remaining.join('\n\n');

 for (const chunk of parseSseChunks(toParse)) {
 if (chunk.error) throw new Error(chunk.error);
 if (chunk.token) yield chunk.token;
 }
 }
  } finally {
 void reader.cancel();
  }
}

// ── Fallback error messages ──────────────────────────────────────────────────

function buildNoAiMessage(): string {
  return 'No AI provider is configured. To use Ask Crystal Ball, set up either:\n\n'
 + '- Claude API key (Settings > API Keys > Anthropic)\n'
 + '- Local Ollama instance (OLLAMA_API_URL environment variable)\n\n'
 + 'Claude provides the best experience with multi-turn tool use for live intelligence gathering.';
}

function buildErrorMessage(claudeMsg: string, ollamaMsg: string): string {
  return `Unable to reach AI services.\n\nClaude: ${claudeMsg}\nOllama: ${ollamaMsg || 'unavailable'}`;
}

// ── Main send function ───────────────────────────────────────────────────────

/**
 * Send a message and receive a streaming response.
 * Primary: Claude Agent endpoint. Fallback: Ollama local streaming.
 *
 * Yields string chunks as they arrive. The caller should concatenate them
 * to build the full assistant response.
 */
export async function* sendMessage(
  text: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  addToHistory('user', text);
  let fullResponse = '';

  try {
 const prompt = buildFullPrompt(text);
 const agentResult = await runIntel(prompt, { signal, maxTokens: 600 });
 fullResponse = agentResult.response;
 yield fullResponse;
  } catch (claudeError) {
 fullResponse = yield* handleClaudeFallback(text, claudeError, signal);
  }

  if (fullResponse) {
 addToHistory('assistant', fullResponse);
 saveHistory();
  }
}

// ── Proactive digest ────────────────────────────────────────────────────────

const DIGEST_LAST_KEY = 'crystalball-digest-last-shown';

/** True if a fresh digest has not yet been shown today. */
export function shouldShowDigest(): boolean {
  try {
    const last = Number(localStorage.getItem(DIGEST_LAST_KEY) ?? '0');
    if (!Number.isFinite(last)) return true;
    return Date.now() - last > 8 * 3_600_000;
  } catch { return true; }
}
export function markDigestShown(): void {
  try { localStorage.setItem(DIGEST_LAST_KEY, String(Date.now())); } catch { /* noop */ }
}

/**
 * Build a "since you last looked" prompt for the chat agent. The agent
 * generates a 3-bullet digest using the same context the chat does.
 */
export function buildDigestPrompt(): string {
  const ranked = rankAlerts(unifiedAlertStore.getAll()).slice(0, 8);
  const recent = getActivity().slice(0, 15);
  const top = ranked.map(a => `- [${a.severity}] ${a.title}`).join('\n');
  const activity = recent.map(e => `- ${e.kind}: ${e.title}`).join('\n');
  return [
    'You are the Crystal Ball intelligence analyst. Generate a 3-bullet "since you last looked" digest.',
    'Be terse, factual, and actionable. No headers, no preamble — just three bullets.',
    '',
    `Top active alerts (ranked):\n${top || '(none)'}`,
    '',
    `Recent activity:\n${activity || '(none)'}`,
  ].join('\n');
}

/** Run the digest prompt through Claude and return the assistant text. */
export async function generateDigest(signal?: AbortSignal): Promise<string> {
  const prompt = buildDigestPrompt();
  try {
    const { response } = await runIntel(prompt, { signal, maxTokens: 300 });
    return response;
  } catch {
    return '';
  }
}

/** Attempt Ollama fallback after Claude fails; returns accumulated response text. */
async function* handleClaudeFallback(
  text: string,
  claudeError: unknown,
  signal?: AbortSignal,
): AsyncGenerator<string, string> {
  let fullResponse = '';
  try {
 for await (const chunk of streamFromOllama(text, signal)) {
 fullResponse += chunk;
 yield chunk;
 }
  } catch (ollamaError) {
 const ollamaMsg = ollamaError instanceof Error ? ollamaError.message : '';
 if (ollamaMsg === 'OLLAMA_NOT_CONFIGURED') {
 fullResponse = buildNoAiMessage();
 yield fullResponse;
 } else {
 const claudeMsg = claudeError instanceof Error ? claudeError.message : 'Unknown error';
 fullResponse = buildErrorMessage(claudeMsg, ollamaMsg);
 yield fullResponse;
 }
  }
  return fullResponse;
}
