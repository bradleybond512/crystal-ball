/**
 * Evidence journal section for the Belief Calibration panel (R4-LOW-008).
 * Pure markup: the panel owns fetching, exporting and re-rendering.
 */

import type { EvidenceSummary } from '@/services/intelligence/evidence-journal';
import type { OutboxDiagnostics } from '@/services/intelligence/evidence-outbox';
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

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

/** Content-free local diagnostics; rendering never asks the sidecar for a summary. */
export function renderEvidenceCaptureDiagnostics(diagnostics?: OutboxDiagnostics): string {
  const lines: string[] = [];
  if (diagnostics) {
    const d = diagnostics;
    const number = (value: number) => value.toLocaleString('en-US');
    const counter = (value: number) => `${d.saturated ? 'at least ' : ''}${number(value)}`;
    lines.push(
      `${number(d.savedAwaitingSync)} scored ${plural(d.savedAwaitingSync, 'change')} saved locally and awaiting sync; `
      + `${number(d.hashing)} ${plural(d.hashing, 'capture')} hashing; scored fields not yet saved; `
      + `${number(d.awaitingStorage)} scored ${plural(d.awaitingStorage, 'change')} awaiting local storage; not saved.`,
      `${counter(d.refused)} captures refused; ${counter(d.interrupted)} captures interrupted before scored fields were saved; `
      + `${number(d.terminalBlocked)} rejected ${plural(d.terminalBlocked, 'capture')} blocked; `
      + `${number(d.quarantined)} quarantined local ${plural(d.quarantined, 'slot')}.`,
      `${counter(d.storageFailures)} local storage failures; ${counter(d.byReason['storage-quota'] ?? 0)} quota refusals; `
      + `${counter(d.byReason.capacity ?? 0)} capacity refusals.`,
      `Bounded queue: ${number(d.slots)} of ${number(d.limits.slots)} slots; `
      + `${number(d.reservedBytes)} of ${number(d.limits.storageBytes)} reserved storage bytes; `
      + `${number(d.transientBytes)} of ${number(d.limits.transientBytes)} transient bytes. Available local storage quota may be smaller.`,
    );
    if (d.lastReason) lines.push(`Last refusal: ${d.lastReason}.`);
    if (d.blocked) lines.push('Capture admission blocked; retained local slots need attention.');
    if (d.journalFull) lines.push('Journal full; pending changes retained.');
    if (d.diagnosticsUnsaved) lines.push('Some capture diagnostics could not be saved; live refusal counts may be lost on restart.');
  } else {
    lines.push('Local capture diagnostics unavailable.');
  }
  lines.push(
    'Saved pending changes survive renderer restart while local storage is preserved. Restart before hashing or storage completes can lose those captures. Resetting local storage can lose pending changes and capture diagnostics.',
    'Exports contain accepted journal entries only; do not treat them as a backup of pending, refused or rejected captures.',
  );
  return `<div class="evidence-capture-diagnostics">${lines.map((line) =>
    `<p style="margin:0 0 4px;font-size:11px;opacity:0.8;">${escapeHtml(line)}</p>`,
  ).join('')}</div>`;
}

export function describeEvidenceExportResult(count: number, diagnostics: OutboxDiagnostics): string {
  const pending = diagnostics.savedAwaitingSync + diagnostics.hashing + diagnostics.awaitingStorage;
  const refused = `${diagnostics.saturated ? 'at least ' : ''}${diagnostics.refused.toLocaleString('en-US')}`;
  return `Exported ${count.toLocaleString('en-US')} committed journal ${count === 1 ? 'entry' : 'entries'}. `
    + `Capture status after export: ${pending.toLocaleString('en-US')} pending captures, ${refused} refused captures and `
    + `${diagnostics.terminalBlocked.toLocaleString('en-US')} rejected captures. `
    + (diagnostics.diagnosticsUnsaved ? 'Some capture diagnostics could not be saved. ' : '')
    + (diagnostics.blocked || diagnostics.quarantined > 0 ? 'Local capture admission is blocked or quarantined. ' : '')
    + 'The export does not confirm inclusion of those captures. New captures may arrive after the export cutoff.';
}

export function renderEvidenceJournalSection(
  state: EvidenceJournalViewState,
  exportState: EvidenceExportViewState,
  diagnostics?: OutboxDiagnostics,
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
          Entries accepted by the journal are kept without a rolling cap.
          Pending changes use a bounded local queue; capture failures are shown here.
          The journal stays on this Mac (excluded from Time Machine) and keeps scored fields only, never claim text or notes.
          Export a copy of accepted journal entries to keep a backup.
        </p>
        ${renderEvidenceCaptureDiagnostics(diagnostics)}
        <button type="button" class="evidence-journal-export" data-evidence-action="export"${disabled}>
          ${exportState.busy ? 'Exporting…' : 'Export calibration evidence'}
        </button>
        ${message}
      </section>`;
}
