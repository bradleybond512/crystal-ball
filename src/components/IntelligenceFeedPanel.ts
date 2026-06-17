/* eslint-disable sonarjs/no-async-constructor */
import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { getApiBaseUrl } from '@/services/runtime';

interface FeedItem {
  id: string;
  type: 'observation' | 'correlation' | 'change';
  timestamp: number;
  domain: string;
  severity: string;
  title: string;
  summary: string;
  data: unknown;
}

interface FeedResponse {
  items: FeedItem[];
  total: number;
  generated: number;
}

const REFRESH_MS = 30_000;

const SEV_COLOR: Record<string, string> = {
  CRITICAL: '#d50000',
  HIGH:     '#ff9800',
  MEDIUM:   '#ffeb3b',
  LOW:      '#4caf50',
  INFO:     '#78909c',
};

const TYPE_LABEL: Record<string, string> = {
  observation: 'OBS',
  correlation: 'CORR',
  change:      'CHG',
};

const TYPE_COLOR: Record<string, string> = {
  observation: '#1565c0',
  correlation: '#6a1b9a',
  change:      '#00695c',
};

function relativeTime(ms: number): string {
  const diff = Math.max(0, Date.now() - ms);
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function severityDot(sev: string): string {
  const color = SEV_COLOR[sev] ?? SEV_COLOR.INFO;
  return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px;flex-shrink:0"></span>`;
}

function typeBadge(type: string): string {
  const label = TYPE_LABEL[type] ?? type.toUpperCase().slice(0, 4);
  const color = TYPE_COLOR[type] ?? '#455a64';
  return `<span style="font-size:10px;font-weight:700;color:${color};background:${color}22;padding:1px 5px;border-radius:3px;margin-right:6px;flex-shrink:0">${escapeHtml(label)}</span>`;
}

export class IntelligenceFeedPanel extends Panel {
  private items: FeedItem[] = [];
  private loading = true;
  private error: string | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private activeType = '';
  private activeDomain = '';

  constructor() {
    super({
      id: 'intelligence-feed',
      title: 'Intelligence Feed',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Live chronological stream of observations, cross-domain correlations, and situation change digests. Auto-refreshes every 30s.',
    });
    void this.fetchFeed();
    this.refreshTimer = setInterval(() => { void this.fetchFeed(); }, REFRESH_MS);
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  public async fetchFeed(): Promise<void> {
    if (this.items.length === 0) this.showLoading();
    const base = getApiBaseUrl();
    const params = new URLSearchParams({ limit: '150' });
    if (this.activeType) params.set('type', this.activeType);
    if (this.activeDomain) params.set('domain', this.activeDomain);
    try {
      const res = await fetch(`${base}/api/intelligence/feed?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as FeedResponse;
      if (!data || typeof data !== 'object') {
        this.items = [];
        this.error = null;
        this.loading = false;
        this.renderPanel();
        return;
      }
      this.items = Array.isArray(data.items) ? data.items : [];
      this.error = null;
    } catch (error) {
      if (this.isAbortError(error)) return;
      this.error = error instanceof Error ? error.message : 'Feed unavailable';
    }
    this.loading = false;
    this.renderPanel();
  }

  private renderPanel(): void {
    if (this.loading) {
      this.showLoading();
      return;
    }
    if (this.error && this.items.length === 0) {
      this.showError(this.error);
      return;
    }
    this.setCount(this.items.length);
    this.setContent(this.buildHtml());
    this.attachFilterListeners();
  }

  private buildHtml(): string {
    const domains = [...new Set(this.items.map((i) => i.domain))].sort((a, b) => a.localeCompare(b));
    const filters = this.buildFilterBar(domains);
    const rows = this.items.length === 0
      ? '<div style="padding:24px;text-align:center;color:#546e7a;font-size:13px">No events yet — data loads as domains refresh.</div>'
      : this.items.map((item) => this.buildRow(item)).join('');

    return `
      <div class="intelligence-feed" style="display:flex;flex-direction:column;height:100%">
        ${filters}
        <div class="intelligence-feed__list" style="overflow-y:auto;flex:1;padding:4px 0">
          ${rows}
        </div>
      </div>`;
  }

  private buildFilterBar(domains: string[]): string {
    const typeButtons = ['', 'observation', 'correlation', 'change'].map((t) => {
      const label = t === '' ? 'All' : (TYPE_LABEL[t] ?? t);
      const active = this.activeType === t;
      return `<button
        class="intelligence-feed__type-btn${active ? ' active' : ''}"
        data-type="${escapeHtml(t)}"
        style="padding:3px 10px;border-radius:4px;border:1px solid ${active ? '#1565c0' : '#37474f'};
          background:${active ? '#1565c022' : 'transparent'};color:${active ? '#90caf9' : '#90a4ae'};
          font-size:11px;cursor:pointer;font-weight:${active ? '700' : '400'}"
      >${escapeHtml(label)}</button>`;
    }).join('');

    const domainChips = domains.slice(0, 12).map((d) => {
      const active = this.activeDomain === d;
      return `<button
        class="intelligence-feed__domain-chip${active ? ' active' : ''}"
        data-domain="${escapeHtml(d)}"
        style="padding:2px 8px;border-radius:10px;border:1px solid ${active ? '#00695c' : '#37474f'};
          background:${active ? '#00695c22' : 'transparent'};color:${active ? '#80cbc4' : '#78909c'};
          font-size:10px;cursor:pointer;white-space:nowrap"
      >${escapeHtml(d)}</button>`;
    }).join('');

    return `
      <div class="intelligence-feed__filters" style="padding:8px 12px;border-bottom:1px solid #1e2d35;display:flex;flex-wrap:wrap;gap:6px;align-items:center">
        <div style="display:flex;gap:4px">${typeButtons}</div>
        ${domainChips ? `<div style="display:flex;gap:4px;flex-wrap:wrap">${domainChips}</div>` : ''}
      </div>`;
  }

  private buildRow(item: FeedItem): string {
    const color = SEV_COLOR[item.severity] ?? SEV_COLOR.INFO;
    return `
      <div class="intelligence-feed__row"
        style="padding:8px 12px;border-bottom:1px solid #0d1b21;display:flex;align-items:flex-start;gap:0;cursor:default"
        data-id="${escapeHtml(item.id)}"
      >
        <div style="display:flex;align-items:center;flex-shrink:0;padding-top:2px">
          ${severityDot(item.severity)}
          ${typeBadge(item.type)}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;color:#cfd8dc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${escapeHtml(item.title)}
          </div>
          <div style="font-size:11px;color:#546e7a;margin-top:2px;display:flex;gap:8px;align-items:center">
            <span style="color:${color};font-weight:600;font-size:10px">${escapeHtml(item.severity)}</span>
            <span>${escapeHtml(item.domain)}</span>
            <span>${escapeHtml(item.summary)}</span>
            <span style="margin-left:auto;flex-shrink:0">${relativeTime(item.timestamp)}</span>
          </div>
        </div>
      </div>`;
  }

  private attachFilterListeners(): void {
    const el = this.getElement();
    if (!el) return;

    el.querySelectorAll<HTMLButtonElement>('.intelligence-feed__type-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeType = btn.dataset.type ?? '';
        void this.fetchFeed();
      });
    });

    el.querySelectorAll<HTMLButtonElement>('.intelligence-feed__domain-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const clicked = btn.dataset.domain ?? '';
        this.activeDomain = this.activeDomain === clicked ? '' : clicked;
        void this.fetchFeed();
      });
    });
  }
}
