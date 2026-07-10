/**
 * GlobalHealthSecurityPanel (panel id: `global-health-security`).
 *
 * Health-security intelligence covering the seven domains that drive
 * Crystal Ball's pandemic-preparedness picture:
 *
 *   1. WHO PHEIC / alert tracker.
 *   2. Outbreak event monitoring.
 *   3. Antimicrobial resistance hotspots.
 *   4. Health system capacity stress.
 *   5. Vaccine coverage gaps.
 *   6. Biosurveillance network status.
 *   7. Pandemic preparedness index.
 *
 * Pure logic — types, reference data, count aggregators, sort comparators,
 * and `render*` HTML-string builders — lives in
 * `global-health-security-helpers.ts`.  All interpolated free-form fields
 * are passed through `escapeHtml` at the render boundary, so the resulting
 * HTML can be safely materialized via the `rawHtml` template helper.
 */

import { Panel } from './Panel';
import { h, rawHtml, replaceChildren } from '@/utils/dom-utils';
import {
  countActivePheics,
  countActiveOutbreaks,
  renderPheicSection,
  renderOutbreakSection,
  renderAmrSection,
  renderCapacitySection,
  renderCoverageSection,
  renderNetworkSection,
  renderPreparednessSection,
  PHEIC_EVENTS,
  OUTBREAK_EVENTS,
  AMR_HOTSPOTS,
  CAPACITY_STRESS,
  COVERAGE_GAPS,
  BIOSURVEILLANCE_NETWORKS,
  PREPAREDNESS_SCORES,
} from './global-health-security-helpers';

const REFRESH_MS = 30 * 60 * 1000;

export class GlobalHealthSecurityPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'global-health-security',
      title: 'Global Health Security',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Health-security intelligence: WHO PHEIC tracker, outbreak events, AMR hotspots, health-system capacity stress, vaccine coverage gaps, biosurveillance network status, and pandemic preparedness index.',
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
    if (typeof setInterval !== 'undefined') {
      this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    }
  }

  private render(): void {
    this.setCount(
      countActivePheics(PHEIC_EVENTS) +
      countActiveOutbreaks(OUTBREAK_EVENTS),
    );

    const html = [
      renderPheicSection(PHEIC_EVENTS),
      renderOutbreakSection(OUTBREAK_EVENTS),
      renderAmrSection(AMR_HOTSPOTS),
      renderCapacitySection(CAPACITY_STRESS),
      renderCoverageSection(COVERAGE_GAPS),
      renderNetworkSection(BIOSURVEILLANCE_NETWORKS),
      renderPreparednessSection(PREPAREDNESS_SCORES),
    ].join('');

    const root = h('div', { className: 'ghsp-root' }, rawHtml(html));
    replaceChildren(this.getContentElement(), root);
  }
}
