/**
 * Situation Forecaster — Causal chain templates + probabilistic scenario projection
 *
 * Uses template-based reasoning: known escalation patterns (e.g., military
 * buildup → trade disruption → market crash) produce scenario trees. Each
 * scenario has a probability adjusted by signal strength, source diversity,
 * and chain coverage.
 */

import type {
  CausalTemplate,
  Scenario,
  Situation,
} from './situation-types';

// ── Causal Chain Templates ───────────────────────────────────────────────────

export const CAUSAL_TEMPLATES: CausalTemplate[] = [
  // ── Military Escalation ──────────────────────────────────────────────────
  {
 id: 'military-escalation',
 name: 'Military Escalation Spiral',
 domain: 'military',
 links: [
 { triggerType: 'military_surge', effectType: 'hotspot_escalation', delayHours: 6, historicalRate: 0.4, label: 'Buildup → Hotspot escalation' },
 { triggerType: 'hotspot_escalation', effectType: 'geo_convergence', delayHours: 12, historicalRate: 0.3, label: 'Escalation → Multi-domain convergence' },
 { triggerType: 'geo_convergence', effectType: 'velocity_spike', delayHours: 2, historicalRate: 0.7, label: 'Convergence → News velocity spike' },
 { triggerType: 'velocity_spike', effectType: 'silent_divergence', delayHours: 4, historicalRate: 0.5, label: 'News spike → Market divergence' },
 ],
 scenarioTemplates: [
 { label: 'Localized armed conflict escalation', description: 'Military buildup leads to active engagement in a hotspot zone. Expect flight restrictions, humanitarian corridor demands, and commodity price spikes.', severity: 'severe', horizonHours: 72, confirmationIndicators: ['Additional troop movements', 'Airspace closures', 'Embassy evacuations', 'UN emergency session'], invalidationIndicators: ['Diplomatic talks announced', 'Troop withdrawal signals', 'Ceasefire declaration'] },
 { label: 'Contained saber-rattling', description: 'Military posturing without kinetic action. Show of force dissipates within days.', severity: 'moderate', horizonHours: 48, confirmationIndicators: ['No further deployments', 'Diplomatic channels active', 'Markets stabilize'], invalidationIndicators: ['Further escalation', 'Border incidents reported', 'Casualty reports'] },
 ],
 actionTemplates: [
 { headline: 'Review travel plans for affected region', rationale: 'Military escalation may lead to airspace closures and travel disruptions.', urgency: 'soon', category: 'travel', steps: ['Check government travel advisories', 'Review flight routes through region', 'Identify alternative routes'] },
 { headline: 'Monitor energy and commodity exposure', rationale: 'Military conflicts in key regions disrupt energy supply chains.', urgency: 'monitor', category: 'financial', steps: ['Check oil/gas price movements', 'Review commodity-heavy portfolio positions', 'Set price alerts on energy ETFs'] },
 ],
  },

  // ── Economic Cascade ─────────────────────────────────────────────────────
  {
 id: 'economic-cascade',
 name: 'Economic Contagion Cascade',
 domain: 'economic',
 links: [
 { triggerType: 'prediction_leads_news', effectType: 'news_leads_markets', delayHours: 2, historicalRate: 0.6, label: 'Prediction shift → News breaks' },
 { triggerType: 'news_leads_markets', effectType: 'sector_cascade', delayHours: 4, historicalRate: 0.35, label: 'News → Sector contagion' },
 { triggerType: 'sector_cascade', effectType: 'silent_divergence', delayHours: 8, historicalRate: 0.25, label: 'Cascade → Silent divergence' },
 ],
 scenarioTemplates: [
 { label: 'Broad market correction', description: 'Sector contagion spreads beyond initial trigger. Expect 5–10% drawdown in correlated sectors within 48h.', severity: 'severe', horizonHours: 48, confirmationIndicators: ['VIX spike above 25', 'Multiple sectors red', 'Safe-haven flows (gold, treasuries)'], invalidationIndicators: ['Fed intervention signals', 'Buyback announcements', 'Positive earnings surprise'] },
 { label: 'Contained sector rotation', description: 'Money moves from affected sector into alternatives. Overall market impact limited.', severity: 'minor', horizonHours: 24, confirmationIndicators: ['Single sector drawdown', 'Other sectors flat/green', 'Volume normalizes'], invalidationIndicators: ['Contagion to 3+ sectors', 'Credit spreads widening'] },
 ],
 actionTemplates: [
 { headline: 'Review portfolio sector concentration', rationale: 'Economic contagion may spread to correlated sectors.', urgency: 'soon', category: 'financial', steps: ['Check sector allocation', 'Identify most exposed positions', 'Consider hedging via inverse ETFs or puts'] },
 { headline: 'Set stop-loss alerts on high-beta positions', rationale: 'Cascade events move fast — automated protection prevents large drawdowns.', urgency: 'immediate', category: 'financial', steps: ['Review high-beta holdings', 'Set trailing stops at 5–8%', 'Enable broker alerts'] },
 ],
  },

  // ── Infrastructure Disruption ────────────────────────────────────────────
  {
 id: 'infrastructure-disruption',
 name: 'Critical Infrastructure Disruption',
 domain: 'infrastructure',
 links: [
 { triggerType: 'flow_drop', effectType: 'flow_price_divergence', delayHours: 3, historicalRate: 0.55, label: 'Supply drop → Price divergence' },
 { triggerType: 'flow_price_divergence', effectType: 'sector_cascade', delayHours: 6, historicalRate: 0.3, label: 'Price divergence → Sector impact' },
 { triggerType: 'sector_cascade', effectType: 'velocity_spike', delayHours: 2, historicalRate: 0.5, label: 'Sector impact → News eruption' },
 ],
 scenarioTemplates: [
 { label: 'Sustained supply disruption', description: 'Pipeline, shipping, or grid outage persists >48h. Cascading effects on downstream industries.', severity: 'severe', horizonHours: 72, confirmationIndicators: ['No repair timeline announced', 'Alternative routes at capacity', 'Government emergency declaration'], invalidationIndicators: ['Repair completion announced', 'Strategic reserves released', 'Alternative supply secured'] },
 { label: 'Brief disruption with quick recovery', description: 'Supply interruption resolved within hours. Price spike fully reverses.', severity: 'minor', horizonHours: 12, confirmationIndicators: ['Repair progress reported', 'Prices stabilizing', 'Backup systems engaged'], invalidationIndicators: ['Disruption scope expanding', 'Second incident reported'] },
 ],
 actionTemplates: [
 { headline: 'Check local utility and supply chain dependencies', rationale: 'Infrastructure disruptions cascade into local shortages.', urgency: 'soon', category: 'supply_chain', steps: ['Verify backup power/water', 'Check fuel reserves', 'Review critical supply delivery schedules'] },
 ],
  },

  // ── Cyber Escalation ─────────────────────────────────────────────────────
  {
 id: 'cyber-escalation',
 name: 'Coordinated Cyber Campaign',
 domain: 'cyber',
 links: [
 { triggerType: 'keyword_spike', effectType: 'convergence', delayHours: 1, historicalRate: 0.4, label: 'Threat keyword surge → Source convergence' },
 { triggerType: 'convergence', effectType: 'velocity_spike', delayHours: 3, historicalRate: 0.5, label: 'Convergence → Public awareness spike' },
 ],
 scenarioTemplates: [
 { label: 'Targeted critical infrastructure attack', description: 'Coordinated cyber operation against utilities, financial systems, or government networks.', severity: 'catastrophic', horizonHours: 24, confirmationIndicators: ['Service outages reported', 'Government CISA alert', 'Multiple organizations affected'], invalidationIndicators: ['Isolated incident confirmed', 'Patch deployed', 'Attribution to known low-tier actor'] },
 { label: 'Opportunistic campaign — limited impact', description: 'Broad but shallow attack exploiting known vulnerability. Most organizations unaffected.', severity: 'moderate', horizonHours: 12, confirmationIndicators: ['Specific CVE identified', 'Patch available', 'Limited victim count'], invalidationIndicators: ['Zero-day confirmed', 'Critical infrastructure hit'] },
 ],
 actionTemplates: [
 { headline: 'Verify critical system patches and backups', rationale: 'Coordinated cyber campaigns exploit unpatched systems.', urgency: 'immediate', category: 'cyber_hygiene', steps: ['Check for pending security updates', 'Verify backup integrity', 'Enable MFA on critical accounts', 'Review firewall rules'] },
 { headline: 'Monitor IDS/SIEM for indicators of compromise', rationale: 'Early detection limits blast radius.', urgency: 'immediate', category: 'cyber_hygiene', steps: ['Check Suricata/Zeek alerts', 'Review unusual outbound connections', 'Cross-reference with published IOCs'] },
 ],
  },

  // ── Natural Hazard Compound ──────────────────────────────────────────────
  {
 id: 'natural-compound',
 name: 'Compound Natural Hazard',
 domain: 'natural_hazard',
 links: [
 { triggerType: 'geo_convergence', effectType: 'flow_drop', delayHours: 6, historicalRate: 0.3, label: 'Hazard convergence → Infrastructure impact' },
 { triggerType: 'flow_drop', effectType: 'velocity_spike', delayHours: 2, historicalRate: 0.6, label: 'Infrastructure down → News eruption' },
 ],
 scenarioTemplates: [
 { label: 'Multi-hazard humanitarian crisis', description: 'Overlapping natural hazards overwhelm response capacity. Expect displacement, supply shortages, and international aid mobilization.', severity: 'catastrophic', horizonHours: 72, confirmationIndicators: ['Multiple disaster declarations', 'Evacuation orders', 'Aid agency activation', 'Hospital capacity alerts'], invalidationIndicators: ['Hazards subside', 'Response capacity sufficient', 'No secondary hazards'] },
 { label: 'Sequential but manageable events', description: 'Hazards are geographically separated enough that response systems cope.', severity: 'moderate', horizonHours: 48, confirmationIndicators: ['Response teams deployed', 'No cascade effects', 'Utilities restored quickly'], invalidationIndicators: ['New hazard in same zone', 'Response overwhelmed'] },
 ],
 actionTemplates: [
 { headline: 'Review personal emergency preparedness', rationale: 'Compound hazards can disrupt utilities and supply chains for extended periods.', urgency: 'soon', category: 'physical_safety', steps: ['Check emergency supply kit', 'Verify communication plan', 'Identify evacuation routes', 'Charge devices and portable batteries'] },
 ],
  },

  // ── Civil Unrest → Economic Spillover ────────────────────────────────────
  {
 id: 'unrest-economic',
 name: 'Civil Unrest → Economic Spillover',
 domain: 'civil_unrest',
 links: [
 { triggerType: 'keyword_spike', effectType: 'velocity_spike', delayHours: 1, historicalRate: 0.6, label: 'Unrest keywords → News velocity' },
 { triggerType: 'velocity_spike', effectType: 'convergence', delayHours: 3, historicalRate: 0.5, label: 'News velocity → Source convergence' },
 { triggerType: 'convergence', effectType: 'news_leads_markets', delayHours: 6, historicalRate: 0.35, label: 'Convergence → Market reaction' },
 ],
 scenarioTemplates: [
 { label: 'Prolonged instability with capital flight', description: 'Sustained unrest triggers investor exodus. Currency depreciation and sovereign credit downgrades follow.', severity: 'severe', horizonHours: 72, confirmationIndicators: ['Currency weakening >3%', 'Foreign investors selling', 'Martial law or curfews'], invalidationIndicators: ['Government concessions', 'Protest leaders negotiate', 'Security forces stand down'] },
 { label: 'Brief unrest — quick resolution', description: 'Government responds to demands or protests lose momentum. Markets recover within days.', severity: 'minor', horizonHours: 24, confirmationIndicators: ['Negotiations started', 'Protest turnout declining', 'Markets stabilizing'], invalidationIndicators: ['Escalation to violence', 'General strike called', 'Military deployed'] },
 ],
 actionTemplates: [
 { headline: 'Review exposure to affected country', rationale: 'Civil unrest can trigger capital controls, currency devaluation, and supply disruptions.', urgency: 'soon', category: 'financial', steps: ['Check portfolio exposure to affected markets', 'Review supply chain dependencies', 'Monitor sovereign credit outlook'] },
 ],
  },
];

