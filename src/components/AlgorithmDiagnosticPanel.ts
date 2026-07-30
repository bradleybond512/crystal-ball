/* eslint-disable sonarjs/no-nested-template-literals */
/**
 * Algorithm Diagnostic Panel — Algorithm Self-Improvement PR 6 UI.
 *
 * Surfaces the Algorithm Health Aggregator + Safe Adjustment proposals
 * for each registered algorithm. Pure composition over the existing
 * pure-deterministic registries (PRs 2-4 of the plan).
 */

import { Panel } from './Panel';
import {
  getAlgorithmEvaluationLedger,
  getAlgorithmDefinitions,
} from '@/services/algorithms/algorithms-state';
import {
  aggregateAlgorithmHealth,
  type AlgorithmHealth,
  type AlgorithmHealthStatus,
} from '@/services/algorithms/algorithm-health';
import { summarizeCalibration } from '@/services/algorithms/algorithm-evaluation-ledger';
import { proposeAdjustments } from '@/services/algorithms/safe-adjustment';
import { getTunings } from '@/services/algorithms/tunable-params-store';
import {
  getTuningDecisions,
  type TuningDecision,
  type TuningDecisionKind,
} from '@/services/algorithms/tuning-decision-log';
import {
  gateAdjustmentProposal,
  type GatedProposal,
} from '@/services/governance/policy-gate';
import type { AlgorithmDefinition as HealthAlgorithmDefinition } from '@/services/algorithms/algorithm-health';
import type { PolicyDecision } from '@/services/governance/policy-engine';
import { escapeHtml } from '@/utils/sanitize';
import { getKindAccuracy } from '@/services/hypothesis-accuracy';
import { getChampionRegistry } from '@/services/cognition/champion-registry';
import { collectJoinedEvidence, RUN_IDS } from '@/services/cognition/shadow-rollout';
import {
  evaluatePromotionGate,
  safetyEvidenceFromBaselineRegression,
} from '@/services/cognition/promotion-gate';
import {
  buildChampionStatusView,
  type ChallengerRow,
  type ChallengerStatus,
  type ChampionStatusView,
} from '@/services/cognition/champion-status-view';
import { runReplay } from '@/services/ops/replay-harness';
import { buildCatalogReplayFixtures } from '@/services/ops/replay-fixtures-catalog';
import type { ReplayBaseline } from '@/services/ops/replay-baseline';
import panelReplayBaseline from '@/services/ops/replay-baseline.json';

const REFRESH_MS = 15_000;

const STATUS_COLOR: Record<AlgorithmHealthStatus, string> = {
  healthy: '#4caf50',
  degraded: '#ffeb3b',
  failing: '#ef4444',
  unsafe: '#ff453a',
  unknown: '#9e9e9e',
};

interface PolicyVerdictDisplay {
  label: string;
  color: string;
  background: string;
  helper: string;
}

const POLICY_DISPLAY: Record<PolicyDecision, PolicyVerdictDisplay> = {
  allow_auto: {
    label: 'Allowed automatically',
    color: '#4caf50',
    background: 'rgba(76,175,80,0.10)',
    helper: 'Policy gate cleared this proposal for local auto-apply.',
  },
  require_user_approval: {
    label: 'Needs user approval',
    color: '#ffb74d',
    background: 'rgba(255,183,77,0.10)',
    helper: 'Policy gate withholds auto-apply until you approve in-app.',
  },
  require_pr_review: {
    label: 'Needs PR review',
    color: '#4a9eff',
    background: 'rgba(74,158,255,0.10)',
    helper: 'Promotion / provider-config requires a PR with cross-agent review.',
  },
  deny: {
    label: 'Denied',
    color: '#ff453a',
    background: 'rgba(255, 69, 58,0.10)',
    helper: 'Safety-critical or fact-assertion change — never auto-applied.',
  },
};

export class AlgorithmDiagnosticPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'algorithm-diagnostic',
      title: 'Algorithm Diagnostic',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Hit-rate / latency / drift report for each algorithm. Surfaces safe-adjustment proposals — never auto-applied; always a recommendation.',
    });
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
  }

  public destroy(): void {
    // Clear timer BEFORE super.destroy() — the interval callback calls
    // renderWhenVisible() which writes to the panel's content element;
    // super.destroy() disconnects the IntersectionObserver and aborts the
    // AbortController, so a timer firing in that window would operate on a
    // partially-torn-down panel.  Every other subclass follows this order.
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private render(): void {
    const ledger = getAlgorithmEvaluationLedger();
    const definitions = getAlgorithmDefinitions();
    const calibrations = summarizeCalibration(ledger.all());
    const report = aggregateAlgorithmHealth({ definitions, calibrations });
    const proposals = proposeAdjustments({ reports: [...report.algorithms], tunings: getTunings() });
    const definitionsById = new Map<string, HealthAlgorithmDefinition>();
    for (const d of definitions) definitionsById.set(d.algorithmId, d);
    // Gate every proposal through the policy engine so the UI never
    // implies a proposal is auto-applyable when policy says otherwise.
    // Algorithms missing from the registry fail closed via policy-gate
    // (require_user_approval).
    const gatedById = new Map<string, GatedProposal>();
    for (const p of proposals) {
      const def = definitionsById.get(p.algorithmId);
      const cal = report.algorithms.find((a) => a.algorithmId === p.algorithmId)?.calibration;
      const gated = gateAdjustmentProposal({
        proposal: p,
        algorithm: def
          // Policy-gate's GateInput.algorithm uses the registry's
          // 'id' field; the health definition uses 'algorithmId'.
          // Adapt by constructing the picked shape directly.
          ? { id: def.algorithmId, criticality: def.criticality, domain: def.domain }
          : undefined,
        evidenceCount: cal?.graded ?? 0,
        // No replay/backtest harness wired into the live UI yet; treat
        // both as missing evidence so the gate stays conservative.
        replayPassed: false,
        backtestPassed: false,
      });
      gatedById.set(p.algorithmId, gated);
    }

    const concerning = report.algorithms.filter((a) => a.status !== 'healthy' && a.status !== 'unknown');
    this.setCount(concerning.length);

    const recHtml = report.recommendations.length === 0
      ? `<div style="font-size:12px;color:var(--text-secondary,#aaa);">No adjustments needed.</div>`
      : `<ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.5;">${report.recommendations.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`;

    const rows = [...report.algorithms]
      .sort((a, b) => severityRank(b.status) - severityRank(a.status) || a.algorithmId.localeCompare(b.algorithmId))
      .map((a) => this.renderRow(a, gatedById.get(a.algorithmId)))
      .join('');

    const html = `<div style="padding:12px;display:flex;flex-direction:column;gap:12px;">
      <div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">Overall</div>
        <div style="font-size:14px;font-weight:700;color:${STATUS_COLOR[report.status]};">${escapeHtml(report.status.toUpperCase())} — ${escapeHtml(report.summary)}</div>
      </div>
      <div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">Prediction Accuracy</div>
        ${renderPredictionAccuracy()}
      </div>
      <div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">Champion / Challenger</div>
        ${renderChampionChallenger()}
      </div>
      <div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">Recommendations</div>
        ${recHtml}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;">${rows}</div>
      <div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">Tuning history</div>
        ${renderTuningHistory(getTuningDecisions())}
      </div>
    </div>`;
    this.setContent(html);
  }

  private renderRow(a: AlgorithmHealth, gated: GatedProposal | undefined): string {
    const color = STATUS_COLOR[a.status];
    const cal = a.calibration;
    const calStr = cal
      ? `n=${cal.graded} · hit ${(cal.hitRate * 100).toFixed(0)}% · weighted ${(cal.weightedHitRate * 100).toFixed(0)}% · ${cal.meanDurationMs.toFixed(0)} ms`
      : 'no graded samples';
    const criticalBadge = renderCriticalityBadge(a.criticality);
    const proposalHtml = renderProposalHtml(gated);
    return `<div style="border:1px solid var(--border-subtle,#333);border-radius:4px;padding:8px 10px;">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-weight:600;">${escapeHtml(a.label)}</span>
          ${criticalBadge}
        </div>
        <span style="font-size:10px;color:${color};text-transform:uppercase;">${escapeHtml(a.status)}</span>
      </div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:4px;font-family:ui-monospace,monospace;">${escapeHtml(calStr)}</div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:3px;">${escapeHtml(a.reason)}</div>
      ${a.recommendedAdjustment ? `<div style="font-size:11px;color:#ff9800;margin-top:3px;">→ ${escapeHtml(a.recommendedAdjustment)}</div>` : ''}
      ${proposalHtml}
    </div>`;
  }
}

