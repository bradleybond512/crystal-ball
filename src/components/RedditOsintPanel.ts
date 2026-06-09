import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  buildKeywordMatcher,
  DEFAULT_SUBREDDITS,
  fetchRedditFeed,
  formatTimeAgo,
  loadSavedKeywords,
  saveSavedKeywords,
  type RedditFeed,
  type RedditPost,
} from '@/services/osint/reddit-service';

const SUBREDDIT_FILTER_KEY = 'cb:reddit-osint-active-subreddits';

interface VisibleFilter {
  /** lowercased subreddit names; empty set means "all subreddits". */
  subs: Set<string>;
  matchesOnly: boolean;
}

export class RedditOsintPanel extends Panel {
  private feed: RedditFeed | null = null;
  private feedLoading = false;
  private keywords: string[] = loadSavedKeywords();
  private keywordsDraft = '';
  private filter: VisibleFilter = { subs: loadStoredSubs(), matchesOnly: false };

  constructor() {
    super({
      id: 'reddit-osint',
      title: 'Reddit OSINT',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'Multi-subreddit OSINT feed (r/netsec, r/cybersecurity, r/worldnews, …). 15-min cache per subreddit.',
    });
    this.keywordsDraft = this.keywords.join(', ');
    this.render();
    queueMicrotask(() => { void this.loadFeed(); });
  }

  private async loadFeed(): Promise<void> {
    if (this.feedLoading) return;
    this.feedLoading = true;
    try {
      this.feed = await fetchRedditFeed({ subreddits: DEFAULT_SUBREDDITS, limit: 25 });
      this.setCount(this.feed.posts.length);
    } finally {
      this.feedLoading = false;
      this.render();
    }
  }

  private visiblePosts(): { post: RedditPost; match: string | null }[] {
    const posts = this.feed?.posts ?? [];
    const matcher = buildKeywordMatcher(this.keywords);
    const out: { post: RedditPost; match: string | null }[] = [];
    for (const post of posts) {
      if (this.filter.subs.size > 0 && !this.filter.subs.has(post.subreddit.toLowerCase())) continue;
      const match = matcher(post);
      if (this.filter.matchesOnly && match === null) continue;
      out.push({ post, match });
    }
    return out;
  }

  private renderSubredditChips(): string {
    const subs = (this.feed?.subreddits ?? DEFAULT_SUBREDDITS).map((s) => s.toLowerCase());
    const unique = [...new Set(subs)];
    const allActive = this.filter.subs.size === 0;
    const chips = unique.map((sub) => {
      const active = allActive || this.filter.subs.has(sub);
      return `<button class="reddit-sub-chip" data-sub="${escapeHtml(sub)}" type="button"
        style="padding:2px 8px;border:1px solid rgba(255,255,255,0.12);background:${active ? 'rgba(96,165,250,0.20)' : 'transparent'};color:${active ? 'inherit' : 'rgba(255,255,255,0.5)'};border-radius:999px;cursor:pointer;font-size:11px;font-family:monospace">r/${escapeHtml(sub)}</button>`;
    }).join('');
    const reset = `<button class="reddit-sub-reset" type="button" style="padding:2px 8px;background:transparent;border:1px dashed rgba(255,255,255,0.18);color:rgba(255,255,255,0.6);border-radius:999px;cursor:pointer;font-size:11px">show all</button>`;
    return `<div class="reddit-sub-chips" style="display:flex;flex-wrap:wrap;gap:4px;align-items:center">${chips}${this.filter.subs.size > 0 ? reset : ''}</div>`;
  }

  private renderKeywordPanel(): string {
    const valueAttr = escapeHtml(this.keywordsDraft);
    const matchesOnly = this.filter.matchesOnly;
    return `<div class="reddit-keyword-panel" style="display:flex;flex-direction:column;gap:6px;margin:8px 0">
      <div style="display:flex;gap:6px;align-items:center">
        <input type="text" class="reddit-keyword-input" placeholder="Highlight keywords (comma-separated): breach, ransomware, earthquake" value="${valueAttr}"
          style="flex:1;padding:4px 8px;background:rgba(255,255,255,0.04);color:inherit;border:1px solid rgba(255,255,255,0.12);border-radius:4px;font-size:12px" />
        <button class="reddit-keyword-save" type="button"
          style="padding:4px 10px;border:1px solid rgba(96,165,250,0.4);background:rgba(96,165,250,0.18);color:inherit;border-radius:4px;cursor:pointer;font-size:11px">Save</button>
      </div>
      <label style="display:flex;align-items:center;gap:4px;font-size:11px;opacity:0.85;cursor:pointer">
        <input type="checkbox" class="reddit-matches-only" ${matchesOnly ? 'checked' : ''} />
        Show only keyword matches
      </label>
    </div>`;
  }

