/**
 * Notification Digest Service
 *
 * Batches incoming alerts and notifications, then generates AI-summarized
 * digests instead of flooding the user with individual notifications.
 *
 * Uses the summarization fallback chain (Ollama → Groq → OpenRouter → T5)
 * for headline generation. Falls back to rule-based grouping when no AI available.
 *
 * Digest frequency: configurable (5min / 15min / 30min / 1h).
 * Stores digests in localStorage with 24h retention.
 */

import { unifiedAlertStore } from './unified-alerts';
import type { UnifiedAlert } from './unified-alerts';
import { generateSummary } from './summarization';

// ── Types ─────────────────────────────────────────────────────────────────────

export type DigestFrequency = '5m' | '15m' | '30m' | '1h';

export type DigestPriority = 'critical' | 'high' | 'medium' | 'low';

export interface DigestGroup {
  category: string;
  priority: DigestPriority;
  count: number;
  summary: string;
  alerts: Pick<UnifiedAlert, 'id' | 'title' | 'severity' | 'source' | 'timestamp'>[];
}

export interface NotificationDigest {
  id: string;
  generatedAt: number;
  windowStart: number;
  windowEnd: number;
  totalAlerts: number;
  groups: DigestGroup[];
  headline: string;
  provider: 'claude' | 'ollama' | 'groq' | 'openrouter' | 't5' | 'rule-based';
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'crystalball-notification-digests';
const MAX_STORED_DIGESTS = 48;
const FREQUENCY_MS: Record<DigestFrequency, number> = {
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
};

const SEVERITY_TO_PRIORITY: Record<string, DigestPriority> = {
  critical: 'critical',
  emergency: 'critical',
  high: 'high',
  warning: 'high',
  medium: 'medium',
  watch: 'medium',
  low: 'low',
  info: 'low',
};

// ── State ─────────────────────────────────────────────────────────────────────

let currentFrequency: DigestFrequency = '30m';
let digestTimer: ReturnType<typeof setInterval> | null = null;
let pendingAlerts: UnifiedAlert[] = [];
let lastDigestTime = Date.now();
const subscribers: Array<(digest: NotificationDigest) => void> = [];
let alertStoreUnsub: (() => void) | null = null;
let initialized = false;

// ── Storage ───────────────────────────────────────────────────────────────────

function loadDigests(): NotificationDigest[] {
  try {
 const raw = localStorage.getItem(STORAGE_KEY);
 return raw ? (JSON.parse(raw) as NotificationDigest[]) : [];
  } catch {
 return [];
  }
}

function saveDigests(digests: NotificationDigest[]): void {
  try {
 const trimmed = digests.slice(-MAX_STORED_DIGESTS);
 localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch { /* quota exceeded */ }
}

// ── Grouping ──────────────────────────────────────────────────────────────────

function groupAlerts(alerts: UnifiedAlert[]): Map<string, UnifiedAlert[]> {
  const groups = new Map<string, UnifiedAlert[]>();
  for (const alert of alerts) {
 const key = alert.source || 'unknown';
 const existing = groups.get(key) ?? [];
 existing.push(alert);
 groups.set(key, existing);
  }
  return groups;
}

function highestPriority(alerts: UnifiedAlert[]): DigestPriority {
  const order: DigestPriority[] = ['critical', 'high', 'medium', 'low'];
  for (const p of order) {
 if (alerts.some(a => SEVERITY_TO_PRIORITY[a.severity] === p)) return p;
  }
  return 'low';
}

// ── Rule-based fallback ───────────────────────────────────────────────────────

function buildRuleBasedDigest(alerts: UnifiedAlert[], windowStart: number): NotificationDigest {
  const grouped = groupAlerts(alerts);
  const groups: DigestGroup[] = [];

  for (const [category, categoryAlerts] of grouped) {
 const priority = highestPriority(categoryAlerts);
 const titles = categoryAlerts.slice(0, 3).map(a => a.title).join('; ');
 const more = categoryAlerts.length > 3 ? ` (+${categoryAlerts.length - 3} more)` : '';
 groups.push({
 category,
 priority,
 count: categoryAlerts.length,
 summary: `${titles}${more}`,
 alerts: categoryAlerts.map(a => ({
 id: a.id,
 title: a.title,
 severity: a.severity,
 source: a.source,
 timestamp: a.timestamp,
 })),
 });
  }

  groups.sort((a, b) => {
 const order: DigestPriority[] = ['critical', 'high', 'medium', 'low'];
 const diff = order.indexOf(a.priority) - order.indexOf(b.priority);
 return diff !== 0 ? diff : b.count - a.count;
  });

  const critCount = groups.filter(g => g.priority === 'critical').length;
  const headline = critCount > 0
 ? `${critCount} critical alert group${critCount > 1 ? 's' : ''} — ${alerts.length} total notifications`
 : `${alerts.length} notification${alerts.length !== 1 ? 's' : ''} across ${groups.length} source${groups.length !== 1 ? 's' : ''}`;

  return {
 id: `digest-${Date.now()}`,
 generatedAt: Date.now(),
 windowStart,
 windowEnd: Date.now(),
 totalAlerts: alerts.length,
 groups,
 headline,
 provider: 'rule-based',
  };
}

// ── AI-enhanced digest ────────────────────────────────────────────────────────

async function buildAIDigest(alerts: UnifiedAlert[], windowStart: number): Promise<NotificationDigest> {
  const ruleDigest = buildRuleBasedDigest(alerts, windowStart);

  try {
 const headlines = ruleDigest.groups.map(g =>
 `[${g.priority.toUpperCase()}] ${g.category}: ${g.count} alerts — ${g.summary}`
 );

 const result = await generateSummary(headlines);
 if (result && result.summary.length > 0) {
 ruleDigest.headline = result.summary;
 ruleDigest.provider = result.provider as NotificationDigest['provider'];
 }
  } catch {
 // Keep rule-based headline
  }

  return ruleDigest;
}

// ── Core digest generation ────────────────────────────────────────────────────

export async function generateDigest(): Promise<NotificationDigest | null> {
  const alerts = [...pendingAlerts];
  const windowStart = lastDigestTime;

  pendingAlerts = [];
  lastDigestTime = Date.now();

  if (alerts.length === 0) return null;

  const digest = await buildAIDigest(alerts, windowStart);

  const existing = loadDigests();
  existing.push(digest);
  saveDigests(existing);

  for (const cb of subscribers) {
 try { cb(digest); } catch { /* subscriber error */ }
  }

  return digest;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function subscribeDigest(cb: (digest: NotificationDigest) => void): () => void {
  subscribers.push(cb);
  return () => {
 const idx = subscribers.indexOf(cb);
 if (idx !== -1) subscribers.splice(idx, 1);
  };
}

export function getRecentDigests(count = 10): NotificationDigest[] {
  return loadDigests().slice(-count);
}

export function getDigestFrequency(): DigestFrequency {
  return currentFrequency;
}

export function setDigestFrequency(freq: DigestFrequency): void {
  currentFrequency = freq;
  localStorage.setItem('crystalball-digest-frequency', freq);
  stopDigestTimer();
  startDigestTimer();
}

export function queueAlert(alert: UnifiedAlert): void {
  pendingAlerts.push(alert);
}

export function getPendingCount(): number {
  return pendingAlerts.length;
}

// ── Timer management ──────────────────────────────────────────────────────────

function startDigestTimer(): void {
  if (digestTimer) return;
  digestTimer = setInterval(() => {
 void generateDigest();
  }, FREQUENCY_MS[currentFrequency]);
}

function stopDigestTimer(): void {
  if (digestTimer) {
 clearInterval(digestTimer);
 digestTimer = null;
  }
}

export function initNotificationDigest(): void {
  if (initialized) return;
  initialized = true;

  const saved = localStorage.getItem('crystalball-digest-frequency') as DigestFrequency | null;
  if (saved && saved in FREQUENCY_MS) {
 currentFrequency = saved;
  }

  alertStoreUnsub = unifiedAlertStore.subscribe(() => {
 const alerts = unifiedAlertStore.getAll();
 const newAlerts = alerts.filter(a => a.timestamp > lastDigestTime);
 for (const alert of newAlerts) {
 if (!pendingAlerts.some(p => p.id === alert.id)) {
 pendingAlerts.push(alert);
 }
 }
  });

  startDigestTimer();
}

export function destroyNotificationDigest(): void {
  stopDigestTimer();
  if (alertStoreUnsub) { alertStoreUnsub(); alertStoreUnsub = null; }
  subscribers.length = 0;
  pendingAlerts = [];
  initialized = false;
}
