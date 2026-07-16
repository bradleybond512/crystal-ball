import { Panel } from './Panel';
import { isDesktopRuntime, getApiBaseUrl } from '@/services/runtime';
import { escapeHtml } from '@/utils/sanitize';
import { t } from '../services/i18n';
import { trackWebcamSelected, trackWebcamRegionFiltered } from '@/services/analytics';
import { getStreamQuality, subscribeStreamQualityChange } from '@/services/ai-flow-settings';
import {
  YOUTUBE_LIVE_FEEDS,
  feedsForRegion,
  type YoutubeLiveFeed,
} from '@/services/webcams/youtube-live-registry';

type WebcamRegion = 'iran' | 'middle-east' | 'europe' | 'asia' | 'americas';

type WebcamFeed = YoutubeLiveFeed;

// Verified YouTube live stream IDs — validated Feb 2026 via title cross-check.
// IDs may rotate; update when stale.
const WEBCAM_FEEDS: WebcamFeed[] = YOUTUBE_LIVE_FEEDS;

const MAX_GRID_CELLS = 4;

type ViewMode = 'grid' | 'single' | 'map';
type RegionFilter = 'all' | WebcamRegion;

export class LiveWebcamsPanel extends Panel {
  private viewMode: ViewMode = 'grid';
  private regionFilter: RegionFilter = 'iran';
  private activeFeed: WebcamFeed = WEBCAM_FEEDS[0]!;
  private toolbar: HTMLElement | null = null;
  private iframes: HTMLIFrameElement[] = [];
  private observer: IntersectionObserver | null = null;
  private isVisible = false;
  private idleTimeout: ReturnType<typeof setTimeout> | null = null;
  private boundIdleResetHandler!: () => void;
  private boundVisibilityHandler!: () => void;
  private readonly IDLE_PAUSE_MS = 60 * 60 * 1000; // 60 minutes
  private isIdle = false;
  private _boundYtMsg!: (e: MessageEvent) => void;
  // Per-iframe "did it ever start playing?" watchdog. Live-stream IDs go stale
  // (the broadcast ends), and an ended stream shows YouTube's own "recording not
  // available" screen WITHOUT firing the IFrame API onError — so the only
  // reliable signal is: muted-autoplay never reached a playing state. If so, we
  // swap the dead player for a "Watch live on YouTube" fallback card.
  private _startWatchdogs = new Map<HTMLIFrameElement, ReturnType<typeof setTimeout>>();
  private readonly NO_START_MS = 9000;

  constructor() {
 super({ id: 'live-webcams', title: t('panels.liveWebcams'), className: 'panel-wide' });
 this.createToolbar();
 this.setupIntersectionObserver();
 this.setupIdleDetection();
 this._setupYtMessageListener();
 subscribeStreamQualityChange(() => this.render());
 this.render();
  }

  private get filteredFeeds(): WebcamFeed[] {
 return feedsForRegion(this.regionFilter);
  }

  private static readonly ALL_GRID_IDS = ['jerusalem', 'tehran', 'kyiv', 'washington'];

  private get gridFeeds(): WebcamFeed[] {
 if (this.regionFilter === 'all') {
 return LiveWebcamsPanel.ALL_GRID_IDS
 .map(id => WEBCAM_FEEDS.find(f => f.id === id)!)
 .filter(Boolean);
 }
 return this.filteredFeeds.slice(0, MAX_GRID_CELLS);
  }

