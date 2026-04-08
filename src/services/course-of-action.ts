/**
 * Course-of-Action (COA) Service
 *
 * When the app's mode changes (peace → war, peace → disaster, etc.),
 * generates 2-3 concrete action plans based on:
 * - Current mode and severity
 * - Active alerts near the user's location
 * - Weather conditions
 * - Infrastructure status
 *
 * Uses Claude Agent or Ollama for AI-generated COAs with
 * a structured fallback for when no LLM is available.
 *
 * Inspired by Palantir AIP's decision-support workflows
 * and COA-GPT (arxiv:2402.01786).
 */

import type { AppMode } from './mode-manager';

export interface CourseOfAction {
  id: string;
  title: string;
  summary: string;
  priority: 'immediate' | 'near-term' | 'contingency';
  steps: string[];
  risks: string[];
  resources: string[];
  /** Panel IDs to link to for more detail */
  relatedPanels: string[];
  /** Estimated time to execute (human-readable) */
  timeEstimate: string;
}

export interface CoaSet {
  mode: AppMode | null;
  generatedAt: number;
  location: string | null;
  options: CourseOfAction[];
  aiGenerated: boolean;
}

// ── Template-Based COAs (fallback when no LLM) ──────────────────────────────

const DISASTER_COAS: CourseOfAction[] = [
  {
 id: 'shelter-in-place',
 title: 'Shelter in Place',
 summary: 'Remain at current location with emergency supplies. Best when evacuation routes are compromised or event is too close.',
 priority: 'immediate',
 steps: [
 'Verify water supply (1 gallon per person per day for 3 days)',
 'Charge all communication devices',
 'Move to interior room away from windows',
 'Monitor NOAA Weather Radio and local emergency channels',
 'Seal doors/windows if air quality threat',
 ],
 risks: ['Structure damage if major earthquake/tornado', 'Isolation if infrastructure fails'],
 resources: ['Water', 'Non-perishable food', 'First aid kit', 'Battery-powered radio', 'Flashlights'],
 relatedPanels: ['hazard-alerts', 'power-grid', 'water-quality'],
 timeEstimate: 'Ongoing',
  },
  {
 id: 'evacuate-primary',
 title: 'Evacuate via Primary Route',
 summary: 'Leave the area using the main evacuation corridor. Best when advance warning allows orderly departure.',
 priority: 'immediate',
 steps: [
 'Grab go-bag and essential documents',
 'Check evacuation route status for closures',
 'Fuel vehicle to full — gas stations may close',
 'Contact family members with meeting point',
 'Follow official evacuation orders — do not deviate',
 ],
 risks: ['Route congestion', 'Fuel shortages', 'Bridge/road damage'],
 resources: ['Vehicle with full tank', 'Go-bag', 'Cash', 'Phone charger', 'Maps (paper backup)'],
 relatedPanels: ['evacuation-routes', 'family-tracker', 'local-logistics'],
 timeEstimate: '2-6 hours',
  },
  {
 id: 'evacuate-alternate',
 title: 'Evacuate via Alternate Route',
 summary: 'Secondary evacuation path avoiding main corridors. Use when primary routes are compromised.',
 priority: 'contingency',
 steps: [
 'Identify 2-3 alternate routes using offline maps',
 'Avoid bridges, tunnels, and coastal roads',
 'Coordinate with family on alternate meeting point',
 'Monitor road conditions via traffic cameras',
 'Consider shelter-in-place if all routes blocked',
 ],
 risks: ['Unfamiliar roads', 'Longer travel time', 'Reduced cell coverage'],
 resources: ['Offline maps', 'Paper maps', 'Extra fuel', 'Water for extended travel'],
 relatedPanels: ['evacuation-routes', 'offline-maps', 'family-tracker'],
 timeEstimate: '4-12 hours',
  },
];

