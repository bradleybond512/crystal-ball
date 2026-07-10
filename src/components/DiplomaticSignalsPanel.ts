/**
 * Diplomatic Signals Panel — the non-verbal language of statecraft.
 *
 * Header: Global Diplomatic Tension Index, hostile relationship count,
 * escalatory signal count, warming signal count. Two tables: bilateral
 * relationships (sorted most-hostile first by relationshipScore) and recent
 * signals (sorted by diplomatic intensity, then date).
 *
 * Refresh: every 24 hours. The data is a static, deterministic model
 * (diplomatic-signals-helpers.ts) so the panel is a pure render of it.
 */

import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  buildRenderData,
  getEscalatorySignals,
  getWarmingSignals,
  getHostileRelationships,
  sentimentClass,
  intensityClass,
  relationshipStatusClass,
  type BilateralRelationship,
  type DiplomaticSignal,
} from './diplomatic-signals-helpers';

const REFRESH_MS = 86_400_000; // 24 hours

const INTENSITY_RANK: Record<DiplomaticSignal['intensity'], number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const TREND_ARROW: Record<BilateralRelationship['trend'], string> = {
  deteriorating: '↓',
  stable: '→',
  improving: '↑',
};

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

export class DiplomaticSignalsPanel extends Panel {
  static readonly panelId = 'diplomatic-signals';
  static readonly title = 'Diplomatic Signals';

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: DiplomaticSignalsPanel.panelId,
      title: DiplomaticSignalsPanel.title,
      showCount: true,
      trackActivity: false,
      infoTooltip:
        'Tracks the diplomatic signaling language of statecraft: expulsions, ambassador recalls, embassy closures, state visits, joint statements, and hotlines. 15 recent signals + 10 key bilateral relationships scored -100 (hostile) to +100 (allied).',
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
      replaceChildren(
        this.getContentElement(),
        h('div', { className: 'panel-empty' }, 'Data unavailable'),
      );
      return;
    }

    const hostileCount = getHostileRelationships(data.relationships).length;
    const escalatoryCount = getEscalatorySignals(data.signals).length;
    const warmingCount = getWarmingSignals(data.signals).length;

    this.setCount(escalatoryCount);

    const relRows = [...data.relationships].sort(
      (a, b) => a.relationshipScore - b.relationshipScore,
    );
    const signalRows = [...data.signals].sort((a, b) => {
      const r = INTENSITY_RANK[b.intensity] - INTENSITY_RANK[a.intensity];
      return r === 0 ? b.date.localeCompare(a.date) : r;
    });

    replaceChildren(
      this.getContentElement(),
      this.buildHeader(
        data.globalDiplomaticTensionIndex,
        hostileCount,
        escalatoryCount,
        warmingCount,
      ),
      this.buildRelationships(relRows),
      this.buildSignals(signalRows),
    );
  }

  private buildHeader(
    index: number,
    hostileCount: number,
    escalatoryCount: number,
    warmingCount: number,
  ): HTMLElement {
    let idxClass: string;
    if (index >= 60) idxClass = 'ds-tension-critical';
    else if (index >= 35) idxClass = 'ds-tension-strained';
    else idxClass = 'ds-tension-stable';

    const metric = (label: string, value: string, cls = ''): HTMLElement =>
      h('div', { className: 'ds-metric' },
        h('span', { className: 'ds-label' }, label),
        h('span', { className: `ds-value ${cls}`.trim() }, value),
      );

    return h('div', { className: 'ds-header' },
      metric('Tension Index', `${index}/100`, idxClass),
      metric('Hostile', String(hostileCount), 'ds-tension-critical'),
      metric('Escalatory', String(escalatoryCount), 'ds-tension-strained'),
      metric('Warming', String(warmingCount), 'ds-tension-stable'),
    );
  }

  private buildRelationships(rows: BilateralRelationship[]): HTMLElement {
    const section = h('div', { className: 'ds-relationships' },
      h('h3', { className: 'ds-section-title' }, 'Bilateral Relationships'),
    );

    const head = h('div', { className: 'ds-rel-row ds-rel-row-head' },
      h('span', { className: 'ds-rel-parties' }, 'Countries'),
      h('span', { className: 'ds-rel-status' }, 'Status'),
      h('span', { className: 'ds-rel-trend' }, 'Trend'),
      h('span', { className: 'ds-rel-score' }, 'Score'),
      h('span', { className: 'ds-rel-tensions' }, 'Tensions'),
    );
    section.append(head);

    for (const r of rows) {
      const pct = Math.round((r.relationshipScore + 100) / 2); // -100..100 → 0..100
      const bar = h('div', { className: 'ds-score-bar' },
        h('div', {
          className: `ds-score-fill ${relationshipStatusClass(r.currentStatus)}`,
          style: `width:${pct}%`,
        }),
      );
      const row = h('div', { className: 'ds-rel-row' },
        h('span', { className: 'ds-rel-parties' }, `${r.country1} / ${r.country2}`),
        h('span', { className: 'ds-rel-status' },
          h('span', { className: `ds-status-badge ${relationshipStatusClass(r.currentStatus)}` }, r.currentStatus),
        ),
        h('span', { className: `ds-rel-trend ds-trend-${r.trend}` }, TREND_ARROW[r.trend]),
        h('span', { className: 'ds-rel-score' },
          h('span', { className: 'ds-score-num' }, String(r.relationshipScore)),
          bar,
        ),
        h('span', { className: 'ds-rel-tensions' }, String(r.keyTensions.length)),
      );
      section.append(row);
    }

    return section;
  }

  private buildSignals(rows: DiplomaticSignal[]): HTMLElement {
    const section = h('div', { className: 'ds-signals' },
      h('h3', { className: 'ds-section-title' }, 'Recent Signals'),
    );

    const head = h('div', { className: 'ds-sig-row ds-sig-row-head' },
      h('span', { className: 'ds-sig-date' }, 'Date'),
      h('span', { className: 'ds-sig-parties' }, 'From → To'),
      h('span', { className: 'ds-sig-type' }, 'Type'),
      h('span', { className: 'ds-sig-sentiment' }, 'Sentiment'),
      h('span', { className: 'ds-sig-context' }, 'Context'),
    );
    section.append(head);

    for (const s of rows) {
      const row = h('div', { className: `ds-sig-row ${intensityClass(s.intensity)}` },
        h('span', { className: 'ds-sig-date' }, s.date),
        h('span', { className: 'ds-sig-parties' },
          h('span', { className: 'ds-sig-from' }, s.initiatingCountry),
          h('span', { className: 'ds-sig-arrow' }, ' → '),
          h('span', { className: 'ds-sig-to' }, s.targetCountry),
        ),
        h('span', { className: 'ds-sig-type' }, s.signalType),
        h('span', { className: 'ds-sig-sentiment' },
          h('span', { className: `ds-sentiment-badge ${sentimentClass(s.sentiment)}` }, s.sentiment),
        ),
        h('span', { className: 'ds-sig-context' }, s.context),
      );
      section.append(row);
    }

    return section;
  }
}
