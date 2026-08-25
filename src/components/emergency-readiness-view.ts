import type { VerifiedLifelinesReceipt } from '@/services/lifelines/lifeline-runtime.ts';
import { resolveCommsFallback } from '@/services/survival/comms-fallback.ts';
import { buildCommsFallbackBoardView } from '@/services/survival/comms-fallback-view.ts';
import {
  certifyGridDown,
  DEFAULT_BLIND_AFTER_MS,
} from '@/services/survival/grid-down-certify.ts';
import { buildGridDownBoardView } from '@/services/survival/grid-down-certify-view.ts';
import { resolveOfflinePlaybook } from '@/services/survival/offline-playbook.ts';
import { buildOfflinePlaybookBoardView } from '@/services/survival/offline-playbook-view.ts';
import type { WorldSnapshot } from '@/services/survival/survival-types.ts';
import { escapeHtml } from '@/utils/sanitize.ts';
import { MAX_LIFELINE_EXPIRY_TIMER_DELAY_MS } from './lifeline-evidence-expiry.ts';

export type EmergencyReadinessStatus = 'ready' | 'degraded' | 'expired' | 'unavailable';
export type EmergencyReadinessCardId = 'grid-down' | 'offline-playbook' | 'comms-fallback' | 'lifelines';

export interface EmergencyReadinessCard {
  id: EmergencyReadinessCardId;
  title: string;
  status: EmergencyReadinessStatus;
  headline: string;
  detail: string;
  capturedAtMs: number | null;
  expiresAtMs: number | null;
  expirySemantics: 'deadline' | 'independent-none' | 'recorded-none' | 'unavailable';
}

export interface EmergencyReadinessView {
  cards: [EmergencyReadinessCard, EmergencyReadinessCard, EmergencyReadinessCard, EmergencyReadinessCard];
  deadlinesMs: number[];
  liveMessage: string;
}

export interface EmergencyReadinessLifelinesInput {
  placeLabel: string;
  receipt: VerifiedLifelinesReceipt | null;
}

interface EmergencyReadinessProjectionOptions {
  now?: number;
}

function gridExpiry(snapshot: WorldSnapshot): number {
  const weatherFetchedAt = snapshot.freshness.find((item) => item.domain === 'weather')?.fetchedAtMs;
  const earliestCapture = Number.isFinite(weatherFetchedAt)
    ? Math.min(snapshot.capturedAtMs, weatherFetchedAt as number)
    : snapshot.capturedAtMs;
  return earliestCapture + DEFAULT_BLIND_AFTER_MS;
}

function unavailableCard(
  id: EmergencyReadinessCardId,
  title: string,
  detail: string,
): EmergencyReadinessCard {
  return {
    id,
    title,
    status: 'unavailable',
    headline: 'No restored survival snapshot',
    detail,
    capturedAtMs: null,
    expiresAtMs: null,
    expirySemantics: 'unavailable',
  };
}

