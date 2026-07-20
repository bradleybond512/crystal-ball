/**
 * SpaceSecurityPanel (panel id: `space-security`).
 *
 * Commercial space, satellite security, and orbital threat intelligence.
 *
 * Sections:
 *   1. ASAT & Orbital Threats       — ASAT tests, co-orbital threats, jamming, cyber.
 *   2. Satellite Constellation Status — Starlink/GPS/Galileo/GLONASS/BeiDou/ISS health.
 *   3. Space Weather Impact          — Kp index, X-ray flares, proton flux.
 *   4. Launch Activity Monitor       — recent launches with security implications.
 *   5. Orbital Domain Risk Index     — per-regime 0–4 risk bar chart.
 *
 * Pure helpers live in `space-security-helpers.ts`.
 */

import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import { query } from '@/services/intelligence/observation-store';
import {
  asatEventTypeLabel,
  asatEventTypeColor,
  threatLevelColor,
  threatLevelLabel,
  constellationHealthColor,
  constellationHealthLabel,
  flareClassColor,
  kpIndexColor,
  payloadTypeColor,
  payloadTypeLabel,
  orbitalRiskColor,
  orbitalRiskLabel,
  countHighThreats,
  countDegradedConstellations,
  countMilitaryLaunches,
  ASAT_THREATS,
  CONSTELLATION_STATUS,
  SPACE_WEATHER,
  LAUNCH_ACTIVITY,
  ORBITAL_RISK_INDEX,
} from './space-security-helpers';

const REFRESH_MS = 10 * 60 * 1000;

function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

function cell(text: string, style?: string): HTMLElement {
  return h('td', { style: `padding:3px 6px;font-size:12px${style ? ';' + style : ''}` }, text);
}

function sectionHeader(title: string, badge?: HTMLElement): HTMLElement {
  const header = h('div', { className: 'ssp-section-header' }, title);
  if (badge) header.append(badge);
  return header;
}

function countBadge(count: number, label: string): HTMLElement {
  return h('span', {
    style: 'margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px',
  }, `${count} ${label}`);
}

