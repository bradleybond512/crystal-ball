import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  buildRenderData,
  statusClass,
  severityClass,
  bodyBadgeClass,
  type LegalCase,
  type SCResolution,
} from './intl-law-violations-helpers';

const REFRESH_MS = 60 * 60 * 1000;

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

export class InternationalLawViolationsPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'intl-law-violations',
      title: 'International Law Violations',
      showCount: true,
      trackActivity: false,
      infoTooltip: 'Tracks active ICJ and ICC cases, UN Security Council vetoes, and a global legal compliance index.',
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
      cases,
      resolutions,
      globalComplianceIndex,
      activeCaseCount,
      iccCaseCount,
      icjCaseCount,
      vetoedResolutionsCount,
    } = data;

    this.setCount(activeCaseCount);

    let complianceCls: string;
    if (globalComplianceIndex < 40) {
      complianceCls = 'sev-critical';
    } else if (globalComplianceIndex < 60) {
      complianceCls = 'sev-high';
    } else {
      complianceCls = 'sev-medium';
    }

    const header = h('div', { className: 'ilv-header' },
      h('div', { className: 'ilv-metric' },
        h('span', { className: 'ilv-label' }, 'Compliance Index'),
        h('span', { className: `ilv-value ${complianceCls}` }, `${globalComplianceIndex}/100`),
      ),
      h('div', { className: 'ilv-metric' },
        h('span', { className: 'ilv-label' }, 'Active Cases'),
        h('span', { className: 'ilv-value status-active' }, String(activeCaseCount)),
      ),
      h('div', { className: 'ilv-metric' },
        h('span', { className: 'ilv-label' }, 'ICJ Cases'),
        h('span', { className: 'ilv-value body-icj' }, String(icjCaseCount)),
      ),
      h('div', { className: 'ilv-metric' },
        h('span', { className: 'ilv-label' }, 'ICC Cases'),
        h('span', { className: 'ilv-value body-icc' }, String(iccCaseCount)),
      ),
      h('div', { className: 'ilv-metric' },
        h('span', { className: 'ilv-label' }, 'UNSC Vetoes'),
        h('span', { className: 'ilv-value sev-high' }, String(vetoedResolutionsCount)),
      ),
    );

    const caseSection = h('div', { className: 'ilv-cases' },
      h('h3', { className: 'ilv-section-title' }, 'Active Cases'),
    );
    for (const c of [...cases].sort((a, b) => b.severity - a.severity)) {
      caseSection.append(this.renderCase(c));
    }

    const scSection = h('div', { className: 'ilv-resolutions' },
      h('h3', { className: 'ilv-section-title' }, 'UN Security Council Resolutions'),
    );
    for (const r of [...resolutions].sort((a, b) => b.date.localeCompare(a.date))) {
      scSection.append(this.renderResolution(r));
    }

    replaceChildren(this.getContentElement(), header, caseSection, scSection);
  }

  private renderCase(c: LegalCase): HTMLElement {
    const rulingEl = c.ruling
      ? h('div', { className: 'ilv-ruling' }, c.ruling)
      : h('span', {});

    return h('div', { className: `ilv-case-row ${severityClass(c.severity)}` },
      h('div', { className: 'ilv-case-header' },
        h('span', { className: `ilv-body-badge ${bodyBadgeClass(c.body)}` }, c.body),
        h('span', { className: 'ilv-case-title' }, c.title),
        h('span', { className: `ilv-status-badge ${statusClass(c.status)}` }, c.status),
      ),
      h('div', { className: 'ilv-parties' }, `${c.applicant} v. ${c.respondent}`),
      rulingEl,
      h('div', { className: 'ilv-desc' }, c.description),
    );
  }

  private renderResolution(r: SCResolution): HTMLElement {
    const vetoerEl = r.vetoedBy && r.vetoedBy.length > 0
      ? h('span', { className: 'ilv-vetoer' }, `Vetoed by: ${r.vetoedBy.join(', ')}`)
      : h('span', {});

    return h('div', { className: `ilv-res-row ${r.passed ? 'res-passed' : 'res-vetoed'}` },
      h('div', { className: 'ilv-res-header' },
        h('span', { className: 'ilv-res-num' }, r.resolution),
        h('span', { className: r.passed ? 'res-status-passed' : 'res-status-vetoed' }, r.passed ? 'PASSED' : 'VETOED'),
        vetoerEl,
        h('span', { className: 'ilv-res-date' }, r.date),
      ),
      h('div', { className: 'ilv-res-topic' }, r.topic),
      h('div', { className: 'ilv-res-desc' }, r.description),
    );
  }
}
