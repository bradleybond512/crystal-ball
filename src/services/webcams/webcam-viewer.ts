import type { WebcamFeed, WebcamSource } from './webcam-types';

/** Human-facing source labels, shared by the panel and the globe viewer. */
export const WEBCAM_SOURCE_LABELS: Record<WebcamSource, string> = {
  FAA: 'FAA',
  DOT511: 'Traffic',
  USGS_VOLCANO: 'Volcano',
  NPS: 'Parks',
  ALERTWILDFIRE: 'Fire',
  WINDY: 'Windy',
  USFS: 'USFS',
  USGS_STREAM: 'Stream',
  NOAA_COASTAL: 'Coastal',
  CALTRANS: 'Caltrans',
  TFL: 'TfL',
  SINGAPORE: 'Singapore',
  GEONET: 'GeoNet',
  HAZECAM: 'Visibility',
};

export function webcamSourceLabel(source: WebcamSource): string {
  return WEBCAM_SOURCE_LABELS[source] ?? source;
}

/**
 * Shared webcam snapshot viewer.
 *
 * Crystal Ball's cameras are almost all *static snapshots* refreshed every few
 * minutes, not live video. This viewer is deliberately honest about that: it
 * shows the current frame, a plain-language "Updates every N min" cadence, a
 * live "Updated …" stamp that ticks each time a frame actually loads, and a
 * manual Refresh button — so a user never sits waiting for a still image to
 * "play". It is used both inside the Webcams panel and as the click-through
 * viewer on the God's Vision globe (where the panel is not visible).
 */

/** Human cadence, e.g. "Updates every 45 s" / "Updates every 10 min". */
export function formatRefreshCadence(refreshIntervalSec: number): string {
  const s = Math.max(1, Math.round(refreshIntervalSec));
  if (s < 90) return `Updates every ${s} s`;
  const min = Math.round(s / 60);
  return `Updates every ${min} min`;
}

/** "Updated just now" / "Updated 3 min ago" / "Updated 2 h ago". */
export function formatDataAsOf(loadedAtMs: number | null, nowMs: number): string {
  if (loadedAtMs == null) return 'Loading…';
  const diff = Math.max(0, nowMs - loadedAtMs);
  if (diff < 45_000) return 'Updated just now';
  const min = Math.round(diff / 60_000);
  if (min < 60) return `Updated ${min} min ago`;
  const hr = Math.round(min / 60);
  return `Updated ${hr} h ago`;
}

/** Source attribution string from feed metadata, or null when none is set. */
export function webcamAttribution(feed: WebcamFeed): string | null {
  const a = feed.metadata?.attribution;
  return typeof a === 'string' && a.trim().length > 0 ? a.trim() : null;
}

/** A snapshot URL is directly viewable as an <img> only when it's an http(s)
 *  URL that isn't one of our JSON resolver endpoints (which return metadata,
 *  not image bytes). */
export function isDirectlyViewable(snapshotUrl: string): boolean {
  return /^https?:\/\//i.test(snapshotUrl) && !snapshotUrl.includes('/api/');
}

export interface WebcamViewerModel {
  title: string;
  snapshotUrl: string;
  viewable: boolean;
  cadenceLabel: string;
  attribution: string | null;
  sourceLabel: string;
  category: string;
  coords: string;
  /** External source page for feeds whose snapshot isn't directly loadable. */
  pageUrl: string | null;
}

/** Pure view-model for a feed — the strings/urls the viewer renders. */
export function computeViewerModel(feed: WebcamFeed, sourceLabel: string = webcamSourceLabel(feed.source)): WebcamViewerModel {
  const pageUrl = typeof feed.metadata?.pageUrl === 'string' && /^https:\/\//i.test(feed.metadata.pageUrl)
    ? feed.metadata.pageUrl
    : null;
  return {
    title: feed.name,
    snapshotUrl: feed.snapshotUrl,
    viewable: isDirectlyViewable(feed.snapshotUrl),
    cadenceLabel: formatRefreshCadence(feed.refreshIntervalSec),
    attribution: webcamAttribution(feed),
    sourceLabel,
    category: feed.category,
    coords: `${feed.lat.toFixed(4)}, ${feed.lon.toFixed(4)}`,
    pageUrl,
  };
}

