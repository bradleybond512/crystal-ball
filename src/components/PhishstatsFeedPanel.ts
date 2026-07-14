/**
 * PhishStats Feed panel — recent phishing URLs with severity slider and
 * top-targets / top-countries summary. Auto-refreshes every 30 min.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  fetchPhishingRecords,
  type PhishingEnvelope,
} from '@/services/security/phishstats-service';
import {
  filterByMinScore,
  severityColor,
  summarisePhishing,
  truncateUrl,
} from '@/services/security/phishstats-classify';

const REFRESH_MS = 30 * 60 * 1000;
const SLIDER_STORAGE_KEY = 'cb:phishstats-min-score';

function readStoredMinScore(): number {
  try {
    const raw = localStorage.getItem(SLIDER_STORAGE_KEY);
    if (raw === null) return 5;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0 && n <= 10) return n;
  } catch { /* noop */ }
  return 5;
}

export class PhishstatsFeedPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private envelope: PhishingEnvelope | null = null;
  private minScore: number = readStoredMinScore();

  constructor() {
    super({
      id: 'phishstats-feed',
      title: 'PhishStats Feed',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'Recent phishing URLs from PhishStats (free API). Filter by confidence score (0–10). Cache refreshes every 30 minutes.',
    });
    this.start();
  }

  private start(): void {
    this.render();
    void this.refresh();
    this.refreshTimer = setInterval(() => void this.refresh(), REFRESH_MS);
  }

  public destroy(): void {
    super.destroy();
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private async refresh(): Promise<void> {
    try {
      this.envelope = await fetchPhishingRecords({ limit: 100, minScore: 0 });
    } catch {
      // service surfaces failure as degraded envelope
    }
    this.render();
  }

  private setMinScore(value: number): void {
    this.minScore = Math.max(0, Math.min(10, value));
    try { localStorage.setItem(SLIDER_STORAGE_KEY, String(this.minScore)); } catch { /* noop */ }
    this.render();
  }

  private render(): void {
    const env = this.envelope;
    if (!env) {
      this.setContent(`<div style="opacity:0.6;padding:8px;">Loading phishing feed…</div>`);
      return;
    }
    const filtered = filterByMinScore(env.records, this.minScore);
    const stats = summarisePhishing(filtered);
    this.setCount(filtered.length);

    const banner = env.degraded
      ? `<div style="padding:4px 6px;background:rgba(255, 69, 58,0.10);border-left:3px solid #ff453a;margin-bottom:6px;font-size:11px;">
           Degraded: ${escapeHtml(env.reason ?? 'unknown')} (source: ${escapeHtml(env.source)})
         </div>`
      : '';

    const slider = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:11px;">
      <span style="opacity:0.7;">Min score</span>
      <input type="range" min="0" max="10" step="0.5" value="${this.minScore}" class="phish-score-slider" style="flex:1;" />
      <span style="font-family:ui-monospace,monospace;min-width:2.5em;text-align:right;">${this.minScore.toFixed(1)}</span>
    </div>`;

    const summary = this.renderSummary(stats);
    const tableBody = filtered.slice(0, 60).map((r) => this.renderRow(r)).join('');
    const more = filtered.length > 60
      ? `<div style="font-size:10px;opacity:0.6;margin-top:4px;">+ ${filtered.length - 60} more</div>`
      : '';

    this.setContent(`
      <div style="padding:8px;font-size:12px;line-height:1.45;">
        ${banner}
        ${slider}
        ${summary}
        <table class="eq-table" style="width:100%;font-size:11px;margin-top:6px;">
          <thead><tr>
            <th style="text-align:left;">URL</th>
            <th style="text-align:left;">Target</th>
            <th style="text-align:right;">Score</th>
            <th style="text-align:left;">Country</th>
            <th style="text-align:right;">Date</th>
          </tr></thead>
          <tbody>${tableBody}</tbody>
        </table>
        ${more}
      </div>
    `, () => this.wireHandlers());
  }

  private renderSummary(stats: ReturnType<typeof summarisePhishing>): string {
    const targets = stats.topTargets.length === 0
      ? '<span style="opacity:0.6;">no targets identified</span>'
      : stats.topTargets.slice(0, 5).map((t) => `<span style="display:inline-block;padding:2px 8px;border:1px solid rgba(255,255,255,0.12);border-radius:8px;font-size:10px;margin-right:4px;margin-bottom:4px;">${escapeHtml(t.target)} <strong>${t.count}</strong></span>`).join('');
    const countries = stats.topCountries.length === 0
      ? '<span style="opacity:0.6;">no countries identified</span>'
      : stats.topCountries.slice(0, 5).map((c) => {
          const flag = escapeHtml(c.countryCode);
          const name = c.countryName ? ` ${escapeHtml(c.countryName)}` : '';
          return `<span style="display:inline-block;padding:2px 8px;border:1px solid rgba(255,255,255,0.12);border-radius:8px;font-size:10px;margin-right:4px;margin-bottom:4px;">${flag}${name} <strong>${c.count}</strong></span>`;
        }).join('');
    return `<div style="display:grid;grid-template-columns:1fr;gap:6px;margin-bottom:6px;">
      <div><div style="font-size:10px;opacity:0.7;text-transform:uppercase;margin-bottom:3px;">Top targeted brands</div>${targets}</div>
      <div><div style="font-size:10px;opacity:0.7;text-transform:uppercase;margin-bottom:3px;">Top countries</div>${countries}</div>
    </div>`;
  }

  private renderRow(r: import('@/services/security/phishstats-classify').PhishingRecord): string {
    const sev = severityColor(r.severity);
    const date = new Date(r.detectedAt).toISOString().slice(0, 16).replace('T', ' ');
    const cc = r.countryCode ?? '—';
    return `<tr>
      <td style="border-left:3px solid ${sev};padding-left:6px;font-family:ui-monospace,monospace;font-size:10px;">${escapeHtml(truncateUrl(r.url))}</td>
      <td>${escapeHtml(r.target ?? '—')}</td>
      <td style="text-align:right;font-weight:600;color:${sev};">${r.score.toFixed(1)}</td>
      <td>${escapeHtml(cc)}</td>
      <td style="text-align:right;font-family:ui-monospace,monospace;opacity:0.7;font-size:10px;">${escapeHtml(date)}</td>
    </tr>`;
  }

  private wireHandlers(): void {
    const root = this.getElement();
    if (!root) return;
    const slider = root.querySelector<HTMLInputElement>('.phish-score-slider');
    if (slider) {
      slider.addEventListener('input', () => {
        const v = Number(slider.value);
        if (Number.isFinite(v)) this.setMinScore(v);
      });
    }
  }
}
