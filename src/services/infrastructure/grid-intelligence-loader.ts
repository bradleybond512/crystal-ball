/**
 * Polls the three global /api/infrastructure/* sidecar routes on independent
 * intervals and pipes their parsed summaries into a GridIntelligencePanel.
 * Exact-county outage context arrives through the validated Disaster
 * Lifelines snapshot event; it is never replaced with a partial national
 * query or interpreted as an all-clear when ODIN has no accepted report.
 *
 * Per the spec polling cadence:
 *   - grid:      15 min
 *   - outages:    re-evaluate expiry every 5 min (no network poll)
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
  ageOutageSummary,
  selectActiveOutageSummary,
  resetActiveOutageSummary,
  buildBgpSummary,
  buildRadSummary,
  type GridSnapshot,
  type OutageSummary,
  type BgpSummary,
  type RadSummary,
} from './grid-monitor';
import {
  outagesToStateOverlay,
  radiationToHotspots,
  bgpToBanner,
  type OutageOverlayRow,
  type RadHotspotRow,
  type BgpBannerState,
} from './infrastructure-overlay';
import type { GridIntelligencePanel } from '@/components/GridIntelligencePanel';
import { InfrastructureBannerBar } from '@/components/InfrastructureBannerBar';
import { getSavedPlace, type SavedPlace } from '@/services/saved-places';
import {
  buildLocalLogisticsFingerprint,
  getCachedLocalLogistics,
  LOCAL_LOGISTICS_CATEGORIES,
  type LocalLogisticsSnapshot,
} from '@/services/local-logistics';

const POLL_GRID_MS = 15 * 60 * 1000;
const POLL_OUTAGES_MS = 5 * 60 * 1000;
const POLL_BGP_MS = 10 * 60 * 1000;
const POLL_RADIATION_MS = 30 * 60 * 1000;

const FETCH_TIMEOUT_MS = 20_000;
export const LOCAL_LOGISTICS_ACTIVE_PLACE_EVENT = 'wm:local-logistics-active-place-changed';
export const ACTIVE_LOCAL_LOGISTICS_SNAPSHOT_EVENT = 'wm:active-local-logistics-snapshot-updated';

export interface InfrastructureOverlayState {
  outageStates: OutageOverlayRow[];
  radiationHotspots: RadHotspotRow[];
  bgpBanner: BgpBannerState;
}

export type OverlaySubscriber = (state: InfrastructureOverlayState) => void;

export interface GridIntelligenceLoaderHandle {
  stop(): void;
  refresh(): Promise<void>;
  /** Subscribe to overlay-state updates after every refresh. The
   *  callback is invoked once with the current state on subscribe. */
  subscribe(fn: OverlaySubscriber): () => void;
  getOverlayState(): InfrastructureOverlayState;
}

export interface GridIntelligenceLoaderOptions {
  /** Explicit Disaster Lifelines selection; background prewarm is not active. */
  getActivePlaceId(): string | null;
}

function reportRefreshFailure(error: unknown): void {
  // eslint-disable-next-line no-console -- diagnostic for an unexpected background refresh failure
  console.warn('[grid-intelligence-loader] background refresh failed', error);
}

const EMPTY_OVERLAY: InfrastructureOverlayState = {
  outageStates: [],
  radiationHotspots: [],
  bgpBanner: { visible: false, severity: 'none', message: '', criticalEvents: [] },
};

let latestOutageSummary = buildOutageSummary(null, Date.now());

function exactCachedOutageSummary(placeId: string | null, now: number): OutageSummary | null {
  if (!placeId) return null;
  const place = getSavedPlace(placeId);
  if (!place) return null;
  try {
    // Exact-place lookup only: never use the place-ID compatibility cache,
    // which may refer to old coordinates/options after an edit.
    const snapshot = getCachedLocalLogistics(place);
    return snapshot ? buildOutageSummary(snapshot, now) : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function safeProviderCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 100_000
    ? value : null;
}

function safeProviderFetchedAt(value: unknown, now: number): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    && value <= now + 5 * 60_000 ? value : null;
}

