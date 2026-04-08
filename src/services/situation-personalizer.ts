/**
 * Situation Personalizer — Translates situations into user-specific action cards
 *
 * Considers:
 * - User's saved places (proximity to situation)
 * - User's watchlist countries/topics
 * - Current app mode (war/finance/disaster)
 * - Situation domain and severity
 * - Matched causal chain templates
 */

import type {
  ActionCard,
  ActionCategory,
  ActionUrgency,
  Situation,
  SituationDomain,
} from './situation-types';
import { CAUSAL_TEMPLATES } from './situation-forecaster';

// ── User Context ─────────────────────────────────────────────────────────────

export interface UserContext {
  /** User's current coordinates (null if not shared) */
  location: { lat: number; lon: number } | null;
  /** Countries the user has in their watchlist */
  watchlistCountries: string[];
  /** Topics/keywords the user tracks */
  watchlistTopics: string[];
  /** Current app mode */
  appMode: 'ghost' | 'gods-vision' | 'default';
  /** User's saved places with coordinates */
  savedPlaces: Array<{ name: string; lat: number; lon: number; country?: string }>;
}

/** Load user context from available app state */
export function buildUserContext(): UserContext {
  // Watchlist from localStorage
  let watchlistCountries: string[] = [];
  let watchlistTopics: string[] = [];
  try {
 const raw = localStorage.getItem('crystalball-watchlist');
 if (raw) {
 const wl = JSON.parse(raw);
 if (Array.isArray(wl)) {
 watchlistCountries = wl
 .filter((w: { type?: string }) => w.type === 'country')
 .map((w: { id?: string }) => w.id ?? '')
 .filter(Boolean);
 watchlistTopics = wl
 .filter((w: { type?: string }) => w.type === 'topic' || w.type === 'keyword')
 .map((w: { label?: string }) => w.label ?? '')
 .filter(Boolean);
 }
 }
  } catch { /* */ }

  // Saved places from localStorage
  let savedPlaces: UserContext['savedPlaces'] = [];
  try {
 const raw = localStorage.getItem('crystalball-saved-places');
 if (raw) {
 const sp = JSON.parse(raw);
 if (Array.isArray(sp)) {
 savedPlaces = sp.filter((p: { lat?: number; lon?: number }) =>
 typeof p.lat === 'number' && typeof p.lon === 'number',
 );
 }
 }
  } catch { /* */ }

  // User location from localStorage
  let location: UserContext['location'] = null;
  try {
 const raw = localStorage.getItem('crystalball-user-location');
 if (raw) {
 const loc = JSON.parse(raw);
 if (typeof loc.lat === 'number' && typeof loc.lon === 'number') {
 location = { lat: loc.lat, lon: loc.lon };
 }
 }
  } catch { /* */ }

  // App mode
  let appMode: UserContext['appMode'] = 'default';
  try {
 const raw = localStorage.getItem('crystalball-app-mode');
 if (raw === 'ghost' || raw === 'gods-vision') {
 appMode = raw;
 }
  } catch { /* */ }

  return { location, watchlistCountries, watchlistTopics, appMode, savedPlaces };
}

// ── Relevance to User ────────────────────────────────────────────────────────

interface PersonalRelevance {
  score: number; // 0–1
  reasons: string[]; // why this matters to the user
  proximityKm: number | null;
  watchlistMatch: boolean;
}

