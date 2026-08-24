/**
 * Hypothesis Panel — shows competing explanations for the currently
 * most-critical active Situation.
 *
 * Selection rule: pick the highest-severity active Situation from
 * `SituationStoreV2.getActive()`; ties broken by most-recently-updated.
 * If no Situation is active, the panel renders a placeholder.
 *
 * The panel subscribes to both `SituationStoreV2` (so a new situation
 * triggers a refresh) and `HypothesisEngine` (so an updated set
 * triggers a refresh) — never polls.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  getSituationStoreV2,
  type Situation,
  type SituationSeverity,
} from '@/services/intelligence/situation-store-v2';
import {
  getHypothesisEngine,
  type Hypothesis,
  type HypothesisSet,
  type HypothesisStatus,
} from '@/services/intelligence/hypothesis-engine';

const SEVERITY_RANK: Record<SituationSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const STATUS_COLOR: Record<HypothesisStatus, string> = {
  leading: 'var(--severity-ok,#22c55e)',
  contending: 'var(--severity-medium,#facc15)',
  eliminated: 'var(--text-secondary,#888)',
};

const STATUS_LABEL: Record<HypothesisStatus, string> = {
  leading: 'LEADING',
  contending: 'CONTENDING',
  eliminated: 'ELIMINATED',
};

function rivalryBand(score: number): { label: string; color: string } {
  if (score >= 0.7) return { label: 'Competing', color: 'var(--severity-high,#f87171)' };
  if (score >= 0.3) return { label: 'Diverging', color: 'var(--severity-medium,#facc15)' };
  return { label: 'Converging', color: 'var(--severity-ok,#22c55e)' };
}

export class HypothesisPanel extends Panel {
  private unsubscribeSituations: (() => void) | null = null;
  private unsubscribeHypotheses: (() => void) | null = null;

  constructor() {
    super({
      id: 'competitive-hypothesis',
      title: 'Competing Hypotheses',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Bayesian competition between 2–3 explanations for the most critical active Situation. Designed to fight anchoring on the first plausible story.',
    });
    this.render();
    this.unsubscribeSituations = getSituationStoreV2().subscribeView(() => this.render());
    this.unsubscribeHypotheses = getHypothesisEngine().subscribe(() => this.render());
  }

  public override destroy(): void {
    this.unsubscribeSituations?.();
    this.unsubscribeSituations = null;
    this.unsubscribeHypotheses?.();
    this.unsubscribeHypotheses = null;
    super.destroy();
  }

  // ── Rendering ────────────────────────────────────────────────────

  private render(): void {
    try {
      const situation = this.pickActiveSituation();
      if (!situation) {
        this.setCount(0);
        this.setContent(this.renderEmpty());
        return;
      }
      const set = this.ensureHypothesisSet(situation);
      this.setCount(set.hypotheses.filter((h) => h.status !== 'eliminated').length);
      this.setContent(this.renderSituation(situation, set));
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical,#dc2626);font-size:12px;">Hypothesis render error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private pickActiveSituation(): Situation | undefined {
    const active = getSituationStoreV2().getActive();
    if (active.length === 0) return undefined;
    const sorted = [...active].sort((a, b) => {
      const sevDelta = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
      if (sevDelta !== 0) return sevDelta;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });
    return sorted[0];
  }

  private ensureHypothesisSet(situation: Situation): HypothesisSet {
    const engine = getHypothesisEngine();
    const existing = engine.getHypothesisSet(situation.id);
    if (existing) return existing;
    return engine.generateHypotheses(situation);
  }

  private renderEmpty(): string {
    return `<div style="padding:16px;display:flex;flex-direction:column;gap:10px;align-items:flex-start;font-size:12px;color:var(--text-secondary,#aaa);">
      <div style="font-size:13px;font-weight:600;color:var(--text-primary,#fff);">No active situation</div>
      <div>Select an active situation in the Command Center to see competing hypotheses.</div>
    </div>`;
  }

  private renderSituation(situation: Situation, set: HypothesisSet): string {
    return `<div style="padding:14px;display:flex;flex-direction:column;gap:14px;">
      ${this.renderHeader(situation)}
      ${this.renderConsensusBanner(set)}
      ${this.renderRivalryGauge(set)}
      ${this.renderHypothesesList(set.hypotheses)}
    </div>`;
  }

  private renderHeader(situation: Situation): string {
    const severityColor = STATUS_COLOR[situation.severity === 'low' ? 'eliminated' : 'leading'];
    return `<div>
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-secondary,#aaa);">Active situation</div>
      <div style="font-size:14px;font-weight:700;margin-top:2px;">${escapeHtml(situation.name)}</div>
      <div style="font-size:11px;color:${severityColor};margin-top:2px;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(situation.severity)} · ${escapeHtml(situation.status)} · ${situation.observations.length} observation${situation.observations.length === 1 ? '' : 's'}</div>
    </div>`;
  }

  private renderConsensusBanner(set: HypothesisSet): string {
    if (set.consensusReached) {
      return `<div style="padding:8px 10px;border-radius:4px;background:rgba(34,197,94,0.12);border-left:3px solid var(--severity-ok,#22c55e);font-size:12px;">
        <strong>Consensus reached.</strong> Leading hypothesis dominates the field; remaining alternatives are unlikely.
      </div>`;
    }
    return `<div style="padding:8px 10px;border-radius:4px;background:rgba(250,204,21,0.10);border-left:3px solid var(--severity-medium,#facc15);font-size:12px;">
      <strong>Still competing.</strong> Multiple explanations remain plausible — request more evidence before locking in a response.
    </div>`;
  }

  private renderRivalryGauge(set: HypothesisSet): string {
    const pct = Math.round(set.rivalryScore * 100);
    const { label, color } = rivalryBand(set.rivalryScore);
    return `<div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:11px;">
        <span style="color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">Rivalry</span>
        <span style="color:${color};font-weight:700;">${escapeHtml(label)} · ${pct}%</span>
      </div>
      <div style="height:6px;border-radius:3px;background:rgba(255,255,255,0.06);overflow:hidden;margin-top:4px;">
        <div style="width:${pct}%;height:100%;background:${color};"></div>
      </div>
    </div>`;
  }

  private renderHypothesesList(hypotheses: readonly Hypothesis[]): string {
    if (hypotheses.length === 0) {
      return '<div style="font-size:12px;color:var(--text-secondary,#aaa);">No hypotheses generated yet.</div>';
    }
    return `<div style="display:flex;flex-direction:column;gap:8px;">
      ${hypotheses.map((h) => this.renderHypothesisRow(h)).join('')}
    </div>`;
  }

  private renderHypothesisRow(h: Hypothesis): string {
    const color = STATUS_COLOR[h.status];
    const pct = Math.round(h.posteriorProbability * 100);
    const ciLow = Math.round(h.confidenceInterval[0] * 100);
    const ciHigh = Math.round(h.confidenceInterval[1] * 100);
    const eliminatedNote = h.eliminatedReason
      ? `<div style="font-size:10px;color:var(--text-secondary,#888);margin-top:4px;">${escapeHtml(h.eliminatedReason)}</div>`
      : '';
    return `<div style="padding:10px 12px;border:1px solid var(--border-subtle,#333);border-left:3px solid ${color};border-radius:4px;background:rgba(255,255,255,0.02);">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;">
        <strong style="font-size:13px;">${escapeHtml(h.label)}</strong>
        <span style="font-size:10px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(STATUS_LABEL[h.status])}</span>
      </div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:4px;">${escapeHtml(h.description)}</div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:11px;margin-top:8px;">
        <span><strong style="color:${color};">${pct}%</strong> posterior · 90% CI [${ciLow}–${ciHigh}%]</span>
        <span style="color:var(--text-secondary,#aaa);">${h.supportingObservationIds.length} for · ${h.contradictingObservationIds.length} against</span>
      </div>
      <div style="height:4px;border-radius:2px;background:rgba(255,255,255,0.06);overflow:hidden;margin-top:6px;">
        <div style="width:${pct}%;height:100%;background:${color};"></div>
      </div>
      ${eliminatedNote}
    </div>`;
  }
}