/** Append a cache-busting param so the browser refetches the snapshot. */
export function cacheBustedUrl(url: string, tick: number): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}_cb=${tick}`;
}

export interface SnapshotViewerHandle {
  el: HTMLElement;
  destroy: () => void;
}

export interface SnapshotViewerOptions {
  onClose?: () => void;
  sourceLabel?: string;
  /** Open an external URL (injected so callers use their safe-open path). */
  openExternal?: (url: string) => void;
  /** Minimum auto-refresh interval in ms (guards against hammering). */
  minRefreshMs?: number;
  /** Resolve a JSON-resolver snapshot URL (e.g. FAA /api/) to a direct image
   *  URL. Injected so this module stays decoupled from frame-resolver. */
  resolveFrame?: (snapshotUrl: string) => Promise<string | null | undefined>;
}

// Monotonic cache-bust seed shared across all cards, so reopening the same
// camera never reuses a previously-cached `?_cb=` frame (would show stale).
let cardBustSeed = 0;
function nextBust(): number {
  cardBustSeed += 1;
  return Date.now() + cardBustSeed;
}

/**
 * Build a self-contained snapshot viewer card with an auto-refreshing image,
 * a live "Updated …" stamp, an honest cadence line, a manual Refresh button and
 * a close button. Returns the element plus a `destroy()` that stops the timer.
 */
export function buildSnapshotViewerCard(feed: WebcamFeed, opts: SnapshotViewerOptions = {}): SnapshotViewerHandle {
  const model = computeViewerModel(feed, opts.sourceLabel ?? webcamSourceLabel(feed.source));
  const periodMs = Math.max(opts.minRefreshMs ?? 30_000, (feed.refreshIntervalSec || 600) * 1000);

  const card = document.createElement('div');
  card.className = 'webcam-snapshot-viewer';

  const header = document.createElement('div');
  header.className = 'webcam-snapshot-viewer__header';
  const title = document.createElement('strong');
  title.textContent = model.title;
  header.append(title);
  const close = document.createElement('button');
  close.className = 'webcam-snapshot-viewer__close';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '✕';
  header.append(close);
  card.append(header);

  let loadedAt: number | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let fellBack = false;

  const asOf = document.createElement('div');
  asOf.className = 'webcam-snapshot-viewer__asof';

  const refreshAsOf = (): void => {
    asOf.textContent = formatDataAsOf(loadedAt, Date.now());
  };

  const showLinkOutFallback = (message: string): void => {
    if (fellBack) return;
    fellBack = true;
    if (timer) { clearInterval(timer); timer = null; }
    const note = document.createElement('div');
    note.className = 'webcam-snapshot-viewer__note';
    note.textContent = message;
    card.append(note);
    if (model.pageUrl && opts.openExternal) {
      const openBtn = document.createElement('button');
      openBtn.textContent = 'Open camera page ↗';
      const url = model.pageUrl;
      openBtn.addEventListener('click', () => opts.openExternal?.(url));
      card.append(openBtn);
    }
  };

  // A /api/ resolver feed (e.g. FAA) can still show an image if the caller
  // injects a resolver; otherwise it degrades to a link-out.
  const needsResolve = !model.viewable && typeof opts.resolveFrame === 'function';

  if (model.viewable || needsResolve) {
    const img = document.createElement('img');
    img.className = 'webcam-snapshot-viewer__img';
    img.alt = model.title;
    img.style.maxWidth = '100%';
    img.addEventListener('load', () => { loadedAt = Date.now(); refreshAsOf(); });
    // A dead frame must not sit on "Loading…" forever. Say so, offer the
    // source page, and keep the auto-refresh timer running so a transient
    // outage recovers on its own.
    img.addEventListener('error', () => {
      asOf.textContent = loadedAt === null
        ? '⚠️ No image — camera may be offline (retrying automatically)'
        : `⚠️ Latest frame failed — ${formatDataAsOf(loadedAt, Date.now())} (retrying)`;
      if (loadedAt === null && model.pageUrl && opts.openExternal && !fellBack) {
        fellBack = true;
        const openBtn = document.createElement('button');
        openBtn.textContent = 'Open camera page ↗';
        const url = model.pageUrl;
        openBtn.addEventListener('click', () => opts.openExternal?.(url));
        card.append(openBtn);
      }
    });
    card.append(img);

    const loadFrame = async (): Promise<void> => {
      let base = model.snapshotUrl;
      if (needsResolve) {
        const resolved = await opts.resolveFrame?.(model.snapshotUrl);
        if (!resolved || !isDirectlyViewable(resolved)) {
          if (loadedAt === null) { img.remove(); showLinkOutFallback('Live snapshot is temporarily unavailable.'); }
          return;
        }
        base = resolved;
      }
      img.src = cacheBustedUrl(base, nextBust());
    };
    void loadFrame();
    // Auto-refresh on the feed's cadence; the "as of" text also self-updates.
    timer = setInterval(() => { void loadFrame(); }, periodMs);

    const controls = document.createElement('div');
    controls.className = 'webcam-snapshot-viewer__controls';
    const refreshBtn = document.createElement('button');
    refreshBtn.textContent = '🔄 Refresh';
    refreshBtn.addEventListener('click', () => { void loadFrame(); });
    controls.append(refreshBtn);
    card.append(controls);
  } else {
    showLinkOutFallback('Live snapshot opens on the source site.');
  }

  const cadence = document.createElement('div');
  cadence.className = 'webcam-snapshot-viewer__cadence';
  cadence.textContent = `📷 Static snapshot · ${model.cadenceLabel}`;
  card.append(cadence);
  refreshAsOf();
  card.append(asOf);

  const metaLines: string[] = [`${model.sourceLabel} · ${model.category}`, model.coords];
  if (model.attribution) metaLines.push(model.attribution);
  const meta = document.createElement('div');
  meta.className = 'webcam-snapshot-viewer__meta';
  for (const line of metaLines) {
    const row = document.createElement('div');
    row.textContent = line;
    meta.append(row);
  }
  card.append(meta);

  const destroy = (): void => {
    if (timer) { clearInterval(timer); timer = null; }
  };
  close.addEventListener('click', () => { destroy(); opts.onClose?.(); });

  return { el: card, destroy };
}
