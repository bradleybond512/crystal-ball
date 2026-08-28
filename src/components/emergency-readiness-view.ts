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
import type {
  EmergencyPackArtifactKind,
  EmergencyPackStatus,
} from '@/services/emergency-pack/emergency-pack-schema.ts';
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
  pack: EmergencyPackView | null;
}

export interface EmergencyReadinessLifelinesInput {
  placeLabel: string;
  receipt: VerifiedLifelinesReceipt | null;
}

interface EmergencyReadinessProjectionOptions {
  now?: number;
  emergencyPack?: EmergencyPackInput | null;
}

export interface EmergencyPackReceiptInput {
  kind: EmergencyPackArtifactKind;
  capturedAt: string;
  expiresAt: string;
  semanticState: 'verified' | 'verified-empty';
  summary: string;
}

export interface EmergencyPackReadinessInput {
  status: EmergencyPackStatus;
  packId: string | null;
  requiredKinds: EmergencyPackArtifactKind[];
  optionalKinds: EmergencyPackArtifactKind[];
  receipts: EmergencyPackReceiptInput[];
  missingKinds: EmergencyPackArtifactKind[];
  expiredKinds: EmergencyPackArtifactKind[];
}

export interface EmergencyPackCaptureState {
  status: 'idle' | 'capturing' | 'complete' | 'error';
  completed: number;
  total: number;
  message: string;
}

export interface EmergencyPackInput {
  places: { id: string; name: string }[];
  selectedPlaceId: string | null;
  readiness: EmergencyPackReadinessInput;
  contactConsent: boolean;
  captureState: EmergencyPackCaptureState;
}

interface EmergencyPackArtifactView {
  kind: EmergencyPackArtifactKind;
  label: string;
  requirement: 'Required' | 'Optional';
  status: 'current' | 'expired' | 'missing';
  summary: string;
  capturedAtMs: number | null;
  expiresAtMs: number | null;
}

export interface EmergencyPackView {
  places: { id: string; name: string }[];
  selectedPlaceId: string | null;
  status: EmergencyPackStatus;
  artifacts: EmergencyPackArtifactView[];
  contactConsent: boolean;
  captureState: EmergencyPackCaptureState;
  headline: string;
  detail: string;
  actionLabel: string;
  liveMessage: string;
}

const ARTIFACT_LABELS: Record<EmergencyPackArtifactKind, string> = {
  lifelines: 'Lifelines',
  alerts: 'Scoped alerts',
  'route-primary': 'Primary route',
  'offline-map': 'Offline map',
  'comms-plan': 'Comms plan',
  contacts: 'Selected contacts',
  'route-alternate': 'Alternate route',
};

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

function validTimestamp(value: string): number | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function packCopy(input: EmergencyPackInput): Pick<EmergencyPackView, 'headline' | 'detail' | 'actionLabel'> {
  if (input.captureState.status === 'capturing') {
    return {
      headline: 'Capturing Emergency Pack',
      detail: input.captureState.message || 'Verifying each required artifact before publication.',
      actionLabel: 'Capturing…',
    };
  }
  if (input.captureState.status === 'error') {
    return {
      headline: 'Emergency Pack capture failed',
      detail: input.captureState.message || 'The last known good pack was preserved.',
      actionLabel: 'Retry Emergency Pack',
    };
  }
  if (input.readiness.status === 'ready') {
    return {
      headline: 'Emergency Pack ready',
      detail: 'Every required artifact has an exact, current receipt for this place.',
      actionLabel: 'Refresh Emergency Pack',
    };
  }
  if (input.readiness.status === 'expired') {
    return {
      headline: 'Emergency Pack expired',
      detail: 'A full recapture is required before this pack can be ready again.',
      actionLabel: 'Recapture Emergency Pack',
    };
  }
  if (input.readiness.status === 'partial') {
    const missing = input.readiness.missingKinds.length;
    return {
      headline: 'Emergency Pack partial',
      detail: `${missing} required ${missing === 1 ? 'artifact is' : 'artifacts are'} missing. A full recapture is required.`,
      actionLabel: 'Recapture Emergency Pack',
    };
  }
  return {
    headline: 'No Emergency Pack saved',
    detail: input.places.length > 0
      ? 'Capture and verify the required offline artifacts for the selected place.'
      : 'Save a place before capturing an Emergency Pack.',
    actionLabel: 'Capture Emergency Pack',
  };
}

