/**
 * HybridWarfarePanel — strictly analytical, defensive monitoring of
 * publicly reported hybrid-operation indicators (cyber + disinfo +
 * proxy-force + economic / lawfare / kinetic-deniable activity).
 *
 * Six sections, all framed as observations of open-source reporting:
 *   1. Coordinated Hybrid Operation Indicators — multi-vector patterns
 *      ranked by composite coordination score.
 *   2. Grey-Zone Activity Tracker — sub-threshold activity patterns
 *      (GPS jamming, cable approach, airspace incursion, …).
 *   3. Election Interference Signals — disinfo, hack-and-leak, deepfake
 *      and voter-suppression / foreign-donation tracking.
 *   4. Infrastructure Sabotage Events — reported incidents against
 *      pipelines, undersea cables, grid, satellites, rail, water, GPS.
 *   5. Proxy Force Mobilization — reported PMC / non-state arming /
 *      paramilitary buildup / maritime militia / volunteer legion activity.
 *   6. Deniable Attribution Confidence — per-actor confidence reported as
 *      a probability over observed indicator patterns. NOT an accusation.
 *
 * Surfaces patterns; does not recommend offensive actions. Pure logic
 * lives in `hybrid-warfare-helpers.ts`; this file is the thin Panel
 * wrapper.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  buildActorProfiles,
  buildElectionInterference,
  buildGreyZoneActivities,
  buildHybridOperations,
  buildProxyForces,
  buildSabotageEvents,
  actorTier,
  attributionColor,
  attributionLabel,
  coordinationScore,
  formatStrength,
  formatTimeAgo,
  greyZoneLabel,
  hybridHeadlineCount,
  interferenceLabel,
  isCoordinated,
  proxyLabel,
  sabotageLabel,
  severityColor,
  severityLabel,
  vectorLabel,
  type ActorAttributionProfile,
  type ElectionInterferenceSignal,
  type GreyZoneActivity,
  type HybridOperationIndicator,
  type InfrastructureSabotageEvent,
  type ProxyForceMobilization,
} from './hybrid-warfare-helpers';

const REFRESH_MS = 30 * 60 * 1000; // 30 minutes

export class HybridWarfarePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'hybrid-warfare',
      title: 'Hybrid Warfare Monitor',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Defensive analytical monitoring of publicly reported hybrid-operation indicators: multi-vector patterns, grey-zone activity, election interference signals, infrastructure sabotage events, proxy mobilization, and per-actor deniable-attribution confidence. Surfaces patterns from open reporting — does not recommend actions. 30-min refresh.',
    });
    this.render();
    this.refreshTimer = setInterval(() => this.render(), REFRESH_MS);
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private render(): void {
    const now = Date.now();
    const ops = buildHybridOperations(now);
    const grey = buildGreyZoneActivities(now);
    const elections = buildElectionInterference();
    const sabotage = buildSabotageEvents(now);
    const proxies = buildProxyForces();
    const actors = buildActorProfiles();

    this.setCount(hybridHeadlineCount(ops, sabotage, elections));
    this.setContent(
      this.buildCoordinatedSection(ops, now)
      + this.buildGreyZoneSection(grey, now)
      + this.buildElectionSection(elections)
      + this.buildSabotageSection(sabotage, now)
      + this.buildProxySection(proxies)
      + this.buildAttributionSection(actors),
    );
  }

  private sectionHeader(title: string, source: string): string {
    return `<div style="display:flex;align-items:baseline;justify-content:space-between;margin:14px 0 6px;">
      <strong style="font-size:13px;">${escapeHtml(title)}</strong>
      <span style="font-size:10px;opacity:0.6;">Source: ${escapeHtml(source)}</span>
    </div>`;
  }

  // ── Section 1: Coordinated hybrid operations ─────────────────────────

  private buildCoordinatedSection(ops: HybridOperationIndicator[], now: number): string {
    const sorted = [...ops].sort(
      (a, b) => coordinationScore(b, now) - coordinationScore(a, now),
    );
    const rows = sorted.map((op: HybridOperationIndicator) => {
      const sc = severityColor(op.severity);
      const ac = attributionColor(op.attribution);
      const vectorChips = op.vectors.map((v) => `<span style="display:inline-block;padding:1px 5px;margin-right:3px;background:rgba(255,255,255,0.06);border-radius:3px;font-size:10px;">${escapeHtml(vectorLabel(v))}</span>`).join('');
      const score = coordinationScore(op, now);
      const coordBadge = isCoordinated(op)
        ? `<span style="padding:1px 6px;background:#7e57c2;color:#fff;border-radius:3px;font-size:10px;">MULTI-VECTOR</span>`
        : '';
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600;color:${sc};width:200px;">${escapeHtml(op.target)}</td>
        <td style="padding:3px 6px;font-size:11px;">${escapeHtml(op.actor)}</td>
        <td style="padding:3px 6px;font-size:10px;text-transform:uppercase;color:${ac};width:80px;">${escapeHtml(attributionLabel(op.attribution))}</td>
        <td style="padding:3px 6px;font-size:11px;opacity:0.7;width:80px;">${escapeHtml(formatTimeAgo(op.timestamp, now))}</td>
        <td style="padding:3px 6px;text-align:right;font-size:11px;font-weight:600;width:50px;">${score}</td>
        <td style="padding:3px 6px;text-align:right;font-size:10px;text-transform:uppercase;color:${sc};width:80px;">${escapeHtml(severityLabel(op.severity))}</td>
      </tr>
      <tr>
        <td colspan="6" style="padding:0 6px 4px 6px;font-size:10px;opacity:0.7;">${vectorChips} ${coordBadge}</td>
      </tr>
      <tr>
        <td colspan="6" style="padding:0 6px 4px 6px;font-size:10px;opacity:0.65;border-bottom:1px solid #222;">${escapeHtml(op.summary)}</td>
      </tr>`;
    }).join('');
    return `${this.sectionHeader('Coordinated Hybrid Operation Indicators', 'CSIS / RUSI / Atlantic Council OSINT')}
      <div style="font-size:11px;opacity:0.65;margin-bottom:4px;">Composite 0–100 score over open-source indicators: vector breadth × attribution confidence × recency. Multi-vector = 2+ distinct vectors observed in reporting. Analytical monitoring only.</div>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>`;
  }

  // ── Section 2: Grey-zone activity ────────────────────────────────────

  private buildGreyZoneSection(activities: GreyZoneActivity[], now: number): string {
    const sorted = [...activities].sort(
      (a, b) => b.severity - a.severity || b.timestamp - a.timestamp,
    );
    const rows = sorted.map((g: GreyZoneActivity) => {
      const sc = severityColor(g.severity);
      const ac = attributionColor(g.attribution);
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600;color:${sc};width:200px;">${escapeHtml(g.region)}</td>
        <td style="padding:3px 6px;font-size:11px;">${escapeHtml(greyZoneLabel(g.kind))}</td>
        <td style="padding:3px 6px;font-size:11px;opacity:0.8;width:100px;">${escapeHtml(g.actor)}</td>
        <td style="padding:3px 6px;font-size:10px;text-transform:uppercase;color:${ac};width:80px;">${escapeHtml(attributionLabel(g.attribution))}</td>
        <td style="padding:3px 6px;font-size:11px;opacity:0.7;width:80px;">${escapeHtml(formatTimeAgo(g.timestamp, now))}</td>
        <td style="padding:3px 6px;text-align:right;font-size:10px;text-transform:uppercase;color:${sc};width:80px;">${escapeHtml(severityLabel(g.severity))}</td>
      </tr>
      <tr>
        <td colspan="6" style="padding:0 6px 4px 6px;font-size:10px;opacity:0.65;border-bottom:1px solid #222;">${escapeHtml(g.detail)}</td>
      </tr>`;
    }).join('');
    return `${this.sectionHeader('Grey-Zone Activity Tracker', 'ACLED / Lloyd\'s List / open-source maritime')}
      <div style="font-size:11px;opacity:0.65;margin-bottom:4px;">Sub-threshold activity patterns observed in open reporting; analytical monitoring only.</div>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>`;
  }

  // ── Section 3: Election interference ─────────────────────────────────

  private buildElectionSection(signals: ElectionInterferenceSignal[]): string {
    const sorted = [...signals].sort((a, b) => b.severity - a.severity);
    const rows = sorted.map((e: ElectionInterferenceSignal) => {
      const sc = severityColor(e.severity);
      const ac = attributionColor(e.attribution);
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600;color:${sc};width:120px;">${escapeHtml(e.targetCountry)}</td>
        <td style="padding:3px 6px;font-size:11px;opacity:0.7;width:100px;">${escapeHtml(e.electionDate)}</td>
        <td style="padding:3px 6px;font-size:11px;">${escapeHtml(interferenceLabel(e.kind))}</td>
        <td style="padding:3px 6px;font-size:11px;opacity:0.8;width:100px;">${escapeHtml(e.actor)}</td>
        <td style="padding:3px 6px;font-size:10px;text-transform:uppercase;color:${ac};width:80px;">${escapeHtml(attributionLabel(e.attribution))}</td>
        <td style="padding:3px 6px;text-align:right;font-size:10px;text-transform:uppercase;color:${sc};width:80px;">${escapeHtml(severityLabel(e.severity))}</td>
      </tr>
      <tr>
        <td colspan="6" style="padding:0 6px 4px 6px;font-size:10px;opacity:0.65;border-bottom:1px solid #222;">${escapeHtml(e.detail)}</td>
      </tr>`;
    }).join('');
    return `${this.sectionHeader('Election Interference Signals', 'Stanford IO / Microsoft TAC / EU EEAS')}
      <div style="font-size:11px;opacity:0.65;margin-bottom:4px;">Patterns observed in open reporting; analytical monitoring only.</div>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>`;
  }

  // ── Section 4: Infrastructure sabotage ───────────────────────────────

  private buildSabotageSection(events: InfrastructureSabotageEvent[], now: number): string {
    const sorted = [...events].sort(
      (a, b) => b.severity - a.severity || b.timestamp - a.timestamp,
    );
    const rows = sorted.map((s: InfrastructureSabotageEvent) => {
      const sc = severityColor(s.severity);
      const ac = attributionColor(s.attribution);
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600;color:${sc};width:160px;">${escapeHtml(s.region)}</td>
        <td style="padding:3px 6px;font-size:11px;">${escapeHtml(s.asset)}</td>
        <td style="padding:3px 6px;font-size:11px;opacity:0.8;width:130px;">${escapeHtml(sabotageLabel(s.kind))}</td>
        <td style="padding:3px 6px;font-size:10px;text-transform:uppercase;color:${ac};width:80px;">${escapeHtml(attributionLabel(s.attribution))}</td>
        <td style="padding:3px 6px;font-size:11px;opacity:0.7;width:80px;">${escapeHtml(formatTimeAgo(s.timestamp, now))}</td>
        <td style="padding:3px 6px;text-align:right;font-size:10px;text-transform:uppercase;color:${sc};width:80px;">${escapeHtml(severityLabel(s.severity))}</td>
      </tr>
      <tr>
        <td colspan="6" style="padding:0 6px 4px 6px;font-size:10px;opacity:0.65;border-bottom:1px solid #222;">${escapeHtml(s.detail)}</td>
      </tr>`;
    }).join('');
    return `${this.sectionHeader('Infrastructure Sabotage Events', 'BSH / NATO MARCOM / news ledger')}
      <div style="font-size:11px;opacity:0.65;margin-bottom:4px;">Publicly reported incidents against critical infrastructure; analytical monitoring only.</div>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>`;
  }

  // ── Section 5: Proxy force mobilization ──────────────────────────────

  private buildProxySection(forces: ProxyForceMobilization[]): string {
    const sorted = [...forces].sort(
      (a, b) => b.severity - a.severity || b.estimatedStrength - a.estimatedStrength,
    );
    const rows = sorted.map((p: ProxyForceMobilization) => {
      const sc = severityColor(p.severity);
      const ac = attributionColor(p.attribution);
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600;color:${sc};width:140px;">${escapeHtml(p.region)}</td>
        <td style="padding:3px 6px;font-size:11px;font-weight:600;">${escapeHtml(p.proxyName)}</td>
        <td style="padding:3px 6px;font-size:11px;opacity:0.8;width:80px;">${escapeHtml(p.patron)}</td>
        <td style="padding:3px 6px;font-size:11px;opacity:0.8;width:140px;">${escapeHtml(proxyLabel(p.kind))}</td>
        <td style="padding:3px 6px;font-size:10px;text-transform:uppercase;color:${ac};width:80px;">${escapeHtml(attributionLabel(p.attribution))}</td>
        <td style="padding:3px 6px;text-align:right;font-size:11px;font-weight:600;width:60px;">${escapeHtml(formatStrength(p.estimatedStrength))}</td>
        <td style="padding:3px 6px;text-align:right;font-size:10px;text-transform:uppercase;color:${sc};width:80px;">${escapeHtml(severityLabel(p.severity))}</td>
      </tr>
      <tr>
        <td colspan="7" style="padding:0 6px 4px 6px;font-size:10px;opacity:0.65;border-bottom:1px solid #222;">${escapeHtml(p.detail)}</td>
      </tr>`;
    }).join('');
    return `${this.sectionHeader('Proxy Force Mobilization', 'ACLED / IISS / open-source orbat')}
      <div style="font-size:11px;opacity:0.65;margin-bottom:4px;">Open-source observation of reported movements / recruitment; estimated strength is an open-source proxy. Analytical monitoring only.</div>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>`;
  }

  // ── Section 6: Per-actor attribution confidence ──────────────────────

  private buildAttributionSection(profiles: ActorAttributionProfile[]): string {
    const sorted = [...profiles].sort((a, b) => b.confidence - a.confidence);
    const rows = sorted.map((a: ActorAttributionProfile) => {
      const tier = actorTier(a);
      const tc = attributionColor(tier);
      const barWidth = Math.min(100, a.confidence);
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600;width:140px;">${escapeHtml(a.actor)}</td>
        <td style="padding:3px 6px;width:120px;">
          <div style="background:#222;border-radius:2px;height:6px;">
            <div style="background:${tc};width:${barWidth}%;height:6px;border-radius:2px;"></div>
          </div>
        </td>
        <td style="padding:3px 6px;text-align:right;font-size:11px;font-weight:600;color:${tc};width:40px;">${a.confidence}</td>
        <td style="padding:3px 6px;font-size:10px;text-transform:uppercase;color:${tc};width:90px;">${escapeHtml(attributionLabel(tier))}</td>
        <td style="padding:3px 6px;text-align:right;font-size:11px;opacity:0.8;width:80px;">${a.observedVectors} vectors</td>
        <td style="padding:3px 6px;text-align:right;font-size:11px;opacity:0.8;width:80px;">${a.recentIndicators} indicators</td>
      </tr>
      <tr>
        <td colspan="6" style="padding:0 6px 4px 6px;font-size:10px;opacity:0.65;border-bottom:1px solid #222;">${escapeHtml(a.notes)}</td>
      </tr>`;
    }).join('');
    return `${this.sectionHeader('Deniable Attribution Confidence', 'Aggregate analytical assessment')}
      <div style="font-size:11px;opacity:0.65;margin-bottom:4px;">0–100 confidence over observed indicator patterns drives the attribution tier shown above. Reported as a probability over open-source indicators, not as accusation. Reserved categories: Non-state and Unknown.</div>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>`;
  }
}
