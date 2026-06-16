/**
 * EconomicNewsPanel — panel id `economic-news`
 *
 * Shows the latest business / economic news headlines pulled from
 * the sidecar's mediastack and newsdata feeds, filtered to the
 * business / economics category. Auto-refreshes every 10 minutes.
 */

import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import { getApiBaseUrl } from '@/services/runtime';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 10 * 60 * 1000;

interface NewsItem {
  title: string;
  source?: string;
  url?: string;
  publishedAt?: string;
}

interface MediastackResponse {
  data?: { title: string; source: string; url: string; published_at: string }[];
  error?: { message: string };
}

interface NewsdataResponse {
  results?: { title: string; source_id: string; link: string; pubDate: string }[];
}

function timeAgo(iso: string | undefined): string {
  if (!iso) return '';
  const delta = (Date.now() - new Date(iso).getTime()) / 60_000;
  if (delta < 60) return `${Math.round(delta)}m ago`;
  if (delta < 1440) return `${Math.round(delta / 60)}h ago`;
  return `${Math.round(delta / 1440)}d ago`;
}

export class EconomicNewsPanel extends Panel {
  private items: NewsItem[] = [];
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private loading = true;

  constructor() {
    super({
      id: 'economic-news',
      title: 'Economic News',
      showCount: false,
      trackActivity: true,
      infoTooltip: 'Latest business and economic headlines from global news sources.',
    });
    this.start();
  }

  private start(): void {
    void this.load();
    this.refreshTimer = setInterval(() => void this.load(), REFRESH_MS);
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private async load(): Promise<void> {
    const base = getApiBaseUrl();
    const collected: NewsItem[] = [];

    try {
      const [ms, nd] = await Promise.allSettled([
        fetch(`${base}/api/mediastack-news?categories=business&limit=20`, {
          signal: AbortSignal.timeout(12_000),
        }).then(async r => {
          if (!r.ok) return null;
          const j = await r.json() as MediastackResponse;
          return (j && typeof j === 'object') ? j : null;
        }),
        fetch(`${base}/api/newsdata-feed?category=business&size=15`, {
          signal: AbortSignal.timeout(12_000),
        }).then(async r => {
          if (!r.ok) return null;
          const j = await r.json() as NewsdataResponse;
          return (j && typeof j === 'object') ? j : null;
        }),
      ]);

      if (ms.status === 'fulfilled' && ms.value?.data) {
        for (const item of ms.value.data) {
          if (item.title) {
            collected.push({
              title: item.title,
              source: item.source,
              url: item.url,
              publishedAt: item.published_at,
            });
          }
        }
      }

      if (nd.status === 'fulfilled' && nd.value?.results) {
        for (const item of nd.value.results) {
          if (item.title) {
            collected.push({
              title: item.title,
              source: item.source_id,
              url: item.link,
              publishedAt: item.pubDate,
            });
          }
        }
      }
    } catch { /* network error — render whatever we have */ }

    this.items = collected.slice(0, 30);
    this.loading = false;
    this.render();
  }

  private render(): void {
    const el = this.getContentElement();

    if (this.loading) {
      replaceChildren(el, h('div', { style: 'color:#9e9e9e;font-size:12px;padding:8px' }, 'Loading economic news…'));
      return;
    }

    if (this.items.length === 0) {
      replaceChildren(el, h('div', { style: 'color:#9e9e9e;font-size:12px;padding:8px' }, 'No economic news available.'));
      return;
    }

    const list = h('div', { style: 'display:flex;flex-direction:column;gap:0' });

    for (const item of this.items) {
      const ago = timeAgo(item.publishedAt);
      const meta = [item.source, ago].filter(Boolean).join(' · ');

      const row = h('div', {
        style: 'padding:6px 8px;border-bottom:1px solid #1e1e1e;cursor:default',
      },
        item.url
          ? h('a', {
              href: item.url,
              target: '_blank',
              rel: 'noopener noreferrer',
              style: 'color:#e0e0e0;font-size:12px;font-weight:500;text-decoration:none;display:block;line-height:1.4',
            }, escapeHtml(item.title))
          : h('div', { style: 'color:#e0e0e0;font-size:12px;font-weight:500;line-height:1.4' }, escapeHtml(item.title)),
        meta
          ? h('div', { style: 'color:#9e9e9e;font-size:10px;margin-top:2px' }, escapeHtml(meta))
          : null,
      );
      list.append(row);
    }

    replaceChildren(el, list);
  }
}
