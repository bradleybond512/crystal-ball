/**
 * Evidence Graph Panel (panel id: `evidence-graph`).
 *
 * Picks one active Situation and renders the evidence report from
 * `assembleEvidence()`: confirming, contradicting, missing, stale, plus
 * a stacked confidence-bar (spatial + temporal + entity + domain → total).
 * Reads observations from the renderer-side observation-store, situations
 * from situation-store. 30 s auto-refresh; also re-renders on situation
 * lifecycle events.
 */
import { Panel } from './Panel';
import { getActive, getSituation } from '@/services/intelligence/situation-store';
import { getRecent } from '@/services/intelligence/observation-store';
import {
  assembleEvidence,
  expectedSignalsForDomain,
  type ConfidenceBreakdown,
  type ContradictingEvidence,
  type EvidenceReport,
  type EvidenceSource,
  type MissingSignal,
  type StaleInput,
} from '@/services/intelligence/evidence-graph-ux';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30_000;
const OBSERVATION_BUDGET = 200;

const COLORS = {
  confirming: '#2ec27e',
  contradicting: '#e94f37',
  missing: '#f5a524',
  stale: '#9ca3af',
  spatial: '#4a9eff',
  temporal: '#9b59b6',
  entity: '#2ec27e',
  domain: '#f5a524',
} as const;

