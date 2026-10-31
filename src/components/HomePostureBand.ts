import { projectView } from '@/services/survival/world-snapshot';
import { availableMoves } from '@/services/survival/survival-moves';
import { buildSurvivalOutlook } from '@/services/survival/survival-outlook';
import { buildSurvivalPostureBoardView } from '@/services/survival/survival-posture-view';
import type { WorldSnapshot } from '@/services/survival/survival-types';
import { bindStormMoveActions } from './StormMoveActions';

type PostureSelection = ReturnType<typeof HomePostureBand.select>;
type PostureAxisRow = PostureSelection['board']['rows'][number];

/** Presentation only: acquisition and the explicit commit remain with existing owners. */
export class HomePostureBand {
  private readonly headline = node('div', 'hs-band-headline');
  private readonly coverage = node('div', 'hs-band-stale');
  private readonly axes = node('ul', 'hs-posture-axes');
  private readonly moveTitle = node('div', 'hs-posture-move-title');
  private readonly moveDetail = node('div', 'hs-band-line');
  private readonly moveEffect = node('div', 'hs-band-stale');
  private readonly announcement = node('div', 'hs-posture-announcement');
  private readonly commit = document.createElement('button');
  private readonly evidence = document.createElement('button');
  private readonly unbindMoves: () => void;
  private readonly onEvidence: () => void;
  private selectedMove: ReturnType<typeof HomePostureBand.select>['move'];
  private semanticKey = '';
  private destroyed = false;

  constructor(readonly element: HTMLElement, callbacks: {
    openEvidence: () => void;
    commitMoveId: (id: string) => void;
  }) {
    const retainEvidenceFocus = element.querySelector('[data-action="posture-evidence"]') === document.activeElement;
    const actions = node('div', 'hs-posture-actions');
    this.commit.type = 'button';
    this.commit.textContent = 'Commit';
    this.evidence.type = 'button';
    this.evidence.textContent = 'Evidence and plan';
    this.onEvidence = callbacks.openEvidence;
    this.evidence.addEventListener('click', this.onEvidence);
    this.announcement.setAttribute('role', 'status');
    this.announcement.setAttribute('aria-live', 'polite');
    this.announcement.setAttribute('aria-atomic', 'true');
    actions.append(this.commit, this.evidence);
    element.replaceChildren(
      node('div', 'hs-band-label', 'Survival posture'),
      this.headline, this.coverage, this.axes, this.moveTitle,
      this.moveDetail, this.moveEffect, actions, this.announcement,
    );
    this.unbindMoves = bindStormMoveActions(element, {
      resolveMove: (id) => this.selectedMove?.id === id ? this.selectedMove : undefined,
      commitMove: (move) => callbacks.commitMoveId(move.id),
    });
    this.update(undefined, 0);
    if (retainEvidenceFocus) this.evidence.focus({ preventScroll: true });
  }

  static select(snapshot: WorldSnapshot, now: number) {
    const projected = projectView(snapshot, { now });
    const moves = availableMoves(snapshot.posture, snapshot, { now });
    const decision = buildSurvivalOutlook(snapshot, projected.posture, moves, { now }).decision;
    const board = buildSurvivalPostureBoardView(projected.posture, { maxAxes: 3 });
    const move = moves.find((candidate) => candidate.id === decision.recommendedMoveId);
    return { projected, moves, decision, board, move };
  }

  update(snapshot: WorldSnapshot | null | undefined, now: number): void {
    if (this.destroyed) return;
    this.selectedMove = undefined;
    if (!snapshot) {
      this.renderUnavailable(snapshot === undefined);
      return;
    }
    const selection = HomePostureBand.select(snapshot, now);
    this.renderPosture(snapshot, selection);
    this.renderAxes(snapshot, selection.board);
    this.renderMove(snapshot, selection);
  }

  private renderUnavailable(pending: boolean): void {
    this.commit.hidden = true;
    delete this.commit.dataset.stormMove;
    delete this.element.dataset.band;
    this.element.dataset.state = pending ? 'pending' : 'unavailable';
    this.headline.textContent = pending ? 'Checking saved posture…' : 'No posture snapshot available.';
    this.coverage.textContent = 'Source ages and coverage unknown.';
    this.axes.replaceChildren();
    this.moveTitle.textContent = '';
    this.moveDetail.textContent = '';
    this.moveEffect.textContent = '';
    this.announce(this.element.dataset.state, this.headline.textContent);
  }

