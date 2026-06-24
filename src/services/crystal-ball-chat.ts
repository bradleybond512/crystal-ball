/**
 * Crystal Ball Chat Service
 *
 * Conversational AI service for the "Ask Crystal Ball" panel.
 * Maintains conversation history, builds rich situational context from
 * live app state, and routes messages through Claude Agent (primary)
 * with Ollama streaming fallback.
 */

import { getApiBaseUrl } from './runtime';
import { getMode, isGhostMode } from './mode-manager';
import { situationEngine } from './situation-engine';
import { unifiedAlertStore } from './unified-alerts';
import type { UnifiedAlert } from './unified-alerts';
import { loadProximityConfig } from './proximity-filter';
import { runIntel } from './intel-provider';
import { getActivity } from './alert-activity-log';
import { rankAlerts } from './alert-routing';
import { buildAnalystContext } from './analyst-context-builder';
import { getLatestPCI } from './intelligence/predictive-crisis-index';
import { getAnalystSnapshot } from './analyst-loop';
import { getForecastSnapshot } from './mode-forecast';
import { markDismissed } from './analyst-command-listener';
import { thumbsUp } from './hypothesis-feedback';
import { getWatchlist, saveWatchlist } from './watchlist';
import type { WatchlistEntry } from './watchlist';

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
 const cap = (s: string, n: number) => s.replace(/[\r\n]+/g, ' ').slice(0, n);
 const sitLines = situations.slice(0, 8).map(
 s => `- [${s.phase}] ${cap(s.title, 120)}: ${cap(s.summary, 200)} (confidence: ${(s.confidence * 100).toFixed(0)}%)`,
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
 const sanitize = (s: string) => s.replace(/[\r\n]+/g, ' ').slice(0, 120);
 const alertLines = recent.map(a => {
 const loc = a.location?.label ? ` (${sanitize(a.location.label)})` : '';
 return `- [${a.severity}] ${sanitize(a.title)}${loc}`;
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
 // Send only the place label + radius to the cloud LLM — never precise home
 // coordinates. The label already identifies the area for context.
 return `User location: ${loc.label}, radius: ${proxConfig.radiusKm} km`;
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

  const analystCtx = buildAnalystContext({
    hypotheses: getAnalystSnapshot()?.hypotheses ?? [],
    advisories: getForecastSnapshot()?.advisories ?? [],
    pci: getLatestPCI(),
  });
  if (analystCtx.systemPromptAddendum) {
    parts.push(analystCtx.systemPromptAddendum);
  }

  return parts.join('\n\n');
}

// ── Action tools ─────────────────────────────────────────────────────────────

interface ActionToolDef {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

const ACTION_TOOLS: ActionToolDef[] = [
  {
    name: 'dismiss_hypothesis',
    description: 'Dismiss a hypothesis that is no longer relevant or has been resolved.',
    input_schema: {
      type: 'object',
      properties: {
        hypothesis_id: { type: 'string', description: 'The ID of the hypothesis to dismiss' },
      },
      required: ['hypothesis_id'],
    },
  },
  {
    name: 'run_skeptic',
    description: 'Trigger a skeptic review pass for a hypothesis to challenge its assumptions.',
    input_schema: {
      type: 'object',
      properties: {
        hypothesis_id: { type: 'string', description: 'The ID of the hypothesis to review' },
      },
      required: ['hypothesis_id'],
    },
  },
  {
    name: 'confirm_hypothesis',
    description: 'Mark a hypothesis as confirmed by the analyst (thumbs up).',
    input_schema: {
      type: 'object',
      properties: {
        hypothesis_id: { type: 'string', description: 'The ID of the hypothesis to confirm' },
      },
      required: ['hypothesis_id'],
    },
  },
  {
    name: 'add_to_watchlist',
    description: 'Add a term or entity to the Crystal Ball watchlist so it gets boosted relevance.',
    input_schema: {
      type: 'object',
      properties: {
        term: { type: 'string', description: 'The keyword or entity name to watch' },
      },
      required: ['term'],
    },
  },
];

interface ActionCall {
  tool: string;
  input: Record<string, string>;
}

function buildToolsAddendum(): string {
  return [
    '',
    'You have access to the following action tools. When appropriate, append one or more',
    '[ACTION:{"tool":"<name>","input":{...}}] blocks at the very end of your response',
    '(after all prose). Each block must be valid JSON on a single line. Only use them when',
    'the user explicitly asks to dismiss, confirm, run skeptic on, or watch something.',
    '',
    'Available tools:',
    JSON.stringify(ACTION_TOOLS, null, 0),
  ].join('\n');
}

function parseActionCalls(text: string): { clean: string; actions: ActionCall[] } {
  const actions: ActionCall[] = [];
  const clean = text.replace(/\[ACTION:(\{[^[\]]*\})\]/g, (_match, json: string) => {
    try {
      const parsed = JSON.parse(json) as { tool?: string; input?: Record<string, string> };
      if (parsed.tool && parsed.input) {
        actions.push({ tool: parsed.tool, input: parsed.input });
      }
    } catch { /* malformed — skip */ }
    return '';
  }).trim();
  return { clean, actions };
}

function executeAction(action: ActionCall): void {
  const snapshot = getAnalystSnapshot();
  switch (action.tool) {
    case 'dismiss_hypothesis': {
      const id = action.input['hypothesis_id'];
      const h = snapshot?.hypotheses.find(x => x.id === id);
      if (h) markDismissed(h);
      break;
    }
    case 'run_skeptic': {
      const id = action.input['hypothesis_id'];
      const h = snapshot?.hypotheses.find(x => x.id === id);
      if (h) {
        document.dispatchEvent(new CustomEvent('cb:hypothesis-skeptic-requested', { detail: h }));
      }
      break;
    }
    case 'confirm_hypothesis': {
      const id = action.input['hypothesis_id'];
      const h = snapshot?.hypotheses.find(x => x.id === id);
      if (h) thumbsUp(h);
      break;
    }
    case 'add_to_watchlist': {
      const term = (action.input['term'] ?? '').trim();
      if (!term) break;
      const list = getWatchlist();
      const alreadyExists = list.some(e => e.keywords.some(k => k.toLowerCase() === term.toLowerCase()));
      if (!alreadyExists) {
        const entry: WatchlistEntry = {
          id: `chat-${Date.now()}`,
          label: term,
          keywords: [term.toLowerCase()],
        };
        saveWatchlist([...list, entry]);
      }
      break;
    }
    default:
      break;
  }
}

function buildFullPrompt(userMessage: string): string {
  const context = buildSystemContext();
  const toolsAddendum = isGhostMode() ? '' : buildToolsAddendum();

  const preambleParts = [
    'You are the Crystal Ball AI assistant — a senior intelligence analyst embedded in a real-time global situational awareness dashboard.',
    'You have access to the following live context from the dashboard:',
    '',
    context,
    '',
    'Answer the user\'s question based on this context. Be concise, factual, and actionable.',
    'If the context doesn\'t contain enough information, say so honestly.',
    'Use plain text — no markdown headers or bullet formatting beyond simple dashes.',
  ];
  if (toolsAddendum) preambleParts.push(toolsAddendum);

  const systemPreamble = preambleParts.join('\n');

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
 if (!data || typeof data !== 'object') throw new Error('OLLAMA_NOT_CONFIGURED');
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
    const agentResult = await runIntel(prompt, { signal, maxTokens: 700 });
    if (!isGhostMode()) {
      const { clean, actions } = parseActionCalls(agentResult.response);
      fullResponse = clean;
      for (const action of actions) executeAction(action);
    } else {
      fullResponse = agentResult.response;
    }
    yield fullResponse;
  } catch (claudeError) {
    const raw = yield* handleClaudeFallback(text, claudeError, signal);
    const { clean, actions } = parseActionCalls(raw);
    fullResponse = clean;
    if (!isGhostMode()) {
      for (const action of actions) executeAction(action);
    }
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
  const ranked = rankAlerts(unifiedAlertStore.getAll()).slice(0, 20);
  const recent = getActivity().slice(0, 15);
  // Group by domain so the model sees cross-channel spread.
  const byDomain = new Map<string, string[]>();
  for (const a of ranked) {
    const d = a.source;
    const arr = byDomain.get(d) ?? [];
    arr.push(`[${a.severity}] ${a.title}`);
    byDomain.set(d, arr);
  }
  const domainSummary = [...byDomain.entries()]
    .map(([d, lines]) => `${d} (${lines.length}): ${lines.slice(0, 2).join(' | ')}`)
    .join('\n');
  const top = ranked.slice(0, 10).map(a => `- [${a.severity}] (${a.source}) ${a.title}`).join('\n');
  const activity = recent.map(e => `- ${e.kind}: ${e.title}`).join('\n');
  return [
    'You are the Crystal Ball intelligence analyst. Generate a 5-bullet daily brief for the operator.',
    'Each bullet = ONE story. Lead with the fact, then WHY it matters (1 short clause), then implication for the operator.',
    'Prioritize cross-domain stories (e.g. space weather + grid, quake + tsunami). Call out if multiple sources converge.',
    'Be terse and factual. No headers, no preamble — exactly five bullets starting with "•".',
    '',
    `Top active alerts (ranked by hotness):\n${top || '(none)'}`,
    '',
    `Cross-domain spread:\n${domainSummary || '(none)'}`,
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
