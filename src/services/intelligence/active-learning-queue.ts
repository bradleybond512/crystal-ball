/**
 * Active Learning Queue — surfaces the observations Crystal Ball is
 * most uncertain about and asks the operator to review them. Reviewed
 * items feed back into the outcome ledger so the calibration loop
 * gets explicit ground-truth from the highest-leverage cases.
 *
 * Pure store: injectable Storage + injectable outcome-recorder so
 * unit tests can run without a DOM or the real OutcomeLedger. Auto-
 * expires unreviewed items after 24h to keep the queue actionable.
 */

import type { AnalystSnapshot, Hypothesis } from '@/services/analyst-loop';
import { isGhostMode } from '@/services/mode-manager';

// ── Public types ─────────────────────────────────────────────────────────

export type UncertaintySource =
  | 'low-meta-confidence'
  | 'competing-hypotheses'
  | 'fragile-conclusion'
  | 'high-assumption-risk'
  | 'novel-pattern'
  | 'contradicting-evidence';

export type LearningStatus = 'pending' | 'reviewed' | 'skipped';
export type ReviewerOutcome = 'confirmed' | 'corrected' | 'insufficient-data';
export type LearningSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface LearningItem {
  id: string;
  observationId: string;
  situationId?: string;
  domain: string;
  uncertaintySources: UncertaintySource[];
  uncertaintyScore: number;
  currentSeverity: LearningSeverity;
  question: string;
  context: string;
  status: LearningStatus;
  reviewedAt?: Date;
  reviewerOutcome?: ReviewerOutcome;
  reviewerNote?: string;
  queuedAt: Date;
  expiresAt: Date;
}

export interface LearningStats {
  total: number;
  pending: number;
  reviewed: number;
  skipped: number;
  avgUncertaintyScore: number;
  bySource: Record<string, number>;
}

export interface ObservationContext {
  observationId: string;
  domain: string;
  severity: LearningSeverity;
  title: string;
  /** Optional structured metadata used by domain templates
   *  (e.g. earthquake.magnitude, weather.eventType). */
  metadata?: Record<string, unknown>;
}

