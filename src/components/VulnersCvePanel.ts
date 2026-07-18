/**
 * Vulners CVE Panel — trending CVEs sorted by EPSS (Exploit Prediction
 * Scoring System) probability. Two columns: list on the left, detail
 * pane on the right. Click a row to populate the detail pane.
 */
/* eslint-disable sonarjs/no-nested-template-literals -- short row markup */

import { Panel } from './Panel';
import { fetchVulnersCves, type VulnersRecord } from '@/services/security/vulners-service';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
import {
  EPSS_TIER_BADGE,
  SEVERITY_COLOR,
  formatEpssPct,
  formatScore,
  timeAgo,
} from './cve-panel-helpers';

const REFRESH_MS = 6 * 60 * 60 * 1000;

export class VulnersCvePanel extends Panel {
  private records: VulnersRecord[] = [];
  private selectedId: string | null = null;
  private lastFetchAt: number | null = null;
  private lastFetchError: string | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'vulners-cve',
      title: 'Vulners CVE',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Trending CVEs cross-referenced with EPSS (Exploit Prediction Scoring System). EPSS > 0.5 = Critical exploit risk; 0.1–0.5 = Elevated; < 0.1 = Low.',
    });
    this.showLoading('Fetching trending CVEs + EPSS scores…');
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
  public setRecords(records: VulnersRecord[]): void {
    this.records = records;
    this.lastFetchAt = Date.now();
    this.lastFetchError = null;
    this.selectedId = records[0]?.id ?? null;
    this.render();
  }

  private async refresh(): Promise<void> {
    const resp = await fetchVulnersCves();
    if (resp.error) {
      this.lastFetchError = resp.error;
    } else {
      this.records = resp.records;
      this.lastFetchError = null;
      if (!this.selectedId || !this.records.some((r) => r.id === this.selectedId)) {
        this.selectedId = this.records[0]?.id ?? null;
      }
    }
    this.lastFetchAt = Date.now();
    this.render();
  }

  private render(): void {
    const critical = this.records.filter((r) => r.exploitRiskTier === 'critical').length;
    this.setCount(critical);
    this.setContent(this.buildHtml(), () => this.attachHandlers());
  }

  private buildHtml(): string {
    if (this.records.length === 0 && this.lastFetchError === null) {
      return `<div class="vulners-panel"><div class="panel-empty">No trending CVEs reported yet.</div>${this.renderFooter()}</div>`;
    }
    const selected = this.records.find((r) => r.id === this.selectedId) ?? this.records[0] ?? null;
    return `<div class="vulners-panel">
      <div class="vulners-layout">
        <div class="vulners-list">
          ${this.renderList()}
        </div>
        <div class="vulners-detail">
          ${selected ? this.renderDetail(selected) : '<div class="panel-empty">Pick a CVE to see details.</div>'}
        </div>
      </div>
      ${this.renderFooter()}
    </div>`;
  }

  private renderList(): string {
    const rows = this.records.slice(0, 50).map((r) => {
      const badge = EPSS_TIER_BADGE[r.exploitRiskTier];
      const selected = r.id === this.selectedId ? ' vulners-row-selected' : '';
      return `<div class="vulners-row${selected}" data-vulners-id="${escapeHtml(r.id)}">
        <div class="vulners-row-head">
          <span class="vulners-row-id">${escapeHtml(r.id)}</span>
          <span class="vulners-row-cvss" style="color:${SEVERITY_COLOR[r.severity]};">${escapeHtml(formatScore(r.cvssScore))}</span>
        </div>
        <div class="vulners-row-meta">
          <span class="vulners-row-tier" style="color:${badge.color};">${badge.icon} ${escapeHtml(badge.label)}</span>
          <span class="vulners-row-epss">EPSS ${escapeHtml(formatEpssPct(r.epssScore))}</span>
        </div>
      </div>`;
    }).join('');
    return rows || '<div class="panel-empty">No matches.</div>';
  }

  private renderDetail(r: VulnersRecord): string {
    const badge = EPSS_TIER_BADGE[r.exploitRiskTier];
    const products = r.affectedProducts.length === 0
      ? '<span class="vulners-empty">No affected products listed.</span>'
      : r.affectedProducts.map((p) => `<span class="vulners-product">${escapeHtml(p)}</span>`).join('');
    return `<div class="vulners-detail-head">
        <div class="vulners-detail-id">${escapeHtml(r.id)}</div>
        <div class="vulners-detail-tier" style="color:${badge.color};">
          ${badge.icon} ${escapeHtml(badge.label)} — ${escapeHtml(formatEpssPct(r.epssScore))} EPSS
        </div>
      </div>
      <div class="vulners-detail-row">
        <span class="vulners-detail-label">CVSS</span>
        <span class="vulners-detail-value" style="color:${SEVERITY_COLOR[r.severity]};">
          ${escapeHtml(formatScore(r.cvssScore))} (${escapeHtml(r.severity)})
        </span>
      </div>
      <div class="vulners-detail-row">
        <span class="vulners-detail-label">Vector</span>
        <span class="vulners-detail-value vulners-mono">${escapeHtml(r.cvssVector ?? '—')}</span>
      </div>
      <div class="vulners-detail-row">
        <span class="vulners-detail-label">Published</span>
        <span class="vulners-detail-value">${escapeHtml(timeAgo(r.publishedAt))}</span>
      </div>
      <div class="vulners-detail-row">
        <span class="vulners-detail-label">Affected</span>
        <span class="vulners-detail-value">${products}</span>
      </div>
      <div class="vulners-detail-desc">${escapeHtml(r.description)}</div>
      <div class="vulners-detail-link">
        <a href="${sanitizeUrl(r.nvdUrl)}" target="_blank" rel="noopener noreferrer">View on nvd.nist.gov →</a>
      </div>`;
  }

  private renderFooter(): string {
    if (this.lastFetchError) {
      return `<div class="vulners-footer vulners-footer-error">⚠ ${escapeHtml(this.lastFetchError)}</div>`;
    }
    if (this.lastFetchAt === null) {
      return `<div class="vulners-footer">Fetching…</div>`;
    }
    return `<div class="vulners-footer">NVD · FIRST.org EPSS · updated ${escapeHtml(timeAgo(new Date(this.lastFetchAt).toISOString()))}</div>`;
  }

  private attachHandlers(): void {
    const root = this.getContentElement();
    for (const row of root.querySelectorAll<HTMLElement>('[data-vulners-id]')) {
      row.addEventListener('click', () => {
        const id = row.dataset.vulnersId;
        if (!id || id === this.selectedId) return;
        this.selectedId = id;
        this.render();
      });
    }
  }
}
