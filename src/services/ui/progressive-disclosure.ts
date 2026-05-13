/**
 * Progressive Disclosure UX service.
 *
 * Tracks per-panel disclosure level (`summary` | `detail` | `raw`) plus a
 * per-panel set of "expanded" section ids, with an optional global
 * override that forces every panel to the same level (used by the
 * Command Center "expand all / collapse all" affordance).
 *
 * Pure module — no DOM, no fetch. State persists to localStorage under
 * `wm-disclosure-state`. Hydration is lazy so importing this module in
 * a non-browser context (sidecar, tests without a storage stub) does
 * not crash; the service silently falls back to defaults.
 */

export type DisclosureLevel = 'summary' | 'detail' | 'raw';

export const DISCLOSURE_LEVELS: readonly DisclosureLevel[] = ['summary', 'detail', 'raw'] as const;

export interface DisclosureConfig {
  panelId: string;
  level: DisclosureLevel;
  expandedSections: string[];
}

export interface DisclosureStateSnapshot {
  configs: Record<string, DisclosureConfig>;
  globalLevel: DisclosureLevel | null;
}

export type DisclosureListener = (config: DisclosureConfig, globalLevel: DisclosureLevel | null) => void;

const STORAGE_KEY = 'wm-disclosure-state';
const DEFAULT_LEVEL: DisclosureLevel = 'summary';

function isLevel(value: unknown): value is DisclosureLevel {
  return value === 'summary' || value === 'detail' || value === 'raw';
}

function emptyConfig(panelId: string): DisclosureConfig {
  return { panelId, level: DEFAULT_LEVEL, expandedSections: [] };
}

interface ParsedStored {
  globalLevel: DisclosureLevel | null;
  configs: DisclosureConfig[];
}

function parseStoredState(raw: string): ParsedStored | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as { globalLevel?: unknown; configs?: unknown };
  const globalLevel: DisclosureLevel | null = isLevel(obj.globalLevel) ? obj.globalLevel : null;
  const configs = parseStoredConfigs(obj.configs);
  return { globalLevel, configs };
}

function parseStoredConfigs(raw: unknown): DisclosureConfig[] {
  if (!raw || typeof raw !== 'object') return [];
  const result: DisclosureConfig[] = [];
  for (const [panelId, value] of Object.entries(raw as Record<string, unknown>)) {
    const config = parseStoredConfig(panelId, value);
    if (config) result.push(config);
  }
  return result;
}

function parseStoredConfig(panelId: string, value: unknown): DisclosureConfig | null {
  if (typeof panelId !== 'string' || !value || typeof value !== 'object') return null;
  const v = value as { level?: unknown; expandedSections?: unknown };
  const level = isLevel(v.level) ? v.level : DEFAULT_LEVEL;
  const sections = Array.isArray(v.expandedSections)
    ? v.expandedSections.filter((s): s is string => typeof s === 'string')
    : [];
  return { panelId, level, expandedSections: sections };
}

class DisclosureService {
  private configs = new Map<string, DisclosureConfig>();
  private globalLevel: DisclosureLevel | null = null;
  private listeners = new Map<string, Set<DisclosureListener>>();
  private hydrated = false;

