/**
 * Financial domain superpower panel — deepest intelligence view for
 * financial/economic threats.
 *
 * Five sections:
 *   1. Market Stress Gauge — composite 0–100 index (equity vol, credit
 *      spreads, currency pressure).
 *   2. Crash Signal Tracker — active drawdown events by index/region.
 *   3. Credit Contagion Map — sovereign/corporate CDS leaders + region risk.
 *   4. Currency Crisis Watch — devaluations >5%, trajectory, capital controls.
 *   5. Systemic Risk Indicators — interbank stress, CB actions, exchange halts.
 *
 * All live-service calls are wrapped in safe(() => fn()) ?? fallback so the
 * panel renders from static data even before any data has loaded.
 */

import { Panel } from './Panel';
import {
  getChannelStress,
  getCascadePaths,
  type ChannelStress,
} from '@/services/financial-contagion';
import {
  getSituationStoreV2,
  type Situation,
} from '@/services/intelligence/situation-store-v2';
import {
  getUpcomingMeetings,
  type CbMeeting,
} from '@/services/central-bank-calendar';
import { escapeHtml } from '@/utils/sanitize';
import {
  blockBar,
  channelTier,
  trendArrow,
  trendColor,
  computeGaugeScore,
  gaugeTier,
  gaugeColor,
  drawdownTier,
  phaseLabel,
  phaseColor,
  trajectoryLabel,
  trajectoryColor,
  systemicColor,
  systemicIcon,
  DRAWDOWN_SIGNALS,
  SYSTEMIC_INDICATORS,
  CURRENCY_WATCH,
  type SystemicIndicator,
  type CurrencyWatch,
} from '@/services/finance/financial-superpower-helpers';
import {
  buildFsiAlert,
  type FsiObservation,
} from '@/services/finance/stress-monitor';

// Re-export helpers and data so consumers can import from the panel barrel.
export {
  trendArrow,
  trendColor,
  blockBar,
  channelTier,
  computeGaugeScore,
  gaugeTier,
  gaugeColor,
  drawdownTier,
  phaseLabel,
  phaseColor,
  trajectoryLabel,
  trajectoryColor,
  systemicColor,
  systemicIcon,
  DRAWDOWN_SIGNALS,
  SYSTEMIC_INDICATORS,
  CURRENCY_WATCH,
  SANCTIONS_TABLE,
  type DrawdownSignal,
  type DrawdownPhase,
  type SystemicIndicator,
  type SystemicCategory,
  type SystemicSeverity,
  type CurrencyWatch,
  type SanctionsRow,
  type GaugeTier,
} from '@/services/finance/financial-superpower-helpers';

const REFRESH_MS = 3 * 60 * 1000;

const DEMO_FSI: FsiObservation = { date: new Date().toISOString().slice(0, 10), index: 0 };

// ── Shared guard ──────────────────────────────────────────────────────

function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

// ── Tier→color map ────────────────────────────────────────────────────

const RISK_COLOR: Record<string, string> = {
  low:      '#4caf50',
  medium:   '#ff9800',
  high:     '#ff453a',
  critical: '#b71c1c',
};

// ── Region→channel mapping (Credit Contagion Map) ─────────────────────

const REGION_CHANNELS: { label: string; channels: string[] }[] = [
  { label: 'North America', channels: ['yield curve inversion', 'credit spread widening', 'bank stress'] },
  { label: 'Europe',        channels: ['sovereign debt stress', 'bank stress', 'credit spread widening'] },
  { label: 'Asia-Pacific',  channels: ['currency crisis', 'supply chain disruption'] },
  { label: 'Emerging Mkts', channels: ['sovereign debt stress', 'currency crisis', 'commodity shock'] },
];

// ── Panel ─────────────────────────────────────────────────────────────