// ── Scenario Projection ──────────────────────────────────────────────────────

/**
 * Project scenarios for a situation based on:
 * 1. Matched causal chain template
 * 2. Signal coverage (what fraction of the chain has fired)
 * 3. Signal confidence and recency
 */
export function projectScenarios(situation: Situation): Scenario[] {
  const template = CAUSAL_TEMPLATES.find(t => t.id === situation.causalChainId);
  if (!template) {
 return generateFallbackScenarios(situation);
  }

  const signalTypes = new Set(situation.signals.map(s => s.type));

  // Chain coverage: fraction of expected signals we've seen
  const chainTypes = template.links.map(l => l.triggerType);
  const coverage = chainTypes.filter(t => signalTypes.has(t)).length / chainTypes.length;

  // Average historical rate of chain progression
  const avgRate = template.links.reduce((s, l) => s + l.historicalRate, 0) / template.links.length;

  return template.scenarioTemplates.map((tmpl, i) => {
 // Base probability from chain coverage × historical rate × situation confidence
 let prob = coverage * avgRate * situation.confidence;

 // First scenario (worst case) gets boosted by cross-domain diversity
 if (i === 0 && situation.domainDiversity >= 2) {
 prob = Math.min(0.95, prob * 1.3);
 }

 // Later scenarios (better case) get the remainder probability
 if (i > 0) {
 prob = Math.max(0.1, (1 - prob) * 0.6);
 }

 // Freshness boost: recent signals increase probability
 const avgAge = situation.signals.reduce(
 (s, sig) => s + (Date.now() - sig.timestamp), 0,
 ) / situation.signals.length;
 const freshnessMultiplier = avgAge < 3600000 ? 1.1 : avgAge < 21600000 ? 1.0 : 0.85;
 prob *= freshnessMultiplier;

 return {
 id: `${situation.id}-sc${i}`,
 label: tmpl.label,
 description: tmpl.description,
 probability: Math.min(0.95, Math.max(0.05, prob)),
 severity: tmpl.severity,
 horizonHours: tmpl.horizonHours,
 confirmationIndicators: tmpl.confirmationIndicators,
 invalidationIndicators: tmpl.invalidationIndicators,
 };
  }).sort((a, b) => b.probability - a.probability);
}

/**
 * Generate generic scenarios when no causal template matches.
 */
function generateFallbackScenarios(situation: Situation): Scenario[] {
  const base = situation.confidence;
  return [
 {
 id: `${situation.id}-sc-esc`,
 label: 'Escalation — situation worsens',
 description: `Current ${situation.domain} signals intensify. Additional corroborating data emerges within 24h.`,
 probability: Math.min(0.7, base * 0.8),
 severity: base > 0.6 ? 'severe' : 'moderate',
 horizonHours: 24,
 confirmationIndicators: ['New signals in same region', 'Source count increasing', 'Government statements'],
 invalidationIndicators: ['Signal count plateaus', 'Key actors de-escalate', 'No corroboration after 12h'],
 },
 {
 id: `${situation.id}-sc-stable`,
 label: 'Stabilization — situation contained',
 description: 'Initial signals do not develop further. Situation remains at current level or dissipates.',
 probability: Math.max(0.15, 1 - base * 0.8),
 severity: 'minor',
 horizonHours: 12,
 confirmationIndicators: ['No new signals', 'Diplomatic activity', 'Markets stable'],
 invalidationIndicators: ['New signals emerge', 'Escalation in adjacent domain'],
 },
  ];
}
