/**
 * Scenario Simulator — What-if cascading impact analysis
 *
 * Accepts a user-defined premise (e.g. "Iran closes Strait of Hormuz") and
 * projects cascading effects across military, economic, infrastructure,
 * humanitarian, cyber, and supply-chain domains.
 *
 * Primary path: sends structured prompt to Claude Agent for AI-powered analysis.
 * Fallback path: template-based projection using CAUSAL_TEMPLATES from the
 * situation forecaster.
 */

import { runClaudeAgent } from './claude-agent';
import { CAUSAL_TEMPLATES } from './situation-forecaster';
import type { ScenarioSeverity } from './situation-types';

// ── Types ────────────────────────────────────────────────────────────────────

export type ImpactDomain =
  | 'military'
  | 'economic'
  | 'infrastructure'
  | 'humanitarian'
  | 'cyber'
  | 'supply_chain';

export interface DomainImpact {
  domain: ImpactDomain;
  /** 0–1 severity within this domain */
  severity: number;
  description: string;
  cascadeEffects: string[];
}

export interface TimelineEvent {
  /** Hours from scenario onset */
  hours: number;
  event: string;
  /** 0–1 estimated probability */
  probability: number;
}

export interface ScenarioResult {
  premise: string;
  generatedAt: number;
  impacts: DomainImpact[];
  timeline: TimelineEvent[];
  overallSeverity: ScenarioSeverity;
  probabilityAssessment: string;
  personalImpact: string;
  recommendedPreparations: string[];
  /** Whether the result came from Claude AI or template fallback */
  source: 'claude' | 'template';
}

// ── Preset Scenarios ─────────────────────────────────────────────────────────

export const PRESET_SCENARIOS: string[] = [
  'Iran closes Strait of Hormuz',
  'China blockades Taiwan',
  'Major cyberattack on US grid',
  'Category 5 hurricane hits Gulf Coast',
  'Russia escalates in Baltic',
  'Global banking crisis',
  'Pandemic resurgence',
  'Nuclear incident',
];

// ── Cache ────────────────────────────────────────────────────────────────────

const CACHE_KEY = 'crystalball-scenario-cache';
const MAX_CACHED = 5;

function loadCache(): ScenarioResult[] {
  try {
 const stored = localStorage.getItem(CACHE_KEY);
 return stored ? (JSON.parse(stored) as ScenarioResult[]) : [];
  } catch {
 return [];
  }
}

function saveToCache(result: ScenarioResult): void {
  const cache = loadCache();
  cache.unshift(result);
  if (cache.length > MAX_CACHED) cache.length = MAX_CACHED;
  try {
 localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
 // Storage full — silently drop
  }
}

export function getCachedSimulations(): ScenarioResult[] {
  return loadCache();
}

// ── Claude-based Simulation ──────────────────────────────────────────────────

const SIMULATION_PROMPT = (premise: string): string =>
  `You are a geopolitical and crisis analyst. Simulate the cascading effects of the following scenario.

SCENARIO: "${premise}"

Analyze the impact across these six domains: military, economic, infrastructure, humanitarian, cyber, supply_chain.

Respond in STRICT JSON format (no markdown, no code fences, just raw JSON):
{
  "impacts": [
 {
 "domain": "military|economic|infrastructure|humanitarian|cyber|supply_chain",
 "severity": 0.0-1.0,
 "description": "Brief description of impact",
 "cascadeEffects": ["effect1", "effect2", "effect3"]
 }
  ],
  "timeline": [
 { "hours": 1, "event": "what happens", "probability": 0.0-1.0 },
 { "hours": 24, "event": "what happens", "probability": 0.0-1.0 },
 { "hours": 168, "event": "what happens at 7 days", "probability": 0.0-1.0 },
 { "hours": 720, "event": "what happens at 30 days", "probability": 0.0-1.0 }
  ],
  "overallSeverity": "catastrophic|severe|moderate|minor",
  "probabilityAssessment": "One sentence on overall likelihood and confidence",
  "personalImpact": "How this affects an average person in the US — fuel, food, safety, finances",
  "recommendedPreparations": ["action1", "action2", "action3"]
}

Include at least 4 timeline events covering 1h, 24h, 7d, and 30d horizons. Include all 6 domains in impacts.`;

interface ClaudeSimulationResponse {
  impacts: DomainImpact[];
  timeline: TimelineEvent[];
  overallSeverity: ScenarioSeverity;
  probabilityAssessment: string;
  personalImpact: string;
  recommendedPreparations: string[];
}