function bgpErrorMessage(code: unknown): string {
  if (code === 'missing_key') return 'Cloudflare Radar API access is not configured.';
  if (code === 'incomplete_page') return 'Cloudflare Radar returned an incomplete BGP event page.';
  if (code === 'no_valid_events') return 'Cloudflare Radar returned no valid BGP event rows.';
  if (code === 'provider_unavailable') return 'Cloudflare Radar is unavailable.';
  return 'The Cloudflare Radar response failed validation.';
}

function radiationErrorMessage(code: unknown): string {
  if (code === 'no_valid_stations') return 'EPA RadNet returned no valid station readings.';
  if (code === 'provider_unavailable') return 'EPA RadNet is unavailable.';
  return 'The EPA RadNet response failed validation.';
}

/**
 * Resolve an accepted panel event back through the exact current-place cache.
 * The document event itself is not trusted outage data: matching top-level
 * identity proves which freshly cached snapshot to read, so a same-ID forged
 * or replayed event cannot substitute another county's observations.
 */
export function matchesExactCurrentLifelinesSnapshot(
  candidateValue: unknown,
  place: SavedPlace,
  cached: LocalLogisticsSnapshot,
): boolean {
  if (!isRecord(candidateValue)) return false;
  const expectedRadiusKm = Math.max(1, Math.min(place.radiusKm, 25));
  const expectedFingerprint = buildLocalLogisticsFingerprint(
    place,
    expectedRadiusKm,
    [...LOCAL_LOGISTICS_CATEGORIES],
  );
  const candidateFetchedAt = candidateValue.fetchedAt instanceof Date
    ? candidateValue.fetchedAt.getTime()
    : Number.NaN;
  return candidateValue.placeId === place.id
    && candidateValue.placeName === place.name
    && candidateValue.queryFingerprint === expectedFingerprint
    && candidateValue.queryFingerprint === cached.queryFingerprint
    && candidateValue.effectiveRadiusKm === expectedRadiusKm
    && candidateFetchedAt === cached.fetchedAt.getTime()
    && candidateValue.countyFips === cached.countyFips;
}

function exactCachedSnapshotForEvent(value: unknown, activePlaceId: string | null): LocalLogisticsSnapshot | null {
  if (!activePlaceId || !isRecord(value) || !isRecord(value.snapshot)) return null;
  const place = getSavedPlace(activePlaceId);
  if (!place) return null;
  const cached = getCachedLocalLogistics(place);
  return cached && matchesExactCurrentLifelinesSnapshot(value.snapshot, place, cached) ? cached : null;
}

