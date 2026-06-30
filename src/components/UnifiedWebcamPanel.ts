/* eslint-disable sonarjs/no-async-constructor */
import { Panel } from './Panel';
import { fetchUnifiedWebcams, getFavoriteIds, toggleFavorite } from '@/services/webcams/fetcher';
import { isPinned, togglePin } from '@/services/webcams/pinned-store';
import {
  CATEGORY_MARKER_COLOR,
  OFFLINE_PROBE_TIMEOUT_MS,
  OFFLINE_REPROBE_INTERVAL_MS,
  buildSnapshotFilename,
  computeBoundsForFeeds,
  decideOfflineStatus,
  projectEquirectangular,
  type OfflineStatus,
} from '@/services/webcams/panel-extras';
import { runSmokeDetection, type SmokeAnalysis } from '@/services/webcams/smoke-detector';
import { healthSummary } from '@/services/webcams/health-view';
import { nextProbeDelay } from '@/services/webcams/probe-backoff';
import type { WebcamCategory, WebcamFeed, WebcamSource, WebcamSourceHealth } from '@/services/webcams/webcam-types';

const SMOKE_DETECT_INTERVAL_MS = 10 * 60 * 1000;

type ViewMode = 'grid' | 'list' | 'map';

const SOURCE_LABELS: Record<WebcamSource, string> = {
  FAA: 'FAA',
  DOT511: 'Traffic',
  USGS_VOLCANO: 'Volcano',
  NPS: 'Parks',
  ALERTWILDFIRE: 'Fire',
  WINDY: 'Windy',
  USFS: 'USFS',
  USGS_STREAM: 'Stream',
  NOAA_COASTAL: 'Coastal',
};

const CATEGORY_COLORS: Record<WebcamCategory, string> = {
  fire: '#f85149',
  volcano: '#bc8cff',
  weather: '#58a6ff',
  coastal: '#3fb950',
  stream: '#56d4dd',
  traffic: '#d29922',
  nature: '#7ee787',
};

export class UnifiedWebcamPanel extends Panel {
  private feeds: WebcamFeed[] = [];
  private sourceHealth: WebcamSourceHealth[] | undefined;
  private viewMode: ViewMode = 'grid';
  private sourceFilter: WebcamSource | 'ALL' | 'FAVORITES' = 'ALL';
  private categoryFilter: WebcamCategory | 'ALL' = 'ALL';
  private searchQuery = '';
  private selectedFeed: WebcamFeed | null = null;
  private favorites = new Set<string>(getFavoriteIds());
  private loading = false;
  private lastError: string | null = null;
  private offlineStatus = new Map<string, { status: OfflineStatus; checkedAt: number }>();
  private probeTimer: ReturnType<typeof setTimeout> | null = null;
  private probeFailRounds = 0;
  private smokeDetectTimer: ReturnType<typeof setInterval> | null = null;
  private smokeStatus = new Map<string, { analysis: SmokeAnalysis; ranAt: number }>();
  private smokeDetectEnabled = true;
  private toastEl: HTMLElement | null = null;

  constructor() {
    super({ id: 'unified-webcams', title: 'Webcams', className: 'panel-wide' });
    void this.load();
    window.addEventListener('webcam:select', this.handleGlobeSelect as EventListener);
    this.scheduleNextProbe();
    this.smokeDetectTimer = setInterval(() => {
      void this.runSmokeDetectForFireCams();
    }, SMOKE_DETECT_INTERVAL_MS);
  }

  public destroy(): void {
    if (this.probeTimer != null) {
      clearTimeout(this.probeTimer);
      this.probeTimer = null;
    }
    if (this.smokeDetectTimer != null) {
      clearInterval(this.smokeDetectTimer);
      this.smokeDetectTimer = null;
    }
    window.removeEventListener('webcam:select', this.handleGlobeSelect as EventListener);
    super.destroy();
  }

