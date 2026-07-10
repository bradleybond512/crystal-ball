/**
 * TerrorismSuperpowerPanel (panel id: `terrorism-superpower`).
 *
 * Deep-intelligence domain panel for terrorism / extremism threats.
 *
 * Sections:
 *   1. Active Threat Monitor    — ongoing or imminent terrorist incidents.
 *   2. Attack Pattern Tracker   — last-30-day events grouped by method + trend.
 *   3. Group Activity Watch     — designated terrorist organizations + activity.
 *   4. High-Risk Zone Map       — per-region threat level (0-4).
 *   5. Radicalization Signal    — early indicators of mobilization.
 *
 * Pure helpers live in `terrorism-superpower-helpers.ts` so unit tests can
 * import them without dragging in the Panel base class or live services.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { query } from '@/services/intelligence/observation-store';
import {
  activityColor,
  activityLabel,
  attackMethodColor,
  attackMethodLabel,
  confidenceLabel,
  confidenceWidthPct,
  countCriticalGroups,
  countSevereZones,
  countCriticalSignals,
  deriveActiveThreats,
  deriveAttackPatterns,
  severityColor,
  severityLabel,
  signalTypeLabel,
  threatLevelColor,
  threatLevelLabel,
  timeAgo,
  trendArrow,
  trendColor,
  DESIGNATED_GROUPS,
  RADICALIZATION_SIGNALS,
  THREAT_ZONES,
  type ActiveThreat,
  type AttackPatternRow,
  type GroupActivity,
  type RadicalizationSignal,
  type ThreatZone,
} from './terrorism-superpower-helpers';

const REFRESH_MS = 2 * 60 * 1000;

function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

export class TerrorismSuperpowerPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'terrorism-superpower',
      title: 'Terrorism Intelligence',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Deep intelligence view for terrorism / extremism: active threats, attack patterns, designated-group activity, high-risk zones, and radicalization signals.',
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
    const events = safe(() => query({ domain: 'terrorism', limit: 200 })) ?? [];
    const activeThreats = deriveActiveThreats(events);
    const attackPatterns = deriveAttackPatterns(events);

    this.setCount(
      activeThreats.length
      + countCriticalGroups(DESIGNATED_GROUPS)
      + countSevereZones(THREAT_ZONES)
      + countCriticalSignals(RADICALIZATION_SIGNALS),
    );
    this.setContent(this.buildHtml(activeThreats, attackPatterns));
  }

  private buildHtml(threats: ActiveThreat[], patterns: AttackPatternRow[]): string {
    return `<div class="tsp-root">${[
      this.buildActiveThreatsSection(threats),
      this.buildPatternsSection(patterns),
      this.buildGroupsSection(),
      this.buildZonesSection(),
      this.buildSignalsSection(),
    ].join('')}</div>`;
  }

  // ── Section 1: Active Threat Monitor ──────────────────────────────────

  private buildActiveThreatsSection(threats: ActiveThreat[]): string {
    const badge = threats.length > 0
      ? `<span style="margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px">${threats.length} active</span>`
      : '';
    const body = threats.length === 0
      ? `<div style="font-size:11px;color:#9e9e9e;padding:4px 6px">No active incidents in the last 48 h.</div>`
      : `<table style="width:100%;border-collapse:collapse">${threats.map((t) => this.buildThreatRow(t)).join('')}</table>`;
    return `
      <div class="tsp-section">
        <div class="tsp-section-header">Active Threat Monitor${badge}</div>
        ${body}
      </div>`;
  }

  private buildThreatRow(t: ActiveThreat): string {
    const color = severityColor(t.severity);
    const sevLabel = severityLabel(t.severity);
    const methodLabel = attackMethodLabel(t.attackType);
    const ago = timeAgo(t.detectedAt);
    return `<tr>
      <td style="padding:3px 6px;font-size:12px;font-weight:600;color:${color}">${escapeHtml(t.group)}</td>
      <td style="padding:3px 6px;font-size:11px;color:#ccc">${escapeHtml(t.location)}</td>
      <td style="padding:3px 6px;font-size:11px;color:#9e9e9e">${escapeHtml(methodLabel)}</td>
      <td style="padding:3px 6px;font-size:10px;text-transform:uppercase;text-align:right;color:${color}">${escapeHtml(sevLabel)}</td>
      <td style="padding:3px 6px;font-size:10px;color:#9e9e9e;text-align:right">${escapeHtml(ago)}</td>
    </tr>`;
  }

  // ── Section 2: Attack Pattern Tracker ─────────────────────────────────

  private buildPatternsSection(rows: AttackPatternRow[]): string {
    const total = rows.reduce((acc, r) => acc + r.count, 0);
    const body = `<table style="width:100%;border-collapse:collapse">${rows.map((r) => this.buildPatternRow(r)).join('')}</table>`;
    return `
      <div class="tsp-section">
        <div class="tsp-section-header">Attack Pattern Tracker
          <span style="margin-left:6px;font-size:10px;color:#9e9e9e">${total} events in last 30 days</span>
        </div>
        <div style="font-size:11px;color:#9e9e9e;margin-bottom:4px">Method · count · trend vs prior 7 d ▲▼→</div>
        ${body}
      </div>`;
  }

  private buildPatternRow(r: AttackPatternRow): string {
    const color = attackMethodColor(r.method);
    const arrow = trendArrow(r.trend);
    const tColor = trendColor(r.trend);
    return `<tr>
      <td style="padding:3px 6px;font-size:12px;font-weight:600;color:${color}">${escapeHtml(attackMethodLabel(r.method))}</td>
      <td style="padding:3px 6px;font-size:12px;text-align:right;color:#fff">${r.count}</td>
      <td style="padding:3px 6px;font-size:13px;text-align:right;color:${tColor}">${escapeHtml(arrow)}</td>
    </tr>`;
  }

  // ── Section 3: Group Activity Watch ───────────────────────────────────

  private buildGroupsSection(): string {
    const critical = countCriticalGroups(DESIGNATED_GROUPS);
    const badge = critical > 0
      ? `<span style="margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px">${critical} critical/elevated</span>`
      : '';
    const rows = DESIGNATED_GROUPS.map((g) => this.buildGroupRow(g)).join('');
    return `
      <div class="tsp-section">
        <div class="tsp-section-header">Group Activity Watch${badge}</div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>`;
  }

  private buildGroupRow(g: GroupActivity): string {
    const color = activityColor(g.activityLevel);
    const aLabel = activityLabel(g.activityLevel);
    return `<tr>
      <td style="padding:3px 6px;font-size:12px;font-weight:600">${escapeHtml(g.name)}</td>
      <td style="padding:3px 6px;font-size:11px;color:#ccc">${escapeHtml(g.region)}</td>
      <td style="padding:3px 6px;font-size:11px;color:#9e9e9e;text-align:right">${g.recentEventCount} events</td>
      <td style="padding:3px 6px;font-size:10px;text-transform:uppercase;text-align:right;color:${color}">${escapeHtml(aLabel)}</td>
    </tr>`;
  }

  // ── Section 4: High-Risk Zone Map ─────────────────────────────────────

  private buildZonesSection(): string {
    const severe = countSevereZones(THREAT_ZONES);
    const badge = severe > 0
      ? `<span style="margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px">${severe} high/severe</span>`
      : '';
    const rows = THREAT_ZONES.map((z) => this.buildZoneRow(z)).join('');
    return `
      <div class="tsp-section">
        <div class="tsp-section-header">High-Risk Zone Map${badge}</div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>`;
  }

  private buildZoneRow(z: ThreatZone): string {
    const color = threatLevelColor(z.level);
    const label = threatLevelLabel(z.level);
    const widthPct = Math.round((z.level / 4) * 100);
    return `<tr>
      <td style="padding:3px 6px;font-size:12px;font-weight:600">${escapeHtml(z.region)}</td>
      <td style="padding:3px 6px;width:60px">
        <div style="background:#333;border-radius:2px;height:6px">
          <div style="background:${color};width:${widthPct}%;height:6px;border-radius:2px"></div>
        </div>
      </td>
      <td style="padding:3px 6px;font-size:10px;color:${color};text-transform:uppercase;text-align:right">${escapeHtml(label)}</td>
    </tr>
    <tr>
      <td colspan="3" style="padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222">${escapeHtml(z.rationale)}</td>
    </tr>`;
  }

  // ── Section 5: Radicalization Signal ──────────────────────────────────

  private buildSignalsSection(): string {
    const critical = countCriticalSignals(RADICALIZATION_SIGNALS);
    const badge = critical > 0
      ? `<span style="margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px">${critical} high/critical</span>`
      : '';
    const rows = RADICALIZATION_SIGNALS.map((s) => this.buildSignalRow(s)).join('');
    return `
      <div class="tsp-section">
        <div class="tsp-section-header">Radicalization Signal${badge}</div>
        <div style="font-size:11px;color:#9e9e9e;margin-bottom:4px">Early indicators of mobilization (recruitment · propaganda · financing · training)</div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>`;
  }

  private buildSignalRow(s: RadicalizationSignal): string {
    const color = severityColor(s.severity);
    const sevLabel = severityLabel(s.severity);
    const cfLabel = confidenceLabel(s.confidence);
    const cfWidth = confidenceWidthPct(s.confidence);
    return `<tr>
      <td style="padding:3px 6px;font-size:12px;font-weight:600">${escapeHtml(signalTypeLabel(s.signalType))}</td>
      <td style="padding:3px 6px;font-size:11px;color:#ccc">${escapeHtml(s.region)}</td>
      <td style="padding:3px 6px;width:60px">
        <div style="background:#333;border-radius:2px;height:6px">
          <div style="background:${color};width:${cfWidth}%;height:6px;border-radius:2px"></div>
        </div>
      </td>
      <td style="padding:3px 6px;font-size:10px;color:#9e9e9e;text-align:right">${escapeHtml(cfLabel)}</td>
      <td style="padding:3px 6px;font-size:10px;color:${color};text-transform:uppercase;text-align:right">${escapeHtml(sevLabel)}</td>
    </tr>
    <tr>
      <td colspan="5" style="padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222">${escapeHtml(s.note)}</td>
    </tr>`;
  }
}
