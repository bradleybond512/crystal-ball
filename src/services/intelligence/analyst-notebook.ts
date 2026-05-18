/**
 * Analyst Notebook Service — persistent note-taking tied to
 * Situations, observations, and general intelligence work. Acts as
 * a working memory for the operator: write down hypotheses, link
 * notes to Situations, tag them, search across everything later.
 *
 * Pure module — no DOM, no fetch, no globals at import time.
 * Persists up to 500 notes under `wm-analyst-notes` (ring buffer,
 * oldest evicted first, pinned notes are preferentially kept).
 * Defensive deserialise + corrupt-blob recovery + listener crash
 * isolation.
 */

// ── Public types ──────────────────────────────────────────────────────

export type NoteCategory =
  | 'observation'
  | 'hypothesis'
  | 'assessment'
  | 'action'
  | 'general';

export const NOTE_CATEGORIES: readonly NoteCategory[] = [
  'observation',
  'hypothesis',
  'assessment',
  'action',
  'general',
];

export interface Note {
  id: string;
  title: string;
  body: string;
  category: NoteCategory;
  tags: string[];
  linkedSituationIds: string[];
  linkedObservationIds: string[];
  createdAt: number;
  updatedAt: number;
  isPinned: boolean;
}

export type NoteInput = Omit<Note, 'id' | 'createdAt' | 'updatedAt'>;
export type NoteUpdate = Partial<
  Pick<Note, 'title' | 'body' | 'tags' | 'linkedSituationIds' | 'linkedObservationIds' | 'category' | 'isPinned'>
>;

export interface NotebookFilter {
  category?: NoteCategory;
  isPinned?: boolean;
}

export interface NotebookStats {
  total: number;
  pinned: number;
  byCategory: Record<NoteCategory, number>;
  /** Unique tags from the most recent 20 notes, most frequent first. */
  recentTags: string[];
}

export interface NotebookStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type NotebookListener = (notes: Note[]) => void;

// ── Constants ─────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-analyst-notes';
export const MAX_NOTES = 500;
const RECENT_TAGS_WINDOW = 20;

// ── Helpers ───────────────────────────────────────────────────────────

let counter = 0;
function makeId(now: number): string {
  counter += 1;
  return `note-${now}-${counter}`;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string');
}

function isValidNote(v: unknown): v is Note {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.title === 'string' &&
    typeof r.body === 'string' &&
    typeof r.category === 'string' &&
    NOTE_CATEGORIES.includes(r.category as NoteCategory) &&
    isStringArray(r.tags) &&
    isStringArray(r.linkedSituationIds) &&
    isStringArray(r.linkedObservationIds) &&
    typeof r.createdAt === 'number' &&
    typeof r.updatedAt === 'number' &&
    typeof r.isPinned === 'boolean'
  );
}

function emptyByCategory(): Record<NoteCategory, number> {
  return {
    observation: 0,
    hypothesis: 0,
    assessment: 0,
    action: 0,
    general: 0,
  };
}

function cloneNote(n: Note): Note {
  return {
    ...n,
    tags: [...n.tags],
    linkedSituationIds: [...n.linkedSituationIds],
    linkedObservationIds: [...n.linkedObservationIds],
  };
}

// ── Service ───────────────────────────────────────────────────────────

export class AnalystNotebookService {
  private readonly storage: NotebookStorage;
  private readonly clock: () => number;
  private readonly listeners = new Set<NotebookListener>();
  private notes: Note[] = [];

  constructor(storage: NotebookStorage, clock: () => number = () => Date.now()) {
    this.storage = storage;
    this.clock = clock;
    this.hydrate();
  }

  create(input: NoteInput): Note {
    const now = this.clock();
    const note: Note = {
      id: makeId(now),
      title: input.title,
      body: input.body,
      category: input.category,
      tags: [...input.tags],
      linkedSituationIds: [...input.linkedSituationIds],
      linkedObservationIds: [...input.linkedObservationIds],
      createdAt: now,
      updatedAt: now,
      isPinned: input.isPinned,
    };
    this.notes.push(note);
    this.enforceRingBuffer();
    this.persist();
    this.notify();
    return cloneNote(note);
  }

  update(id: string, updates: NoteUpdate): Note | null {
    const idx = this.notes.findIndex((n) => n.id === id);
    if (idx === -1) return null;
    const existing = this.notes[idx];
    if (!existing) return null;
    const next: Note = {
      ...existing,
      title: updates.title ?? existing.title,
      body: updates.body ?? existing.body,
      category: updates.category ?? existing.category,
      tags: updates.tags ? [...updates.tags] : existing.tags,
      linkedSituationIds: updates.linkedSituationIds ? [...updates.linkedSituationIds] : existing.linkedSituationIds,
      linkedObservationIds: updates.linkedObservationIds ? [...updates.linkedObservationIds] : existing.linkedObservationIds,
      isPinned: updates.isPinned ?? existing.isPinned,
      updatedAt: this.clock(),
    };
    this.notes[idx] = next;
    this.persist();
    this.notify();
    return cloneNote(next);
  }

  delete(id: string): boolean {
    const idx = this.notes.findIndex((n) => n.id === id);
    if (idx === -1) return false;
    this.notes.splice(idx, 1);
    this.persist();
    this.notify();
    return true;
  }

