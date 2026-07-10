/**
 * Collection Gap Panel — operator view of the observability audit.
 *
 * Renders open gap count by severity, domain breakdown, and a
 * gap table with per-gap resolve actions and a refresh button.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  getCollectionGapDiscoveryService,
  type GapSeverity,
  type GapType,
  type CollectionGap,
} from '@/services/intelligence/collection-gap-discovery';

const SEVERITY_COLOR: Record<GapSeverity, string> = {
  high:   'var(--severity-critical,#dc2626)',
  medium: 'var(--severity-medium,#facc15)',
  low:    '#60a5fa',
};

const SEVERITY_LABEL: Record<GapSeverity, string> = {
  high:   'HIGH',
  medium: 'MEDIUM',
  low:    'LOW',
};

const GAP_TYPE_LABEL: Record<GapType, string> = {
  'missing-feed':   'Missing feed',
  'low-coverage':   'Low coverage',
  'stale-data':     'Stale data',
  'no-alerts':      'No alerts',
  'single-source':  'Single source',
};

const REFRESH_MS = 15_000;

export class CollectionGapPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'collection-gap',
      title: 'Collection Gap Discovery',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Systematic observability audit. Surfaces stale data, missing feeds, low coverage regions, absent alerts, and single-source brittleness.',
    });
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.attachHandlers();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  // ── Rendering ────────────────────────────────────────────────────

  private render(): void {
    try {
      const service = getCollectionGapDiscoveryService();
      const open = service.getGaps();
      const stats = service.getStats();
      this.setCount(open.length);
      this.setContent(this.buildHtml(open, stats));
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical,#dc2626);font-size:12px;">Collection-gap render error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private buildHtml(
    open: readonly CollectionGap[],
    stats: ReturnType<ReturnType<typeof getCollectionGapDiscoveryService>['getStats']>,
  ): string {
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;font-size:12px;">
      ${this.renderHeader(open, stats)}
      ${this.renderGaps(open)}
    </div>`;
  }

  private renderHeader(
    open: readonly CollectionGap[],
    stats: ReturnType<ReturnType<typeof getCollectionGapDiscoveryService>['getStats']>,
  ): string {
    const resolutionPct = Math.round(stats.resolutionRate * 100);
    return `<div style="display:flex;flex-wrap:wrap;gap:14px;align-items:baseline;">
      <div>
        <div style="font-size:32px;font-weight:700;color:${open.length === 0 ? 'var(--severity-ok,#22c55e)' : 'var(--severity-critical,#dc2626)'};">${stats.bySeverity.high}</div>
        <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">high severity</div>
      </div>
      <div>
        <div style="font-size:24px;font-weight:700;color:var(--severity-medium,#facc15);">${stats.bySeverity.medium}</div>
        <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">medium</div>
      </div>
      <div>
        <div style="font-size:24px;font-weight:700;color:#60a5fa;">${stats.bySeverity.low}</div>
        <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">low</div>
      </div>
      <div>
        <div style="font-size:24px;font-weight:700;">${resolutionPct}%</div>
        <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">resolved</div>
      </div>
      <div style="margin-left:auto;">
        <button class="cg-action" data-action="refresh" style="padding:4px 10px;font-size:11px;border:1px solid var(--border-subtle,#333);background:rgba(96,165,250,0.10);color:#60a5fa;border-radius:3px;cursor:pointer;">Refresh</button>
      </div>
    </div>`;
  }

  private renderGaps(open: readonly CollectionGap[]): string {
    if (open.length === 0) {
      return '<div style="font-size:11px;color:var(--text-secondary,#aaa);">No open gaps detected.</div>';
    }
    const grouped = groupByDomain(open);
    const sections = [...grouped.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([domain, rows]) => this.renderDomainSection(domain, rows))
      .join('');
    return `<div style="display:flex;flex-direction:column;gap:10px;">${sections}</div>`;
  }

  private renderDomainSection(domain: string, rows: readonly CollectionGap[]): string {
    const items = rows.map((g) => this.renderGapRow(g)).join('');
    return `<div>
      <div style="display:flex;align-items:baseline;gap:6px;margin-bottom:4px;">
        <strong style="font-size:12px;">${escapeHtml(domain)}</strong>
        <span style="font-size:10px;color:var(--text-secondary,#aaa);">${rows.length} gap${rows.length === 1 ? '' : 's'}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;">${items}</div>
    </div>`;
  }

  private renderGapRow(g: CollectionGap): string {
    const color = SEVERITY_COLOR[g.severity];
    const label = SEVERITY_LABEL[g.severity];
    const typeLabel = GAP_TYPE_LABEL[g.gapType] ?? g.gapType;
    return `<div style="padding:8px 10px;border:1px solid var(--border-subtle,#333);border-left:3px solid ${color};border-radius:4px;background:rgba(255,255,255,0.02);">
      <div style="display:flex;align-items:center;gap:8px;font-size:11px;flex-wrap:wrap;">
        <span style="font-size:10px;padding:1px 6px;border-radius:3px;background:${color}22;color:${color};font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(label)}</span>
        <span style="font-size:10px;padding:1px 6px;border-radius:3px;background:rgba(96,165,250,0.10);color:#60a5fa;">${escapeHtml(typeLabel)}</span>
        <span style="margin-left:auto;font-size:10px;color:var(--text-secondary,#aaa);">${escapeHtml(g.id)}</span>
      </div>
      <div style="font-size:11px;margin-top:4px;">${escapeHtml(g.description)}</div>
      <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:6px;">
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
    if (action === 'refresh') {
      this.render();
      return;
    }
    const id = btn.dataset.id;
    if (!id) return;
    if (action === 'resolve') getCollectionGapDiscoveryService().resolveGap(id);
    this.render();
  }
}

function groupByDomain(gaps: readonly CollectionGap[]): Map<string, CollectionGap[]> {
  const out = new Map<string, CollectionGap[]>();
  for (const g of gaps) {
    const bucket = out.get(g.domain);
    if (bucket) bucket.push(g);
    else out.set(g.domain, [g]);
  }
  return out;
}