export function startGridIntelligenceLoader(
  panel: GridIntelligencePanel,
  options: GridIntelligenceLoaderOptions,
): GridIntelligenceLoaderHandle {
  const activePlaceId = options.getActivePlaceId();
  const seededCandidate = exactCachedOutageSummary(activePlaceId, Date.now());
  latestOutageSummary = resetActiveOutageSummary(seededCandidate, activePlaceId, Date.now());
  let outages: OutageSummary = latestOutageSummary;
  let bgp: BgpSummary | null = null;
  let radiation: RadSummary | null = null;
  const subscribers = new Set<OverlaySubscriber>();
  let lastState: InfrastructureOverlayState = EMPTY_OVERLAY;
  let stopped = false;
  const generations = { grid: 0, bgp: 0, radiation: 0 };
  const controllers: Partial<Record<keyof typeof generations, AbortController>> = {};

  const beginSourceRefresh = (source: keyof typeof generations): { generation: number; controller: AbortController } => {
    controllers[source]?.abort();
    const controller = new AbortController();
    controllers[source] = controller;
    generations[source] += 1;
    return { generation: generations[source], controller };
  };

  const isCurrentSourceRefresh = (
    source: keyof typeof generations,
    generation: number,
    controller: AbortController,
  ): boolean => !stopped && generations[source] === generation && !controller.signal.aborted;

  const banner = safeEnsureBanner();

  const onLifelineSnapshot = (event: Event): void => {
    if (stopped) return;
    const now = Date.now();
    const detail = (event as CustomEvent<unknown>).detail;
    const snapshot = exactCachedSnapshotForEvent(detail, options.getActivePlaceId());
    if (!snapshot) return;
    const summary = buildOutageSummary(snapshot, now);
    latestOutageSummary = selectActiveOutageSummary(
      latestOutageSummary,
      summary,
      options.getActivePlaceId(),
      now,
    );
    outages = latestOutageSummary;
    panel.update({ outages });
    recomputeAndPushOverlay();
  };

  const onActivePlaceChanged = (event: Event): void => {
    if (stopped) return;
    const detail = (event as CustomEvent<unknown>).detail;
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return;
    const announcedPlaceId = (detail as Record<string, unknown>).placeId;
    if (announcedPlaceId !== null
      && (typeof announcedPlaceId !== 'string' || announcedPlaceId.length === 0 || announcedPlaceId.length > 160)) return;
    const activeId = options.getActivePlaceId();
    if (announcedPlaceId !== activeId) return;
    const now = Date.now();
    latestOutageSummary = resetActiveOutageSummary(
      exactCachedOutageSummary(activeId, now), activeId, now,
    );
    outages = latestOutageSummary;
    panel.update({ outages });
    recomputeAndPushOverlay();
  };

  const recomputeAndPushOverlay = (): void => {
    if (stopped) return;
    const overlayNow = Date.now();
    const state: InfrastructureOverlayState = {
      outageStates: outagesToStateOverlay(outages),
      radiationHotspots: radiationToHotspots(radiation, overlayNow),
      bgpBanner: bgpToBanner(bgp, overlayNow),
    };
    lastState = state;
    banner?.setState(state.bgpBanner);
    for (const fn of subscribers) {
      // eslint-disable-next-line no-console -- diagnostic for a misbehaving subscriber
      try { fn(state); } catch (error) { console.warn('[grid-intelligence-loader] subscriber threw', error); }
    }
  };

  const refreshGrid = async (): Promise<void> => {
    if (stopped) return;
    const { generation, controller } = beginSourceRefresh('grid');
    const snap = await fetchGrid(controller.signal);
    if (!isCurrentSourceRefresh('grid', generation, controller)) return;
    panel.update({ grid: snap });
  };
  const refreshOutages = (): void => {
    if (stopped) return;
    outages = selectActiveOutageSummary(
      latestOutageSummary,
      null,
      options.getActivePlaceId(),
      Date.now(),
    );
    latestOutageSummary = outages;
    panel.update({ outages });
    recomputeAndPushOverlay();
  };
  const refreshBgp = async (): Promise<void> => {
    if (stopped) return;
    const { generation, controller } = beginSourceRefresh('bgp');
    const next = await fetchBgp(controller.signal);
    if (!isCurrentSourceRefresh('bgp', generation, controller)) return;
    bgp = next;
    panel.update({ bgp });
    recomputeAndPushOverlay();
  };
  const refreshRadiation = async (): Promise<void> => {
    if (stopped) return;
    const { generation, controller } = beginSourceRefresh('radiation');
    const next = await fetchRadiation(controller.signal);
    if (!isCurrentSourceRefresh('radiation', generation, controller)) return;
    radiation = next;
    panel.update({ radiation });
    recomputeAndPushOverlay();
  };

  const refreshAll = async (): Promise<void> => {
    if (stopped) return;
    refreshOutages();
    await Promise.allSettled([refreshGrid(), refreshBgp(), refreshRadiation()]);
  };
  if (typeof document !== 'undefined') {
    document.addEventListener(ACTIVE_LOCAL_LOGISTICS_SNAPSHOT_EVENT, onLifelineSnapshot);
    document.addEventListener(LOCAL_LOGISTICS_ACTIVE_PLACE_EVENT, onActivePlaceChanged);
  }

  refreshAll().catch(reportRefreshFailure);

  const intervals: ReturnType<typeof setInterval>[] = [
    setInterval(() => { refreshGrid().catch(reportRefreshFailure); }, POLL_GRID_MS),
    setInterval(refreshOutages, POLL_OUTAGES_MS),
    setInterval(() => { refreshBgp().catch(reportRefreshFailure); }, POLL_BGP_MS),
    setInterval(() => { refreshRadiation().catch(reportRefreshFailure); }, POLL_RADIATION_MS),
  ];

  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      for (const source of Object.keys(generations) as (keyof typeof generations)[]) {
        generations[source] += 1;
        controllers[source]?.abort();
        delete controllers[source];
      }
      for (const id of intervals) clearInterval(id);
      if (typeof document !== 'undefined') {
        document.removeEventListener(ACTIVE_LOCAL_LOGISTICS_SNAPSHOT_EVENT, onLifelineSnapshot);
        document.removeEventListener(LOCAL_LOGISTICS_ACTIVE_PLACE_EVENT, onActivePlaceChanged);
      }
      subscribers.clear();
    },
    refresh: refreshAll,
    subscribe(fn: OverlaySubscriber): () => void {
      if (stopped) return () => undefined;
      subscribers.add(fn);
      // eslint-disable-next-line no-console -- diagnostic for a misbehaving subscriber
      try { fn(lastState); } catch (error) { console.warn('[grid-intelligence-loader] subscriber threw on attach', error); }
      return () => { subscribers.delete(fn); };
    },
    getOverlayState(): InfrastructureOverlayState {
      return lastState;
    },
  };
}

