/**
 * HostageDiplomacyPanel (panel id: `hostage-diplomacy`).
 *
 * Tracks state-sanctioned hostage-taking and wrongful detention of foreign
 * nationals used as geopolitical leverage. Surfaces active cases, country
 * wrongful-detention scores, the global hostage-diplomacy index, and a
 * chronological log of notable prisoner swaps and releases.
 *
 * Pure logic lives in `hostage-diplomacy-helpers.ts`.
 */
import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import { query } from '@/services/intelligence/observation-store';
import {
  buildRenderData,
  statusClass,
  leverageClass,
  severityColor,
  leverageCategoryLabel,
  detentionDurationDays,
  formatDuration,
  type HostageCase,
  type CountryScore,
  type SwapEvent,
} from './hostage-diplomacy-helpers';

const REFRESH_MS = 60 * 60 * 1000; // 1 hour

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

function cell(text: string, style?: string): HTMLElement {
  return h('td', { style: 'padding:3px 6px;font-size:12px' + (style ? ';' + style : '') }, text);
}

function sectionHeader(title: string, badge?: HTMLElement): HTMLElement {
  const header = h('div', { className: 'app-section-header' }, title);
  if (badge) header.append(badge);
  return header;
}

function countBadge(count: number, label: string): HTMLElement {
  return h('span', {
    style: 'margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px',
  }, String(count) + ' ' + label);
}

export class HostageDiplomacyPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'hostage-diplomacy',
      title: 'Hostage Diplomacy Tracker',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Tracks state-sanctioned hostage-taking and wrongful detention of foreign nationals ' +
        'used as geopolitical leverage. Surfaces active cases, country wrongful-detention ' +
        'scores, the global hostage-diplomacy index, and a log of prisoner swaps and releases.',
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
    const liveEvents = safe(() =>
      query({ domain: 'security', tag: 'hostage-diplomacy', limit: 50 }),
    ) ?? [];
    const liveHighCount = liveEvents.filter(
      (e) => e.severity === 'HIGH' || e.severity === 'CRITICAL',
    ).length;

    const data = buildRenderData();
    this.setCount(data.badgeCount + liveHighCount);

    replaceChildren(
      this.getContentElement(),
      h('div', { className: 'app-root' },
        this.buildIndexBar(data.globalIndex, data.activeCases.length),
        this.buildActiveCasesSection(data.activeCases),
        this.buildCountryScoresSection(data.countryScores),
        this.buildAllCasesSection(data.cases),
        this.buildSwapSection(data.swapEvents),
      ),
    );
  }

  // ── Global index bar ─────────────────────────────────────────────────────

  private buildIndexBar(index: number, activeCount: number): HTMLElement {
    let color = 'var(--severity-low,      #4caf50)';
    if (index >= 80) color = 'var(--severity-critical, #ef4444)';
    else if (index >= 60) color = 'var(--severity-high,     #fb923c)';
    else if (index >= 40) color = 'var(--severity-medium,   #facc15)';

    return h('div', { style: 'display:flex;align-items:center;gap:12px;padding:8px 0;margin-bottom:4px' },
      h('div', { style: 'flex:1' },
        h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:2px' },
          'Global Hostage-Diplomacy Index'),
        h('div', { style: 'height:6px;background:#333;border-radius:3px' },
          h('div', { style: 'height:100%;border-radius:3px;background:' + color + ';width:' + index + '%' }),
        ),
      ),
      h('div', { style: 'font-size:22px;font-weight:700;color:' + color }, String(index)),
      h('div', { style: 'font-size:11px;color:#9e9e9e' },
        String(activeCount) + ' active case' + (activeCount === 1 ? '' : 's'),
      ),
    );
  }

  // ── Active cases ─────────────────────────────────────────────────────────

  private buildActiveCasesSection(activeCases: HostageCase[]): HTMLElement {
    const badge = activeCases.length > 0 ? countBadge(activeCases.length, 'active') : undefined;
    const tbody = h('tbody');

    for (const c of activeCases) {
      const sColor   = severityColor(c.severity);
      const stColor  = statusClass(c.status);
      const lvColor  = leverageClass(c.leverageCategory);
      const days     = detentionDurationDays(c.detentionDate);
      const duration = formatDuration(days);

      tbody.append(
        h('tr',
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600;color:' + sColor },
            c.detainee),
          cell(c.citizenship.join(', '), 'color:#9e9e9e'),
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' },
            c.detainingCountry),
          cell(leverageCategoryLabel(c.leverageCategory), 'color:' + lvColor),
          cell(duration, 'color:#facc15;text-align:right'),
          h('td', {
            style: 'padding:3px 6px;font-size:10px;text-transform:uppercase;color:' + stColor + ';text-align:right',
          }, c.status),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('Active Cases', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Detainee · citizenship · detaining country · leverage type · duration · status'),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Country scores ───────────────────────────────────────────────────────

  private buildCountryScoresSection(scores: CountryScore[]): HTMLElement {
    const tbody = h('tbody');

    for (const s of scores) {
      if (s.totalCases === 0) continue;
      let color = 'var(--severity-low,      #4caf50)';
      if (s.score >= 80) color = 'var(--severity-critical, #ef4444)';
      else if (s.score >= 60) color = 'var(--severity-high,     #fb923c)';
      else if (s.score >= 40) color = 'var(--severity-medium,   #facc15)';

      tbody.append(
        h('tr',
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600;color:' + color },
            s.country),
          cell(String(s.activeCases) + ' active / ' + String(s.totalCases) + ' total', 'color:#9e9e9e'),
          cell('avg sev: ' + String(s.avgSeverity), 'color:#ccc;text-align:right'),
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:700;color:' + color + ';text-align:right' },
            String(s.score) + '/100'),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('Country Wrongful-Detention Scores'),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Country · active / total cases · avg severity · composite score'),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── All cases ────────────────────────────────────────────────────────────

  private buildAllCasesSection(cases: HostageCase[]): HTMLElement {
    const tbody = h('tbody');

    for (const c of cases) {
      const sColor  = severityColor(c.severity);
      const stColor = statusClass(c.status);
      const days    = detentionDurationDays(c.detentionDate, c.releaseDate);

      tbody.append(
        h('tr',
          h('td', { style: 'padding:3px 6px;font-size:11px;font-weight:600;color:' + sColor },
            c.detainee),
          cell(c.detainingCountry, 'color:#ccc'),
          cell(c.chargeAlleged, 'color:#9e9e9e;font-size:10px'),
          cell(formatDuration(days), 'color:#facc15;text-align:right'),
          h('td', {
            style: 'padding:3px 6px;font-size:10px;text-transform:uppercase;color:' + stColor + ';text-align:right',
          }, c.status),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('Case Registry (' + String(cases.length) + ')'),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Detainee · detaining country · charge · duration · status'),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Swap events ──────────────────────────────────────────────────────────

  private buildSwapSection(swapEvents: SwapEvent[]): HTMLElement {
    const tbody = h('tbody');

    for (const ev of swapEvents) {
      tbody.append(
        h('tr',
          cell(ev.date, 'color:#9e9e9e;white-space:nowrap'),
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' },
            ev.releasedBy + ' → ' + ev.receivedBy),
          cell(ev.detaineesReleased.join(', '), 'color:#ccc'),
          cell(ev.description, 'color:#9e9e9e;font-size:10px'),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('Swap / Release Events'),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Date · releasedBy → receivedBy · detainees · description'),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }
}
