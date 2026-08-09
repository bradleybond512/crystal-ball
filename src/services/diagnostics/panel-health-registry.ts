/**
 * Panel Health Registry — per
 * docs/DIAGNOSTICS_OBSERVABILITY_ENHANCEMENT_PLAN.md PR 2 (lines 411-421)
 * and the elite gameplan's Phase 1 ("never miss what matters").
 *
 * Central tracking for every panel: mounted / enabled / visible state,
 * render heartbeat, last data update, last error, derived stale-age
 * and HealthStatus. The plan calls for integration with `Panel.ts` +
 * `panel-layout.ts`; this module is the pure deterministic store and
 * status calculator. Wiring those existing files is a small follow-up
 * once this contract lands.
 *
 * Pure deterministic. No DOM, no fetch, no globals at import time.
 *
 * Plan invariants:
 *   - Every panel record carries enough context for "why is this
 *     panel red?" without joining other tables
 *   - Stale age + heartbeat decide degraded vs failing
 *   - Records are JSON-serializable for the export bundle (PR 8)
 */

import type {
  HealthStatus,
  PanelHealth,
  PanelId,
} from './system-health-types';

// ── Public API ──────────────────────────────────────────────────────────

export interface PanelHealthRegistration {
  panelId: PanelId;
  label?: string;
  /** Other panels / services this panel depends on. PanelId and
   *  ServiceId are both string aliases, so this is just `string`. */
  dependencies?: readonly string[];
  /** ms — if no successful render arrives within this window the
   *  panel goes 'stale'. Default 5 minutes. */
  staleAfterMs?: number;
  /** ms — if no successful render arrives within this window the
   *  panel goes 'failing'. Default 30 minutes. */
  failingAfterMs?: number;
}

export interface PanelHealthRegistryOptions {
  /** Optional clock for tests. Defaults to Date.now(). */
  now?: () => number;
}

export interface PanelHealthRegistry {
  /** Idempotent — re-registering updates label / dependencies /
   *  thresholds but preserves observed state. */
  register: (registration: PanelHealthRegistration) => void;
  recordMount: (panelId: PanelId) => void;
  recordUnmount: (panelId: PanelId) => void;
  /** Successful render. Bumps lastRenderAt + clears the most-recent
   *  error if the render was healthy. */
  recordRender: (panelId: PanelId, options?: { hadData?: boolean }) => void;
  /** Failed render. Records the error and bumps lastErrorAt. */
  recordError: (panelId: PanelId, error: string) => void;
  /** Data refresh observed (independent of render). */
  recordDataUpdate: (panelId: PanelId) => void;
  setEnabled: (panelId: PanelId, enabled: boolean) => void;
  setVisible: (panelId: PanelId, visible: boolean) => void;
  /** Heartbeat ping. Used for panels that don't render every cycle
   *  but should still report alive (e.g. background subscribers). */
  recordHeartbeat: (panelId: PanelId) => void;
  /** Get the current PanelHealth, recomputing status from observed
   *  state + thresholds. Returns undefined when never registered. */
  get: (panelId: PanelId) => PanelHealth | undefined;
  /** All panels' current health. */
  all: () => PanelHealth[];
  /** Filter by status. */
  byStatus: (status: HealthStatus) => PanelHealth[];
  /** Reset to empty. Tests use this; app code does not. */
  clear: () => void;
}

const DEFAULT_STALE_MS = 5 * 60 * 1000;
const DEFAULT_FAILING_MS = 30 * 60 * 1000;

// ── Internal state ──────────────────────────────────────────────────────

interface PanelEntry {
  registration: Required<Omit<PanelHealthRegistration, 'label' | 'dependencies'>> &
    Pick<PanelHealthRegistration, 'label' | 'dependencies'>;
  mounted: boolean;
  explicitlyUnmounted: boolean;
  enabled: boolean;
  visible: boolean;
  lastRenderAt?: number;
  lastDataUpdateAt?: number;
  lastErrorAt?: number;
  lastError?: string;
  lastHeartbeatAt?: number;
}

