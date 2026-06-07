import { h, replaceChildren } from '../utils/dom-utils';
import {
  getDatacenterPosture, getDatacenterSite, subscribeDatacenterPosture,
} from '../services/datacenter/datacenter-state';
import { levelColor, stripSummary } from '../services/datacenter/datacenter-view';
import type { DataCenterPosture } from '../services/datacenter/datacenter-types';
import { dcLevelRank } from '../services/datacenter/datacenter-types';

/**
 * Thin always-visible strip docked above the panel grid (outside the scroll
 * region). Pure renderer — reads the singleton, never decides anything.
 * Pulses only at warning+; respects prefers-reduced-motion via CSS.
 */
export class DataCenterPinnedStrip {
  private readonly el: HTMLElement;
  private unsub: (() => void) | null = null;

  constructor(private readonly onExpand?: () => void) {
    this.el = h('div', { className: 'dc-strip', role: 'status', 'aria-live': 'polite' });
    this.el.addEventListener('click', () => this.onExpand?.());
    this.unsub = subscribeDatacenterPosture((p) => this.render(p));
    this.render(getDatacenterPosture());
  }

  public getElement(): HTMLElement {
    return this.el;
  }

  private render(posture: DataCenterPosture | null): void {
    // No site configured → discoverable CTA, never a fake all-clear.
    if (!getDatacenterSite()) {
      this.el.className = 'dc-strip dc-strip--cta';
      replaceChildren(this.el, h('span', { className: 'dc-strip-text' }, 'Set your data center location'));
      return;
    }
    if (!posture) {
      this.el.className = 'dc-strip dc-strip--cta';
      replaceChildren(this.el, h('span', { className: 'dc-strip-text' }, 'Data center readiness — awaiting data'));
      return;
    }

    const elevated = dcLevelRank(posture.overall) >= dcLevelRank('warning');
    const degraded = posture.staleInputs.length > 0 ? ' dc-strip--degraded' : '';
    this.el.className = `dc-strip dc-strip--${posture.overall}${elevated ? ' dc-strip--pulse' : ''}${degraded}`;

    const dot = h('span', { className: 'dc-strip-dot' });
    dot.style.background = levelColor(posture.overall);
    replaceChildren(this.el,
      dot,
      h('span', { className: 'dc-strip-text' }, stripSummary(posture)),
    );
  }

  public destroy(): void {
    if (this.unsub) { this.unsub(); this.unsub = null; }
    this.el.remove();
  }
}
