/**
 * CVE Tracker Panel — shows NVD CVEs published in the last 30 days,
 * filtered to CVSS ≥ 7.0. Three tabs:
 *   - Critical (CVSS ≥ 9.0)
 *   - High (7.0–8.9)
 *   - Search (free-text across id / description / affected products)
 *
 * Each row links to nvd.nist.gov. Self-driven 24h refresh; the sidecar
 * caches NVD responses on the same TTL so this is essentially free
 * after the first load.
 */
/* eslint-disable sonarjs/no-nested-template-literals -- short row markup */

import { Panel } from './Panel';
import { applyCveQuery, fetchCves, searchCves, type CveRecord } from '@/services/security/cve-service';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
import { SEVERITY_COLOR, formatScore, severityMatchesTab, timeAgo } from './cve-panel-helpers';

type Tab = 'critical' | 'high' | 'search';

const REFRESH_MS = 24 * 60 * 60 * 1000;

export class CveTrackerPanel extends Panel {
  private records: CveRecord[] = [];
  private activeTab: Tab = 'critical';
  private searchQuery = '';
  private lastFetchAt: number | null = null;
  private lastFetchError: string | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'cve-tracker',
      title: 'CVE Tracker',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'NVD CVEs published in the last 30 days, filtered to CVSS ≥ 7.0. Tabs: Critical (≥ 9.0), High (7.0–8.9), Search.',
    });
    this.showLoading('Fetching NVD CVE feed…');
    queueMicrotask(() => { void this.refresh(); });
    this.refreshTimer = setInterval(() => void this.refresh(), REFRESH_MS);
  }

  override destroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  /** Test seam — inject records without hitting the network. */
  public setRecords(records: CveRecord[]): void {
    this.records = records;
    this.lastFetchAt = Date.now();
    this.lastFetchError = null;
    this.render();
  }

  private async refresh(): Promise<void> {
    // Default to "all" — server returns High + Critical only anyway,
    // and the tab filter runs client-side so switching tabs doesn't
    // re-fetch.
    const resp = await fetchCves({ severity: 'all', limit: 200 });
    if (resp.error) {
      this.lastFetchError = resp.error;
    } else {
      this.records = resp.records;
      this.lastFetchError = null;
    }
    this.lastFetchAt = Date.now();
    this.render();
  }

  private render(): void {
    const rows = this.rowsForActiveTab();
    this.setCount(this.records.filter((r) => r.severity === 'critical').length);
    this.setContent(this.buildHtml(rows));
    this.attachHandlers();
  }

  private rowsForActiveTab(): CveRecord[] {
    if (this.activeTab === 'search') {
      return searchCves(this.records, this.searchQuery);
    }
    const filtered = this.records.filter((r) => severityMatchesTab(r.severity, this.activeTab));
    return applyCveQuery(filtered, { severity: 'all', limit: 100 });
  }

  private buildHtml(rows: CveRecord[]): string {
    const tabs: { id: Tab; label: string; count: number }[] = [
      { id: 'critical', label: 'Critical', count: this.records.filter((r) => r.severity === 'critical').length },
      { id: 'high',     label: 'High',     count: this.records.filter((r) => r.severity === 'high').length },
      { id: 'search',   label: 'Search',   count: 0 },
    ];
    const tabBar = tabs.map((t) => `
      <button class="cve-tab${t.id === this.activeTab ? ' cve-tab-active' : ''}" data-cve-tab="${t.id}">
        ${escapeHtml(t.label)}${t.id === 'search' ? '' : ` <span class="cve-tab-count">${t.count}</span>`}
      </button>`).join('');
    const searchBox = this.activeTab === 'search' ? `
      <div class="cve-search-row">
        <input type="text" class="cve-search-input" placeholder="Filter by CVE id, description, or product…"
          value="${escapeHtml(this.searchQuery)}" />
      </div>` : '';
    return `<div class="cve-tracker-panel">
      <div class="cve-tab-bar">${tabBar}</div>
      ${searchBox}
      ${this.renderRows(rows)}
      ${this.renderFooter()}
    </div>`;
  }

  private renderRows(rows: CveRecord[]): string {
    if (rows.length === 0) {
      return `<div class="panel-empty">${this.activeTab === 'search' && this.searchQuery
        ? 'No CVEs match this search.' : 'No CVEs in this tab.'}</div>`;
    }
    const items = rows.map((r) => {
      const color = SEVERITY_COLOR[r.severity];
      const products = r.affectedProducts.length === 0
        ? '<span class="cve-products-empty">—</span>'
        : r.affectedProducts.slice(0, 3).map((p) => `<span class="cve-product">${escapeHtml(p)}</span>`).join('');
      return `<tr class="cve-row cve-${r.severity}">
        <td class="cve-id">
          <a href="${sanitizeUrl(r.nvdUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.id)}</a>
        </td>
        <td class="cve-score" style="color:${color};">
          <span class="cve-score-badge">${escapeHtml(formatScore(r.cvssScore))}</span>
        </td>
        <td class="cve-product-cell">${products}</td>
        <td class="cve-age">${escapeHtml(timeAgo(r.publishedAt))}</td>
      </tr>`;
    }).join('');
    return `<table class="cve-table">
      <thead><tr>
        <th>CVE</th><th>CVSS</th><th>Affected</th><th>Age</th>
      </tr></thead>
      <tbody>${items}</tbody>
    </table>
    <div class="cve-row-detail">
      ${rows.slice(0, 3).map((r) => `<div class="cve-row-summary"><strong>${escapeHtml(r.id)}:</strong> ${escapeHtml(r.description)}</div>`).join('')}
    </div>`;
  }

  private renderFooter(): string {
    if (this.lastFetchError) {
      return `<div class="cve-footer cve-footer-error">⚠ NVD: ${escapeHtml(this.lastFetchError)}</div>`;
    }
    if (this.lastFetchAt === null) {
      return `<div class="cve-footer">Fetching…</div>`;
    }
    return `<div class="cve-footer">Source: nvd.nist.gov · updated ${escapeHtml(timeAgo(new Date(this.lastFetchAt).toISOString()))}</div>`;
  }

  private attachHandlers(): void {
    const root = this.getContentElement();
    for (const btn of root.querySelectorAll<HTMLElement>('[data-cve-tab]')) {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.cveTab as Tab | undefined;
        if (!tab) return;
        this.activeTab = tab;
        this.render();
      });
    }
    const searchInput = root.querySelector<HTMLInputElement>('.cve-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        this.searchQuery = searchInput.value;
        // Re-render only the row block to preserve focus on the input.
        const rowsHost = root.querySelector('.cve-table, .panel-empty');
        if (rowsHost?.parentElement) {
          rowsHost.outerHTML = this.renderRows(this.rowsForActiveTab());
        }
      });
    }
  }
}
