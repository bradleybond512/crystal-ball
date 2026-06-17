/**
 * Claude Agentic Intelligence Service
 *
 * Client-side service for calling the /api/claude-agent endpoint.
 * Claude runs a multi-turn tool-use loop to gather live intelligence data
 * before synthesizing a comprehensive response.
 */

import { getApiBaseUrl } from './runtime';
import { isLocalModelOnly, isLlmEgressDisclosed } from './ai-flow-settings';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AgentToolCall {
  /** Name of the tool Claude called */
  tool: string;
  /** Input parameters passed to the tool */
  input: Record<string, unknown>;
}

export interface AgentResponse {
  /** Final synthesized response text from Claude */
  response: string;
  /** Log of tool calls made during the agentic loop */
  toolCalls: AgentToolCall[];
  /** Model used for the agentic loop */
  model: string;
  /** Number of agentic turns taken */
  turns: number;
}

export interface AgentRequest {
  /** Natural-language question or task for the intelligence analyst */
  query: string;
}

// ── Preset queries ────────────────────────────────────────────────────────────

export interface PresetQuery {
  label: string;
  icon: string;
  query: string;
}

export const AGENT_PRESET_QUERIES: PresetQuery[] = [
  {
 label: 'Global Risk Overview',
 icon: '🌍',
 query: 'What are the top 3 geopolitical risk hotspots right now? Check risk scores for Russia, China, Iran, Israel, and North Korea, then get the latest news for the highest-risk countries.',
  },
  {
 label: 'Military & Conflict',
 icon: '⚔️',
 query: 'Summarize current military conflicts and active war zones globally. Get news on Ukraine, Middle East, and Taiwan, and include risk scores for the relevant countries.',
  },
  {
 label: 'Markets & Economy',
 icon: '📈',
 query: 'What is the current state of global financial markets? Get a market summary and check for news on trade tensions or economic sanctions affecting key markets.',
  },
  {
 label: 'Cyber Threat Briefing',
 icon: '🔐',
 query: 'Provide a current cyber threat intelligence briefing. Get the latest IOC data and news about recent cyberattacks or infrastructure compromises.',
  },
];

// ── API call ──────────────────────────────────────────────────────────────────

/**
 * Run the Claude agentic intelligence loop.
 *
 * Claude will autonomously call tools (news, risk scores, market data, cyber
 * threats) to gather live intelligence before synthesizing a response.
 *
 * @param query - Natural-language question or task for the analyst
 * @param signal - Optional AbortSignal for cancellation
 * @returns Synthesized intelligence response with tool call log
 */
export async function runClaudeAgent(
  query: string,
  signal?: AbortSignal,
): Promise<AgentResponse> {
  if (isLocalModelOnly()) {
    throw new Error('cloud LLM is disabled: local-model-only mode is active');
  }
  if (!isLlmEgressDisclosed()) {
    try { document.dispatchEvent(new CustomEvent('cb:llm-egress-disclosure-needed')); }
    catch { /* non-browser context */ }
    throw new Error('cloud LLM is disabled: egress not yet acknowledged by user');
  }
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}/api/claude-agent`;

  const res = await fetch(url, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ query } satisfies AgentRequest),
 signal,
  });

  if (!res.ok) {
 let errorMessage = 'Agent request failed';
 try {
 const errData = await res.json() as { error?: string };
 if (errData && typeof errData === 'object') {
 errorMessage = errData.error ?? errorMessage;
 }
 } catch {
 // ignore parse error
 }
 throw new Error(errorMessage);
  }

  const agentData = await res.json() as AgentResponse;
  if (!agentData || typeof agentData !== 'object' || typeof agentData.response !== 'string') {
 throw new Error('Agent response malformed');
  }
  return agentData;
}

/** Human-readable label for a tool name */
export function toolLabel(toolName: string): string {
  const labels: Record<string, string> = {
 get_news_headlines: '📰 Fetching news headlines',
 get_risk_scores: '⚠️ Checking risk scores',
 get_market_summary: '📈 Getting market data',
 get_cyber_threats: '🔐 Scanning cyber threats',
  };
  return labels[toolName] ?? `🔧 Calling ${toolName}`;
}
