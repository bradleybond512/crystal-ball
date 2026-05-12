/**
 * Command Center Panel — gameplan's "Mission Control UI" (Big Bet 5).
 *
 * Top-of-app surface that answers: what's the current risk, what
 * matters most, what changed since last look, what to watch next.
 * Reads from the diagnostics registries + provided sentinel feed
 * snapshots — pure composition over the foundation modules.
 */

import { Panel } from './Panel';
import {
  getFeatureHealthRegistry,
  getFeedSentinels,
} from '@/services/diagnostics/diagnostics-state';
import {
  aggregateSystemHealth,
  contextFromSnapshots,
} from '@/services/diagnostics/system-health';
import { getLiveDiagnosticsSnapshot } from '@/services/diagnostics/live-diagnostics-snapshot';
import { auditFeeds } from '@/services/diagnostics/sentinel-feed-audit';
import {
  getActiveActionBrief,
  getPersonalImpactReport,
  getProviderRedundancyReport,
} from '@/services/insights/insights-state';
import type { ActionBrief } from '@/services/insights/action-briefs';
import type { PersonalImpact } from '@/services/personal/personal-impact';
import type { FeatureHealth, HealthStatus } from '@/services/diagnostics/system-health-types';
import { escapeHtml } from '@/utils/sanitize';
import { getSavedPlaces, type SavedPlace } from '@/services/saved-places';
import { getApiBaseUrl } from '@/services/runtime';
import type { ImpactSeverity } from '@/services/personal/personal-impact';

const REFRESH_MS = 10_000;

const STATUS_COLOR: Record<HealthStatus, string> = {
  healthy: 'var(--severity-ok)',
  degraded: 'var(--severity-medium)',
  stale:   'var(--severity-high)',
  failing: 'var(--severity-high)',
  unsafe:  'var(--severity-critical)',
  blind:   'var(--severity-info)',
  unknown: 'var(--severity-info)',
};

const ACTION_TIER_COLOR: Record<'monitor' | 'prepare' | 'act_now' | 'shelter', string> = {
  monitor: 'var(--severity-ok)',
  prepare: 'var(--severity-medium)',
  act_now: 'var(--severity-high)',
  shelter: 'var(--severity-critical)',
};

const IMPACT_SEVERITY_COLOR: Record<'critical' | 'elevated' | 'watch' | 'low' | 'none', string> = {
  critical: 'var(--severity-critical)',
  elevated: 'var(--severity-high)',
  watch:    'var(--severity-medium)',
  low:      'var(--severity-info)',
  none:     'var(--severity-info)',
};

const RISK_LABEL: Record<HealthStatus, string> = {
  healthy: 'CALM',
  unknown: 'WARMING',
  degraded: 'ELEVATED',
  stale: 'STALE',
  blind: 'BLIND',
  failing: 'STRESSED',
  unsafe: 'CRITICAL',
};

interface TapeItem {
  type: string;
  label: string;
  ageMs: number;
}

const TILE_ORDER_KEY = 'wm-command-center-tile-order';