async function simulateWithClaude(
  premise: string,
  signal?: AbortSignal,
): Promise<ScenarioResult> {
  const agentResult = await runClaudeAgent(SIMULATION_PROMPT(premise), signal);

  // Extract JSON from the agent response — it may be wrapped in markdown fences
  let jsonStr = agentResult.response;
  const fenceMatch = /```(?:json)?[ \t]*\n([\s\S]*?)\n```/.exec(jsonStr);
  if (fenceMatch?.[1]) {
 jsonStr = fenceMatch[1];
  }

  // Try to find raw JSON object
  const braceStart = jsonStr.indexOf('{');
  const braceEnd = jsonStr.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
 jsonStr = jsonStr.slice(braceStart, braceEnd + 1);
  }

  const parsed = JSON.parse(jsonStr) as ClaudeSimulationResponse;

  // Validate and normalize
  const validDomains = new Set<string>([
 'military', 'economic', 'infrastructure', 'humanitarian', 'cyber', 'supply_chain',
  ]);
  const validSeverities = new Set<string>([
 'catastrophic', 'severe', 'moderate', 'minor', 'positive',
  ]);

  const impacts: DomainImpact[] = (parsed.impacts ?? [])
 .filter((i): i is DomainImpact =>
 !!i && validDomains.has(i.domain) && typeof i.severity === 'number',
 )
 .map(i => ({
 domain: i.domain,
 severity: Math.max(0, Math.min(1, i.severity)),
 description: String(i.description ?? ''),
 cascadeEffects: Array.isArray(i.cascadeEffects) ? i.cascadeEffects.map(String) : [],
 }));

  const timeline: TimelineEvent[] = (parsed.timeline ?? [])
 .filter((te): te is TimelineEvent =>
 !!te && typeof te.hours === 'number' && typeof te.event === 'string',
 )
 .map(te => ({
 hours: te.hours,
 event: te.event,
 probability: Math.max(0, Math.min(1, te.probability ?? 0.5)),
 }))
 .sort((a, b) => a.hours - b.hours);

  const overallSeverity: ScenarioSeverity = validSeverities.has(parsed.overallSeverity)
 ? parsed.overallSeverity
 : 'moderate';

  return {
 premise,
 generatedAt: Date.now(),
 impacts,
 timeline,
 overallSeverity,
 probabilityAssessment: String(parsed.probabilityAssessment ?? 'Unable to assess'),
 personalImpact: String(parsed.personalImpact ?? 'Impact assessment unavailable'),
 recommendedPreparations: Array.isArray(parsed.recommendedPreparations)
 ? parsed.recommendedPreparations.map(String)
 : [],
 source: 'claude',
  };
}

// ── Template-based Fallback ──────────────────────────────────────────────────

/** Keywords mapped to causal template IDs for fuzzy matching */
const PREMISE_TEMPLATE_MAP: Array<{ keywords: string[]; templateId: string }> = [
  { keywords: ['strait', 'hormuz', 'blockade', 'naval', 'taiwan', 'military', 'war', 'escalat', 'baltic', 'conflict', 'troops'], templateId: 'military-escalation' },
  { keywords: ['banking', 'crisis', 'market', 'crash', 'recession', 'inflation', 'debt', 'default'], templateId: 'economic-cascade' },
  { keywords: ['hurricane', 'earthquake', 'tsunami', 'volcano', 'flood', 'wildfire', 'tornado', 'cyclone'], templateId: 'natural-compound' },
  { keywords: ['cyber', 'hack', 'ransomware', 'grid', 'malware', 'ddos', 'attack'], templateId: 'cyber-escalation' },
  { keywords: ['pipeline', 'infrastructure', 'power', 'outage', 'supply chain', 'port', 'shipping'], templateId: 'infrastructure-disruption' },
  { keywords: ['pandemic', 'virus', 'outbreak', 'disease', 'quarantine', 'lockdown', 'unrest', 'protest', 'riot'], templateId: 'unrest-economic' },
  { keywords: ['nuclear', 'radiation', 'meltdown', 'reactor'], templateId: 'infrastructure-disruption' },
];

function matchTemplate(premise: string): string | null {
  const lower = premise.toLowerCase();
  let bestMatch: string | null = null;
  let bestScore = 0;

  for (const entry of PREMISE_TEMPLATE_MAP) {
 const score = entry.keywords.filter(kw => lower.includes(kw)).length;
 if (score > bestScore) {
 bestScore = score;
 bestMatch = entry.templateId;
 }
  }

  return bestScore > 0 ? bestMatch : null;
}