  /** Lazy localStorage read. Tolerates missing storage and corrupt JSON. */
  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    const raw = this.readStoredRaw();
    if (!raw) return;
    const parsed = parseStoredState(raw);
    if (!parsed) return;
    if (parsed.globalLevel !== null) this.globalLevel = parsed.globalLevel;
    for (const cfg of parsed.configs) {
      this.configs.set(cfg.panelId, cfg);
    }
  }

  private readStoredRaw(): string | null {
    const storage = this.safeStorage();
    if (!storage) return null;
    try {
      return storage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  private safeStorage(): Storage | null {
    try {
      const ls = (globalThis as { localStorage?: Storage }).localStorage;
      return ls ?? null;
    } catch {
      return null;
    }
  }

  private persist(): void {
    const storage = this.safeStorage();
    if (!storage) return;
    const snapshot: DisclosureStateSnapshot = {
      configs: Object.fromEntries(this.configs),
      globalLevel: this.globalLevel,
    };
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // Quota or serialization error — disclosure state is non-critical.
    }
  }

  private ensureConfig(panelId: string): DisclosureConfig {
    let cfg = this.configs.get(panelId);
    if (!cfg) {
      cfg = emptyConfig(panelId);
      this.configs.set(panelId, cfg);
    }
    return cfg;
  }

  private notifyPanel(panelId: string): void {
    const set = this.listeners.get(panelId);
    if (!set) return;
    const cfg = this.configs.get(panelId) ?? emptyConfig(panelId);
    for (const listener of set) {
      try {
        listener(cfg, this.globalLevel);
      } catch {
        // A misbehaving listener cannot bring down the broadcast.
      }
    }
  }

  private notifyAll(): void {
    for (const panelId of this.listeners.keys()) {
      this.notifyPanel(panelId);
    }
  }

  /** Effective level — the global override wins when set. */
  getLevel(panelId: string): DisclosureLevel {
    this.ensureHydrated();
    if (this.globalLevel) return this.globalLevel;
    return this.configs.get(panelId)?.level ?? DEFAULT_LEVEL;
  }

  /** Stored per-panel level (ignores the global override). Useful for tests + diagnostics. */
  getPanelLevel(panelId: string): DisclosureLevel {
    this.ensureHydrated();
    return this.configs.get(panelId)?.level ?? DEFAULT_LEVEL;
  }

  setLevel(panelId: string, level: DisclosureLevel): void {
    this.ensureHydrated();
    if (!isLevel(level)) return;
    const cfg = this.ensureConfig(panelId);
    if (cfg.level === level) return;
    cfg.level = level;
    this.persist();
    this.notifyPanel(panelId);
  }

  toggleSection(panelId: string, sectionId: string): void {
    this.ensureHydrated();
    if (!sectionId) return;
    const cfg = this.ensureConfig(panelId);
    const idx = cfg.expandedSections.indexOf(sectionId);
    if (idx === -1) {
      cfg.expandedSections.push(sectionId);
    } else {
      cfg.expandedSections.splice(idx, 1);
    }
    this.persist();
    this.notifyPanel(panelId);
  }

  isSectionExpanded(panelId: string, sectionId: string): boolean {
    this.ensureHydrated();
    return this.configs.get(panelId)?.expandedSections.includes(sectionId) ?? false;
  }

  /** Set (or clear, with null) the cross-panel global level. */
  setGlobalLevel(level: DisclosureLevel | null): void {
    this.ensureHydrated();
    if (level !== null && !isLevel(level)) return;
    if (this.globalLevel === level) return;
    this.globalLevel = level;
    this.persist();
    this.notifyAll();
  }

  getGlobalLevel(): DisclosureLevel | null {
    this.ensureHydrated();
    return this.globalLevel;
  }

  /** Subscribe to changes for one panel. Returns an unsubscribe fn. */
  subscribe(panelId: string, listener: DisclosureListener): () => void {
    let set = this.listeners.get(panelId);
    if (!set) {
      set = new Set();
      this.listeners.set(panelId, set);
    }
    set.add(listener);
    return () => {
      const current = this.listeners.get(panelId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(panelId);
    };
  }

  /** Whole-state read for diagnostics + tests. Returns a fresh copy. */
  snapshot(): DisclosureStateSnapshot {
    this.ensureHydrated();
    return {
      configs: Object.fromEntries(
        [...this.configs.entries()].map(([id, cfg]) => [
          id,
          { panelId: cfg.panelId, level: cfg.level, expandedSections: [...cfg.expandedSections] },
        ]),
      ),
      globalLevel: this.globalLevel,
    };
  }

  /** Wipe all state, listeners, and the persisted blob. Intended for tests. */
  resetForTesting(): void {
    this.configs.clear();
    this.listeners.clear();
    this.globalLevel = null;
    this.hydrated = true;
    const storage = this.safeStorage();
    if (storage) {
      try { storage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  }
}

export const disclosureService = new DisclosureService();

/** Cycle helper: next level in S → D → R → S order (skips R when not available). */
export function cycleDisclosureLevel(current: DisclosureLevel, hasRaw: boolean): DisclosureLevel {
  if (current === 'summary') return 'detail';
  if (current === 'detail') return hasRaw ? 'raw' : 'summary';
  return 'summary';
}

/** Short label for the level-switcher UI. */
export function disclosureLabel(level: DisclosureLevel): string {
  if (level === 'summary') return 'S';
  if (level === 'detail') return 'D';
  return 'R';
}

/** Long label, used in aria-labels and tooltips. */
export function disclosureLongLabel(level: DisclosureLevel): string {
  if (level === 'summary') return 'Summary';
  if (level === 'detail') return 'Detail';
  return 'Raw';
}
