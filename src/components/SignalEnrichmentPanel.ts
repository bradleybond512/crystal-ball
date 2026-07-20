/**
 * Signal Enrichment Panel (panel id: `signal-enrichment`).
 *
 * Stats view at top (total enriched, avg tags per observation, by-source
 * breakdown). Live feed below shows the last 20 enriched observations
 * with their tag chips so operators can see what context the enricher
 * is attaching to incoming signals.
 */
/* eslint-disable sonarjs/no-nested-template-literals */

import { Panel } from './Panel';
import {
  getSignalEnrichmentService,
  type EnrichedObservation,
  type EnrichmentSource,
  type EnrichmentStats,
} from '@/services/intelligence/signal-enrichment';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 15_000;
const FEED_LIMIT = 20;

const SOURCE_COLOR: Record<EnrichmentSource, string> = {
  geo: '#4a9eff',
  entity: '#a78bfa',
  domain: '#2ec27e',
  relationship: '#f5a524',
};

const SOURCE_LABEL: Record<EnrichmentSource, string> = {
  geo: 'Geo',
  entity: 'Entity',
  domain: 'Domain',
  relationship: 'Cascade',
};

const SEVERITY_COLOR: Record<string, string> = {
  INFO: '#9ca3af',
  LOW: '#9ca3af',
  MEDIUM: '#f5a524',
  HIGH: '#e07b30',
  CRITICAL: '#e94f37',
};

export class SignalEnrichmentPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private listener: ((enriched: EnrichedObservation) => void) | null = null;
  private feed: EnrichedObservation[] = [];

  constructor() {
    super({
      id: 'signal-enrichment',
      title: 'Signal Enrichment',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Augments raw observations with geographic, entity, domain, and cascade-relationship tags. Live feed of the last 20 enrichments.',
    });
    const svc = getSignalEnrichmentService();
    this.listener = (enriched) => {
      this.feed.unshift(enriched);
      if (this.feed.length > FEED_LIMIT) this.feed.length = FEED_LIMIT;
      this.render();
    };
    svc.subscribe(this.listener);
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.render();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.listener) {
      getSignalEnrichmentService().unsubscribe(this.listener);
      this.listener = null;
    }
    super.destroy();
  }

  private render(): void {
    const svc = getSignalEnrichmentService();
    const stats = svc.getStats();
    this.setCount(stats.total);
    this.setContent(this.buildHtml(stats));
  }

  private buildHtml(stats: EnrichmentStats): string {
    return `<div class="se-panel" style="display:flex;flex-direction:column;gap:8px;padding:10px;font-size:12px;line-height:1.45;">
      ${this.renderStats(stats)}
      ${this.renderFeed()}
    </div>`;
  }

  private renderStats(stats: EnrichmentStats): string {
    const sources: EnrichmentSource[] = ['geo', 'entity', 'domain', 'relationship'];
    return `<div style="display:flex;flex-direction:column;gap:6px;padding:8px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.08);border-radius:4px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:11px;">
        <span>${stats.total} enriched</span>
        <span style="font-family:ui-monospace,monospace;opacity:0.75;">${stats.avgTagsPerObservation.toFixed(1)} tags/obs avg</span>
      </div>
      <div style="display:flex;gap:5px;">
        ${sources.map((s) => this.renderSourcePill(s, stats.bySource[s])).join('')}
      </div>
    </div>`;
  }

  private renderSourcePill(source: EnrichmentSource, count: number): string {
    const color = SOURCE_COLOR[source];
    return `<div style="flex:1;background:${color}1a;border:1px solid ${color}55;border-radius:3px;padding:4px 6px;display:flex;flex-direction:column;align-items:center;gap:1px;">
      <span style="font-size:9px;opacity:0.7;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(SOURCE_LABEL[source])}</span>
      <span style="font-size:14px;font-weight:700;color:${color};">${count}</span>
    </div>`;
  }

  private renderFeed(): string {
    if (this.feed.length === 0) {
      return `<div style="font-size:11px;opacity:0.55;padding:6px 0;text-align:center;">No enrichments yet — adapters haven't pushed signals through this service.</div>`;
    }
    return `<div style="display:flex;flex-direction:column;gap:5px;">${this.feed.map((e) => this.renderFeedItem(e)).join('')}</div>`;
  }

  private renderFeedItem(e: EnrichedObservation): string {
    const obs = e.observation;
    const sev = obs.severity || 'INFO';
    const sevColor = SEVERITY_COLOR[sev] ?? '#9ca3af';
    return `<div style="border-left:3px solid ${sevColor};background:rgba(255,255,255,0.02);border-radius:0 3px 3px 0;padding:5px 8px;display:flex;flex-direction:column;gap:3px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
        <span style="font-size:11px;color:#ddd;font-weight:600;">${escapeHtml(obs.title)}</span>
        <span style="font-size:9px;color:${sevColor};font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(sev)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;gap:4px;font-size:10px;opacity:0.65;">
        <span style="font-family:ui-monospace,monospace;">${escapeHtml(obs.domain)}</span>
        <span>${e.regionName ? escapeHtml(e.regionName) : '—'}</span>
      </div>
      ${e.tags.length > 0 ? `<div style="display:flex;flex-wrap:wrap;gap:3px;">${e.tags.map((t) => this.renderTagChip(t.key, t.value, t.source)).join('')}</div>` : ''}
    </div>`;
  }

  private renderTagChip(key: string, value: string, source: EnrichmentSource): string {
    const color = SOURCE_COLOR[source];
    return `<span title="${escapeHtml(source)}" style="font-size:9px;background:${color}1a;color:${color};border:1px solid ${color}33;padding:1px 5px;border-radius:2px;font-family:ui-monospace,monospace;">${escapeHtml(key)}=${escapeHtml(value)}</span>`;
  }
}
