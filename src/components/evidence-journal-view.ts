/**
 * Evidence journal section for the Belief Calibration panel (R4-LOW-008).
 * Pure markup: the panel owns fetching, exporting and re-rendering.
 */

import type { EvidenceSummary } from '@/services/intelligence/evidence-journal';
import { escapeHtml } from '@/utils/sanitize';

export type EvidenceJournalViewState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'ready'; summary: EvidenceSummary };

export interface EvidenceExportViewState {
  busy: boolean;
  message?: string;
  error?: boolean;
}

const KIND_LABELS: readonly (readonly [string, string])[] = [
  ['forecast', 'forecast'],
  ['alert-outcome', 'alert outcome'],
  ['ema-forecast', 'EMA forecast'],
];

function entries(count: number, label = ''): string {
  const words = [count.toLocaleString('en-US'), label, count === 1 ? 'entry' : 'entries'];
  return words.filter((word) => word.length > 0).join(' ');
}

export function describeChain(summary: EvidenceSummary): string {
  if (summary.chain.ok) return 'hash chain verified';
  if (typeof summary.chain.brokenAtSeq === 'number') return `hash chain broken at entry ${summary.chain.brokenAtSeq}`;
  return 'hash chain head does not match its record count';
}

export function describeEvidenceJournal(state: EvidenceJournalViewState): string {
  if (state.status === 'loading') return 'Checking the evidence journal…';
  if (state.status === 'unavailable') {
    return 'The evidence journal is available in the desktop app while the local engine is running.';
  }
  const { summary } = state;
  const kinds = KIND_LABELS.map(([kind, label]) => entries(summary.byKind[kind] ?? 0, label));
  return `${entries(summary.total)} (${kinds.join(', ')}) · ${describeChain(summary)}`;
}

export function renderEvidenceJournalSection(
  state: EvidenceJournalViewState,
  exportState: EvidenceExportViewState,
): string {
  const nearlyFull = state.status === 'ready'
    && state.summary.maxBytes > 0
    && state.summary.sizeBytes >= state.summary.maxBytes * 0.9;
  const chainBroken = state.status === 'ready' && !state.summary.chain.ok;
  let warning = '';
  if (chainBroken) {
    warning = 'The journal changed outside the app. Export a copy and keep the file before anything else writes to it.';
  } else if (nearlyFull) {
    warning = 'The journal is close to its size limit. New evidence will be refused, never deleted, once it is full.';
  }
  const messageStyle = exportState.error ? 'color:var(--color-danger,#e5484d);' : 'opacity:0.8;';
  const message = exportState.message
    ? `<p class="evidence-journal-message" style="margin:6px 0 0;font-size:11px;${messageStyle}">${escapeHtml(exportState.message)}</p>`
    : '';
  const disabled = state.status !== 'ready' || exportState.busy ? ' disabled' : '';
  return `
      <section class="evidence-journal-section" style="margin-bottom:12px;">
        <h3 style="margin:0 0 6px;font-size:13px;">Calibration evidence journal</h3>
        <p class="evidence-journal-status" style="margin:0 0 4px;font-size:12px;">${escapeHtml(describeEvidenceJournal(state))}</p>
        ${warning ? `<p class="evidence-journal-warning" style="margin:0 0 4px;font-size:11px;color:var(--color-warning,#f5a524);">${escapeHtml(warning)}</p>` : ''}
        <p style="margin:0 0 8px;font-size:11px;opacity:0.7;">
          Every forecast, resolution and alert outcome is kept here permanently, with no rolling cap.
          It stays on this Mac (excluded from Time Machine) and keeps scored fields only, never claim text or notes.
          Export a copy to keep a backup.
        </p>
        <button type="button" class="evidence-journal-export" data-evidence-action="export"${disabled}>
          ${exportState.busy ? 'Exporting…' : 'Export calibration evidence'}
        </button>
        ${message}
      </section>`;
}
