/* eslint-disable sonarjs/no-nested-template-literals */
/**
 * Multi-Agent Review Panel — Phase 4 cross-perspective consensus UI.
 *
 * Picks the most-recently-updated active Situation from
 * SituationStoreV2, runs the six analytical lenses against it via the
 * MultiAgentReviewService, and renders the consensus header + a card
 * per perspective. Divergent perspectives are highlighted so the
 * operator can see at a glance where the lenses pull apart.
 */

import { Panel } from './Panel';
import {
  getMultiAgentReviewService,
  type AgentPerspective,
  type AgentReview,
  type MultiAgentConsensus,
} from '@/services/intelligence/multi-agent-review';
import { getSituationStoreV2, type Situation } from '@/services/intelligence/situation-store-v2';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30_000;

const PERSPECTIVE_ICON: Record<AgentPerspective, string> = {
  skeptic: '🔍',
  'devil-advocate': '😈',
  'data-quality': '📊',
  geopolitical: '🌍',
  historical: '📚',
  'worst-case': '⚠️',
};

const PERSPECTIVE_LABEL: Record<AgentPerspective, string> = {
  skeptic: 'Skeptic',
  'devil-advocate': "Devil's Advocate",
  'data-quality': 'Data Quality',
  geopolitical: 'Geopolitical',
  historical: 'Historical',
  'worst-case': 'Worst Case',
};

const AGREE_COLOR = '#4caf50';
const DISAGREE_COLOR = '#ff453a';

export class MultiAgentReviewPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsub: (() => void) | null = null;

  constructor() {
    super({
      id: 'multi-agent-review',
      title: 'Multi-Agent Review',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Phase 4 cross-perspective consensus. Six analytical lenses (skeptic, devil\'s advocate, data quality, geopolitical, historical, worst case) review the leading Situation and agree or dissent. Agreement rate >70% recommends "proceed"; otherwise "review with additional data".',
    });
    this.start();
  }

  private start(): void {
    this.evaluateAndRender();
    this.refreshTimer = setInterval(() => this.evaluateAndRender(), REFRESH_MS);
    this.unsub = getMultiAgentReviewService().subscribe(() => this.render());
  }

  public destroy(): void {
    super.destroy();
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
  }

  private pickActiveSituation(): Situation | undefined {
    const active = getSituationStoreV2().getActive();
    if (active.length === 0) return undefined;
    // Newest-updated first so the panel reflects the user's current
    // attention focus rather than a stale active record.
    const sorted = [...active];
    sorted.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return sorted[0];
  }

  private evaluateAndRender(): void {
    const situation = this.pickActiveSituation();
    if (situation) {
      getMultiAgentReviewService().reviewSituation(situation);
    }
    this.render();
  }

  private render(): void {
    const situation = this.pickActiveSituation();
    if (!situation) {
      this.setCount(0);
      this.setContent(`<div style="padding:12px;font-size:12px;color:var(--text-secondary,#aaa);">
        No active Situation to review. The multi-agent review runs against the most-recently-updated <code>active</code> Situation from the store; ingest cross-domain correlations to populate one.
      </div>`);
      return;
    }
    const consensus = getMultiAgentReviewService().getConsensus(situation.id);
    if (!consensus) {
      this.setCount(0);
      this.setContent(`<div style="padding:12px;font-size:12px;color:var(--text-secondary,#aaa);">Reviewing…</div>`);
      return;
    }
    // Panel count: number of dissenting perspectives.
    this.setCount(consensus.divergentPerspectives.length);

    const html = `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      ${renderConsensusHeader(situation, consensus)}
      ${renderPerspectivesGrid(consensus)}
      ${renderConsensusSummary(consensus)}
    </div>`;
    this.setContent(html);
    this.wireReevaluateButton();
  }

  private wireReevaluateButton(): void {
    setTimeout(() => {
      const btn = this.content.querySelector<HTMLButtonElement>('#multiAgentReevalBtn');
      btn?.addEventListener('click', () => this.evaluateAndRender());
    }, 0);
  }
}

function actionBadgeColor(agreementRate: number): string {
  if (agreementRate > 0.7) return AGREE_COLOR;
  if (agreementRate < 0.5) return DISAGREE_COLOR;
  return '#ffb74d';
}

