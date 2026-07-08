/* eslint-disable sonarjs/no-nested-template-literals */
/**
 * Source Confidence Panel — Phase 1 UI from
 * docs/superpowers/specs/2026-06-28-redundancy-prediction-enhancement-program-design.md
 * §6.E: "SourceConfidencePanel (new, Phase 1): per-domain redundancy
 * verdict, live disagreements, provider-health timeline."
 *
 * A dedicated surface (SystemDiagnostic's Feeds tab only ever showed a
 * compact "Source corroboration" summary) answering, per data domain:
 *   - Is this fact multi-source verified, or a silent single point of
 *     failure?
 *   - Do the providers currently agree, or is there a live disagreement?
 *   - What is each provider's recent fetch-outcome timeline?
 *
 * Pure composition over the existing engines — no new scoring math:
 *   - `assessProviderRedundancy()` / `getProviderRedundancyReport()` (the
 *     already-wired verdict engine, fed by `fusion-publish.ts`)
 *   - `buildSourceConfidenceView()` (view-model reshaping for this panel)
 *   - `buildProviderTimelines()` (per-provider fetch-outcome ring buffer)
 */

import { Panel } from './Panel';
import { getProviderRedundancyReport } from '@/services/insights/insights-state';
import { getProviderHealthState } from '@/services/providers/providers-state';
import { buildProviderTimelines } from '@/services/providers/provider-health-timeline-view';
import {
  buildSourceConfidenceView,
  type DomainConfidenceView,
  type ProviderRowView,
  type SourceConfidenceView,
} from '@/services/diagnostics/source-confidence-view';
import type { RedundancyTone } from '@/services/diagnostics/provider-redundancy-view';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 15_000;

const TONE_COLOR: Record<RedundancyTone, string> = {
  good: 'var(--severity-ok, #4caf50)',
  warn: 'var(--severity-medium, #ff9800)',
  bad: 'var(--severity-high, #f44336)',
  neutral: 'var(--text-secondary, #9e9e9e)',
};

