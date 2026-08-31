import type { AlertSeverity, UnifiedAlert } from './unified-alerts';
import { safeSetItem } from '@/utils/safe-storage';

export const PANEL_REVIEW_STORAGE_KEY = 'cb-panel-review-ledger-v1';

const MAX_REVIEW_IDENTITIES = 500;
const MAX_REVIEW_LEDGER_CHARS = 256 * 1024;
const MAX_EVIDENCE_ID_CHARS = 2048;
const EVIDENCE_REVISION_PATTERN = /^[0-9a-f]{16}$/;
const STANDARD_PROMOTION_SCORE = 30;
const URGENT_PROMOTION_SCORE = 100;
const MAX_PROMOTED_PANELS = 3;

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

const VALID_SEVERITIES = new Set<AlertSeverity>(
  Object.keys(SEVERITY_RANK) as AlertSeverity[],
);

export interface EvidenceIdentity {
  id: string;
  observedAt: number | null;
  revision: string;
}

export interface PanelAttention {
  panelId: string;
  activeCount: number;
  maxSeverity: AlertSeverity;
  maxScore: number;
  newestEvidenceAt: number | null;
  evidence: EvidenceIdentity[];
  unreviewedEvidence: EvidenceIdentity[];
  unreviewedCount: number;
  promoted: boolean;
}

export interface AttentionSnapshot {
  panels: PanelAttention[];
  severityCounts: Partial<Record<AlertSeverity, number>>;
  promotedPanelIds: string[];
}

export interface ProjectPanelAttentionOptions {
  now?: number;
  score: (alert: UnifiedAlert, now: number) => number;
  route: (alert: UnifiedAlert) => string;
  reviewed: readonly EvidenceIdentity[];
  incumbents: readonly string[];
}

export interface ReviewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type MutablePanelAttention = PanelAttention;

function isSafeObservedAt(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= 0;
}

function evidenceFor(alert: UnifiedAlert): EvidenceIdentity {
  const content = JSON.stringify([
    alert.source,
    alert.severity,
    alert.title,
    alert.body,
    alert.location?.lat ?? null,
    alert.location?.lon ?? null,
    alert.location?.label ?? null,
  ]);
  let revision = 0xCB_F2_9C_E4_84_22_23_25n;
  for (const character of content) {
    revision ^= BigInt(character.codePointAt(0) ?? 0);
    revision = BigInt.asUintN(64, revision * 0x01_00_00_00_01_B3n);
  }
  return {
    id: alert.id,
    observedAt: isSafeObservedAt(alert.timestamp) ? alert.timestamp : null,
    revision: revision.toString(16).padStart(16, '0'),
  };
}

function identityKey(identity: EvidenceIdentity): string {
  return JSON.stringify([identity.id, identity.revision]);
}

function isEvidenceIdentity(value: unknown): value is EvidenceIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  if (keys.length !== 3
    || !keys.includes('id')
    || !keys.includes('observedAt')
    || !keys.includes('revision')) return false;
  return typeof candidate.id === 'string'
    && candidate.id.length > 0
    && candidate.id.length <= MAX_EVIDENCE_ID_CHARS
    && (candidate.observedAt === null || isSafeObservedAt(candidate.observedAt))
    && typeof candidate.revision === 'string'
    && EVIDENCE_REVISION_PATTERN.test(candidate.revision);
}

function uniqueValid(identities: readonly EvidenceIdentity[]): EvidenceIdentity[] {
  const unique = new Map<string, EvidenceIdentity>();
  for (const identity of identities) {
    if (!isEvidenceIdentity(identity)) continue;
    const key = identityKey(identity);
    if (!unique.has(key)) unique.set(key, { ...identity });
  }
  return [...unique.values()];
}

function uniqueBounded(identities: readonly EvidenceIdentity[]): EvidenceIdentity[] {
  const values = uniqueValid(identities);
  return values.length <= MAX_REVIEW_IDENTITIES
    ? values
    : values.slice(values.length - MAX_REVIEW_IDENTITIES);
}

