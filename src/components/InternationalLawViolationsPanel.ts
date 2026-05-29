import { Panel } from './Panel';
import {
  buildRenderData,
  statusClass,
  severityClass,
  bodyBadgeClass,
  type LegalCase,
  type SCResolution,
} from './intl-law-violations-helpers';

const REFRESH_MS = 60 * 60 * 1000;

function h(tag: string, attrs: Record<string, string>, ...children: (string | Node)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

function safeHtml(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

export class InternationalLawViolationsPanel extends Panel {
  static panelId = 'intl-law-violations';
  static title = 'International Law Violations';

  constructor() {
    super(InternationalLawViolationsPanel.panelId, InternationalLawViolationsPanel.title, REFRESH_MS);
  }

  protected async refresh(): Promise<void> {
    const data = safe(() => buildRenderData());
    if (!data) {
      this.replaceChildren(h('div', { class: 'error' }, 'Data unavailable'));
      return;
    }

    const { cases, resolutions, globalComplianceIndex, activeCaseCount, iccCaseCount, icjCaseCount, vetoedResolutionsCount } = data;

    const header = h('div', { class: 'ilv-header' },
      h('div', { class: 'ilv-metric' }, h('span', { class: 'ilv-label' }, 'Compliance Index'), h('span', { class: `ilv-value ${globalComplianceIndex < 40 ? 'sev-critical' : globalComplianceIndex < 60 ? 'sev-high' : 'sev-medium'}` }, `${globalComplianceIndex}/100`)),
      h('div', { class: 'ilv-metric' }, h('span', { class: 'ilv-label' }, 'Active Cases'), h('span', { class: 'ilv-value status-active' }, String(activeCaseCount))),
      h('div', { class: 'ilv-metric' }, h('span', { class: 'ilv-label' }, 'ICJ Cases'), h('span', { class: 'ilv-value body-icj' }, String(icjCaseCount))),
      h('div', { class: 'ilv-metric' }, h('span', { class: 'ilv-label' }, 'ICC Cases'), h('span', { class: 'ilv-value body-icc' }, String(iccCaseCount))),
      h('div', { class: 'ilv-metric' }, h('span', { class: 'ilv-label' }, 'UNSC Vetoes'), h('span', { class: 'ilv-value sev-high' }, String(vetoedResolutionsCount))),
    );

    const caseSection = h('div', { class: 'ilv-cases' },
      h('h3', { class: 'ilv-section-title' }, 'Active Cases'),
    );
    for (const c of [...cases].sort((a, b) => b.severity - a.severity)) {
      const row = h('div', { class: `ilv-case-row ${severityClass(c.severity)}` },
        h('div', { class: 'ilv-case-header' },
          h('span', { class: `ilv-body-badge ${bodyBadgeClass(c.body)}` }, safeHtml(c.body)),
          h('span', { class: 'ilv-case-title' }, safeHtml(c.title)),
          h('span', { class: `ilv-status-badge ${statusClass(c.status)}` }, safeHtml(c.status)),
        ),
        h('div', { class: 'ilv-parties' }, `${safeHtml(c.applicant)} v. ${safeHtml(c.respondent)}`),
        c.ruling ? h('div', { class: 'ilv-ruling' }, safeHtml(c.ruling)) : h('span', {}),
        h('div', { class: 'ilv-desc' }, safeHtml(c.description)),
      );
      caseSection.appendChild(row);
    }

    const scSection = h('div', { class: 'ilv-resolutions' },
      h('h3', { class: 'ilv-section-title' }, 'UN Security Council Resolutions'),
    );
    for (const r of [...resolutions].sort((a, b) => b.date.localeCompare(a.date))) {
      const row = h('div', { class: `ilv-res-row ${r.passed ? 'res-passed' : 'res-vetoed'}` },
        h('div', { class: 'ilv-res-header' },
          h('span', { class: 'ilv-res-num' }, safeHtml(r.resolution)),
          h('span', { class: r.passed ? 'res-status-passed' : 'res-status-vetoed' }, r.passed ? 'PASSED' : 'VETOED'),
          r.vetoedBy && r.vetoedBy.length > 0 ? h('span', { class: 'ilv-vetoer' }, `Vetoed by: ${safeHtml(r.vetoedBy.join(', '))}`) : h('span', {}),
          h('span', { class: 'ilv-res-date' }, safeHtml(r.date)),
        ),
        h('div', { class: 'ilv-res-topic' }, safeHtml(r.topic)),
        h('div', { class: 'ilv-res-desc' }, safeHtml(r.description)),
      );
      scSection.appendChild(row);
    }

    this.replaceChildren(header, caseSection, scSection);
  }
}
