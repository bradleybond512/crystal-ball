import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { getApiBaseUrl } from '@/services/runtime';
import { loadProximityConfig } from '@/services/proximity-filter';
import {
  parseOpenaqLocations,
  rankReadings,
  summarizeNearby,
  pickGlobalWorst,
  type MonitorReading,
  type OpenaqLocationRaw,
} from '@/services/airquality/openaq-service';
import type { AqiCategory } from '@/services/airquality/purpleair-helpers';

type Tab = 'nearby' | 'worst' | 'search';

const TAB_STORAGE_KEY = 'cb:openaq-tab';
const TAB_LABELS: Record<Tab, string> = {
  nearby: 'Nearby',
  worst: 'Global Worst',
  search: 'Search',
};

export class OpenaqMonitorPanel extends Panel {
  private activeTab: Tab = readStoredTab();
  private nearby: MonitorReading[] = [];
  private worst: MonitorReading[] = [];
  private searchResults: MonitorReading[] = [];
  private searchQuery = '';
  private nearbyLoaded = false;
  private worstLoaded = false;
  private loadingNearby = false;
  private loadingWorst = false;

  constructor() {
    super({
      id: 'openaq-monitor',
      title: 'Air Quality (OpenAQ)',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'OpenAQ v3 air-quality monitors. Nearby uses your saved home location. PM2.5 readings are scored on the EPA AQI ladder.',
    });
    this.render();
    // Defer the first fetch off the constructor so we don't block the
    // boot path on a network round-trip.
    queueMicrotask(() => { void this.ensureTabData(this.activeTab); });
  }

  private async ensureTabData(tab: Tab): Promise<void> {
    if (tab === 'nearby' && !this.nearbyLoaded && !this.loadingNearby) {
      this.loadingNearby = true;
      await this.loadNearby();
      this.loadingNearby = false;
    }
    if (tab === 'worst' && !this.worstLoaded && !this.loadingWorst) {
      this.loadingWorst = true;
      await this.loadWorst();
      this.loadingWorst = false;
    }
  }

  private async loadNearby(): Promise<void> {
    const config = loadProximityConfig();
    if (!config.location) {
      this.nearbyLoaded = true;
      this.render();
      return;
    }
    const { lat, lon } = config.location;
    const data = await fetchJson(`/api/airquality/openaq?lat=${lat}&lon=${lon}&radius=50000`);
    const locations = (data as { locations?: OpenaqLocationRaw[] } | null)?.locations ?? [];
    this.nearby = summarizeNearby(parseOpenaqLocations(locations), Date.now()).readings;
    this.nearbyLoaded = true;
    this.setCount(this.nearby.length);
    if (this.activeTab === 'nearby') this.render();
  }

  private async loadWorst(): Promise<void> {
    const data = await fetchJson('/api/airquality/openaq/worst');
    const locations = (data as { locations?: OpenaqLocationRaw[] } | null)?.locations ?? [];
    this.worst = pickGlobalWorst(parseOpenaqLocations(locations), Date.now(), 20);
    this.worstLoaded = true;
    if (this.activeTab === 'worst') this.render();
  }