function actionLabel(agreementRate: number): string {
  if (agreementRate > 0.7) return 'PROCEED';
  if (agreementRate < 0.5) return 'DISSENT';
  return 'REVIEW';
}

function renderConsensusHeader(situation: Situation, consensus: MultiAgentConsensus): string {
  const ratePct = (consensus.agreementRate * 100).toFixed(0);
  const color = actionBadgeColor(consensus.agreementRate);
  return `<div>
    <div style="display:flex;align-items:flex-start;gap:12px;">
      <div style="flex:1;">
        <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">Reviewing</div>
        <div style="font-size:14px;font-weight:700;margin-top:2px;">${escapeHtml(situation.name)}</div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:2px;">${escapeHtml(situation.domain)} · severity ${escapeHtml(situation.severity)}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;padding:4px 10px;border-radius:3px;background:${color}26;color:${color};display:inline-block;">${actionLabel(consensus.agreementRate)}</div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:4px;font-family:ui-monospace,monospace;">${ratePct}% agree</div>
      </div>
    </div>
    ${renderGauge(consensus.agreementRate)}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
      <div style="font-size:12px;color:var(--text-primary,#fff);">${escapeHtml(consensus.recommendedAction)}</div>
      <button id="multiAgentReevalBtn" style="padding:4px 10px;background:transparent;color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;font-size:11px;">Re-evaluate</button>
    </div>
  </div>`;
}

function renderGauge(rate: number): string {
  const fill = Math.max(0, Math.min(100, rate * 100));
  const color = actionBadgeColor(rate);
  return `<div style="margin-top:8px;height:8px;background:var(--surface-2,#1a1a1a);border-radius:4px;position:relative;overflow:hidden;">
    <div style="position:absolute;left:70%;top:0;bottom:0;width:1px;background:rgba(255,255,255,0.3);" title="proceed threshold"></div>
    <div style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:rgba(255,255,255,0.15);" title="divergent threshold"></div>
    <div style="height:100%;width:${fill.toFixed(1)}%;background:${color};transition:width 200ms ease;"></div>
  </div>`;
}

function renderPerspectivesGrid(consensus: MultiAgentConsensus): string {
  const cards = consensus.reviews.map((r) => renderPerspectiveCard(r)).join('');
  return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px;">${cards}</div>`;
}

function renderPerspectiveCard(r: AgentReview): string {
  const icon = PERSPECTIVE_ICON[r.perspective];
  const label = PERSPECTIVE_LABEL[r.perspective];
  const color = r.agreedWithLeading ? AGREE_COLOR : DISAGREE_COLOR;
  const verdictLabel = r.agreedWithLeading ? 'AGREE' : 'DISSENT';
  const altBlock = r.alternativeLabel
    ? `<div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:4px;">alt: <span style="color:var(--text-primary,#fff);">${escapeHtml(r.alternativeLabel)}</span></div>`
    : '';
  const biasBlock = r.flaggedBiases && r.flaggedBiases.length > 0
    ? `<div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:4px;">flagged: ${r.flaggedBiases.map((b) => escapeHtml(b)).join(', ')}</div>`
    : '';
  return `<div style="border-left:3px solid ${color};border-radius:4px;background:var(--surface-2,#1a1a1a);padding:8px 10px;">
    <div style="display:flex;align-items:center;gap:6px;">
      <span style="font-size:14px;">${icon}</span>
      <span style="font-weight:600;font-size:12px;flex:1;">${escapeHtml(label)}</span>
      <span style="font-size:10px;font-weight:700;letter-spacing:0.05em;color:${color};">${verdictLabel}</span>
    </div>
    <div style="font-size:11px;color:var(--text-primary,#fff);margin-top:6px;line-height:1.45;">${escapeHtml(r.assessment)}</div>
    <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:6px;font-style:italic;line-height:1.4;">${escapeHtml(r.keyInsight)}</div>
    ${altBlock}
    ${biasBlock}
  </div>`;
}

function renderConsensusSummary(consensus: MultiAgentConsensus): string {
  return `<div>
    <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Summary</div>
    <div style="font-size:12px;color:var(--text-primary,#fff);line-height:1.5;">${escapeHtml(consensus.consensusSummary)}</div>
  </div>`;
}
