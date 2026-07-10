/**
 * Alert Explanation Panel — "why this alert?" for any UnifiedAlert.
 *
 * Picks a recent alert from the unifiedAlertStore and renders the
 * structured explanation produced by `alert-explainer.ts`. Zero
 * network calls on render — every section is local pure computation.
 */

import { Panel } from './Panel';
import { explainAlert, type AlertExplanation, type ExplainConfidence } from '@/services/intelligence/alert-explainer';
import { unifiedAlertStore, type UnifiedAlert } from '@/services/unified-alerts';
import { getActive as getActiveSituations } from '@/services/intelligence/situation-store';
import { getSavedPlaces } from '@/services/saved-places';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30_000;
const MAX_ALERTS = 50;

const CONFIDENCE_COLOR: Record<ExplainConfidence, string> = {
  high: '#4caf50',
  medium: '#ffb74d',
  low: '#9e9e9e',
};

const CONFIDENCE_PCT: Record<ExplainConfidence, number> = {
  high: 90,
  medium: 60,
  low: 30,
};

export class AlertExplanationPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private selectedAlertId: string | null = null;

  constructor() {
    super({
      id: 'alert-explanation',
      title: 'Alert Explanation',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        '"Why this alert?" — turns any UnifiedAlert into a structured explanation: what happened, why it matters (saved-place / watchlist / interest), confidence + reason, what to watch next, source attribution.',
    });
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    if (this.content) {
      this.content.addEventListener('change', this.onSelectChange);
    }
  }

  private readonly onSelectChange = (e: Event): void => {
    const target = e.target;
    if (!(target instanceof HTMLSelectElement) || target.dataset.role !== 'alert-explanation-select') return;
    this.selectedAlertId = target.value || null;
    this.render();
  };

  public destroy(): void {
    super.destroy();
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.content) {
      this.content.removeEventListener('change', this.onSelectChange);
    }
  }

  private render(): void {
    const alerts = unifiedAlertStore.getAll().slice(0, MAX_ALERTS);
    if (alerts.length === 0) {
      this.setCount(0);
      this.setContent(this.renderEmptyState());
      return;
    }

    if (!this.selectedAlertId || !alerts.some((a) => a.id === this.selectedAlertId)) {
      this.selectedAlertId = alerts[0]?.id ?? null;
    }
    const selected = alerts.find((a) => a.id === this.selectedAlertId);
    if (!selected) {
      this.setContent(this.renderEmptyState());
      return;
    }

    const explanation = explainAlert(selected, {
      situations: getActiveSituations(),
      events: alerts,
      savedPlaces: getSavedPlaces(),
    });
    this.setCount(explanation.relatedAlerts.length);

    this.setContent(this.renderExplanation(explanation, alerts, selected.id));
  }

  private renderEmptyState(): string {
    return `<div style="padding:16px;color:var(--text-secondary,#aaa);font-size:12px;">
      No alerts in the unified inbox yet. Once any alert source (NWS / GDACS / earthquake / cyber / …) fires, it shows up here for explanation.
    </div>`;
  }

  private renderExplanation(explanation: AlertExplanation, alerts: UnifiedAlert[], selectedId: string): string {
    const optionsHtml = alerts.slice(0, MAX_ALERTS).map((a) => {
      const label = `${new Date(a.timestamp).toISOString().slice(11, 19)} · ${a.severity.toUpperCase()} · ${a.title}`;
      const selectedAttr = a.id === selectedId ? ' selected' : '';
      return `<option value="${escapeHtml(a.id)}"${selectedAttr}>${escapeHtml(label)}</option>`;
    }).join('');

    const confidenceColor = CONFIDENCE_COLOR[explanation.confidence];
    const confidencePct = CONFIDENCE_PCT[explanation.confidence];

    const watchHtml = explanation.whatToWatch.map((line) => `
      <li style="margin:3px 0;display:flex;align-items:flex-start;gap:8px;">
        <span style="flex:0 0 12px;width:12px;height:12px;border:1px solid #555;border-radius:2px;margin-top:3px;"></span>
        <span style="font-size:12px;color:#e5e5e5;">${escapeHtml(line)}</span>
      </li>`).join('');

    const sourcesHtml = explanation.sources.map((s) => `
      <span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;background:rgba(74,158,255,0.10);border:1px solid rgba(74,158,255,0.30);border-radius:12px;font-size:11px;color:#e5e5e5;">
        <strong>${escapeHtml(s.domain)}</strong>
        <span style="opacity:0.7;">${new Date(s.timestamp).toISOString().slice(0, 16).replace('T', ' ')}</span>
      </span>`).join('');

    const relatedHtml = explanation.relatedAlerts.length === 0
      ? `<div style="font-size:11px;color:var(--text-secondary,#aaa);">No related alerts.</div>`
      : `<div style="display:flex;flex-wrap:wrap;gap:4px;">${explanation.relatedAlerts.map((id) =>
          `<span style="padding:2px 8px;background:rgba(255,255,255,0.05);border-radius:10px;font-size:10px;font-family:ui-monospace,monospace;">${escapeHtml(id)}</span>`,
        ).join('')}</div>`;

    return `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">

      <div>
        <label style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;display:block;margin-bottom:4px;">Alert</label>
        <select data-role="alert-explanation-select"
                style="width:100%;padding:6px 8px;background:var(--surface-1,#111);color:#e5e5e5;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:12px;">
          ${optionsHtml}
        </select>
      </div>

      <div>
        <div style="font-size:14px;font-weight:600;color:#e5e5e5;line-height:1.3;">${escapeHtml(explanation.headline)}</div>
      </div>

      <div data-section="why-it-matters" style="padding:8px 10px;background:rgba(255,183,77,0.08);border-left:3px solid #ffb74d;border-radius:3px;">
        <div style="font-size:10px;color:#ffb74d;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:3px;">Why it matters</div>
        <div style="font-size:12px;color:#e5e5e5;">${escapeHtml(explanation.whyItMatters)}</div>
      </div>

      <div data-section="what-happened">
        <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:3px;">What happened</div>
        <div style="font-size:12px;color:#e5e5e5;line-height:1.5;">${escapeHtml(explanation.whatHappened)}</div>
      </div>

      <div data-section="confidence">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
          <span style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">Confidence</span>
          <span style="font-size:11px;color:${confidenceColor};font-weight:600;">${escapeHtml(explanation.confidence.toUpperCase())}</span>
        </div>
        <div style="height:6px;background:rgba(255,255,255,0.05);border-radius:3px;overflow:hidden;">
          <div style="height:100%;width:${confidencePct}%;background:${confidenceColor};"></div>
        </div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:4px;">${escapeHtml(explanation.confidenceReason)}</div>
      </div>

      <div data-section="what-to-watch">
        <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">What to watch next</div>
        <ul style="list-style:none;padding:0;margin:0;">${watchHtml}</ul>
      </div>

      <div data-section="sources">
        <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Sources</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">${sourcesHtml}</div>
      </div>

      <div data-section="related">
        <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Related alerts (${explanation.relatedAlerts.length})</div>
        ${relatedHtml}
      </div>

    </div>`;
  }
}
