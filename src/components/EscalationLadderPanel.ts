import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  buildRenderData,
  rungLabel,
  rungClass,
  trendClass,
  trendArrow,
} from './escalation-ladder-helpers';

const REFRESH_MS = 30 * 60 * 1000; // 30 minutes

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

export class EscalationLadderPanel extends Panel {
  static readonly panelId = 'escalation-ladder';
  static readonly title = 'Escalation Ladder';
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: EscalationLadderPanel.panelId,
      title: EscalationLadderPanel.title,
      showCount: true,
      trackActivity: false,
      infoTooltip:
        'Tracks multi-domain escalation dynamics across 8 active crises using a Kahn-style ladder model (0-20). Each crisis is positioned on an escalation rung with threshold crossings marked. Rungs: 0=Peace, 5=Crisis, 10=Military Action, 15=Limited War, 20=General War. Updates every 30 minutes.',
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

    const { crises, globalBarometer, highEscalationCount, crossedThresholdCount, ascendingCount } =
      data;

    this.setCount(highEscalationCount);

    let barometerClass: string;
    if (globalBarometer >= 15) {
      barometerClass = 'el-general-war';
    } else if (globalBarometer >= 10) {
      barometerClass = 'el-limited-war';
    } else if (globalBarometer >= 5) {
      barometerClass = 'el-crisis';
    } else {
      barometerClass = 'el-peace';
    }

    const header = h(
      'div',
      { className: 'el-header' },
      h(
        'div',
        { className: 'el-metric' },
        h('span', { className: 'el-label' }, 'Global Barometer'),
        h('span', { className: `el-value ${barometerClass}` }, `${globalBarometer}/20`),
      ),
      h(
        'div',
        { className: 'el-metric' },
        h('span', { className: 'el-label' }, 'High Escalation'),
        h('span', { className: 'el-value el-limited-war' }, String(highEscalationCount)),
      ),
      h(
        'div',
        { className: 'el-metric' },
        h('span', { className: 'el-label' }, 'At Threshold'),
        h('span', { className: 'el-value el-crisis' }, String(crossedThresholdCount)),
      ),
      h(
        'div',
        { className: 'el-metric' },
        h('span', { className: 'el-label' }, 'Ascending'),
        h('span', { className: 'el-value el-trend-up' }, String(ascendingCount)),
      ),
    );

    const ladderSection = h(
      'div',
      { className: 'el-ladder' },
      h('h3', { className: 'el-section-title' }, 'Active Crisis Positions'),
    );

    for (const crisis of [...crises].sort((a, b) => b.rung - a.rung)) {
      const barPct = Math.round((crisis.rung / 20) * 100);
      const row = h(
        'div',
        { className: `el-crisis-row ${rungClass(crisis.rung)}` },
        h(
          'div',
          { className: 'el-crisis-header' },
          h('span', { className: 'el-crisis-name' }, crisis.name),
          h(
            'span',
            { className: `el-rung-badge ${rungClass(crisis.rung)}` },
            `Rung ${crisis.rung}/20`,
          ),
          h('span', { className: `el-trend ${trendClass(crisis.trend)}` }, trendArrow(crisis.trend)),
          h('span', { className: 'el-rung-label' }, rungLabel(crisis.rung)),
          h('span', { className: 'el-domain' }, crisis.domain),
        ),
        h('div', { className: 'el-description' }, crisis.description),
        h(
          'div',
          { className: 'el-threshold' },
          h('span', { className: 'el-threshold-label' }, 'Next rung: '),
          crisis.thresholdToNext,
        ),
        h(
          'div',
          { className: 'el-rung-bar-container' },
          h('div', {
            className: `el-rung-bar ${rungClass(crisis.rung)}`,
            style: `width: ${barPct}%`,
          }),
        ),
      );
      ladderSection.append(row);
    }

    const scaleSection = h(
      'div',
      { className: 'el-scale' },
      h('h3', { className: 'el-section-title' }, 'Rung Reference'),
      h(
        'div',
        { className: 'el-scale-row' },
        h('span', { className: 'el-scale-item el-peace' }, '0 - Peace'),
        h('span', { className: 'el-scale-item el-crisis' }, '5 - Crisis'),
        h('span', { className: 'el-scale-item el-limited-war' }, '10 - Military Action'),
        h('span', { className: 'el-scale-item el-general-war' }, '15 - Limited War'),
        h('span', { className: 'el-scale-item el-general-war' }, '20 - General War'),
      ),
    );

    replaceChildren(this.getContentElement(), header, ladderSection, scaleSection);
  }
}
