/**
 * Survival Outlook renderer — pure HTML-string builders over the board
 * view-models produced by {@link buildSurvivalOutlook}.
 *
 * No DOM, no fetch, no globals: every function takes a view-model and returns
 * an HTML string. The view-models have already done the thinking (bounding,
 * tone, labels); this module is the "dumb map over rows" the surfacing-prep
 * plan promised. All interpolated text is escaped.
 *
 * Boards whose `isEmpty` is true render nothing — so the retrospective board
 * (empty until a live calibration store is wired) stays out of the way instead
 * of showing a permanently-blank section.
 */

import { escapeHtml } from '@/utils/sanitize.ts';
import type { SurvivalOutlook } from './survival-outlook.ts';
import type { PostureTrajectoryBoardView } from './posture-trajectory-view.ts';
import type { WorldBranchesBoardView } from './world-branches-view.ts';
import type { DecisionBoardView } from './decision-consequence-view.ts';
import type { GridDownBoardView } from './grid-down-certify-view.ts';
import type { OfflinePlaybookBoardView } from './offline-playbook-view.ts';
import type { CommsFallbackBoardView } from './comms-fallback-view.ts';
import type { RetrospectiveBoardView } from './retrospective-view.ts';

// ── Tone palette ────────────────────────────────────────────────────────────
// Six of the seven boards share danger/caution/muted/neutral; the decision
// board swaps in act/prepare. Keying on the string value handles all of them.

const TONE_COLOR: Record<string, string> = {
  danger: '#ff453a',
  caution: '#ff9f0a',
  prepare: '#ffd60a',
  act: '#0a84ff',
  neutral: '#8a8a8e',
  muted: '#6e6e73',
};

function toneColor(tone: string): string {
  return TONE_COLOR[tone] ?? '#6e6e73';
}

// ── Shared building blocks ──────────────────────────────────────────────────

/** A collapsible board section. `body` is trusted HTML from the builders below;
 *  `title`/`headline` are escaped here. */
function section(title: string, headline: string, tone: string, body: string): string {
  const color = toneColor(tone);
  return `<details class="survival-outlook-section" style="margin-bottom:6px;border:1px solid var(--border-subtle,#2a2a2a);border-radius:6px;background:var(--bg-elevated,rgba(255,255,255,0.02));overflow:hidden;">
    <summary style="list-style:none;cursor:pointer;padding:8px 12px;border-left:3px solid ${color};display:flex;flex-direction:column;gap:2px;">
      <span style="font-size:11px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(title)}</span>
      <span style="font-size:11px;color:var(--text-secondary,#aaa);">${escapeHtml(headline)}</span>
    </summary>
    <div style="padding:4px 12px 10px;">${body}</div>
  </details>`;
}

function chip(text: string, tone: string): string {
  const color = toneColor(tone);
  return `<span style="display:inline-block;font-size:10px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.04em;padding:1px 5px;border:1px solid ${color}66;border-radius:3px;white-space:nowrap;">${escapeHtml(text)}</span>`;
}

function bandTag(band: string, tone: string): string {
  const color = toneColor(tone);
  return `<span style="font-size:10px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.04em;white-space:nowrap;">${escapeHtml(band)}</span>`;
}

function overflowNote(label: string): string {
  if (!label) return '';
  return `<div style="margin-top:4px;font-size:10px;color:var(--text-secondary,#888);">${escapeHtml(label)}</div>`;
}

function rowShell(inner: string): string {
  return `<div style="padding:6px 0;border-top:1px solid var(--border-subtle,#222);">${inner}</div>`;
}

function headerLine(left: string, right: string): string {
  return `<div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;">
    <span style="font-size:12px;font-weight:600;color:var(--text-primary,#ddd);">${escapeHtml(left)}</span>
    ${right}
  </div>`;
}

function subLine(text: string): string {
  if (!text) return '';
  return `<div style="margin-top:2px;font-size:11px;color:var(--text-secondary,#999);">${escapeHtml(text)}</div>`;
}