function snapshotCards(snapshot: WorldSnapshot, now: number): [
  EmergencyReadinessCard,
  EmergencyReadinessCard,
  EmergencyReadinessCard,
] {
  const certification = certifyGridDown(snapshot, { now });
  const gridView = buildGridDownBoardView(certification);
  const gridStatus: EmergencyReadinessStatus = certification.certified && certification.staleAxes.length === 0
    ? 'ready'
    : 'degraded';
  const playbook = buildOfflinePlaybookBoardView(resolveOfflinePlaybook(snapshot));
  const comms = buildCommsFallbackBoardView(resolveCommsFallback(snapshot));
  const playbookAreaLabel = playbook.cards.length === 1 ? 'area' : 'areas';
  const playbookDetail = playbook.isEmpty
    ? 'No offline action is required by the restored posture.'
    : `${playbook.cards.length} elevated capability ${playbookAreaLabel} staged.`;
  const commsRungLabel = comms.viableCount === 1 ? 'rung' : 'rungs';
  const commsDetail = comms.recommendedMethod
    ? `Use ${comms.recommendedMethod}; ${comms.viableCount} viable ${commsRungLabel}.`
    : 'No recommended transmit rung is available.';
  return [
    {
      id: 'grid-down',
      title: 'Grid-down certification',
      status: gridStatus,
      headline: gridView.headline,
      detail: gridView.statusSummary || 'No axis verdicts are available.',
      capturedAtMs: snapshot.capturedAtMs,
      expiresAtMs: gridExpiry(snapshot),
      expirySemantics: 'deadline',
    },
    {
      id: 'offline-playbook',
      title: 'Offline playbook',
      status: playbook.unresolvedCount > 0 ? 'degraded' : 'ready',
      headline: playbook.headline,
      detail: playbookDetail,
      capturedAtMs: snapshot.capturedAtMs,
      expiresAtMs: null,
      expirySemantics: 'independent-none',
    },
    {
      id: 'comms-fallback',
      title: 'Comms fallback',
      status: comms.recommendedMethod ? 'ready' : 'degraded',
      headline: comms.headline,
      detail: commsDetail,
      capturedAtMs: snapshot.capturedAtMs,
      expiresAtMs: null,
      expirySemantics: 'independent-none',
    },
  ];
}

function lifelinesCard(input: EmergencyReadinessLifelinesInput | null): EmergencyReadinessCard {
  if (!input?.receipt) {
    return {
      id: 'lifelines',
      title: 'Lifelines snapshot',
      status: 'unavailable',
      headline: 'No verified Lifelines receipt',
      detail: input?.placeLabel
        ? `${input.placeLabel} has no exact saved Lifelines artifact.`
        : 'Save a primary place to verify an exact Lifelines snapshot receipt.',
      capturedAtMs: null,
      expiresAtMs: null,
      expirySemantics: 'unavailable',
    };
  }
  return {
    id: 'lifelines',
    title: 'Lifelines snapshot',
    status: input.receipt.isExpired ? 'expired' : 'ready',
    headline: input.receipt.isExpired ? 'Verified receipt expired' : 'Verified exact-place receipt',
    detail: `${input.placeLabel} Lifelines snapshot receipt.`,
    capturedAtMs: input.receipt.capturedAt.getTime(),
    expiresAtMs: input.receipt.expiresAt?.getTime() ?? null,
    expirySemantics: input.receipt.expiresAt ? 'deadline' : 'recorded-none',
  };
}

export function projectEmergencyReadiness(
  snapshot: WorldSnapshot | null,
  lifelines: EmergencyReadinessLifelinesInput | null,
  options: EmergencyReadinessProjectionOptions = {},
): EmergencyReadinessView {
  const now = Number.isFinite(options.now) ? (options.now as number) : Date.now();
  const baseCards = snapshot
    ? snapshotCards(snapshot, now)
    : [
      unavailableCard('grid-down', 'Grid-down certification', 'Restore a valid snapshot to check offline visibility.'),
      unavailableCard('offline-playbook', 'Offline playbook', 'Restore a valid snapshot to stage offline actions.'),
      unavailableCard('comms-fallback', 'Comms fallback', 'Restore a valid snapshot to resolve the fallback ladder.'),
    ] as const;
  const cards: EmergencyReadinessView['cards'] = [...baseCards, lifelinesCard(lifelines)];
  const deadlinesMs = cards.flatMap((card) => {
    if (card.expiresAtMs === null || !Number.isFinite(card.expiresAtMs)) return [];
    const transitionAt = card.id === 'grid-down' ? card.expiresAtMs + 1 : card.expiresAtMs;
    return transitionAt > now ? [transitionAt] : [];
  });
  return {
    cards,
    deadlinesMs,
    liveMessage: cards.map((card) => `${card.title}: ${card.status}.`).join(' '),
  };
}

