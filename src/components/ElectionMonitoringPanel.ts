/**
 * ElectionMonitoringPanel (panel id: `election-monitoring`).
 *
 * Global electoral intelligence: upcoming votes, integrity indicators,
 * results tracking, turnout anomalies, disinformation signals, and
 * international observer reports.
 *
 * Sections:
 *   1. Election Calendar          — upcoming elections with stakes + days until
 *   2. Electoral Integrity        — per-nation risk bar + concerns + observers
 *   3. Results Tracker            — recent results with margin, turnout, status
 *   4. Turnout Anomaly Detection  — expected vs actual turnout + anomaly score
 *   5. Disinformation Signals     — platform, campaign type, intensity
 *   6. Observer Reports           — org verdict with findings
 *
 * Pure helpers live in `election-monitoring-helpers.ts`.
 */

import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import { query } from '@/services/intelligence/observation-store';
import {
  electionTypeColor,
  electionTypeLabel,
  stakesColor,
  stakesLabel,
  integrityRiskColor,
  integrityRiskLabel,
  resultStatusColor,
  resultStatusLabel,
  turnoutAnomalyColor,
  turnoutAnomalyLabel,
  disinfoCampaignTypeColor,
  disinfoCampaignTypeLabel,
  disinfoIntensityColor,
  observerVerdictColor,
  observerVerdictLabel,
  countImminentElections,
  countHighIntegrityRisk,
  countDisputedResults,
  countHighIntensityDisinfo,
  ELECTION_CALENDAR,
  INTEGRITY_INDICATORS,
  ELECTION_RESULTS,
  TURNOUT_ANOMALIES,
  DISINFO_SIGNALS,
  OBSERVER_REPORTS,
} from './election-monitoring-helpers';

const REFRESH_MS = 2 * 60 * 1000;

function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

function cell(text: string, style?: string): HTMLElement {
  return h('td', { style: `padding:3px 6px;font-size:12px${style ? ';' + style : ''}` }, text);
}

function sectionHeader(title: string, badge?: HTMLElement): HTMLElement {
  const header = h('div', { className: 'emp-section-header' }, title);
  if (badge) header.append(badge);
  return header;
}

function countBadge(count: number, label: string): HTMLElement {
  return h('span', {
    style: 'margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px',
  }, `${count} ${label}`);
}

function riskBar(score: number, maxScore: number, color: string): HTMLElement {
  const pct = Math.round((score / maxScore) * 100);
  return h('div', { style: 'background:#333;border-radius:2px;height:6px' },
    h('div', { style: `background:${color};width:${pct}%;height:6px;border-radius:2px` }),
  );
}