function computePersonalRelevance(situation: Situation, ctx: UserContext): PersonalRelevance {
  let score = 0;
  const reasons: string[] = [];
  let proximityKm: number | null = null;
  let watchlistMatch = false;

  // 1. Watchlist country match (strongest signal)
  const countryMatch = situation.geo.countries.some(c =>
 ctx.watchlistCountries.includes(c),
  );
  if (countryMatch) {
 score += 0.4;
 watchlistMatch = true;
 reasons.push('Matches your watchlist countries');
  }

  // 2. Topic/keyword overlap
  const sitKeywords = situation.signals
 .map(s => s.title.toLowerCase())
 .join(' ');
  const topicMatch = ctx.watchlistTopics.some(t =>
 sitKeywords.includes(t.toLowerCase()),
  );
  if (topicMatch) {
 score += 0.2;
 watchlistMatch = true;
 reasons.push('Matches your tracked topics');
  }

  // 3. Geographic proximity to saved places
  if (situation.geo.lat !== 0 || situation.geo.lon !== 0) {
 let minDist = Infinity;
 let closestPlace = '';

 const checkPoints = [
 ...(ctx.location ? [{ name: 'your location', lat: ctx.location.lat, lon: ctx.location.lon }] : []),
 ...ctx.savedPlaces,
 ];

 for (const pt of checkPoints) {
 const dist = haversineKm(pt.lat, pt.lon, situation.geo.lat, situation.geo.lon);
 if (dist < minDist) {
 minDist = dist;
 closestPlace = pt.name;
 }
 }

 if (minDist < Infinity) {
 proximityKm = Math.round(minDist);
 if (minDist < 100) {
 score += 0.35;
 reasons.push(`Within 100km of ${closestPlace}`);
 } else if (minDist < 500) {
 score += 0.15;
 reasons.push(`Within 500km of ${closestPlace}`);
 } else if (minDist < 2000) {
 score += 0.05;
 reasons.push(`Within 2000km of ${closestPlace}`);
 }
 }
  }

  // 4. Domain relevance boost — formerly gated on war/finance/disaster mode.
  // Inlined as an unconditional +0.05 for every situation in a monitored
  // domain (military / economic / natural_hazard), since all three used to
  // auto-trigger in their respective modes and the user wanted all of them
  // always-on.
  if (
 situation.domain === 'military' ||
 situation.domain === 'economic' ||
 situation.domain === 'natural_hazard'
  ) {
 score += 0.05;
 reasons.push('Matches a monitored domain');
  }

  // 5. Base relevance from situation confidence
  score += situation.confidence * 0.15;

  // Ensure no user context → still get baseline
  if (reasons.length === 0) {
 reasons.push('Global situation — affects multiple regions');
  }

  return {
 score: Math.min(1, score),
 reasons,
 proximityKm,
 watchlistMatch,
  };
}

// ── Action Card Generation ───────────────────────────────────────────────────

let _actionIdCounter = 0;
const genActionId = () => `act-${Date.now().toString(36)}-${(++_actionIdCounter).toString(36)}`;

function urgencyFromSituation(situation: Situation, relevance: PersonalRelevance): ActionUrgency {
  if (situation.phase === 'active' && relevance.score > 0.6) return 'immediate';
  if (situation.phase === 'active' || situation.phase === 'developing') return 'soon';
  if (situation.phase === 'emerging') return 'monitor';
  return 'fyi';
}

/** Domain → default action categories */
const DOMAIN_ACTIONS: Record<SituationDomain, ActionCategory[]> = {
  military: ['travel', 'physical_safety', 'financial'],
  economic: ['financial', 'supply_chain'],
  natural_hazard: ['physical_safety', 'communications', 'supply_chain'],
  cyber: ['cyber_hygiene', 'communications'],
  infrastructure: ['supply_chain', 'communications', 'physical_safety'],
  health: ['physical_safety', 'supply_chain'],
  civil_unrest: ['travel', 'physical_safety', 'financial'],
  compound: ['information', 'physical_safety', 'financial'],
};

function generateGenericActions(
  situation: Situation,
  relevance: PersonalRelevance,
): ActionCard[] {
  const urgency = urgencyFromSituation(situation, relevance);
  const categories = DOMAIN_ACTIONS[situation.domain] ?? ['information'];
  const actions: ActionCard[] = [];

  // Always generate a "stay informed" action
  actions.push({
 id: genActionId(),
 headline: `Monitor: ${situation.title}`,
 rationale: relevance.reasons[0] ?? 'Developing situation requires attention.',
 urgency: urgency === 'immediate' ? 'soon' : 'monitor',
 category: 'information',
 steps: [
 'Keep this situation panel open for updates',
 'Watch for confirmation/invalidation indicators',
 'Check back in 1–2 hours',
 ],
 situationId: situation.id,
 scenarioId: null,
 dismissed: false,
  });

  // Domain-specific generic action
  if (categories.includes('financial') && situation.confidence > 0.4) {
 actions.push({
 id: genActionId(),
 headline: 'Review financial exposure to affected region',
 rationale: `${situation.domain} situation in ${situation.geo.label} may impact markets.`,
 urgency,
 category: 'financial',
 steps: [
 'Check portfolio for geographic/sector exposure',
 'Review stop-loss positions',
 'Monitor safe-haven assets (gold, USD, treasuries)',
 ],
 situationId: situation.id,
 scenarioId: null,
 dismissed: false,
 });
  }

  if (categories.includes('physical_safety') && relevance.proximityKm !== null && relevance.proximityKm < 500) {
 actions.push({
 id: genActionId(),
 headline: 'Review personal safety preparations',
 rationale: `Situation is ${relevance.proximityKm}km from your location.`,
 urgency: relevance.proximityKm < 100 ? 'immediate' : 'soon',
 category: 'physical_safety',
 steps: [
 'Verify emergency supplies',
 'Confirm communication plan with family',
 'Check evacuation routes if applicable',
 'Keep devices charged',
 ],
 situationId: situation.id,
 scenarioId: null,
 dismissed: false,
 });
  }

  return actions;
}

