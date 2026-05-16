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