export function createPanelHealthRegistry(
  options: PanelHealthRegistryOptions = {},
): PanelHealthRegistry {
  const now = options.now ?? (() => Date.now());
  const entries = new Map<PanelId, PanelEntry>();

  function ensureEntry(panelId: PanelId, registration?: PanelHealthRegistration): PanelEntry {
    const existing = entries.get(panelId);
    if (existing) {
      if (registration) {
        existing.registration = mergeRegistration(existing.registration, registration);
      }
      return existing;
    }
    const reg = registration ?? { panelId };
    const entry: PanelEntry = {
      registration: {
        panelId: reg.panelId,
        staleAfterMs: reg.staleAfterMs ?? DEFAULT_STALE_MS,
        failingAfterMs: reg.failingAfterMs ?? DEFAULT_FAILING_MS,
        label: reg.label,
        dependencies: reg.dependencies,
      },
      mounted: false,
      explicitlyUnmounted: false,
      enabled: true, // panels default to enabled until told otherwise
      visible: false,
    };
    entries.set(panelId, entry);
    return entry;
  }

  function register(registration: PanelHealthRegistration): void {
    ensureEntry(registration.panelId, registration);
  }

  function recordMount(panelId: PanelId): void {
    const e = ensureEntry(panelId);
    e.mounted = true;
    e.explicitlyUnmounted = false;
  }

  function recordUnmount(panelId: PanelId): void {
    const e = entries.get(panelId);
    if (e) {
      e.mounted = false;
      e.visible = false;
      e.explicitlyUnmounted = true;
    }
  }

  function recordRender(panelId: PanelId, opts: { hadData?: boolean } = {}): void {
    const e = ensureEntry(panelId);
    if (e.explicitlyUnmounted) return;
    e.mounted = true;
    e.explicitlyUnmounted = false;
    e.lastRenderAt = now();
    if (opts.hadData) e.lastDataUpdateAt = now();
    // A successful render clears recent errors so the panel can recover.
    e.lastError = undefined;
    e.lastErrorAt = undefined;
  }

  function recordError(panelId: PanelId, error: string): void {
    const e = ensureEntry(panelId);
    if (e.explicitlyUnmounted) return;
    e.mounted = true;
    e.lastErrorAt = now();
    e.lastError = error;
  }

  function recordDataUpdate(panelId: PanelId): void {
    const e = ensureEntry(panelId);
    e.lastDataUpdateAt = now();
  }

  function setEnabled(panelId: PanelId, enabled: boolean): void {
    const e = ensureEntry(panelId);
    e.enabled = enabled;
  }

  function setVisible(panelId: PanelId, visible: boolean): void {
    const e = ensureEntry(panelId);
    e.visible = visible;
  }

  function recordHeartbeat(panelId: PanelId): void {
    const e = ensureEntry(panelId);
    if (e.explicitlyUnmounted) return;
    e.mounted = true;
    e.lastHeartbeatAt = now();
  }

  function get(panelId: PanelId): PanelHealth | undefined {
    const e = entries.get(panelId);
    if (!e) return undefined;
    return computeHealth(e, now());
  }

  function all(): PanelHealth[] {
    const list: PanelHealth[] = [];
    const t = now();
    for (const e of entries.values()) {
      list.push(computeHealth(e, t));
    }
    list.sort((a, b) => a.panelId.localeCompare(b.panelId));
    return list;
  }

  function byStatus(status: HealthStatus): PanelHealth[] {
    return all().filter((h) => h.status === status);
  }

  function clear(): void {
    entries.clear();
  }

  return {
    register,
    recordMount,
    recordUnmount,
    recordRender,
    recordError,
    recordDataUpdate,
    setEnabled,
    setVisible,
    recordHeartbeat,
    get,
    all,
    byStatus,
    clear,
  };
}

// ── Status calculator ──────────────────────────────────────────────────

function computeHealth(entry: PanelEntry, t: number): PanelHealth {
  const { registration } = entry;
  const lastSignal = mostRecent([
    entry.lastRenderAt,
    entry.lastDataUpdateAt,
  ]);
  const staleAge = lastSignal === undefined ? undefined : t - lastSignal;

  const status = decideStatus(entry, staleAge);

  return {
    panelId: registration.panelId,
    label: registration.label,
    status,
    mounted: entry.mounted,
    enabled: entry.enabled,
    visible: entry.visible,
    lastRenderAt: entry.lastRenderAt,
    lastDataUpdateAt: entry.lastDataUpdateAt,
    lastErrorAt: entry.lastErrorAt,
    lastError: entry.lastError,
    staleAgeMs: staleAge,
    dependencies: registration.dependencies ?? [],
  };
}

function decideStatus(entry: PanelEntry, staleAge: number | undefined): HealthStatus {
  // Disabled panels are explicitly out of scope — surface them as
  // 'unknown' so dashboards don't paint them red.
  if (!entry.enabled) return 'unknown';
  if (!entry.mounted) {
    return entry.lastRenderAt === undefined && entry.lastDataUpdateAt === undefined
      ? 'blind'
      : 'unknown';
  }
  if (!entry.visible) return 'unknown';
  // A recent error trumps stale age — show the user what actually failed.
  if (entry.lastError && entry.lastErrorAt !== undefined) return 'failing';
  // Never observed → blind so the UI flags it for first-render check.
  if (staleAge === undefined) return 'unknown';
  if (staleAge >= entry.registration.failingAfterMs) return 'failing';
  if (staleAge >= entry.registration.staleAfterMs) return 'stale';
  return 'healthy';
}

// ── Helpers ─────────────────────────────────────────────────────────────

function mergeRegistration(
  existing: PanelEntry['registration'],
  next: PanelHealthRegistration,
): PanelEntry['registration'] {
  return {
    panelId: existing.panelId,
    label: next.label ?? existing.label,
    dependencies: next.dependencies ?? existing.dependencies,
    staleAfterMs: next.staleAfterMs ?? existing.staleAfterMs,
    failingAfterMs: next.failingAfterMs ?? existing.failingAfterMs,
  };
}

function mostRecent(times: readonly (number | undefined)[]): number | undefined {
  let best: number | undefined;
  for (const t of times) {
    if (t === undefined) continue;
    if (best === undefined || t > best) best = t;
  }
  return best;
}