export class ElectionMonitoringPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'election-monitoring',
      title: 'Election Monitoring',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Tracks global electoral events, integrity indicators, results, turnout anomalies, disinformation campaigns, and international observer reports.',
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
      countImminentElections(ELECTION_CALENDAR) +
      countHighIntegrityRisk(INTEGRITY_INDICATORS) +
      countDisputedResults(ELECTION_RESULTS) +
      countHighIntensityDisinfo(DISINFO_SIGNALS) +
      liveHighCount,
    );

    replaceChildren(
      this.getContentElement(),
      h('div', { className: 'emp-root' },
        this.buildCalendarSection(),
        this.buildIntegritySection(),
        this.buildResultsSection(),
        this.buildTurnoutSection(),
        this.buildDisinfoSection(),
        this.buildObserverSection(),
      ),
    );
  }

  // ── Section 1: Election Calendar ─────────────────────────────────────────

  private buildCalendarSection(): HTMLElement {
    const imminent = countImminentElections(ELECTION_CALENDAR);
    const badge = imminent > 0 ? countBadge(imminent, 'within 30d') : undefined;
    const tbody = h('tbody');

    for (const e of ELECTION_CALENDAR) {
      const eColor = electionTypeColor(e.electionType);
      const sColor = stakesColor(e.stakes);
      const sLabel = stakesLabel(e.stakes);
      const daysText = e.daysUntil <= 0 ? 'Today' : `${e.daysUntil}d`;
      let daysColor: string;
      if (e.daysUntil <= 14) {
        daysColor = '#ef4444';
      } else if (e.daysUntil <= 30) {
        daysColor = '#fb923c';
      } else {
        daysColor = '#facc15';
      }

      tbody.append(
        h('tr',
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' }, e.nation),
          h('td', { style: `padding:3px 6px;font-size:11px;color:${eColor}` }, electionTypeLabel(e.electionType)),
          h('td', { style: `padding:3px 6px;font-size:11px;color:${daysColor};text-align:right` }, daysText),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${sColor};text-align:right` }, sLabel),
        ),
        h('tr',
          h('td', {
            colspan: '4',
            style: 'padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222',
          }, e.description),
        ),
      );
    }

    return h('div', { className: 'emp-section' },
      sectionHeader('Election Calendar', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Nation · type · days until · stakes',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 2: Electoral Integrity Indicators ────────────────────────────

  private buildIntegritySection(): HTMLElement {
    const highRisk = countHighIntegrityRisk(INTEGRITY_INDICATORS);
    const badge = highRisk > 0 ? countBadge(highRisk, 'high/compromised') : undefined;
    const tbody = h('tbody');

    for (const ind of INTEGRITY_INDICATORS) {
      const rColor = integrityRiskColor(ind.riskScore);
      const rLabel = integrityRiskLabel(ind.riskScore);
      const bar = riskBar(ind.riskScore, 4, rColor);
      const obsText = ind.observerPresence ? 'Observers present' : 'No observers';
      const obsColor = ind.observerPresence ? '#4caf50' : '#ef4444';

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${rColor}` }, ind.nation),
          h('td', { style: 'padding:3px 6px;width:80px' }, bar),
          h('td', { style: `padding:3px 6px;font-size:11px;color:${rColor};text-transform:uppercase` }, rLabel),
          h('td', { style: `padding:3px 6px;font-size:10px;color:${obsColor};text-align:right` }, obsText),
        ),
        h('tr',
          h('td', {
            colspan: '4',
            style: 'padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222',
          }, ind.concerns.slice(0, 2).join(' · ')),
        ),
      );
    }

    return h('div', { className: 'emp-section' },
      sectionHeader('Electoral Integrity Indicators', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Nation · risk index (0 clean → 4 compromised) · observers',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 3: Results Tracker ───────────────────────────────────────────

  private buildResultsSection(): HTMLElement {
    const disputed = countDisputedResults(ELECTION_RESULTS);
    const badge = disputed > 0 ? countBadge(disputed, 'disputed/annulled') : undefined;
    const tbody = h('tbody');

    for (const r of ELECTION_RESULTS) {
      const sColor = resultStatusColor(r.status);
      const sLabel = resultStatusLabel(r.status);
      const margin = `±${r.marginPct.toFixed(1)}%`;
      const turnout = `${r.turnoutPct.toFixed(1)}% turnout`;

      tbody.append(
        h('tr',
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' }, r.nation),
          cell(r.winner, 'color:#ccc'),
          cell(margin, 'color:#facc15;text-align:right'),
          cell(turnout, 'color:#9e9e9e;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${sColor};text-align:right` }, sLabel),
        ),
        h('tr',
          h('td', {
            colspan: '5',
            style: 'padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222',
          }, r.notes),
        ),
      );
    }

    return h('div', { className: 'emp-section' },
      sectionHeader('Results Tracker', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Nation · winner · margin · turnout · status',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 4: Turnout Anomaly Detection ─────────────────────────────────

  private buildTurnoutSection(): HTMLElement {
    const tbody = h('tbody');

    for (const a of TURNOUT_ANOMALIES) {
      const color = turnoutAnomalyColor(a.anomalyScore);
      const label = turnoutAnomalyLabel(a.anomalyScore);
      const delta = a.actualPct - a.expectedPct;
      const deltaText = delta >= 0 ? `+${delta.toFixed(0)}pp` : `${delta.toFixed(0)}pp`;
      const bar = riskBar(a.anomalyScore, 4, color);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${color}` }, a.region),
          cell(`${a.expectedPct}% exp`, 'color:#9e9e9e;text-align:right'),
          cell(`${a.actualPct}% act`, 'color:#facc15;text-align:right'),
          cell(deltaText, `color:${color};text-align:right`),
          h('td', { style: 'padding:3px 6px;width:60px' }, bar),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${color}` }, label),
        ),
        h('tr',
          h('td', {
            colspan: '6',
            style: 'padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222',
          }, a.signal),
        ),
      );
    }

    return h('div', { className: 'emp-section' },
      sectionHeader('Turnout Anomaly Detection'),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Region · expected · actual · delta · anomaly score',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 5: Disinformation Campaign Signals ───────────────────────────

  private buildDisinfoSection(): HTMLElement {
    const highCount = countHighIntensityDisinfo(DISINFO_SIGNALS);
    const badge = highCount > 0 ? countBadge(highCount, 'high/critical') : undefined;
    const tbody = h('tbody');

    for (const s of DISINFO_SIGNALS) {
      const tColor = disinfoCampaignTypeColor(s.campaignType);
      const tLabel = disinfoCampaignTypeLabel(s.campaignType);
      const iColor = disinfoIntensityColor(s.intensity);

      tbody.append(
        h('tr',
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' }, s.platform),
          h('td', { style: `padding:3px 6px;font-size:11px;color:${tColor}` }, tLabel),
          cell(s.targetNation, 'color:#ccc'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${iColor};text-align:right` }, s.intensity),
        ),
        h('tr',
          h('td', {
            colspan: '4',
            style: 'padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222',
          }, s.description),
        ),
      );
    }

    return h('div', { className: 'emp-section' },
      sectionHeader('Disinformation Signals', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Platform · campaign type · nation · intensity',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 6: International Observer Reports ────────────────────────────

  private buildObserverSection(): HTMLElement {
    const tbody = h('tbody');

    for (const r of OBSERVER_REPORTS) {
      const vColor = observerVerdictColor(r.verdict);
      const vLabel = observerVerdictLabel(r.verdict);

      tbody.append(
        h('tr',
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' }, r.nation),
          cell(r.organization, 'color:#ccc'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${vColor};text-align:right` }, vLabel),
        ),
        h('tr',
          h('td', {
            colspan: '3',
            style: 'padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222',
          }, r.findings),
        ),
      );
    }

    return h('div', { className: 'emp-section' },
      sectionHeader('International Observer Reports'),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Nation · organization · verdict · findings',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }
}
