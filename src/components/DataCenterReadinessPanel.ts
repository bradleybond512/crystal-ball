import { Panel } from './Panel';
import { h, replaceChildren } from '../utils/dom-utils';
import {
  getDatacenterPosture, subscribeDatacenterPosture,
} from '../services/datacenter/datacenter-state';
import { levelLabel, levelColor } from '../services/datacenter/datacenter-view';
import type { DataCenterPosture, DcLevel, ReadinessAction } from '../services/datacenter/datacenter-types';

const URGENCY_LABEL: Record<ReadinessAction['urgency'], string> = {
  now: 'NOW', soon: 'SOON', be_ready: 'BE READY', monitor: 'MONITOR',
};
const AUDIENCE_LABEL: Record<ReadinessAction['audience'], string> = {
  onsite_safety: 'On-site safety', commute_staffing: 'Commute & staffing',
  facility_ops: 'Facility ops', escalation: 'Escalation',
};

export class DataCenterReadinessPanel extends Panel {
  private unsub: (() => void) | null = null;

  constructor() {
    super({ id: 'datacenter-readiness', title: 'Data Center Readiness', showCount: true });
    this.unsub = subscribeDatacenterPosture((p) => this.render(p));
    this.render(getDatacenterPosture());
  }

  private render(posture: DataCenterPosture | null): void {
    if (!posture) {
      replaceChildren(this.content,
        h('div', { className: 'dc-empty' }, 'Set your data center location (tag a saved place "data_center") to activate this panel.'),
      );
      this.setCount(0);
      return;
    }

    this.setCount(posture.actions.filter((a) => a.urgency === 'now').length);

    const header = h('div', { className: 'dc-status-header' },
      this.gauge('Power', posture.power.level, posture.power.drivers[0] ?? '—'),
      this.gauge(
        'Weather',
        posture.weather.level,
        posture.weather.arrivalWindowMins === null
          ? (posture.weather.drivers[0] ?? '—')
          : `ETA ${posture.weather.arrivalWindowMins} min`,
      ),
    );

    const actionList = posture.actions.length === 0
      ? h('div', { className: 'dc-allclear' }, 'No power or weather action needed — monitoring.')
      : h('div', { className: 'dc-actions' }, ...posture.actions.map((a) => this.actionRow(a)));

    const footerParts: string[] = [];
    if (posture.staleInputs.length > 0) footerParts.push(`Stale/missing: ${posture.staleInputs.join(', ')}`);
    const footer = h('div', { className: 'dc-footer' }, footerParts.join(' · ') || 'All feeds current');

    replaceChildren(this.content, header, actionList, footer);
    this.invalidateContentCache();
    this.markFresh();
  }

  private gauge(label: string, level: DcLevel, detail: string): HTMLElement {
    const dot = h('span', { className: 'dc-gauge-dot' });
    dot.style.background = levelColor(level);
    return h('div', { className: 'dc-gauge' },
      h('div', { className: 'dc-gauge-top' },
        dot,
        h('span', { className: 'dc-gauge-label' }, label),
        h('span', { className: 'dc-gauge-level' }, levelLabel(level)),
      ),
      h('div', { className: 'dc-gauge-detail' }, detail),
    );
  }

  private actionRow(a: ReadinessAction): HTMLElement {
    const badge = h('span', { className: `dc-urgency dc-urgency--${a.urgency}` }, URGENCY_LABEL[a.urgency]);
    return h('div', { className: `dc-action dc-action--${a.audience}` },
      h('div', { className: 'dc-action-head' }, badge, h('span', { className: 'dc-action-aud' }, AUDIENCE_LABEL[a.audience])),
      h('div', { className: 'dc-action-title' }, a.title),
      a.detail ? h('div', { className: 'dc-action-detail' }, a.detail) : null,
      a.trigger ? h('div', { className: 'dc-action-trigger' }, a.trigger) : null,
    );
  }

  public override destroy(): void {
    if (this.unsub) { this.unsub(); this.unsub = null; }
    super.destroy();
  }
}