function simulateWithTemplates(premise: string): ScenarioResult {
  const templateId = matchTemplate(premise);
  const template = templateId
 ? CAUSAL_TEMPLATES.find(t => t.id === templateId)
 : null;

  if (!template) {
 return buildGenericFallback(premise);
  }

  // Build impacts from template domain and scenario templates
  const primaryDomain = template.domain;
  const scenarioSeverity = template.scenarioTemplates[0]?.severity ?? 'moderate';

  const domainSeverityMap: Record<ImpactDomain, number> = {
 military: primaryDomain === 'military' ? 0.8 : 0.3,
 economic: primaryDomain === 'economic' ? 0.8 : 0.5,
 infrastructure: primaryDomain === 'infrastructure' ? 0.8 : 0.4,
 humanitarian: primaryDomain === 'natural_hazard' ? 0.8 : 0.4,
 cyber: primaryDomain === 'cyber' ? 0.8 : 0.2,
 supply_chain: 0.5,
  };

  const impacts: DomainImpact[] = (Object.entries(domainSeverityMap) as Array<[ImpactDomain, number]>).map(
 ([domain, severity]) => ({
 domain,
 severity,
 description: `${domain.charAt(0).toUpperCase() + domain.slice(1).replace('_', ' ')} effects from "${premise}" based on ${template.name} pattern.`,
 cascadeEffects: template.links.map(l => l.label),
 }),
  );

  // Build timeline from causal chain delays
  let cumulativeHours = 0;
  const timeline: TimelineEvent[] = template.links.map(link => {
 cumulativeHours += link.delayHours;
 return {
 hours: cumulativeHours,
 event: link.label,
 probability: link.historicalRate,
 };
  });

  // Add 7d and 30d projections
  timeline.push(
 { hours: 168, event: `Extended ${primaryDomain} effects: ongoing disruption and response mobilization`, probability: 0.5 },
 { hours: 720, event: `Long-term adaptation: new equilibrium or policy response`, probability: 0.35 },
  );

  const preparations = template.actionTemplates.flatMap(a => a.steps);

  return {
 premise,
 generatedAt: Date.now(),
 impacts,
 timeline: [...timeline].sort((a, b) => a.hours - b.hours),
 overallSeverity: scenarioSeverity as ScenarioSeverity,
 probabilityAssessment: `Template-based projection using "${template.name}" pattern. Confidence depends on how closely the premise matches historical patterns.`,
 personalImpact: template.actionTemplates.map(a => a.rationale).join(' '),
 recommendedPreparations: preparations.length > 0 ? preparations : ['Monitor news developments', 'Review emergency preparedness', 'Check financial exposure'],
 source: 'template',
  };
}

function buildGenericFallback(premise: string): ScenarioResult {
  return {
 premise,
 generatedAt: Date.now(),
 impacts: ([
 'military', 'economic', 'infrastructure', 'humanitarian', 'cyber', 'supply_chain',
 ] as ImpactDomain[]).map(domain => ({
 domain,
 severity: 0.4,
 description: `Potential ${domain.replace('_', ' ')} disruption from "${premise}". Detailed analysis requires AI or more context.`,
 cascadeEffects: ['Cross-domain effects possible', 'Monitor for escalation'],
 })),
 timeline: [
 { hours: 1, event: 'Initial reports and market reaction', probability: 0.8 },
 { hours: 24, event: 'Government and institutional response', probability: 0.7 },
 { hours: 168, event: 'Secondary effects and adaptation', probability: 0.5 },
 { hours: 720, event: 'New equilibrium or prolonged disruption', probability: 0.35 },
 ],
 overallSeverity: 'moderate',
 probabilityAssessment: 'Generic projection — configure Claude AI for detailed analysis.',
 personalImpact: 'Impact depends on proximity and exposure. Monitor developments closely.',
 recommendedPreparations: [
 'Monitor news developments',
 'Review emergency preparedness',
 'Check financial exposure',
 'Verify communication plans',
 ],
 source: 'template',
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Run a what-if scenario simulation.
 *
 * Attempts Claude Agent first; falls back to template-based projection
 * if the agent is unavailable or fails.
 */
export async function simulateScenario(
  premise: string,
  signal?: AbortSignal,
): Promise<ScenarioResult> {
  let result: ScenarioResult;

  try {
 result = await simulateWithClaude(premise, signal);
  } catch {
 // Claude unavailable or failed — use template fallback
 result = simulateWithTemplates(premise);
  }

  saveToCache(result);
  return result;
}