/** Banner DOM is renderer-only; tests that import this module under
 *  Node would otherwise crash on `document` access. */
function safeEnsureBanner(): InfrastructureBannerBar | null {
  if (typeof document === 'undefined') return null;
  try {
    return InfrastructureBannerBar.ensure();
  } catch (error) {
    // eslint-disable-next-line no-console -- diagnostic for a banner mount failure
    console.warn('[grid-intelligence-loader] banner mount failed', error);
    return null;
  }
}

// ─── Per-source fetch + parse ─────────────────────────────────────────

async function fetchGrid(signal?: AbortSignal): Promise<GridSnapshot | null> {
  const data = await fetchJson('/api/infrastructure/grid', signal);
  if (!data || !Array.isArray((data as { rows?: unknown }).rows)) return null;
  const rows = (data as { rows: unknown[] }).rows.filter((r): r is { period: string; respondent: string; type: string; value: string | number | null } => {
    if (typeof r !== 'object' || r === null) return false;
    const x = r as Record<string, unknown>;
    return typeof x.period === 'string' && typeof x.respondent === 'string' && typeof x.type === 'string';
  });
  return buildGridSnapshot(rows, Date.now());
}

export function fetchOutages(): Promise<OutageSummary> {
  latestOutageSummary = ageOutageSummary(latestOutageSummary, Date.now());
  return Promise.resolve(latestOutageSummary);
}