export interface OutcomeFeedback {
  observationId?: string;
  alertId?: string;
  situationId?: string;
  domain: string;
  predictedSeverity: LearningSeverity;
  actualOutcome: 'confirmed-real' | 'marked-false-positive' | 'acted-on' | 'dismissed';
  notes?: string;
  recordedAt?: Date;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ActiveLearningQueueOptions {
  storage?: StorageLike | null;
  now?: () => number;
  /** Called from review() to push confirmed/corrected outcomes back
   *  into the outcome ledger. 'insufficient-data' reviews skip this. */
  recordOutcome?: (feedback: OutcomeFeedback) => void;
}

export interface ActiveLearningQueue {
  enqueue(input: Omit<LearningItem, 'id' | 'status' | 'queuedAt' | 'expiresAt'>): LearningItem;
  enqueueFromObservation(
    obs: ObservationContext,
    uncertaintySources: UncertaintySource[],
    situationId?: string,
  ): LearningItem;
  getPending(): LearningItem[];
  getAll(): LearningItem[];
  review(id: string, outcome: ReviewerOutcome, note?: string): void;
  skip(id: string): void;
  purgeExpired(): void;
  stats(): LearningStats;
  subscribe(cb: (items: LearningItem[]) => void): () => void;
}

// ── Constants ────────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-active-learning';
export const MAX_ITEMS = 500;
export const EXPIRY_MS = 24 * 60 * 60_000;

const COMPETING_HYPOTHESES_BONUS = 0.15;
const FRAGILE_CONCLUSION_BONUS = 0.15;
const SOURCE_COUNT_DIVISOR = 6;

// ── Helpers ──────────────────────────────────────────────────────────────

let _idCounter = 0;
function nextId(nowMs: number): string {
  _idCounter += 1;
  return `al-${nowMs.toString(36)}-${_idCounter.toString(36)}`;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function computeUncertaintyScore(sources: readonly UncertaintySource[]): number {
  let score = sources.length / SOURCE_COUNT_DIVISOR;
  if (sources.includes('competing-hypotheses')) score += COMPETING_HYPOTHESES_BONUS;
  if (sources.includes('fragile-conclusion')) score += FRAGILE_CONCLUSION_BONUS;
  return clamp01(score);
}

function reasonsLabel(sources: readonly UncertaintySource[]): string {
  if (sources.length === 0) return 'multiple uncertainty signals';
  return sources.map((s) => s.replace(/-/g, ' ')).join(' + ');
}

type QuestionTemplate = (obs: ObservationContext, reasons: string) => string;

const TEMPLATES: Record<string, QuestionTemplate> = {
  earthquake: (obs, reasons) => {
    const mag = typeof obs.metadata?.magnitude === 'number'
      ? `M${(obs.metadata.magnitude as number).toFixed(1)}`
      : 'this';
    return `Is the ${mag} earthquake severity correct given ${reasons}?`;
  },
  weather: (obs, reasons) => {
    const eventType = typeof obs.metadata?.eventType === 'string'
      ? obs.metadata.eventType as string
      : 'weather';
    return `Does this ${eventType} warning warrant ${obs.severity} given ${reasons}?`;
  },
  maritime: (obs) =>
    `Is this vessel situation actually ${obs.severity}, or is AIS data unreliable here?`,
  biosurveillance: () =>
    'Is this wastewater signal a real outbreak indicator or a lab artifact?',
  biosurv: () =>
    'Is this wastewater signal a real outbreak indicator or a lab artifact?',
  cyber: (obs) =>
    `Is this ${obs.severity} CVE actually exploited in the wild or just theoretical?`,
};

function questionFor(obs: ObservationContext, sources: readonly UncertaintySource[]): string {
  const reasons = reasonsLabel(sources);
  const tpl = TEMPLATES[obs.domain];
  if (tpl) return tpl(obs, reasons);
  return `Is this ${obs.domain} event correctly classified as ${obs.severity} given ${reasons}?`;
}

function contextFor(obs: ObservationContext, sources: readonly UncertaintySource[]): string {
  const lead = obs.title ? `${obs.title}.` : `${obs.domain} event observed.`;
  const detail = `Flagged because: ${reasonsLabel(sources)}.`;
  return `${lead} ${detail}`;
}

function resolveLocalStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof globalThis !== 'undefined') {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (ls && typeof ls.getItem === 'function') return ls;
  }
  return null;
}

function cloneItem(item: LearningItem): LearningItem {
  return {
    ...item,
    uncertaintySources: [...item.uncertaintySources],
    queuedAt: new Date(item.queuedAt),
    expiresAt: new Date(item.expiresAt),
    reviewedAt: item.reviewedAt ? new Date(item.reviewedAt) : undefined,
  };
}

interface PersistedItem extends Omit<LearningItem, 'queuedAt' | 'expiresAt' | 'reviewedAt'> {
  queuedAt: string;
  expiresAt: string;
  reviewedAt?: string;
}

function serialize(item: LearningItem): PersistedItem {
  return {
    ...item,
    queuedAt: item.queuedAt.toISOString(),
    expiresAt: item.expiresAt.toISOString(),
    reviewedAt: item.reviewedAt ? item.reviewedAt.toISOString() : undefined,
  };
}

function deserialize(raw: unknown): LearningItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string') return null;
  const queuedAt = parseDate(r.queuedAt);
  const expiresAt = parseDate(r.expiresAt);
  if (!queuedAt || !expiresAt) return null;
  const reviewedAt = parseDate(r.reviewedAt);
  const sources = Array.isArray(r.uncertaintySources)
    ? r.uncertaintySources.filter((s): s is UncertaintySource => typeof s === 'string')
    : [];
  return {
    id: r.id,
    observationId: typeof r.observationId === 'string' ? r.observationId : '',
    situationId: typeof r.situationId === 'string' ? r.situationId : undefined,
    domain: typeof r.domain === 'string' ? r.domain : 'unknown',
    uncertaintySources: sources,
    uncertaintyScore: typeof r.uncertaintyScore === 'number' ? r.uncertaintyScore : 0,
    currentSeverity: isSeverity(r.currentSeverity) ? r.currentSeverity : 'medium',
    question: typeof r.question === 'string' ? r.question : '',
    context: typeof r.context === 'string' ? r.context : '',
    status: isStatus(r.status) ? r.status : 'pending',
    reviewedAt: reviewedAt ?? undefined,
    reviewerOutcome: isOutcome(r.reviewerOutcome) ? r.reviewerOutcome : undefined,
    reviewerNote: typeof r.reviewerNote === 'string' ? r.reviewerNote : undefined,
    queuedAt,
    expiresAt,
  };
}