// ── ACC-403: champion/challenger status surface ──────────────────────

/** The forecast slot the first ACC-404 promotion decision will govern. */
const CHAMPION_SLOT = 'forecast-primary';

/** Shadow runs surfaced as challengers. Superforecast pairs carry no
 *  join keys yet, so it honestly reads insufficient-evidence until its
 *  producer emits them. */
const CHALLENGER_RUNS = [
  { runId: RUN_IDS.SUPERFORECAST, challengerId: 'superforecast' },
  { runId: RUN_IDS.BASELINE_HIERARCHICAL, challengerId: 'hierarchical-base-rate' },
  { runId: RUN_IDS.BASELINE_PERSISTENCE, challengerId: 'persistence-baseline' },
  { runId: RUN_IDS.BASELINE_MOMENTUM, challengerId: 'momentum-baseline' },
] as const;

const CHALLENGER_STATUS_DISPLAY: Record<ChallengerStatus, { label: string; color: string }> = {
  promotable: { label: 'PROMOTABLE', color: 'var(--status-ok, #4caf50)' },
  rejected: { label: 'REJECTED', color: 'var(--status-error, #ff453a)' },
  'insufficient-evidence': { label: 'INSUFFICIENT EVIDENCE', color: 'var(--status-warn, #ff9800)' },
};

function composeChampionStatus(): ChampionStatusView {
  const registry = getChampionRegistry();
  const active = registry.getActiveChampion(CHAMPION_SLOT);
  const fixtures = buildCatalogReplayFixtures();
  // ACC-404 correction: the catalog fixtures are intentionally-failing
  // historical-miss cases — the safety gate consumes NO-NEW-REGRESSIONS
  // vs the committed baseline, never their raw pass rate.
  const safety = safetyEvidenceFromBaselineRegression(
    runReplay({ fixtures }),
    fixtures,
    panelReplayBaseline as ReplayBaseline,
  );
  const incumbentId = active?.modelId ?? 'production';
  const challengers = CHALLENGER_RUNS.map(({ runId, challengerId }) => {
    const pairs = collectJoinedEvidence(runId);
    const decision = evaluatePromotionGate({
      challengerId,
      incumbentId,
      pairs,
      // No per-domain deployment floors declared yet — the overall
      // 200-pair floor still applies. ACC-404 declares domains when the
      // first promotion decision is made.
      enabledDomains: [],
      safety,
      evaluatedAt: Date.now(),
    });
    return { runId, challengerId, pairs, decision };
  });
  return buildChampionStatusView({
    slot: CHAMPION_SLOT,
    ...(active === undefined ? {} : { active }),
    history: registry.getHistory(CHAMPION_SLOT),
    challengers,
  });
}

function renderChampionChallenger(): string {
  let view: ChampionStatusView;
  try {
    view = composeChampionStatus();
  } catch {
    return `<div style="font-size:12px;color:var(--text-secondary,#aaa);">Champion status unavailable.</div>`;
  }
  let championHtml = `<div style="font-size:12px;color:var(--text-secondary,#aaa);">No champion installed in '${escapeHtml(view.slot)}' — awaiting the first evidence-backed promotion decision (ACC-404).</div>`;
  if (view.championId) {
    const versionHtml = view.championVersion
      ? ` <span style="color:var(--text-secondary,#aaa);">v${escapeHtml(view.championVersion)}</span>`
      : '';
    const reasonHtml = view.championActivationReason
      ? `<div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:2px;">${escapeHtml(view.championActivationReason)}</div>`
      : '';
    championHtml = `<div style="font-size:12px;"><strong>${escapeHtml(view.championId)}</strong>${versionHtml} <span style="color:var(--text-secondary,#aaa);">— active champion of ${escapeHtml(view.slot)}</span></div>
       ${reasonHtml}`;
  }
  const challengerHtml = view.challengers.map((c) => renderChallengerCard(c)).join('');
  const activityHtml = view.recentActivity.length === 0
    ? ''
    : `<div style="margin-top:6px;">
        <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:3px;">Recent activity</div>
        ${view.recentActivity.map((a) => `<div style="font-size:11px;color:var(--text-secondary,#aaa);">${escapeHtml(new Date(a.at).toLocaleString())} — ${escapeHtml(a.summary)}</div>`).join('')}
      </div>`;
  return `<div style="display:flex;flex-direction:column;gap:6px;">
    ${championHtml}
    ${challengerHtml}
    ${activityHtml}
  </div>`;
}