function effectivePackStatus(
  input: EmergencyPackInput,
  artifacts: EmergencyPackArtifactView[],
): EmergencyPackStatus {
  const requiredExpiredAtRender = artifacts.some((artifact) => (
    artifact.requirement === 'Required' && artifact.status === 'expired'
  ));
  return input.readiness.status !== 'not-saved' && requiredExpiredAtRender
    ? 'expired'
    : input.readiness.status;
}

function packCaptureMessage(status: EmergencyPackStatus, missing: number): string {
  if (status === 'ready') return 'All required artifacts are current.';
  if (status === 'expired') return 'Required artifacts have expired.';
  if (status === 'partial') {
    const missingLabel = missing === 1 ? 'artifact is' : 'artifacts are';
    return `${missing} required ${missingLabel} missing or expired.`;
  }
  return 'No verified Emergency Pack is saved.';
}

function artifactSummary(
  kind: EmergencyPackArtifactKind,
  receipt: EmergencyPackReceiptInput | undefined,
  requirement: EmergencyPackArtifactView['requirement'],
): string {
  if (!receipt) return requirement === 'Optional' ? 'Optional — not captured.' : 'Required artifact missing.';
  if (kind !== 'offline-map') return receipt.summary;
  let summary = receipt.summary.trimEnd();
  while (summary.endsWith('.')) summary = summary.slice(0, -1).trimEnd();
  return `${summary}. Use the Emergency (offline) basemap; map coverage is limited to the saved area.`;
}

function effectiveCaptureState(
  input: EmergencyPackInput,
  status: EmergencyPackStatus,
  artifacts: EmergencyPackArtifactView[],
): EmergencyPackCaptureState {
  if (input.captureState.status === 'capturing' || input.captureState.status === 'error') {
    return { ...input.captureState };
  }
  const required = artifacts.filter((artifact) => artifact.requirement === 'Required');
  const completed = required.filter((artifact) => artifact.status === 'current').length;
  const missing = required.length - completed;
  return {
    status: status === 'ready' && input.captureState.status === 'complete' ? 'complete' : 'idle',
    completed,
    total: required.length,
    message: packCaptureMessage(status, missing),
  };
}

function projectPack(input: EmergencyPackInput, now: number): EmergencyPackView {
  const receipts = new Map(input.readiness.receipts.map((receipt) => [receipt.kind, receipt]));
  const expired = new Set(input.readiness.expiredKinds);
  const required = new Set(input.readiness.requiredKinds);
  const kinds = [...input.readiness.requiredKinds, ...input.readiness.optionalKinds];
  const artifacts = kinds.map((kind): EmergencyPackArtifactView => {
    const receipt = receipts.get(kind);
    const expiresAtMs = receipt ? validTimestamp(receipt.expiresAt) : null;
    const isExpired = expired.has(kind) || (expiresAtMs !== null && expiresAtMs <= now);
    const requirement = required.has(kind) ? 'Required' : 'Optional';
    return {
      kind,
      label: ARTIFACT_LABELS[kind],
      requirement,
      status: artifactStatus(Boolean(receipt), isExpired),
      summary: artifactSummary(kind, receipt, requirement),
      capturedAtMs: receipt ? validTimestamp(receipt.capturedAt) : null,
      expiresAtMs,
    };
  });
  const status = effectivePackStatus(input, artifacts);
  const captureState = effectiveCaptureState(input, status, artifacts);
  const effectiveInput: EmergencyPackInput = {
    ...input,
    readiness: {
      ...input.readiness,
      status,
      expiredKinds: [...new Set([...input.readiness.expiredKinds, ...artifacts
        .filter((artifact) => artifact.requirement === 'Required' && artifact.status === 'expired')
        .map((artifact) => artifact.kind)])],
    },
    captureState,
  };
  const copy = packCopy(effectiveInput);
  return {
    places: input.places.map((place) => ({ ...place })),
    selectedPlaceId: input.selectedPlaceId,
    status,
    artifacts,
    contactConsent: input.contactConsent,
    captureState,
    ...copy,
    liveMessage: `${copy.headline}. ${captureState.message}`.trim(),
  };
}