function parseDate(raw: unknown): Date | null {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === 'string') {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function isSeverity(s: unknown): s is LearningSeverity {
  return s === 'low' || s === 'medium' || s === 'high' || s === 'critical';
}

function isStatus(s: unknown): s is LearningStatus {
  return s === 'pending' || s === 'reviewed' || s === 'skipped';
}

function isOutcome(o: unknown): o is ReviewerOutcome {
  return o === 'confirmed' || o === 'corrected' || o === 'insufficient-data';
}

function rehydrate(storage: StorageLike | null): LearningItem[] {
  if (!storage) return [];
  let raw: string | null;
  try { raw = storage.getItem(STORAGE_KEY); }
  catch { return []; }
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: LearningItem[] = [];
  for (const p of parsed) {
    const d = deserialize(p);
    if (d) out.push(d);
  }
  return out;
}

// ── Factory ──────────────────────────────────────────────────────────────

export function createActiveLearningQueue(
  options: ActiveLearningQueueOptions = {},
): ActiveLearningQueue {
  const storage = resolveLocalStorage(options.storage);
  const clock = options.now ?? (() => Date.now());
  const recordOutcome = options.recordOutcome ?? null;
  let items: LearningItem[] = rehydrate(storage);
  const listeners = new Set<(items: LearningItem[]) => void>();

  function persist(): void {
    if (!storage) return;
    try {
      const payload = items.map((i) => serialize(i));
      storage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch { /* quota / private-mode — non-critical */ }
  }

  function notify(): void {
    const snapshot = items.map((i) => cloneItem(i));
    for (const cb of listeners) {
      try { cb(snapshot); } catch { /* listener crash isolation */ }
    }
  }

  function pushAndCap(item: LearningItem): LearningItem {
    items.push(item);
    if (items.length > MAX_ITEMS) {
      items.splice(0, items.length - MAX_ITEMS);
    }
    return item;
  }

  function findById(id: string): LearningItem | undefined {
    return items.find((i) => i.id === id);
  }

  return {
    enqueue(input): LearningItem {
      const nowMs = clock();
      const item: LearningItem = {
        ...input,
        id: nextId(nowMs),
        status: 'pending',
        queuedAt: new Date(nowMs),
        expiresAt: new Date(nowMs + EXPIRY_MS),
        uncertaintySources: [...input.uncertaintySources],
      };
      pushAndCap(item);
      persist();
      notify();
      return cloneItem(item);
    },

    enqueueFromObservation(obs, uncertaintySources, situationId): LearningItem {
      const score = computeUncertaintyScore(uncertaintySources);
      const question = questionFor(obs, uncertaintySources);
      const context = contextFor(obs, uncertaintySources);
      return this.enqueue({
        observationId: obs.observationId,
        situationId,
        domain: obs.domain,
        uncertaintySources: [...uncertaintySources],
        uncertaintyScore: score,
        currentSeverity: obs.severity,
        question,
        context,
      });
    },

    getPending(): LearningItem[] {
      const nowMs = clock();
      return items
        .filter((i) => i.status === 'pending' && i.expiresAt.getTime() > nowMs)
        .sort((a, b) => b.uncertaintyScore - a.uncertaintyScore)
        .map((i) => cloneItem(i));
    },

    getAll(): LearningItem[] {
      return items.map((i) => cloneItem(i));
    },

    review(id, outcome, note): void {
      const item = findById(id);
      if (item?.status !== 'pending') return;
      item.status = 'reviewed';
      item.reviewedAt = new Date(clock());
      item.reviewerOutcome = outcome;
      if (note !== undefined) item.reviewerNote = note;
      if (recordOutcome && outcome !== 'insufficient-data') {
        const ledgerOutcome: OutcomeFeedback['actualOutcome'] = outcome === 'confirmed'
          ? 'confirmed-real' : 'marked-false-positive';
        recordOutcome({
          observationId: item.observationId,
          situationId: item.situationId,
          domain: item.domain,
          predictedSeverity: item.currentSeverity,
          actualOutcome: ledgerOutcome,
          notes: note,
          recordedAt: new Date(clock()),
        });
      }
      persist();
      notify();
    },

    skip(id): void {
      const item = findById(id);
      if (item?.status !== 'pending') return;
      item.status = 'skipped';
      persist();
      notify();
    },

    purgeExpired(): void {
      const nowMs = clock();
      const before = items.length;
      items = items.filter((i) =>
        i.status !== 'pending' || i.expiresAt.getTime() > nowMs,
      );
      if (items.length === before) return;
      persist();
      notify();
    },

    stats(): LearningStats {
      let pending = 0, reviewed = 0, skipped = 0, scoreSum = 0;
      const bySource: Record<string, number> = {};
      for (const i of items) {
        if (i.status === 'pending') pending += 1;
        else if (i.status === 'reviewed') reviewed += 1;
        else if (i.status === 'skipped') skipped += 1;
        scoreSum += i.uncertaintyScore;
        for (const s of i.uncertaintySources) bySource[s] = (bySource[s] ?? 0) + 1;
      }
      return {
        total: items.length,
        pending, reviewed, skipped,
        avgUncertaintyScore: items.length === 0 ? 0 : scoreSum / items.length,
        bySource,
      };
    },

    subscribe(cb): () => void {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
  };
}

// ── Lazy singleton ───────────────────────────────────────────────────────

let _singleton: ActiveLearningQueue | null = null;

export function getActiveLearningQueue(): ActiveLearningQueue {
  _singleton ??= createActiveLearningQueue();
  return _singleton;
}

export function _resetActiveLearningQueueSingletonForTests(): void {
  _singleton = null;
}

// ════════════════════════════════════════════════════════════════════════
// ActiveLearningQueueService — class-based 5-state priority queue.
// Separate API from createActiveLearningQueue() above. The legacy queue
// models human-in-the-loop review with 3 statuses; this service models a
// claim-able priority queue with explicit claim/resolve/skip/expire
// transitions and feeds resolved items back to the AlgoEvalLedger.
// ════════════════════════════════════════════════════════════════════════

export type LearningItemPriority = 'critical' | 'high' | 'medium' | 'low';
export type LearningItemStatus = 'pending' | 'claimed' | 'resolved' | 'skipped' | 'expired';
export type LearningItemReason =
  | 'low-confidence'
  | 'prediction-miss'
  | 'model-disagreement'
  | 'anomaly'
  | 'operator-flagged';

export interface ActiveLearningItem {
  id: string;
  observationId: string;
  domain: string;
  reason: LearningItemReason;
  priority: LearningItemPriority;
  status: LearningItemStatus;
  queuedAt: number;
  claimedAt?: number;
  resolvedAt?: number;
  expiresAt: number;
  operatorLabel?: string;
  notes?: string;
  modelOutput?: unknown;
}

export interface ActiveLearningQueueFilter {
  status?: LearningItemStatus;
  domain?: string;
  priority?: LearningItemPriority;
}

export interface ActiveLearningQueueStats {
  total: number;
  pending: number;
  claimed: number;
  resolved: number;
  skipped: number;
  expired: number;
  avgResolutionMinutes: number;
}

export type ActiveLearningItemInput = Omit<ActiveLearningItem, 'id' | 'status' | 'queuedAt'>;

export interface ActiveLearningQueueServiceOptions {
  capacity?: number;
  storage?: StorageLike | null;
  now?: () => number;
  /** Optional sink for resolved items. Production wires the live
   *  AlgoEvalLedger via `wireDefaultAlgoEvalLedger()` below; tests
   *  pass a stub or leave undefined. */
  recordToAlgoEvalLedger?: (item: ActiveLearningItem) => void;
}

const SERVICE_STORAGE_KEY = 'wm-active-learning-queue';
const SERVICE_MAX_ITEMS = 1000;

const PRIORITY_RANK: Record<LearningItemPriority, number> = {
  critical: 4, high: 3, medium: 2, low: 1,
};

interface PersistedServiceState {
  items: ActiveLearningItem[];
}

export class ActiveLearningQueueService {
  private readonly capacity: number;
  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  private readonly recordToLedger?: (item: ActiveLearningItem) => void;
  private readonly byId = new Map<string, ActiveLearningItem>();
  private readonly order: string[] = [];
  private readonly subscribers = new Set<(item: ActiveLearningItem) => void>();
  private idCounter = 0;

  constructor(opts: ActiveLearningQueueServiceOptions = {}) {
    this.capacity = opts.capacity ?? SERVICE_MAX_ITEMS;
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.clock = opts.now ?? Date.now;
    this.recordToLedger = opts.recordToAlgoEvalLedger;
    this.hydrate();
  }

  enqueue(input: ActiveLearningItemInput): ActiveLearningItem {
    const existing = this.findActiveByObservation(input.observationId);
    if (existing) return existing;
    const queuedAt = this.clock();
    this.idCounter++;
    const item: ActiveLearningItem = {
      ...input,
      id: `alq-${queuedAt}-${this.idCounter}`,
      status: 'pending',
      queuedAt,
    };
    this.byId.set(item.id, item);
    this.order.push(item.id);
    while (this.order.length > this.capacity) {
      const evict = this.order.shift();
      if (evict !== undefined) this.byId.delete(evict);
    }
    this.persist();
    this.notify(item);
    return item;
  }

  claim(itemId: string): void {
    const item = this.byId.get(itemId);
    if (item?.status !== 'pending') return;
    const updated: ActiveLearningItem = { ...item, status: 'claimed', claimedAt: this.clock() };
    this.byId.set(itemId, updated);
    this.persist();
    this.notify(updated);
  }

  resolve(itemId: string, label: string, notes?: string): void {
    const item = this.byId.get(itemId);
    if (!item || (item.status !== 'pending' && item.status !== 'claimed')) return;
    const updated: ActiveLearningItem = {
      ...item,
      status: 'resolved',
      resolvedAt: this.clock(),
      operatorLabel: label,
      notes: notes ?? item.notes,
    };
    this.byId.set(itemId, updated);
    this.persist();
    this.notify(updated);
    this.recordToLedger?.(updated);
  }

  skip(itemId: string): void {
    const item = this.byId.get(itemId);
    if (!item || (item.status !== 'pending' && item.status !== 'claimed')) return;
    const updated: ActiveLearningItem = { ...item, status: 'skipped' };
    this.byId.set(itemId, updated);
    this.persist();
    this.notify(updated);
  }

  expire(before: number): number {
    let count = 0;
    for (const item of this.byId.values()) {
      if (item.status !== 'pending') continue;
      if (item.expiresAt >= before) continue;
      const updated: ActiveLearningItem = { ...item, status: 'expired' };
      this.byId.set(item.id, updated);
      count++;
      this.notify(updated);
    }
    if (count > 0) this.persist();
    return count;
  }

  getQueue(filter: ActiveLearningQueueFilter = {}): ActiveLearningItem[] {
    const items: ActiveLearningItem[] = [];
    for (const item of this.byId.values()) {
      if (filter.status && item.status !== filter.status) continue;
      if (filter.domain && item.domain !== filter.domain) continue;
      if (filter.priority && item.priority !== filter.priority) continue;
      items.push(item);
    }
    items.sort((a, b) => {
      const priorityDelta = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
      if (priorityDelta !== 0) return priorityDelta;
      return a.queuedAt - b.queuedAt;
    });
    return items;
  }

  getItem(itemId: string): ActiveLearningItem | undefined {
    return this.byId.get(itemId);
  }

  getStats(): ActiveLearningQueueStats {
    let pending = 0, claimed = 0, resolved = 0, skipped = 0, expired = 0;
    let resolutionSumMs = 0;
    let resolutionCount = 0;
    for (const item of this.byId.values()) {
      switch (item.status) {
        case 'pending': {  pending++;  break;
        }
        case 'claimed': {  claimed++;  break;
        }
        case 'skipped': {  skipped++;  break;
        }
        case 'expired': {  expired++;  break;
        }
        case 'resolved': {
          resolved++;
          if (item.resolvedAt) {
            resolutionSumMs += Math.max(0, item.resolvedAt - item.queuedAt);
            resolutionCount++;
          }
          break;
        }
      }
    }
    const avgResolutionMinutes = resolutionCount === 0
      ? 0
      : Number(((resolutionSumMs / resolutionCount) / 60_000).toFixed(2));
    return {
      total: this.byId.size,
      pending, claimed, resolved, skipped, expired,
      avgResolutionMinutes,
    };
  }

  subscribe(cb: (item: ActiveLearningItem) => void): () => void {
    this.subscribers.add(cb);
    return () => { this.subscribers.delete(cb); };
  }

  unsubscribe(cb: (item: ActiveLearningItem) => void): void {
    this.subscribers.delete(cb);
  }

  clear(): void {
    this.byId.clear();
    this.order.length = 0;
    this.persist();
  }

  // ── Internals ─────────────────────────────────────────────────────

  private findActiveByObservation(observationId: string): ActiveLearningItem | undefined {
    for (const item of this.byId.values()) {
      if (item.observationId !== observationId) continue;
      if (item.status === 'pending' || item.status === 'claimed') return item;
    }
    return undefined;
  }

  private notify(item: ActiveLearningItem): void {
    for (const cb of this.subscribers) cb(item);
  }

  private hydrate(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(SERVICE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedServiceState;
      if (!parsed || !Array.isArray(parsed.items)) return;
      for (const item of parsed.items) {
        if (!this.byId.has(item.id)) this.order.push(item.id);
        this.byId.set(item.id, item);
      }
    } catch {
      this.byId.clear();
      this.order.length = 0;
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      const serial: PersistedServiceState = { items: [...this.byId.values()] };
      this.storage.setItem(SERVICE_STORAGE_KEY, JSON.stringify(serial));
    } catch {
      // Storage failures are non-fatal.
    }
  }
}

// ── Lazy singleton for the new service ──────────────────────────────

let _serviceSingleton: ActiveLearningQueueService | undefined;

export function getActiveLearningQueueService(): ActiveLearningQueueService {
  _serviceSingleton ??= new ActiveLearningQueueService();
  return _serviceSingleton;
}

export function resetServiceForTests(): void {
  _serviceSingleton = undefined;
}

function defaultStorage(): StorageLike | null {
  if (typeof globalThis === 'undefined') return null;
  const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
  return ls ?? null;
}

// ── Active Learning Queue boot ───────────────────────────────────────────

let _alqStarted = false;

function hypothesesToLearningItems(
  hypotheses: Hypothesis[],
): ActiveLearningItemInput[] {
  return hypotheses
    .filter((h) => h.confidence < 0.6)
    .map((h): ActiveLearningItemInput => ({
      observationId: h.id,
      domain: h.kind,
      reason: 'low-confidence',
      priority: h.confidence < 0.3 ? 'high' : 'medium',
      expiresAt: h.timestamp + EXPIRY_MS,
      modelOutput: { statement: h.statement, evidence: h.evidence },
    }));
}

export function startActiveLearningQueue(): void {
  if (_alqStarted) return;
  _alqStarted = true;
  document.addEventListener('cb:analyst-hypotheses', (e) => {
    if (isGhostMode()) return;
    const snapshot = (e as CustomEvent<AnalystSnapshot>).detail;
    if (!snapshot?.hypotheses) return;
    const items = hypothesesToLearningItems(snapshot.hypotheses);
    const svc = getActiveLearningQueueService();
    for (const item of items) {
      svc.enqueue(item);
    }
  });
}