export class FinancialSuperpowerPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private fsiObservation: FsiObservation = DEMO_FSI;

  constructor() {
    super({
      id: 'financial-superpower',
      title: 'Financial Superpower',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Deep intelligence view for financial domain threats: market stress gauge, crash signal tracking, credit contagion, currency crises, and systemic risk indicators.',
    });
    this.start();
  }

  /** Inject a live OFR FSI observation; triggers a re-render. */
  public updateFsi(obs: FsiObservation): void {
    this.fsiObservation = obs;
    this.render();
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
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
  }

  private render(): void {
    const channels   = safe(() => getChannelStress()) ?? [];
    const cascades   = safe(() => getCascadePaths()) ?? [];
    const situations = safe(() =>
      getSituationStoreV2().getSituations({ domain: 'finance', status: 'active' }),
    ) ?? [];
    const meetings   = safe(() => getUpcomingMeetings(3)) ?? [];

    const gaugeScore      = computeGaugeScore(channels);
    const crisisCurrencies = CURRENCY_WATCH.filter((c) => c.depreciation30d >= 5).length;
    const criticalSigs    = situations.filter(
      (s) => s.severity === 'high' || s.severity === 'critical',
    ).length;

    this.setCount((gaugeScore >= 50 ? 1 : 0) + crisisCurrencies + criticalSigs);
    this.setContent(this.buildHtml(channels, cascades, situations, meetings));
  }

  private buildHtml(
    channels:   ChannelStress[],
    cascades:   ReturnType<typeof getCascadePaths>,
    situations: Situation[],
    meetings:   CbMeeting[],
  ): string {
    return `<div class="fsp-root">${[
      this.buildGaugeSection(channels),
      this.buildCrashSection(situations),
      this.buildContagionSection(channels, cascades),
      this.buildCurrencySection(),
      this.buildSystemicSection(channels, meetings),
    ].join('')}</div>`;
  }

  // ── Section 1: Market Stress Gauge ──────────────────────────────────

  private buildGaugeSection(channels: ChannelStress[]): string {
    const score = computeGaugeScore(channels);
    const tier  = gaugeTier(score);
    const color = gaugeColor(tier);

    const COMPONENTS: { label: string; chKey: string }[] = [
      { label: 'Equity Volatility', chKey: 'vix spike' },
      { label: 'Credit Spreads',    chKey: 'credit spread widening' },
      { label: 'Currency Pressure', chKey: 'currency crisis' },
    ];
    const chMap = new Map(channels.map((c) => [c.channel.toLowerCase(), c]));

    const componentRows = COMPONENTS.map(({ label, chKey }) => {
      const ch    = chMap.get(chKey);
      const level = ch?.stressLevel ?? 0;
      const arrow = ch ? trendArrow(ch.trend) : '—';
      const aColor = ch ? trendColor(ch.trend) : '#9e9e9e';
      return `<tr>
        <td style="padding:2px 6px;font-size:11px;color:#ccc">${escapeHtml(label)}</td>
        <td style="padding:2px 6px;font-family:monospace;font-size:10px;color:#aaa">${blockBar(level)}</td>
        <td style="padding:2px 6px;text-align:right;font-size:11px">${level.toFixed(0)}</td>
        <td style="padding:2px 6px;color:${aColor}">${arrow}</td>
      </tr>`;
    }).join('');

    const fsiAlert = safe(() => buildFsiAlert(this.fsiObservation));
    const fsiNote  = fsiAlert
      ? `<div style="margin-top:4px;font-size:10px;color:#9e9e9e">OFR FSI: ${fsiAlert.index.toFixed(2)} · ${escapeHtml(fsiAlert.tier)}</div>`
      : '';

    return `
      <div class="fsp-section">
        <div class="fsp-section-header">Market Stress Gauge</div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
          <div style="font-size:32px;font-weight:bold;color:${color}">${score}</div>
          <div>
            <div style="font-size:13px;font-weight:600;color:${color};text-transform:uppercase">${escapeHtml(tier)}</div>
            <div style="font-size:11px;color:#9e9e9e">Composite / 100</div>
          </div>
          <div style="flex:1;font-family:monospace;font-size:14px;color:${color}">${blockBar(score)}</div>
        </div>
        <table style="width:100%;border-collapse:collapse">${componentRows}</table>
        ${fsiNote}
      </div>`;
  }

  // ── Section 2: Crash Signal Tracker ─────────────────────────────────

  private buildCrashSection(situations: Situation[]): string {
    const liveRows = situations
      .filter((s) => s.severity === 'high' || s.severity === 'critical')
      .slice(0, 3)
      .map((s) => {
        const sevColor = s.severity === 'critical' ? '#ff453a' : '#ff9800';
        return `<tr>
          <td style="padding:3px 6px;font-size:12px">${escapeHtml(s.name)}</td>
          <td style="padding:3px 6px;font-size:11px;color:#9e9e9e">${escapeHtml(s.domain)}</td>
          <td style="padding:3px 6px;text-align:right;color:${sevColor};font-size:11px;text-transform:uppercase">${s.severity}</td>
        </tr>`;
      }).join('');

    const staticRows = DRAWDOWN_SIGNALS
      .filter((d) => d.declinePct > 0)
      .map((d) => {
        const tier  = drawdownTier(d.declinePct);
        const color = RISK_COLOR[tier] ?? '#9e9e9e';
        const pLabel = phaseLabel(d.phase);
        const pColor = phaseColor(d.phase);
        return `<tr>
          <td style="padding:3px 6px;font-size:12px">${escapeHtml(d.index)}</td>
          <td style="padding:3px 6px;font-size:11px;color:#9e9e9e">${escapeHtml(d.region)}</td>
          <td style="padding:3px 6px;text-align:right;color:${color};font-size:11px">&minus;${d.declinePct.toFixed(1)}%</td>
          <td style="padding:3px 6px;font-size:11px;color:#9e9e9e">${d.durationDays}d</td>
          <td style="padding:3px 6px;color:${pColor};font-size:10px">${escapeHtml(pLabel)}</td>
        </tr>`;
      }).join('');

    const noData = liveRows === '' && staticRows === ''
      ? '<tr><td colspan="5" style="padding:6px;color:#9e9e9e">No active drawdown signals</td></tr>'
      : '';

    return `
      <div class="fsp-section">
        <div class="fsp-section-header">Crash Signal Tracker</div>
        <table style="width:100%;border-collapse:collapse">${liveRows}${staticRows}${noData}</table>
      </div>`;
  }

  // ── Section 3: Credit Contagion Map ──────────────────────────────────

  private buildContagionSection(
    channels: ChannelStress[],
    cascades: ReturnType<typeof getCascadePaths>,
  ): string {
    const chMap = new Map(channels.map((c) => [c.channel.toLowerCase(), c.stressLevel]));

    const regionRows = REGION_CHANNELS.map((r) => {
      const avg   = r.channels.reduce((sum, ch) => sum + (chMap.get(ch) ?? 0), 0) / r.channels.length;
      const tier  = channelTier(avg);
      const color = RISK_COLOR[tier] ?? '#9e9e9e';
      return `<tr>
        <td style="padding:3px 6px;font-size:12px">${escapeHtml(r.label)}</td>
        <td style="padding:3px 6px;font-family:monospace;font-size:10px;color:#aaa">${blockBar(avg)}</td>
        <td style="padding:3px 6px;font-size:11px;color:${color};text-transform:uppercase">${tier}</td>
      </tr>`;
    }).join('');

    const cdsLeaders = [...channels]
      .filter((c) => {
        const lc = c.channel.toLowerCase();
        return lc.includes('spread') || lc.includes('sovereign');
      })
      .sort((a, b) => b.stressLevel - a.stressLevel)
      .slice(0, 3);

    const cdsRows = cdsLeaders.map((c) => {
      const arrow  = trendArrow(c.trend);
      const aColor = trendColor(c.trend);
      return `<tr>
        <td style="padding:2px 6px;font-size:11px;color:#ccc">${escapeHtml(c.channel)}</td>
        <td style="padding:2px 6px;font-size:11px;text-align:right">${c.stressLevel.toFixed(0)}</td>
        <td style="padding:2px 6px;color:${aColor}">${arrow}</td>
      </tr>`;
    }).join('');

    const cdsBlock = cdsRows
      ? `<div style="margin-top:8px;font-size:11px;font-weight:600;color:#ccc">CDS Spread Leaders</div><table style="width:100%;border-collapse:collapse">${cdsRows}</table>`
      : '';

    const highCascades = cascades.filter((p) => p.overallProbability > 0.4);
    const cascadeNote  = highCascades.length > 0
      ? `<div style="margin-top:6px;font-size:11px;color:#ccc"><b>Active cascades (&gt;40%):</b> ${highCascades.map((p) => escapeHtml(p.trigger)).join(' · ')}</div>`
      : '';

    return `
      <div class="fsp-section">
        <div class="fsp-section-header">Credit Contagion Map</div>
        <table style="width:100%;border-collapse:collapse">${regionRows}</table>
        ${cdsBlock}${cascadeNote}
      </div>`;
  }

  // ── Section 4: Currency Crisis Watch ────────────────────────────────

  private buildCurrencySection(): string {
    const rows = CURRENCY_WATCH.map((c: CurrencyWatch) => {
      const isCrisis = c.depreciation30d >= 5;
      const isHigh   = c.depreciation30d > 2.5;

      let fgColor: string;
      if (isCrisis) fgColor = '#ff453a';
      else if (isHigh) fgColor = '#ff9800';
      else fgColor = '#9e9e9e';

      const crisisBadge = isCrisis
        ? '<span style="font-size:9px;background:#ff453a;color:#fff;border-radius:2px;padding:1px 3px;margin-left:4px">CRISIS</span>'
        : '';
      const pegBadge = c.pegged && c.depreciation30d > 0.5
        ? '<span style="font-size:9px;background:#ff9800;color:#fff;border-radius:2px;padding:1px 3px;margin-left:4px">PEG STRESS</span>'
        : '';
      const ctrlBadge = c.capitalControls
        ? '<span style="font-size:9px;background:#5c6bc0;color:#fff;border-radius:2px;padding:1px 3px;margin-left:4px">CONTROLS</span>'
        : '';

      const sign   = c.depreciation30d > 0 ? '+' : '';
      const tLabel = trajectoryLabel(c.trajectory);
      const tColor = trajectoryColor(c.trajectory);

      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:bold;color:${fgColor}">${escapeHtml(c.code)}</td>
        <td style="padding:3px 6px;font-size:11px;color:#ccc">${escapeHtml(c.name)}${crisisBadge}${pegBadge}${ctrlBadge}</td>
        <td style="padding:3px 6px;text-align:right;color:${fgColor};font-size:12px">${sign}${c.depreciation30d.toFixed(1)}%</td>
        <td style="padding:3px 6px;color:${tColor};font-size:10px">${escapeHtml(tLabel)}</td>
      </tr>`;
    }).join('');

    return `
      <div class="fsp-section">
        <div class="fsp-section-header">Currency Crisis Watch</div>
        <div style="font-size:11px;color:#9e9e9e;margin-bottom:4px">30-day depreciation vs USD · ≥5% = crisis · trajectory = trailing 7-day</div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>`;
  }

  // ── Section 5: Systemic Risk Indicators ─────────────────────────────

  private buildSystemicSection(channels: ChannelStress[], meetings: CbMeeting[]): string {
    const chMap = new Map(channels.map((c) => [c.channel.toLowerCase(), c.stressLevel]));

    const indRows = SYSTEMIC_INDICATORS.map((ind: SystemicIndicator) => {
      let severity = ind.severity;
      if (ind.category === 'interbank') {
        const lvl = chMap.get('bank stress') ?? 0;
        if (lvl > 70) severity = 'severe';
        else if (lvl > 40) severity = 'elevated';
      }
      const color = systemicColor(severity);
      const icon  = systemicIcon(severity);
      return `<tr>
        <td style="padding:2px 6px;color:${color};font-size:12px">${icon}</td>
        <td style="padding:2px 6px;font-size:12px">${escapeHtml(ind.name)}</td>
        <td style="padding:2px 6px;font-size:11px;color:#9e9e9e">${escapeHtml(ind.detail)}</td>
      </tr>`;
    }).join('');

    const meetingRows = meetings.slice(0, 3).map((m) => {
      const dayS = m.daysUntil === 1 ? '' : 's';
      return `<tr>
        <td style="padding:2px 6px;font-size:11px;color:#ccc;font-weight:600">${escapeHtml(m.shortName)} (${escapeHtml(m.currency)})</td>
        <td style="padding:2px 6px;font-size:11px;color:#9e9e9e">${m.daysUntil} day${dayS}</td>
      </tr>`;
    }).join('');

    const meetingBlock = meetingRows
      ? `<div style="margin-top:8px;font-size:11px;font-weight:600;color:#ccc">Central Bank Decisions</div><table style="width:100%;border-collapse:collapse">${meetingRows}</table>`
      : '';

    return `
      <div class="fsp-section">
        <div class="fsp-section-header">Systemic Risk Indicators</div>
        <table style="width:100%;border-collapse:collapse">${indRows}</table>
        ${meetingBlock}
      </div>`;
  }
}
