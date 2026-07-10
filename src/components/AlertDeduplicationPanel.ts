/**
 * AlertDeduplicationPanel — operator view of duplicate suppression.
 * Shows a stats bar (total / duplicates / overall suppression rate),
 * per-domain suppression-rate bars, a recent-duplicate list with
 * "duplicate of #ID" backlinks, and a config editor per domain.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  getAlertDeduplicationService,
  type AlertDeduplicationService,
  type DeduplicationConfig,
  type DeduplicationRecord,
  type DeduplicationStats,
} from '@/services/intelligence/alert-deduplication';

const REFRESH_MS = 30_000;
const KNOWN_DOMAINS = [
  'earthquake', 'biosurveillance', 'weather', 'maritime',
  'aviation', 'geopolitical', 'cyber', 'wildfire',
];
const DEDUP_LIST_LIMIT = 20;

export class AlertDeduplicationPanel extends Panel {
  private readonly service: AlertDeduplicationService;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private expandedDomain: string | null = null;

  constructor() {
    super({
      id: 'alert-deduplication',
      title: 'Alert Deduplication',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Near-duplicate alert suppression: same domain + similar severity + close location/time → only the first fires.',
    });
    this.service = getAlertDeduplicationService();
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsubscribe = this.service.subscribe(() => this.render());
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
    super.destroy();
  }

  private render(): void {
    try {
      const stats = this.service.getStats();
      const duplicates = this.service.getRecords({ isDuplicate: true }, DEDUP_LIST_LIMIT);
      this.setCount(stats.duplicates);
      this.setContent(this.buildHtml(stats, duplicates), () => this.wireHandlers());
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical);">Dedup panel error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private buildHtml(stats: DeduplicationStats, duplicates: readonly DeduplicationRecord[]): string {
    return `${renderStatsBar(stats)}${this.renderDomainList(stats)}${renderDuplicatesList(duplicates)}`;
  }

  private renderDomainList(stats: DeduplicationStats): string {
    const domains = new Set<string>([...KNOWN_DOMAINS, ...Object.keys(stats.byDomain)]);
    const rows = [...domains].sort((a, b) => a.localeCompare(b)).map((d) => this.renderDomainRow(d, stats)).join('');
    return `<div style="max-height:340px;overflow:auto;border-bottom:1px solid var(--border-subtle,#333);">${rows}</div>`;
  }

  private renderDomainRow(domain: string, stats: DeduplicationStats): string {
    const cell = stats.byDomain[domain] ?? { total: 0, duplicates: 0 };
    const config = this.service.getConfig(domain);
    const suppressionPct = cell.total === 0 ? 0 : Math.round((cell.duplicates / cell.total) * 100);
    const barColor = barColorFor(suppressionPct);
    const isExpanded = this.expandedDomain === domain;
    return `<div class="ad-row" data-domain="${escapeHtml(domain)}" style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#333);cursor:pointer;">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <span style="font-size:9px;font-weight:600;padding:2px 5px;background:rgba(255,255,255,0.06);border-radius:3px;text-transform:uppercase;">${escapeHtml(domain)}</span>
        <span style="font-size:11px;color:var(--text-secondary,#aaa);">${cell.duplicates} / ${cell.total} duplicate${cell.duplicates === 1 ? '' : 's'}</span>
        <span style="margin-left:auto;font-size:11px;font-weight:700;color:${barColor};">${suppressionPct}%</span>
      </div>
      <div style="margin-top:6px;height:4px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;">
        <div style="height:100%;width:${suppressionPct}%;background:${barColor};"></div>
      </div>
      <div style="margin-top:4px;font-size:10px;color:var(--text-secondary,#888);">${renderConfigSummary(config)}</div>
      ${isExpanded ? renderConfigEditor(config) : ''}
    </div>`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();
    for (const row of root.querySelectorAll<HTMLElement>('.ad-row')) {
      row.addEventListener('click', (event) => {
        if ((event.target as HTMLElement).closest('input,button')) return;
        const domain = row.dataset.domain ?? null;
        this.expandedDomain = this.expandedDomain === domain ? null : domain;
        this.render();
      });
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-action="save-config"]')) {
      button.addEventListener('click', () => {
        const domain = button.dataset.domain;
        if (!domain) return;
        const row = button.closest('.ad-row') as HTMLElement | null;
        if (!row) return;
        const windowInput = row.querySelector<HTMLInputElement>('input[data-field="windowMs"]');
        const distInput = row.querySelector<HTMLInputElement>('input[data-field="maxDistanceKm"]');
        const sevInput = row.querySelector<HTMLInputElement>('input[data-field="matchSeverity"]');
        const partial: Partial<DeduplicationConfig> = {};
        const windowMs = windowInput ? Number.parseInt(windowInput.value, 10) : Number.NaN;
        if (Number.isFinite(windowMs) && windowMs > 0) partial.windowMs = windowMs;
        if (distInput) {
          const raw = distInput.value.trim();
          if (raw === '' || raw.toLowerCase() === 'null') partial.maxDistanceKm = null;
          else {
            const km = Number.parseFloat(raw);
            if (Number.isFinite(km) && km >= 0) partial.maxDistanceKm = km;
          }
        }
        if (sevInput) partial.matchSeverity = sevInput.checked;
        this.service.setConfig(domain, partial);
        this.render();
      });
    }
  }
}

function renderStatsBar(stats: DeduplicationStats): string {
  const pct = Math.round(stats.suppressionRate * 100);
  return `<div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#333);display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
    <span style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">Total checks</span>
    <span style="font-size:14px;font-weight:700;">${stats.total}</span>
    <span style="font-size:11px;color:var(--text-secondary,#aaa);">${stats.duplicates} suppressed</span>
    <span style="margin-left:auto;font-size:11px;font-weight:700;color:${barColorFor(pct)};">${pct}% suppression rate</span>
  </div>`;
}

function renderDuplicatesList(duplicates: readonly DeduplicationRecord[]): string {
  if (duplicates.length === 0) {
    return `<div style="padding:14px 16px;color:var(--text-secondary,#aaa);font-size:11px;text-align:center;font-style:italic;">No duplicates suppressed yet.</div>`;
  }
  const rows = duplicates.map((r) => renderDuplicateRow(r)).join('');
  return `<div style="padding:8px 12px;border-bottom:1px solid var(--border-subtle,#333);background:rgba(255,255,255,0.02);">
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary,#aaa);margin-bottom:6px;">Recent duplicates suppressed</div>
    ${rows}
  </div>`;
}

function renderDuplicateRow(r: DeduplicationRecord): string {
  return `<div style="padding:4px 0;font-size:11px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
    <code style="font-size:10px;color:var(--text-secondary,#aaa);">${escapeHtml(r.alertId)}</code>
    <span style="font-size:9px;font-weight:600;padding:1px 4px;background:rgba(255,255,255,0.06);border-radius:2px;text-transform:uppercase;">${escapeHtml(r.domain)}</span>
    <span style="font-size:10px;color:var(--text-secondary,#bbb);">→ duplicate of <code>${escapeHtml(r.primaryAlertId ?? '?')}</code></span>
  </div>`;
}

function renderConfigSummary(config: DeduplicationConfig): string {
  const winMinutes = (config.windowMs / 60_000).toFixed(0);
  const win = winMinutes + 'min';
  const dist = config.maxDistanceKm === null ? 'no geo' : '≤' + config.maxDistanceKm + 'km';
  const sev = config.matchSeverity ? 'match severity' : 'any severity';
  const summary = 'window ' + win + ' · ' + dist + ' · ' + sev;
  return escapeHtml(summary);
}

function renderConfigEditor(config: DeduplicationConfig): string {
  const distValue = config.maxDistanceKm === null ? '' : String(config.maxDistanceKm);
  return `<div style="margin-top:8px;padding:8px;background:rgba(0,0,0,0.18);border-radius:4px;display:flex;flex-direction:column;gap:6px;font-size:10px;">
    <label style="display:flex;align-items:center;gap:6px;">
      <span style="min-width:90px;color:var(--text-secondary,#aaa);">window (ms)</span>
      <input data-field="windowMs" value="${escapeHtml(String(config.windowMs))}" style="flex:1;font-size:10px;padding:3px 6px;background:transparent;color:var(--text-primary,#ddd);border:1px solid var(--border-subtle,#333);border-radius:3px;"/>
    </label>
    <label style="display:flex;align-items:center;gap:6px;">
      <span style="min-width:90px;color:var(--text-secondary,#aaa);">max distance km</span>
      <input data-field="maxDistanceKm" value="${escapeHtml(distValue)}" placeholder="blank = no geo" style="flex:1;font-size:10px;padding:3px 6px;background:transparent;color:var(--text-primary,#ddd);border:1px solid var(--border-subtle,#333);border-radius:3px;"/>
    </label>
    <label style="display:flex;align-items:center;gap:6px;">
      <span style="min-width:90px;color:var(--text-secondary,#aaa);">match severity</span>
      <input type="checkbox" data-field="matchSeverity"${config.matchSeverity ? ' checked' : ''}/>
    </label>
    <div style="display:flex;justify-content:flex-end;">
      <button data-action="save-config" data-domain="${escapeHtml(config.domain)}" style="font-size:10px;padding:3px 10px;background:transparent;color:var(--severity-ok,#4ade80);border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;">Save</button>
    </div>
  </div>`;
}

function barColorFor(pct: number): string {
  if (pct >= 50) return 'var(--severity-critical, #ef4444)';
  if (pct >= 25) return 'var(--severity-high, #fb923c)';
  if (pct >= 10) return 'var(--severity-medium, #facc15)';
  return 'var(--severity-ok, #4ade80)';
}
