/**
 * NuclearNearMissPanel
 *
 * Tracks historical nuclear close calls and current escalation risk
 * indicators. Distinct from NuclearDeterrencePanel (doctrine); this
 * panel focuses on accidents, misidentifications, and near-launches.
 *
 * Panel id : nuclear-near-miss
 * Refresh  : 24 h (static dataset; refresh enables future live feed)
 */
import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import { escapeHtml } from '@/utils/sanitize';
import {
  buildRenderData,
  severityClass,
  riskLevelClass,
  NEAR_MISS_DATA,
  type NearMissIncident,
  type CurrentRiskIndicator,
} from './nuclear-near-miss-helpers';

const REFRESH_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Colour maps ────────────────────────────────────────────────────────────

const SEVERITY_COLOR: Record<string, string> = {
  'Catastrophic Near-Miss': '#b71c1c',
  Critical: '#e53935',
  Serious: '#fb8c00',
};

const RISK_COLOR: Record<string, string> = {
  Critical: '#b71c1c',
  High: '#e53935',
  Elevated: '#fb8c00',
  Normal: '#43a047',
};

const TYPE_ABBREV: Record<string, string> = {
  'False Alarm': 'FA',
  'Unauthorized Action': 'UA',
  Miscommunication: 'MC',
  'Technical Failure': 'TF',
  'Command Confusion': 'CC',
  Accident: 'AC',
};

// ── Section builders ───────────────────────────────────────────────────────

function renderDoomsdayClock(seconds: number): HTMLElement {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const label = secs > 0 ? `${mins}m ${secs}s to midnight` : `${mins} min to midnight`;
  return h(
    'div',
    { className: 'nnm-clock-wrap' },
    h('span', { className: 'nnm-clock-icon' }, '☢'),
    h('span', { className: 'nnm-clock-label' }, 'Doomsday Clock'),
    h('span', { className: 'nnm-clock-value' }, escapeHtml(label)),
  );
}

function renderRiskHeader(
  currentRiskScore: number,
  historicalRiskScore: number,
  mostDangerousDecade: string,
  catastrophicCount: number,
  criticalIndicatorCount: number,
): HTMLElement {
  const riskColor = currentRiskScore >= 70 ? '#b71c1c' : currentRiskScore >= 50 ? '#e53935' : '#fb8c00';
  return h(
    'div',
    { className: 'nnm-header' },
    h(
      'div',
      { className: 'nnm-metric' },
      h('span', { className: 'nnm-metric-label' }, 'Current Risk'),
      h('span', { className: 'nnm-metric-value', style: `color:${riskColor}` }, `${currentRiskScore}/100`),
    ),
    h(
      'div',
      { className: 'nnm-metric' },
      h('span', { className: 'nnm-metric-label' }, 'Historical Risk'),
      h('span', { className: 'nnm-metric-value' }, `${historicalRiskScore}/100`),
    ),
    h(
      'div',
      { className: 'nnm-metric' },
      h('span', { className: 'nnm-metric-label' }, 'Catastrophic'),
      h('span', { className: 'nnm-metric-value', style: 'color:#b71c1c' }, String(catastrophicCount)),
    ),
    h(
      'div',
      { className: 'nnm-metric' },
      h('span', { className: 'nnm-metric-label' }, 'Critical Indicators'),
      h('span', { className: 'nnm-metric-value', style: 'color:#e53935' }, String(criticalIndicatorCount)),
    ),
    h(
      'div',
      { className: 'nnm-metric' },
      h('span', { className: 'nnm-metric-label' }, 'Most Dangerous Decade'),
      h('span', { className: 'nnm-metric-value' }, escapeHtml(mostDangerousDecade)),
    ),
  );
}

