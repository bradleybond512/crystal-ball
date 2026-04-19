/**
 * AI Intelligence Briefing Service
 *
 * Collects state from all data sources (situation engine, unified alerts,
 * threat classifier, compound threats, economic stress, EMA forecast) and
 * generates a structured intelligence briefing via Claude Agent with
 * Ollama/Groq/OpenRouter/T5 fallback chain.
 *
 * Briefing sections: Executive Summary, Active Threats, Escalation Watch,
 * Economic Outlook, Recommended Actions, 24h Forecast.
 *
 * Caches in localStorage with 30-minute TTL.
 */

import { situationEngine } from './situation-engine';
import { unifiedAlertStore } from './unified-alerts';
import type { UnifiedAlert } from './unified-alerts';
import type { Situation } from './situation-types';
import { forecastRegions } from './ema-forecast';
import type { ForecastResult } from './ema-forecast';
import { runClaudeAgent } from './claude-agent';
import type { AgentResponse } from './claude-agent';
import { generateSummary } from './summarization';
import { getActiveConvergences } from './weather-threat-convergence';
import { getHotspots as getMatrixHotspots } from './correlation-matrix';

// ── Types ─────────────────────────────────────────────────────────────────────

export type BriefingSectionType =
  | 'executive-summary'
  | 'active-threats'
  | 'escalation-watch'
  | 'economic-outlook'
  | 'recommended-actions'
  | '24h-forecast';

export type ThreatSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface BriefingSection {
  type: BriefingSectionType;
  title: string;
  content: string;
  /** Optional threat severity for color-coding */
  severity?: ThreatSeverity;
  /** Sub-items (e.g. individual threat entries) */
  items?: BriefingItem[];
}

export interface BriefingItem {
  title: string;
  detail: string;
  severity?: ThreatSeverity;
}

export type BriefingProvider = 'claude' | 'ollama' | 'groq' | 'openrouter' | 'browser';

export interface IntelligenceBriefing {
  id: string;
  generatedAt: number;
  sections: BriefingSection[];
  provider: BriefingProvider;
  raw: string;
}

// ── Context Collection ────────────────────────────────────────────────────────

interface BriefingContext {
  situations: Situation[];
  alerts: UnifiedAlert[];
  forecasts: ForecastResult[];
  timestamp: number;
}

function collectContext(): BriefingContext {
  const situations = situationEngine.getSituations();
  const alerts = unifiedAlertStore.getAll();
  const forecasts = forecastRegions();

  return {
 situations,
 alerts,
 forecasts,
 timestamp: Date.now(),
  };
}

function buildContextSummary(ctx: BriefingContext): string {
  const lines: string[] = [];

  // Situations
  const activeSits = ctx.situations.filter(
 s => s.phase === 'active' || s.phase === 'developing',
  );
  if (activeSits.length > 0) {
 lines.push(`## Active Situations (${activeSits.length})`);
 for (const sit of activeSits.slice(0, 10)) {
 const phaseBadge = sit.phase.toUpperCase();
 const conf = Math.round(sit.confidence * 100);
 lines.push(`- [${phaseBadge}] ${sit.title} (${sit.domain}, ${conf}% confidence, ${sit.signals.length} signals)`);
 if (sit.summary) lines.push(`  ${sit.summary}`);
 if (sit.scenarios.length > 0) {
 const topScenario = sit.scenarios[0]!;
 lines.push(`  Top scenario: ${topScenario.label} (${Math.round(topScenario.probability * 100)}%, ${topScenario.severity})`);
 }
 }
  }

  // Alerts
  const critAlerts = ctx.alerts.filter(a => a.severity === 'critical');
  const highAlerts = ctx.alerts.filter(a => a.severity === 'high');
  if (critAlerts.length > 0 || highAlerts.length > 0) {
 lines.push(`\n## Active Alerts (${critAlerts.length} critical, ${highAlerts.length} high)`);
 for (const alert of [...critAlerts, ...highAlerts].slice(0, 15)) {
 lines.push(`- [${alert.severity.toUpperCase()}] ${alert.source}: ${alert.title}`);
 }
  }

  // EMA Forecasts
  const highRiskForecasts = ctx.forecasts.filter(f => f.risk24h >= 60);
  if (highRiskForecasts.length > 0) {
 lines.push(`\n## EMA Risk Forecast — High-Risk Regions`);
 for (const f of highRiskForecasts.slice(0, 10)) {
 lines.push(`- ${f.region}: risk=${f.risk24h}/100, trend=${f.trending}, deviation=${f.deviation.toFixed(1)} SD`);
 }
  }

  // Weather-threat convergence zones
  const convergences = getActiveConvergences();
  if (convergences.length > 0) {
    lines.push(`\n## Weather-Threat Convergence (${convergences.length})`);
    for (const c of convergences.slice(0, 8)) {
      const threats = c.collocatedThreats.map(t => t.source).join(', ');
      lines.push(`- ${c.weatherAlert.event} (${c.weatherAlert.severity}) converging with [${threats}]: score ${c.convergenceScore} — ${c.description}`);
    }
  }

  // Correlation matrix hotspots
  const hotspots = getMatrixHotspots(60);
  if (hotspots.length > 0) {
    lines.push(`\n## Correlation Matrix Hotspots (${hotspots.length})`);
    for (const h of hotspots.slice(0, 10)) {
      lines.push(`- ${h.region} × ${h.domain}: score ${h.score}`);
    }
  }

  // Timestamp
  lines.push(`\n## Timestamp: ${new Date(ctx.timestamp).toISOString()}`);

  return lines.join('\n');
}