function comparePanels(a: PanelAttention, b: PanelAttention): number {
  const reviewDelta = Number(b.unreviewedCount > 0) - Number(a.unreviewedCount > 0);
  if (reviewDelta !== 0) return reviewDelta;
  if (b.maxScore !== a.maxScore) return b.maxScore - a.maxScore;
  const severityDelta = SEVERITY_RANK[b.maxSeverity] - SEVERITY_RANK[a.maxSeverity];
  if (severityDelta !== 0) return severityDelta;
  const newestDelta = (b.newestEvidenceAt ?? -1) - (a.newestEvidenceAt ?? -1);
  if (newestDelta !== 0) return newestDelta;
  return a.panelId.localeCompare(b.panelId);
}

function compareEvidence(a: EvidenceIdentity, b: EvidenceIdentity): number {
  const observedDelta = (b.observedAt ?? -1) - (a.observedAt ?? -1);
  return observedDelta || a.id.localeCompare(b.id);
}

function addAlertToPanel(
  byPanel: Map<string, MutablePanelAttention>,
  alert: UnifiedAlert,
  alertScore: number,
  panelId: string,
  reviewed: ReadonlySet<string>,
): void {
  const evidence = evidenceFor(alert);
  const isUnreviewed = !reviewed.has(identityKey(evidence));
  const panel = byPanel.get(panelId) ?? {
    panelId,
    activeCount: 0,
    maxSeverity: alert.severity,
    maxScore: alertScore,
    newestEvidenceAt: null,
    evidence: [],
    unreviewedEvidence: [],
    unreviewedCount: 0,
    promoted: false,
  };
  panel.activeCount++;
  panel.evidence.push(evidence);
  if (isUnreviewed) {
    const firstUnreviewed = panel.unreviewedCount === 0;
    panel.unreviewedEvidence.push(evidence);
    panel.unreviewedCount++;
    if (firstUnreviewed || alertScore > panel.maxScore) panel.maxScore = alertScore;
    if (firstUnreviewed
      || SEVERITY_RANK[alert.severity] > SEVERITY_RANK[panel.maxSeverity]) {
      panel.maxSeverity = alert.severity;
    }
    if (evidence.observedAt !== null
      && (panel.newestEvidenceAt === null || evidence.observedAt > panel.newestEvidenceAt)) {
      panel.newestEvidenceAt = evidence.observedAt;
    }
  }
  byPanel.set(panelId, panel);
}

function choosePromotions(
  panels: readonly PanelAttention[],
  incumbents: readonly string[],
): string[] {
  const eligible = panels.filter(
    (panel) => panel.unreviewedCount > 0 && panel.maxScore >= STANDARD_PROMOTION_SCORE,
  );
  const byId = new Map(eligible.map((panel) => [panel.panelId, panel]));
  const chosen: string[] = [];
  for (const incumbent of incumbents) {
    if (chosen.length >= MAX_PROMOTED_PANELS) break;
    if (byId.has(incumbent) && !chosen.includes(incumbent)) chosen.push(incumbent);
  }

  const challengers = eligible
    .filter((panel) => !chosen.includes(panel.panelId))
    .sort(comparePanels);

  for (const challenger of challengers) {
    if (chosen.length < MAX_PROMOTED_PANELS) {
      chosen.push(challenger.panelId);
      continue;
    }
    if (challenger.maxScore < URGENT_PROMOTION_SCORE) continue;
    const standardIncumbents = chosen
      .map((panelId, index) => ({ panel: byId.get(panelId)!, index }))
      .filter(({ panel }) => panel.maxScore < URGENT_PROMOTION_SCORE)
      .sort((a, b) => a.panel.maxScore - b.panel.maxScore
        || b.panel.panelId.localeCompare(a.panel.panelId));
    const weakest = standardIncumbents[0];
    if (!weakest) continue;
    chosen.splice(weakest.index, 1);
    chosen.push(challenger.panelId);
  }

  return chosen;
}

