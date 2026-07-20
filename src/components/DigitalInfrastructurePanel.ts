/**
 * Digital Infrastructure threat panel — seven sections covering the
 * surfaces that, when impaired, take the modern internet offline:
 *
 *   1. Undersea cable incidents
 *   2. Internet exchange point (IXP) disruptions
 *   3. BGP hijacks and route leaks
 *   4. DNS infrastructure attacks
 *   5. Cloud provider outages
 *   6. CDN disruptions
 *   7. Satellite internet status
 *
 * Live observation-store queries are wrapped in safe() so the panel always
 * renders from static data even before any live data has loaded.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { query } from '@/services/intelligence/observation-store';
import {
  severityColor,
  statusColor,
  statusLabel,
  cableIncidentLabel,
  bgpEventLabel,
  dnsAttackLabel,
  cloudProviderLabel,
  satStatusLabel,
  satStatusColor,
  formatGbps,
  formatQps,
  formatUsersM,
  formatDuration,
  totalImpairmentCount,
  UNDERSEA_CABLE_INCIDENTS,
  IXP_DISRUPTIONS,
  BGP_EVENTS,
  DNS_ATTACKS,
  CLOUD_OUTAGES,
  CDN_DISRUPTIONS,
  SATELLITE_SYSTEMS,
  type UnderseaCableIncident,
  type IxpDisruption,
  type BgpEvent,
  type DnsAttack,
  type CloudOutage,
  type CdnDisruption,
  type SatelliteSystem,
} from './digital-infrastructure-helpers';

const REFRESH_MS = 5 * 60 * 1000;

function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

export class DigitalInfrastructurePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'digital-infrastructure',
      title: 'Digital Infrastructure',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Live status across the seven internet-layer surfaces: undersea cables, IXPs, BGP, DNS, cloud, CDN, and satellite internet.',
    });
    this.start();
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
    const liveEvents = safe(() => query({ domain: 'cyber', limit: 50 })) ?? [];
    const liveHigh = liveEvents.filter((e) => e.severity === 'HIGH' || e.severity === 'CRITICAL').length;

    const badge = totalImpairmentCount({
      cables: UNDERSEA_CABLE_INCIDENTS,
      ixps: IXP_DISRUPTIONS,
      bgp: BGP_EVENTS,
      dns: DNS_ATTACKS,
      cloud: CLOUD_OUTAGES,
      cdn: CDN_DISRUPTIONS,
      sat: SATELLITE_SYSTEMS,
    });

    this.setCount(badge + liveHigh);
    this.setContent(this.buildHtml());
  }

  private buildHtml(): string {
    return `<div class="dip-root">${[
      this.buildCableSection(),
      this.buildIxpSection(),
      this.buildBgpSection(),
      this.buildDnsSection(),
      this.buildCloudSection(),
      this.buildCdnSection(),
      this.buildSatelliteSection(),
    ].join('')}</div>`;
  }

  // ── Section 1: Undersea Cables ───────────────────────────────────────

  private buildCableSection(): string {
    const rows = UNDERSEA_CABLE_INCIDENTS.map((c: UnderseaCableIncident) => {
      const sev = severityColor(c.severity);
      const countries = c.affectedCountries.join(' · ');
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600;color:${sev}">${escapeHtml(c.cableName)}</td>
        <td style="padding:3px 6px;font-size:11px;color:#ccc">${escapeHtml(c.region)}</td>
        <td style="padding:3px 6px;font-size:11px;color:#9e9e9e">${escapeHtml(cableIncidentLabel(c.incidentType))}</td>
        <td style="padding:3px 6px;text-align:right;font-size:11px;color:#ccc">${escapeHtml(formatGbps(c.capacityLossGbps))}</td>
        <td style="padding:3px 6px;text-align:right;font-size:10px;text-transform:uppercase;color:${sev}">${c.severity}</td>
      </tr>
      <tr>
        <td colspan="5" style="padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222">${escapeHtml(countries)} · ${escapeHtml(c.detail)}</td>
      </tr>`;
    }).join('');

    return `
      <div class="dip-section">
        <div class="dip-section-header">Undersea Cable Incidents</div>
        <div style="font-size:11px;color:#9e9e9e;margin-bottom:4px">Capacity loss · affected countries · cause</div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>`;
  }

  // ── Section 2: IXP Disruptions ───────────────────────────────────────

  private buildIxpSection(): string {
    const rows = IXP_DISRUPTIONS.map((d: IxpDisruption) => {
      const color = statusColor(d.status);
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600">${escapeHtml(d.ixpName)}</td>
        <td style="padding:3px 6px;font-size:11px;color:#9e9e9e">${escapeHtml(d.city)} (${escapeHtml(d.countryCode)})</td>
        <td style="padding:3px 6px;text-align:right;font-size:11px;color:${color}">${d.peersAffectedPct}%</td>
        <td style="padding:3px 6px;font-size:10px;text-transform:uppercase;color:${color}">${escapeHtml(statusLabel(d.status))}</td>
      </tr>
      <tr>
        <td colspan="4" style="padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222">${escapeHtml(d.cause)}</td>
      </tr>`;
    }).join('');

    return `
      <div class="dip-section">
        <div class="dip-section-header">Internet Exchange Points</div>
        <div style="font-size:11px;color:#9e9e9e;margin-bottom:4px">Peer reachability · status</div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>`;
  }

  // ── Section 3: BGP Hijacks / Route Leaks ─────────────────────────────

  private buildBgpSection(): string {
    const rows = BGP_EVENTS.map((b: BgpEvent) => {
      const sev = severityColor(b.severity);
      const dur = formatDuration(b.durationMin);
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600;color:${sev}">${escapeHtml(b.prefix)}</td>
        <td style="padding:3px 6px;font-size:11px;color:#ccc">${escapeHtml(bgpEventLabel(b.kind))}</td>
        <td style="padding:3px 6px;font-size:11px;color:#9e9e9e">AS${b.originAsn} ${escapeHtml(b.originName)}</td>
        <td style="padding:3px 6px;text-align:right;font-size:11px;color:#ccc">${escapeHtml(dur)}</td>
        <td style="padding:3px 6px;text-align:right;font-size:10px;text-transform:uppercase;color:${sev}">${b.severity}</td>
      </tr>
      <tr>
        <td colspan="5" style="padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222">Victim: AS${b.victimAsn} ${escapeHtml(b.victimName)}</td>
      </tr>`;
    }).join('');

    return `
      <div class="dip-section">
        <div class="dip-section-header">BGP Hijacks &amp; Route Leaks</div>
        <div style="font-size:11px;color:#9e9e9e;margin-bottom:4px">Prefix · event class · origin · duration</div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>`;
  }

  // ── Section 4: DNS Infrastructure Attacks ────────────────────────────

  private buildDnsSection(): string {
    const rows = DNS_ATTACKS.map((a: DnsAttack) => {
      const sev = severityColor(a.severity);
      const mit = a.mitigated ? 'mitigated' : 'UNMITIGATED';
      const mitColor = a.mitigated ? '#43a047' : '#b71c1c';
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600">${escapeHtml(a.target)}</td>
        <td style="padding:3px 6px;font-size:11px;color:#ccc">${escapeHtml(dnsAttackLabel(a.attackType))}</td>
        <td style="padding:3px 6px;text-align:right;font-size:11px;color:#ccc">${escapeHtml(formatQps(a.peakQps))}</td>
        <td style="padding:3px 6px;text-align:right;font-size:10px;text-transform:uppercase;color:${mitColor}">${mit}</td>
        <td style="padding:3px 6px;text-align:right;font-size:10px;text-transform:uppercase;color:${sev}">${a.severity}</td>
      </tr>
      <tr>
        <td colspan="5" style="padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222">${escapeHtml(a.detail)}</td>
      </tr>`;
    }).join('');

    return `
      <div class="dip-section">
        <div class="dip-section-header">DNS Infrastructure Attacks</div>
        <div style="font-size:11px;color:#9e9e9e;margin-bottom:4px">Target · attack class · peak QPS · mitigation</div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>`;
  }

  // ── Section 5: Cloud Provider Outages ────────────────────────────────

  private buildCloudSection(): string {
    const rows = CLOUD_OUTAGES.map((o: CloudOutage) => {
      const color = statusColor(o.status);
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600">${escapeHtml(cloudProviderLabel(o.provider))}</td>
        <td style="padding:3px 6px;font-size:11px;color:#ccc">${escapeHtml(o.service)}</td>
        <td style="padding:3px 6px;font-size:11px;color:#9e9e9e">${escapeHtml(o.region)}</td>
        <td style="padding:3px 6px;text-align:right;font-size:10px;text-transform:uppercase;color:${color}">${escapeHtml(statusLabel(o.status))}</td>
      </tr>
      <tr>
        <td colspan="4" style="padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222">${escapeHtml(o.impact)}</td>
      </tr>`;
    }).join('');

    return `
      <div class="dip-section">
        <div class="dip-section-header">Cloud Provider Status</div>
        <div style="font-size:11px;color:#9e9e9e;margin-bottom:4px">Provider · service · region · status</div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>`;
  }

  // ── Section 6: CDN Disruptions ───────────────────────────────────────

  private buildCdnSection(): string {
    const rows = CDN_DISRUPTIONS.map((d: CdnDisruption) => {
      const color = statusColor(d.status);
      let errColor = '#43a047';
      if (d.errorRatePct >= 5) errColor = '#b71c1c';
      else if (d.errorRatePct >= 1) errColor = '#fb8c00';
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600">${escapeHtml(d.cdnName)}</td>
        <td style="padding:3px 6px;font-size:11px;color:#9e9e9e">${escapeHtml(d.pop)}</td>
        <td style="padding:3px 6px;text-align:right;font-size:11px;color:${errColor}">${d.errorRatePct.toFixed(1)}%</td>
        <td style="padding:3px 6px;text-align:right;font-size:10px;text-transform:uppercase;color:${color}">${escapeHtml(statusLabel(d.status))}</td>
      </tr>
      <tr>
        <td colspan="4" style="padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222">${escapeHtml(d.cause)}</td>
      </tr>`;
    }).join('');

    return `
      <div class="dip-section">
        <div class="dip-section-header">CDN Edge Status</div>
        <div style="font-size:11px;color:#9e9e9e;margin-bottom:4px">POP · error rate · status</div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>`;
  }

  // ── Section 7: Satellite Internet ────────────────────────────────────

  private buildSatelliteSection(): string {
    const rows = SATELLITE_SYSTEMS.map((s: SatelliteSystem) => {
      const color = satStatusColor(s.status);
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600">${escapeHtml(s.systemName)}</td>
        <td style="padding:3px 6px;font-size:11px;color:#9e9e9e">${escapeHtml(s.orbitClass)}</td>
        <td style="padding:3px 6px;text-align:right;font-size:11px;color:#ccc">${escapeHtml(formatUsersM(s.activeUsersM))}</td>
        <td style="padding:3px 6px;text-align:right;font-size:10px;text-transform:uppercase;color:${color}">${escapeHtml(satStatusLabel(s.status))}</td>
      </tr>
      <tr>
        <td colspan="4" style="padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222">${escapeHtml(s.note)}</td>
      </tr>`;
    }).join('');

    return `
      <div class="dip-section">
        <div class="dip-section-header">Satellite Internet</div>
        <div style="font-size:11px;color:#9e9e9e;margin-bottom:4px">Orbit class · active users · status</div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>`;
  }
}
