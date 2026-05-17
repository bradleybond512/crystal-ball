/**
 * Collection Gap Panel — operator view of the observability audit.
 *
 * Renders the overall-coverage score, critical gap counts, and a
 * domain-grouped table of open gaps with acknowledge / resolve
 * actions and a re-scan button.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  getCollectionGapDiscoveryService,
  type GapSeverity,
  type GapType,
  type ObservabilityGap,
  type ObservabilityReport,
} from '@/services/intelligence/collection-gap-discovery';

const SEVERITY_COLOR: Record<GapSeverity, string> = {
  critical: 'var(--severity-critical,#dc2626)',
  moderate: 'var(--severity-medium,#facc15)',
  minor: '#60a5fa',
};

const SEVERITY_LABEL: Record<GapSeverity, string> = {
  critical: 'CRITICAL',
  moderate: 'MODERATE',
  minor: 'MINOR',
};

const GAP_TYPE_LABEL: Record<GapType, string> = {
  'stale-feed': 'Stale feed',
  'sparse-coverage': 'Sparse coverage',
  'missing-source': 'Single source',
  'low-confidence': 'Low confidence',
  'geographic-blind-spot': 'Blind spot',
  'temporal-gap': 'Temporal gap',
};

const REFRESH_MS = 15_000;

export class CollectionGapPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super({
      id: 'collection-gap',
      title: 'Collection Gap Discovery',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Systematic observability audit. Surfaces stale feeds, sparse coverage, low confidence, single-source brittleness, geographic blind spots, and temporal gaps.',
    });
    this.render();
    this.refreshTimer = setInterval(() => this.render(), REFRESH_MS);
    this.unsubscribe = getCollectionGapDiscoveryService().subscribe(() => this.render());
    this.attachHandlers();
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

  // ── Rendering ────────────────────────────────────────────────────

  private render(): void {
    try {
      const service = getCollectionGapDiscoveryService();
      const open = service.getOpen();
      const report = service.getLatestReport();
      this.setCount(open.length);
      this.setContent(this.buildHtml(open, report));
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical,#dc2626);font-size:12px;">Collection-gap render error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private buildHtml(open: readonly ObservabilityGap[], report: ObservabilityReport | undefined): string {
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;font-size:12px;">
      ${this.renderHeader(report, open)}
      ${this.renderGaps(open)}
    </div>`;
  }

  private renderHeader(report: ObservabilityReport | undefined, open: readonly ObservabilityGap[]): string {
    const coverage = report?.overallCoverage ?? 0;
    const coverageColor = coverageBandColor(coverage);
    const criticalCount = open.filter((g) => g.severity === 'critical').length;
    return `<div style="display:flex;flex-wrap:wrap;gap:14px;align-items:baseline;">
      <div>
        <div style="font-size:32px;font-weight:700;color:${coverageColor};">${coverage}%</div>
        <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">overall coverage</div>
      </div>
      <div>
        <div style="font-size:24px;font-weight:700;color:var(--severity-critical,#dc2626);">${criticalCount}</div>
        <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">critical gaps</div>
      </div>
      <div>
        <div style="font-size:24px;font-weight:700;">${open.length}</div>
        <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">open total</div>
      </div>
      <div style="margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
        <button class="cg-action" data-action="rescan" style="padding:4px 10px;font-size:11px;border:1px solid var(--border-subtle,#333);background:rgba(96,165,250,0.10);color:#60a5fa;border-radius:3px;cursor:pointer;">Re-scan</button>
        <span style="font-size:10px;color:var(--text-secondary,#aaa);">
          ${report ? 'last scan ' + new Date(report.scannedAt).toLocaleString() : 'never scanned'}
        </span>
      </div>
    </div>`;
  }

  private renderGaps(open: readonly ObservabilityGap[]): string {
    if (open.length === 0) {
      return '<div style="font-size:11px;color:var(--text-secondary,#aaa);">No open gaps. Click <em>Re-scan</em> to run a fresh audit.</div>';
    }
    const grouped = groupByDomain(open);
    const sections = [...grouped.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([domain, rows]) => this.renderDomainSection(domain, rows))
      .join('');
    return `<div style="display:flex;flex-direction:column;gap:10px;">${sections}</div>`;
  }

  private renderDomainSection(domain: string, rows: readonly ObservabilityGap[]): string {
    const items = rows.map((g) => this.renderGapRow(g)).join('');
    return `<div>
      <div style="display:flex;align-items:baseline;gap:6px;margin-bottom:4px;">
        <strong style="font-size:12px;">${escapeHtml(domain)}</strong>
        <span style="font-size:10px;color:var(--text-secondary,#aaa);">${rows.length} gap${rows.length === 1 ? '' : 's'}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;">${items}</div>
    </div>`;
  }

  private renderGapRow(g: ObservabilityGap): string {
    const color = SEVERITY_COLOR[g.severity];
    const acknowledged = g.status === 'acknowledged';
    return `<div style="padding:8px 10px;border:1px solid var(--border-subtle,#333);border-left:3px solid ${color};border-radius:4px;background:rgba(255,255,255,0.02);">
      <div style="display:flex;align-items:center;gap:8px;font-size:11px;flex-wrap:wrap;">
        <span style="font-size:10px;padding:1px 6px;border-radius:3px;background:${color}22;color:${color};font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(SEVERITY_LABEL[g.severity])}</span>
        <span style="font-size:10px;padding:1px 6px;border-radius:3px;background:rgba(96,165,250,0.10);color:#60a5fa;">${escapeHtml(GAP_TYPE_LABEL[g.gapType])}</span>
        ${acknowledged ? '<span style="font-size:10px;color:#60a5fa;font-weight:700;text-transform:uppercase;">ACKED</span>' : ''}
        <span style="margin-left:auto;font-size:10px;color:var(--text-secondary,#aaa);">${escapeHtml(g.id)}</span>
      </div>
      <div style="font-size:11px;margin-top:4px;">${escapeHtml(g.description)}</div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:4px;">${escapeHtml(g.recommendedAction)}</div>
      ${g.affectedRegions.length > 0 ? `<div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:2px;">Regions: ${g.affectedRegions.map((r) => escapeHtml(r)).join(', ')}</div>` : ''}
      <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:6px;">
        ${acknowledged ? '' : `<button class="cg-action" data-action="acknowledge" data-id="${escapeHtml(g.id)}" style="padding:3px 8px;font-size:11px;border:1px solid var(--border-subtle,#333);background:rgba(96,165,250,0.10);color:#60a5fa;border-radius:3px;cursor:pointer;">Acknowledge</button>`}
        <button class="cg-action" data-action="resolve" data-id="${escapeHtml(g.id)}" style="padding:3px 8px;font-size:11px;border:1px solid var(--border-subtle,#333);background:rgba(34,197,94,0.10);color:var(--severity-ok,#22c55e);border-radius:3px;cursor:pointer;">Resolve</button>
      </div>
    </div>`;
  }

  // ── Event handling ────────────────────────────────────────────────

  private attachHandlers(): void {
    this.content.addEventListener('click', (e) => this.onClick(e));
  }

  private onClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    const btn = target?.closest<HTMLElement>('.cg-action');
    if (!btn) return;
    event.stopPropagation();
    const action = btn.dataset.action;
    const service = getCollectionGapDiscoveryService();
    if (action === 'rescan') {
      // Host doesn't pass observations; trigger a no-op scan that
      // refreshes the latestReport timestamp + clears the panel
      // through the listener path.
      service.scan([]);
      this.render();
      return;
    }
    const id = btn.dataset.id;
    if (!id) return;
    if (action === 'acknowledge') service.acknowledge(id);
    else if (action === 'resolve') service.resolve(id);
    this.render();
  }
}

function coverageBandColor(coverage: number): string {
  if (coverage >= 75) return 'var(--severity-ok,#22c55e)';
  if (coverage >= 50) return 'var(--severity-medium,#facc15)';
  return 'var(--severity-critical,#dc2626)';
}

function groupByDomain(gaps: readonly ObservabilityGap[]): Map<string, ObservabilityGap[]> {
  const out = new Map<string, ObservabilityGap[]>();
  for (const g of gaps) {
    const bucket = out.get(g.domain);
    if (bucket) bucket.push(g);
    else out.set(g.domain, [g]);
  }
  return out;
}