export function parseBgpResponse(data: unknown, now: number): BgpSummary {
  if (!isRecord(data)) {
    return buildBgpSummary([], now, {
      coverage: 'unknown', error: 'Cloudflare Radar did not return a usable response.',
      retrievedAt: null, droppedRows: 0,
    });
  }
  if (data.keyMissing === true) {
    return buildBgpSummary([], now, {
      coverage: 'unknown', error: bgpErrorMessage('missing_key'),
      retrievedAt: safeProviderFetchedAt(data.fetchedAt, now), droppedRows: 0,
    });
  }
  const fetchedAt = safeProviderFetchedAt(data.fetchedAt, now);
  const acceptedRows = safeProviderCount(data.acceptedRows);
  const droppedRows = safeProviderCount(data.droppedRows);
  if (data.schemaVersion !== 1 || data.provider !== 'cloudflare-radar'
    || fetchedAt === null || acceptedRows === null || droppedRows === null
    || !Array.isArray(data.events)) {
    return buildBgpSummary([], now, {
      coverage: 'unknown', error: bgpErrorMessage(data.error), retrievedAt: fetchedAt, droppedRows: 0,
    });
  }
  if (data.coverage !== 'reported') {
    return buildBgpSummary([], now, {
      coverage: 'unknown', error: bgpErrorMessage(data.error), retrievedAt: fetchedAt, droppedRows,
    });
  }
  if (data.error !== null || acceptedRows !== data.events.length
    || (acceptedRows === 0 && droppedRows > 0)) {
    return buildBgpSummary([], now, {
      coverage: 'unknown', error: bgpErrorMessage('malformed_response'),
      retrievedAt: fetchedAt, droppedRows: droppedRows + data.events.length,
    });
  }
  return buildBgpSummary(data.events as Parameters<typeof buildBgpSummary>[0], now, {
    coverage: 'reported', error: null, retrievedAt: fetchedAt, droppedRows,
  });
}

export function parseRadiationResponse(data: unknown, now: number): RadSummary {
  if (!isRecord(data)) {
    return buildRadSummary([], now, {
      coverage: 'unknown', error: 'EPA RadNet did not return a usable response.',
      retrievedAt: null, droppedRows: 0,
    });
  }
  const fetchedAt = safeProviderFetchedAt(data.fetchedAt, now);
  const acceptedRows = safeProviderCount(data.acceptedRows);
  const droppedRows = safeProviderCount(data.droppedRows);
  if (data.schemaVersion !== 1 || data.provider !== 'epa-radnet'
    || fetchedAt === null || acceptedRows === null || droppedRows === null
    || !Array.isArray(data.stations)) {
    return buildRadSummary([], now, {
      coverage: 'unknown', error: radiationErrorMessage(data.error), retrievedAt: fetchedAt, droppedRows: 0,
    });
  }
  if (data.coverage !== 'reported') {
    return buildRadSummary([], now, {
      coverage: 'unknown', error: radiationErrorMessage(data.error), retrievedAt: fetchedAt, droppedRows,
    });
  }
  if (data.error !== null || acceptedRows !== data.stations.length
    || (acceptedRows === 0 && droppedRows > 0)) {
    return buildRadSummary([], now, {
      coverage: 'unknown', error: radiationErrorMessage('malformed_response'),
      retrievedAt: fetchedAt, droppedRows: droppedRows + data.stations.length,
    });
  }
  return buildRadSummary(data.stations as Parameters<typeof buildRadSummary>[0], now, {
    coverage: 'reported', error: null, retrievedAt: fetchedAt, droppedRows,
  });
}

async function fetchBgp(signal?: AbortSignal): Promise<BgpSummary> {
  const now = Date.now();
  const data = await fetchJson('/api/infrastructure/bgp', signal, true);
  return parseBgpResponse(data, now);
}

export async function fetchRadiation(signal?: AbortSignal): Promise<RadSummary> {
  const now = Date.now();
  const data = await fetchJson('/api/infrastructure/radiation', signal, true);
  return parseRadiationResponse(data, now);
}

async function fetchJson(
  path: string,
  externalSignal?: AbortSignal,
  includeErrorBody = false,
): Promise<unknown> {
  try {
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) return null;
    externalSignal?.addEventListener('abort', forwardAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const url = `${getApiBaseUrl()}${path}`;
      const r = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!r.ok && !includeErrorBody) return null;
      return await r.json() as unknown;
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', forwardAbort);
    }
  } catch {
    return null;
  }
}
