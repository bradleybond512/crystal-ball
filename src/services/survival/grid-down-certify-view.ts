// src/services/survival/grid-down-certify-view.ts
//
// E6 · Grid-down hardening — the board-ready view over the "zero bars"
// certification. grid-down-certify.ts decides, per survival axis, whether the
// operator can still SEE it and ACT on it entirely offline, and whether the
// snapshot as a whole is certified. This module bounds + tones + labels that
// certification into a fixed "can you run offline?" board card so the eventual
// renderer mount is a dumb map over these rows.
//
// Same split as the sibling surfacing-prep views (retrospective / decision-
// consequence / offline-playbook / comms-fallback): the certifier core stays a
// pure function of the snapshot; the *view-model* here decides display order,
// caps, tone, and label text. Unlike the certifier — which walks axes in a fixed
// canonical order — this view sorts rows worst-first (blind → degraded → ready,
// then by band) so the axes that break the guarantee lead, and a tight `maxRows`
// cap drops the least-severe rows rather than the ones that matter.
//
// Pure: no DOM, no fetch, no globals, no clock. A function of the passed cert.

import type { SurvivalAxis, SurvivalBand } from './survival-types.ts';
import { axisLabel, bandForLevel, bandRank } from './survival-types.ts';
import type {
  GridDownCertification,
  GridDownAxisVerdict,
  GridDownStatus,
} from './grid-down-certify.ts';

/** Card / row tone.
 *  - danger: a blind axis (nothing renderable offline) or a non-certified card.
 *  - caution: a degraded axis or a card blocked only by guidance gaps.
 *  - muted: certified but running on stale data.
 *  - neutral: certified and fresh, or a ready axis. */
export type CertTone = 'danger' | 'caution' | 'muted' | 'neutral';

/** One render-ready axis row. */
export interface GridDownAxisRow {
  axis: SurvivalAxis;
  axisTitle: string;
  status: GridDownStatus;
  /** "Ready" / "Degraded" / "Blind". */
  statusLabel: string;
  /** Row tone, from the offline status (not the threat band). */
  tone: CertTone;
  level: number;
  band: SurvivalBand;
  /** "fresh" / "under 1h" / "12h old". */
  ageLabel: string;
  stale: boolean;
  needsGuidance: boolean;
  hasGuidance: boolean;
  reason: string;
}

export interface GridDownBoardView {
  /** Constant board title. */
  title: string;
  /** One-liner from the certifier. */
  headline: string;
  certified: boolean;
  /** Card tone: worst offline problem across the card. */
  tone: CertTone;
  /** Compact count line, e.g. "5 ready · 2 degraded · 1 blind". */
  statusSummary: string;
  /** Bounded axis rows, worst-first. */
  rows: GridDownAxisRow[];
  rowOverflow: number;
  rowOverflowLabel: string;
  /** Counts over the WHOLE certification (not just the bounded slice). */
  blindCount: number;
  guidanceGapCount: number;
  staleCount: number;
  readyCount: number;
  isEmpty: boolean;
}

export interface GridDownViewOptions {
  /** Max axis rows shown before overflowing. Default 8 (all axes). */
  maxRows?: number;
}

const BOARD_TITLE = 'Can you run offline?';
const DEFAULT_MAX_ROWS = 8;
const HOUR_MS = 3_600_000;

const STATUS_RANK: Record<GridDownStatus, number> = {
  blind: 3,
  degraded: 2,
  ready: 1,
};

function statusLabel(status: GridDownStatus): string {
  switch (status) {
    case 'blind': {
      return 'Blind';
    }
    case 'degraded': {
      return 'Degraded';
    }
    case 'ready': {
      return 'Ready';
    }
  }
}

/** A row's tone follows its OFFLINE status — can I see/act on it with no
 *  network — not its threat band. A ready axis is neutral even when critical. */
function toneForStatus(status: GridDownStatus): CertTone {
  switch (status) {
    case 'blind': {
      return 'danger';
    }
    case 'degraded': {
      return 'caution';
    }
    case 'ready': {
      return 'neutral';
    }
  }
}

