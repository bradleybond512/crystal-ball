/**
 * Polls the four /api/infrastructure/* sidecar routes on independent
 * intervals and pipes the parsed summaries into a GridIntelligencePanel
 * via panel.update().
 *
 * Per the spec polling cadence:
 *   - grid:      15 min
 *   - outages:    5 min
 *   - bgp:       10 min
 *   - radiation: 30 min
 *
 * On startup we run every probe once (so the panel paints quickly), then
 * schedule each on its own setInterval. The loader returns a `stop()`
 * function that clears every interval — the renderer doesn't need it for
 * normal operation but tests + hot-reload do.
 */

import { getApiBaseUrl } from '@/services/runtime';
import {
  buildGridSnapshot,
  buildOutageSummary,
  buildBgpSummary,
  buildRadSummary,
  type GridSnapshot,
  type OutageSummary,
  type BgpSummary,
  type RadSummary,
} from './grid-monitor';
import type { GridIntelligencePanel } from '@/components/GridIntelligencePanel';

const POLL_GRID_MS = 15 * 60 * 1000;
const POLL_OUTAGES_MS = 5 * 60 * 1000;
const POLL_BGP_MS = 10 * 60 * 1000;
const POLL_RADIATION_MS = 30 * 60 * 1000;

const FETCH_TIMEOUT_MS = 20_000;

export interface GridIntelligenceLoaderHandle {
  stop(): void;
  refresh(): Promise<void>;
}

export function startGridIntelligenceLoader(panel: GridIntelligencePanel): GridIntelligenceLoaderHandle {
  const refreshGrid = async (): Promise<void> => {
    const snap = await fetchGrid();
    panel.update({ grid: snap });
  };
  const refreshOutages = async (): Promise<void> => {
    const summary = await fetchOutages();
    panel.update({ outages: summary });
  };
  const refreshBgp = async (): Promise<void> => {
    const summary = await fetchBgp();
    panel.update({ bgp: summary });
  };
  const refreshRadiation = async (): Promise<void> => {
    const summary = await fetchRadiation();
    panel.update({ radiation: summary });
  };

  const refreshAll = async (): Promise<void> => {
    await Promise.allSettled([refreshGrid(), refreshOutages(), refreshBgp(), refreshRadiation()]);
  };

  void refreshAll();

  const intervals: ReturnType<typeof setInterval>[] = [
    setInterval(() => { void refreshGrid(); }, POLL_GRID_MS),
    setInterval(() => { void refreshOutages(); }, POLL_OUTAGES_MS),
    setInterval(() => { void refreshBgp(); }, POLL_BGP_MS),
    setInterval(() => { void refreshRadiation(); }, POLL_RADIATION_MS),
  ];

  return {
    stop(): void {
      for (const id of intervals) clearInterval(id);
    },
    refresh: refreshAll,
  };
}

// ─── Per-source fetch + parse ─────────────────────────────────────────

async function fetchGrid(): Promise<GridSnapshot | null> {
  const data = await fetchJson('/api/infrastructure/grid');
  if (!data || !Array.isArray((data as { rows?: unknown }).rows)) return null;
  const rows = (data as { rows: unknown[] }).rows.filter((r): r is { period: string; respondent: string; type: string; value: string | number | null } => {
    if (typeof r !== 'object' || r === null) return false;
    const x = r as Record<string, unknown>;
    return typeof x.period === 'string' && typeof x.respondent === 'string' && typeof x.type === 'string';
  });
  return buildGridSnapshot(rows, Date.now());
}

async function fetchOutages(): Promise<OutageSummary | null> {
  const data = await fetchJson('/api/infrastructure/outages');
  if (!data) return null;
  const entities = Array.isArray((data as { entities?: unknown }).entities) ? (data as { entities: unknown[] }).entities : [];
  return buildOutageSummary(entities as Parameters<typeof buildOutageSummary>[0], Date.now());
}

async function fetchBgp(): Promise<BgpSummary | null> {
  const data = await fetchJson('/api/infrastructure/bgp');
  if (!data) return null;
  const events = Array.isArray((data as { events?: unknown }).events) ? (data as { events: unknown[] }).events : [];
  return buildBgpSummary(events as Parameters<typeof buildBgpSummary>[0], Date.now());
}

async function fetchRadiation(): Promise<RadSummary | null> {
  const data = await fetchJson('/api/infrastructure/radiation');
  if (!data) return null;
  const stations = Array.isArray((data as { stations?: unknown }).stations) ? (data as { stations: unknown[] }).stations : [];
  return buildRadSummary(stations as Parameters<typeof buildRadSummary>[0], Date.now());
}

async function fetchJson(path: string): Promise<unknown> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const url = `${getApiBaseUrl()}${path}`;
      const r = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!r.ok) return null;
      return await r.json() as unknown;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}