export class EvidenceGraphPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private liveListener: ((e: Event) => void) | null = null;
  private selectedSituationId: string | null = null;

  constructor() {
    super({
      id: 'evidence-graph',
      title: 'Evidence Graph',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'For one active Situation, shows the evidence currently confirming, contradicting, missing, or stale, with a confidence breakdown across spatial / temporal / entity / domain dimensions.',
    });
    this.showLoading('Assembling evidence…');
    queueMicrotask(() => this.render());
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    if (typeof document !== 'undefined') {
      this.liveListener = (): void => this.render();
      document.addEventListener('wm:situation-created', this.liveListener);
      document.addEventListener('wm:situation-updated', this.liveListener);
    }
  }

  override destroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.liveListener && typeof document !== 'undefined') {
      document.removeEventListener('wm:situation-created', this.liveListener);
      document.removeEventListener('wm:situation-updated', this.liveListener);
      this.liveListener = null;
    }
    super.destroy();
  }

  /** Test seam — let external callers force the current selection. */
  public setSelectedSituationId(id: string | null): void {
    this.selectedSituationId = id;
    this.render();
  }

  private render(): void {
    const active = getActive();
    if (active.length === 0) {
      this.setCount(0);
      this.setContent('<div class="evgraph-panel"><div class="panel-empty">No active situations to grade.</div></div>');
      return;
    }
    // Pick the highest-severity situation by default; fall back to the
    // first one. Persist the user's manual pick across refreshes if the
    // situation is still active.
    const selectedId = this.selectedSituationId
      && active.some((s) => s.id === this.selectedSituationId)
      ? this.selectedSituationId
      : active[0]!.id;
    this.selectedSituationId = selectedId;

    const situation = getSituation(selectedId);
    if (!situation) {
      this.setCount(0);
      this.setContent('<div class="evgraph-panel"><div class="panel-empty">Selected situation no longer in store.</div></div>');
      return;
    }

    const events = getRecent(OBSERVATION_BUDGET);
    const report = assembleEvidence({ situation, events });
    this.setCount(report.confirming.length);
    this.setContent(this.buildHtml(active, selectedId, report, situation.domain));
    this.attachHandlers();
  }

  private buildHtml(
    active: ReturnType<typeof getActive>,
    selectedId: string,
    report: EvidenceReport,
    domain: string,
  ): string {
    const options = active.map((s) => {
      const sel = s.id === selectedId ? ' selected' : '';
      const label = `${s.name} — ${s.severity}`;
      return `<option value="${escapeHtml(s.id)}"${sel}>${escapeHtml(label)}</option>`;
    }).join('');

    const lastVerified = report.lastVerified > 0
      ? new Date(report.lastVerified).toISOString().replace('T', ' ').slice(0, 19) + 'Z'
      : '—';

    return `<div class="evgraph-panel" style="display:flex;flex-direction:column;gap:10px;padding:10px;font-size:12px;line-height:1.45;">
      <div class="evgraph-header" style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <select class="evgraph-select" style="flex:1;background:rgba(255,255,255,0.04);color:inherit;border:1px solid rgba(255,255,255,0.12);border-radius:3px;padding:4px 6px;font-size:11px;">
          ${options}
        </select>
        <span style="font-size:10px;opacity:0.6;">last verified ${escapeHtml(lastVerified)}</span>
      </div>
      ${this.renderConfidenceBar(report.confidenceBreakdown)}
      ${this.renderSection('Confirming', COLORS.confirming, report.confirming.map((c) => this.renderConfirming(c)))}
      ${this.renderSection('Contradicting', COLORS.contradicting, report.contradicting.map((c) => this.renderContradicting(c)))}
      ${this.renderSection('Missing', COLORS.missing, this.renderMissingBlock(report.missing, domain))}
      ${this.renderSection('Stale', COLORS.stale, report.stale.map((s) => this.renderStale(s)))}
    </div>`;
  }

  private renderConfidenceBar(b: ConfidenceBreakdown): string {
    const total = Math.max(0, Math.min(100, b.total));
    const widths = {
      spatial: percentOfTotal(b.spatial),
      temporal: percentOfTotal(b.temporal),
      entity: percentOfTotal(b.entity),
      domain: percentOfTotal(b.domain),
    };
    const fillerWidth = Math.max(0, 100 - widths.spatial - widths.temporal - widths.entity - widths.domain);
    return `<div class="evgraph-confidence" style="display:flex;flex-direction:column;gap:4px;">
      <div style="display:flex;justify-content:space-between;font-size:10px;text-transform:uppercase;opacity:0.7;letter-spacing:0.04em;">
        <span>Confidence</span>
        <span>${total.toFixed(0)} / 100</span>
      </div>
      <div style="display:flex;height:10px;border-radius:5px;overflow:hidden;background:rgba(255,255,255,0.06);">
        <div style="width:${widths.spatial}%;background:${COLORS.spatial};" title="Spatial ${b.spatial.toFixed(1)}"></div>
        <div style="width:${widths.temporal}%;background:${COLORS.temporal};" title="Temporal ${b.temporal.toFixed(1)}"></div>
        <div style="width:${widths.entity}%;background:${COLORS.entity};" title="Entity ${b.entity.toFixed(1)}"></div>
        <div style="width:${widths.domain}%;background:${COLORS.domain};" title="Domain ${b.domain.toFixed(1)}"></div>
        <div style="width:${fillerWidth}%;"></div>
      </div>
      <div style="display:flex;gap:8px;font-size:10px;opacity:0.75;flex-wrap:wrap;">
        <span><span style="display:inline-block;width:8px;height:8px;background:${COLORS.spatial};border-radius:2px;margin-right:3px;"></span>Spatial ${b.spatial.toFixed(1)}</span>
        <span><span style="display:inline-block;width:8px;height:8px;background:${COLORS.temporal};border-radius:2px;margin-right:3px;"></span>Temporal ${b.temporal.toFixed(1)}</span>
        <span><span style="display:inline-block;width:8px;height:8px;background:${COLORS.entity};border-radius:2px;margin-right:3px;"></span>Entity ${b.entity.toFixed(1)}</span>
        <span><span style="display:inline-block;width:8px;height:8px;background:${COLORS.domain};border-radius:2px;margin-right:3px;"></span>Domain ${b.domain.toFixed(1)}</span>
      </div>
    </div>`;
  }

  private renderSection(label: string, color: string, rows: string[]): string {
    const body = rows.length === 0
      ? `<div style="opacity:0.55;font-size:11px;padding:4px 0;">No ${label.toLowerCase()} signals.</div>`
      : rows.join('');
    return `<section style="border-left:3px solid ${color};padding:6px 0 6px 10px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.04em;color:${color};font-weight:700;margin-bottom:4px;">${escapeHtml(label)} <span style="opacity:0.55;font-weight:400;">(${rows.length})</span></div>
      ${body}
    </section>`;
  }

  private renderConfirming(c: EvidenceSource): string {
    return `<div style="display:flex;gap:6px;padding:2px 0;font-size:11px;">
      <span style="opacity:0.55;width:55px;flex-shrink:0;">${escapeHtml(c.domain)}</span>
      <span style="flex:1;">${escapeHtml(c.title)}</span>
      <span style="opacity:0.6;font-family:ui-monospace,monospace;">${escapeHtml(c.sourceId)}</span>
      <span style="opacity:0.55;width:42px;text-align:right;">${(c.confidence * 100).toFixed(0)}%</span>
    </div>`;
  }

  private renderContradicting(c: ContradictingEvidence): string {
    return `<div style="display:flex;flex-direction:column;gap:1px;padding:3px 0;font-size:11px;">
      <div style="display:flex;gap:6px;">
        <span style="opacity:0.55;width:55px;flex-shrink:0;">${escapeHtml(c.domain)}</span>
        <span style="flex:1;">${escapeHtml(c.title)}</span>
        <span style="opacity:0.6;font-family:ui-monospace,monospace;">${escapeHtml(c.sourceId)}</span>
      </div>
      <div style="opacity:0.7;font-size:10px;padding-left:61px;">${escapeHtml(c.reason)}</div>
    </div>`;
  }

  private renderMissingBlock(missing: MissingSignal[], domain: string): string[] {
    if (missing.length > 0) {
      return missing.map((m) =>
        `<div style="display:flex;gap:6px;padding:2px 0;font-size:11px;">
          <span style="opacity:0.55;width:55px;flex-shrink:0;">${escapeHtml(m.domain)}</span>
          <span style="flex:1;">${escapeHtml(m.expectedSignal)}</span>
        </div>`,
      );
    }
    const expectations = expectedSignalsForDomain(domain);
    if (expectations.length === 0) return [];
    return [
      `<div style="font-size:11px;opacity:0.65;padding:2px 0;">All ${expectations.length} expected ${escapeHtml(domain)} signals present.</div>`,
    ];
  }

  private renderStale(s: StaleInput): string {
    return `<div style="display:flex;gap:6px;padding:2px 0;font-size:11px;">
      <span style="opacity:0.55;width:55px;flex-shrink:0;">${escapeHtml(s.domain)}</span>
      <span style="flex:1;">${escapeHtml(s.title)}</span>
      <span style="opacity:0.6;font-family:ui-monospace,monospace;">${escapeHtml(s.sourceId)}</span>
      <span style="opacity:0.55;">${formatAge(s.ageMs)}</span>
    </div>`;
  }

  private attachHandlers(): void {
    const root = this.getContentElement();
    const select = root.querySelector<HTMLSelectElement>('.evgraph-select');
    select?.addEventListener('change', () => {
      this.selectedSituationId = select.value;
      this.render();
    });
  }
}

function percentOfTotal(score: number): number {
  // Each sub-score caps at 25 → contributes up to 25% of the bar width.
  return Math.max(0, Math.min(25, score));
}

function formatAge(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 24 * 60 * 60_000) return `${Math.round(ms / (60 * 60_000))}h ago`;
  return `${Math.round(ms / (24 * 60 * 60_000))}d ago`;
}