export class SpaceSecurityPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'space-security',
      title: 'Space Security',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Deep intelligence view for space security: ASAT threats, constellation status, space weather, launch activity, and orbital domain risk index.',
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
    const liveEvents = safe(() => query({ domain: 'space', limit: 50 })) ?? [];
    const liveHighCount = liveEvents.filter(
      (e) => e.severity === 'HIGH' || e.severity === 'CRITICAL',
    ).length;

    this.setCount(
      countHighThreats(ASAT_THREATS) +
      countDegradedConstellations(CONSTELLATION_STATUS) +
      countMilitaryLaunches(LAUNCH_ACTIVITY) +
      liveHighCount,
    );

    replaceChildren(
      this.getContentElement(),
      h('div', { className: 'ssp-root' },
        this.buildAsatSection(),
        this.buildConstellationSection(),
        this.buildSpaceWeatherSection(),
        this.buildLaunchSection(),
        this.buildOrbitalRiskSection(),
      ),
    );
  }

  // ── Section 1: ASAT & Orbital Threats ────────────────────────────────

  private buildAsatSection(): HTMLElement {
    const highCount = countHighThreats(ASAT_THREATS);
    const badge = highCount > 0 ? countBadge(highCount, 'high/critical') : undefined;
    const tbody = h('tbody');

    for (const t of ASAT_THREATS) {
      const tColor  = threatLevelColor(t.threatLevel);
      const tLabel  = threatLevelLabel(t.threatLevel);
      const eColor  = asatEventTypeColor(t.eventType);
      const eLabel  = asatEventTypeLabel(t.eventType);
      const alt     = t.altitudeKm > 0 ? `${t.altitudeKm.toLocaleString()} km` : '—';
      const debris  = t.debrisCount > 0 ? `${t.debrisCount.toLocaleString()} pcs` : '—';

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${tColor}` }, t.actor),
          h('td', { style: `padding:3px 6px;font-size:11px;color:${eColor}` }, eLabel),
          cell(alt, 'color:#facc15;text-align:right'),
          cell(debris, 'color:#fb923c;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${tColor};text-align:right` }, tLabel),
        ),
        h('tr',
          h('td', {
            colspan: '5',
            style: 'padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222',
          }, t.description),
        ),
      );
    }

    return h('div', { className: 'ssp-section' },
      sectionHeader('ASAT & Orbital Threats', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Actor · event type · altitude · debris · threat level',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 2: Satellite Constellation Status ─────────────────────────

  private buildConstellationSection(): HTMLElement {
    const degraded = countDegradedConstellations(CONSTELLATION_STATUS);
    const badge = degraded > 0 ? countBadge(degraded, 'degraded/impaired') : undefined;
    const tbody = h('tbody');

    for (const c of CONSTELLATION_STATUS) {
      const hColor = constellationHealthColor(c.health);
      const hLabel = constellationHealthLabel(c.health);
      const dText  = c.degradedCount > 0 ? `${c.degradedCount} degraded` : 'None degraded';

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${hColor}` }, c.name),
          cell(c.operator, 'color:#ccc'),
          cell(`${c.activeSats.toLocaleString()} active`, 'color:#facc15;text-align:right'),
          cell(dText, `color:${c.degradedCount > 0 ? '#fb923c' : '#9e9e9e'};text-align:right`),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${hColor};text-align:right` }, hLabel),
        ),
        h('tr',
          h('td', {
            colspan: '5',
            style: 'padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222',
          }, c.anomaly),
        ),
      );
    }

    return h('div', { className: 'ssp-section' },
      sectionHeader('Satellite Constellation Status', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Constellation · operator · active sats · degraded · health status',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 3: Space Weather Impact ──────────────────────────────────

  private buildSpaceWeatherSection(): HTMLElement {
    const tbody = h('tbody');

    for (const w of SPACE_WEATHER) {
      const valColor = w.flareClass
        ? flareClassColor(w.flareClass)
        : (() => {
            const kpNum = Number.parseFloat(w.currentValue);
            return Number.isNaN(kpNum) ? '#facc15' : kpIndexColor(kpNum);
          })();

      tbody.append(
        h('tr',
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' }, w.parameter),
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${valColor}` }, w.currentValue),
          cell(w.affectedSystems, 'color:#9e9e9e'),
        ),
        h('tr',
          h('td', {
            colspan: '3',
            style: 'padding:0 6px 4px 6px;font-size:10px;color:#ccc;border-bottom:1px solid #222',
          }, `Forecast: ${w.forecast}`),
        ),
      );
    }

    return h('div', { className: 'ssp-section' },
      sectionHeader('Space Weather Impact'),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Parameter · current value · affected systems · forecast',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 4: Launch Activity Monitor ───────────────────────────────

  private buildLaunchSection(): HTMLElement {
    const milCount = countMilitaryLaunches(LAUNCH_ACTIVITY);
    const badge = milCount > 0 ? countBadge(milCount, 'mil/classified') : undefined;
    const tbody = h('tbody');

    for (const l of LAUNCH_ACTIVITY) {
      const pColor = payloadTypeColor(l.payloadType);
      const pLabel = payloadTypeLabel(l.payloadType);

      tbody.append(
        h('tr',
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' }, l.nation),
          h('td', { style: `padding:3px 6px;font-size:11px;text-transform:uppercase;color:${pColor}` }, pLabel),
          cell(l.orbit, 'color:#facc15'),
        ),
        h('tr',
          h('td', {
            colspan: '3',
            style: 'padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222',
          }, l.notableAspect),
        ),
      );
    }

    return h('div', { className: 'ssp-section' },
      sectionHeader('Launch Activity Monitor', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Nation · payload type · orbit · notable aspect',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 5: Orbital Domain Risk Index ─────────────────────────────

  private buildOrbitalRiskSection(): HTMLElement {
    const tbody = h('tbody');

    for (const d of ORBITAL_RISK_INDEX) {
      const color    = orbitalRiskColor(d.risk);
      const rLabel   = orbitalRiskLabel(d.risk);
      const barWidth = Math.round((d.risk / 4) * 100);

      const bar = h('div', { style: 'background:#333;border-radius:2px;height:6px' },
        h('div', { style: `background:${color};width:${barWidth}%;height:6px;border-radius:2px` }),
      );

      tbody.append(
        h('tr',
          h('td', { style: 'padding:3px 6px;font-size:12px' }, d.regime),
          h('td', { style: 'padding:3px 6px;width:80px' }, bar),
          h('td', { style: `padding:3px 6px;font-size:11px;color:${color};text-transform:uppercase` }, rLabel),
        ),
      );
    }

    return h('div', { className: 'ssp-section' },
      sectionHeader('Orbital Domain Risk Index'),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Orbit regime · composite security risk · 0 minimal → 4 severe',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }
}
