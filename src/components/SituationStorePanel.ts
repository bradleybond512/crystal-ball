/**
 * Situation Store Panel (panel id: `situations`).
 *
 * Lists active Situations from src/services/intelligence/situation-store.ts,
 * sorted by severity then recency. Each row shows the name, domain,
 * severity chip, started time, and linked-event count. Click to expand
 * for the summary, linked observation ids, correlations, and location.
 *
 * Refreshes every 60 s and listens on `wm:situation-created` /
 * `wm:situation-updated` so the panel grows live as the detector mints
 * new entries.
 *
 * The pre-existing `SituationPanel.ts` (panel id `situation-awareness`)
 * is a different system backed by `situation-engine`; the two coexist.
 */
/* eslint-disable sonarjs/no-nested-template-literals -- short row markup */

import { Panel } from './Panel';
import { getActive } from '@/services/intelligence/situation-store';
import {
  SEVERITY_BADGE,
  formatStarted,
  linkedCountLabel,
  sortSituations,
} from './situation-panel-helpers';
import type { Situation } from '@/types/intelligence';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 60_000;

export class SituationStorePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private expandedId: string | null = null;
  private liveListener: ((e: Event) => void) | null = null;

  constructor() {
    super({
      id: 'situations',
      title: 'Situations',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Active Situations aggregated from observation events + correlations. Click a row to expand the summary, linked observations, and location.',
    });
    this.showLoading('Loading situations…');
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

  private render(): void {
    const sorted = sortSituations(getActive());
    this.setCount(sorted.length);
    this.setContent(this.buildHtml(sorted));
    this.attachHandlers();
  }

  private buildHtml(situations: Situation[]): string {
    if (situations.length === 0) {
      return '<div class="sit-panel"><div class="panel-empty">No active situations.</div></div>';
    }
    const rows = situations.map((s) => this.renderRow(s)).join('');
    return `<div class="sit-panel"><div class="sit-rows">${rows}</div></div>`;
  }

  private renderRow(s: Situation): string {
    const expanded = this.expandedId === s.id;
    const sev = SEVERITY_BADGE[s.severity];
    return `<div class="sit-row${expanded ? ' sit-row-expanded' : ''}" data-sit-id="${escapeHtml(s.id)}">
      <div class="sit-row-summary">
        <div class="sit-row-title-block">
          <span class="sit-row-name">${escapeHtml(s.name)}</span>
          <span class="sit-row-meta">
            <span class="sit-row-domain">${escapeHtml(s.domain)}</span>
            <span class="sit-row-time">${escapeHtml(formatStarted(s.startedAt))}</span>
            <span class="sit-row-count">${escapeHtml(linkedCountLabel(s))}</span>
          </span>
        </div>
        <span class="sit-row-sev" style="color:${sev.color};">${escapeHtml(sev.label)}</span>
      </div>
      ${expanded ? this.renderRowDetail(s) : ''}
    </div>`;
  }

  private renderRowDetail(s: Situation): string {
    const locBlock = s.location
      ? `<div class="sit-detail-line"><strong>Location:</strong>
          ${s.location.lat.toFixed(2)}°, ${s.location.lon.toFixed(2)}°
          · ~${s.location.radiusKm.toFixed(0)} km radius</div>`
      : '<div class="sit-detail-line"><strong>Location:</strong> —</div>';
    const obsBlock = s.observationIds.length === 0
      ? '<div class="sit-detail-empty">No linked observations.</div>'
      : `<ul class="sit-detail-list">${s.observationIds.slice(0, 20).map(
        (id) => `<li>${escapeHtml(id)}</li>`,
      ).join('')}</ul>`;
    const corBlock = s.correlationIds.length === 0
      ? ''
      : `<div class="sit-detail-line"><strong>Correlations:</strong>
          ${s.correlationIds.slice(0, 10).map((id) => escapeHtml(id)).join(', ')}</div>`;
    const tagsBlock = s.tags.length === 0
      ? ''
      : `<div class="sit-detail-line"><strong>Tags:</strong>
          ${s.tags.map((t) => `<span class="sit-tag">${escapeHtml(t)}</span>`).join('')}</div>`;
    return `<div class="sit-row-detail">
      <div class="sit-detail-line"><strong>Summary:</strong> ${escapeHtml(s.summary)}</div>
      ${locBlock}
      ${tagsBlock}
      <div class="sit-detail-line"><strong>Confidence:</strong>
        ${(s.confidence * 100).toFixed(0)}%</div>
      <div class="sit-detail-line"><strong>Observations</strong></div>
      ${obsBlock}
      ${corBlock}
    </div>`;
  }

  private attachHandlers(): void {
    const root = this.getContentElement();
    for (const row of root.querySelectorAll<HTMLElement>('[data-sit-id]')) {
      row.addEventListener('click', () => {
        const id = row.dataset.sitId ?? null;
        this.expandedId = this.expandedId === id ? null : id;
        this.render();
      });
    }
  }
}