  private createToolbar(): void {
 this.toolbar = document.createElement('div');
 this.toolbar.className = 'webcam-toolbar';

 const regionGroup = document.createElement('div');
 regionGroup.className = 'webcam-toolbar-group';

 const regions: { key: RegionFilter; label: string }[] = [
 { key: 'iran', label: t('components.webcams.regions.iran') },
 { key: 'all', label: t('components.webcams.regions.all') },
 { key: 'middle-east', label: t('components.webcams.regions.mideast') },
 { key: 'europe', label: t('components.webcams.regions.europe') },
 { key: 'americas', label: t('components.webcams.regions.americas') },
 { key: 'asia', label: t('components.webcams.regions.asia') },
 ];

 regions.forEach(({ key, label }) => {
 const btn = document.createElement('button');
 btn.className = `webcam-region-btn${key === this.regionFilter ? ' active' : ''}`;
 btn.dataset.region = key;
 btn.textContent = label;
 btn.addEventListener('click', () => this.setRegionFilter(key));
 regionGroup.append(btn);
 });

 const viewGroup = document.createElement('div');
 viewGroup.className = 'webcam-toolbar-group';

 const gridBtn = document.createElement('button');
 gridBtn.className = `webcam-view-btn${this.viewMode === 'grid' ? ' active' : ''}`;
 gridBtn.dataset.mode = 'grid';
 gridBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>';
 gridBtn.title = 'Grid view';
 gridBtn.setAttribute('aria-label', 'Grid view');
 gridBtn.addEventListener('click', () => this.setViewMode('grid'));

 const singleBtn = document.createElement('button');
 singleBtn.className = `webcam-view-btn${this.viewMode === 'single' ? ' active' : ''}`;
 singleBtn.dataset.mode = 'single';
 singleBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><rect x="3" y="3" width="18" height="14" rx="2"/><rect x="3" y="19" width="18" height="2" rx="1"/></svg>';
 singleBtn.title = 'Single view';
 singleBtn.setAttribute('aria-label', 'Single view');
 singleBtn.addEventListener('click', () => this.setViewMode('single'));

 const mapBtn = document.createElement('button');
 mapBtn.className = `webcam-view-btn${this.viewMode === 'map' ? ' active' : ''}`;
 mapBtn.dataset.mode = 'map';
 mapBtn.textContent = '📍';
 mapBtn.title = 'Map view — click a location to watch its live stream';
 mapBtn.setAttribute('aria-label', 'Map view');
 mapBtn.addEventListener('click', () => this.setViewMode('map'));

 viewGroup.append(gridBtn);
 viewGroup.append(singleBtn);
 viewGroup.append(mapBtn);

 this.toolbar.append(regionGroup);
 this.toolbar.append(viewGroup);
 this.element.insertBefore(this.toolbar, this.content);
  }

  private setRegionFilter(filter: RegionFilter): void {
 if (filter === this.regionFilter) return;
 trackWebcamRegionFiltered(filter);
 this.regionFilter = filter;
 this.toolbar?.querySelectorAll('.webcam-region-btn').forEach(btn => {
 (btn as HTMLElement).classList.toggle('active', (btn as HTMLElement).dataset.region === filter);
 });
 const feeds = this.filteredFeeds;
 if (feeds.length > 0 && !feeds.includes(this.activeFeed)) {
 this.activeFeed = feeds[0]!;
 }
 this.render();
  }

  private setViewMode(mode: ViewMode): void {
 if (mode === this.viewMode) return;
 this.viewMode = mode;
 this.toolbar?.querySelectorAll('.webcam-view-btn').forEach(btn => {
 (btn as HTMLElement).classList.toggle('active', (btn as HTMLElement).dataset.mode === mode);
 });
 this.render();
  }

