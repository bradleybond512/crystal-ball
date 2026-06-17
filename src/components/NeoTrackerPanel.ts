import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import type { CloseApproach, ImpactRiskObject, NeoHazard } from '@/services/space/neo-normalize';
import { fetchNeoSnapshot, type NeoSnapshot } from '@/services/space/neo-service';

const HAZARD_COLOR: Record<NeoHazard, string> = {
  none: '#6b7280',
  notable: '#eab308',
  close: '#f97316',
  very_close: '#dc2626',
};

export class NeoTrackerPanel extends Panel {
  private data: NeoSnapshot | null = null;
  private fetchAbort: AbortController | null = null;

  constructor() {
    super({
      id: 'neo-tracker',
      title: 'Near-Earth Objects',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Upcoming asteroid close approaches (within 0.05 AU / 60 days) and the JPL Sentry impact-risk watchlist. Distances shown in lunar distances (LD). Source: NASA/JPL CNEOS — no API key.',
    });
    this.showLoading('Fetching near-Earth objects…');
  }

  public async update(): Promise<void> {
    this.fetchAbort?.abort();
    const controller = new AbortController();
    this.fetchAbort = controller;
    try {
      const data = await fetchNeoSnapshot(controller.signal);
      this.data = data;
      this.setCount(data.closeApproachCount);
      this.render();
    } catch {
      if (controller.signal.aborted) return;
      if (!this.data) this.setContent('<div class="panel-empty">NEO data unavailable.</div>');
    }
  }

  public override destroy(): void {
    this.fetchAbort?.abort();
    super.destroy();
  }

  private render(): void {
    if (!this.data) return;
    const d = this.data;
    this.setContent(`
      <div class="neo-panel-content">
        ${this.renderApproaches(d.closeApproaches)}
        ${this.renderImpactRisks(d.impactRisks)}
        ${d.degraded ? `<div class="neo-degraded">⚠ ${escapeHtml(d.reason ?? 'degraded')}</div>` : ''}
        <div class="fires-footer">
          <span class="fires-source">${escapeHtml(d.source)} · No API key</span>
          <span class="fires-updated">${escapeHtml(d.closeApproachCount.toString())} approaches · ${escapeHtml(d.impactRiskCount.toString())} risk objects</span>
        </div>
      </div>
    `);
  }

  private renderApproaches(rows: readonly CloseApproach[]): string {
    if (rows.length === 0) {
      return '<div class="neo-section"><div class="neo-section-title">Close Approaches</div><div class="panel-empty">None within range.</div></div>';
    }
    const body = rows.slice(0, 20).map((a) => {
      const color = HAZARD_COLOR[a.hazard];
      const ld = a.distanceLd.toFixed(1);
      const size = a.estDiameterM ? `~${formatMetres(a.estDiameterM)}` : '—';
      const vel = a.velocityKms === null ? '—' : `${a.velocityKms.toFixed(1)} km/s`;
      const when = new Date(a.approachAt).toUTCString().replace('GMT', 'UTC');
      return `
        <div class="neo-row" style="border-left:3px solid ${color};">
          <div class="neo-row-main">
            <span class="neo-des">${escapeHtml(a.designation)}</span>
            <span class="neo-dist" style="color:${color};">${ld} LD</span>
          </div>
          <div class="neo-row-sub">${escapeHtml(size)} · ${escapeHtml(vel)} · ${escapeHtml(when)}</div>
        </div>`;
    }).join('');
    return `<div class="neo-section"><div class="neo-section-title">Close Approaches (next 60 days)</div>${body}</div>`;
  }

  private renderImpactRisks(rows: readonly ImpactRiskObject[]): string {
    if (rows.length === 0) return '';
    const body = rows.slice(0, 10).map((r) => {
      const prob = formatProbability(r.impactProbability);
      const size = r.diameterM ? `~${formatMetres(r.diameterM)}` : '—';
      const ps = r.palermoScaleCum === null ? 'PS —' : `PS ${r.palermoScaleCum.toFixed(2)}`;
      const years = r.yearRange ? escapeHtml(r.yearRange) : '—';
      return `
        <div class="neo-row">
          <div class="neo-row-main">
            <span class="neo-des">${escapeHtml(r.designation)}</span>
            <span class="neo-prob">${escapeHtml(prob)}</span>
          </div>
          <div class="neo-row-sub">${escapeHtml(size)} · ${escapeHtml(ps)} · ${years}</div>
        </div>`;
    }).join('');
    return `<div class="neo-section"><div class="neo-section-title">Sentry Impact-Risk Watchlist</div>${body}</div>`;
  }
}

function formatMetres(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${m} m`;
}

function formatProbability(p: number): string {
  if (p <= 0) return '0';
  if (p >= 0.01) return `${(p * 100).toFixed(1)}%`;
  // e.g. "1 in 12,000"
  const oneIn = Math.round(1 / p);
  return `1 in ${oneIn.toLocaleString('en-US')}`;
}