// ── Prompt Construction ───────────────────────────────────────────────────────

function buildPrompt(contextSummary: string): string {
  return `You are an intelligence analyst for a global situational awareness system called Crystal Ball. Based on the following live data, produce a structured intelligence briefing.

Current data:
${contextSummary}

Produce the briefing in EXACTLY this format (use these exact section headers):

## EXECUTIVE SUMMARY
A 2-3 sentence overview of the global threat landscape right now.

## ACTIVE THREATS
List the top active threats ranked by severity. For each:
- **[SEVERITY] Threat Name**: Description and current status.
Use severity labels: CRITICAL, HIGH, MEDIUM, LOW.

## ESCALATION WATCH
Situations or regions that could escalate in the next 12-24 hours. Flag any that crossed thresholds recently.

## ECONOMIC OUTLOOK
Impact on markets, trade, and economic stability from current threat landscape.

## RECOMMENDED ACTIONS
Concrete monitoring or preparedness actions the user should take.

## 24H FORECAST
Your assessment of how the situation will evolve in the next 24 hours. Include probability estimates where possible.

Be concise but specific. Use data points from the context. If data is limited, say so rather than speculating.`;
}

// ── Response Parsing ──────────────────────────────────────────────────────────

const SECTION_MAP: Record<string, { type: BriefingSectionType; title: string }> = {
  'executive summary': { type: 'executive-summary', title: 'Executive Summary' },
  'active threats': { type: 'active-threats', title: 'Active Threats' },
  'escalation watch': { type: 'escalation-watch', title: 'Escalation Watch' },
  'economic outlook': { type: 'economic-outlook', title: 'Economic Outlook' },
  'recommended actions': { type: 'recommended-actions', title: 'Recommended Actions' },
  '24h forecast': { type: '24h-forecast', title: '24h Forecast' },
};

function parseSeverity(text: string): ThreatSeverity | undefined {
  const lower = text.toLowerCase();
  if (lower.includes('critical')) return 'critical';
  if (lower.includes('high')) return 'high';
  if (lower.includes('medium')) return 'medium';
  if (lower.includes('low')) return 'low';
  return undefined;
}

function parseBriefingItems(content: string): BriefingItem[] {
  const items: BriefingItem[] = [];
  // Match markdown list items with optional bold severity tags
   
  const itemPattern = /^[-*]\s+(?:\*\*\[(\w+)\]\s*(.*?)\*\*:?\s*)?(.*)$/gm;
  let match: RegExpExecArray | null;
  while ((match = itemPattern.exec(content)) !== null) {
 const severityTag = match[1] ?? '';
 const title = match[2] ?? match[3] ?? '';
 const detail = match[2] ? (match[3] ?? '') : '';
 items.push({
 title: title.trim(),
 detail: detail.trim(),
 severity: parseSeverity(severityTag),
 });
  }
  return items;
}

/** Try to match a header line to a known section type */
function matchSection(headerLower: string, body: string): BriefingSection | null {
  for (const [key, info] of Object.entries(SECTION_MAP)) {
 if (!headerLower.includes(key)) continue;
 const items = info.type === 'active-threats' ? parseBriefingItems(body) : [];
 const severity = info.type === 'active-threats'
 ? (items[0]?.severity ?? parseSeverity(body))
 : undefined;
 return {
 type: info.type,
 title: info.title,
 content: body,
 severity,
 items: items.length > 0 ? items : undefined,
 };
  }
  return null;
}

