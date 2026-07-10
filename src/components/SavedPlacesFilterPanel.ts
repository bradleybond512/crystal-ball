/**
 * Saved Places Filter Panel — surfaces the active proximity filter
 * with quick activate / deactivate controls and pass/fail/passthrough
 * stats against the latest observation snapshot.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  getSavedPlacesFilterService,
  type FilterContext,
  type FilterStats,
} from '@/services/intelligence/saved-places-filter';
import type { SavedPlace } from '@/services/saved-places';
import type { ObservationEvent } from '@/services/intelligence/observation-adapters';

const REFRESH_MS = 10_000;

export class SavedPlacesFilterPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  /** Optional observation sample for the pass/fail tally. Host code
   *  can push fresh batches via setObservationSample(). */
  private observationSample: ObservationEvent[] = [];

  constructor() {
    super({
      id: 'saved-places-filter',
      title: 'Saved Places Filter',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Promotes a saved place to a first-class proximity filter. When active, panels see only observations within radiusKm of the saved place. Non-geolocated observations pass through.',
    });
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsubscribe = getSavedPlacesFilterService().subscribe(() => this.render());
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

  /** Host-injected observation snapshot used purely for the stats
   *  triplet — never mutated, never broadcast. */
  public setObservationSample(observations: readonly ObservationEvent[]): void {
    this.observationSample = [...observations];
    this.render();
  }

  // ── Rendering ────────────────────────────────────────────────────

  private render(): void {
    try {
      const svc = getSavedPlacesFilterService();
      const ctx = svc.getContext();
      const stats = svc.evaluate(this.observationSample);
      const places = svc.listPlaces();
      this.setCount(ctx.isActive ? stats.passed : 0);
      this.setContent(this.buildHtml(ctx, stats, places));
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical,#dc2626);font-size:12px;">Saved-places filter render error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private buildHtml(ctx: FilterContext, stats: FilterStats, places: readonly SavedPlace[]): string {
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;font-size:12px;">
      ${this.renderBanner(ctx)}
      ${this.renderStats(stats, ctx.isActive)}
      ${this.renderPlacesList(places, ctx.activePlaceId)}
    </div>`;
  }

  private renderBanner(ctx: FilterContext): string {
    if (!ctx.isActive) {
      return '<div style="padding:8px 10px;border:1px solid var(--border-subtle,#333);border-radius:4px;background:rgba(255,255,255,0.02);font-size:11px;color:var(--text-secondary,#aaa);">No saved place active. Pick one below to scope every observation feed to its neighborhood.</div>';
    }
    const radiusKm = Math.round(ctx.radiusKm);
    return `<div style="padding:8px 10px;border:1px solid var(--border-subtle,#333);border-left:3px solid #60a5fa;border-radius:4px;background:rgba(96,165,250,0.10);font-size:11px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <span style="font-size:10px;padding:1px 6px;border-radius:3px;background:rgba(96,165,250,0.20);color:#60a5fa;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">ACTIVE</span>
      <strong>${escapeHtml(ctx.activePlaceName ?? '')}</strong>
      <span style="color:var(--text-secondary,#aaa);">±${radiusKm}km</span>
      <button class="spf-action" data-action="deactivate" style="margin-left:auto;padding:3px 8px;font-size:11px;border:1px solid var(--border-subtle,#333);background:rgba(248,113,113,0.10);color:var(--severity-high,#f87171);border-radius:3px;cursor:pointer;">Deactivate</button>
    </div>`;
  }

  private renderStats(stats: FilterStats, active: boolean): string {
    if (!active) return '';
    return `<div style="display:flex;gap:16px;flex-wrap:wrap;font-size:11px;">
      <div>
        <div style="font-size:18px;font-weight:700;color:var(--severity-ok,#22c55e);">${stats.passed}</div>
        <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">in radius</div>
      </div>
      <div>
        <div style="font-size:18px;font-weight:700;color:var(--severity-medium,#facc15);">${stats.failed}</div>
        <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">filtered out</div>
      </div>
      <div>
        <div style="font-size:18px;font-weight:700;color:#60a5fa;">${stats.passthrough}</div>
        <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">passthrough (no coords)</div>
      </div>
      <div style="margin-left:auto;">
        <div style="font-size:18px;font-weight:700;">${stats.total}</div>
        <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">sample size</div>
      </div>
    </div>`;
  }

  private renderPlacesList(places: readonly SavedPlace[], activeId: string | null): string {
    if (places.length === 0) {
      return '<div style="font-size:11px;color:var(--text-secondary,#aaa);">No saved places. Add one from the Saved Places panel to enable proximity filtering.</div>';
    }
    const rows = places.map((p) => this.renderPlaceRow(p, activeId === p.id)).join('');
    return `<div>
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary,#aaa);margin-bottom:4px;">Saved places</div>
      <div style="display:flex;flex-direction:column;gap:4px;">${rows}</div>
    </div>`;
  }

  private renderPlaceRow(place: SavedPlace, active: boolean): string {
    const buttonLabel = active ? 'Deactivate' : 'Activate';
    const buttonColor = active ? 'var(--severity-high,#f87171)' : 'var(--severity-ok,#22c55e)';
    const buttonBg = active ? 'rgba(248,113,113,0.10)' : 'rgba(34,197,94,0.10)';
    const action = active ? 'deactivate' : 'activate';
    return `<div style="padding:6px 10px;border:1px solid var(--border-subtle,#333);border-radius:4px;background:rgba(255,255,255,0.02);display:flex;align-items:center;gap:8px;">
      ${active ? '<span style="font-size:10px;color:#60a5fa;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">★</span>' : ''}
      <strong style="font-size:12px;">${escapeHtml(place.name)}</strong>
      <span style="font-size:10px;color:var(--text-secondary,#aaa);font-family:ui-monospace,monospace;">${place.lat.toFixed(2)}, ${place.lon.toFixed(2)}</span>
      <span style="font-size:10px;color:var(--text-secondary,#aaa);">±${Math.round(place.radiusKm)}km</span>
      <button class="spf-action" data-action="${action}" data-id="${escapeHtml(place.id)}" style="margin-left:auto;padding:3px 8px;font-size:11px;border:1px solid var(--border-subtle,#333);background:${buttonBg};color:${buttonColor};border-radius:3px;cursor:pointer;">${escapeHtml(buttonLabel)}</button>
    </div>`;
  }

  // ── Event handling ───────────────────────────────────────────────

  private attachHandlers(): void {
    this.content.addEventListener('click', (e) => this.onClick(e));
  }

  private onClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    const btn = target?.closest<HTMLElement>('.spf-action');
    if (!btn) return;
    event.stopPropagation();
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    const svc = getSavedPlacesFilterService();
    if (action === 'deactivate') svc.deactivate();
    else if (action === 'activate' && id) svc.activate(id);
    this.render();
  }
}
