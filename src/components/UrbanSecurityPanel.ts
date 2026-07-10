/**
 * UrbanSecurityPanel (panel id: `urban-security`).
 *
 * City-level security intelligence: civil unrest, gang territory,
 * violence indices, police incident density, and social tension scoring.
 *
 * Sections:
 *   1. Civil Unrest Hotspots       — active city-level unrest events
 *   2. Protest & Riot Event Log    — recent individual events with outcomes
 *   3. Gang Territory Indicators   — per-city faction control + homicide rates
 *   4. Urban Violence Index        — composite 0–10 score per city
 *   5. Police Incident Density     — high-volume incident feeds by district
 *   6. Social Tension Scoring      — metro tension score + trajectory
 *
 * Pure helpers live in `urban-security-helpers.ts`.
 */

import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import { query } from '@/services/intelligence/observation-store';
import {
  unrestTypeColor,
  unrestTypeLabel,
  unrestIntensityColor,
  unrestIntensityLabel,
  eventOutcomeColor,
  eventOutcomeLabel,
  territoryControlColor,
  territoryControlLabel,
  trendDirectionColor,
  trendDirectionLabel,
  tensionTrajectoryColor,
  tensionTrajectoryLabel,
  incidentCategoryColor,
  incidentCategoryLabel,
  alertLevelColor,
  alertLevelLabel,
  violenceScoreColor,
  tensionScoreColor,
  countHighIntensityHotspots,
  countNoGoZones,
  countHighAlertCities,
  countRisingTensionCities,
  UNREST_HOTSPOTS,
  PROTEST_EVENTS,
  GANG_TERRITORY_INDICATORS,
  URBAN_VIOLENCE_INDEX,
  POLICE_INCIDENT_FEEDS,
  SOCIAL_TENSION_SCORES,
} from './urban-security-helpers';

const REFRESH_MS = 5 * 60 * 1000;

function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

function cell(text: string, style?: string): HTMLElement {
  return h('td', { style: `padding:3px 6px;font-size:12px${style ? ';' + style : ''}` }, text);
}

function sectionHeader(title: string, badge?: HTMLElement): HTMLElement {
  const header = h('div', { className: 'usp-section-header' }, title);
  if (badge) header.append(badge);
  return header;
}

function countBadge(count: number, label: string): HTMLElement {
  return h('span', {
    style: 'margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px',
  }, `${count} ${label}`);
}

function scoreBar(score: number, maxScore: number, color: string): HTMLElement {
  const pct = Math.round((score / maxScore) * 100);
  return h('div', { style: 'background:#333;border-radius:2px;height:6px' },
    h('div', { style: `background:${color};width:${pct}%;height:6px;border-radius:2px` }),
  );
}

function formatParticipants(n: number): string {
  if (n <= 0) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return String(n);
}

