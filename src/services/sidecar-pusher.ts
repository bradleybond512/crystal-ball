/**
 * Sidecar Pusher — mirrors renderer-side reasoning state to the sidecar so
 * external agents (the Crystal Ball MCP server, scheduled scripts) can read
 * it via HTTP without needing access to the renderer's localStorage.
 *
 * The renderer is the source of truth for:
 *   - the analyst-loop snapshot (cb:analyst-hypotheses)
 *   - the mode-forecast snapshot (cb:mode-advisory)
 *   - hypothesis-accuracy stats (read on demand)
 *   - hypothesis-thread state (read on demand)
 *
 * On each event we POST a compact projection to the sidecar's in-memory
 * cache. The sidecar exposes matching GET endpoints registered as MCP tools.
 *
 * Pushes are silent (errors swallowed) since they're a best-effort mirror.
 */

import { isDesktopRuntime } from './runtime';
import { isGhostMode } from './mode-manager';
import type { AnalystSnapshot } from './analyst-loop';
import type { ForecastSnapshot } from './mode-forecast';
import { getKindAccuracy } from './hypothesis-accuracy';
import { getAllThreads } from './hypothesis-threads';
import { getHotEntities, getEntityMentions } from './hypothesis-entities';

const ENDPOINT = '/api/analyst-state';

interface AccuracyRow { kind: string; hits: number; misses: number; ratio: number }
interface ThreadRow {
  signature: string;
  kind: string;
  region?: string;
  cycleCount: number;
  confidence: number;
  trajectory: string;
  peakRisk: string;
  firstSeen: number;
  lastSeen: number;
}
interface EntityRow { entity: string; kind: string; hypothesisCount: number }

interface PushPayload {
  timestamp: number;
  analyst?: AnalystSnapshot;
  forecast?: ForecastSnapshot;
  accuracy?: AccuracyRow[];
  threads?: ThreadRow[];
  hotEntities?: EntityRow[];
  entityCount?: number;
  ghostMode?: boolean;
}

let lastPushAt = 0;
const MIN_PUSH_INTERVAL_MS = 2000; // debounce to coalesce burst events
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPayload: PushPayload = { timestamp: 0 };

async function flush(): Promise<void> {
  pendingTimer = null;
  if (!isDesktopRuntime()) return;
  const payload: PushPayload = { ...pendingPayload, timestamp: Date.now(), ghostMode: isGhostMode() };
  pendingPayload = { timestamp: 0 };
  lastPushAt = Date.now();
  try {
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch { /* silent — best effort */ }
}

function schedule(): void {
  if (pendingTimer !== null) return;
  const since = Date.now() - lastPushAt;
  const wait = since >= MIN_PUSH_INTERVAL_MS ? 0 : (MIN_PUSH_INTERVAL_MS - since);
  pendingTimer = setTimeout(() => { void flush(); }, wait);
}

function summarizeAccuracy(): PushPayload['accuracy'] {
  const out: PushPayload['accuracy'] = [];
  for (const [kind, stats] of getKindAccuracy()) {
    const total = stats.hits + stats.misses;
    if (total === 0) continue;
    out.push({ kind, hits: stats.hits, misses: stats.misses, ratio: stats.hits / total });
  }
  return out;
}

function summarizeThreads(): PushPayload['threads'] {
  return getAllThreads().slice(0, 20).map(t => ({
    signature: t.signature,
    kind: t.kind,
    region: t.region,
    cycleCount: t.cycleCount,
    confidence: t.latest.confidence,
    trajectory: t.trajectory,
    peakRisk: t.peakRisk,
    firstSeen: t.firstSeen,
    lastSeen: t.lastSeen,
  }));
}

function summarizeEntities(): { hot: PushPayload['hotEntities']; total: number } {
  const all = getEntityMentions();
  const hot = getHotEntities().slice(0, 12).map(m => ({
    entity: m.entity,
    kind: m.kind,
    hypothesisCount: m.hypothesisIds.length,
  }));
  return { hot, total: all.length };
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

let started = false;

export function startSidecarPusher(): void {
  if (started) return;
  started = true;
  if (!isDesktopRuntime()) return;

  document.addEventListener('cb:analyst-hypotheses', (e: Event) => {
    const ce = e as CustomEvent<AnalystSnapshot>;
    pendingPayload.analyst = ce.detail;
    pendingPayload.accuracy = summarizeAccuracy();
    pendingPayload.threads = summarizeThreads();
    const ent = summarizeEntities();
    pendingPayload.hotEntities = ent.hot;
    pendingPayload.entityCount = ent.total;
    schedule();
  });

  document.addEventListener('cb:mode-advisory', (e: Event) => {
    const ce = e as CustomEvent<ForecastSnapshot>;
    pendingPayload.forecast = ce.detail;
    schedule();
  });
}