export function projectPanelAttention(
  alerts: readonly UnifiedAlert[],
  options: ProjectPanelAttentionOptions,
): AttentionSnapshot {
  const now = options.now ?? Date.now();
  const reviewed = new Set(options.reviewed.map((identity) => identityKey(identity)));
  const byPanel = new Map<string, MutablePanelAttention>();

  for (const alert of alerts) {
    const alertScore = options.score(alert, now);
    if (!Number.isFinite(alertScore) || alertScore <= 0) continue;
    if (!VALID_SEVERITIES.has(alert.severity)) continue;
    const panelId = options.route(alert);
    if (!panelId) continue;
    addAlertToPanel(byPanel, alert, alertScore, panelId, reviewed);
  }

  const panels = [...byPanel.values()].sort(comparePanels);
  const promotedPanelIds = choosePromotions(panels, options.incumbents);
  const promoted = new Set(promotedPanelIds);
  const severityCounts: Partial<Record<AlertSeverity, number>> = {};
  for (const panel of panels) {
    panel.evidence.sort(compareEvidence);
    panel.unreviewedEvidence.sort(compareEvidence);
    panel.promoted = promoted.has(panel.panelId);
    if (panel.unreviewedCount > 0) {
      severityCounts[panel.maxSeverity] = (severityCounts[panel.maxSeverity] ?? 0) + 1;
    }
  }

  return { panels, severityCounts, promotedPanelIds };
}

export function markPanelReviewed(
  reviewed: readonly EvidenceIdentity[],
  panel: Pick<PanelAttention, 'evidence'>,
  activeEvidence: readonly EvidenceIdentity[],
): EvidenceIdentity[] {
  const candidates = uniqueValid([...reviewed, ...panel.evidence]);
  const activeKeys = new Set(
    uniqueValid(activeEvidence).map((identity) => identityKey(identity)),
  );
  const activeReviewed = candidates.filter((identity) => activeKeys.has(identityKey(identity)));
  const retainedActive = activeReviewed.length <= MAX_REVIEW_IDENTITIES
    ? activeReviewed
    : activeReviewed.slice(activeReviewed.length - MAX_REVIEW_IDENTITIES);
  const remainingCapacity = MAX_REVIEW_IDENTITIES - retainedActive.length;
  const inactiveHistory = candidates.filter((identity) => !activeKeys.has(identityKey(identity)));
  const retainedInactive = inactiveHistory.length <= remainingCapacity
    ? inactiveHistory
    : inactiveHistory.slice(inactiveHistory.length - remainingCapacity);
  const retainedKeys = new Set(
    [...retainedActive, ...retainedInactive].map((identity) => identityKey(identity)),
  );
  return candidates.filter((identity) => retainedKeys.has(identityKey(identity)));
}

export function loadReviewLedger(
  storage?: ReviewStorage,
): EvidenceIdentity[] {
  try {
    const target = storage ?? globalThis.localStorage;
    if (!target) return [];
    const raw = target.getItem(PANEL_REVIEW_STORAGE_KEY);
    if (!raw) return [];
    if (raw.length > MAX_REVIEW_LEDGER_CHARS) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    const blob = parsed as Record<string, unknown>;
    if (Object.keys(blob).length !== 2 || blob.version !== 1 || !Array.isArray(blob.reviewed)) return [];
    if (blob.reviewed.length > MAX_REVIEW_IDENTITIES) return [];
    const identities = blob.reviewed;
    if (!identities.every((identity) => isEvidenceIdentity(identity))) return [];
    const keys = identities.map((identity) => identityKey(identity));
    if (new Set(keys).size !== keys.length) return [];
    return identities.map((identity) => ({ ...identity }));
  } catch {
    return [];
  }
}

export function persistReviewLedger(
  reviewed: readonly EvidenceIdentity[],
  storage?: ReviewStorage,
): boolean {
  try {
    const compacted = uniqueBounded(reviewed);
    const serialized = JSON.stringify({ version: 1, reviewed: compacted });
    if (serialized.length > MAX_REVIEW_LEDGER_CHARS) return false;
    if (!storage) return safeSetItem(PANEL_REVIEW_STORAGE_KEY, serialized);
    storage.setItem(PANEL_REVIEW_STORAGE_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}