function ageLabel(dataAgeMs: number): string {
  const ms = Number.isFinite(dataAgeMs) ? Math.max(0, dataAgeMs) : 0;
  if (ms === 0) return 'fresh';
  const hours = ms / HOUR_MS;
  if (hours < 1) return 'under 1h';
  return `${Math.round(hours)}h old`;
}

function toRow(v: GridDownAxisVerdict): GridDownAxisRow {
  return {
    axis: v.axis,
    axisTitle: axisLabel(v.axis),
    status: v.status,
    statusLabel: statusLabel(v.status),
    tone: toneForStatus(v.status),
    level: v.level,
    band: bandForLevel(v.level),
    ageLabel: ageLabel(v.dataAgeMs),
    stale: v.stale,
    needsGuidance: v.needsGuidance,
    hasGuidance: v.hasGuidance,
    reason: v.reason,
  };
}

/** Worst-first: blind before degraded before ready, then higher band first, so
 *  the axes that break (or strain) the guarantee lead the card. Stable within a
 *  tie via the certifier's canonical axis order. */
function worstFirst(a: GridDownAxisVerdict, b: GridDownAxisVerdict): number {
  const byStatus = STATUS_RANK[b.status] - STATUS_RANK[a.status];
  if (byStatus !== 0) return byStatus;
  return bandRank(bandForLevel(b.level)) - bandRank(bandForLevel(a.level));
}

/** Card tone: a blind axis is danger, a guidance gap is caution, otherwise
 *  stale-but-certified is muted and a clean certification is neutral. */
function cardTone(cert: GridDownCertification): CertTone {
  if (cert.blindAxes.length > 0) return 'danger';
  if (cert.guidanceGapAxes.length > 0) return 'caution';
  if (cert.staleAxes.length > 0) return 'muted';
  return 'neutral';
}

function statusSummary(rows: readonly GridDownAxisRow[], readyCount: number): string {
  const degraded = rows.filter((r) => r.status === 'degraded').length;
  const blind = rows.filter((r) => r.status === 'blind').length;
  const parts: string[] = [];
  if (readyCount > 0) parts.push(`${readyCount} ready`);
  if (degraded > 0) parts.push(`${degraded} degraded`);
  if (blind > 0) parts.push(`${blind} blind`);
  return parts.join(' · ');
}

/** Bound, tone, and format a grid-down certification into a board card view-model.
 *  Rows are re-sorted worst-first; the bucket counts are taken from the whole
 *  certification so a `maxRows` cap can't understate how much is broken. */
export function buildGridDownBoardView(
  cert: GridDownCertification,
  options: GridDownViewOptions = {},
): GridDownBoardView {
  const rawMaxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  // A non-positive cap would blank the card; floor to 1 so the single worst axis
  // always shows.
  const maxRows = Number.isFinite(rawMaxRows) ? Math.max(1, Math.floor(rawMaxRows)) : DEFAULT_MAX_ROWS;

  const ordered = [...cert.axisVerdicts].sort(worstFirst);
  const shown = ordered.slice(0, maxRows);
  const rows = shown.map((v) => toRow(v));
  const rowOverflow = ordered.length - rows.length;

  const readyCount = cert.axisVerdicts.filter((v) => v.status === 'ready').length;

  return {
    title: BOARD_TITLE,
    headline: cert.headline,
    certified: cert.certified,
    tone: cardTone(cert),
    // Summary counts the full set, not the bounded rows.
    statusSummary: statusSummary(ordered.map((v) => toRow(v)), readyCount),
    rows,
    rowOverflow,
    rowOverflowLabel: rowOverflow > 0 ? `+${rowOverflow} more` : '',
    blindCount: cert.blindAxes.length,
    guidanceGapCount: cert.guidanceGapAxes.length,
    staleCount: cert.staleAxes.length,
    readyCount,
    isEmpty: cert.axisVerdicts.length === 0,
  };
}