export class SourceConfidencePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private expanded = new Set<string>();

  constructor() {
    super({
      id: 'source-confidence',
      title: 'Source Confidence',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Per-domain source redundancy: which domains are verified by multiple independent providers, which are single points of failure, and where providers currently disagree. Click a domain to see per-provider health.',
    });
    this.start();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.render(), REFRESH_MS);
    this.content.addEventListener('click', this.onDomainToggle);
    this.content.addEventListener('keydown', this.onDomainKey);
  }

  private readonly onDomainToggle = (ev: Event): void => {
    const row = (ev.target as Element | null)?.closest('[data-scp-domain]');
    if (!row) return;
    const domain = row.getAttribute('data-scp-domain');
    if (!domain) return;
    this.toggleExpanded(domain);
  };

  private readonly onDomainKey = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const row = (ev.target as Element | null)?.closest('[data-scp-domain]');
    if (!row) return;
    ev.preventDefault();
    const domain = row.getAttribute('data-scp-domain');
    if (!domain) return;
    this.toggleExpanded(domain);
  };

  private toggleExpanded(domain: string): void {
    if (this.expanded.has(domain)) this.expanded.delete(domain);
    else this.expanded.add(domain);
    this.render();
  }

  private render(): void {
    const now = Date.now();
    let view: SourceConfidenceView;
    try {
      const report = getProviderRedundancyReport();
      const providerIds = report.domains.flatMap((d) => d.providers.map((p) => p.providerId));
      const timelines = buildProviderTimelines(getProviderHealthState(), providerIds, now);
      view = buildSourceConfidenceView(report, timelines);
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-high,#f44336);">Source confidence report unavailable: ${escapeHtml(
          error instanceof Error ? error.message : String(error),
        )}</div>`,
      );
      return;
    }
    this.setCount(view.summary.disagreementCount + view.summary.downCount);
    this.setContent(this.buildHtml(view));
  }

  private buildHtml(view: SourceConfidenceView): string {
    if (view.domains.length === 0) {
      return `<div style="padding:12px;color:var(--text-secondary,#888);">No provider domains reporting yet.</div>`;
    }
    const summary = this.buildSummaryStrip(view);
    const cards = view.domains.map((d) => this.buildDomainCard(d)).join('');
    return `${summary}<div style="padding:8px 10px;display:flex;flex-direction:column;gap:8px;">${cards}</div>`;
  }

  private buildSummaryStrip(view: SourceConfidenceView): string {
    const s = view.summary;
    const chip = (label: string, value: number, tone: RedundancyTone): string => {
      if (value === 0 && tone !== 'good') return '';
      return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:${TONE_COLOR[tone]};">
        <span style="width:7px;height:7px;border-radius:50%;background:${TONE_COLOR[tone]};display:inline-block;"></span>
        ${value} ${escapeHtml(label)}
      </span>`;
    };
    return `<div style="padding:8px 12px;border-bottom:1px solid var(--border-subtle,#333);display:flex;flex-wrap:wrap;gap:14px;align-items:center;">
      <span style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(s.headline)}</span>
      ${chip('fusion-verified', s.fusionVerifiedCount, 'good')}
      ${chip('disagreeing', s.disagreementCount, 'bad')}
      ${chip('single-source', s.singleSourceCount, 'warn')}
      ${chip('down', s.downCount, 'bad')}
    </div>`;
  }

  private buildDomainCard(d: DomainConfidenceView): string {
    const isOpen = this.expanded.has(d.domain);
    const color = TONE_COLOR[d.tone];
    const fusionTag = buildFusionTag(d);
    const remediation = d.remediation
      ? `<div style="font-size:11px;color:var(--accent,#4a9eff);margin-top:4px;">→ ${escapeHtml(d.remediation)}</div>`
      : '';
    const body = isOpen ? this.buildProviderList(d.providers) : '';
    return `<div style="border:1px solid var(--border-subtle,#333);border-radius:4px;overflow:hidden;">
      <div
        data-scp-domain="${escapeHtml(d.domain)}"
        role="button"
        tabindex="0"
        aria-expanded="${isOpen ? 'true' : 'false'}"
        style="padding:8px 10px;cursor:pointer;"
      >
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <div style="display:flex;align-items:center;gap:6px;min-width:0;">
            <span style="color:${color};font-weight:700;font-size:11px;text-transform:uppercase;">${escapeHtml(d.label)}</span>
            <span style="font-weight:600;">${escapeHtml(d.domain)}</span>
            ${fusionTag}
          </div>
          <span style="font-size:10px;color:var(--text-secondary,#aaa);white-space:nowrap;">${escapeHtml(d.corroborationText)} · conf ${d.confidencePct}%</span>
        </div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:4px;">${escapeHtml(d.detail)}</div>
        ${remediation}
      </div>
      ${body}
    </div>`;
  }

  private buildProviderList(providers: readonly ProviderRowView[]): string {
    if (providers.length === 0) {
      return `<div style="padding:8px 10px;border-top:1px solid var(--border-subtle,#222);color:var(--text-secondary,#777);font-size:11px;">No providers reported for this domain.</div>`;
    }
    const rows = providers.map((p) => this.buildProviderRow(p)).join('');
    return `<div style="border-top:1px solid var(--border-subtle,#222);background:var(--bg-elevated,rgba(255,255,255,0.02));padding:6px 10px;display:flex;flex-direction:column;gap:6px;">${rows}</div>`;
  }

  private buildProviderRow(p: ProviderRowView): string {
    const color = TONE_COLOR[p.tone];
    const primaryTag = p.primary
      ? `<span style="font-size:9px;font-weight:700;color:var(--text-secondary,#888);letter-spacing:0.04em;">PRIMARY</span>`
      : '';
    const disagreeTag = p.disagreeing
      ? `<span style="font-size:9px;font-weight:700;padding:1px 4px;border-radius:2px;background:rgba(244,67,54,0.15);color:var(--severity-high,#f44336);">DISAGREES</span>`
      : '';
    const successRate = p.successRatePct === undefined ? '—' : `${p.successRatePct}%`;
    const lastSuccess = p.lastSuccessAt === undefined ? 'never' : timeAgo(p.lastSuccessAt);
    const fingerprintColor = p.disagreeing ? 'var(--severity-high,#f44336)' : 'var(--text-secondary,#888)';
    const fingerprint = p.fingerprint
      ? `<span style="font-family:ui-monospace,monospace;font-size:10px;color:${fingerprintColor};">fp:${escapeHtml(p.fingerprint)}</span>`
      : '';
    const timeline = p.timeline ? buildTimelineDots(p.timeline) : '';
    return `<div style="display:flex;flex-direction:column;gap:2px;padding:4px 0;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:6px;min-width:0;">
          <span style="width:7px;height:7px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0;"></span>
          <span style="font-size:11px;font-weight:600;">${escapeHtml(p.label)}</span>
          ${primaryTag}
          ${disagreeTag}
        </div>
        <div style="display:flex;align-items:center;gap:8px;font-size:10px;color:var(--text-secondary,#888);">
          <span>${escapeHtml(p.levelLabel)}</span>
          <span>${successRate} success</span>
          <span>last: ${escapeHtml(lastSuccess)}</span>
          ${fingerprint}
        </div>
      </div>
      ${timeline}
    </div>`;
  }
}

// ── Pure rendering helpers (kept inline: DOM-string builders, not
//    view-model logic — the actual view-model lives in source-confidence-view.ts) ──

function buildFusionTag(d: DomainConfidenceView): string {
  if (d.fusionActive) {
    return `<span style="font-size:9px;font-weight:700;letter-spacing:0.04em;padding:1px 5px;border-radius:2px;background:rgba(76,175,80,0.15);color:var(--severity-ok,#4caf50);">FUSED</span>`;
  }
  if (d.verdict === 'single_source') {
    return `<span style="font-size:9px;font-weight:700;letter-spacing:0.04em;padding:1px 5px;border-radius:2px;background:rgba(255,152,0,0.15);color:var(--severity-medium,#ff9800);">SPOF</span>`;
  }
  return '';
}

function buildTimelineDots(timeline: NonNullable<ProviderRowView['timeline']>): string {
  if (timeline.points.length === 0) {
    return `<div style="font-size:9px;color:var(--text-secondary,#666);">No fetch history yet.</div>`;
  }
  const dots = timeline.points
    .map((pt) => {
      const dotColor = pt.ok ? 'var(--severity-ok,#4caf50)' : 'var(--severity-high,#f44336)';
      const title = `${pt.ok ? 'ok' : 'fail'} · ${new Date(pt.at).toLocaleTimeString()}${pt.httpStatus ? ` · HTTP ${pt.httpStatus}` : ''}`;
      return `<span title="${escapeHtml(title)}" style="width:6px;height:6px;border-radius:1px;background:${dotColor};display:inline-block;"></span>`;
    })
    .join('');
  return `<div style="display:flex;align-items:center;gap:2px;margin-top:2px;" role="img" aria-label="Recent fetch outcomes, oldest to newest">${dots}</div>`;
}

function timeAgo(epoch: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - epoch) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}