function statusLabel(status: EmergencyReadinessStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function timeMarkup(value: number | null, emptyLabel: string): string {
  if (value === null || !Number.isFinite(value)) return `<span>${escapeHtml(emptyLabel)}</span>`;
  const iso = new Date(value).toISOString();
  return `<time datetime="${escapeHtml(iso)}">${escapeHtml(iso.replace('T', ' ').replace('.000Z', ' UTC'))}</time>`;
}

function expiryMarkup(card: EmergencyReadinessCard): string {
  if (card.expirySemantics === 'independent-none') return '<span>No independent expiry</span>';
  if (card.expirySemantics === 'recorded-none') return '<span>No recorded expiry</span>';
  return timeMarkup(card.expiresAtMs, 'Unavailable');
}

function renderCard(card: EmergencyReadinessCard): string {
  return `<article class="emergency-readiness-card emergency-readiness-card--${escapeHtml(card.status)}" data-readiness-card="${escapeHtml(card.id)}">
    <h3>${escapeHtml(card.title)}</h3>
    <p class="emergency-readiness-card__headline">${escapeHtml(card.headline)}</p>
    <p class="emergency-readiness-card__detail">${escapeHtml(card.detail)}</p>
    <dl>
      <div><dt>Status</dt><dd>${escapeHtml(statusLabel(card.status))}</dd></div>
      <div><dt>Captured</dt><dd>${timeMarkup(card.capturedAtMs, 'Unavailable')}</dd></div>
      <div><dt>Expiry</dt><dd>${expiryMarkup(card)}</dd></div>
    </dl>
  </article>`;
}

export function renderEmergencyReadiness(view: EmergencyReadinessView): string {
  return `<section class="emergency-readiness" aria-labelledby="emergency-readiness-heading">
    <h2 id="emergency-readiness-heading" class="sr-only">Emergency readiness capabilities</h2>
    <p class="emergency-readiness__live sr-only" aria-live="polite" aria-atomic="true">${escapeHtml(view.liveMessage)}</p>
    <div class="emergency-readiness__grid">${view.cards.map((card) => renderCard(card)).join('')}</div>
  </section>`;
}

interface EmergencyReadinessDeadlineSchedulerOptions {
  onDeadline: () => void;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

export class EmergencyReadinessDeadlineScheduler {
  private readonly onDeadline: () => void;
  private readonly now: () => number;
  private readonly setTimer: NonNullable<EmergencyReadinessDeadlineSchedulerOptions['setTimer']>;
  private readonly clearTimer: NonNullable<EmergencyReadinessDeadlineSchedulerOptions['clearTimer']>;
  private deadlines: number[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private destroyed = false;

  constructor(options: EmergencyReadinessDeadlineSchedulerOptions) {
    this.onDeadline = options.onDeadline;
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
    this.clearTimer = options.clearTimer ?? ((handle) => globalThis.clearTimeout(handle));
  }

  public track(deadlines: readonly number[]): void {
    if (this.destroyed) return;
    this.generation += 1;
    this.cancel();
    this.deadlines = deadlines.filter((deadline) => Number.isFinite(deadline)).sort((left, right) => left - right);
    this.schedule(this.generation);
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.generation += 1;
    this.deadlines = [];
    this.cancel();
  }

  private cancel(): void {
    if (this.timer === null) return;
    this.clearTimer(this.timer);
    this.timer = null;
  }

  private schedule(generation: number): void {
    if (this.destroyed || generation !== this.generation) return;
    const now = this.now();
    const deadline = this.deadlines.find((candidate) => candidate > now);
    if (deadline === undefined) return;
    const delayMs = Math.min(deadline - now, MAX_LIFELINE_EXPIRY_TIMER_DELAY_MS);
    this.timer = this.setTimer(() => {
      if (this.destroyed || generation !== this.generation) return;
      this.timer = null;
      if (this.now() < deadline) {
        this.schedule(generation);
        return;
      }
      this.deadlines = this.deadlines.filter((candidate) => candidate > deadline);
      this.onDeadline();
      this.schedule(generation);
    }, delayMs);
  }
}