// ── Main Personalizer API ────────────────────────────────────────────────────

/**
 * Generate personalized action cards for a situation.
 * Combines template-based actions (from causal chains) with generic domain actions,
 * filtered by user relevance.
 */
export function personalizeSituation(
  situation: Situation,
  ctx?: UserContext,
): ActionCard[] {
  const userCtx = ctx ?? buildUserContext();
  const relevance = computePersonalRelevance(situation, userCtx);

  // Ghost mode: suppress action generation
  if (userCtx.appMode === 'ghost') return [];

  // Low relevance + low confidence: only monitor action
  if (relevance.score < 0.15 && situation.confidence < 0.3) {
 return [{
 id: genActionId(),
 headline: `Background: ${situation.title}`,
 rationale: 'Low relevance to your profile. Monitoring for changes.',
 urgency: 'fyi',
 category: 'information',
 steps: ['No action needed at this time'],
 situationId: situation.id,
 scenarioId: null,
 dismissed: false,
 }];
  }

  const actions: ActionCard[] = [];

  // 1. Template-based actions from matched causal chain
  const template = CAUSAL_TEMPLATES.find(t => t.id === situation.causalChainId);
  if (template) {
 for (const tmpl of template.actionTemplates) {
 const urgency: ActionUrgency = relevance.score > 0.5
 ? tmpl.urgency
 : (tmpl.urgency === 'immediate' ? 'soon' : tmpl.urgency);

 actions.push({
 ...tmpl,
 id: genActionId(),
 urgency,
 situationId: situation.id,
 scenarioId: null,
 dismissed: false,
 });
 }
  }

  // 2. Scenario-specific hedging actions
  for (const scenario of situation.scenarios) {
 if (scenario.probability > 0.3 && scenario.severity !== 'positive' && scenario.severity !== 'minor') {
 actions.push({
 id: genActionId(),
 headline: `Hedge: ${scenario.label}`,
 rationale: `${Math.round(scenario.probability * 100)}% probability within ${scenario.horizonHours}h. ${relevance.reasons[0] ?? ''}`,
 urgency: scenario.probability > 0.6 ? 'soon' : 'monitor',
 category: scenario.severity === 'catastrophic' ? 'physical_safety' : 'information',
 steps: [
 `Watch for: ${scenario.confirmationIndicators.slice(0, 2).join('; ')}`,
 `Would invalidate: ${scenario.invalidationIndicators.slice(0, 2).join('; ')}`,
 ],
 situationId: situation.id,
 scenarioId: scenario.id,
 dismissed: false,
 });
 }
  }

  // 3. Generic domain actions
  const generic = generateGenericActions(situation, relevance);
  actions.push(...generic);

  // Deduplicate by headline similarity and sort by urgency
  const urgencyOrder: Record<ActionUrgency, number> = { immediate: 0, soon: 1, monitor: 2, fyi: 3 };
  const seen = new Set<string>();
  return actions
 .filter(a => {
 const key = a.headline.toLowerCase().slice(0, 40);
 if (seen.has(key)) return false;
 seen.add(key);
 return true;
 })
 .sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency])
 .slice(0, 6); // Max 6 actions per situation
}

// ── Haversine ────────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
 Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