function renderIndicatorsSection(indicators: CurrentRiskIndicator[]): HTMLElement {
  const section = h(
    'div',
    { className: 'nnm-section' },
    h('h3', { className: 'nnm-section-title' }, 'Current Escalation Risk Indicators'),
  );

  for (const ind of indicators) {
    const color = RISK_COLOR[ind.level] ?? '#9e9e9e';
    const cls = riskLevelClass(ind.level);
    section.append(
      h(
        'div',
        { className: `nnm-indicator-row ${cls}` },
        h(
          'div',
          { className: 'nnm-ind-header' },
          h(
            'span',
            { className: 'nnm-ind-dot', style: `background:${color}` },
          ),
          h('span', { className: 'nnm-ind-name' }, escapeHtml(ind.indicator)),
          h(
            'span',
            { className: `nnm-risk-badge ${cls}`, style: `color:${color}` },
            escapeHtml(ind.level),
          ),
          h('span', { className: 'nnm-ind-category' }, escapeHtml(ind.category)),
        ),
        h('div', { className: 'nnm-ind-desc' }, escapeHtml(ind.description)),
      ),
    );
  }

  return section;
}

function renderIncidentsSection(incidents: NearMissIncident[]): HTMLElement {
  const section = h(
    'div',
    { className: 'nnm-section' },
    h('h3', { className: 'nnm-section-title' }, 'Historical Near-Miss Incidents'),
  );

  for (const inc of incidents) {
    const sevColor = SEVERITY_COLOR[inc.severity] ?? '#9e9e9e';
    const cls = severityClass(inc.severity);
    const abbrev = TYPE_ABBREV[inc.incidentType] ?? inc.incidentType.slice(0, 2).toUpperCase();
    const year = inc.date.slice(0, 4);

    section.append(
      h(
        'div',
        { className: `nnm-incident-row ${cls}` },
        h(
          'div',
          { className: 'nnm-inc-header' },
          h(
            'span',
            { className: 'nnm-inc-year' },
            year,
          ),
          h(
            'span',
            { className: `nnm-sev-badge ${cls}`, style: `color:${sevColor}` },
            escapeHtml(inc.severity),
          ),
          h(
            'span',
            { className: 'nnm-type-badge' },
            abbrev,
          ),
          h('span', { className: 'nnm-inc-actors' }, escapeHtml(inc.actors.join(' / '))),
          ...(inc.timeToLaunch
            ? [h('span', { className: 'nnm-ttl' }, `⏱ ${escapeHtml(inc.timeToLaunch)}`)]
            : []),
        ),
        h('div', { className: 'nnm-inc-desc' }, escapeHtml(inc.description)),
        h(
          'div',
          { className: 'nnm-inc-resolved' },
          h('span', { className: 'nnm-resolved-label' }, 'Resolved: '),
          escapeHtml(inc.howResolved),
        ),
        h(
          'div',
          { className: 'nnm-inc-lesson' },
          h('span', { className: 'nnm-lesson-label' }, 'Lesson: '),
          escapeHtml(inc.lesson),
        ),
      ),
    );
  }

  return section;
}

// ── Panel class ────────────────────────────────────────────────────────────

export class NuclearNearMissPanel extends Panel {
  static readonly panelId = 'nuclear-near-miss';
  static readonly title = 'Nuclear Near-Miss Tracker';

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: NuclearNearMissPanel.panelId,
      title: NuclearNearMissPanel.title,
      showCount: true,
      trackActivity: false,
      infoTooltip:
        'Tracks 12 historical nuclear near-miss incidents (accidents, false alarms, misidentifications, and near-launches) alongside 8 current escalation risk indicators. ' +
        'Current risk score 72/100 — higher than any Cold War period except the Cuban Missile Crisis. ' +
        'Doomsday Clock: 90 seconds to midnight (2023, closest ever).',
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
    this.refreshTimer = setInterval(() => this.render(), REFRESH_MS);
  }

  private render(): void {
    const rd = buildRenderData(NEAR_MISS_DATA);

    this.setCount(rd.catastrophicCount + rd.criticalIndicatorCount);

    replaceChildren(
      this.getContentElement(),
      renderDoomsdayClock(rd.doomsday_clock_minutes),
      renderRiskHeader(
        rd.currentRiskScore,
        rd.historicalRiskScore,
        rd.mostDangerousDecade,
        rd.catastrophicCount,
        rd.criticalIndicatorCount,
      ),
      renderIndicatorsSection(rd.currentIndicators),
      renderIncidentsSection(rd.incidents),
    );
  }
}
