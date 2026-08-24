/* eslint-disable sonarjs/no-async-constructor */
import { Panel } from './Panel';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
import { getApiBaseUrl } from '@/services/runtime';
import { dataFreshness } from '@/services/data-freshness';
import { getGdeltNewsAdapterEvidence } from '@/services/home-shell/keyless-adapter-evidence';

interface GdeltEvent {
  title: string;
  url: string;
  source: string;
  tone: number;
  country: string;
  timestamp: number;
}

interface GdeltIntelResponse {
  events: GdeltEvent[];
  updatedAt: number;
  stale?: boolean;
  error?: string;
}

const COUNTRY_FLAGS: Record<string, string> = {
  'United States': '🇺🇸',
  'Russia': '🇷🇺',
  'China': '🇨🇳',
};

const GDELT_REFRESH_INTERVAL_MS = 15 * 60_000;
const GDELT_REQUEST_TIMEOUT_MS = 30_000;

function toneBadge(tone: number): string {
  if (tone < -5) return '<span class="gdelt-badge gdelt-badge--alarming">Alarming</span>';
  if (tone <= -2) return '<span class="gdelt-badge gdelt-badge--tense">Tense</span>';
  return '<span class="gdelt-badge gdelt-badge--neutral">Neutral</span>';
}

function relativeTime(ms: number): string {
  const diff = Math.max(0, Date.now() - ms);
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export class GdeltIntelPanel extends Panel {
  private data: GdeltIntelResponse | null = null;
  private loading = true;
  private error: string | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private fetchPromise: Promise<void> | null = null;
  private destroyed = false;

  constructor() {
 super({
 id: 'gdelt-intel',
 title: 'Live Intelligence',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Global news intelligence from GDELT — 65 languages, 100+ countries, updated every 15 minutes. Sorted by tone severity. Fully open, no API key required.',
 });
 void this.fetchData();
 this.refreshTimer = setInterval(() => void this.fetchData(), GDELT_REFRESH_INTERVAL_MS);
  }

  public override destroy(): void {
 this.destroyed = true;
 if (this.refreshTimer !== null) {
 clearInterval(this.refreshTimer);
 this.refreshTimer = null;
 }
 super.destroy();
  }

  public async fetchData(): Promise<void> {
 if (this.destroyed) return;
 if (this.fetchPromise) return this.fetchPromise;
 const request = this.runFetch().finally(() => {
   if (this.fetchPromise === request) this.fetchPromise = null;
 });
 this.fetchPromise = request;
 return request;
  }

  private async runFetch(): Promise<void> {
 this.loading = true;
 this.showLoading();

 try {
 const signal = AbortSignal.any([this.signal, AbortSignal.timeout(GDELT_REQUEST_TIMEOUT_MS)]);
 const res = await fetch(`${getApiBaseUrl()}/api/gdelt-intel`, { signal });
 if (this.destroyed) return;
 if (!res.ok) throw new Error(`HTTP ${res.status}`);
 const json = await res.json() as GdeltIntelResponse;
 const evidence = getGdeltNewsAdapterEvidence(json);
 if (evidence) {
 this.data = json;
 this.error = null;
 dataFreshness.recordUpdate('gdelt-news', evidence.itemCount);
 } else {
 const adapterError = typeof json?.error === 'string' && json.error.trim().length > 0
   ? json.error
   : null;
 this.error = adapterError
   ? `GDELT unavailable: ${adapterError}. Will retry every 15 min.`
   : 'GDELT returned a malformed response. Will retry every 15 min.';
 dataFreshness.recordError('gdelt-news', adapterError ?? 'GDELT adapter output was unavailable or malformed');
 }
 } catch (error) {
 if (this.destroyed || this.isAbortError(error)) return;
 // Source: GDELT 2.0 (free, no key needed). Stale cache will be
 // shown when available; otherwise the panel surfaces this message.
 this.error = error instanceof Error
 ? `GDELT unreachable: ${error.message}. Will retry every 15 min.`
 : 'GDELT unavailable. Source: gdeltproject.org (free, no key needed). Will retry every 15 min.';
 dataFreshness.recordError('gdelt-news', this.error);
 }

 if (this.destroyed) return;
 this.loading = false;
 this.renderPanel();
  }

  private renderPanel(): void {
 if (this.loading) {
 this.showLoading();
 return;
 }

 if (this.error || !this.data) {
 this.showError(this.error ?? 'No data');
 return;
 }

 // Defensive shape check: degraded sidecar responses can return
 // {degraded:true} or arbitrary objects without an `events` array.
 // Smoke-test harness identified this as a crash site.
 const eventsArr = Array.isArray(this.data.events) ? this.data.events : [];
 const events = eventsArr.slice(0, 20);
 this.setCount(events.length);

 if (events.length === 0) {
 const msg = this.data.error
 ? `GDELT unavailable — ${this.data.error}`
 : 'No events available.';
 this.setContent(`<div class="panel-loading-text">${msg}</div>`);
 return;
 }

 const staleBanner = this.data.stale
 ? `<div class="gdelt-stale-banner">Cached ${relativeTime(this.data.updatedAt * 1000)} — GDELT unavailable</div>`
 : '';

 const items = events.map(ev => {
 const flag = COUNTRY_FLAGS[ev.country] ?? '';
 const safeHref = sanitizeUrl(ev.url);
 const linkAttr = safeHref ? `href="${safeHref}" target="_blank" rel="noopener noreferrer"` : '';
 const titleEl = safeHref
 ? `<a class="gdelt-title" ${linkAttr}>${escapeHtml(ev.title)}</a>`
 : `<span class="gdelt-title">${escapeHtml(ev.title)}</span>`;

 return `
 <div class="gdelt-item">
 <div class="gdelt-item-header">
 ${titleEl}
 </div>
 <div class="gdelt-item-meta">
 <span class="gdelt-source">${escapeHtml(ev.source)}</span>
 ${flag ? `<span class="gdelt-flag">${flag}</span>` : ''}
 ${toneBadge(ev.tone)}
 <span class="gdelt-time">${relativeTime(ev.timestamp)}</span>
 </div>
 </div>
 `;
 }).join('');

 this.setContent(`${staleBanner}<div class="gdelt-list">${items}</div>`);
  }
}
