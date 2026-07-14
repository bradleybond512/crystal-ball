/* eslint-disable sonarjs/no-nested-conditional */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { renderPanelEmpty, renderPanelError } from './ui/PanelStates';
import { situationEngine } from '@/services/situation-engine';
import { queryEntities, type LegacyEntity } from '@/services/intelligence/entity-registry';
import {
  getTradeRouteRiskScorerService,
  type TradeRoute,
  type RiskLevel,
} from '@/services/intelligence/trade-route-risk-scorer';
import type { Situation } from '@/services/situation-types';
import type { FreightStressComponent, FreightStressResponse } from './MaritimeIntelPanel';

// ── Local safe wrapper ────────────────────────────────────────────────────────

function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

// ── Extended Situation shape (fields that may be present on enriched records) ─
// Defined as a plain object (not extending Situation) so the looser `domain`
// string type doesn't conflict with the SituationDomain union.

interface SituationLike {
  title: string;
  /** Optional freeform name; falls back to title. */
  name?: string;
  /** Domain may carry 'maritime' on enriched records. */
  domain: string;
  /** Optional tags for domain-specific filtering. */
  tags?: string[];
  /** Optional severity label. */
  severity?: string;
  geo?: { label?: string };
}

// ── Chokepoint catalogue ──────────────────────────────────────────────────────

const CHOKEPOINTS: { name: string; keywords: string[] }[] = [
  { name: 'Suez Canal',        keywords: ['suez'] },
  { name: 'Strait of Hormuz',  keywords: ['hormuz'] },
  { name: 'Strait of Malacca', keywords: ['malacca'] },
  { name: 'Bab-el-Mandeb',     keywords: ['bab', 'mandeb', 'mandab'] },
  { name: 'Panama Canal',      keywords: ['panama'] },
];

type ChokepointName = 'Suez Canal' | 'Strait of Hormuz' | 'Strait of Malacca' | 'Bab-el-Mandeb' | 'Panama Canal';

const FREIGHT_REFRESH_MS = 60_000;

const STRESS_COLOR: Record<FreightStressComponent['stressLevel'], string> = {
  low: '#4caf50',
  medium: '#ffeb3b',
  high: '#ff9800',
  critical: '#ff453a',
};

// ── Exported pure helpers (tested without DOM) ────────────────────────────────

/**
 * Unified chokepoint status vocabulary: the trade-route scorer's 4-level
 * scale (minimal / elevated / high / critical) collapses to one 3-level
 * user-facing scale. The source term stays available for tooltips.
 */
export function displayRiskLabel(level: string): 'calm' | 'elevated' | 'severe' {
  switch (level) {
    case 'minimal': { return 'calm';
    }
    case 'elevated': { return 'elevated';
    }
    case 'high':
    case 'critical': { return 'severe';
    }
    default: { return 'calm';
    }
  }
}

export function waitTimeForRisk(level: string): string {
  switch (level) {
    case 'minimal': { return '< 4h';
    }
    case 'elevated': { return '8–24h';
    }
    case 'high': { return '24–48h';
    }
    case 'critical': { return '48h+';
    }
    default: { return 'N/A';
    }
  }
}

export function classifyVesselAnomalies(vessels: LegacyEntity[]): { name: string; flags: string[] }[] {
  const result: { name: string; flags: string[] }[] = [];
  for (const v of vessels) {
    const flags: string[] = [];
    if (v.meta.aisGap === true) flags.push('AIS gap');
    if (v.meta.spoofing === true) flags.push('spoofing');
    if (v.meta.sanctionedWaters === true) flags.push('sanctioned waters');
    if (flags.length > 0) result.push({ name: v.name, flags });
  }
  return result;
}

export function buildChokepointRows(routes: TradeRoute[]): { name: ChokepointName; risk: RiskLevel; waitTime: string }[] {
  return CHOKEPOINTS.map(({ name: cpName, keywords }) => {
    const match = routes.find((r) =>
      keywords.some((kw) => r.name.toLowerCase().includes(kw))
    );
    if (!match) return { name: cpName as ChokepointName, risk: 'minimal' as RiskLevel, waitTime: 'N/A' };
    return { name: cpName as ChokepointName, risk: match.riskLevel, waitTime: waitTimeForRisk(match.riskLevel) };
  });
}

export function derivePiracyIncidents(situations: Situation[]): { name: string; location?: string }[] {
  return (situations as SituationLike[])
    .filter((s) =>
      s.domain === 'maritime' &&
      (s.tags?.some((t) => t.includes('piracy')) === true || (s.name ?? s.title).toLowerCase().includes('pira'))
    )
    .map((s) => ({ name: s.name ?? s.title, location: s.geo?.label }));
}

