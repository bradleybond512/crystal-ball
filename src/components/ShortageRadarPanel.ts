/* eslint-disable sonarjs/no-nested-conditional, sonarjs/no-nested-template-literals */
/**
 * Shortage Radar Panel — gap #9 in
 * docs/ELITE_REMAINING_GAPS_FOR_CLAUDE.md.
 *
 * Renders the buildShortageRadar() report so commodity stress is
 * visible in-app instead of hiding inside service tests. The host
 * passes commodity inputs in via setRequests(); the panel sorts,
 * tiers, and renders.
 *
 * Pure DOM render — no fetch, no globals. Defaults to an empty radar
 * when the host hasn't wired live inputs yet (with a friendly empty
 * state explaining what to do next).
 */

import { Panel } from './Panel';
import {
  buildShortageRadar,
  ALL_RADAR_COMMODITIES,
  type ShortageRadarRequest,
  type ShortageRadarReport,
  type ShortageRadarEntry,
} from '@/services/shortage/shortage-radar';
import type { ShortageConfidence } from '@/services/shortage/shortage-types';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30_000;

const TIER_COLOR: Record<string, string> = {
  CRITICAL: '#d50000',
  ELEVATED: '#ff9800',
  WATCH: '#ffeb3b',
  CALM: '#4caf50',
};

const CONFIDENCE_COLOR: Record<ShortageConfidence, string> = {
  high: '#4caf50',
  medium: '#ff9800',
  low: '#f44336',
};

function defaultRequests(): ShortageRadarRequest[] {
  return ALL_RADAR_COMMODITIES.map((c) => ({
    commodity: c,
    region: 'global',
    inputs: {},
  }));
}

export class ShortageRadarPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private requests: ShortageRadarRequest[] = defaultRequests();

  constructor() {
    super({
      id: 'shortage-radar',
      title: 'Shortage Radar',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Cross-commodity shortage risk: wheat, corn, diesel, gasoline, sugar, coffee, cocoa. Sorted by risk score, then confidence. Wire live inputs via setRequests().',
    });
    this.start();
  }

  /** Allows the host (data loader / sidecar bridge) to inject live
   *  inputs. The radar re-renders on the next tick. */
  public setRequests(requests: readonly ShortageRadarRequest[]): void {
    this.requests = requests.map((r) => ({ ...r, inputs: { ...r.inputs } }));
    this.render();
  }

  public dispose(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.render(), REFRESH_MS);
  }

  private render(): void {
    const report = buildShortageRadar(this.requests);
    const concerning = report.entries.filter((e) => e.forecast.riskScore >= 50).length;
    this.setCount(concerning);
    this.setContent(this.buildHtml(report));
  }

  private buildHtml(report: ShortageRadarReport): string {
    if (report.entries.length === 0) {
      return `<div style="padding:14px;color:var(--text-secondary,#aaa);font-size:13px;">
        No commodity feeds wired into the radar yet.<br/><br/>
        <span style="font-size:11px;">The radar runs the wheat / corn / diesel / gasoline / sugar / coffee / cocoa models. Wire your inputs by calling <code>panel.setRequests(...)</code> from the data loader.</span>
      </div>`;
    }
    const recsHtml = report.recommendations.length === 0
      ? `<div style="font-size:11px;color:var(--text-secondary,#aaa);">All commodities below the elevated threshold.</div>`
      : `<ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.5;">${report.recommendations.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`;
    const rows = report.entries.map((e) => this.renderEntry(e)).join('');
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      <div>
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Overall</div>
        <div style="font-size:13px;font-weight:600;">${escapeHtml(report.summary)}</div>
      </div>
      <div>
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">What you should watch</div>
        ${recsHtml}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;">${rows}</div>
    </div>`;
  }

  private renderEntry(e: ShortageRadarEntry): string {
    const tier = e.headline.split(': ').pop() ?? 'CALM';
    const color = TIER_COLOR[tier] ?? '#9e9e9e';
    const confidenceColor = CONFIDENCE_COLOR[e.forecast.confidence];
    const drivers = e.topDrivers.length === 0
      ? `<div style="font-size:11px;color:var(--text-secondary,#aaa);">No drivers above threshold.</div>`
      : e.topDrivers.map((d) => `<li style="font-size:11px;">${escapeHtml(d)}</li>`).join('');
    const driverList = e.topDrivers.length === 0
      ? drivers
      : `<ul style="margin:4px 0 0 0;padding-left:16px;">${drivers}</ul>`;
    const gapsHtml = e.forecast.dataGaps.length === 0
      ? ''
      : `<div style="font-size:10px;color:#ff9800;margin-top:4px;">⚠ ${e.forecast.dataGaps.length} data gap${e.forecast.dataGaps.length === 1 ? '' : 's'}: ${escapeHtml(e.forecast.dataGaps.slice(0, 3).join('; '))}</div>`;
    return `<div style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${color};border-radius:3px;padding:10px 12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-weight:700;font-size:13px;">${escapeHtml(e.headline.split(': ')[0] ?? e.commodity)}</span>
          <span style="font-size:10px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(tier)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:10px;color:${confidenceColor};text-transform:uppercase;">${escapeHtml(e.forecast.confidence)}</span>
          <span style="font-size:14px;font-weight:700;color:${color};font-family:ui-monospace,monospace;">${e.forecast.riskScore.toFixed(0)}</span>
        </div>
      </div>
      <div style="margin-top:6px;font-size:11px;color:var(--text-secondary,#aaa);">
        Horizon ${e.forecast.horizonDays}d · ${e.forecast.drivers.length} driver${e.forecast.drivers.length === 1 ? '' : 's'} · region ${escapeHtml(e.forecast.region)}
      </div>
      <div style="margin-top:4px;font-size:11px;">
        <span style="color:var(--text-secondary,#aaa);text-transform:uppercase;font-size:10px;">Top drivers</span>
        ${driverList}
      </div>
      ${gapsHtml}
      ${this.renderConfirming(e.forecast.confirmingIndicators)}
    </div>`;
  }

  private renderConfirming(indicators: readonly string[]): string {
    if (indicators.length === 0) return '';
    return `<div style="margin-top:6px;font-size:10px;color:var(--text-secondary,#aaa);">
      <span style="text-transform:uppercase;">Watch next</span> · ${escapeHtml(indicators.slice(0, 3).join(', '))}
    </div>`;
  }
}

// re-export type for callers that want the driver shape without
// reaching into the shortage-types module.
export type { ShortageDriver } from '@/services/shortage/shortage-types';