function horizonLabel(text: string): string {
  return `<div style="margin:8px 0 2px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-secondary,#888);">${escapeHtml(text)}</div>`;
}

// ── Per-board renderers ─────────────────────────────────────────────────────

function renderTrajectory(view: PostureTrajectoryBoardView): string {
  if (view.isEmpty) return '';
  const callout = view.peakCallout
    ? `<div style="margin-bottom:4px;">${chip(view.peakCallout, view.tone)}</div>`
    : '';
  const horizons = view.horizons
    .map((h) => {
      const rows = h.rows
        .map((r) =>
          rowShell(
            headerLine(
              r.axisTitle,
              `<span style="display:flex;gap:8px;align-items:baseline;">${bandTag(r.projectedBand, r.tone)}<span style="font-size:11px;color:var(--text-secondary,#999);">${escapeHtml(r.directionLabel)} ${escapeHtml(r.deltaLabel)}</span></span>`,
            ) + subLine(r.topDriver),
          ),
        )
        .join('');
      return horizonLabel(`${h.horizonId} · worst ${h.worstBand}`) + rows + overflowNote(h.overflowLabel);
    })
    .join('');
  return section(view.title, view.headline, view.tone, callout + horizons);
}

function renderBranches(view: WorldBranchesBoardView): string {
  if (view.isEmpty) return '';
  const downside = view.topDownside
    ? `<div style="margin-bottom:4px;">${chip(view.topDownside.label, view.tone)}</div>`
    : '';
  const horizons = view.horizons
    .map((h) => {
      const rows = h.rows
        .map((r) => {
          const right = `<span style="display:flex;gap:8px;align-items:baseline;">${bandTag(r.expectedBand, r.tone)}<span style="font-size:11px;color:var(--text-secondary,#999);">${escapeHtml(r.mostLikelyLabel)}</span></span>`;
          return rowShell(headerLine(r.axisTitle, right) + subLine(r.downsideLabel));
        })
        .join('');
      return horizonLabel(`${h.horizonId} · worst ${h.worstExpectedBand}`) + rows + overflowNote(h.overflowLabel);
    })
    .join('');
  return section(view.title, view.headline, view.tone, downside + horizons);
}

function renderDecision(view: DecisionBoardView): string {
  if (view.isEmpty) return '';
  const rows = view.rows
    .map((r) => {
      const tag = r.isRecommended ? chip('Recommended', 'act') : '';
      const right = `<span style="display:flex;gap:8px;align-items:baseline;">${tag}<span style="font-size:11px;font-weight:600;color:${toneColor(r.tone)};">${escapeHtml(r.metric)}</span></span>`;
      const residual = r.residualLabel ? ` · ${r.residualLabel}` : '';
      const meta = `${r.costLabel} · ${r.leadTimeLabel}${residual}`;
      return rowShell(headerLine(r.moveLabel, right) + subLine(meta));
    })
    .join('');
  return section(view.title, view.headline, view.tone, rows + overflowNote(view.overflowLabel));
}

function renderGridDown(view: GridDownBoardView): string {
  if (view.isEmpty) return '';
  const summary = `<div style="margin-bottom:4px;font-size:11px;color:var(--text-secondary,#999);">${escapeHtml(view.statusSummary)}</div>`;
  const rows = view.rows
    .map((r) => {
      const right = `<span style="display:flex;gap:8px;align-items:baseline;">${chip(r.statusLabel, r.tone)}<span style="font-size:10px;color:var(--text-secondary,#888);">${escapeHtml(r.ageLabel)}</span></span>`;
      return rowShell(headerLine(r.axisTitle, right) + subLine(r.reason));
    })
    .join('');
  return section(view.title, view.headline, view.tone, summary + rows + overflowNote(view.rowOverflowLabel));
}

