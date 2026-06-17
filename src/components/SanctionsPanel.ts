 
import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { getApiBaseUrl } from '@/services/runtime';
import type { SdnEntry } from '@/services/sanctions/ofac-types';

type Tab = 'search' | 'vessels' | 'aircraft';

const TAB_STORAGE_KEY = 'cb:sanctions-tab';
const TAB_LABELS: Record<Tab, string> = {
  search: 'Search',
  vessels: 'Vessels',
  aircraft: 'Aircraft',
};

interface SearchHit { entry: SdnEntry; score: number }

interface CacheMeta {
  ready?: boolean;
  fetchedAt?: number | null;
  entryCount?: number;
  ageMs?: number | null;
  upstreamBytes?: number;
}

export class SanctionsPanel extends Panel {
  private activeTab: Tab = readStoredTab();
  private query = '';
  private hits: SearchHit[] = [];
  private vessels: SdnEntry[] = [];
  private aircraft: SdnEntry[] = [];
  private meta: CacheMeta = {};
  private searchAbort: AbortController | null = null;
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private vesselsLoaded = false;
  private aircraftLoaded = false;

  constructor() {
    super({
      id: 'sanctions-intel',
      title: 'OFAC Sanctions Intel',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'OFAC SDN list — search, vessel and aircraft cross-reference. Cache refreshes weekly from treasury.gov/ofac/downloads/sdn.xml.',
    });
    this.render();
  }

  private async ensureTabData(tab: Tab): Promise<void> {
    if (tab === 'vessels' && !this.vesselsLoaded) {
      this.vesselsLoaded = true;
      await this.loadList('/api/sanctions/vessels', 'vessels');
    }
    if (tab === 'aircraft' && !this.aircraftLoaded) {
      this.aircraftLoaded = true;
      await this.loadList('/api/sanctions/aircraft', 'aircraft');
    }
  }

  private async loadList(path: string, kind: 'vessels' | 'aircraft'): Promise<void> {
    const data = await fetchJson(path);
    if (!data) return;
    const list = (data as Record<string, unknown>)[kind];
    if (!Array.isArray(list)) return;
    if (kind === 'vessels') {
      this.vessels = list as SdnEntry[];
      this.setCount(this.vessels.length);
    } else {
      this.aircraft = list as SdnEntry[];
    }
    this.meta = (data as { meta?: CacheMeta }).meta ?? this.meta;
    if (this.activeTab === kind) this.render();
  }