  private buildEmbedUrl(videoId: string): string {
 const quality = getStreamQuality();
 if (isDesktopRuntime()) {
 // Use local sidecar embed — YouTube rejects tauri:// parent origin with error 153.
 // Must use getApiBaseUrl() (http://127.0.0.1:PORT) — the Tauri CSP frame-src only
 // allows http://127.0.0.1:* and WKWebView treats localhost as a distinct origin.
 const params = new URLSearchParams({ videoId, autoplay: '1', mute: '1' });
 if (quality !== 'auto') params.set('vq', quality);
 return `${getApiBaseUrl()}/api/youtube-embed?${params.toString()}`;
 }
 const vq = quality === 'auto' ? '' : `&vq=${quality}`;
 return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&controls=0&modestbranding=1&playsinline=1&rel=0${vq}`;
  }

  private createIframe(feed: WebcamFeed): HTMLIFrameElement {
 const iframe = document.createElement('iframe');
 iframe.className = 'webcam-iframe';
 iframe.src = this.buildEmbedUrl(feed.fallbackVideoId);
 iframe.title = `${feed.city} live webcam`;
 iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
 iframe.referrerPolicy = 'strict-origin-when-cross-origin';
 // Carry the source info so the offline fallback can link to the channel's
 // live page (its current stream) when this frozen video id is dead.
 iframe.dataset.city = feed.city;
 iframe.dataset.channelHandle = feed.channelHandle;
 if (!isDesktopRuntime()) {
 iframe.allowFullscreen = true;
 iframe.setAttribute('loading', 'lazy');
 iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
 }
 // If muted autoplay never reaches a playing state, the stream is offline.
 this._startWatchdogs.set(iframe, setTimeout(() => {
 this._startWatchdogs.delete(iframe);
 if (!iframe.isConnected) return;
 const cell = iframe.closest<HTMLElement>('.webcam-cell, .webcam-single');
 if (cell) this._showOfflineFallback(cell, iframe);
 }, this.NO_START_MS));
 return iframe;
  }

  private render(): void {
 this.destroyIframes();

 if (!this.isVisible || this.isIdle) {
 this.content.innerHTML = '<div class="webcam-placeholder">Webcams paused</div>';
 return;
 }

 if (this.viewMode === 'grid') {
 this.renderGrid();
 } else if (this.viewMode === 'map') {
 this.renderMap();
 } else {
 this.renderSingle();
 }
  }

  /** Map view: plot each live-video stream at its city on an equirectangular
   *  world map. Click a pin → play that stream in single view. This is the
   *  "click a spot and see video" surface. */
  private renderMap(): void {
 this.content.innerHTML = '';
 this.content.className = 'panel-content webcam-content';

 const feeds = this.filteredFeeds.filter((f) => f.lat !== 0 || f.lon !== 0);
 const wrap = document.createElement('div');
 wrap.className = 'webcam-map';

 const W = 760, H = 380;
 const SVG_NS = 'http://www.w3.org/2000/svg';
 const svg = document.createElementNS(SVG_NS, 'svg');
 svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
 svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
 // Explicit width + aspect-ratio — without a height an inline SVG defaults to
 // ~150px tall instead of scaling to the viewBox ratio.
 svg.style.width = '100%';
 svg.style.height = 'auto';
 svg.style.aspectRatio = `${W} / ${H}`;
 svg.style.maxHeight = '70vh';
 svg.style.display = 'block';
 svg.style.background = 'linear-gradient(180deg,#0b1a2b,#0a1420)';
 svg.style.borderRadius = '6px';

 // Graticule every 30° for orientation (no coastline data needed).
 for (let lon = -150; lon <= 150; lon += 30) {
 const x = ((lon + 180) / 360) * W;
 const line = document.createElementNS(SVG_NS, 'line');
 line.setAttribute('x1', String(x)); line.setAttribute('y1', '0');
 line.setAttribute('x2', String(x)); line.setAttribute('y2', String(H));
 line.setAttribute('stroke', 'rgba(255,255,255,0.06)'); line.setAttribute('stroke-width', '1');
 svg.append(line);
 }
 for (let lat = -60; lat <= 60; lat += 30) {
 const y = ((90 - lat) / 180) * H;
 const line = document.createElementNS(SVG_NS, 'line');
 line.setAttribute('x1', '0'); line.setAttribute('y1', String(y));
 line.setAttribute('x2', String(W)); line.setAttribute('y2', String(y));
 line.setAttribute('stroke', 'rgba(255,255,255,0.06)'); line.setAttribute('stroke-width', '1');
 svg.append(line);
 }

 for (const feed of feeds) {
 const x = ((feed.lon + 180) / 360) * W;
 const y = ((90 - feed.lat) / 180) * H;
 const g = document.createElementNS(SVG_NS, 'g');
 g.style.cursor = 'pointer';
 g.addEventListener('click', () => {
 trackWebcamSelected(feed.id, feed.city, 'map');
 this.activeFeed = feed;
 this.setViewMode('single');
 });

 const halo = document.createElementNS(SVG_NS, 'circle');
 halo.setAttribute('cx', String(x)); halo.setAttribute('cy', String(y));
 halo.setAttribute('r', '7'); halo.setAttribute('fill', 'rgba(255,59,48,0.25)');
 const dot = document.createElementNS(SVG_NS, 'circle');
 dot.setAttribute('cx', String(x)); dot.setAttribute('cy', String(y));
 dot.setAttribute('r', '4'); dot.setAttribute('fill', '#ff3b30');
 dot.setAttribute('stroke', '#fff'); dot.setAttribute('stroke-width', '1');
 const label = document.createElementNS(SVG_NS, 'text');
 label.setAttribute('x', String(x + 8)); label.setAttribute('y', String(y + 3));
 label.setAttribute('fill', '#e8eef5'); label.setAttribute('font-size', '10');
 label.setAttribute('font-family', 'sans-serif');
 label.textContent = feed.city;
 const title = document.createElementNS(SVG_NS, 'title');
 title.textContent = `${feed.city}, ${feed.country} — click to watch live`;
 g.append(title, halo, dot, label);
 svg.append(g);
 }

 wrap.append(svg);
 if (feeds.length === 0) {
 const empty = document.createElement('p');
 empty.className = 'webcam-placeholder';
 empty.textContent = 'No located streams in this region.';
 wrap.append(empty);
 }
 this.content.append(wrap);
  }

  private renderGrid(): void {
 this.content.innerHTML = '';
 this.content.className = 'panel-content webcam-content';

 const grid = document.createElement('div');
 grid.className = 'webcam-grid';

 const feeds = this.gridFeeds;
 const desktop = isDesktopRuntime();

 feeds.forEach((feed, i) => {
 const cell = document.createElement('div');
 cell.className = 'webcam-cell';

 const label = document.createElement('div');
 label.className = 'webcam-cell-label';
 label.innerHTML = `<span class="webcam-live-dot"></span><span class="webcam-city">${escapeHtml(feed.city.toUpperCase())}</span>`;

 if (desktop) {
 // On desktop, clicks pass through label (pointer-events:none in CSS)
 // to YouTube iframe so users click play directly. Add expand button.
 const expandBtn = document.createElement('button');
 expandBtn.className = 'webcam-expand-btn';
 expandBtn.title = t('webcams.expand') || 'Expand';
 expandBtn.setAttribute('aria-label', t('webcams.expand') || 'Expand webcam');
 expandBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
 expandBtn.addEventListener('click', (e) => {
 e.stopPropagation();
 trackWebcamSelected(feed.id, feed.city, 'grid');
 this.activeFeed = feed;
 this.setViewMode('single');
 });
 label.append(expandBtn);
 } else {
 cell.addEventListener('click', () => {
 trackWebcamSelected(feed.id, feed.city, 'grid');
 this.activeFeed = feed;
 this.setViewMode('single');
 });
 }

 cell.append(label);
 grid.append(cell);

 if (desktop && i > 0) {
 // Stagger iframe creation on desktop — WKWebView throttles concurrent autoplay.
 setTimeout(() => {
 // Bail if we left grid view before this fired — otherwise a staggered
 // iframe loads onto a detached/other view (e.g. after switching to map).
 if (!this.isVisible || this.isIdle || this.viewMode !== 'grid' || !cell.isConnected) return;
 const iframe = this.createIframe(feed);
 label.before(iframe);
 this.iframes.push(iframe);
 }, i * 800);
 } else {
 const iframe = this.createIframe(feed);
 label.before(iframe);
 this.iframes.push(iframe);
 }
 });

 this.content.append(grid);
  }

  private renderSingle(): void {
 this.content.innerHTML = '';
 this.content.className = 'panel-content webcam-content';

 const wrapper = document.createElement('div');
 wrapper.className = 'webcam-single';

 const iframe = this.createIframe(this.activeFeed);
 wrapper.append(iframe);
 this.iframes.push(iframe);

 const switcher = document.createElement('div');
 switcher.className = 'webcam-switcher';

 const backBtn = document.createElement('button');
 backBtn.className = 'webcam-feed-btn webcam-back-btn';
 backBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg> Grid';
 backBtn.addEventListener('click', () => this.setViewMode('grid'));
 switcher.append(backBtn);

 this.filteredFeeds.forEach(feed => {
 const btn = document.createElement('button');
 btn.className = `webcam-feed-btn${feed.id === this.activeFeed.id ? ' active' : ''}`;
 btn.textContent = feed.city;
 btn.addEventListener('click', () => {
 trackWebcamSelected(feed.id, feed.city, 'single');
 this.activeFeed = feed;
 this.render();
 });
 switcher.append(btn);
 });

 this.content.append(wrapper);
 this.content.append(switcher);
  }

  private destroyIframes(): void {
 for (const t of this._startWatchdogs.values()) clearTimeout(t);
 this._startWatchdogs.clear();
 this.iframes.forEach(iframe => {
 iframe.src = 'about:blank';
 iframe.remove();
 });
 this.iframes = [];
  }

  /** Listen for postMessage events from the sidecar YouTube embed and display errors. */
  private _setupYtMessageListener(): void {
 this._boundYtMsg = (e: MessageEvent) => {
 const data = e.data as { type?: string; code?: number; state?: number } | null;
 if (!data?.type?.startsWith('yt-')) return;

 const iframe = this.iframes.find(f => f.contentWindow === e.source);
 if (!iframe) return;
 const cell = iframe.closest<HTMLElement>('.webcam-cell, .webcam-single');
 if (!cell) return;

 // Reached a playing/buffering state → the stream is live. Cancel the
 // offline watchdog and clear any fallback that may already be showing.
 if (data.type === 'yt-state' && (data.state === 1 || data.state === 3)) {
 const t = this._startWatchdogs.get(iframe);
 if (t) { clearTimeout(t); this._startWatchdogs.delete(iframe); }
 cell.querySelector('.webcam-err-overlay')?.remove();
 return;
 }

 // A hard player error (bad id / unavailable / embed blocked) → offline
 // fallback immediately; the video id is dead.
 if (data.type === 'yt-error') {
 const t = this._startWatchdogs.get(iframe);
 if (t) { clearTimeout(t); this._startWatchdogs.delete(iframe); }
 this._showOfflineFallback(cell, iframe);
 }
 };
 window.addEventListener('message', this._boundYtMsg);
  }

  /** Replace a dead/offline player with a card that links to the channel's
   *  current live stream on YouTube — so a stale video id never leaves a black
   *  box, and the user is one click from the actual live feed. */
  private _showOfflineFallback(cell: HTMLElement, iframe: HTMLIFrameElement): void {
 if (cell.querySelector('.webcam-err-overlay')) return;
 const city = iframe.dataset.city ?? 'This camera';
 const handle = iframe.dataset.channelHandle ?? '';
 // Channel handles are '@name' from our static registry — /live shows the
 // channel's current live broadcast (or its live tab if none).
 const liveUrl = handle ? `https://www.youtube.com/${encodeURIComponent(handle)}/live` : 'https://www.youtube.com';

 const overlay = document.createElement('div');
 overlay.className = 'webcam-err-overlay';
 overlay.style.cssText =
 'position:absolute;inset:0;display:flex;flex-direction:column;gap:8px;align-items:center;justify-content:center;' +
 'background:rgba(10,12,16,0.92);color:#e8eef5;font-size:12px;' +
 'font-family:-apple-system,system-ui,sans-serif;z-index:6;padding:10px;text-align:center;';

 const title = document.createElement('div');
 title.textContent = `${city} — stream offline`;
 title.style.cssText = 'font-weight:600;opacity:0.85;';

 const link = document.createElement('a');
 link.href = liveUrl;
 link.target = '_blank';
 link.rel = 'noopener noreferrer';
 link.textContent = '🔴 Watch live on YouTube →';
 link.style.cssText =
 'color:#fff;background:#c4302b;padding:6px 12px;border-radius:6px;text-decoration:none;font-weight:600;';

 const retry = document.createElement('button');
 retry.textContent = 'Retry';
 retry.style.cssText =
 'background:transparent;border:1px solid rgba(255,255,255,0.25);color:#cfd8e3;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:11px;';
 retry.addEventListener('click', () => this.render());

 overlay.append(title, link, retry);
 cell.style.position = 'relative';
 cell.append(overlay);
  }

