 
import { Panel } from './Panel';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
import { getApiBaseUrl } from '@/services/runtime';
import {
  aggregateHeadlines,
  isBreaking,
  type Article,
  type NewsTopic,
  type RawArticle,
} from '@/services/news/news-aggregator';

type FilterChip = NewsTopic | 'all';

const CHIP_STORAGE_KEY = 'cb:news-chip';
const CHIP_LABELS: Record<FilterChip, string> = {
  all: 'All',
  security: 'Security',
  geopolitical: 'Geopolitical',
  natural_disasters: 'Natural Disasters',
  economic: 'Economic',
  health: 'Health',
  general: 'General',
};

const CHIPS: FilterChip[] = ['all', 'security', 'geopolitical', 'natural_disasters', 'economic', 'health'];

export class MediastackNewsPanel extends Panel {
  private articles: Article[] = [];
  private activeChip: FilterChip = readStoredChip();
  private query = '';
  private loading = false;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'mediastack-news',
      title: 'News Feed',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'GDELT-backed news feed with topic filters. Articles under 30 min old show a "Breaking" badge. 15-min refresh.',
    });
    this.render();
    // Defer the first fetch off the constructor so we don't block boot.
    queueMicrotask(() => { void this.load(); });
    // Re-fetch every 15 min so the panel stays current while open.
    this.refreshTimer = setInterval(() => { void this.load(); }, 15 * 60 * 1000);
  }

  private async load(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      const topics = this.activeChip === 'all'
        ? 'security,geopolitical,natural_disasters,economic,health,weather,emergency'
        : this.activeChip;
      const url = `/api/news/headlines?topics=${encodeURIComponent(topics)}&limit=80`;
      const data = await fetchJson(url);
      const raw = (data as { articles?: RawArticle[] } | null)?.articles ?? [];
      this.articles = aggregateHeadlines([raw], { limit: 80 });
      this.setCount(this.articles.length);
      this.render();
    } finally {
      this.loading = false;
    }
  }

  public destroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  // ─── Rendering ─────────────────────────────────────────────────────

  private renderChipStrip(): string {
    return `<div class="news-chip-strip" role="tablist" style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">${CHIPS
      .map((chip) => {
        const active = chip === this.activeChip;
        return `<button class="news-chip" data-chip="${chip}" type="button" style="padding:4px 10px;border:1px solid rgba(255,255,255,0.12);background:${active ? 'rgba(96,165,250,0.18)' : 'transparent'};color:inherit;border-radius:14px;cursor:pointer;font-size:11px">${escapeHtml(CHIP_LABELS[chip])}</button>`;
      }).join('')}</div>`;
  }

  private renderSearchInput(): string {
    const queryAttr = escapeHtml(this.query);
    return `<input type="search" class="news-search-input" placeholder="Filter headlines…" value="${queryAttr}"
      style="width:100%;padding:6px 10px;margin-bottom:8px;background:rgba(255,255,255,0.04);color:inherit;border:1px solid rgba(255,255,255,0.12);border-radius:4px;font-size:13px" />`;
  }

  private renderFeed(): string {
    if (this.loading && this.articles.length === 0) return emptyState('Loading news…');
    let articles = this.articles;
    if (this.activeChip !== 'all') articles = articles.filter((a) => a.topic === this.activeChip);
    const q = this.query.trim().toLowerCase();
    if (q) articles = articles.filter((a) => a.title.toLowerCase().includes(q));
    if (articles.length === 0) {
      return emptyState(this.activeChip === 'all' ? 'No headlines available right now.' : `No ${CHIP_LABELS[this.activeChip].toLowerCase()} headlines right now.`);
    }
    const now = Date.now();
    const rows = articles.slice(0, 50).map((a) => renderArticleRow(a, now, q)).join('');
    return `<div class="news-feed" style="display:flex;flex-direction:column;gap:6px;max-height:520px;overflow-y:auto">${rows}</div>
      <div style="opacity:0.65;font-size:11px;margin-top:6px">Source: GDELT 2.0 Doc · 15-min refresh · ${articles.length} articles</div>`;
  }

  private render(): void {
    this.setContent(`${this.renderChipStrip()}${this.renderSearchInput()}${this.renderFeed()}`, () => this.wireHandlers());
  }

  private wireHandlers(): void {
    const root = this.getElement();
    if (!root) return;
    for (const btn of root.querySelectorAll<HTMLButtonElement>('.news-chip')) {
      btn.addEventListener('click', () => {
        const chip = btn.dataset.chip as FilterChip | undefined;
        if (!chip || chip === this.activeChip) return;
        this.activeChip = chip;
        try { localStorage.setItem(CHIP_STORAGE_KEY, chip); } catch { /* noop */ }
        this.render();
        void this.load();
      });
    }
    const input = root.querySelector<HTMLInputElement>('.news-search-input');
    if (input) {
      const len = input.value.length;
      if (this.query) {
        input.focus();
        try { input.setSelectionRange(len, len); } catch { /* noop */ }
      }
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      input.addEventListener('input', () => {
        const value = input.value;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          this.query = value;
          this.render();
        }, 150);
      });
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function renderArticleRow(a: Article, now: number, query: string): string {
  const breaking = isBreaking(a, now);
  const safeUrl = sanitizeUrl(a.url) || '';
  const titleHtml = highlight(a.title, query);
  const countryBit = a.country ? ` · ${escapeHtml(a.country)}` : '';
  const ago = a.publishedAt ? timeAgo(a.publishedAt, now) : '';
  return `<div class="news-row" style="padding:8px;border-radius:4px;background:rgba(255,255,255,0.03);display:flex;flex-direction:column;gap:2px">
    <div>
      ${breaking ? '<span style="padding:1px 5px;border-radius:3px;background:rgba(248,113,113,0.32);font-size:9px;font-weight:600;text-transform:uppercase;margin-right:6px">Breaking</span>' : ''}
      <a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" style="font-size:13px;text-decoration:none;color:inherit">${titleHtml}</a>
    </div>
    <div style="font-size:11px;opacity:0.65">
      ${escapeHtml(a.source)}${countryBit} · ${escapeHtml(ago)} · <span style="opacity:0.85">${escapeHtml(topicLabel(a.topic))}</span>
    </div>
  </div>`;
}