export class CommandCenterPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private tapeTimer: ReturnType<typeof setInterval> | null = null;
  private tapeItems: TapeItem[] = [];
  private isDragging = false;
  private draggingId: string | null = null;
  private dragOverId: string | null = null;

  constructor() {
    super({
      id: 'command-center',
      title: 'Command Center',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Top-of-app summary: current risk, what matters most, what changed, what to watch next. Reads from feature / panel / notification registries.',
    });
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.render(), REFRESH_MS);
    void this.fetchTapeItems();
    this.tapeTimer = setInterval(() => { void this.fetchTapeItems(); }, 5 * 60 * 1000);
    this.attachDragListeners();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.tapeTimer !== null) {
      clearInterval(this.tapeTimer);
      this.tapeTimer = null;
    }
    super.destroy();
  }

  private render(): void {
    if (this.isDragging) return;
    const html = this.buildHtml();
    this.setContent(html);
  }

  private buildHtml(): string {
    // Pull live source/provider/sidecar/feed state instead of the empty
    // arrays + hard-coded unknown sidecar that used to drive this panel.
    const snapshot = getLiveDiagnosticsSnapshot();
    const featureReg = getFeatureHealthRegistry();
    const sentinels = getFeedSentinels();

    const panels = snapshot.panels;
    const ctx = contextFromSnapshots({
      panels,
      sources: snapshot.sources,
      providers: snapshot.providers,
    });
    const features = featureReg.all(ctx);
    const report = aggregateSystemHealth({
      panels,
      features,
      sources: snapshot.sources,
      providers: snapshot.providers,
      notifications: snapshot.notificationSummary,
      sidecar: snapshot.sidecar,
    });
    const feedAudit = auditFeeds({ sentinels, snapshots: snapshot.feedSnapshots });

    const concerning = features
      .filter((f) => f.status !== 'healthy' && f.status !== 'unknown')
      .sort((a, b) => criticalRank(b) - criticalRank(a));
    this.setCount(concerning.length);

    const actionBrief = getActiveActionBrief();
    const personalImpact = getPersonalImpactReport();
    const redundancy = getProviderRedundancyReport();

    return `
      <div style="padding:14px;display:flex;flex-direction:column;gap:14px;">
        ${this.renderGlobeNav()}
        ${this.renderSavedPlacesTiles()}
        ${this.renderRiskHeadline(report.status, report.summary)}
        ${this.renderActionBrief(actionBrief)}
        ${this.renderPersonalImpact(personalImpact.impacts)}
        ${this.renderTopThings(concerning)}
        ${this.renderProviderRedundancy(redundancy)}
        ${this.renderWatchNext(feedAudit.entries.length, feedAudit.entries.filter((e) => e.level !== 'fresh' && e.level !== 'unknown').length)}
        ${this.renderRecommendations(report.recommendations)}
        ${this.renderChangeTape()}
      </div>
    `;
  }

  private renderGlobeNav(): string {
    return `<div style="display:flex;justify-content:flex-end;">
      <button onclick="document.getElementById('godsVisionBtn')?.click()" style="font-size:10px;padding:3px 8px;background:transparent;color:var(--text-secondary,#aaa);border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;" title="Open God's Vision 3D globe">🌍 Globe</button>
    </div>`;
  }

  private renderRiskHeadline(status: HealthStatus, summary: string): string {
    const color = STATUS_COLOR[status];
    const label = RISK_LABEL[status];
    return `<div style="display:flex;flex-direction:column;gap:4px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${color};box-shadow:0 0 8px ${color}aa;"></span>
        <span style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.08em;">Current risk</span>
      </div>
      <div style="font-size:28px;font-weight:800;color:${color};letter-spacing:0.04em;">${escapeHtml(label)}</div>
      <div style="font-size:12px;color:var(--text-secondary,#aaa);">${escapeHtml(summary)}</div>
    </div>`;
  }

  private renderTopThings(concerning: readonly FeatureHealth[]): string {
    if (concerning.length === 0) {
      return `<div style="border-top:1px solid var(--border-subtle,#333);padding-top:12px;">
        <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">Top things that matter</div>
        <div style="font-size:13px;color:var(--severity-ok);">All features within their calibration floors. No action needed.</div>
      </div>`;
    }
    const top = concerning.slice(0, 3);
    return `<div style="border-top:1px solid var(--border-subtle,#333);padding-top:12px;">
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:8px;">Top ${top.length} ${top.length === 1 ? 'thing' : 'things'} that matter</div>
      ${top.map((f, i) => this.renderTopRow(f, i + 1)).join('')}
    </div>`;
  }

  private renderTopRow(f: FeatureHealth, n: number): string {
    const color = STATUS_COLOR[f.status];
    return `<div style="display:flex;gap:10px;padding:8px 10px;border:1px solid var(--border-subtle,#333);border-left:3px solid ${color};border-radius:3px;margin-bottom:6px;">
      <div style="font-size:18px;font-weight:800;color:${color};min-width:24px;">${n}</div>
      <div style="flex:1;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <span style="font-weight:700;font-size:13px;">${escapeHtml(f.label)}</span>
          <span style="font-size:10px;color:${color};text-transform:uppercase;">${escapeHtml(f.status)}</span>
        </div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:3px;">${escapeHtml(f.userImpact || f.reason)}</div>
        ${f.recommendedAction ? `<div style="font-size:11px;color:var(--accent,#4a9eff);margin-top:3px;">→ ${escapeHtml(f.recommendedAction)}</div>` : ''}
      </div>
    </div>`;
  }

  private renderWatchNext(totalFeeds: number, drifting: number): string {
    if (totalFeeds === 0) return '';
    return `<div style="border-top:1px solid var(--border-subtle,#333);padding-top:12px;">
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">Watch next</div>
      <div style="font-size:12px;">
        ${drifting === 0
          ? `${totalFeeds} feeds fresh — nothing drifting.`
          : `<strong style="color:var(--severity-high);">${drifting}</strong> of ${totalFeeds} sentinel feeds drifting. See Diagnostic → Feeds.`}
      </div>
    </div>`;
  }

  private renderActionBrief(brief: ActionBrief | undefined): string {
    if (!brief) return '';
    const tierColor = ACTION_TIER_COLOR[brief.tier];
    const actions = brief.recommendedActions.length === 0
      ? ''
      : `<ul style="margin:6px 0 0 0;padding-left:18px;font-size:12px;line-height:1.5;">
          ${brief.recommendedActions.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}
        </ul>`;
    const watch = brief.confirmingSources.length === 0
      ? ''
      : `<div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:6px;">
          <span style="text-transform:uppercase;letter-spacing:0.05em;">Watch next</span> · ${escapeHtml(brief.confirmingSources.slice(0, 4).join(', '))}
        </div>`;
    return `<div style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${tierColor};border-radius:4px;padding:10px 12px;background:rgba(255,255,255,0.02);">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <span style="font-weight:700;font-size:13px;">${escapeHtml(brief.headline)}</span>
        <span style="font-size:10px;color:${tierColor};text-transform:uppercase;letter-spacing:0.06em;">${escapeHtml(brief.tier)}</span>
      </div>
      ${actions}
      ${watch}
    </div>`;
  }

  private renderPersonalImpact(impacts: readonly PersonalImpact[]): string {
    const surfacing = impacts.filter((i) => i.severity !== 'none' && i.severity !== 'low').slice(0, 3);
    if (surfacing.length === 0) return '';
    return `<div style="border-top:1px solid var(--border-subtle,#333);padding-top:12px;">
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:8px;">Your personal impact</div>
      ${surfacing.map((i) => this.renderImpactRow(i)).join('')}
    </div>`;
  }

  private renderImpactRow(i: PersonalImpact): string {
    const color = IMPACT_SEVERITY_COLOR[i.severity];
    const exposures = i.exposures.length === 0
      ? '<em>no direct personal exposure</em>'
      : i.exposures.slice(0, 2).map((e) => escapeHtml(e.label)).join(', ');
    return `<div style="display:flex;gap:10px;padding:6px 0;">
      <span style="font-size:10px;color:${color};font-weight:700;text-transform:uppercase;min-width:60px;">${escapeHtml(i.severity)}</span>
      <div style="flex:1;font-size:12px;">
        <div>${escapeHtml(i.description)}</div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:3px;">${exposures}</div>
        ${i.recommendedAction ? `<div style="font-size:11px;color:var(--accent,#4a9eff);margin-top:3px;">→ ${escapeHtml(i.recommendedAction)}</div>` : ''}
      </div>
    </div>`;
  }

  private renderProviderRedundancy(report: ReturnType<typeof getProviderRedundancyReport>): string {
    if (report.domains.length === 0) return '';
    const stressed = report.domains.filter((d) => d.verdict !== 'redundant_agreement');
    if (stressed.length === 0) return '';
    return `<div style="border-top:1px solid var(--border-subtle,#333);padding-top:12px;">
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">Provider stress</div>
      <ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.5;">
        ${stressed.slice(0, 3).map((d) => `<li><strong>${escapeHtml(d.domain)}</strong>: ${escapeHtml(d.reason)}</li>`).join('')}
      </ul>
    </div>`;
  }

  private renderRecommendations(recs: readonly string[]): string {
    if (recs.length === 0) return '';
    return `<div style="border-top:1px solid var(--border-subtle,#333);padding-top:12px;">
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">What you should do</div>
      <ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.5;">
        ${recs.slice(0, 4).map((r) => `<li>${escapeHtml(r)}</li>`).join('')}
      </ul>
    </div>`;
  }

  // ── Saved-places tiles ──────────────────────────────────────────────────

  private loadTileOrder(): string[] {
    try {
      const stored = localStorage.getItem(TILE_ORDER_KEY);
      return stored ? (JSON.parse(stored) as string[]) : [];
    } catch {
      return [];
    }
  }

  private saveTileOrder(ids: string[]): void {
    localStorage.setItem(TILE_ORDER_KEY, JSON.stringify(ids));
  }

  private sortedTiles(places: SavedPlace[]): SavedPlace[] {
    const order = this.loadTileOrder();
    return [...places].sort((a, b) => {
      const ai = order.indexOf(a.id);
      const bi = order.indexOf(b.id);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }

  private placeSeverity(place: SavedPlace, impacts: readonly PersonalImpact[]): ImpactSeverity {
    return impacts.find((imp) =>
      imp.exposures.some((e) => e.exposureId === place.id || e.label === place.name),
    )?.severity ?? 'none';
  }

  private placeAlertCount(place: SavedPlace, impacts: readonly PersonalImpact[]): number {
    return impacts.filter((imp) =>
      imp.exposures.some((e) => e.exposureId === place.id || e.label === place.name),
    ).length;
  }

  private renderTile(place: SavedPlace, severity: ImpactSeverity, alertCount: number): string {
    const color = IMPACT_SEVERITY_COLOR[severity];
    const plural = alertCount === 1 ? '' : 's';
    const countHtml = alertCount > 0
      ? `<div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:2px;">${alertCount} alert${plural}</div>`
      : '';
    return `<div class="ccp-tile" data-tile-id="${escapeHtml(place.id)}" draggable="true"
      style="flex:0 0 auto;width:100px;padding:8px 10px;border:1px solid var(--border-subtle,#333);border-top:3px solid ${color};border-radius:4px;cursor:grab;background:rgba(255,255,255,0.02);user-select:none;">
      <div style="font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(place.name)}">${escapeHtml(place.name)}</div>
      <div style="font-size:10px;color:${color};text-transform:uppercase;margin-top:2px;">${escapeHtml(severity)}</div>
      ${countHtml}
    </div>`;
  }

  private renderSavedPlacesTiles(): string {
    const places = getSavedPlaces().slice(0, 6);
    const impacts = getPersonalImpactReport().impacts;
    const sorted = this.sortedTiles(places);
    const tileHtml = sorted.map((p) =>
      this.renderTile(p, this.placeSeverity(p, impacts), this.placeAlertCount(p, impacts)),
    ).join('');
    const addBtn = `<button data-action="add-place" style="font-size:11px;color:var(--accent,#4a9eff);background:none;border:1px dashed var(--border-subtle,#333);border-radius:4px;padding:6px 10px;cursor:pointer;align-self:flex-start;" title="Add a saved place">+</button>`;
    return `<div style="padding-bottom:2px;">
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">Your places</div>
      <div class="ccp-tiles-row" style="display:flex;flex-wrap:wrap;gap:8px;">${tileHtml}${addBtn}</div>
    </div>`;
  }

  // ── Drag-to-reorder tiles (event delegation — listeners survive re-render) ──

  private attachDragListeners(): void {
    this.content.addEventListener('dragstart', (e) => this.onDragStart(e));
    this.content.addEventListener('dragover', (e) => this.onDragOver(e));
    this.content.addEventListener('drop', (e) => this.onDrop(e));
    this.content.addEventListener('dragend', () => this.onDragEnd());
    this.content.addEventListener('click', (e) => this.onContentClick(e));
  }

  private onDragStart(e: DragEvent): void {
    const tile = (e.target as HTMLElement).closest<HTMLElement>('[data-tile-id]');
    if (!tile) return;
    this.isDragging = true;
    this.draggingId = tile.dataset.tileId ?? null;
    e.dataTransfer?.setData('text/plain', this.draggingId ?? '');
  }

  private onDragOver(e: DragEvent): void {
    const tile = (e.target as HTMLElement).closest<HTMLElement>('[data-tile-id]');
    if (!tile) return;
    e.preventDefault();
    this.dragOverId = tile.dataset.tileId ?? null;
  }

  private onDrop(e: DragEvent): void {
    e.preventDefault();
    const from = this.draggingId;
    const to = this.dragOverId;
    this.isDragging = false;
    this.draggingId = null;
    this.dragOverId = null;
    if (!from || !to || from === to) { this.render(); return; }
    const ids = this.sortedTiles(getSavedPlaces().slice(0, 6)).map((p) => p.id);
    const fromIdx = ids.indexOf(from);
    const toIdx = ids.indexOf(to);
    if (fromIdx !== -1 && toIdx !== -1) {
      ids.splice(fromIdx, 1);
      ids.splice(toIdx, 0, from);
    }
    this.saveTileOrder(ids);
    this.render();
  }

  private onDragEnd(): void {
    this.isDragging = false;
    this.draggingId = null;
    this.dragOverId = null;
    this.render();
  }

  private onContentClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action="add-place"]');
    if (!btn) return;
    document.querySelector<HTMLElement>('[data-panel-id="saved-places"]')?.click();
  }

  // ── Live change tape ────────────────────────────────────────────────────

  private async fetchTapeItems(): Promise<void> {
    try {
      const url = `${getApiBaseUrl()}/api/command-center/recent-changes`;
      const resp = await fetch(url);
      if (!resp.ok) return;
      const data = await resp.json() as { items?: TapeItem[] };
      this.tapeItems = data.items ?? [];
      if (!this.isDragging) this.render();
    } catch {
      // fail silently — tape stays empty
    }
  }

  private formatAge(ms: number): string {
    const min = Math.floor(ms / 60_000);
    if (min < 60) return `${min}m`;
    return `${Math.floor(min / 60)}h`;
  }

  private renderChangeTape(): string {
    if (this.tapeItems.length === 0) return '';
    const items = this.tapeItems.slice(0, 10).map((item) => {
      const age = this.formatAge(item.ageMs);
      return `<span style="display:inline-block;padding:0 10px;border-right:1px solid var(--border-subtle,#444);font-size:11px;white-space:nowrap;">${escapeHtml(item.label)}<span style="color:var(--text-secondary,#aaa);margin-left:4px;">${escapeHtml(age)} ago</span></span>`;
    }).join('');
    return `<div style="border-top:1px solid var(--border-subtle,#333);padding-top:10px;">
      <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:4px;">What changed (last hour)</div>
      <div style="overflow-x:auto;display:flex;padding-bottom:4px;">${items}</div>
    </div>`;
  }
}

function criticalRank(f: FeatureHealth): number {
  const sev: Record<HealthStatus, number> = {
    healthy: 0,
    unknown: 1,
    degraded: 2,
    stale: 3,
    blind: 4,
    failing: 5,
    unsafe: 6,
  };
  return sev[f.status] + (f.critical ? 10 : 0);
}