function renderOffline(view: OfflinePlaybookBoardView): string {
  if (view.isEmpty) return '';
  const cards = view.cards
    .map((c) => {
      const actions = c.actions
        .map((a) =>
          rowShell(
            headerLine(a.label, `<span style="font-size:10px;color:var(--text-secondary,#888);">${escapeHtml(a.urgencyLabel)} · ${escapeHtml(a.timeLabel)}</span>`) +
              subLine(a.rationale),
          ),
        )
        .join('');
      return `<div style="margin:8px 0 2px;">${headerLine(c.axisTitle, bandTag(c.band, c.tone))}${subLine(c.triggerSummary)}${actions}${overflowNote(c.actionOverflowLabel)}</div>`;
    })
    .join('');
  return section(view.title, view.headline, view.tone, cards + overflowNote(view.cardOverflowLabel));
}

function commsRungTone(state: string): string {
  if (state === 'down') return 'muted';
  if (state === 'recommended') return 'act';
  return 'neutral';
}

function renderComms(view: CommsFallbackBoardView): string {
  if (view.isEmpty) return '';
  const receive = view.receiveMethod ? ` · receive: ${view.receiveMethod}` : '';
  const lead = `<div style="margin-bottom:4px;font-size:11px;color:var(--text-secondary,#999);">Use: ${escapeHtml(view.recommendedMethod)}${escapeHtml(receive)}</div>`;
  const power = view.powerNote
    ? `<div style="margin-bottom:4px;font-size:10px;color:${toneColor('caution')};">${escapeHtml(view.powerNote)}</div>`
    : '';
  const rungs = view.rungs
    .map((r) => {
      const stateTone = commsRungTone(r.state);
      const ref = r.reference
        ? `<span style="font-size:10px;color:var(--text-secondary,#888);">${escapeHtml(r.reference)}</span>`
        : '';
      const right = `<span style="display:flex;gap:8px;align-items:baseline;">${chip(r.stateLabel, stateTone)}${ref}</span>`;
      return rowShell(headerLine(r.method, right) + subLine(r.instruction) + subLine(r.dependencySummary));
    })
    .join('');
  const checkIn = `<div style="margin-top:8px;font-size:10px;color:var(--text-secondary,#888);">Check-in: ${escapeHtml(view.checkIn.outOfAreaContact)} · ${escapeHtml(view.checkIn.meetingPoint)} · ${escapeHtml(view.checkIn.cadenceLabel)}</div>`;
  return section(view.title, view.headline, view.tone, lead + power + rungs + overflowNote(view.rungOverflowLabel) + checkIn);
}

function renderRetrospective(view: RetrospectiveBoardView): string {
  if (view.isEmpty) return '';
  const summary = `<div style="margin-bottom:4px;font-size:11px;color:var(--text-secondary,#999);">${escapeHtml(view.summaryLine)}</div>`;
  const rows = view.rows
    .map((r) => {
      const right = `<span style="display:flex;gap:8px;align-items:baseline;">${chip(r.chip, r.tone)}<span style="font-size:10px;color:var(--text-secondary,#888);">${escapeHtml(r.metric)}</span></span>`;
      return rowShell(headerLine(r.subject, right) + subLine(r.lesson));
    })
    .join('');
  return section(view.title, view.headline, view.tone, summary + rows + overflowNote(view.overflowLabel));
}

// ── Entry point ─────────────────────────────────────────────────────────────

/** Render the whole outlook as a stack of collapsible sections. Returns "" when
 *  every board is empty (nothing worth surfacing). */
export function renderSurvivalOutlook(outlook: SurvivalOutlook): string {
  const sections = [
    renderTrajectory(outlook.trajectory),
    renderBranches(outlook.branches),
    renderDecision(outlook.decision),
    renderGridDown(outlook.gridDown),
    renderOffline(outlook.offline),
    renderComms(outlook.comms),
    renderRetrospective(outlook.retrospective),
  ].filter((s) => s !== '');
  if (sections.length === 0) return '';
  return `<div class="survival-outlook" style="margin:0 10px 12px;">
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-secondary,#888);margin:0 2px 6px;">Outlook &amp; readiness</div>
    ${sections.join('')}
  </div>`;
}