export class UrbanSecurityPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'urban-security',
      title: 'Urban Security',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'City-level security intelligence: civil unrest hotspots, gang territory control, urban violence indices, police incident density, and social tension scoring.',
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
    const liveEvents = safe(() => query({ domain: 'geopolitical', limit: 50 })) ?? [];
    const liveHighCount = liveEvents.filter(
      (e) => e.severity === 'HIGH' || e.severity === 'CRITICAL',
    ).length;

    this.setCount(
      countHighIntensityHotspots(UNREST_HOTSPOTS) +
      countNoGoZones(GANG_TERRITORY_INDICATORS) +
      countHighAlertCities(POLICE_INCIDENT_FEEDS) +
      liveHighCount,
    );

    replaceChildren(
      this.getContentElement(),
      h('div', { className: 'usp-root' },
        this.buildUnrestSection(),
        this.buildEventLogSection(),
        this.buildGangTerritorySection(),
        this.buildViolenceIndexSection(),
        this.buildIncidentFeedSection(),
        this.buildTensionSection(),
      ),
    );
  }

  // ── Section 1: Civil Unrest Hotspots ─────────────────────────────────────

  private buildUnrestSection(): HTMLElement {
    const highCount = countHighIntensityHotspots(UNREST_HOTSPOTS);
    const badge = highCount > 0 ? countBadge(highCount, 'high/severe') : undefined;
    const tbody = h('tbody');

    for (const spot of UNREST_HOTSPOTS) {
      const tColor = unrestTypeColor(spot.unrestType);
      const iColor = unrestIntensityColor(spot.intensity);
      const iLabel = unrestIntensityLabel(spot.intensity);
      const partText = formatParticipants(spot.participants);
      const daysText = `${spot.daysActive}d active`;

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${iColor}` },
            `${spot.city}, ${spot.country}`),
          h('td', { style: `padding:3px 6px;font-size:11px;color:${tColor}` },
            unrestTypeLabel(spot.unrestType)),
          cell(partText, 'color:#facc15;text-align:right'),
          cell(daysText, 'color:#9e9e9e;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${iColor};text-align:right` },
            iLabel),
        ),
        h('tr',
          h('td', {
            colspan: '5',
            style: 'padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222',
          }, spot.trigger),
        ),
      );
    }

    return h('div', { className: 'usp-section' },
      sectionHeader('Civil Unrest Hotspots', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'City · type · participants · days active · intensity',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 2: Protest & Riot Event Log ──────────────────────────────────

  private buildEventLogSection(): HTMLElement {
    const tbody = h('tbody');

    for (const ev of PROTEST_EVENTS) {
      const oColor = eventOutcomeColor(ev.outcome);
      const oLabel = eventOutcomeLabel(ev.outcome);
      const partText = formatParticipants(ev.participants);
      const casText = ev.casualties > 0 ? `${ev.casualties} cas.` : 'No cas.';
      const casColor = ev.casualties > 0 ? '#fb923c' : '#9e9e9e';

      tbody.append(
        h('tr',
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' },
            `${ev.city}, ${ev.country}`),
          cell(ev.date, 'color:#9e9e9e'),
          cell(partText, 'color:#facc15;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:11px;color:${casColor};text-align:right` }, casText),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${oColor};text-align:right` },
            oLabel),
        ),
        h('tr',
          h('td', {
            colspan: '5',
            style: 'padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222',
          }, ev.description),
        ),
      );
    }

    return h('div', { className: 'usp-section' },
      sectionHeader('Protest & Riot Event Log'),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'City · date · participants · casualties · outcome',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 3: Gang Territory Indicators ─────────────────────────────────

  private buildGangTerritorySection(): HTMLElement {
    const noGo = countNoGoZones(GANG_TERRITORY_INDICATORS);
    const badge = noGo > 0 ? countBadge(noGo, 'no-go/criminal') : undefined;
    const tbody = h('tbody');

    for (const g of GANG_TERRITORY_INDICATORS) {
      const cColor = territoryControlColor(g.controlType);
      const cLabel = territoryControlLabel(g.controlType);
      const tColor = trendDirectionColor(g.trend);
      const tLabel = trendDirectionLabel(g.trend);
      const homText = `${g.homicidePer100k}/100k`;

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${cColor}` },
            `${g.city}, ${g.country}`),
          h('td', { style: `padding:3px 6px;font-size:11px;text-transform:uppercase;color:${cColor}` }, cLabel),
          cell(`${g.activeFactions} factions`, 'color:#9e9e9e;text-align:right'),
          cell(homText, 'color:#fb923c;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${tColor};text-align:right` },
            tLabel),
        ),
        h('tr',
          h('td', {
            colspan: '5',
            style: 'padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222',
          }, g.factionNote),
        ),
      );
    }

    return h('div', { className: 'usp-section' },
      sectionHeader('Gang Territory Indicators', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'City · control type · factions · homicide/100k · trend',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 4: Urban Violence Index ──────────────────────────────────────

  private buildViolenceIndexSection(): HTMLElement {
    const tbody = h('tbody');

    for (const v of URBAN_VIOLENCE_INDEX) {
      const color  = violenceScoreColor(v.score);
      const tColor = trendDirectionColor(v.trend);
      const bar    = scoreBar(v.score, 10, color);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${color}` },
            `${v.city}, ${v.country}`),
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${color}` },
            v.score.toFixed(1)),
          h('td', { style: 'padding:3px 6px;width:80px' }, bar),
          cell(`#${v.globalRank} global`, 'color:#9e9e9e;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${tColor};text-align:right` },
            trendDirectionLabel(v.trend)),
        ),
        h('tr',
          h('td', {
            colspan: '5',
            style: 'padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222',
          }, v.dominantDriver),
        ),
      );
    }

    return h('div', { className: 'usp-section' },
      sectionHeader('Urban Violence Index'),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'City · score (0 safe → 10 critical) · global rank · trend',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 5: Police Incident Density ───────────────────────────────────

  private buildIncidentFeedSection(): HTMLElement {
    const highAlert = countHighAlertCities(POLICE_INCIDENT_FEEDS);
    const badge = highAlert > 0 ? countBadge(highAlert, 'alert 3+') : undefined;
    const tbody = h('tbody');

    for (const f of POLICE_INCIDENT_FEEDS) {
      const cColor = incidentCategoryColor(f.incidentCategory);
      const cLabel = incidentCategoryLabel(f.incidentCategory);
      const aColor = alertLevelColor(f.alertLevel);
      const aLabel = alertLevelLabel(f.alertLevel);

      tbody.append(
        h('tr',
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' },
            `${f.city}, ${f.country}`),
          h('td', { style: `padding:3px 6px;font-size:11px;color:${cColor}` }, cLabel),
          cell(`${f.dailyAverage}/day`, 'color:#facc15;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${aColor};text-align:right` },
            aLabel),
        ),
        h('tr',
          h('td', {
            colspan: '4',
            style: 'padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222',
          }, `Hotspot: ${f.hotspotDistrict}`),
        ),
      );
    }

    return h('div', { className: 'usp-section' },
      sectionHeader('Police Incident Density', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'City · incident type · daily average · alert level · hotspot district',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 6: Social Tension Scoring ────────────────────────────────────

  private buildTensionSection(): HTMLElement {
    const rising = countRisingTensionCities(SOCIAL_TENSION_SCORES);
    const badge = rising > 0 ? countBadge(rising, 'rising') : undefined;
    const tbody = h('tbody');

    for (const s of SOCIAL_TENSION_SCORES) {
      const color  = tensionScoreColor(s.tensionScore);
      const tColor = tensionTrajectoryColor(s.trajectory);
      const bar    = scoreBar(s.tensionScore, 10, color);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${color}` },
            `${s.metro}, ${s.country}`),
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${color}` },
            s.tensionScore.toFixed(1)),
          h('td', { style: 'padding:3px 6px;width:80px' }, bar),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${tColor};text-align:right` },
            tensionTrajectoryLabel(s.trajectory)),
        ),
        h('tr',
          h('td', {
            colspan: '4',
            style: 'padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222',
          }, s.drivers.join(' · ')),
        ),
      );
    }

    return h('div', { className: 'usp-section' },
      sectionHeader('Social Tension Scoring', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Metro · tension score (0–10) · trajectory · key drivers',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }
}