  private handleGlobeSelect = (e: Event): void => {
    const detail = (e as CustomEvent<{ feedId?: string; feed?: WebcamFeed }>).detail;
    if (!detail) return;
    if (detail.feed) {
      this.selectedFeed = detail.feed;
      this.render();
    } else if (detail.feedId) {
      const found = this.feeds.find((f) => f.id === detail.feedId);
      if (found) {
        this.selectedFeed = found;
        this.render();
      }
    }
  };

  private async load(): Promise<void> {
    this.loading = true;
    this.lastError = null;
    this.render();
    try {
      const catalog = await fetchUnifiedWebcams();
      this.feeds = catalog.feeds;
      this.sourceHealth = catalog.sourceHealth;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      this.loading = false;
      this.render();
    }
    void this.probeVisibleFeeds();
  }

  public refresh(): void {
    void this.load();
  }

  private get displayed(): WebcamFeed[] {
    let list = this.feeds;
    if (this.sourceFilter === 'FAVORITES') {
      list = list.filter((f) => this.favorites.has(f.id));
    } else if (this.sourceFilter !== 'ALL') {
      list = list.filter((f) => f.source === this.sourceFilter);
    }
    if (this.categoryFilter !== 'ALL') {
      list = list.filter((f) => f.category === this.categoryFilter);
    }
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      list = list.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          Object.values(f.metadata).some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    return list;
  }

  private render(): void {
    const el = this.getContentElement();
    while (el.firstChild) el.firstChild.remove();
    el.className = 'panel-content unified-webcams-content';

    el.append(this.buildToolbar());
    el.append(this.buildSourceChips());
    el.append(this.buildCategoryChips());
    const strip = this.buildHealthStrip();
    if (strip) el.append(strip);

    if (this.loading) {
      const loading = document.createElement('p');
      loading.className = 'webcam-loading';
      loading.textContent = 'Loading webcams…';
      el.append(loading);
      return;
    }

    if (this.lastError) {
      const err = document.createElement('p');
      err.className = 'webcam-error';
      err.style.color = '#f85149';
      err.textContent = `Error: ${this.lastError}`;
      el.append(err);
      return;
    }

    if (this.selectedFeed) el.append(this.buildViewer(this.selectedFeed));

    const list = this.displayed;
    if (list.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'webcam-empty';
      empty.textContent = this.feeds.length === 0
        ? 'No webcams loaded.'
        : 'No webcams match the current filter.';
      el.append(empty);
      return;
    }

    if (this.viewMode === 'grid') el.append(this.buildGrid(list));
    else if (this.viewMode === 'list') el.append(this.buildList(list));
    else el.append(this.buildMap(list));
  }

  private buildHealthStrip(): HTMLElement | null {
    if (!this.sourceHealth?.length) return null;
    const summary = healthSummary(this.sourceHealth);
    const wrap = document.createElement('div');
    wrap.className = 'webcams-health-strip';
    wrap.style.padding = '4px 8px';
    wrap.style.fontSize = '11px';

    const statusLine = document.createElement('div');
    statusLine.style.opacity = '0.7';
    const okText = document.createTextNode(`${summary.ok} source${summary.ok === 1 ? '' : 's'} live`);
    statusLine.append(okText);

    if (summary.degraded.length > 0) {
      const degradedSpan = document.createElement('span');
      degradedSpan.style.color = '#f85149';
      degradedSpan.style.marginLeft = '8px';
      const parts = summary.degraded.map(d => `${d.source} (${d.status})`).join(', ');
      degradedSpan.append(document.createTextNode(`— ${parts}`));
      statusLine.append(degradedSpan);
    }

    wrap.append(statusLine);

    for (const msg of summary.cta) {
      const banner = document.createElement('div');
      banner.style.background = 'rgba(210, 153, 34, 0.15)';
      banner.style.border = '1px solid #d29922';
      banner.style.borderRadius = '3px';
      banner.style.padding = '3px 8px';
      banner.style.marginTop = '3px';
      banner.style.color = '#d29922';
      banner.append(document.createTextNode(msg));
      wrap.append(banner);
    }

    return wrap;
  }

