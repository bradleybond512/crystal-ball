import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  buildRenderData,
  frameworkStatusClass,
  riskClass,
  bindingClass,
  scopeClass,
} from './ai-governance-helpers';

const REFRESH_MS = 24 * 60 * 60 * 1000; // 24 hours

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

export class AIGovernancePanel extends Panel {
  static readonly panelId = 'ai-governance';
  static readonly title = 'AI Governance';
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: AIGovernancePanel.panelId,
      title: AIGovernancePanel.title,
      showCount: true,
      trackActivity: false,
      infoTooltip:
        'Tracks international AI governance frameworks, safety agreements, and AI arms race dynamics as geopolitical indicators. Covers 10 major frameworks (2019-2024), military AI programs across 4 major powers, and key capability benchmarks including compute thresholds and export controls.',
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
      frameworks,
      militaryPrograms,
      benchmarks,
      globalGovernanceIndex,
      activeFrameworkCount,
      bindingFrameworkCount,
      armsRaceRisk,
      coverageGap,
    } = data;

    this.setCount(activeFrameworkCount);

    // Governance index colouring: higher = better governed = lower risk colour
    let idxClass: string;
    if (globalGovernanceIndex >= 70) {
      idxClass = 'sev-low';
    } else if (globalGovernanceIndex >= 50) {
      idxClass = 'sev-medium';
    } else if (globalGovernanceIndex >= 30) {
      idxClass = 'sev-high';
    } else {
      idxClass = 'sev-critical';
    }

    const header = h(
      'div', { className: 'aig-header' },
      h('div', { className: 'aig-metric' },
        h('span', { className: 'aig-label' }, 'Governance Index'),
        h('span', { className: `aig-value ${idxClass}` }, `${globalGovernanceIndex}/100`),
      ),
      h('div', { className: 'aig-metric' },
        h('span', { className: 'aig-label' }, 'Active Frameworks'),
        h('span', { className: 'aig-value sev-low' }, String(activeFrameworkCount)),
      ),
      h('div', { className: 'aig-metric' },
        h('span', { className: 'aig-label' }, 'Legally Binding'),
        h('span', { className: 'aig-value sev-medium' }, String(bindingFrameworkCount)),
      ),
      h('div', { className: 'aig-metric' },
        h('span', { className: 'aig-label' }, 'Arms Race Risk'),
        h('span', { className: `aig-value ${riskClass(armsRaceRisk)}` }, armsRaceRisk.toUpperCase()),
      ),
      coverageGap
        ? h('div', { className: 'aig-gap-warning' }, '⚠ No binding global AI treaty')
        : h('div', { className: 'aig-gap-ok' }, '✓ Global coverage present'),
    );

    // ── Frameworks ──────────────────────────────────────────────────────────
    const frameworkSection = h('div', { className: 'aig-frameworks' },
      h('h3', { className: 'aig-section-title' }, 'Governance Frameworks'),
    );
    for (const fw of [...frameworks].sort((a, b) => b.governanceScore - a.governanceScore)) {
      const row = h(
        'div', { className: `aig-framework-row ${frameworkStatusClass(fw.status)}` },
        h('div', { className: 'aig-fw-header' },
          h('span', { className: 'aig-fw-name' }, fw.name),
          h('span', { className: `aig-status-badge ${frameworkStatusClass(fw.status)}` }, fw.status),
          h('span', { className: `aig-binding-badge ${bindingClass(fw.bindingNature)}` }, fw.bindingNature),
          h('span', { className: `aig-scope-badge ${scopeClass(fw.scope)}` }, fw.scope),
          h('span', { className: 'aig-fw-date' }, fw.date),
          h('span', { className: 'aig-fw-sigs' }, `${fw.signatories} signatories`),
          h('span', { className: `aig-fw-score ${riskClass('low')}` }, `Score: ${fw.governanceScore}`),
        ),
        h('div', { className: 'aig-fw-region' }, `Region: ${fw.region}`),
        h('div', { className: 'aig-fw-desc' }, fw.description),
        h('div', { className: 'aig-fw-provisions' }, `Key provisions: ${fw.keyProvisions.join('; ')}`),
      );
      frameworkSection.append(row);
    }

    // ── Military AI ─────────────────────────────────────────────────────────
    const militarySection = h('div', { className: 'aig-military' },
      h('h3', { className: 'aig-section-title' }, 'AI Arms Race Indicators'),
    );
    for (const prog of [...militaryPrograms].sort((a, b) => {
      const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      return (order[a.riskLevel] ?? 4) - (order[b.riskLevel] ?? 4);
    })) {
      const row = h(
        'div', { className: `aig-mil-row ${riskClass(prog.riskLevel)}` },
        h('div', { className: 'aig-mil-header' },
          h('span', { className: 'aig-mil-country' }, prog.country),
          h('span', { className: 'aig-mil-program' }, prog.programName),
          h('span', { className: `aig-risk-badge ${riskClass(prog.riskLevel)}` }, prog.riskLevel.toUpperCase()),
          h('span', { className: 'aig-mil-status' }, prog.status),
          h('span', { className: 'aig-laws-stance' }, `LAWS: ${prog.lawsStance}`),
        ),
        h('div', { className: 'aig-mil-cap' }, `Capabilities: ${prog.capability}`),
        h('div', { className: 'aig-mil-desc' }, prog.description),
        prog.computeConstraints
          ? h('div', { className: 'aig-compute-constrained' }, '⚠ Subject to compute export controls')
          : false,
      );
      militarySection.append(row);
    }

    // ── Benchmarks ──────────────────────────────────────────────────────────
    const benchmarkSection = h('div', { className: 'aig-benchmarks' },
      h('h3', { className: 'aig-section-title' }, 'Key Capability Benchmarks'),
    );
    for (const bm of benchmarks) {
      const row = h(
        'div', { className: `aig-bm-row ${riskClass(bm.impactLevel)}` },
        h('div', { className: 'aig-bm-header' },
          h('span', { className: 'aig-bm-name' }, bm.name),
          h('span', { className: `aig-bm-status aig-bm-${bm.status}` }, bm.status),
          h('span', { className: `aig-impact-badge ${riskClass(bm.impactLevel)}` }, bm.impactLevel.toUpperCase()),
        ),
        h('div', { className: 'aig-bm-desc' }, bm.description),
        h('div', { className: 'aig-bm-policy' }, `Policy response: ${bm.policyResponse}`),
      );
      benchmarkSection.append(row);
    }

    replaceChildren(
      this.getContentElement(),
      header,
      frameworkSection,
      militarySection,
      benchmarkSection,
    );
  }
}
