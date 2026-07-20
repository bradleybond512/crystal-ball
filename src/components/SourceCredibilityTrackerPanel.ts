/**
 * Source Credibility Tracker Panel — tier breakdown badges, per-source
 * rows with credibility bar + tier badge + domain chip + confirm /
 * refute counts, plus top + worst highlights.
 *
 * Vanilla TS — subscribes to the service for push-driven refresh and
 * falls back to a 10s timer.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  getSourceCredibilityTrackerService,
  type CredibilitySummary,
  type CredibilityTier,
  type SourceFilter,
  type SourceRecord,
} from '@/services/intelligence/source-credibility-tracker';

const REFRESH_MS = 10_000;

const ALL_TIERS: readonly CredibilityTier[] = ['tier-1', 'tier-2', 'tier-3', 'unrated'];

const TIER_COLOR: Record<CredibilityTier, string> = {
  'tier-1': 'var(--severity-info,#22c55e)',
  'tier-2': 'var(--severity-medium,#facc15)',
  'tier-3': 'var(--severity-high,#f87171)',
  unrated: 'var(--text-secondary,#aaa)',
};

const TIER_LABEL: Record<CredibilityTier, string> = {
  'tier-1': 'Tier 1',
  'tier-2': 'Tier 2',
  'tier-3': 'Tier 3',
  unrated: 'Unrated',
};

export class SourceCredibilityTrackerPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private filterDomain = 'all';
  private filterTier: CredibilityTier | 'all' = 'all';

  constructor() {
    super({
      id: 'source-credibility-tracker',
      title: 'Source Credibility Tracker',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Tracks historical accuracy per intelligence source. Confirm/refute feedback updates each source\'s credibility score; the score drives downstream weighting and tier classification.',
    });
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsubscribe = getSourceCredibilityTrackerService().subscribe(() => this.render());
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

  // ── Rendering ──────────────────────────────────────────────────────

  private render(): void {
    try {
      const svc = getSourceCredibilityTrackerService();
      const summary = svc.getSummary();
      const filter: SourceFilter = {};
      if (this.filterDomain !== 'all') filter.domain = this.filterDomain;
      if (this.filterTier !== 'all') filter.tier = this.filterTier;
      const sources = svc.getAllSources(filter);
      const allSources = svc.getAllSources();
      this.setCount(summary.totalSources);
      this.setContent(this.buildHtml(summary, sources, allSources));
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical,#dc2626);font-size:12px;">Credibility tracker render error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private buildHtml(summary: CredibilitySummary, filtered: readonly SourceRecord[], all: readonly SourceRecord[]): string {
    const domains = this.uniqueDomains(all);
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:12px;font-size:12px;">
      ${this.renderSummary(summary)}
      ${this.renderHighlights(summary)}
      ${this.renderFilters(summary, domains)}
      ${this.renderList(filtered)}
    </div>`;
  }

  private uniqueDomains(sources: readonly SourceRecord[]): string[] {
    const set = new Set<string>();
    for (const s of sources) set.add(s.domain);
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  private renderSummary(s: CredibilitySummary): string {
    const avgPct = Math.round(s.avgScore * 100);
    return `<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:baseline;font-size:11px;color:var(--text-secondary,#aaa);">
      <span><strong style="color:var(--text-primary,#fff);font-size:14px;">${s.totalSources}</strong> sources</span>
      <span>avg <strong style="color:var(--text-primary,#fff);">${avgPct}%</strong></span>
      <span style="margin-left:auto;display:flex;gap:8px;">
        ${ALL_TIERS.map((t) =>
          `<span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${TIER_COLOR[t]};margin-right:4px;"></span>${s.byTier[t]} ${escapeHtml(TIER_LABEL[t])}</span>`,
        ).join('')}
      </span>
    </div>`;
  }

  private renderHighlights(s: CredibilitySummary): string {
    if (s.topSources.length === 0 && s.worstSources.length === 0) return '';
    return `<div style="display:flex;gap:12px;flex-wrap:wrap;border-top:1px solid var(--border-subtle,#333);padding-top:10px;">
      ${this.renderHighlightColumn('Top', s.topSources)}
      ${this.renderHighlightColumn('Worst', s.worstSources)}
    </div>`;
  }

  private renderHighlightColumn(label: string, rows: readonly SourceRecord[]): string {
    if (rows.length === 0) return '';
    return `<div style="flex:1;min-width:160px;">
      <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;font-weight:700;margin-bottom:4px;">${escapeHtml(label)}</div>
      ${rows.map((r) => `<div style="display:flex;gap:6px;align-items:baseline;font-size:11px;">
        <span style="font-weight:700;color:var(--text-primary,#fff);width:36px;">${Math.round(r.credibilityScore * 100)}%</span>
        <span>${escapeHtml(r.sourceId)}</span>
      </div>`).join('')}
    </div>`;
  }

  private renderFilters(summary: CredibilitySummary, domains: readonly string[]): string {
    const tierChips = [
      this.renderFilterChip('tier', 'all', `All (${summary.totalSources})`, this.filterTier === 'all'),
      ...ALL_TIERS.map((t) => this.renderFilterChip('tier', t, `${TIER_LABEL[t]} (${summary.byTier[t]})`, this.filterTier === t)),
    ].join('');
    const domainChips = [
      this.renderFilterChip('domain', 'all', 'All domains', this.filterDomain === 'all'),
      ...domains.map((d) => this.renderFilterChip('domain', d, d, this.filterDomain === d)),
    ].join('');
    return `<div style="display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--border-subtle,#333);padding-top:10px;">
      <div style="display:flex;gap:6px;flex-wrap:wrap;">${tierChips}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">${domainChips}</div>
    </div>`;
  }

  private renderFilterChip(kind: 'tier' | 'domain', value: string, label: string, active: boolean): string {
    const bg = active ? 'var(--accent,#4a9eff)' : 'rgba(255,255,255,0.04)';
    const fg = active ? '#fff' : 'var(--text-secondary,#aaa)';
    return `<button class="scrd-filter" data-kind="${escapeHtml(kind)}" data-value="${escapeHtml(value)}" style="padding:3px 8px;font-size:10px;border:1px solid var(--border-subtle,#333);background:${bg};color:${fg};border-radius:3px;cursor:pointer;text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">${escapeHtml(label)}</button>`;
  }

  private renderList(sources: readonly SourceRecord[]): string {
    if (sources.length === 0) {
      return `<div style="padding:14px;text-align:center;font-size:12px;color:var(--text-secondary,#aaa);border-top:1px solid var(--border-subtle,#333);">No sources match the current filter.</div>`;
    }
    return `<div style="display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--border-subtle,#333);padding-top:10px;max-height:340px;overflow-y:auto;">
      ${sources.map((s) => this.renderRow(s)).join('')}
    </div>`;
  }

  private renderRow(s: SourceRecord): string {
    const color = TIER_COLOR[s.tier];
    const pct = Math.round(s.credibilityScore * 100);
    return `<div style="padding:8px 10px;border:1px solid var(--border-subtle,#333);border-radius:4px;background:rgba(255,255,255,0.02);">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <span style="font-size:10px;padding:1px 6px;border-radius:3px;background:${color}22;color:${color};font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(TIER_LABEL[s.tier])}</span>
        <strong style="font-size:12px;">${escapeHtml(s.sourceId)}</strong>
        <span style="font-size:10px;color:var(--text-secondary,#aaa);">${escapeHtml(s.domain)}</span>
        <span style="margin-left:auto;font-size:11px;font-weight:700;color:var(--text-primary,#fff);">${pct}%</span>
      </div>
      <div style="margin-top:5px;display:flex;gap:8px;align-items:center;">
        <div style="flex:1;height:6px;background:rgba(255,255,255,0.04);border-radius:2px;overflow:hidden;">
          <div style="width:${pct}%;height:100%;background:${color};"></div>
        </div>
        <span style="font-size:10px;color:var(--text-secondary,#aaa);">${s.confirmCount}c · ${s.refuteCount}r · ${s.neutralCount}n / ${s.totalReports}</span>
      </div>
    </div>`;
  }

  // ── Events ────────────────────────────────────────────────────────

  private attachHandlers(): void {
    this.content.addEventListener('click', (e) => this.onClick(e));
  }

  private onClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const chip = target.closest<HTMLElement>('.scrd-filter');
    if (!chip) return;
    event.stopPropagation();
    const kind = chip.dataset.kind;
    const value = chip.dataset.value;
    if (!kind || !value) return;
    if (kind === 'tier') {
      this.filterTier = value as CredibilityTier | 'all';
    } else if (kind === 'domain') {
      this.filterDomain = value;
    }
    this.render();
  }
}