const WAR_COAS: CourseOfAction[] = [
  {
 id: 'comms-hardening',
 title: 'Harden Communications',
 summary: 'Establish resilient communication channels before infrastructure degradation.',
 priority: 'immediate',
 steps: [
 'Download offline maps for your region',
 'Establish family communication plan with out-of-area contacts',
 'Pre-configure mesh networking apps (Briar, Bridgefy)',
 'Store important contacts in paper format',
 'Monitor for GPS jamming and internet shutdowns',
 ],
 risks: ['Communications may be monitored', 'Cell networks may be prioritized for military'],
 resources: ['Ham radio (if licensed)', 'Satellite phone', 'Mesh networking app', 'Paper contacts list'],
 relatedPanels: ['comms-plan', 'sigint-panel', 'internet-outages'],
 timeEstimate: '1-2 hours',
  },
  {
 id: 'supply-stockpile',
 title: 'Supply Stockpiling',
 summary: 'Build 30-day supply reserves before potential shortages and price spikes.',
 priority: 'near-term',
 steps: [
 'Stock 30 days of water (1 gal/person/day)',
 'Stock 30 days of non-perishable food',
 'Obtain essential medications (90-day supply)',
 'Withdraw emergency cash (ATMs may go offline)',
 'Fuel all vehicles and portable generators',
 ],
 risks: ['Hoarding can worsen shortages for others', 'Price gouging'],
 resources: ['Water storage containers', 'Canned/dried food', 'Prescription medications', 'Cash', 'Fuel containers'],
 relatedPanels: ['supply-chain', 'local-logistics', 'resource-inventory'],
 timeEstimate: '1-3 days',
  },
  {
 id: 'situational-awareness',
 title: 'Maximum Situational Awareness',
 summary: 'Maintain continuous monitoring of all threat vectors. Information advantage is survival advantage.',
 priority: 'immediate',
 steps: [
 'Enable all Crystal Ball alert panels',
 'Set proximity alerts for your area and family locations',
 'Monitor escalation forecast panel for theater changes',
 'Subscribe to official government alert channels',
 'Identify nearest bomb shelters and hardened structures',
 ],
 risks: ['Information overload — prioritize actionable alerts', 'Misinformation campaigns'],
 resources: ['Battery backup for monitoring devices', 'NOAA radio', 'Multiple news sources'],
 relatedPanels: ['escalation-forecast', 'hazard-alerts', 'survival-advisor'],
 timeEstimate: 'Ongoing',
  },
];

const GHOST_COAS: CourseOfAction[] = [
  {
 id: 'digital-minimization',
 title: 'Minimize Digital Footprint',
 summary: 'Reduce electronic emissions and tracking exposure.',
 priority: 'immediate',
 steps: [
 'Disable all non-essential location services',
 'Use VPN for all internet traffic',
 'Switch to encrypted messaging (Signal)',
 'Disable Bluetooth and Wi-Fi when not in use',
 'Review and revoke unnecessary app permissions',
 ],
 risks: ['May lose access to some services', 'VPN may be blocked in some regions'],
 resources: ['VPN service', 'Signal app', 'Faraday bag for phone'],
 relatedPanels: ['cyber-threats', 'sigint-panel'],
 timeEstimate: '30 minutes',
  },
];

// ── Public API ───────────────────────────────────────────────────────────────

let currentCoas: CoaSet | null = null;

/**
 * Generate COAs for the given mode using template fallback.
 * AI-generated COAs require calling generateAiCoas() separately.
 */
const DEFAULT_FINANCE_COA: CourseOfAction = {
  id: 'financial-monitoring',
  title: 'Enhanced Financial Monitoring',
  summary: 'Market volatility detected. Monitor positions and prepare hedging strategies.',
  priority: 'near-term',
  steps: [
 'Review portfolio exposure to affected sectors',
 'Set stop-loss orders on volatile positions',
 'Monitor central bank announcements',
 'Ensure emergency fund is liquid',
  ],
  risks: ['Flash crashes', 'Liquidity freezes', 'Currency devaluation'],
  resources: ['Access to brokerage accounts', 'Cash reserves'],
  relatedPanels: ['economic-stress', 'financial-contagion', 'supply-chain'],
  timeEstimate: '1 hour',
};

export function generateCoas(mode: AppMode | null, locationLabel?: string): CoaSet {
  // Mode collapse: the default set now merges disaster + war + finance COAs
  // unconditionally. Ghost mode keeps its dedicated set.
  const options: CourseOfAction[] =
 mode === 'ghost'
 ? [...GHOST_COAS]
 : [...DISASTER_COAS, ...WAR_COAS, DEFAULT_FINANCE_COA];

  currentCoas = {
 mode,
 generatedAt: Date.now(),
 location: locationLabel ?? null,
 options,
 aiGenerated: false,
  };

  return currentCoas;
}

export function getCurrentCoas(): CoaSet | null {
  return currentCoas;
}

/**
 * Build the prompt for AI-based COA generation.
 * Feed this to Claude Agent or Ollama.
 */
export function buildCoaPrompt(mode: AppMode | null, alerts: string[], locationLabel?: string): string {
  return `You are a situational awareness AI for a personal security monitoring app.

Current threat mode: ${(mode ?? 'default').toUpperCase()}
Location: ${locationLabel ?? 'Unknown'}
Active alerts:
${alerts.map(a => `- ${a}`).join('\n')}

Generate exactly 3 Courses of Action (COAs) for a civilian in this situation.
For each COA provide:
- title (short, action-oriented)
- summary (1 sentence)
- priority: "immediate", "near-term", or "contingency"
- steps: array of 3-5 concrete steps
- risks: array of 1-3 risks
- resources: array of needed resources
- timeEstimate: human-readable estimate

Respond in JSON format as an array of COA objects.`;
}