function renderChallengerCard(c: ChallengerRow): string {
  const display = CHALLENGER_STATUS_DISPLAY[c.status];
  const domains = Object.entries(c.perDomainCounts)
    .map(([d, n]) => `${d}: ${n}`)
    .join(' · ');
  const evidenceStr = `${c.evidenceCount} joined pairs${domains ? ` (${domains})` : ''}`
    + (c.proxyShare > 0 ? ` · ${(c.proxyShare * 100).toFixed(0)}% proxy-resolved` : '');
  const deltasHtml = c.deltas.map((d) =>
    `<div style="font-size:10px;color:${d.better ? 'var(--status-ok, #4caf50)' : 'var(--text-secondary,#aaa)'};font-family:ui-monospace,monospace;">${escapeHtml(d.explanation)}</div>`,
  ).join('');
  const reasonsHtml = c.reasons.slice(0, 4).map((r) =>
    `<li>${escapeHtml(r)}</li>`,
  ).join('');
  return `<div style="border:1px solid var(--border-subtle,#333);border-radius:4px;padding:6px 8px;">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
      <span style="font-size:12px;font-weight:600;">${escapeHtml(c.challengerId)}</span>
      <span style="font-size:9px;color:${display.color};font-weight:700;letter-spacing:0.05em;">${display.label}</span>
    </div>
    <div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:2px;font-family:ui-monospace,monospace;">${escapeHtml(evidenceStr)}</div>
    ${deltasHtml}
    ${c.reasons.length > 0 ? `<ul style="margin:3px 0 0;padding-left:16px;font-size:10px;color:var(--text-secondary,#aaa);">${reasonsHtml}</ul>` : ''}
  </div>`;
}

function renderPredictionAccuracy(): string {
  const kindAccuracy = getKindAccuracy();
  if (kindAccuracy.size === 0) {
    return `<div style="font-size:12px;color:var(--text-secondary,#aaa);">No graded predictions yet.</div>`;
  }
  const rows = [...kindAccuracy.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, stats]) => {
      const total = stats.hits + stats.misses;
      const hitRate = total > 0 ? stats.hits / total : 0;
      const pct = (hitRate * 100).toFixed(0);
      let color = '#ff453a';
      if (hitRate >= 0.7) color = '#4caf50';
      else if (hitRate >= 0.4) color = '#ffb74d';
      return `<div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;padding:3px 0;border-bottom:1px solid var(--border-subtle,#333);">
        <span style="font-family:ui-monospace,monospace;">${escapeHtml(kind)}</span>
        <span style="color:var(--text-secondary,#aaa);">${escapeHtml(String(stats.hits))} hits / ${escapeHtml(String(stats.misses))} misses</span>
        <span style="font-weight:700;color:${color};">${escapeHtml(pct)}%</span>
      </div>`;
    }).join('');
  return `<div style="display:flex;flex-direction:column;">${rows}</div>`;
}