  private async runSearch(query: string): Promise<void> {
    if (this.searchAbort) this.searchAbort.abort();
    const controller = new AbortController();
    this.searchAbort = controller;
    this.query = query;
    if (!query.trim()) {
      this.hits = [];
      this.render();
      return;
    }
    try {
      const url = `${getApiBaseUrl()}/api/sanctions/search?q=${encodeURIComponent(query)}&limit=50`;
      const r = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!r.ok) return;
      const data = await r.json() as { hits?: SearchHit[]; meta?: CacheMeta };
      if (controller.signal.aborted) return;
      if (!data || typeof data !== 'object') {
        this.hits = [];
        this.render();
        return;
      }
      this.hits = Array.isArray(data.hits) ? data.hits : [];
      this.meta = data.meta ?? this.meta;
      this.render();
    } catch {
      // Aborted or network error — quiet noop.
    }
  }

  private renderTabStrip(): string {
    const tabs: Tab[] = ['search', 'vessels', 'aircraft'];
    return `<div class="sanc-tab-strip" role="tablist" style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">${tabs
      .map((tab) => {
        const active = tab === this.activeTab;
        return `<button class="sanc-tab" data-tab="${tab}" role="tab" aria-selected="${active}" type="button" style="padding:4px 10px;border:1px solid rgba(255,255,255,0.12);background:${active ? 'rgba(96,165,250,0.18)' : 'transparent'};color:inherit;border-radius:4px;cursor:pointer;font-size:12px">${escapeHtml(TAB_LABELS[tab])}</button>`;
      })
      .join('')}</div>`;
  }

  private renderSearchTab(): string {
    const queryAttr = escapeHtml(this.query);
    const meta = this.renderMeta();
    if (!this.query.trim()) {
      return `${this.renderSearchInput(queryAttr)}
        <div class="panel-empty" style="padding:16px 0;text-align:center;opacity:0.7">
          Enter at least one character to search the SDN list.
        </div>
        ${meta}`;
    }
    if (this.hits.length === 0) {
      return `${this.renderSearchInput(queryAttr)}
        <div class="panel-empty" style="padding:16px 0;text-align:center;opacity:0.7">
          No matches for "${queryAttr}".
        </div>
        ${meta}`;
    }
    const rows = this.hits.map((h) => this.renderHitRow(h)).join('');
    return `${this.renderSearchInput(queryAttr)}
      <table class="eq-table" style="width:100%;font-size:12px">
        <thead><tr><th>Type</th><th>Name</th><th>Programs</th><th>Country</th><th style="text-align:right">Score</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${meta}`;
  }

  private renderSearchInput(value: string): string {
    return `<input type="search" class="sanc-search-input" placeholder="Search OFAC SDN…" value="${value}"
      style="width:100%;padding:6px 10px;margin-bottom:8px;background:rgba(255,255,255,0.04);color:inherit;border:1px solid rgba(255,255,255,0.12);border-radius:4px;font-size:13px" />`;
  }

  private renderHitRow(h: SearchHit): string {
    const e = h.entry;
    const programs = e.programs.length === 0 ? '—' : e.programs.map((p) => `<span style="padding:1px 4px;border-radius:3px;background:rgba(248,113,113,0.14);font-size:10px;margin-right:2px">${escapeHtml(p)}</span>`).join('');
    const country = e.countries[0] ?? (e.vessel?.vesselFlag ?? '—');
    return `<tr>
      <td>${typeBadge(e.type)}</td>
      <td><strong>${escapeHtml(e.name)}</strong></td>
      <td>${programs}</td>
      <td>${escapeHtml(country)}</td>
      <td style="text-align:right;opacity:0.7">${h.score}</td>
    </tr>`;
  }

  private renderVesselsTab(): string {
    if (!this.vesselsLoaded) {
      return `<div class="panel-empty" style="padding:16px 0;text-align:center;opacity:0.7">Loading sanctioned vessels…</div>`;
    }
    if (this.vessels.length === 0) {
      return `<div class="panel-empty" style="padding:16px 0;text-align:center;opacity:0.7">No vessel entries returned.</div>`;
    }
    const rows = this.vessels.slice(0, 200).map((v) => `<tr>
      <td><strong>${escapeHtml(v.name)}</strong></td>
      <td>${escapeHtml(v.vessel?.vesselFlag ?? '—')}</td>
      <td>${escapeHtml(v.vessel?.vesselType ?? '—')}</td>
      <td><code style="font-size:10px">${escapeHtml(v.vessel?.imo ?? '—')}</code></td>
      <td>${v.programs.map((p) => `<span style="padding:1px 4px;border-radius:3px;background:rgba(248,113,113,0.14);font-size:10px;margin-right:2px">${escapeHtml(p)}</span>`).join('') || '—'}</td>
    </tr>`).join('');
    return `<table class="eq-table" style="width:100%;font-size:12px">
      <thead><tr><th>Vessel</th><th>Flag</th><th>Type</th><th>IMO</th><th>Program</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="opacity:0.65;font-size:11px;margin-top:6px">Showing ${Math.min(this.vessels.length, 200)} of ${this.vessels.length} sanctioned vessels.</div>
    ${this.renderMeta()}`;
  }

  private renderAircraftTab(): string {
    if (!this.aircraftLoaded) {
      return `<div class="panel-empty" style="padding:16px 0;text-align:center;opacity:0.7">Loading sanctioned aircraft…</div>`;
    }
    if (this.aircraft.length === 0) {
      return `<div class="panel-empty" style="padding:16px 0;text-align:center;opacity:0.7">No aircraft entries returned.</div>`;
    }
    const rows = this.aircraft.slice(0, 200).map((a) => `<tr>
      <td><strong>${escapeHtml(a.name)}</strong></td>
      <td>${escapeHtml(a.aircraft?.tailNumber ?? '—')}</td>
      <td>${escapeHtml(a.aircraft?.operator ?? '—')}</td>
      <td>${escapeHtml(a.countries[0] ?? '—')}</td>
      <td>${a.programs.map((p) => `<span style="padding:1px 4px;border-radius:3px;background:rgba(248,113,113,0.14);font-size:10px;margin-right:2px">${escapeHtml(p)}</span>`).join('') || '—'}</td>
    </tr>`).join('');
    return `<table class="eq-table" style="width:100%;font-size:12px">
      <thead><tr><th>Name</th><th>Tail #</th><th>Operator</th><th>Country</th><th>Program</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="opacity:0.65;font-size:11px;margin-top:6px">Showing ${Math.min(this.aircraft.length, 200)} of ${this.aircraft.length} sanctioned aircraft.</div>
    ${this.renderMeta()}`;
  }

  private renderMeta(): string {
    const entryCount = this.meta.entryCount ?? 0;
    const fetchedAt = this.meta.fetchedAt ?? null;
    const ageStr = fetchedAt ? humanAge(Math.floor((Date.now() - fetchedAt) / 1000)) : '—';
    return `<div class="fires-footer" style="display:flex;justify-content:space-between;margin-top:8px;font-size:11px;opacity:0.7">
      <span>Treasury OFAC SDN · ${entryCount.toLocaleString()} entries</span>
      <span>Cache age ${ageStr}</span>
    </div>`;
  }

  private render(): void {
    let body = '';
    switch (this.activeTab) {
      case 'search': { body = this.renderSearchTab(); break; }
      case 'vessels': { body = this.renderVesselsTab(); break; }
      case 'aircraft': { body = this.renderAircraftTab(); break; }
    }
    this.setContent(`${this.renderTabStrip()}${body}`, () => this.wireHandlers());
  }

  private wireHandlers(): void {
    const root = this.getElement();
    if (!root) return;
    for (const btn of root.querySelectorAll<HTMLButtonElement>('.sanc-tab')) {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab as Tab | undefined;
        if (!tab || tab === this.activeTab) return;
        this.activeTab = tab;
        try { localStorage.setItem(TAB_STORAGE_KEY, tab); } catch { /* noop */ }
        this.render();
        void this.ensureTabData(tab);
      });
    }
    const input = root.querySelector<HTMLInputElement>('.sanc-search-input');
    if (input) {
      // Restore focus + caret after re-render so typing isn't disrupted.
      const len = input.value.length;
      input.focus();
      try { input.setSelectionRange(len, len); } catch { /* noop */ }
      input.addEventListener('input', () => {
        const value = input.value;
        if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
        this.searchDebounceTimer = setTimeout(() => { void this.runSearch(value); }, 200);
      });
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function typeBadge(type: SdnEntry['type']): string {
  const colors: Record<SdnEntry['type'], string> = {
    individual: 'rgba(96,165,250,0.18)',
    vessel: 'rgba(34,197,94,0.20)',
    aircraft: 'rgba(245,158,11,0.20)',
    entity: 'rgba(168,85,247,0.18)',
    unknown: 'rgba(255,255,255,0.06)',
  };
  return `<span style="padding:1px 5px;border-radius:3px;background:${colors[type]};font-size:10px;text-transform:uppercase">${escapeHtml(type)}</span>`;
}

function humanAge(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return 'unknown';
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
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

function readStoredTab(): Tab {
  try {
    const stored = localStorage.getItem(TAB_STORAGE_KEY);
    if (stored === 'search' || stored === 'vessels' || stored === 'aircraft') return stored;
  } catch { /* noop */ }
  return 'search';
}
