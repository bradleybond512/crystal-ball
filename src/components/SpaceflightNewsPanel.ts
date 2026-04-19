import { Panel } from './Panel';
import type { SpaceflightArticle } from '@/services/spaceflight-news';
import { escapeHtml } from '@/utils/sanitize';

export class SpaceflightNewsPanel extends Panel {
  private articles: SpaceflightArticle[] = [];

  constructor() {
 super({
 id: 'spaceflight-news',
 title: 'Spaceflight News',
 showCount: true,
 trackActivity: false,
 infoTooltip: 'Latest spaceflight and launch news from Spaceflight News API — missions, launches, and space events.',
 });
 this.showLoading('Fetching spaceflight news...');
  }

  public update(articles: SpaceflightArticle[]): void {
 this.articles = articles;
 this.setCount(articles.length);
 this.render();
  }

  private render(): void {
 if (this.articles.length === 0) {
 this.setContent('<div class="panel-empty">No recent spaceflight news.</div>');
 return;
 }

 const rows = this.articles.slice(0, 20).map(a => {
 const ago = this.relativeTime(a.publishedAt);
 const summary = a.summary.length > 120 ? a.summary.slice(0, 118) + '…' : a.summary;
 const chips = [
 ...a.launches.map(l => `<span class="sev-badge">${escapeHtml(l.provider)}</span>`),
 ...a.events.map(e => `<span class="sev-badge">${escapeHtml(e.name)}</span>`),
 ].join(' ');
 return `<div class="eq-row" style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06)">
 <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
 <span class="sev-badge" style="white-space:nowrap">${escapeHtml(a.newsSite)}</span>
 <span style="opacity:0.5;font-size:11px;white-space:nowrap">${ago}</span>
 </div>
 <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer"
 style="display:block;margin:4px 0 2px;font-weight:600;text-decoration:none;color:inherit">
 ${escapeHtml(a.title)}
 </a>
 <div style="opacity:0.65;font-size:11px;line-height:1.4">${escapeHtml(summary)}</div>
 ${chips ? `<div style="margin-top:4px">${chips}</div>` : ''}
 </div>`;
 }).join('');

 this.setContent(`
 <div class="ct-panel-content">
 ${rows}
 <div class="fires-footer">
 <span class="fires-source">Spaceflight News API</span>
 </div>
 </div>
 `);
  }

  private relativeTime(date: Date): string {
 const diffMs = Date.now() - date.getTime();
 const diffH = Math.floor(diffMs / 3_600_000);
 if (diffH < 1) return `${Math.floor(diffMs / 60_000)}m ago`;
 if (diffH < 24) return `${diffH}h ago`;
 return `${Math.floor(diffH / 24)}d ago`;
  }
}