export function deriveSanctionsVessels(vessels: LegacyEntity[]): { name: string; reasons: string[] }[] {
  const result: { name: string; reasons: string[] }[] = [];
  for (const v of vessels) {
    const reasons: string[] = [];
    if (v.meta.ofacMatch === true) reasons.push('OFAC SDN match');
    if (v.meta.flagOfConvenience === true) reasons.push('flag of convenience');
    if (reasons.length > 0) result.push({ name: v.name, reasons });
  }
  return result;
}

export function derivePortDisruptions(situations: Situation[]): { name: string; severity: string }[] {
  return (situations as SituationLike[])
    .filter((s) =>
      s.domain === 'maritime' &&
      (s.tags?.some((t) => t.includes('port') || t.includes('congestion')) === true ||
        (s.name ?? s.title).toLowerCase().includes('port'))
    )
    .map((s) => ({ name: s.name ?? s.title, severity: s.severity ?? 'unknown' }));
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export class MaritimeSuperpowerPanel extends Panel {
  private freightStress: FreightStressResponse | null = null;
  /** Technical failure detail for the last freight fetch (tooltip/console only). */
  private freightError: string | null = null;
  private freightTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'maritime-superpower', title: 'Maritime Intelligence' });
    this.refresh();
    this.startFreight();
  }

  private startFreight(): void {
    // Retry button in the freight error state (see renderFreightSection).
    this.content.addEventListener('maritime-superpower:freight-retry', () => void this.refreshFreight());
    void this.refreshFreight();
    this.freightTimer = setInterval(() => void this.refreshFreight(), FREIGHT_REFRESH_MS);
  }

  public destroy(): void {
    super.destroy();
    if (this.freightTimer !== null) {
      clearInterval(this.freightTimer);
      this.freightTimer = null;
    }
  }

  /** Freight cost stress ported from the retired-by-default Maritime Intel panel. */
  private async refreshFreight(): Promise<void> {
    try {
      const resp = await fetch('/api/freight-stress', { headers: { Accept: 'application/json' } });
      if (resp.ok) {
        this.freightStress = (await resp.json()) as FreightStressResponse;
        this.freightError = null;
      } else {
        // Status codes stay in the tooltip detail, never in visible copy.
        this.freightError = `HTTP ${resp.status}`;
      }
    } catch {
      this.freightStress = null;
      this.freightError = 'network unreachable';
    }
    this.refresh();
  }

  refresh(): void {
    const vessels = safe(() => queryEntities({ kind: 'ship' })) ?? [];
    const scorer = safe(() => getTradeRouteRiskScorerService());
    const maritimeRoutes = safe(() => scorer?.getAllRoutes({ type: 'maritime' })) ?? [];
    const situations = safe(() => situationEngine.getSituations()) ?? [];

    const anomalies = classifyVesselAnomalies(vessels);
    const chokepoints = buildChokepointRows(maritimeRoutes);
    const piracy = derivePiracyIncidents(situations);
    const sanctioned = deriveSanctionsVessels(vessels);
    const portDisruptions = derivePortDisruptions(situations);

    this.setContent(this.buildHtml(anomalies, chokepoints, piracy, sanctioned, portDisruptions));
    this.markFresh();
  }

  private buildHtml(
    anomalies: ReturnType<typeof classifyVesselAnomalies>,
    chokepoints: ReturnType<typeof buildChokepointRows>,
    piracy: ReturnType<typeof derivePiracyIncidents>,
    sanctioned: ReturnType<typeof deriveSanctionsVessels>,
    portDisruptions: ReturnType<typeof derivePortDisruptions>,
  ): string {
    return `<div class="maritime-superpower">
  <section class="ms-section">
    <h3 class="ms-section-title">Vessel Anomaly Tracker</h3>
    ${anomalies.length === 0
      ? '<p class="ms-empty">No active incidents</p>'
      : anomalies.map((v) => `<div class="ms-vessel">
      <span class="ms-vessel-name">${escapeHtml(v.name)}</span>
      <span class="ms-anomaly-flags">${escapeHtml(v.flags.join(', '))}</span>
    </div>`).join('\n    ')}
  </section>
  <section class="ms-section">
    <h3 class="ms-section-title">Chokepoint Status</h3>
    ${chokepoints.map((cp) => `<div class="ms-chokepoint" data-risk="${escapeHtml(cp.risk)}">
      <span class="ms-chokepoint-name">${escapeHtml(cp.name)}</span>
      <span class="ms-risk-badge ms-risk-${escapeHtml(cp.risk)}" title="Trade-route scorer level: ${escapeHtml(cp.risk)}">${escapeHtml(displayRiskLabel(cp.risk))}</span>
      <span class="ms-wait-time">${escapeHtml(cp.waitTime)}</span>
    </div>`).join('\n    ')}
  </section>
  ${this.renderFreightSection()}
  <section class="ms-section">
    <h3 class="ms-section-title">Piracy &amp; Incident Map</h3>
    ${piracy.length === 0
      ? '<p class="ms-empty">No active incidents</p>'
      : piracy.map((p) => `<div class="ms-piracy-incident">
      <span class="ms-incident-name">${escapeHtml(p.name)}</span>
      ${p.location == null ? '' : `<span class="ms-incident-location">${escapeHtml(p.location)}</span>`}
    </div>`).join('\n    ')}
  </section>
  <section class="ms-section">
    <h3 class="ms-section-title">Sanctions Evasion Watch</h3>
    ${sanctioned.length === 0
      ? '<p class="ms-empty">No active incidents</p>'
      : sanctioned.map((v) => `<div class="ms-sanctions-vessel">
      <span class="ms-vessel-name">${escapeHtml(v.name)}</span>
      <span class="ms-sanctions-reason">${escapeHtml(v.reasons.join(', '))}</span>
    </div>`).join('\n    ')}
  </section>
  <section class="ms-section">
    <h3 class="ms-section-title">Port Disruption Index</h3>
    ${portDisruptions.length === 0
      ? '<p class="ms-empty">No active incidents</p>'
      : portDisruptions.map((s) => `<div class="ms-port-disruption">
      <span class="ms-port-name">${escapeHtml(s.name)}</span>
      <span class="ms-severity-badge">${escapeHtml(s.severity)}</span>
    </div>`).join('\n    ')}
  </section>
</div>`;
  }

  private renderFreightSection(): string {
    return `<section class="ms-section">
    <h3 class="ms-section-title">Freight Cost Stress</h3>
    ${this.renderFreightBody()}
  </section>`;
  }

  private renderFreightBody(): string {
    if (this.freightError !== null) {
      return renderPanelError({
        title: 'Freight data temporarily unavailable',
        detail: `${this.freightError} from the freight-stress endpoint`,
        onRetryEventName: 'maritime-superpower:freight-retry',
      });
    }
    const fs = this.freightStress;
    if (!fs?.components || fs.components.length === 0) {
      return renderPanelEmpty({
        message: 'No freight-stress data yet',
        hint: 'The freight monitor may still be warming up',
      });
    }
    const overallLevel = fs.overallLevel ?? 'low';
    const overallColor = STRESS_COLOR[overallLevel];
    const overallScore = fs.overallScore ?? 0;
    const rows = fs.components.map((c) => this.renderFreightRow(c)).join('');
    return `<div style="display:flex;justify-content:flex-end;margin-bottom:4px;">
      <span style="font-size:11px;font-weight:700;color:${overallColor};text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(overallLevel)} · ${overallScore}</span>
    </div>
    <div>${rows}</div>`;
  }

  private renderFreightRow(c: FreightStressComponent): string {
    const trendArrow = c.trend === 'rising' ? '↑' : (c.trend === 'falling' ? '↓' : '→');
    const dev = c.deviationPct == null ? '—' : `${c.deviationPct >= 0 ? '+' : ''}${c.deviationPct.toFixed(1)}%`;
    const cur = c.current == null ? '—' : c.current.toFixed(1);
    const lvlColor = STRESS_COLOR[c.stressLevel];
    return `<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;padding:4px 0;border-bottom:1px solid var(--border-subtle,#222);gap:8px;">
      <div>
        <span style="font-family:ui-monospace,monospace;font-weight:600;">${escapeHtml(c.series)}</span>
        <span style="margin-left:8px;color:var(--text-secondary,#aaa);">${trendArrow} ${escapeHtml(cur)}</span>
        <span style="margin-left:8px;color:var(--text-secondary,#aaa);">Δ ${escapeHtml(dev)}</span>
      </div>
      <span style="font-weight:600;color:${lvlColor};text-transform:uppercase;letter-spacing:0.05em;font-size:10px;">${escapeHtml(c.stressLevel)} · ${c.stressScore}</span>
    </div>`;
  }
}
