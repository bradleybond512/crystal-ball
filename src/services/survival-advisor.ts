/**
 * AI Survival Advisor Service
 *
 * Collects survival context from across the app — user location, resource
 * inventory, family member statuses, evacuation routes, active alerts,
 * storm preparedness, compound threats, and current app mode — then sends
 * it to the Claude Agent (or Ollama fallback) for personalised survival guidance.
 *
 * Advice is organised into five categories:
 * 1. Immediate Actions
 * 2. Resource Management (real inventory + burn rates)
 * 3. Evacuation Assessment (active routes + threat proximity)
 * 4. Family Safety (member statuses)
 * 5. 72-Hour Outlook
 *
 * Results are cached in localStorage with a 15-minute TTL and auto-refresh
 * when the app mode changes.
 */

import { loadProximityConfig, type ProximityConfig } from './proximity-filter';
import { getMembers, type FamilyMember } from './family-tracker';
import { getSavedRoutes, type EvacRoute } from './evacuation-router';
import {
  getStormPreparednessContext,
  getStormPreparednessSummary,
  type StormPreparednessSummary,
} from './storm-preparedness';
import { detectCompoundThreats, type CompoundThreat, type HazardSignal } from './compound-threat';
import { getMode, type AppMode } from './mode-manager';
import { runClaudeAgent } from './claude-agent';
import { coarseCoordPair } from './geo-privacy';

// ── Types ────────────────────────────────────────────────────────────────────

export type AdvicePriority = 'critical' | 'high' | 'medium' | 'low';

export type AdviceCategory =
  | 'immediate-actions'
  | 'resource-management'
  | 'evacuation-assessment'
  | 'family-safety'
  | '72-hour-outlook';

export interface AdviceItem {
  priority: AdvicePriority;
  action: string;
  rationale: string;
  category: AdviceCategory;
}

export type OverallStatus = 'SAFE' | 'AT RISK' | 'IN DANGER';

export interface ResourceSummaryItem {
  name: string;
  daysLeft: number;
  unit: string;
}

export interface FamilySummary {
  total: number;
  safe: number;
  needsAttention: FamilyMember[];
}

export interface SurvivalAdvice {
  status: OverallStatus;
  items: AdviceItem[];
  resourceSummary: ResourceSummaryItem[];
  familySummary: FamilySummary;
  generatedAt: number;
  source: 'ai' | 'static';
}

// ── Resource inventory IndexedDB access ──────────────────────────────────────

interface ResourceItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  dailyRate: number;
  category: string;
  lastUpdated: number;
  consumptionLog?: { timestamp: number; amount: number }[];
}

const DB_NAME = 'crystalball-resources';
const STORE_NAME = 'items';
const DB_VERSION = 1;
const MAX_ITEMS = 5000;

async function openResourceDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
 const req = indexedDB.open(DB_NAME, DB_VERSION);
 req.onupgradeneeded = () => {
 if (!req.result.objectStoreNames.contains(STORE_NAME)) {
 req.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
 }
 };
 req.onsuccess = () => resolve(req.result);
 req.onerror = () => reject(req.error);
  });
}

