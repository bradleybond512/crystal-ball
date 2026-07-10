import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  buildRenderData,
  complianceClass,
  attributionClass,
} from './cyber-norms-helpers';

const REFRESH_MS = 24 * 60 * 60 * 1000; // 24 hours

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

export class CyberNormsPanel extends Panel {
  static readonly panelId = 'cyber-norms';
  static readonly title = 'Cyber Norms & Governance';
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: CyberNormsPanel.panelId,
      title: CyberNormsPanel.title,
      showCount: true,
      trackActivity: false,
      infoTooltip:
        'Tracks international cyber norms frameworks, attribution of major state-sponsored operations (2021–2024), and compliance scores for key cyber powers. Covers 10 governance frameworks from UN GGE 2015 to Tallinn Manual 3.0 and 6 major incidents including Volt Typhoon, Salt Typhoon, and Sandworm.',
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

  // eslint-disable-next-line sonarjs/cognitive-complexity
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
      operations,
      complianceScores,
      activeFrameworkCount,
      highConfidenceOperationCount,
      ongoingOperationCount,
      globalNormsAdoptionScore,
      mostActiveActor,
      topViolatedFramework,
    } = data;

    this.setCount(ongoingOperationCount);

    let idxClass: string;
    if (globalNormsAdoptionScore >= 70) {
      idxClass = 'cn-status-active';
    } else if (globalNormsAdoptionScore >= 40) {
      idxClass = 'cn-status-contested';
    } else {
      idxClass = 'cn-status-stalled';
    }

    const header = h('div', { className: 'cn-header' },
      h('div', { className: 'cn-metric' },
        h('span', { className: 'cn-label' }, 'Norms Adoption'),
        h('span', { className: `cn-value ${idxClass}` }, `${globalNormsAdoptionScore}/100`),
      ),
      h('div', { className: 'cn-metric' },
        h('span', { className: 'cn-label' }, 'Active Frameworks'),
        h('span', { className: 'cn-value cn-status-active' }, String(activeFrameworkCount)),
      ),
      h('div', { className: 'cn-metric' },
        h('span', { className: 'cn-label' }, 'High-Conf Ops'),
        h('span', { className: 'cn-value cn-status-contested' }, String(highConfidenceOperationCount)),
      ),
      h('div', { className: 'cn-metric' },
        h('span', { className: 'cn-label' }, 'Ongoing Ops'),
        h('span', { className: 'cn-value cn-status-stalled' }, String(ongoingOperationCount)),
      ),
      ...(mostActiveActor
        ? [h('div', { className: 'cn-metric' },
            h('span', { className: 'cn-label' }, 'Most Active'),
            h('span', { className: 'cn-value cn-status-stalled' }, mostActiveActor),
          )]
        : []),
    );

    // ── Compliance Scores ──────────────────────────────────────────────────────
    const complianceSection = h('div', { className: 'cn-compliance' },
      h('h3', { className: 'cn-section-title' }, 'Norms Compliance by Actor'),
    );

    for (const cs of [...complianceScores].sort((a, b) => b.overallScore - a.overallScore)) {
      const row = h('div', { className: `cn-compliance-row ${complianceClass(cs.tier)}` },
        h('div', { className: 'cn-compliance-header' },
          h('span', { className: 'cn-actor-name' }, cs.actor),
          h('span', { className: `cn-tier-badge ${complianceClass(cs.tier)}` }, cs.tier),
          h('span', { className: 'cn-score' }, `${cs.overallScore}/100`),
        ),
        h('div', { className: 'cn-sub-scores' },
          h('span', {}, `Espionage: ${cs.espionageRestraint}/10`),
          h('span', {}, `CritInfra: ${cs.criticalInfraProtection}/10`),
          h('span', {}, `Norms: ${cs.normEngagement}/10`),
          h('span', {}, `Attribution: ${cs.responseToAttribution}/10`),
        ),
        h('div', { className: 'cn-actor-notes' }, cs.notes),
      );
      complianceSection.append(row);
    }

    // ── Major Operations ───────────────────────────────────────────────────────
    const opsSection = h('div', { className: 'cn-operations' },
      h('h3', { className: 'cn-section-title' }, 'Major State-Sponsored Operations'),
    );

    for (const op of [...operations].sort((a, b) => {
      const rank: Record<string, number> = { Confirmed: 4, High: 3, Moderate: 2, Low: 1, Unattributed: 0 };
      return (rank[b.attributionLevel] ?? 0) - (rank[a.attributionLevel] ?? 0);
    })) {
      let statusClass = 'cn-op-concluded';
      if (op.status === 'Ongoing') statusClass = 'cn-op-ongoing';
      else if (op.status === 'Disrupted') statusClass = 'cn-op-disrupted';

      const row = h('div', { className: `cn-op-row ${statusClass}` },
        h('div', { className: 'cn-op-header' },
          h('span', { className: 'cn-op-name' }, op.name),
          h('span', { className: `cn-attr-badge ${attributionClass(op.attributionLevel)}` }, op.attributionLevel),
          h('span', { className: 'cn-op-actor' }, op.attributedActor),
          h('span', { className: 'cn-op-type' }, op.operationType),
          h('span', { className: `cn-op-status ${statusClass}` }, op.status),
          h('span', { className: 'cn-op-year' }, op.year),
        ),
        h('div', { className: 'cn-op-impact' }, op.estimatedImpact),
        h('div', { className: 'cn-op-desc' }, op.description),
        h('div', { className: 'cn-op-violations' },
          `Norm violations: ${op.normViolations.join(' • ')}`,
        ),
      );
      opsSection.append(row);
    }

    // ── Governance Frameworks ──────────────────────────────────────────────────
    const frameworkSection = h('div', { className: 'cn-frameworks' },
      h('h3', { className: 'cn-section-title' }, 'International Governance Frameworks'),
      ...(topViolatedFramework
        ? [h('div', { className: 'cn-top-violated' }, `Most Implicated: ${topViolatedFramework}`)]
        : []),
    );

    for (const fw of [...frameworks].sort((a, b) => {
      const rank: Record<string, number> = { Active: 3, Emerging: 2, Contested: 1, Stalled: 0 };
      return (rank[b.status] ?? 0) - (rank[a.status] ?? 0);
    })) {
      let statusClass = 'cn-fw-stalled';
      if (fw.status === 'Active') statusClass = 'cn-fw-active';
      else if (fw.status === 'Contested') statusClass = 'cn-fw-contested';
      else if (fw.status === 'Emerging') statusClass = 'cn-fw-emerging';

      const row = h('div', { className: `cn-fw-row ${statusClass}` },
        h('div', { className: 'cn-fw-header' },
          h('span', { className: 'cn-fw-name' }, fw.shortName),
          h('span', { className: 'cn-fw-year' }, String(fw.year)),
          h('span', { className: `cn-fw-status ${statusClass}` }, fw.status),
          h('span', { className: 'cn-fw-type' }, fw.type),
          ...(fw.signatoryCount > 0
            ? [h('span', { className: 'cn-fw-sigs' }, `${fw.signatoryCount} parties`)]
            : []),
        ),
        h('div', { className: 'cn-fw-positions' },
          h('span', { className: 'cn-fw-us' }, `US: ${fw.usPosition}`),
          h('span', { className: 'cn-fw-cr' }, `China/Russia: ${fw.chinaRussiaPosition}`),
        ),
        h('div', { className: 'cn-fw-desc' }, fw.description),
        h('div', { className: 'cn-fw-significance' }, fw.geopoliticalSignificance),
      );
      frameworkSection.append(row);
    }

    replaceChildren(this.getContentElement(), header, complianceSection, opsSection, frameworkSection);
  }
}