  search(query: string): Note[] {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [];
    const matches = this.notes.filter((n) =>
      n.title.toLowerCase().includes(q) ||
      n.body.toLowerCase().includes(q) ||
      n.tags.some((t) => t.toLowerCase().includes(q)),
    );
    return this.sortLIFO(matches).map((n) => cloneNote(n));
  }

  getByTag(tag: string): Note[] {
    const t = tag.toLowerCase();
    const matches = this.notes.filter((n) => n.tags.some((nt) => nt.toLowerCase() === t));
    return this.sortLIFO(matches).map((n) => cloneNote(n));
  }

  getBySituation(situationId: string): Note[] {
    const matches = this.notes.filter((n) => n.linkedSituationIds.includes(situationId));
    return this.sortLIFO(matches).map((n) => cloneNote(n));
  }

  getAll(filter?: NotebookFilter, limit?: number): Note[] {
    let pool = this.notes;
    if (filter?.category !== undefined) {
      pool = pool.filter((n) => n.category === filter.category);
    }
    if (filter?.isPinned !== undefined) {
      pool = pool.filter((n) => n.isPinned === filter.isPinned);
    }
    // Pinned first, then LIFO within each bucket.
    const pinned = this.sortLIFO(pool.filter((n) => n.isPinned));
    const unpinned = this.sortLIFO(pool.filter((n) => !n.isPinned));
    const combined = [...pinned, ...unpinned];
    const sliced = typeof limit === 'number' && limit >= 0 ? combined.slice(0, limit) : combined;
    return sliced.map((n) => cloneNote(n));
  }

  getStats(): NotebookStats {
    const byCategory = emptyByCategory();
    let pinned = 0;
    for (const n of this.notes) {
      byCategory[n.category] += 1;
      if (n.isPinned) pinned += 1;
    }
    return {
      total: this.notes.length,
      pinned,
      byCategory,
      recentTags: this.computeRecentTags(),
    };
  }

  subscribe(cb: NotebookListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  // ── Internals ───────────────────────────────────────────────────────

  private sortLIFO(notes: readonly Note[]): Note[] {
    return [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private computeRecentTags(): string[] {
    const recent = this.sortLIFO(this.notes).slice(0, RECENT_TAGS_WINDOW);
    const freq = new Map<string, number>();
    for (const n of recent) {
      for (const tag of n.tags) {
        const key = tag.toLowerCase();
        freq.set(key, (freq.get(key) ?? 0) + 1);
      }
    }
    return [...freq.entries()]
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return a[0].localeCompare(b[0]);
      })
      .map(([tag]) => tag);
  }

  private enforceRingBuffer(): void {
    if (this.notes.length <= MAX_NOTES) return;
    // Evict oldest unpinned notes first (pinned notes are preferentially
    // kept). If we still have to evict pinned notes after that, evict
    // the oldest of those.
    const overflow = this.notes.length - MAX_NOTES;
    const unpinned = this.notes
      .map((n, idx) => ({ n, idx }))
      .filter((e) => !e.n.isPinned)
      .sort((a, b) => a.n.createdAt - b.n.createdAt);
    const victimsIdx = new Set<number>();
    for (let i = 0; i < overflow && i < unpinned.length; i++) {
      victimsIdx.add(unpinned[i]!.idx);
    }
    if (victimsIdx.size < overflow) {
      const pinned = this.notes
        .map((n, idx) => ({ n, idx }))
        .filter((e) => e.n.isPinned && !victimsIdx.has(e.idx))
        .sort((a, b) => a.n.createdAt - b.n.createdAt);
      const stillNeed = overflow - victimsIdx.size;
      for (let i = 0; i < stillNeed && i < pinned.length; i++) {
        victimsIdx.add(pinned[i]!.idx);
      }
    }
    this.notes = this.notes.filter((_, idx) => !victimsIdx.has(idx));
  }

  private hydrate(): void {
    let raw: string | null;
    try {
      raw = this.storage.getItem(STORAGE_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const filtered = parsed.filter((n) => isValidNote(n));
      this.notes = filtered.slice(-MAX_NOTES);
    } catch {
      try {
        this.storage.removeItem(STORAGE_KEY);
      } catch {
        /* noop */
      }
    }
  }

  private persist(): void {
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.notes));
    } catch {
      /* persistence is best-effort */
    }
  }

  private notify(): void {
    const snapshot = this.notes.map((n) => cloneNote(n));
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // Crash isolation — one bad listener cannot poison the others.
      }
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────

let singleton: AnalystNotebookService | null = null;

function defaultStorage(): NotebookStorage {
  if (typeof globalThis !== 'undefined' && (globalThis as { localStorage?: NotebookStorage }).localStorage) {
    return (globalThis as unknown as { localStorage: NotebookStorage }).localStorage;
  }
  const mem = new Map<string, string>();
  return {
    getItem: (k) => (mem.has(k) ? mem.get(k) ?? null : null),
    setItem: (k, v) => {
      mem.set(k, v);
    },
    removeItem: (k) => {
      mem.delete(k);
    },
  };
}

export function getAnalystNotebookService(): AnalystNotebookService {
  singleton ??= new AnalystNotebookService(defaultStorage());
  return singleton;
}

export function __resetAnalystNotebookSingleton(): void {
  singleton = null;
  counter = 0;
}

export const __internals = {
  makeId,
  isValidNote,
  emptyByCategory,
};