  private renderPostRow({ post, match }: { post: RedditPost; match: string | null }): string {
    const highlightStyle = match
      ? 'background:rgba(245,158,11,0.10);border-left:3px solid #f59e0b;padding-left:7px'
      : 'border-left:3px solid transparent;padding-left:7px';
    const flair = post.flair
      ? `<span style="padding:0 5px;margin-left:4px;border-radius:3px;background:rgba(124,58,237,0.18);font-size:10px">${escapeHtml(post.flair)}</span>`
      : '';
    const matchTag = match
      ? `<span style="padding:0 5px;margin-left:4px;border-radius:3px;background:rgba(245,158,11,0.22);font-size:10px;color:#fde68a">${escapeHtml(match)}</span>`
      : '';
    const titleAttr = escapeHtml(post.title);
    return `<div class="reddit-post" style="padding:6px 0 6px 4px;${highlightStyle};border-bottom:1px solid rgba(255,255,255,0.06)">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline">
        <span style="padding:1px 6px;border-radius:3px;background:rgba(96,165,250,0.18);font-size:10px;font-family:monospace">r/${escapeHtml(post.subreddit)}</span>
        <span style="font-size:11px;opacity:0.6">${formatTimeAgo(post.createdUtc)}</span>
      </div>
      <div style="margin-top:4px">
        <a href="${escapeHtml(post.permalink)}" target="_blank" rel="noopener noreferrer" title="${titleAttr}"
          style="color:inherit;text-decoration:none;font-size:13px;line-height:1.3">${escapeHtml(post.title)}</a>
        ${flair}${matchTag}
      </div>
      <div style="margin-top:4px;font-size:11px;opacity:0.6;display:flex;gap:12px">
        <span>↑ ${post.score.toLocaleString()}</span>
        <span>💬 ${post.numComments.toLocaleString()}</span>
        <span>u/${escapeHtml(post.author)}</span>
        ${post.domain ? `<span style="opacity:0.7">${escapeHtml(post.domain)}</span>` : ''}
      </div>
    </div>`;
  }

  private renderFooter(): string {
    if (!this.feed || this.feed.generatedAt.startsWith('1970')) {
      const msg = this.placeholderMessage();
      return `<div style="margin-top:6px;font-size:11px;opacity:0.6">${msg}</div>`;
    }
    const degradedSuffix = this.feed.degraded ? ' (degraded)' : '';
    return `<div style="margin-top:6px;font-size:11px;opacity:0.6;display:flex;justify-content:space-between;gap:8px">
      <span>${this.feed.subreddits.length} subreddits${degradedSuffix}</span>
      <span>Generated ${escapeHtml(this.feed.generatedAt)}</span>
    </div>`;
  }

  private placeholderMessage(): string {
    if (this.feedLoading) return 'Loading…';
    const reason = this.feed?.reason;
    if (reason) return `Degraded: ${escapeHtml(reason)}`;
    return 'Awaiting first refresh';
  }

  private render(): void {
    const chips = this.renderSubredditChips();
    const keywords = this.renderKeywordPanel();
    const visible = this.visiblePosts();
    let body: string;
    if (this.feedLoading && !this.feed) {
      body = `<div class="panel-empty" style="padding:16px 0;text-align:center;opacity:0.7">Loading reddit feed…</div>`;
    } else if (visible.length === 0) {
      body = `<div class="panel-empty" style="padding:16px 0;text-align:center;opacity:0.7">${this.filter.matchesOnly ? 'No posts match your keywords.' : 'No posts after filter.'}</div>`;
    } else {
      body = visible.slice(0, 200).map((entry) => this.renderPostRow(entry)).join('');
    }
    this.setContent(`${chips}${keywords}${body}${this.renderFooter()}`, () => this.wireHandlers());
  }

  private wireHandlers(): void {
    const root = this.getElement();
    if (!root) return;
    for (const chip of root.querySelectorAll<HTMLButtonElement>('.reddit-sub-chip')) {
      chip.addEventListener('click', () => {
        const sub = chip.dataset.sub;
        if (!sub) return;
        if (this.filter.subs.size === 0) {
          // All-active → click selects only this one.
          this.filter.subs = new Set([sub]);
        } else if (this.filter.subs.has(sub)) {
          this.filter.subs.delete(sub);
        } else {
          this.filter.subs.add(sub);
        }
        persistSubs(this.filter.subs);
        this.render();
      });
    }
    const reset = root.querySelector<HTMLButtonElement>('.reddit-sub-reset');
    if (reset) {
      reset.addEventListener('click', () => {
        this.filter.subs = new Set();
        persistSubs(this.filter.subs);
        this.render();
      });
    }
    const matchesOnly = root.querySelector<HTMLInputElement>('.reddit-matches-only');
    if (matchesOnly) {
      matchesOnly.addEventListener('change', () => {
        this.filter.matchesOnly = matchesOnly.checked;
        this.render();
      });
    }
    const keywordInput = root.querySelector<HTMLInputElement>('.reddit-keyword-input');
    const keywordSave = root.querySelector<HTMLButtonElement>('.reddit-keyword-save');
    if (keywordInput) {
      keywordInput.addEventListener('input', () => { this.keywordsDraft = keywordInput.value; });
    }
    if (keywordSave) {
      keywordSave.addEventListener('click', () => {
        const next = this.keywordsDraft
          .split(',').map((k) => k.trim()).filter((k) => k.length > 0);
        this.keywords = next;
        saveSavedKeywords(next);
        this.render();
      });
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function loadStoredSubs(): Set<string> {
  try {
    const raw = localStorage.getItem(SUBREDDIT_FILTER_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    const out = new Set<string>();
    for (const item of parsed) {
      if (typeof item === 'string' && item.length > 0) out.add(item.toLowerCase());
    }
    return out;
  } catch {
    return new Set();
  }
}

function persistSubs(subs: Set<string>): void {
  try {
    localStorage.setItem(SUBREDDIT_FILTER_KEY, JSON.stringify([...subs]));
  } catch { /* noop */ }
}