async function loadResourceItems(): Promise<ResourceItem[]> {
  try {
 const db = await openResourceDB();
 return new Promise((resolve, reject) => {
 const tx = db.transaction(STORE_NAME, 'readonly');
 const req = tx.objectStore(STORE_NAME).getAll(undefined, MAX_ITEMS);
 req.onsuccess = () => resolve(req.result as ResourceItem[]);
 req.onerror = () => reject(req.error);
 });
  } catch {
 return [];
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

function effectiveBurnRate(item: ResourceItem): number {
  const log = item.consumptionLog;
  if (log && log.length > 0) {
 const consumptions = log.filter(e => e.amount > 0);
 if (consumptions.length > 0) {
 const earliest = Math.min(...consumptions.map(e => e.timestamp));
 const spanDays = (Date.now() - earliest) / DAY_MS;
 if (spanDays >= 0.5) {
 const totalConsumed = consumptions.reduce((s, e) => s + e.amount, 0);
 const rate = totalConsumed / spanDays;
 if (rate > 0) return rate;
 }
 }
  }
  return item.dailyRate;
}

function daysRemaining(item: ResourceItem): number {
  const rate = effectiveBurnRate(item);
  if (rate <= 0) return Infinity;
  return item.quantity / rate;
}

// ── Context collection ───────────────────────────────────────────────────────

interface SurvivalContext {
  location: ProximityConfig;
  resources: ResourceItem[];
  family: FamilyMember[];
  evacRoutes: EvacRoute[];
  stormSummary: StormPreparednessSummary;
  compoundThreats: CompoundThreat[];
  appMode: AppMode | null;
}

function collectContext(): SurvivalContext {
  const stormCtx = getStormPreparednessContext();
  const stormSummary = getStormPreparednessSummary(stormCtx);

  // Compound threats need signals — derive from storm context alerts
  const hazardSignals: HazardSignal[] = [];
  for (const alert of stormCtx.weatherAlerts) {
 if (alert.centroid) {
 hazardSignals.push({
 id: `weather-${alert.event}`,
 category: 'weather',
 severity: alert.severity === 'Extreme' ? 'critical' : (alert.severity === 'Severe' ? 'high' : 'medium'),
 lat: alert.centroid[1],
 lon: alert.centroid[0],
 label: alert.event,
 sourceService: 'weather',
 });
 }
  }
  const compoundThreats = detectCompoundThreats(hazardSignals);

  return {
 location: loadProximityConfig(),
 resources: [], // filled async
 family: getMembers(),
 evacRoutes: getSavedRoutes(),
 stormSummary,
 compoundThreats,
 appMode: getMode(),
  };
}

// ── Determine overall status ─────────────────────────────────────────────────

function determineStatus(ctx: SurvivalContext): OverallStatus {
  // IN DANGER: compound threats, shelter-now posture, or disaster/war mode
  if (ctx.compoundThreats.length > 0) return 'IN DANGER';
  if (ctx.stormSummary.posture === 'shelter-now') return 'IN DANGER';
  // Former war/disaster mode auto-escalation removed: IN DANGER now driven
  // entirely by compound threats + storm posture (more precise signals).

  // AT RISK: act-now posture, critical storm counts, low resources, missing family
  if (ctx.stormSummary.posture === 'act-now') return 'AT RISK';
  if (ctx.stormSummary.criticalCount > 0) return 'AT RISK';
  if (ctx.stormSummary.posture === 'prepare-today') return 'AT RISK';

  const criticalResources = ctx.resources.filter(r => {
 const d = daysRemaining(r);
 return d !== Infinity && d < 3;
  });
  if (criticalResources.length > 0) return 'AT RISK';

  const familyIssues = ctx.family.filter(m =>
 m.status === 'stuck' || m.status === 'need_pickup' || m.status === 'need_meds',
  );
  if (familyIssues.length > 0) return 'AT RISK';

  return 'SAFE';
}

// ── Resource summary ─────────────────────────────────────────────────────────

function buildResourceSummary(resources: ResourceItem[]): ResourceSummaryItem[] {
  const sorted = [...resources]
 .map(r => ({ name: r.name, daysLeft: daysRemaining(r), unit: r.unit }))
 .filter(r => r.daysLeft !== Infinity)
 .sort((a, b) => a.daysLeft - b.daysLeft);
  return sorted.slice(0, 6);
}

// ── Family summary ───────────────────────────────────────────────────────────

function buildFamilySummary(members: FamilyMember[]): FamilySummary {
  const safe = members.filter(m => m.status === 'safe' || m.status === 'moving');
  const needsAttention = members.filter(m =>
 m.status === 'stuck' || m.status === 'need_pickup' || m.status === 'need_meds' || m.status === 'unknown',
  );
  return { total: members.length, safe: safe.length, needsAttention };
}

// ── AI prompt construction ───────────────────────────────────────────────────

function buildPrompt(ctx: SurvivalContext): string {
  const parts: string[] = [ 'You are a survival advisor for a situational awareness app. Generate personal survival advice based on the following real-time context. Be specific and actionable.\n'];


  // Location
  if (ctx.location.location) {
 parts.push(`USER LOCATION: ${ctx.location.location.label} (${coarseCoordPair(ctx.location.location.lat, ctx.location.location.lon)})`);
  } else {
 parts.push('USER LOCATION: Not set');
  }

  // App mode
  parts.push(`APP MODE: ${(ctx.appMode ?? 'default').toUpperCase()}`, `STORM POSTURE: ${ctx.stormSummary.posture} (${ctx.stormSummary.criticalCount} critical, ${ctx.stormSummary.highCount} high alerts)`);
  if (ctx.stormSummary.stormFamilies.length > 0) {
 parts.push(`ACTIVE STORM TYPES: ${ctx.stormSummary.stormFamilies.join(', ')}`);
  }

  // Compound threats
  if (ctx.compoundThreats.length > 0) {
 parts.push(`COMPOUND THREATS (${ctx.compoundThreats.length}):`);
 for (const ct of ctx.compoundThreats.slice(0, 3)) {
 parts.push(`  - ${ct.description} (severity: ${ct.overallSeverity}, ${ct.hazardCount} converging hazards)`);
 }
  }

  // Resources
  if (ctx.resources.length > 0) {
 parts.push(`\nRESOURCE INVENTORY (${ctx.resources.length} items):`);
 for (const r of ctx.resources) {
 const days = daysRemaining(r);
 const rate = effectiveBurnRate(r);
 parts.push(`  - ${r.name}: ${r.quantity.toFixed(1)} ${r.unit} (${days === Infinity ? 'no consumption' : days.toFixed(1) + ' days remaining'}, burn rate: ${rate.toFixed(1)} ${r.unit}/day)`);
 }
  } else {
 parts.push('\nRESOURCE INVENTORY: No items tracked');
  }

  // Family
  if (ctx.family.length > 0) {
 parts.push(`\nFAMILY MEMBERS (${ctx.family.length}):`);
 for (const m of ctx.family) {
 const loc = m.lastLocation ? `near ${coarseCoordPair(m.lastLocation.lat, m.lastLocation.lon)}` : 'location unknown';
 const age = m.lastUpdate ? `${Math.round((Date.now() - m.lastUpdate) / 60_000)} min ago` : 'never updated';
 parts.push(`  - ${m.icon} ${m.name}: ${m.status ?? 'unknown'} (${loc}, ${age})`);
 }
  }

  // Evacuation routes
  if (ctx.evacRoutes.length > 0) {
 parts.push(`\nEVACUATION ROUTES (${ctx.evacRoutes.length}):`);
 for (const r of ctx.evacRoutes.slice(0, 3)) {
 parts.push(`  - ${r.from.label} -> ${r.to.label}: ${r.distanceKm.toFixed(1)} km, ${r.durationMinutes.toFixed(0)} min`);
 }
  }

  parts.push(`\nRespond with a JSON object (no markdown fences) with this exact structure:
{
  "items": [
 {
 "priority": "critical|high|medium|low",
 "action": "specific actionable advice",
 "rationale": "why this matters now",
 "category": "immediate-actions|resource-management|evacuation-assessment|family-safety|72-hour-outlook"
 }
  ]
}

Generate 5-10 advice items covering all five categories. Prioritise based on the actual threat level and resource status.`);

  return parts.join('\n');
}

// ── AI response parsing ──────────────────────────────────────────────────────

function parseAIResponse(response: string): AdviceItem[] {
  try {
 // Try to extract JSON from the response
 let jsonStr = response;
 const jsonMatch = /\{[\s\S]*\}/.exec(response);
 if (jsonMatch) {
 jsonStr = jsonMatch[0];
 }
 const parsed = JSON.parse(jsonStr) as { items?: AdviceItem[] };
 if (Array.isArray(parsed.items)) {
 return parsed.items.filter(item =>
 item.priority && item.action && item.rationale && item.category,
 );
 }
  } catch {
 // Failed to parse AI response
  }
  return [];
}

// ── Static fallback advice ───────────────────────────────────────────────────

function generateStaticAdvice(ctx: SurvivalContext): AdviceItem[] {
  const items: AdviceItem[] = [];
  const status = determineStatus(ctx);

  // Immediate actions based on status
  if (status === 'IN DANGER') {
 items.push({
 priority: 'critical',
 action: 'Review all active alerts and prepare to act on the most severe.',
 rationale: 'Multiple converging threats detected. Situational awareness is your first defence.',
 category: 'immediate-actions',
 });
  }

  if (ctx.stormSummary.posture === 'shelter-now') {
 items.push({
 priority: 'critical',
 action: 'Shelter in place immediately. Move to your designated safe room.',
 rationale: `Storm posture is SHELTER NOW with ${ctx.stormSummary.criticalCount} critical alerts active.`,
 category: 'immediate-actions',
 });
  } else if (ctx.stormSummary.posture === 'act-now') {
 items.push({
 priority: 'high',
 action: 'Execute your preparedness plan now. Top off fuel, water, and medications.',
 rationale: `Storm posture is ACT NOW. ${ctx.stormSummary.stormFamilies.join(', ')} threats are active.`,
 category: 'immediate-actions',
 });
  } else if (ctx.stormSummary.posture === 'prepare-today') {
 items.push({
 priority: 'medium',
 action: 'Review your emergency supplies and charge all devices today.',
 rationale: 'Storm posture is PREPARE TODAY. Conditions may deteriorate.',
 category: 'immediate-actions',
 });
  } else {
 items.push({
 priority: 'low',
 action: 'No immediate action needed. Maintain readiness by checking supplies weekly.',
 rationale: 'Current conditions are stable. Routine preparedness is always recommended.',
 category: 'immediate-actions',
 });
  }

  // Resource management
  const critResources = ctx.resources.filter(r => {
 const d = daysRemaining(r);
 return d !== Infinity && d < 3;
  });
  const warnResources = ctx.resources.filter(r => {
 const d = daysRemaining(r);
 return d !== Infinity && d >= 3 && d <= 7;
  });

  if (critResources.length > 0) {
 const names = critResources.slice(0, 3).map(r => r.name).join(', ');
 items.push({
 priority: 'critical',
 action: `Resupply urgently: ${names} (<3 days remaining).`,
 rationale: `${critResources.length} item(s) are critically low and will be depleted soon.`,
 category: 'resource-management',
 });
  } else if (warnResources.length > 0) {
 const names = warnResources.slice(0, 3).map(r => r.name).join(', ');
 items.push({
 priority: 'medium',
 action: `Plan resupply for: ${names} (3-7 days remaining).`,
 rationale: `${warnResources.length} item(s) have limited remaining stock.`,
 category: 'resource-management',
 });
  } else if (ctx.resources.length === 0) {
 items.push({
 priority: 'medium',
 action: 'Start tracking your water, food, and medication supplies in Resource Inventory.',
 rationale: 'No resources are being tracked. Inventory awareness is critical for survival planning.',
 category: 'resource-management',
 });
  } else {
 items.push({
 priority: 'low',
 action: 'All tracked resources have adequate supply levels.',
 rationale: 'Continue monitoring consumption rates for early depletion warnings.',
 category: 'resource-management',
 });
  }

  // Evacuation assessment
  if (ctx.evacRoutes.length > 0) {
 const route = ctx.evacRoutes[0];
 if (route) {
 items.push({
 priority: status === 'IN DANGER' ? 'high' : 'low',
 action: `Primary route: ${route.from.label} to ${route.to.label} (${route.distanceKm.toFixed(0)} km, ~${route.durationMinutes.toFixed(0)} min).`,
 rationale: `${ctx.evacRoutes.length} evacuation route(s) cached. Review routes regularly as conditions change.`,
 category: 'evacuation-assessment',
 });
 }
  } else {
 items.push({
 priority: status === 'IN DANGER' ? 'high' : 'medium',
 action: 'Plan at least one evacuation route using the Evacuation Router.',
 rationale: 'No routes are cached. Having pre-planned routes saves critical time during emergencies.',
 category: 'evacuation-assessment',
 });
  }

  // Family safety
  if (ctx.family.length > 0) {
 const summary = buildFamilySummary(ctx.family);
 if (summary.needsAttention.length > 0) {
 const names = summary.needsAttention.slice(0, 3).map(m => `${m.icon} ${m.name}`).join(', ');
 items.push({
 priority: 'high',
 action: `Check on family members needing attention: ${names}.`,
 rationale: `${summary.needsAttention.length} of ${summary.total} family members are not confirmed safe.`,
 category: 'family-safety',
 });
 } else {
 items.push({
 priority: 'low',
 action: `All ${summary.total} family members are accounted for and safe.`,
 rationale: 'Continue checking in periodically, especially if conditions change.',
 category: 'family-safety',
 });
 }
  } else {
 items.push({
 priority: 'medium',
 action: 'Add family members to the Family Tracker for mutual safety awareness.',
 rationale: 'No family members are being tracked. Mutual accountability saves lives.',
 category: 'family-safety',
 });
  }

  // 72-hour outlook
  if (ctx.stormSummary.majorSystemCount > 0) {
 items.push({
 priority: 'high',
 action: `${ctx.stormSummary.majorSystemCount} major weather system(s) active. Expect conditions to evolve over the next 72 hours.`,
 rationale: 'Major storm systems can rapidly intensify. Stay updated and be prepared to escalate your posture.',
 category: '72-hour-outlook',
 });
  } else if (ctx.compoundThreats.length > 0) {
 items.push({
 priority: 'high',
 action: 'Compound threats are present. Monitor for cascading effects over the next 72 hours.',
 rationale: 'When multiple hazards converge, secondary effects can be more dangerous than primary ones.',
 category: '72-hour-outlook',
 });
  } else {
 items.push({
 priority: 'low',
 action: 'No major developments expected. Maintain routine monitoring.',
 rationale: 'Conditions are stable. Continue daily check-ins with the dashboard.',
 category: '72-hour-outlook',
 });
  }

  return items;
}

// ── Cache management ─────────────────────────────────────────────────────────

const CACHE_KEY = 'wm-survival-advice-v1';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

function loadCache(): SurvivalAdvice | null {
  try {
 const raw = localStorage.getItem(CACHE_KEY);
 if (!raw) return null;
 const cached = JSON.parse(raw) as SurvivalAdvice;
 if (Date.now() - cached.generatedAt > CACHE_TTL_MS) return null;
 return cached;
  } catch {
 return null;
  }
}

function saveCache(advice: SurvivalAdvice): void {
  try {
 localStorage.setItem(CACHE_KEY, JSON.stringify(advice));
  } catch { /* storage full — non-critical */ }
}

function clearCache(): void {
  try {
 localStorage.removeItem(CACHE_KEY);
  } catch { /* noop */ }
}

// ── Subscriber pattern ───────────────────────────────────────────────────────

type Listener = (advice: SurvivalAdvice) => void;
const listeners = new Set<Listener>();

function notifySubscribers(advice: SurvivalAdvice): void {
  for (const fn of listeners) {
 try { fn(advice); } catch { /* subscriber errors must not propagate */ }
  }
}

export function subscribeSurvivalAdvice(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

// ── Mode change auto-refresh ─────────────────────────────────────────────────

let modeListenerAttached = false;

function attachModeListener(): void {
  if (modeListenerAttached) return;
  modeListenerAttached = true;
  document.addEventListener('wm:mode-changed', () => {
 clearCache();
 void generateSurvivalAdvice().catch(() => {});
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getCachedAdvice(): SurvivalAdvice | null {
  return loadCache();
}

export async function generateSurvivalAdvice(): Promise<SurvivalAdvice> {
  attachModeListener();

  // Check cache first
  const cached = loadCache();
  if (cached) {
 notifySubscribers(cached);
 return cached;
  }

  // Collect context
  const ctx = collectContext();

  // Load resources asynchronously
  ctx.resources = await loadResourceItems();

  const status = determineStatus(ctx);
  const resourceSummary = buildResourceSummary(ctx.resources);
  const familySummary = buildFamilySummary(ctx.family);

  // Try AI first, fall back to static
  let items: AdviceItem[];
  let source: 'ai' | 'static';

  try {
 const prompt = buildPrompt(ctx);
 const response = await runClaudeAgent(prompt);
 const aiItems = parseAIResponse(response.response);
 if (aiItems.length > 0) {
 items = aiItems;
 source = 'ai';
 } else {
 items = generateStaticAdvice(ctx);
 source = 'static';
 }
  } catch {
 // AI unavailable — use static advice
 items = generateStaticAdvice(ctx);
 source = 'static';
  }

  const advice: SurvivalAdvice = {
 status,
 items,
 resourceSummary,
 familySummary,
 generatedAt: Date.now(),
 source,
  };

  saveCache(advice);
  notifySubscribers(advice);
  return advice;
}
