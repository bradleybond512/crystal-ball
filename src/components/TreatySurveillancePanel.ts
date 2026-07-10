import { Panel } from './Panel';
import { h, replaceChildren, safeHtml } from '@/utils/dom-utils';
import { escapeHtml } from '@/utils/sanitize';
import {
  buildRenderData,
  healthClass,
  complianceClass,
  statusClass,
  rankByHealth,
  type Treaty,
  type ComplianceRecord,
} from './treaty-surveillance-helpers';

const REFRESH_MS = 60 * 60 * 1000; // 1 hour

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

export class TreatySurveillancePanel extends Panel {
  static readonly panelId = 'treaty-surveillance';
  static readonly title = 'Treaty Surveillance';

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: TreatySurveillancePanel.panelId,
      title: TreatySurveillancePanel.title,
      showCount: true,
      trackActivity: false,
      infoTooltip:
        'Monitors 10 international arms control and governance treaties (NPT, CWC, BWC, New START, INF, OST, UNCLOS, Paris) with compliance records, violation tracking, and a global compliance score.',
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

    const {
      treaties,
      compliance,
      globalComplianceScore,
      inForceCount,
      criticalHealthCount,
      majorViolationCount,
    } = data;

    this.setCount(majorViolationCount + criticalHealthCount);

    let scoreClass: string;
    if (globalComplianceScore < 50) {
      scoreClass = 'comp-fail';
    } else if (globalComplianceScore < 75) {
      scoreClass = 'comp-partial';
    } else {
      scoreClass = 'comp-ok';
    }

    const header = h(
      'div',
      { className: 'ts-header' },
      h(
        'div',
        { className: 'ts-metric' },
        h('span', { className: 'ts-label' }, 'Compliance Score'),
        h('span', { className: `ts-value ${scoreClass}` }, `${globalComplianceScore}/100`),
      ),
      h(
        'div',
        { className: 'ts-metric' },
        h('span', { className: 'ts-label' }, 'In Force'),
        h('span', { className: 'ts-value status-active' }, String(inForceCount)),
      ),
      h(
        'div',
        { className: 'ts-metric' },
        h('span', { className: 'ts-label' }, 'Critical/Defunct'),
        h('span', { className: 'ts-value treaty-critical' }, String(criticalHealthCount)),
      ),
      h(
        'div',
        { className: 'ts-metric' },
        h('span', { className: 'ts-label' }, 'Major Violations'),
        h('span', { className: 'ts-value comp-fail' }, String(majorViolationCount)),
      ),
    );

    const treatySection = h('div', { className: 'ts-treaties' });
    for (const t of rankByHealth(treaties)) {
      const row = buildTreatyRow(t);
      treatySection.append(row);
    }

    const violSection = h(
      'div',
      { className: 'ts-violations' },
      h('h3', { className: 'ts-section-title' }, 'Compliance Violations'),
    );
    const sorted = [...compliance].sort((a, b) => a.rating.localeCompare(b.rating));
    for (const cr of sorted) {
      violSection.append(buildComplianceRow(cr));
    }

    replaceChildren(this.getContentElement(), header, treatySection, violSection);
  }
}

function buildTreatyRow(t: Treaty): HTMLElement {
  return h(
    'div',
    { className: `ts-treaty-row ${healthClass(t.overallHealth)}` },
    h(
      'div',
      { className: 'ts-treaty-header' },
      h('span', { className: 'ts-abbr' }, safeHtml(t.abbreviation)),
      h('span', { className: `ts-health-badge ${healthClass(t.overallHealth)}` }, safeHtml(t.overallHealth)),
      h('span', { className: `ts-status-badge ${statusClass(t.status)}` }, safeHtml(t.status)),
      h('span', { className: 'ts-domain' }, safeHtml(t.domain)),
      h('span', { className: 'ts-parties' }, `${t.parties} parties`),
    ),
    h('div', { className: 'ts-purpose' }, safeHtml(t.purpose)),
    t.keyViolators.length > 0
      ? h('div', { className: 'ts-violators' }, 'Violators: ' + escapeHtml(t.keyViolators.join(', ')))
      : h('span', {}),
    h('div', { className: 'ts-development' }, safeHtml(t.recentDevelopment)),
  );
}

function buildComplianceRow(cr: ComplianceRecord): HTMLElement {
  return h(
    'div',
    { className: `ts-comp-row ${complianceClass(cr.rating)}` },
    h(
      'div',
      { className: 'ts-comp-header' },
      h('span', { className: 'ts-comp-country' }, safeHtml(cr.country)),
      h('span', { className: 'ts-comp-treaty' }, safeHtml(cr.treaty)),
      h('span', { className: `ts-comp-badge ${complianceClass(cr.rating)}` }, safeHtml(cr.rating)),
      cr.ongoing ? h('span', { className: 'ts-ongoing' }, 'ONGOING') : h('span', {}),
      h('span', { className: 'ts-year' }, safeHtml(cr.yearReported)),
    ),
    h('div', { className: 'ts-issue' }, safeHtml(cr.issue)),
  );
}
