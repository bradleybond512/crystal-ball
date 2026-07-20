/**
 * Political Risk domain superpower panel — deepest intelligence view for
 * geopolitical instability and governance threats.
 *
 * Five sections:
 *   1. Coup & Regime Change Watch — active coup/uprising/power-vacuum events.
 *   2. Election Risk Tracker — upcoming elections with composite risk scores.
 *   3. Protest & Civil Unrest — major protest movements and government responses.
 *   4. Sanctions & Diplomatic Crisis — bilateral and multilateral crises.
 *   5. Governance Stability Index — regional stability scores.
 *
 * All live-service calls are wrapped in safe(() => fn()) ?? fallback so the
 * panel renders from static data even before any data has loaded.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { query } from '@/services/intelligence/observation-store';
import {
  politicalSeverityColor,
  eventTypeLabel,
  riskScoreColor,
  riskScoreTier,
  responseLabel,
  responseColor,
  crisisTypeLabel,
  governanceColor,
  governanceTier,
  formatTimeAgo,
  instabilityCount,
  COUP_WATCH,
  ELECTION_RISKS,
  PROTEST_EVENTS,
  DIPLOMATIC_CRISES,
  GOVERNANCE_INDEX,
  type CoupWatchEvent,
  type ElectionRisk,
  type ProtestEvent,
  type DiplomaticCrisis,
  type GovernanceRegion,
} from './political-risk-superpower-helpers';

const REFRESH_MS = 3 * 60 * 1000;

function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

export class PoliticalRiskSuperpowerPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'political-risk-superpower',
      title: 'Political Risk Intelligence',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Deep intelligence view for political domain threats: coup watch, election risk, civil unrest, diplomatic crises, and governance stability.',
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
    const liveEvents = safe(() => query({ domain: 'political', limit: 50 })) ?? [];

    const criticalDiplomatic = DIPLOMATIC_CRISES.filter(
      (d) => d.severity === 'high' || d.severity === 'critical',
    ).length;
    const liveHighCount = liveEvents.filter(
      (e) => e.severity === 'HIGH' || e.severity === 'CRITICAL',
    ).length;

    this.setCount(instabilityCount(COUP_WATCH) + criticalDiplomatic + liveHighCount);
    this.setContent(this.buildHtml());
  }

  private buildHtml(): string {
    return `<div class="prsp-root">${[
      this.buildCoupSection(),
      this.buildElectionSection(),
      this.buildProtestSection(),
      this.buildDiplomaticSection(),
      this.buildGovernanceSection(),
    ].join('')}</div>`;
  }

  // ── Section 1: Coup & Regime Change Watch ────────────────────────────

  private buildCoupSection(): string {
    const rows = COUP_WATCH.map((evt: CoupWatchEvent) => {
      const sevColor = politicalSeverityColor(evt.severity);
      const timeAgo  = formatTimeAgo(evt.timestamp);
      const typeText = eventTypeLabel(evt.eventType);
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600;color:${sevColor}">${escapeHtml(evt.country)}</td>
        <td style="padding:3px 6px;font-size:11px;color:#ccc">${escapeHtml(typeText)}</td>
        <td style="padding:3px 6px;font-size:11px;color:#9e9e9e">${escapeHtml(timeAgo)}</td>
        <td style="padding:3px 6px;text-align:right;font-size:10px;text-transform:uppercase;color:${sevColor}">${evt.severity}</td>
      </tr>
      <tr>
        <td colspan="4" style="padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222">${escapeHtml(evt.detail)}</td>
      </tr>`;
    }).join('');

    const badgeCount = instabilityCount(COUP_WATCH);
    const badgeHtml  = badgeCount > 0
      ? `<span style="margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px">${badgeCount} critical/high</span>`
      : '';

    return `
      <div class="prsp-section">
        <div class="prsp-section-header">Coup &amp; Regime Change Watch${badgeHtml}</div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>`;
  }

  // ── Section 2: Election Risk Tracker ─────────────────────────────────

  private buildElectionSection(): string {
    const rows = ELECTION_RISKS.map((el: ElectionRisk) => {
      const scoreColor = riskScoreColor(el.riskScore);
      const tier       = riskScoreTier(el.riskScore);
      const factors    = el.riskFactors.slice(0, 3).map((f) => escapeHtml(f)).join(' · ');
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600">${escapeHtml(el.country)}</td>
        <td style="padding:3px 6px;font-size:11px;color:#9e9e9e">${escapeHtml(el.electionType)}</td>
        <td style="padding:3px 6px;font-size:11px;color:#ccc">${escapeHtml(el.date)}</td>
        <td style="padding:3px 6px;text-align:right;font-size:12px;font-weight:bold;color:${scoreColor}">${el.riskScore}</td>
        <td style="padding:3px 6px;font-size:10px;text-transform:uppercase;color:${scoreColor}">${tier}</td>
      </tr>
      <tr>
        <td colspan="5" style="padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222">${factors}</td>
      </tr>`;
    }).join('');

    return `
      <div class="prsp-section">
        <div class="prsp-section-header">Election Risk Tracker</div>
        <div style="font-size:11px;color:#9e9e9e;margin-bottom:4px">Composite risk score 0–100 · sorted by risk</div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>`;
  }

  // ── Section 3: Protest & Civil Unrest ────────────────────────────────

  private buildProtestSection(): string {
    const rows = PROTEST_EVENTS.map((evt: ProtestEvent) => {
      const sevColor  = politicalSeverityColor(evt.severity);
      const respLabel = responseLabel(evt.governmentResponse);
      const respColor = responseColor(evt.governmentResponse);
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600;color:${sevColor}">${escapeHtml(evt.country)}</td>
        <td style="padding:3px 6px;font-size:11px;color:#ccc">${escapeHtml(evt.movement)}</td>
        <td style="padding:3px 6px;font-size:11px;color:#9e9e9e">${escapeHtml(evt.participantsEstimate)}</td>
        <td style="padding:3px 6px;text-align:right;font-size:11px;color:${respColor}">${escapeHtml(respLabel)}</td>
      </tr>`;
    }).join('');

    return `
      <div class="prsp-section">
        <div class="prsp-section-header">Protest &amp; Civil Unrest</div>
        <div style="font-size:11px;color:#9e9e9e;margin-bottom:4px">Active movements · estimated turnout · government response</div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>`;
  }

  // ── Section 4: Sanctions & Diplomatic Crisis ──────────────────────────

  private buildDiplomaticSection(): string {
    const rows = DIPLOMATIC_CRISES.map((crisis: DiplomaticCrisis) => {
      const sevColor   = politicalSeverityColor(crisis.severity);
      const typeText   = crisisTypeLabel(crisis.crisisType);
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600">${escapeHtml(crisis.parties)}</td>
        <td style="padding:3px 6px;font-size:11px;color:#ccc">${escapeHtml(typeText)}</td>
        <td style="padding:3px 6px;text-align:right;font-size:10px;text-transform:uppercase;color:${sevColor}">${crisis.severity}</td>
      </tr>
      <tr>
        <td colspan="3" style="padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222">${escapeHtml(crisis.trigger)}</td>
      </tr>`;
    }).join('');

    return `
      <div class="prsp-section">
        <div class="prsp-section-header">Sanctions &amp; Diplomatic Crisis</div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>`;
  }

  // ── Section 5: Governance Stability Index ────────────────────────────

  private buildGovernanceSection(): string {
    const rows = GOVERNANCE_INDEX.map((r: GovernanceRegion) => {
      const color = governanceColor(r.score);
      const tier  = governanceTier(r.score);
      const barWidth = Math.round((r.score / 4) * 100);
      return `<tr>
        <td style="padding:3px 6px;font-size:12px">${escapeHtml(r.region)}</td>
        <td style="padding:3px 6px;width:80px">
          <div style="background:#333;border-radius:2px;height:6px">
            <div style="background:${color};width:${barWidth}%;height:6px;border-radius:2px"></div>
          </div>
        </td>
        <td style="padding:3px 6px;font-size:11px;color:${color};text-transform:uppercase">${escapeHtml(tier)}</td>
      </tr>`;
    }).join('');

    return `
      <div class="prsp-section">
        <div class="prsp-section-header">Governance Stability Index</div>
        <div style="font-size:11px;color:#9e9e9e;margin-bottom:4px">Regional instability score · 0 stable → 4 critical</div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>`;
  }
}