  private setupIntersectionObserver(): void {
 this.observer = new IntersectionObserver(
 (entries) => {
 const wasVisible = this.isVisible;
 this.isVisible = entries.some(e => e.isIntersecting);
 if (this.isVisible && !wasVisible && !this.isIdle) {
 this.render();
 } else if (!this.isVisible && wasVisible) {
 this.destroyIframes();
 }
 },
 { threshold: 0.1 }
 );
 this.observer.observe(this.element);
  }

  private setupIdleDetection(): void {
 this.boundVisibilityHandler = () => {
 if (document.hidden) {
 if (this.idleTimeout) clearTimeout(this.idleTimeout);
 } else {
 if (this.isIdle) {
 this.isIdle = false;
 if (this.isVisible) this.render();
 }
 this.boundIdleResetHandler();
 }
 };
 document.addEventListener('visibilitychange', this.boundVisibilityHandler);

 this.boundIdleResetHandler = () => {
 if (this.idleTimeout) clearTimeout(this.idleTimeout);
 if (this.isIdle) {
 this.isIdle = false;
 if (this.isVisible) this.render();
 }
 this.idleTimeout = setTimeout(() => {
 this.isIdle = true;
 this.destroyIframes();
 this.content.innerHTML = '<div class="webcam-placeholder">Webcams paused — move mouse to resume</div>';
 }, this.IDLE_PAUSE_MS);
 };

 ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove'].forEach(event => {
 document.addEventListener(event, this.boundIdleResetHandler, { passive: true });
 });

 this.boundIdleResetHandler();
  }

  public refresh(): void {
 if (this.isVisible && !this.isIdle) {
 this.render();
 }
  }

  public destroy(): void {
 if (this.idleTimeout) {
 clearTimeout(this.idleTimeout);
 this.idleTimeout = null;
 }
 document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
 ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove'].forEach(event => {
 document.removeEventListener(event, this.boundIdleResetHandler);
 });
 this.observer?.disconnect();
 this.destroyIframes();
 window.removeEventListener('message', this._boundYtMsg);
 super.destroy();
  }
}
