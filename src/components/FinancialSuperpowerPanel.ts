import { Panel } from './Panel';
import {
  buildFsiAlert,
  buildCommodityAlert,
  rankCommodityAlerts,
  type FsiObservation,
  type FsiTier,
  type CommoditySeries,
  type CommodityAlert,
  type CommodityRiskTier,
} from '@/services/finance/stress-monitor';
import {
  getChannelStress,
  getCascadePaths,
  type ChannelStress,
} from '@/services/financial-contagion';
import {
  getTradeRouteRiskScorerService,
  type TradeRoute,
  type RouteRiskSummary,
} from '@/services/intelligence/trade-route-risk-scorer';
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
  trendArrow,
  trendColor,
  blockBar,
  gdpTier,
  channelTier,
  formatTradeAtRisk,
  SANCTIONS_TABLE,
  CURRENCY_WATCH,
} from '@/services/finance/financial-superpower-helpers';

export {
  trendArrow,
  trendColor,
  blockBar,
  gdpTier,
  channelTier,
  formatTradeAtRisk,
  SANCTIONS_TABLE,
  CURRENCY_WATCH,
  type SanctionsRow,
  type CurrencyWatch,
} from '@/services/finance/financial-superpower-helpers';

const REFRESH_MS = 3 * 60 * 1000;

// ── Local helpers ─────────────────────────────────────────────────────

function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

const FSI_TIER_COLOR: Record<FsiTier, string> = {
  low:      '#4caf50',
  normal:   '#9e9e9e',
  elevated: '#ff9800',
  severe:   '#d50000',
};

const COMMODITY_RISK_COLOR: Record<CommodityRiskTier, string> = {
  low:      '#4caf50',
  medium:   '#ff9800',
  high:     '#f44336',
  critical: '#b71c1c',
};

const DEMO_FSI: FsiObservation = { date: new Date().toISOString().slice(0, 10), index: 0 };

const COMMODITY_LABELS: Record<string, string> = {
  wheat: 'Wheat', rice: 'Rice', oil: 'Crude Oil', natural_gas: 'Natural Gas',
  fertilizer: 'Fertilizer', corn: 'Corn', soybeans: 'Soybeans', gold: 'Gold',
};

// ── Panel ─────────────────────────────────────────────────────────────