  private buildToolbar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'webcams-toolbar';
    bar.style.display = 'flex';
    bar.style.gap = '8px';
    bar.style.alignItems = 'center';
    bar.style.flexWrap = 'wrap';
    bar.style.padding = '8px';

    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Search…';
    search.value = this.searchQuery;
    search.style.flex = '1';
    search.style.minWidth = '120px';
    search.addEventListener('input', () => {
      this.searchQuery = search.value;
      this.render();
    });
    bar.append(search);

    const viewWrap = document.createElement('div');
    viewWrap.className = 'webcams-view-toggle';
    for (const mode of ['grid', 'list', 'map'] as ViewMode[]) {
      const b = document.createElement('button');
      let label: string;
      if (mode === 'grid') label = '▦ Grid';
      else if (mode === 'list') label = '☰ List';
      else label = '🗺 Map';
      b.textContent = label;
      b.style.background = this.viewMode === mode ? '#1f6feb' : 'transparent';
      b.style.color = this.viewMode === mode ? '#fff' : 'inherit';
      b.style.border = '1px solid #444';
      b.style.padding = '4px 8px';
      b.style.borderRadius = '3px';
      b.style.cursor = 'pointer';
      b.addEventListener('click', () => {
        this.viewMode = mode;
        this.render();
      });
      viewWrap.append(b);
    }
    bar.append(viewWrap);

    const count = document.createElement('span');
    count.className = 'webcams-count';
    count.style.opacity = '0.7';
    count.style.fontSize = '12px';
    count.textContent = `${this.displayed.length} of ${this.feeds.length} cams`;
    bar.append(count);

    const smokeToggle = document.createElement('label');
    smokeToggle.style.fontSize = '11px';
    smokeToggle.style.opacity = '0.8';
    smokeToggle.style.cursor = 'pointer';
    smokeToggle.style.display = 'inline-flex';
    smokeToggle.style.alignItems = 'center';
    smokeToggle.style.gap = '4px';
    const smokeCheckbox = document.createElement('input');
    smokeCheckbox.type = 'checkbox';
    smokeCheckbox.checked = this.smokeDetectEnabled;
    smokeCheckbox.addEventListener('change', () => {
      this.smokeDetectEnabled = smokeCheckbox.checked;
      if (this.smokeDetectEnabled) void this.runSmokeDetectForFireCams();
      else this.smokeStatus.clear();
      this.render();
    });
    smokeToggle.append(smokeCheckbox);
    smokeToggle.append(document.createTextNode('Smoke Detection'));
    bar.append(smokeToggle);

