/**
 * OrganizedCrimeSuperpowerPanel (panel id: `organized-crime-superpower`).
 *
 * Deep-intelligence domain panel for organized crime threats.
 *
 * Sections:
 *   1. Cartel & Syndicate Activity  — critical/elevated group watch.
 *   2. Drug Trafficking Routes       — origin → transit → destination with seizure trend.
 *   3. Human Trafficking Watch       — regional victim estimates + enforcement response.
 *   4. Money Laundering Signals      — jurisdiction / method / estimated volume.
 *   5. Crime-Conflict Nexus          — where crime funds armed conflict.
 *
 * Pure helpers live in `organized-crime-superpower-helpers.ts` so unit tests
 * can import them without dragging in the Panel base class or live services.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { query } from '@/services/intelligence/observation-store';
import {
  activityColor,
  activityLabel,
  enterpriseLabel,
  seizureTrendArrow,
  seizureTrendColor,
  interdictionLabel,
  traffickingTypeLabel,
  networkSizeLabel,
  enforcementResponseLabel,
  launderingMethodLabel,
  enforcementActionLabel,
  enforcementActionColor,
  formatVolumeBn,
  stabilityColor,
  stabilityLabel,
  countCritical,
  countCrisisRoutes,
  CARTELS,
  ROUTES,
  HUMAN_TRAFFICKING,
  LAUNDERING,
  NEXUS,
  type CartelSyndicate,
  type TraffickingRoute,
  type HumanTraffickingWatch,
  type MoneyLaunderingSignal,
  type CrimeConflictNexus,
} from './organized-crime-superpower-helpers';

const REFRESH_MS = 3 * 60 * 1000;

function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

export class OrganizedCrimeSuperpowerPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'organized-crime-superpower',
      title: 'Organized Crime Intelligence',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Deep intelligence view for organized crime: cartel activity, drug trafficking routes, human trafficking watch, money laundering signals, and crime-conflict nexus.',
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
    const liveEvents = safe(() => query({ domain: 'crime', limit: 50 })) ?? [];
    const liveHighCount = liveEvents.filter(
      (e) => e.severity === 'HIGH' || e.severity === 'CRITICAL',
    ).length;

    this.setCount(countCritical(CARTELS) + countCrisisRoutes(ROUTES) + liveHighCount);
    this.setContent(this.buildHtml());
  }

  private buildHtml(): string {
    return `<div class="ocsp-root">${[
      this.buildCartelSection(),
      this.buildRoutesSection(),
      this.buildHumanTraffickingSection(),
      this.buildLaunderingSection(),
      this.buildNexusSection(),
    ].join('')}</div>`;
  }

  // ── Section 1: Cartel & Syndicate Activity ────────────────────────────

  private buildCartelSection(): string {
    const critical = countCritical(CARTELS);
    const badgeHtml = critical > 0
      ? `<span style="margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px">${critical} critical/elevated</span>`
      : '';

    const rows = CARTELS.map((c: CartelSyndicate) => {
      const color       = activityColor(c.activityLevel);
      const actLabel    = activityLabel(c.activityLevel);
      const entLabel    = enterpriseLabel(c.primaryEnterprise);
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600;color:${color}">${escapeHtml(c.name)}</td>
        <td style="padding:3px 6px;font-size:11px;color:#ccc">${escapeHtml(c.region)}</td>
        <td style="padding:3px 6px;font-size:11px;color:#9e9e9e">${escapeHtml(entLabel)}</td>
        <td style="padding:3px 6px;text-align:right;font-size:10px;text-transform:uppercase;color:${color}">${escapeHtml(actLabel)}</td>
      </tr>
      <tr>
        <td colspan="4" style="padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222">${escapeHtml(c.territoryStatus)}</td>
      </tr>`;
    }).join('');

    return `
      <div class="ocsp-section">
        <div class="ocsp-section-header">Cartel &amp; Syndicate Activity${badgeHtml}</div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>`;
  }

  // ── Section 2: Drug Trafficking Routes ───────────────────────────────

  private buildRoutesSection(): string {
    const crisis = countCrisisRoutes(ROUTES);
    const badgeHtml = crisis > 0
      ? `<span style="margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px">${crisis} high-risk</span>`
      : '';

    const rows = ROUTES.map((r: TraffickingRoute) => {
      const arrow      = seizureTrendArrow(r.seizureTrend);
      const trendColor = seizureTrendColor(r.seizureTrend);
      const interdLabel = interdictionLabel(r.interdictionPressure);
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600">${escapeHtml(r.commodity)}</td>
        <td style="padding:3px 6px;font-size:11px;color:#ccc">${escapeHtml(r.origin)} → ${escapeHtml(r.destination)}</td>
        <td style="padding:3px 6px;font-size:11px;color:${trendColor};text-align:center">${escapeHtml(arrow)}</td>
        <td style="padding:3px 6px;font-size:11px;color:#9e9e9e;text-align:right">${escapeHtml(r.estimatedVolume)}</td>
      </tr>
      <tr>
        <td colspan="4" style="padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222">via ${escapeHtml(r.transit)} · ${escapeHtml(interdLabel)}</td>
      </tr>`;
    }).join('');

    return `
      <div class="ocsp-section">
        <div class="ocsp-section-header">Drug Trafficking Routes${badgeHtml}</div>
        <div style="font-size:11px;color:#9e9e9e;margin-bottom:4px">Commodity · origin → destination · seizure trend ▲▼→</div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>`;
  }

  // ── Section 3: Human Trafficking Watch ───────────────────────────────

  private buildHumanTraffickingSection(): string {
    const rows = HUMAN_TRAFFICKING.map((h: HumanTraffickingWatch) => {
      const typeLabel   = traffickingTypeLabel(h.type);
      const netLabel    = networkSizeLabel(h.networkSize);
      const enfLabel    = enforcementResponseLabel(h.enforcementResponse);
      const victims     = h.estimatedVictims >= 1_000_000
        ? `${(h.estimatedVictims / 1_000_000).toFixed(1)}M`
        : `${(h.estimatedVictims / 1000).toFixed(0)}K`;
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600">${escapeHtml(h.region)}</td>
        <td style="padding:3px 6px;font-size:11px;color:#ccc">${escapeHtml(typeLabel)}</td>
        <td style="padding:3px 6px;font-size:11px;color:#9e9e9e">${escapeHtml(netLabel)}</td>
        <td style="padding:3px 6px;font-size:11px;color:#facc15;text-align:right">${escapeHtml(victims)}</td>
        <td style="padding:3px 6px;font-size:10px;color:#9e9e9e;text-align:right">${escapeHtml(enfLabel)}</td>
      </tr>`;
    }).join('');

    return `
      <div class="ocsp-section">
        <div class="ocsp-section-header">Human Trafficking Watch</div>
        <div style="font-size:11px;color:#9e9e9e;margin-bottom:4px">Region · type · network size · estimated victims · enforcement</div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>`;
  }

  // ── Section 4: Money Laundering Signals ──────────────────────────────

  private buildLaunderingSection(): string {
    const rows = LAUNDERING.map((m: MoneyLaunderingSignal) => {
      const methLabel  = launderingMethodLabel(m.method);
      const actLabel   = enforcementActionLabel(m.enforcementAction);
      const actColor   = enforcementActionColor(m.enforcementAction);
      const vol        = formatVolumeBn(m.estimatedVolumeBn);
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600">${escapeHtml(m.jurisdiction)}</td>
        <td style="padding:3px 6px;font-size:11px;color:#ccc">${escapeHtml(methLabel)}</td>
        <td style="padding:3px 6px;font-size:12px;color:#facc15;font-weight:bold">${escapeHtml(vol)}</td>
        <td style="padding:3px 6px;font-size:10px;text-transform:uppercase;color:${actColor};text-align:right">${escapeHtml(actLabel)}</td>
      </tr>`;
    }).join('');

    return `
      <div class="ocsp-section">
        <div class="ocsp-section-header">Money Laundering Signals</div>
        <div style="font-size:11px;color:#9e9e9e;margin-bottom:4px">Jurisdiction · method · estimated volume · enforcement action</div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>`;
  }

  // ── Section 5: Crime-Conflict Nexus ──────────────────────────────────

  private buildNexusSection(): string {
    const rows = NEXUS.map((n: CrimeConflictNexus) => {
      const color   = stabilityColor(n.stabilityImpact);
      const impLabel = stabilityLabel(n.stabilityImpact);
      const barWidth = Math.round((n.stabilityImpact / 4) * 100);
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600">${escapeHtml(n.region)}</td>
        <td style="padding:3px 6px;font-size:11px;color:#ccc">${escapeHtml(n.primaryGroup)}</td>
        <td style="padding:3px 6px;width:60px">
          <div style="background:#333;border-radius:2px;height:6px">
            <div style="background:${color};width:${barWidth}%;height:6px;border-radius:2px"></div>
          </div>
        </td>
        <td style="padding:3px 6px;font-size:10px;color:${color};text-transform:uppercase;text-align:right">${escapeHtml(impLabel)}</td>
      </tr>
      <tr>
        <td colspan="4" style="padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222">${escapeHtml(n.conflictLinkage)}</td>
      </tr>`;
    }).join('');

    return `
      <div class="ocsp-section">
        <div class="ocsp-section-header">Crime-Conflict Nexus</div>
        <div style="font-size:11px;color:#9e9e9e;margin-bottom:4px">Where organized crime revenue sustains armed conflict</div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>`;
  }
}