function parseResponse(raw: string): BriefingSection[] {
  const sections: BriefingSection[] = [];

  // Split on ## headers
  const parts = raw.split(/^##\s+/m).filter(Boolean);

  for (const part of parts) {
 const newlineIdx = part.indexOf('\n');
 const headerLine = newlineIdx === -1 ? part.trim() : part.slice(0, newlineIdx).trim();
 const body = newlineIdx === -1 ? '' : part.slice(newlineIdx + 1).trim();

 const section = matchSection(headerLine.toLowerCase(), body);
 if (section) {
 sections.push(section);
 } else if (body && !sections.some(s => s.type === 'executive-summary')) {
 // If no section match, add as executive summary if we don't have one yet
 sections.push({
 type: 'executive-summary',
 title: 'Executive Summary',
 content: body,
 });
 }
  }

  return sections;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

const CACHE_KEY = 'wm-intelligence-briefing-v1';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function saveBriefing(briefing: IntelligenceBriefing): void {
  try {
 localStorage.setItem(CACHE_KEY, JSON.stringify(briefing));
  } catch { /* storage full */ }
}

export function getCachedBriefing(): IntelligenceBriefing | null {
  try {
 const raw = localStorage.getItem(CACHE_KEY);
 if (!raw) return null;
 const parsed = JSON.parse(raw) as IntelligenceBriefing;
 if (Date.now() - parsed.generatedAt > CACHE_TTL_MS) return null;
 return parsed;
  } catch {
 return null;
  }
}

// ── Subscriber Pattern ────────────────────────────────────────────────────────

type BriefingListener = (briefing: IntelligenceBriefing) => void;
const listeners = new Set<BriefingListener>();

export function subscribeBriefing(cb: BriefingListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notifyListeners(briefing: IntelligenceBriefing): void {
  for (const listener of listeners) {
 try { listener(briefing); } catch { /* listener error */ }
  }
}

// ── Generation ────────────────────────────────────────────────────────────────

let _generating = false;

export async function generateBriefing(): Promise<IntelligenceBriefing> {
  // Return cached if fresh
  const cached = getCachedBriefing();
  if (cached && !_generating) return cached;

  if (_generating) {
 // If already generating, wait and return cached or throw
 return new Promise<IntelligenceBriefing>((resolve, reject) => {
 const unsub = subscribeBriefing((b) => {
 unsub();
 resolve(b);
 });
 // Timeout after 60s
 setTimeout(() => {
 unsub();
 const c = getCachedBriefing();
 if (c) resolve(c);
 else reject(new Error('Briefing generation timed out'));
 }, 60_000);
 });
  }

  _generating = true;

  try {
 const ctx = collectContext();
 const contextSummary = buildContextSummary(ctx);
 const prompt = buildPrompt(contextSummary);

 let raw = '';
 let provider: BriefingProvider = 'claude';

 // Try Claude Agent first
 try {
 const agentResult: AgentResponse = await runClaudeAgent(prompt);
 raw = agentResult.response;
 } catch {
 // Claude Agent unavailable — fall back to summarization chain

 // Fall back to summarization chain (Ollama -> Groq -> OpenRouter -> T5)
 const headlines = contextSummary.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2));
 if (headlines.length < 2) {
 headlines.push('Global threat assessment requested', 'No active threats detected in monitored regions');
 }
 const summaryResult = await generateSummary(headlines, undefined, contextSummary);
 if (summaryResult) {
 raw = summaryResult.summary;
 provider = summaryResult.provider as BriefingProvider;
 } else {
 throw new Error('All AI providers unavailable. Configure Ollama, Groq, OpenRouter, or Claude API key in Settings > API Keys.');
 }
 }

 // Parse response into structured sections
 let sections = parseResponse(raw);

 // If parsing yielded no sections (e.g. fallback provider gave plain text), wrap it
 if (sections.length === 0) {
 sections = [{
 type: 'executive-summary',
 title: 'Executive Summary',
 content: raw,
 }];
 }

 const briefing: IntelligenceBriefing = {
 id: `briefing-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
 generatedAt: Date.now(),
 sections,
 provider,
 raw,
 };

 saveBriefing(briefing);
 notifyListeners(briefing);
 return briefing;
  } finally {
 _generating = false;
  }
}
