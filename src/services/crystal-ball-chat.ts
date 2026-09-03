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
import { getSavedPlaces } from './saved-places';
import {
  projectDigestStories,
  type DigestStoryCard,
  type DigestStorySeed,
} from './digest-alert-projection';

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

/** Persist a complete question/answer exchange (both roles) to history, so
 *  deterministic (non-LLM) answers survive reload and stay in the transcript
 *  the LLM path reads for continuity. Mirrors what sendMessage() records. */
export function recordExchange(userText: string, assistantText: string): void {
  addToHistory('user', userText);
  addToHistory('assistant', assistantText);
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

const MAX_DIGEST_CANDIDATES = 20;
const MAX_DIGEST_STORIES = 5;
const MAX_MODEL_TOKENS_PER_STORY = 3;
const MAX_MODEL_NARRATIVE_LENGTH = 600;

function digestFact(value: string, maxLength: number): string {
  return value.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function digestCandidates(alerts?: readonly UnifiedAlert[]): UnifiedAlert[] {
  const source = alerts ?? rankAlerts(unifiedAlertStore.getAll());
  return source.slice(0, MAX_DIGEST_CANDIDATES);
}

function digestStoryId(alertIds: readonly string[]): string {
  let hash = 2_166_136_261;
  for (const value of alertIds) {
    for (const character of value) {
      hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), 16_777_619) >>> 0;
    }
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return `digest-${(hash >>> 0).toString(36)}`;
}

function fallbackSeed(alert: UnifiedAlert): DigestStorySeed {
  return {
    id: digestStoryId([alert.id]),
    alertIds: [alert.id],
    headline: digestFact(alert.title, 200),
    narrative: digestFact(alert.body, MAX_MODEL_NARRATIVE_LENGTH),
  };
}

/** Build a bounded narrative-only prompt from public alert facts and opaque tokens. */
export function buildDigestPrompt(alerts?: readonly UnifiedAlert[]): string {
  const candidates = digestCandidates(alerts);
  const facts = candidates.map((alert, index) => {
    const token = `A${index + 1}`;
    if (alert.source === 'resource' || alert.source === 'local-ids') {
      return JSON.stringify({ token, source: alert.source, descriptor: 'Local-only alert; details withheld.' });
    }
    return JSON.stringify({
      token,
      severity: alert.severity,
      source: alert.source,
      title: digestFact(alert.title, 160),
      summary: digestFact(alert.body, 320),
      region: alert.location?.label ? digestFact(alert.location.label, 120) : undefined,
    });
  }).join('\n');
  return [
    'Select and summarize up to five ranked alert stories.',
    'Return only a JSON array. Every item must have exactly these keys:',
    '{"alertTokens":["A1"],"why":"one concise factual narrative"}',
    `Use one to ${MAX_MODEL_TOKENS_PER_STORY} unique opaque alert tokens per story.`,
    'Use only the supplied public facts. Do not add location or saved-place impact fields.',
    `Keep each why value at or below ${MAX_MODEL_NARRATIVE_LENGTH} characters.`,
    'Prefer cross-domain convergence when the supplied facts support it.',
    '',
    `Ranked alert facts:\n${facts || '(none)'}`,
  ].join('\n');
}

interface ModelDigestStory {
  alertTokens: string[];
  why: string;
}

function parseModelDigestStories(response: string | null): ModelDigestStory[] {
  if (!response) return [];
  try {
    const parsed: unknown = JSON.parse(response);
    if (!Array.isArray(parsed) || parsed.length > MAX_DIGEST_STORIES) return [];
    const stories: ModelDigestStory[] = [];
    for (const value of parsed) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const item = value as Record<string, unknown>;
      const keys = Object.keys(item).sort();
      if (keys.length !== 2 || keys[0] !== 'alertTokens' || keys[1] !== 'why') continue;
      if (!Array.isArray(item['alertTokens']) || item['alertTokens'].length === 0
        || item['alertTokens'].length > MAX_MODEL_TOKENS_PER_STORY
        || !item['alertTokens'].every((token) => typeof token === 'string')) continue;
      const tokens = item['alertTokens'] as string[];
      if (new Set(tokens).size !== tokens.length) continue;
      if (typeof item['why'] !== 'string' || item['why'].trim().length === 0
        || item['why'].length > MAX_MODEL_NARRATIVE_LENGTH) continue;
      stories.push({ alertTokens: tokens, why: digestFact(item['why'], MAX_MODEL_NARRATIVE_LENGTH) });
    }
    return stories;
  } catch {
    return [];
  }
}

/** Resolve model token selections, then fill omissions with deterministic ranked stories. */
export function buildDigestStorySeeds(
  alerts: readonly UnifiedAlert[],
  modelResponse: string | null,
): DigestStorySeed[] {
  const candidates = digestCandidates(alerts);
  if (candidates.length === 0) return [];
  const tokenIndex = new Map(candidates.map((alert, index) => [`A${index + 1}`, { alert, index }]));
  const used = new Set<string>();
  const selected: Array<{ seed: DigestStorySeed; rank: number }> = [];

  for (const story of parseModelDigestStories(modelResponse)) {
    const matches = story.alertTokens.map((token) => tokenIndex.get(token));
    if (matches.some((match) => !match) || story.alertTokens.some((token) => used.has(token))) continue;
    const resolved = matches.flatMap((match) => match ? [match] : []);
    if (resolved.length !== story.alertTokens.length) continue;
    for (const token of story.alertTokens) used.add(token);
    const ranked = [...resolved].sort((a, b) => a.index - b.index);
    const alertIds = ranked.map((match) => match.alert.id);
    selected.push({
      rank: ranked[0]?.index ?? Number.MAX_SAFE_INTEGER,
      seed: {
        id: digestStoryId(alertIds),
        alertIds,
        headline: digestFact(ranked[0]?.alert.title ?? '', 200),
        narrative: story.why,
      },
    });
  }

  for (let index = 0; index < candidates.length && selected.length < MAX_DIGEST_STORIES; index += 1) {
    const token = `A${index + 1}`;
    const alert = candidates[index];
    if (!alert || used.has(token)) continue;
    used.add(token);
    selected.push({ rank: index, seed: fallbackSeed(alert) });
  }
  return selected.sort((a, b) => a.rank - b.rank).map((item) => item.seed);
}

/** Generate model-assisted narratives, then derive location and saved-place impact locally. */
export async function generateDigest(signal?: AbortSignal): Promise<DigestStoryCard[]> {
  const alerts = unifiedAlertStore.getAll();
  const ranked = rankAlerts(alerts).slice(0, MAX_DIGEST_CANDIDATES);
  if (ranked.length === 0) return [];
  let modelResponse: string | null = null;
  try {
    const result = await runIntel(buildDigestPrompt(ranked), { signal, maxTokens: 500 });
    modelResponse = result.response;
  } catch { /* deterministic fallback below */ }
  return projectDigestStories({
    seeds: buildDigestStorySeeds(ranked, modelResponse),
    alerts,
    savedPlaces: getSavedPlaces(),
    now: Date.now(),
  });
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