function artifactStatus(
  hasReceipt: boolean,
  isExpired: boolean,
): EmergencyPackArtifactView['status'] {
  if (!hasReceipt) return 'missing';
  return isExpired ? 'expired' : 'current';
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
  const pack = options.emergencyPack ? projectPack(options.emergencyPack, now) : null;
  const cardDeadlines = cards.flatMap((card) => {
    if (card.expiresAtMs === null || !Number.isFinite(card.expiresAtMs)) return [];
    const transitionAt = card.id === 'grid-down' ? card.expiresAtMs + 1 : card.expiresAtMs;
    return transitionAt > now ? [transitionAt] : [];
  });
  const packDeadlines = pack?.artifacts.flatMap((artifact) => (
    artifact.expiresAtMs !== null && artifact.expiresAtMs > now ? [artifact.expiresAtMs] : []
  )) ?? [];
  const deadlinesMs = [...cardDeadlines, ...packDeadlines];
  return {
    cards,
    deadlinesMs,
    liveMessage: cards.map((card) => `${card.title}: ${card.status}.`).join(' '),
    pack,
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

function renderPackArtifact(artifact: EmergencyPackArtifactView): string {
  const status = artifact.status.charAt(0).toUpperCase() + artifact.status.slice(1);
  return `<li class="emergency-pack-artifact emergency-pack-artifact--${escapeHtml(artifact.status)}" data-pack-artifact="${escapeHtml(artifact.kind)}">
    <div class="emergency-pack-artifact__heading">
      <strong>${escapeHtml(artifact.label)}</strong>
      <span>${escapeHtml(artifact.requirement)}</span>
    </div>
    <p>${escapeHtml(status)} — ${escapeHtml(artifact.summary)}</p>
    <dl>
      <div><dt>Captured</dt><dd>${timeMarkup(artifact.capturedAtMs, 'Not captured')}</dd></div>
      <div><dt>Expires</dt><dd>${timeMarkup(artifact.expiresAtMs, 'Not captured')}</dd></div>
    </dl>
  </li>`;
}

function renderEmergencyPack(pack: EmergencyPackView): string {
  const max = Math.max(1, pack.captureState.total);
  const value = Math.max(0, Math.min(max, pack.captureState.completed));
  const capturing = pack.captureState.status === 'capturing';
  const disabled = pack.places.length === 0 || capturing;
  return `<section class="emergency-pack emergency-pack--${escapeHtml(pack.status)}" data-emergency-pack="${escapeHtml(pack.status)}" aria-labelledby="emergency-pack-heading" aria-busy="${pack.captureState.status === 'capturing' ? 'true' : 'false'}">
    <div class="emergency-pack__heading">
      <div>
        <h2 id="emergency-pack-heading">Emergency Pack</h2>
        <p class="emergency-pack__headline">${escapeHtml(pack.headline)}</p>
      </div>
      <label class="emergency-pack__place">Place
        <select name="emergency-pack-place" ${disabled ? 'disabled' : ''}>
          ${pack.places.length === 0 ? '<option value="">No saved places</option>' : pack.places.map((place) => `<option value="${escapeHtml(place.id)}"${place.id === pack.selectedPlaceId ? ' selected' : ''}>${escapeHtml(place.name)}</option>`).join('')}
        </select>
      </label>
    </div>
    <p class="emergency-pack__detail">${escapeHtml(pack.detail)}</p>
    <div class="emergency-pack__progress">
      <label for="emergency-pack-progress">Required artifacts verified</label>
      <progress id="emergency-pack-progress" max="${max}" value="${value}">${value} of ${max}</progress>
      <span>${value} of ${max}</span>
    </div>
    <ul class="emergency-pack__artifacts">${pack.artifacts.map((artifact) => renderPackArtifact(artifact)).join('')}</ul>
    <label class="emergency-pack__consent">
      <input type="checkbox" name="emergency-pack-contact-consent"${pack.contactConsent ? ' checked' : ''}${capturing ? ' disabled' : ''}>
      <span>I consent to copy my selected emergency contacts into this pack. Contact details stay private on this local device.</span>
    </label>
    <button type="button" class="emergency-pack__action" data-pack-action${disabled ? ' disabled' : ''}>${escapeHtml(pack.actionLabel)}</button>
    <p class="emergency-pack__live sr-only" aria-live="polite" aria-atomic="true">${escapeHtml(pack.liveMessage)}</p>
  </section>`;
}

export function renderEmergencyReadiness(view: EmergencyReadinessView): string {
  return `<section class="emergency-readiness" aria-labelledby="emergency-readiness-heading">
    <h2 id="emergency-readiness-heading" class="sr-only">Emergency readiness capabilities</h2>
    <p class="emergency-readiness__live sr-only" aria-live="polite" aria-atomic="true">${escapeHtml(view.liveMessage)}</p>
    <div class="emergency-readiness__grid">${view.cards.map((card) => renderCard(card)).join('')}</div>
    ${view.pack ? renderEmergencyPack(view.pack) : ''}
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
