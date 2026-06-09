/**
 * HIBP Breaches Panel — surfaces the haveibeenpwned.com public
 * breaches list. Three tabs:
 *
 *   • Latest      — breaches added in the last 90 days, newest first
 *   • Search      — free-text search across name / title / domain
 *   • Statistics  — counts, total pwned accounts, top data classes,
 *                   severity breakdown
 *
 * The sidecar (/api/security/breaches{,/latest}) handles the actual
 * upstream call with 24h cache; this panel is a thin presenter.
 */

import { Panel } from './Panel';
import {
  fetchAllBreaches,
  fetchLatestBreaches,
  searchBreachesRemote,
  computeBreachStatistics,
  type BreachStatistics,
  type HibpBreach,
} from '@/services/security/hibp-service';
import {
  renderLatestTab,
  renderSearchTab,
  renderStatisticsTab,
} from './hibp-breaches-tab';

type Tab = 'latest' | 'search' | 'stats';

const TAB_STORAGE_KEY = 'cb:hibp-breaches-tab';
const TAB_LABELS: Record<Tab, string> = {
  latest: 'Latest',
  search: 'Search',
  stats: 'Statistics',
};

export class HibpBreachesPanel extends Panel {
  private activeTab: Tab = readStoredTab();
  private query = '';
  private hits: HibpBreach[] = [];
  private latest: HibpBreach[] = [];
  private stats: BreachStatistics | null = null;
  private latestLoaded = false;
  private statsLoaded = false;
  private searchLoading = false;
  private statsLoading = false;
  private latestLoading = false;
  private searchAbort: AbortController | null = null;
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super({
      id: 'hibp-breaches',
      title: 'HIBP Breaches',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'haveibeenpwned.com public breach list — 600+ known breaches with severity classification by data class. 24h cache.',
    });
    this.render();
    // Defer initial fetch until after the constructor returns so the
    // constructor itself is synchronous (sonarjs/no-async-constructor).
    setTimeout(() => { void this.ensureTabData(this.activeTab); }, 0);
  }

  // ── Data loading ───────────────────────────────────────────────────

  private async ensureTabData(tab: Tab): Promise<void> {
    if (tab === 'latest' && !this.latestLoaded) {
      this.latestLoading = true;
      this.render();
      this.latest = await fetchLatestBreaches();
      this.latestLoaded = true;
      this.latestLoading = false;
      this.setCount(this.latest.length);
      this.render();
      return;
    }
    if (tab === 'stats' && !this.statsLoaded) {
      this.statsLoading = true;
      this.render();
      const all = await fetchAllBreaches();
      this.stats = computeBreachStatistics(all);
      this.statsLoaded = true;
      this.statsLoading = false;
      this.render();
    }
  }

  private async runSearch(query: string): Promise<void> {
    if (this.searchAbort) this.searchAbort.abort();
    const controller = new AbortController();
    this.searchAbort = controller;
    this.query = query;
    if (!query.trim()) {
      this.hits = [];
      this.searchLoading = false;
      this.render();
      return;
    }
    this.searchLoading = true;
    this.render();
    try {
      const results = await searchBreachesRemote(query, 50);
      if (controller.signal.aborted) return;
      this.hits = results;
    } finally {
      if (!controller.signal.aborted) {
        this.searchLoading = false;
        this.render();
      }
    }
  }

  // ── Rendering ──────────────────────────────────────────────────────

  private render(): void {
    let body: string;
    switch (this.activeTab) {
      case 'latest': { body = renderLatestTab(this.latest, this.latestLoading); break; }
      case 'search': { body = renderSearchTab(this.query, this.hits, this.searchLoading); break; }
      case 'stats': { body = renderStatisticsTab(this.stats, this.statsLoading); break; }
    }
    this.setContent(`${this.renderTabStrip()}<div style="padding:0 2px;">${body}</div>`, () => this.wireHandlers());
  }

  private renderTabStrip(): string {
    const tabs: Tab[] = ['latest', 'search', 'stats'];
    return `<div class="hibp-tab-strip" role="tablist" style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;">${tabs
      .map((tab) => {
        const active = tab === this.activeTab;
        const bg = active ? 'rgba(96,165,250,0.18)' : 'transparent';
        return `<button class="hibp-tab" data-tab="${tab}" role="tab" aria-selected="${active}" type="button" style="padding:4px 10px;border:1px solid rgba(255,255,255,0.12);background:${bg};color:inherit;border-radius:4px;cursor:pointer;font-size:12px;">${TAB_LABELS[tab]}</button>`;
      })
      .join('')}</div>`;
  }

  private wireHandlers(): void {
    const root = this.getElement();
    if (!root) return;
    for (const btn of root.querySelectorAll<HTMLButtonElement>('.hibp-tab')) {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab as Tab | undefined;
        if (!tab || tab === this.activeTab) return;
        this.activeTab = tab;
        try { localStorage.setItem(TAB_STORAGE_KEY, tab); } catch { /* noop */ }
        this.render();
        void this.ensureTabData(tab);
      });
    }
    const input = root.querySelector<HTMLInputElement>('.hibp-search-input');
    if (input) {
      const len = input.value.length;
      input.focus();
      try { input.setSelectionRange(len, len); } catch { /* noop */ }
      input.addEventListener('input', () => {
        const value = input.value;
        if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
        this.searchDebounceTimer = setTimeout(() => { void this.runSearch(value); }, 250);
      });
    }
  }
}

function readStoredTab(): Tab {
  try {
    const stored = localStorage.getItem(TAB_STORAGE_KEY);
    if (stored === 'latest' || stored === 'search' || stored === 'stats') return stored;
  } catch { /* noop */ }
  return 'latest';
}