function highlight(title: string, query: string): string {
  const safe = escapeHtml(title);
  if (!query) return safe;
  const safeQuery = escapeHtml(query);
  if (!safeQuery) return safe;
  // Highlighting is done on the escaped string, so the substitution
  // can't inject HTML — we're only wrapping a known substring.
  const idx = safe.toLowerCase().indexOf(safeQuery.toLowerCase());
  if (idx === -1) return safe;
  const before = safe.slice(0, idx);
  const match = safe.slice(idx, idx + safeQuery.length);
  const after = safe.slice(idx + safeQuery.length);
  return `${before}<mark style="background:rgba(250,204,21,0.32);color:inherit">${match}</mark>${after}`;
}

function topicLabel(t: NewsTopic): string {
  switch (t) {
    case 'security': { return 'Security';
    }
    case 'geopolitical': { return 'Geopolitical';
    }
    case 'natural_disasters': { return 'Natural Disasters';
    }
    case 'economic': { return 'Economic';
    }
    case 'health': { return 'Health';
    }
    default: { return 'General';
    }
  }
}

function emptyState(message: string): string {
  return `<div class="panel-empty" style="padding:16px 0;text-align:center;opacity:0.75">${escapeHtml(message)}</div>`;
}

function timeAgo(epoch: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - epoch) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

async function fetchJson(path: string): Promise<unknown> {
  try {
    const r = await fetch(`${getApiBaseUrl()}${path}`, { headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    return await r.json() as unknown;
  } catch {
    return null;
  }
}

function readStoredChip(): FilterChip {
  try {
    const stored = localStorage.getItem(CHIP_STORAGE_KEY);
    if (stored && (stored === 'all' || CHIPS.includes(stored as FilterChip))) return stored as FilterChip;
  } catch { /* noop */ }
  return 'all';
}
