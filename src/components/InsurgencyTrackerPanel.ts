/**
 * Insurgency Tracker Panel — overview of 10 major active insurgencies.
 *
 * Header: composite Global Insurgency Index, active count, escalating count,
 * and total annual fatalities. Table: one row per insurgency, sorted by
 * annual fatalities (highest first), with status / strength / trend badges.
 *
 * Refresh: every 24 hours. The data is a static, deterministic model
 * (insurgency-tracker-helpers.ts) so the panel is a pure render of it.
 */

import { Panel } from './Panel';
import {
  buildRenderData,
  strengthClass,
  statusClass,
  type Insurgency,
} from './insurgency-tracker-helpers';
import { h, replaceChildren } from '../utils/dom-utils';

const REFRESH_MS = 86_400_000; // 24 hours

const TREND_ARROW: Record<Insurgency['trend'], string> = {
  intensifying: '↑',
  stable: '→',
  waning: '↓',
};

const STRENGTH_LABEL: Record<Insurgency['strength'], string> = {
  'very-high': 'Very High',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

function formatThousands(n: number): string {
  return n.toLocaleString('en-US');
}

export class InsurgencyTrackerPanel extends Panel {
  static readonly panelId = 'insurgency-tracker';
  static readonly title = 'Insurgency Tracker';

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: InsurgencyTrackerPanel.panelId,
      title: InsurgencyTrackerPanel.title,
      showCount: true,
      trackActivity: true,
      infoTooltip:
        '10 major active insurgencies, sorted by annual fatalities. The Global Insurgency Index is a composite weighted by combatant strength and escalation trend (0-100).',
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
    const data = safe(() => buildRenderData());
    if (!data) {
      replaceChildren(this.content, h('div', { className: 'error-message' }, 'Data unavailable'));
      return;
    }

    const rows = [...data.insurgencies].sort((a, b) => b.annualFatalities - a.annualFatalities);
    const activeCount = data.insurgencies.filter((i) => i.status !== 'ceasefire').length;
    const escalatingCount = data.insurgencies.filter((i) => i.trend === 'intensifying').length;
    const totalFatalities = data.insurgencies.reduce((sum, i) => sum + i.annualFatalities, 0);

    this.setCount(escalatingCount);

    replaceChildren(
      this.content,
      this.buildHeader(data.globalInsurgencyIndex, activeCount, escalatingCount, totalFatalities),
      this.buildTable(rows),
    );
  }

  private buildHeader(
    index: number,
    activeCount: number,
    escalatingCount: number,
    totalFatalities: number,
  ): HTMLElement {
    const stat = (label: string, value: string, cls = ''): HTMLElement =>
      h('div', { className: `insurgency-stat ${cls}`.trim() },
        h('div', { className: 'insurgency-stat-value' }, value),
        h('div', { className: 'insurgency-stat-label' }, label),
      );

    return h('div', { className: 'insurgency-header' },
      stat('Global Index', String(index), 'insurgency-stat-primary'),
      stat('Active', String(activeCount)),
      stat('Escalating', String(escalatingCount)),
      stat('Fatalities / yr', formatThousands(totalFatalities)),
    );
  }

  private buildTable(rows: Insurgency[]): HTMLElement {
    const head = h('div', { className: 'insurgency-row insurgency-row-head' },
      h('span', { className: 'insurgency-col-name' }, 'Insurgency'),
      h('span', { className: 'insurgency-col-status' }, 'Status'),
      h('span', { className: 'insurgency-col-strength' }, 'Strength'),
      h('span', { className: 'insurgency-col-trend' }, 'Trend'),
      h('span', { className: 'insurgency-col-num' }, 'Fatalities/yr'),
      h('span', { className: 'insurgency-col-num' }, 'Displaced (K)'),
    );

    const body = rows.map((i) =>
      h('div', { className: 'insurgency-row' },
        h('span', { className: 'insurgency-col-name' },
          h('span', { className: 'insurgency-name' }, i.name),
          h('span', { className: 'insurgency-country' }, i.country),
        ),
        h('span', { className: 'insurgency-col-status' },
          h('span', { className: `insurgency-badge ${statusClass(i.status)}` }, i.status),
        ),
        h('span', { className: 'insurgency-col-strength' },
          h('span', { className: `insurgency-badge ${strengthClass(i.strength)}` }, STRENGTH_LABEL[i.strength]),
        ),
        h('span', { className: `insurgency-col-trend insurgency-trend-${i.trend}` }, TREND_ARROW[i.trend]),
        h('span', { className: 'insurgency-col-num' }, formatThousands(i.annualFatalities)),
        h('span', { className: 'insurgency-col-num' }, formatThousands(i.displacedPersons)),
      ),
    );

    return h('div', { className: 'insurgency-table' }, head, ...body);
  }
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}