  private renderPosture(snapshot: WorldSnapshot, { projected, board }: PostureSelection): void {
    const weather = snapshot.freshness.find((source) => source.domain === 'weather');
    const lastKnown = projected.isStale || board.staleInputs.length > 0 || weather?.ok === false;
    this.element.dataset.state = lastKnown ? 'last-known' : 'modeled';
    this.element.dataset.band = board.overallBand;
    this.headline.textContent = `${lastKnown ? 'Last-known modeled' : 'Modeled'} posture · ${board.overallBand}`;
    const weatherAge = HomePostureBand.weatherAgeLabel(weather, projected.weatherAgeMs);
    this.coverage.textContent = `Recorded weather: ${weatherAge}. Other domain source ages and coverage unknown; model-derived context may contribute.`;
  }

  private static weatherAgeLabel(weather: WorldSnapshot['freshness'][number] | undefined, ageMs: number): string {
    if (!weather || !Number.isFinite(ageMs) || ageMs < 0) return 'age unknown';
    const retrieval = weather.ok ? '' : ' · retrieval unconfirmed';
    return `${Math.floor(ageMs / 60_000)} min old${retrieval}`;
  }

  private renderAxes(snapshot: WorldSnapshot, board: PostureSelection['board']): void {
    this.axes.replaceChildren(...board.rows.map((row) => this.renderAxis(snapshot, row)));
    if (board.staleInputs.length) this.axes.append(node('li', 'hs-band-stale', `Stale inputs: ${board.staleInputs.slice(0, 3).join(', ')}`));
  }

  private renderAxis(snapshot: WorldSnapshot, row: PostureAxisRow): HTMLElement {
    const item = node('li', 'hs-posture-axis');
    const threat = row.leadThreat;
    let summary = 'No positive threats in this model; coverage remains unverified.';
    if (threat) {
      const arrival = threat.arrivalLabel || 'arrival window unknown';
      summary = `${threat.hazardLabel} · ${arrival} · ${threat.why}`;
    }
    item.append(node('div', 'hs-posture-axis-title', `${row.axisTitle} · ${row.band} · ${row.level}`), node('div', 'hs-band-line', summary));
    const references = snapshot.posture.axes.find((axis) => axis.axis === row.axis)?.threats
      .slice(0, 3).map((threat) => threat.sourceEventId.slice(0, 120));
    if (references?.length) item.append(node('div', 'hs-band-stale', `Source references: ${references.join(', ')}`));
    return item;
  }

  private renderMove(snapshot: WorldSnapshot, { decision, board, move }: PostureSelection): void {
    let title = 'Hold';
    if (decision.isEmpty) title = 'No modeled candidate';
    if (move) title = `Modeled best move · ${move.label}`;
    this.moveTitle.textContent = title;
    this.moveDetail.textContent = move ? move.detail : decision.headline;
    const committed = move && snapshot.plan.committed.find((entry) => entry.moveId === move.id);
    const row = move && decision.rows.find((entry) => entry.moveId === move.id);
    let effect = 'No additional action is inferred from missing evidence.';
    if (move) {
      const planStatus = committed ? `Plan status: ${committed.status}. ` : '';
      effect = `${planStatus}Modeled effect: ${row?.metric ?? 'see evidence'}. Planned actions change the model immediately; protection is not verified.`;
    }
    this.moveEffect.textContent = effect;
    this.selectedMove = move;
    this.commit.hidden = !move || !!committed;
    if (move && !committed) {
      this.commit.dataset.stormMove = move.id;
    } else {
      delete this.commit.dataset.stormMove;
    }
    const status = committed ? `. ${committed.status}` : '';
    const key = JSON.stringify([this.element.dataset.state, board.overallBand, move?.id, committed?.status, decision.isEmpty]);
    this.announce(key, `${this.headline.textContent}. ${this.moveTitle.textContent}${status}`);
  }

  destroy(): void {
    this.destroyed = true;
    this.unbindMoves();
    this.evidence.removeEventListener('click', this.onEvidence);
    this.selectedMove = undefined;
    this.commit.hidden = true;
    this.element.replaceChildren();
  }

  private announce(key: string, text: string): void {
    if (key === this.semanticKey) return;
    this.semanticKey = key;
    this.announcement.textContent = text;
  }
}

function node(tag: string, className: string, text = ''): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text.slice(0, 600);
  return element;
}