function renderProposalHtml(gated: GatedProposal | undefined): string {
  if (!gated) return '';
  const proposal = gated.proposal;
  if (proposal.verdict === 'noop' || proposal.verdict === 'no_tunable') return '';

  const display = POLICY_DISPLAY[gated.verdict.decision];
  const effect = proposal.predictedEffect
    ? `<div style="margin-top:3px;color:var(--text-secondary,#aaa);">${escapeHtml(proposal.predictedEffect)}</div>`
    : '';
  // Required-evidence list — explains *why* a proposal isn't auto-applyable.
  const requiredHtml = gated.verdict.requiredEvidence.length === 0
    ? ''
    : `<div style="margin-top:6px;font-size:10px;color:var(--text-secondary,#aaa);">
         <strong style="color:${display.color};">Required evidence:</strong>
         <ul style="margin:2px 0 0;padding-left:16px;">
           ${gated.verdict.requiredEvidence.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}
         </ul>
       </div>`;

  return `<div data-policy-decision="${escapeHtml(gated.verdict.decision)}" style="font-size:11px;margin-top:6px;padding:6px 8px;background:${display.background};border-radius:3px;border-left:3px solid ${display.color};">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
      <strong style="color:${display.color};">${escapeHtml(display.label)}</strong>
      <span style="font-size:9px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(proposal.verdict)}</span>
    </div>
    <div style="margin-top:3px;">${escapeHtml(proposal.rationale)}</div>
    ${effect}
    <div style="margin-top:4px;font-size:10px;color:var(--text-secondary,#aaa);font-style:italic;">${escapeHtml(display.helper)}</div>
    ${requiredHtml}
  </div>`;
}

const TUNING_KIND_DISPLAY: Record<TuningDecisionKind, { label: string; color: string; background: string }> = {
  applied: { label: 'APPLIED', color: '#4caf50', background: 'rgba(76,175,80,0.10)' },
  held_for_approval: { label: 'HELD', color: '#ffb74d', background: 'rgba(255,183,77,0.10)' },
};

function formatTuningWhen(at: number): string {
  if (!Number.isFinite(at)) return '';
  try {
    return new Date(at).toLocaleString();
  } catch {
    return '';
  }
}

/** Render the most-recent tuning decisions (applied / held) as an audit
 *  trail. Read-only — the loop writes this log; the panel only displays it. */
function renderTuningHistory(decisions: readonly TuningDecision[]): string {
  if (decisions.length === 0) {
    return `<div style="font-size:12px;color:var(--text-secondary,#aaa);">No tuning decisions recorded yet.</div>`;
  }
  const rows = decisions.slice(0, 8).map((d) => {
    const kind = TUNING_KIND_DISPLAY[d.kind];
    const when = formatTuningWhen(d.at);
    const change = `${d.algorithmId}.${d.parameterId}: ${formatTuningValue(d.priorValue)} → ${formatTuningValue(d.nextValue)}`;
    return `<div style="font-size:11px;border-left:3px solid ${kind.color};background:${kind.background};border-radius:3px;padding:4px 8px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
        <span style="font-family:ui-monospace,monospace;">${escapeHtml(change)}</span>
        <span style="font-size:9px;color:${kind.color};font-weight:700;letter-spacing:0.05em;">${kind.label}</span>
      </div>
      <div style="margin-top:2px;color:var(--text-secondary,#aaa);">${escapeHtml(d.reason)}</div>
      ${when ? `<div style="margin-top:2px;font-size:9px;color:var(--text-secondary,#777);">${escapeHtml(when)}</div>` : ''}
    </div>`;
  }).join('');
  return `<div style="display:flex;flex-direction:column;gap:4px;">${rows}</div>`;
}

function formatTuningValue(value: number): string {
  return Number.isFinite(value) ? String(value) : '?';
}

function renderCriticalityBadge(criticality: string): string {
  if (criticality === 'safety') {
    return `<span style="font-size:9px;padding:1px 4px;background:#ff453a;color:#fff;border-radius:2px;margin-left:6px;">SAFETY</span>`;
  }
  if (criticality === 'high') {
    return `<span style="font-size:9px;padding:1px 4px;background:#ff9800;color:#000;border-radius:2px;margin-left:6px;">HIGH</span>`;
  }
  return '';
}

function severityRank(s: AlgorithmHealthStatus): number {
  switch (s) {
    case 'healthy': {
      return 0;
    }
    case 'unknown': {
      return 1;
    }
    case 'degraded': {
      return 2;
    }
    case 'failing': {
      return 3;
    }
    case 'unsafe': {
      return 4;
    }
  }
}