export class FinancialSuperpowerPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  private fsiObservation: FsiObservation = DEMO_FSI;
  private commoditySeries: CommoditySeries[] = [];

  constructor() {
    super({
      id: 'financial-superpower',
      title: 'Financial Superpower',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Deep intelligence view for financial domain threats: market stress, debt contagion, sanctions impact, currency crises, and supply-chain financial risk.',
    });
    this.start();
  }

  public updateFsi(obs: FsiObservation): void {
    this.fsiObservation = obs;
    this.render();
  }

  public updateCommodities(series: CommoditySeries[]): void {
    this.commoditySeries = series;
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
    this.refreshTimer = setInterval(() => this.render(), REFRESH_MS);
  }

  private render(): void {
    const fsiAlert = safe(() => buildFsiAlert(this.fsiObservation));
    const commodityAlerts = safe(() =>
      rankCommodityAlerts(
        this.commoditySeries
          .map((s) => buildCommodityAlert(s))
          .filter((a): a is CommodityAlert => a !== null),
      ),
    ) ?? [];

    const channels  = safe(() => getChannelStress()) ?? [];
    const cascades  = safe(() => getCascadePaths()) ?? [];

    const routeSvc     = safe(() => getTradeRouteRiskScorerService());
    const routeSummary = safe(() => routeSvc?.getSummary());
    const allRoutes    = safe(() => routeSvc?.getAllRoutes()) ?? [];

    const financialSituations = safe(() =>
      getSituationStoreV2().getSituations({ domain: 'finance', status: 'active' }),
    ) ?? [];

    const nextMeeting = safe(() => getUpcomingMeetings(1)[0]);

    const criticalCount = routeSummary?.critical.length ?? 0;
    const highCommodities = commodityAlerts.filter(
      (a) => a.overallRisk === 'high' || a.overallRisk === 'critical',
    ).length;
    const fsiElevated = fsiAlert && fsiAlert.tier !== 'normal' && fsiAlert.tier !== 'low' ? 1 : 0;
    this.setCount(fsiElevated + highCommodities + criticalCount);

    this.setContent(this.buildHtml(
      fsiAlert,
      commodityAlerts,
      channels,
      cascades,
      routeSummary,
      allRoutes,
      financialSituations,
      nextMeeting,
    ));
  }

  private buildHtml(
    fsiAlert:             ReturnType<typeof buildFsiAlert> | undefined,
    commodityAlerts:      CommodityAlert[],
    channels:             ChannelStress[],
    cascades:             ReturnType<typeof getCascadePaths>,
    routeSummary:         RouteRiskSummary | undefined,
    allRoutes:            TradeRoute[],
    financialSituations:  Situation[],
    nextMeeting:          CbMeeting | undefined,
  ): string {
    return `<div class="fsp-root">${[
      this.buildMarketStressSection(fsiAlert, channels, cascades, financialSituations),
      this.buildContagionSection(channels),
      this.buildSanctionsSection(),
      this.buildCurrencySection(nextMeeting),
      this.buildCommoditySection(commodityAlerts, routeSummary, allRoutes),
    ].join('')}</div>`;
  }

  // ── Section 1: Market Stress Index ──────────────────────────────────

  private buildMarketStressSection(
    fsiAlert:   ReturnType<typeof buildFsiAlert> | undefined,
    channels:   ChannelStress[],
    cascades:   ReturnType<typeof getCascadePaths>,
    situations: Situation[],
  ): string {
    const tier      = fsiAlert?.tier ?? 'normal';
    const tierColor = FSI_TIER_COLOR[tier];
    const indexStr  = fsiAlert ? fsiAlert.index.toFixed(2) : '—';

    const elevated    = channels.filter((c) => c.stressLevel > 30);
    const topChannels = [...elevated].sort((a, b) => b.stressLevel - a.stressLevel).slice(0, 4);

    const sortedCascades = [...cascades].sort((a, b) => b.overallProbability - a.overallProbability);
    const topCascade = sortedCascades[0];
    const cascadeHtml = topCascade
      ? `<div style="margin-top:6px;font-size:11px;color:#ccc">Top cascade: <b>${escapeHtml(topCascade.trigger)}</b> — ${(topCascade.overallProbability * 100).toFixed(0)}% probability</div>`
      : '';

    const situationSuffix = situations.length > 1 ? 's' : '';
    const situationHtml = situations.length > 0
      ? `<div style="margin-top:4px;font-size:11px;color:#ff9800">${situations.length} active finance situation${situationSuffix}</div>`
      : '';

    const channelRows = topChannels.length > 0
      ? topChannels.map((c) => {
          const arrow = trendArrow(c.trend);
          const color = trendColor(c.trend);
          return `<tr>
            <td style="padding:3px 6px">${escapeHtml(c.channel)}</td>
            <td style="padding:3px 6px;font-family:monospace;font-size:11px;color:#aaa">${blockBar(c.stressLevel)}</td>
            <td style="padding:3px 6px;text-align:right">${c.stressLevel.toFixed(0)}</td>
            <td style="padding:3px 6px;color:${color}">${arrow}</td>
          </tr>`;
        }).join('')
      : '<tr><td colspan="4" style="padding:6px;color:#9e9e9e">No elevated channels</td></tr>';

    const messageHtml = fsiAlert
      ? `<div style="font-size:11px;color:#ccc;margin-bottom:6px">${escapeHtml(fsiAlert.message)}</div>`
      : '';

    return `
      <div class="fsp-section">
        <div class="fsp-section-header">Market Stress Index</div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
          <div style="font-size:28px;font-weight:bold;color:${tierColor}">${indexStr}</div>
          <div>
            <div style="font-size:12px;color:${tierColor};text-transform:uppercase;font-weight:600">${escapeHtml(tier)}</div>
            <div style="font-size:11px;color:#9e9e9e">OFR Financial Stress Index</div>
          </div>
        </div>
        ${messageHtml}
        <table style="width:100%;border-collapse:collapse;font-size:12px">${channelRows}</table>
        ${cascadeHtml}
        ${situationHtml}
      </div>`;
  }

  // ── Section 2: Contagion Risk Map ────────────────────────────────────

  private buildContagionSection(channels: ChannelStress[]): string {
    const REGIONS: { label: string; channels: string[] }[] = [
      { label: 'North America', channels: ['yield curve inversion', 'credit spread widening', 'bank stress'] },
      { label: 'Europe',        channels: ['sovereign debt stress', 'bank stress'] },
      { label: 'Asia-Pacific',  channels: ['currency crisis', 'supply chain disruption'] },
      { label: 'Emerging Mkts', channels: ['sovereign debt stress', 'currency crisis', 'commodity shock'] },
    ];

    const channelMap = new Map(channels.map((c) => [c.channel.toLowerCase(), c.stressLevel]));

    const regionRows = REGIONS.map((r) => {
      const avg   = r.channels.reduce((sum, ch) => sum + (channelMap.get(ch) ?? 0), 0) / r.channels.length;
      const tier  = channelTier(avg);
      const color = COMMODITY_RISK_COLOR[tier];
      return `<tr>
        <td style="padding:3px 6px;font-size:12px">${escapeHtml(r.label)}</td>
        <td style="padding:3px 6px;font-family:monospace;font-size:10px;color:#aaa">${blockBar(avg)}</td>
        <td style="padding:3px 6px;color:${color};font-size:11px;text-transform:uppercase">${tier}</td>
      </tr>`;
    }).join('');

    const cascadePaths = safe(() => getCascadePaths()) ?? [];
    const highProb = cascadePaths.filter((p) => p.overallProbability > 0.4);
    const exposureHtml = highProb.length > 0
      ? `<div style="margin-top:6px;font-size:11px;color:#ccc"><b>Cross-border cascades (&gt;40%):</b> ${highProb.map((p) => escapeHtml(p.trigger)).join(', ')}</div>`
      : '';

    return `
      <div class="fsp-section">
        <div class="fsp-section-header">Contagion Risk Map</div>
        <table style="width:100%;border-collapse:collapse">${regionRows}</table>
        ${exposureHtml}
      </div>`;
  }

  // ── Section 3: Sanctions Economic Impact ────────────────────────────

  private buildSanctionsSection(): string {
    const sorted = [...SANCTIONS_TABLE].sort((a, b) => b.estimatedGdpImpactPct - a.estimatedGdpImpactPct);
    const rows = sorted.map((r) => {
      const tier  = gdpTier(r.estimatedGdpImpactPct);
      const color = COMMODITY_RISK_COLOR[tier];
      return `<tr>
        <td style="padding:3px 6px;font-size:12px">${escapeHtml(r.country)}</td>
        <td style="padding:3px 6px;font-size:11px;color:#9e9e9e">${escapeHtml(r.regime)}</td>
        <td style="padding:3px 6px;text-align:right;color:${color};font-size:12px">${r.estimatedGdpImpactPct.toFixed(1)}%</td>
      </tr>`;
    }).join('');

    return `
      <div class="fsp-section">
        <div class="fsp-section-header">Sanctions Economic Impact</div>
        <div style="font-size:11px;color:#9e9e9e;margin-bottom:4px">Estimated GDP drag from OFAC sanctions regimes (IMF-derived, 2025 data)</div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>`;
  }

  // ── Section 4: Currency Crisis Watch ────────────────────────────────

  private buildCurrencySection(nextMeeting: CbMeeting | undefined): string {
    const CRISIS_THRESHOLD    = 5;
    const PEG_WARN_THRESHOLD  = 0.5;
    const HIGH_WARN_THRESHOLD = 2.5;

    const rows = CURRENCY_WATCH.map((c) => {
      const isCrisis  = c.depreciation30d >= CRISIS_THRESHOLD;
      const isPegWarn = c.pegged && c.depreciation30d > PEG_WARN_THRESHOLD;
      const isHigh    = c.depreciation30d > HIGH_WARN_THRESHOLD;

      let color: string;
      if (isCrisis) color = '#d50000';
      else if (isHigh) color = '#ff9800';
      else color = '#9e9e9e';

      let badge: string;
      if (isCrisis) {
        badge = '<span style="font-size:10px;background:#d50000;color:#fff;border-radius:2px;padding:1px 4px;margin-left:4px">CRISIS</span>';
      } else if (isPegWarn) {
        badge = '<span style="font-size:10px;background:#ff9800;color:#fff;border-radius:2px;padding:1px 4px;margin-left:4px">PEG STRESS</span>';
      } else {
        badge = '';
      }

      const sign = c.depreciation30d > 0 ? '+' : '';
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:bold;color:${color}">${escapeHtml(c.code)}</td>
        <td style="padding:3px 6px;font-size:11px;color:#ccc">${escapeHtml(c.name)}${badge}</td>
        <td style="padding:3px 6px;text-align:right;color:${color};font-size:12px">${sign}${c.depreciation30d.toFixed(1)}%</td>
      </tr>`;
    }).join('');

    const meetingDaySuffix = nextMeeting?.daysUntil === 1 ? '' : 's';
    const meetingHtml = nextMeeting
      ? `<div style="margin-top:6px;font-size:11px;color:#9e9e9e">Next CB decision: <b style="color:#ccc">${escapeHtml(nextMeeting.shortName)}</b> (${escapeHtml(nextMeeting.currency)}) — ${nextMeeting.daysUntil} day${meetingDaySuffix}</div>`
      : '';

    return `
      <div class="fsp-section">
        <div class="fsp-section-header">Currency Crisis Watch</div>
        <div style="font-size:11px;color:#9e9e9e;margin-bottom:4px">30-day depreciation vs USD · ≥5% = crisis signal</div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
        ${meetingHtml}
      </div>`;
  }

  // ── Section 5: Commodity Shock Monitor ──────────────────────────────

  private buildCommoditySection(
    commodityAlerts: CommodityAlert[],
    routeSummary:    RouteRiskSummary | undefined,
    allRoutes:       TradeRoute[],
  ): string {
    const commodityRows = commodityAlerts.length > 0
      ? commodityAlerts.slice(0, 6).map((a) => {
          const color  = COMMODITY_RISK_COLOR[a.overallRisk];
          const arrow  = trendArrow(a.trend);
          const color2 = trendColor(a.trend);
          return `<tr>
            <td style="padding:3px 6px;font-size:12px">${escapeHtml(COMMODITY_LABELS[a.commodity] ?? a.commodity)}</td>
            <td style="padding:3px 6px;font-size:11px;color:#9e9e9e">${escapeHtml(a.unit)}</td>
            <td style="padding:3px 6px;text-align:right;color:${color};font-size:11px;text-transform:uppercase">${a.overallRisk}</td>
            <td style="padding:3px 6px;color:${color2}">${arrow}</td>
          </tr>`;
        }).join('')
      : '<tr><td colspan="4" style="padding:6px;color:#9e9e9e">Awaiting commodity data</td></tr>';

    const criticalCount = routeSummary?.critical.length ?? 0;
    const highCount     = routeSummary?.high.length ?? 0;
    const totalAtRisk   = routeSummary?.totalTradeAtRiskUsd ?? 0;

    let riskColor: string;
    if (criticalCount > 0) riskColor = '#d50000';
    else if (highCount > 0) riskColor = '#ff9800';
    else riskColor = '#4caf50';

    const topRoutes = [...(routeSummary?.critical ?? []), ...(routeSummary?.high ?? [])].slice(0, 4);
    const routeRows = topRoutes.map((r) => {
      const rColor = r.riskLevel === 'critical' ? '#d50000' : '#ff9800';
      return `<tr>
        <td style="padding:2px 6px;font-size:11px">${escapeHtml(r.name)}</td>
        <td style="padding:2px 6px;text-align:right;color:${rColor};font-size:11px">${r.riskLevel}</td>
      </tr>`;
    }).join('');

    const routeTableHtml = routeRows
      ? `<table style="width:100%;border-collapse:collapse;margin-top:4px">${routeRows}</table>`
      : '';

    return `
      <div class="fsp-section">
        <div class="fsp-section-header">Commodity Shock Monitor</div>
        <table style="width:100%;border-collapse:collapse">${commodityRows}</table>
        <div style="margin-top:8px;font-size:11px;font-weight:600;color:#ccc">Supply Chain Financial Risk</div>
        <div style="margin-top:4px;display:flex;gap:12px;font-size:11px;color:#9e9e9e">
          <span>Routes: <b style="color:#ccc">${allRoutes.length}</b></span>
          <span style="color:${riskColor}">Critical: <b>${criticalCount}</b></span>
          <span>Trade at risk: <b style="color:${riskColor}">${formatTradeAtRisk(totalAtRisk)}</b></span>
        </div>
        ${routeTableHtml}
      </div>`;
  }
}