    return bar;
  }

  private buildSourceChips(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'webcams-chips webcams-source-chips';
    wrap.style.display = 'flex';
    wrap.style.gap = '6px';
    wrap.style.flexWrap = 'wrap';
    wrap.style.padding = '4px 8px';
    const options: (WebcamSource | 'ALL' | 'FAVORITES')[] = [
      'ALL',
      'FAVORITES',
      'FAA',
      'DOT511',
      'ALERTWILDFIRE',
      'USGS_VOLCANO',
      'NPS',
      'NOAA_COASTAL',
      'USGS_STREAM',
      'WINDY',
    ];
    for (const opt of options) {
      const chip = document.createElement('button');
      let label: string;
      if (opt === 'ALL') {
        label = `All (${this.feeds.length})`;
      } else if (opt === 'FAVORITES') {
        label = `★ Favorites (${this.favorites.size})`;
      } else {
        const sourceCount = this.feeds.filter((f) => f.source === opt).length;
        label = `${SOURCE_LABELS[opt]} (${sourceCount})`;
      }
      chip.textContent = label;
      chip.style.fontSize = '11px';
      chip.style.padding = '3px 8px';
      chip.style.border = '1px solid #444';
      chip.style.borderRadius = '12px';
      chip.style.cursor = 'pointer';
      chip.style.background = this.sourceFilter === opt ? '#1f6feb' : 'transparent';
      chip.style.color = this.sourceFilter === opt ? '#fff' : 'inherit';
      chip.addEventListener('click', () => {
        this.sourceFilter = opt;
        this.render();
      });
      wrap.append(chip);
    }
    return wrap;
  }

  private buildCategoryChips(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'webcams-chips webcams-category-chips';
    wrap.style.display = 'flex';
    wrap.style.gap = '6px';
    wrap.style.flexWrap = 'wrap';
    wrap.style.padding = '4px 8px';
    const cats: (WebcamCategory | 'ALL')[] = ['ALL', 'fire', 'volcano', 'weather', 'coastal', 'stream', 'traffic', 'nature'];
    for (const c of cats) {
      const chip = document.createElement('button');
      chip.textContent = c === 'ALL' ? 'All categories' : c;
      chip.style.fontSize = '11px';
      chip.style.padding = '3px 8px';
      chip.style.border = '1px solid #444';
      chip.style.borderRadius = '12px';
      chip.style.cursor = 'pointer';
      chip.style.textTransform = 'capitalize';
      const active = this.categoryFilter === c;
      let bg = 'transparent';
      if (active && c !== 'ALL') bg = CATEGORY_COLORS[c as WebcamCategory];
      else if (active) bg = '#1f6feb';
      chip.style.background = bg;
      chip.style.color = active ? '#fff' : 'inherit';
      chip.addEventListener('click', () => {
        this.categoryFilter = c;
        this.render();
      });
      wrap.append(chip);
    }
    return wrap;
  }

  private buildGrid(feeds: WebcamFeed[]): HTMLElement {
    const grid = document.createElement('div');
    grid.className = 'webcams-grid';
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(220px, 1fr))';
    grid.style.gap = '8px';
    grid.style.padding = '8px';
    for (const f of feeds.slice(0, 200)) grid.append(this.buildCard(f));
    if (feeds.length > 200) {
      const more = document.createElement('p');
      more.style.gridColumn = '1 / -1';
      more.style.opacity = '0.6';
      more.style.fontSize = '12px';
      more.textContent = `+${feeds.length - 200} more (refine filter)`;
      grid.append(more);
    }
    return grid;
  }

  private buildCard(f: WebcamFeed): HTMLElement {
    const card = document.createElement('div');
    card.className = 'webcam-card';
    card.style.border = '1px solid #333';
    card.style.borderRadius = '4px';
    card.style.overflow = 'hidden';
    card.style.cursor = 'pointer';
    card.style.position = 'relative';

    const img = document.createElement('img');
    img.src = f.snapshotUrl;
    img.alt = f.name;
    img.loading = 'lazy';
    img.style.width = '100%';
    img.style.aspectRatio = '16 / 9';
    img.style.objectFit = 'cover';
    img.style.background = '#111';
    img.addEventListener('error', () => {
      img.style.opacity = '0.3';
      img.style.background = '#222';
    });

    const star = document.createElement('button');
    star.textContent = this.favorites.has(f.id) ? '★' : '☆';
    star.style.position = 'absolute';
    star.style.top = '4px';
    star.style.right = '4px';
    star.style.background = 'rgba(0,0,0,0.6)';
    star.style.color = this.favorites.has(f.id) ? '#f7c948' : '#ccc';
    star.style.border = 'none';
    star.style.borderRadius = '50%';
    star.style.width = '24px';
    star.style.height = '24px';
    star.style.cursor = 'pointer';
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      const isFav = toggleFavorite(f.id);
      if (isFav) this.favorites.add(f.id);
      else this.favorites.delete(f.id);
      this.render();
    });

    const pin = document.createElement('button');
    pin.textContent = '📌';
    pin.title = isPinned(f.id) ? 'Unpin' : 'Pin to Pinned Webcams';
    pin.style.position = 'absolute';
    pin.style.top = '4px';
    pin.style.right = '32px';
    pin.style.background = 'rgba(0,0,0,0.6)';
    pin.style.border = 'none';
    pin.style.borderRadius = '50%';
    pin.style.width = '24px';
    pin.style.height = '24px';
    pin.style.cursor = 'pointer';
    pin.style.opacity = isPinned(f.id) ? '1' : '0.45';
    pin.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePin(f.id);
      this.render();
    });

    const info = document.createElement('div');
    info.style.padding = '6px 8px';
    info.style.fontSize = '12px';

    const name = document.createElement('div');
    name.textContent = f.name;
    name.style.fontWeight = '600';
    name.style.marginBottom = '2px';
    name.style.overflow = 'hidden';
    name.style.textOverflow = 'ellipsis';
    name.style.whiteSpace = 'nowrap';
    info.append(name);

    const meta = document.createElement('div');
    meta.style.opacity = '0.7';
    meta.style.fontSize = '10px';
    meta.style.display = 'flex';
    meta.style.gap = '4px';
    meta.style.alignItems = 'center';

    const sourceBadge = document.createElement('span');
    sourceBadge.textContent = SOURCE_LABELS[f.source];
    sourceBadge.style.background = CATEGORY_COLORS[f.category];
    sourceBadge.style.color = '#fff';
    sourceBadge.style.padding = '1px 5px';
    sourceBadge.style.borderRadius = '3px';
    meta.append(sourceBadge);

    if (f.metadata.state) {
      const state = document.createElement('span');
      state.textContent = f.metadata.state;
      meta.append(state);
    }

    info.append(meta);

    const offline = this.offlineStatus.get(f.id);
    if (offline?.status === 'offline') {
      const overlay = document.createElement('div');
      overlay.textContent = '⚠ Offline';
      overlay.style.position = 'absolute';
      overlay.style.inset = '0';
      overlay.style.display = 'flex';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.background = 'rgba(0,0,0,0.55)';
      overlay.style.color = '#f85149';
      overlay.style.fontWeight = '600';
      overlay.style.fontSize = '13px';
      overlay.style.pointerEvents = 'none';
      card.append(overlay);
    }

    const smoke = this.smokeStatus.get(f.id);
    if (smoke?.analysis.isAlert) {
      const badge = document.createElement('div');
      badge.textContent = '🔥 Motion Detected';
      badge.title = `Smoke prob ${(smoke.analysis.smokeProbability * 100).toFixed(0)}%`;
      badge.style.position = 'absolute';
      badge.style.top = '4px';
      badge.style.left = '4px';
      badge.style.background = 'rgba(248, 81, 73, 0.92)';
      badge.style.color = '#fff';
      badge.style.padding = '2px 6px';
      badge.style.borderRadius = '3px';
      badge.style.fontSize = '10px';
      badge.style.fontWeight = '600';
      badge.style.cursor = 'pointer';
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectedFeed = f;
        this.render();
      });
      card.append(badge);
    }

    card.append(img);
    card.append(star);
    card.append(pin);
    card.append(info);

    card.addEventListener('click', () => {
      this.selectedFeed = this.selectedFeed?.id === f.id ? null : f;
      this.render();
    });

    return card;
  }

  private buildList(feeds: WebcamFeed[]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.padding = '8px';
    const table = document.createElement('table');
    table.className = 'webcams-list-table eq-table';
    table.style.width = '100%';
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    for (const col of ['', 'Name', 'Source', 'Category', 'Location']) {
      const th = document.createElement('th');
      th.textContent = col;
      tr.append(th);
    }
    thead.append(tr);
    table.append(thead);
    const tbody = document.createElement('tbody');
    for (const f of feeds.slice(0, 500)) {
      const row = document.createElement('tr');
      row.style.cursor = 'pointer';

      const tdStar = document.createElement('td');
      const star = document.createElement('span');
      star.textContent = this.favorites.has(f.id) ? '★' : '☆';
      star.style.color = this.favorites.has(f.id) ? '#f7c948' : '#888';
      star.style.cursor = 'pointer';
      star.addEventListener('click', (e) => {
        e.stopPropagation();
        const isFav = toggleFavorite(f.id);
        if (isFav) this.favorites.add(f.id);
        else this.favorites.delete(f.id);
        this.render();
      });
      tdStar.append(star);
      row.append(tdStar);

      const tdName = document.createElement('td');
      const offline = this.offlineStatus.get(f.id);
      const dot = document.createElement('span');
      dot.style.display = 'inline-block';
      dot.style.width = '8px';
      dot.style.height = '8px';
      dot.style.borderRadius = '50%';
      dot.style.marginRight = '6px';
      let dotColor: string;
      if (offline?.status === 'online') dotColor = '#3fb950';
      else if (offline?.status === 'offline') dotColor = '#f85149';
      else dotColor = '#888';
      dot.style.background = dotColor;
      dot.title = offline?.status ?? 'unknown';
      tdName.append(dot);
      tdName.append(document.createTextNode(f.name));
      row.append(tdName);

      const tdSource = document.createElement('td');
      const badge = document.createElement('span');
      badge.textContent = SOURCE_LABELS[f.source];
      badge.style.background = CATEGORY_COLORS[f.category];
      badge.style.color = '#fff';
      badge.style.padding = '1px 5px';
      badge.style.borderRadius = '3px';
      badge.style.fontSize = '10px';
      tdSource.append(badge);
      row.append(tdSource);

      const tdCat = document.createElement('td');
      tdCat.textContent = f.category;
      tdCat.style.textTransform = 'capitalize';
      row.append(tdCat);

      const tdLoc = document.createElement('td');
      tdLoc.textContent =
        f.metadata.state ?? f.metadata.region ?? f.metadata.country ?? `${f.lat.toFixed(2)},${f.lon.toFixed(2)}`;
      row.append(tdLoc);

      row.addEventListener('click', () => {
        this.selectedFeed = this.selectedFeed?.id === f.id ? null : f;
        this.render();
      });
      tbody.append(row);
    }
    table.append(tbody);
    wrap.append(table);
    return wrap;
  }

  private buildViewer(f: WebcamFeed): HTMLElement {
    const div = document.createElement('div');
    div.className = 'webcam-viewer';
    div.style.border = '2px solid #1f6feb';
    div.style.borderRadius = '4px';
    div.style.margin = '8px';
    div.style.padding = '8px';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = '8px';

    const title = document.createElement('strong');
    title.textContent = f.name;
    header.append(title);

    const close = document.createElement('button');
    close.textContent = '✕';
    close.style.background = 'transparent';
    close.style.border = 'none';
    close.style.color = 'inherit';
    close.style.fontSize = '16px';
    close.style.cursor = 'pointer';
    close.addEventListener('click', () => {
      this.selectedFeed = null;
      this.render();
    });
    header.append(close);
    div.append(header);

    const img = document.createElement('img');
    img.src = `${f.snapshotUrl}${f.snapshotUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
    img.alt = f.name;
    img.style.width = '100%';
    img.style.maxWidth = '900px';
    img.style.borderRadius = '4px';
    img.style.background = '#111';
    div.append(img);

    const meta = document.createElement('div');
    meta.style.fontSize = '12px';
    meta.style.marginTop = '8px';
    meta.style.opacity = '0.8';
    const lines: string[] = [
      `Source: ${SOURCE_LABELS[f.source]} · Category: ${f.category}`,
      `Coords: ${f.lat.toFixed(4)}, ${f.lon.toFixed(4)}`,
    ];
    for (const [k, v] of Object.entries(f.metadata)) lines.push(`${k}: ${v}`);
    if (f.streamUrl) lines.push(`Stream: ${f.streamUrl}`);
    for (const line of lines) {
      const p = document.createElement('div');
      p.textContent = line;
      meta.append(p);
    }
    div.append(meta);

    const snapBtn = document.createElement('button');
    snapBtn.textContent = '📷 Snapshot';
    snapBtn.style.marginTop = '8px';
    snapBtn.style.padding = '4px 10px';
    snapBtn.style.background = '#1f6feb';
    snapBtn.style.color = '#fff';
    snapBtn.style.border = 'none';
    snapBtn.style.borderRadius = '3px';
    snapBtn.style.cursor = 'pointer';
    snapBtn.addEventListener('click', () => {
      void this.saveSnapshot(f, img);
    });
    div.append(snapBtn);

    return div;
  }

  // ── Snapshot to Downloads ────────────────────────────────────────────

  private async saveSnapshot(f: WebcamFeed, img: HTMLImageElement): Promise<void> {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || 1280;
      canvas.height = img.naturalHeight || 720;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        this.showToast('Snapshot failed: canvas unavailable');
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.92),
      );
      if (!blob) {
        this.showToast('Snapshot failed: canvas blocked (CORS)');
        return;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = buildSnapshotFilename(f.name);
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      this.showToast('Saved to Downloads');
    } catch (error) {
      this.showToast(`Snapshot failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private showToast(msg: string): void {
    if (this.toastEl) this.toastEl.remove();
    const toast = document.createElement('div');
    toast.textContent = msg;
    toast.style.position = 'fixed';
    toast.style.bottom = '32px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)';
    toast.style.background = '#0a1929';
    toast.style.color = '#fff';
    toast.style.padding = '8px 16px';
    toast.style.borderRadius = '4px';
    toast.style.fontSize = '13px';
    toast.style.boxShadow = '0 2px 8px rgba(0,0,0,0.4)';
    toast.style.zIndex = '99999';
    toast.style.pointerEvents = 'none';
    document.body.append(toast);
    this.toastEl = toast;
    setTimeout(() => {
      if (this.toastEl === toast) {
        toast.remove();
        this.toastEl = null;
      }
    }, 2000);
  }

  // ── Map view (SVG, equirectangular) ──────────────────────────────────

  private buildMap(feeds: WebcamFeed[]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'webcams-map';
    wrap.style.padding = '8px';
    wrap.style.position = 'relative';

    const width = 760;
    const height = 360;
    const bounds = computeBoundsForFeeds(feeds);

    if (!bounds) {
      const empty = document.createElement('p');
      empty.textContent = 'No cams to plot.';
      wrap.append(empty);
      return wrap;
    }

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', String(height));
    svg.style.background = '#0a1929';
    svg.style.borderRadius = '4px';
    svg.style.border = '1px solid #1f3a5a';

    // Light grid for orientation.
    for (let i = 1; i < 4; i++) {
      const xLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      xLine.setAttribute('x1', String((width / 4) * i));
      xLine.setAttribute('y1', '0');
      xLine.setAttribute('x2', String((width / 4) * i));
      xLine.setAttribute('y2', String(height));
      xLine.setAttribute('stroke', '#1f3a5a');
      xLine.setAttribute('stroke-dasharray', '2 4');
      svg.append(xLine);
      const yLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      yLine.setAttribute('x1', '0');
      yLine.setAttribute('y1', String((height / 4) * i));
      yLine.setAttribute('x2', String(width));
      yLine.setAttribute('y2', String((height / 4) * i));
      yLine.setAttribute('stroke', '#1f3a5a');
      yLine.setAttribute('stroke-dasharray', '2 4');
      svg.append(yLine);
    }

    const vp = { width, height, bounds, paddingPx: 16 };
    for (const f of feeds.slice(0, 800)) {
      const { x, y } = projectEquirectangular(f.lat, f.lon, vp);
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', String(x));
      circle.setAttribute('cy', String(y));
      circle.setAttribute('r', '4');
      circle.setAttribute('fill', CATEGORY_MARKER_COLOR[f.category]);
      circle.setAttribute('fill-opacity', '0.85');
      circle.setAttribute('stroke', '#fff');
      circle.setAttribute('stroke-width', '0.5');
      circle.style.cursor = 'pointer';
      const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      titleEl.textContent = `${f.name} (${f.category})`;
      circle.append(titleEl);
      circle.addEventListener('click', () => {
        this.selectedFeed = f;
        this.render();
      });
      svg.append(circle);
    }

    wrap.append(svg);

    if (feeds.length > 800) {
      const more = document.createElement('p');
      more.style.opacity = '0.6';
      more.style.fontSize = '11px';
      more.textContent = `+${feeds.length - 800} more cams not plotted (refine filter)`;
      wrap.append(more);
    }

    const legend = document.createElement('div');
    legend.style.display = 'flex';
    legend.style.gap = '8px';
    legend.style.flexWrap = 'wrap';
    legend.style.marginTop = '6px';
    legend.style.fontSize = '11px';
    for (const [cat, color] of Object.entries(CATEGORY_MARKER_COLOR)) {
      const item = document.createElement('span');
      item.style.display = 'inline-flex';
      item.style.alignItems = 'center';
      item.style.gap = '3px';
      const dot = document.createElement('span');
      dot.style.display = 'inline-block';
      dot.style.width = '8px';
      dot.style.height = '8px';
      dot.style.borderRadius = '50%';
      dot.style.background = color;
      item.append(dot);
      const label = document.createElement('span');
      label.textContent = cat;
      label.style.textTransform = 'capitalize';
      label.style.opacity = '0.8';
      item.append(label);
      legend.append(item);
    }
    wrap.append(legend);

    return wrap;
  }

  // ── Smoke / motion detection (AlertWildfire) ────────────────────────

  private async runSmokeDetectForFireCams(): Promise<void> {
    if (!this.smokeDetectEnabled) return;
    const fireCams = this.displayed
      .filter((f) => f.source === 'ALERTWILDFIRE')
      .slice(0, 24); // viewport budget — heavy work, keep small
    if (fireCams.length === 0) return;
    let updated = false;
    for (const cam of fireCams) {
      const existing = this.smokeStatus.get(cam.id);
      if (existing && Date.now() - existing.ranAt < SMOKE_DETECT_INTERVAL_MS / 2) continue;
      try {
        const result = await runSmokeDetection(cam.id, cam.snapshotUrl);
        if (result.analysis) {
          this.smokeStatus.set(cam.id, { analysis: result.analysis, ranAt: result.ranAt });
          updated = true;
        }
      } catch {
        // canvas / CORS errors are expected for cross-origin streams; ignore.
      }
    }
    if (updated) this.render();
  }

  // ── Offline probing ──────────────────────────────────────────────────

  private scheduleNextProbe(): void {
    const delay = nextProbeDelay(
      this.probeFailRounds,
      OFFLINE_REPROBE_INTERVAL_MS,
      15 * 60 * 1000,
      // eslint-disable-next-line sonarjs/pseudo-random -- non-crypto jitter to de-sync probe storms
      Math.random(),
    );
    this.probeTimer = setTimeout(() => {
      void this.runProbeRound();
    }, delay);
  }

  private async runProbeRound(): Promise<void> {
    const offline = await this.probeVisibleFeeds();
    if (offline > 0) this.probeFailRounds += 1;
    else this.probeFailRounds = 0;
    this.scheduleNextProbe();
  }

  private async probeVisibleFeeds(): Promise<number> {
    if (this.viewMode === 'map') return 0; // map view doesn't need per-card status
    const list = this.displayed.slice(0, 60);
    const now = Date.now();
    const stale = list.filter((f) => {
      const cached = this.offlineStatus.get(f.id);
      return !cached || now - cached.checkedAt > OFFLINE_REPROBE_INTERVAL_MS;
    });
    if (stale.length === 0) return 0;
    const promises = stale.map(async (f) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), OFFLINE_PROBE_TIMEOUT_MS);
      try {
        const resp = await fetch(f.snapshotUrl, { method: 'HEAD', signal: ctrl.signal });
        const status = decideOfflineStatus({ responseStatus: resp.status });
        this.offlineStatus.set(f.id, { status, checkedAt: Date.now() });
      } catch (error) {
        const errorName = error instanceof Error ? error.name : 'Error';
        const status = decideOfflineStatus({ errorName, timedOut: errorName === 'AbortError' });
        this.offlineStatus.set(f.id, { status, checkedAt: Date.now() });
      } finally {
        clearTimeout(timer);
      }
    });
    await Promise.allSettled(promises);
    const offlineCount = stale.reduce(
      (n, f) => n + (this.offlineStatus.get(f.id)?.status === 'offline' ? 1 : 0),
      0,
    );
    this.render();
    return offlineCount;
  }
}