  private async runSearch(query: string): Promise<void> {
    this.searchQuery = query;
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) { this.searchResults = []; this.render(); return; }
    // Search runs against the global-worst payload + nearby. No backend
    // search endpoint — OpenAQ v3 doesn't expose one without a key —
    // so the search tab indexes whatever readings we've already pulled.
    if (!this.worstLoaded) await this.loadWorst();
    if (!this.nearbyLoaded) await this.loadNearby();
    const pool = rankReadings([...this.nearby, ...this.worst], Date.now());
    this.searchResults = pool.filter((r) => (
      r.station.toLowerCase().includes(trimmed) ||
      (r.city ?? '').toLowerCase().includes(trimmed) ||
      (r.country ?? '').toLowerCase().includes(trimmed)
    )).slice(0, 50);
    this.render();
  }

  // ─── Rendering ─────────────────────────────────────────────────────

  private renderTabStrip(): string {
    const tabs: Tab[] = ['nearby', 'worst', 'search'];
    return `<div class="oaq-tab-strip" role="tablist" style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">${tabs
      .map((tab) => {
        const active = tab === this.activeTab;
        return `<button class="oaq-tab" data-tab="${tab}" role="tab" aria-selected="${active}" type="button" style="padding:4px 10px;border:1px solid rgba(255,255,255,0.12);background:${active ? 'rgba(96,165,250,0.18)' : 'transparent'};color:inherit;border-radius:4px;cursor:pointer;font-size:12px">${escapeHtml(TAB_LABELS[tab])}</button>`;
      }).join('')}</div>`;
  }

  private renderNearbyTab(): string {
    if (this.loadingNearby) return emptyState('Loading nearby stations…');
    const config = loadProximityConfig();
    if (!config.location) {
      return emptyState('Set a home location in Settings → General to see nearby air-quality stations.');
    }
    if (this.nearby.length === 0) {
      return emptyState('No OpenAQ stations within 50 km of your saved location.');
    }
    return this.renderReadingsTable(this.nearby);
  }

  private renderWorstTab(): string {
    if (this.loadingWorst) return emptyState('Loading global worst PM2.5 readings…');
    if (this.worst.length === 0) return emptyState('No global PM2.5 readings available right now.');
    return this.renderReadingsTable(this.worst);
  }

  private renderSearchTab(): string {
    const queryAttr = escapeHtml(this.searchQuery);
    const input = `<input type="search" class="oaq-search-input" placeholder="Search by station / city / country…" value="${queryAttr}"
      style="width:100%;padding:6px 10px;margin-bottom:8px;background:rgba(255,255,255,0.04);color:inherit;border:1px solid rgba(255,255,255,0.12);border-radius:4px;font-size:13px" />`;
    if (!this.searchQuery.trim()) {
      return `${input}${emptyState('Type a station, city, or country to search loaded readings.')}`;
    }
    if (this.searchResults.length === 0) {
      const empty = emptyState(`No matches for "${queryAttr}".`);
      return `${input}${empty}`;
    }
    return `${input}${this.renderReadingsTable(this.searchResults)}`;
  }

  private renderReadingsTable(rows: readonly MonitorReading[]): string {
    const trs = rows.map((r) => renderReadingRow(r)).join('');
    return `<table class="eq-table" style="width:100%;font-size:12px">
      <thead><tr>
        <th>Station</th>
        <th>Param</th>
        <th style="text-align:right">Value</th>
        <th>AQI</th>
        <th>Updated</th>
      </tr></thead>
      <tbody>${trs}</tbody>
    </table>
    <div style="opacity:0.65;font-size:11px;margin-top:6px">Source: OpenAQ v3 · 30-min cache</div>`;
  }

  private render(): void {
    let body = '';
    switch (this.activeTab) {
      case 'nearby': { body = this.renderNearbyTab(); break; }
      case 'worst': { body = this.renderWorstTab(); break; }
      case 'search': { body = this.renderSearchTab(); break; }
    }
    this.setContent(`${this.renderTabStrip()}${body}`, () => this.wireHandlers());
  }

  private wireHandlers(): void {
    const root = this.getElement();
    if (!root) return;
    for (const btn of root.querySelectorAll<HTMLButtonElement>('.oaq-tab')) {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab as Tab | undefined;
        if (!tab || tab === this.activeTab) return;
        this.activeTab = tab;
        try { localStorage.setItem(TAB_STORAGE_KEY, tab); } catch { /* noop */ }
        this.render();
        void this.ensureTabData(tab);
      });
    }
    const input = root.querySelector<HTMLInputElement>('.oaq-search-input');
    if (input) {
      const len = input.value.length;
      input.focus();
      try { input.setSelectionRange(len, len); } catch { /* noop */ }
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      input.addEventListener('input', () => {
        const value = input.value;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => { void this.runSearch(value); }, 200);
      });
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function renderReadingRow(r: MonitorReading): string {
  const countrySuffix = r.country ? `, ${r.country}` : '';
  const location = r.city ? `${r.station} · ${r.city}${countrySuffix}` : r.station;
  const updated = r.observedAt ? timeAgo(r.observedAt) : '—';
  const valueStr = `${r.value.toFixed(1)} ${escapeHtml(r.unit)}`;
  const aqiCell = r.aqi === null
    ? '<span style="opacity:0.5">—</span>'
    : `<span style="padding:2px 6px;border-radius:3px;background:${categoryBackground(r.category)};font-size:10px">${categoryEmoji(r.category)} ${r.aqi}</span>`;
  return `<tr>
    <td>${escapeHtml(location)}</td>
    <td><code style="font-size:10px;opacity:0.75">${escapeHtml(r.parameter)}</code></td>
    <td style="text-align:right">${valueStr}</td>
    <td>${aqiCell}</td>
    <td style="opacity:0.7">${updated}</td>
  </tr>`;
}

function categoryEmoji(c: AqiCategory | null): string {
  switch (c) {
    case 'good': { return '🟢';
    }
    case 'moderate': { return '🟡';
    }
    case 'sensitive': { return '🟠';
    }
    case 'unhealthy': { return '🔴';
    }
    case 'very_unhealthy': { return '🟣';
    }
    case 'hazardous': { return '🟤';
    }
    default: { return '⚪';
    }
  }
}

function categoryBackground(c: AqiCategory | null): string {
  switch (c) {
    case 'good': { return 'rgba(34,197,94,0.18)';
    }
    case 'moderate': { return 'rgba(250,204,21,0.22)';
    }
    case 'sensitive': { return 'rgba(251,146,60,0.24)';
    }
    case 'unhealthy': { return 'rgba(248,113,113,0.28)';
    }
    case 'very_unhealthy': { return 'rgba(168,85,247,0.28)';
    }
    case 'hazardous': { return 'rgba(120,53,15,0.36)';
    }
    default: { return 'rgba(255,255,255,0.06)';
    }
  }
}

function emptyState(message: string): string {
  return `<div class="panel-empty" style="padding:16px 0;text-align:center;opacity:0.75">${escapeHtml(message)}</div>`;
}

function timeAgo(epoch: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - epoch) / 1000));
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

function readStoredTab(): Tab {
  try {
    const stored = localStorage.getItem(TAB_STORAGE_KEY);
    if (stored === 'nearby' || stored === 'worst' || stored === 'search') return stored;
  } catch { /* noop */ }
  return 'nearby';
}
