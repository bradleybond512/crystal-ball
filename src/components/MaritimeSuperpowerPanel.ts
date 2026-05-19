/* eslint-disable sonarjs/no-nested-template-literals, sonarjs/no-nested-conditional */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { situationEngine } from '@/services/situation-engine';
import { queryEntities, type LegacyEntity } from '@/services/intelligence/entity-registry';
import {
  getTradeRouteRiskScorerService,
  type TradeRoute,
  type RiskLevel,
} from '@/services/intelligence/trade-route-risk-scorer';
import type { Situation } from '@/services/situation-types';

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

// ── Exported pure helpers (tested without DOM) ────────────────────────────────

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
  constructor() {
    super({ id: 'maritime-superpower', title: 'Maritime Intelligence' });
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
      <span class="ms-risk-badge ms-risk-${escapeHtml(cp.risk)}">${escapeHtml(cp.risk)}</span>
      <span class="ms-wait-time">${escapeHtml(cp.waitTime)}</span>
    </div>`).join('\n    ')}
  </section>
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

}
