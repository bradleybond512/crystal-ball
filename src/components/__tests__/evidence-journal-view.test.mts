/** R4-LOW-008: evidence journal section markup in Belief Calibration. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { OutboxDiagnostics } from '../../services/intelligence/evidence-outbox.ts';
import type { EvidenceSummary } from '../../services/intelligence/evidence-journal.ts';
import { describeEvidenceJournal, renderEvidenceJournalSection } from '../evidence-journal-view.ts';

function summary(overrides: Partial<EvidenceSummary> = {}): EvidenceSummary {
  return {
    total: 3,
    byKind: { forecast: 2, 'alert-outcome': 1, 'ema-forecast': 0, 'ema-forecast-totals': 0 },
    sizeBytes: 4096,
    maxBytes: 256 * 1024 * 1024,
    chain: { ok: true, count: 3 },
    lastAppendedAt: 1_790_000_000_000,
    ...overrides,
  };
}

test('ready state reports counts and a verified chain, with export enabled', () => {
  const state = { status: 'ready' as const, summary: summary() };
  assert.equal(
    describeEvidenceJournal(state),
    '3 entries (2 forecast entries, 1 alert outcome entry, 0 EMA forecast entries) · hash chain verified',
  );
  const html = renderEvidenceJournalSection(state, { busy: false });
  assert.match(html, /data-evidence-action="export">/);
  assert.doesNotMatch(html, /evidence-journal-warning/);
  assert.match(html, /excluded from Time Machine/);
  assert.match(html, /Entries accepted by the journal are kept without a rolling cap/);
  assert.match(html, /Export a copy of accepted journal entries to keep a backup/);
  assert.doesNotMatch(html, /Every forecast|kept here permanently|with no rolling cap/);
});

test('unavailable and busy states disable export', () => {
  assert.match(renderEvidenceJournalSection({ status: 'unavailable' }, { busy: false }), /data-evidence-action="export" disabled/);
  const busy = renderEvidenceJournalSection({ status: 'ready', summary: summary() }, { busy: true });
  assert.match(busy, /disabled/);
  assert.match(busy, /Exporting/);
});

test('a broken chain or a nearly full journal shows a warning', () => {
  const broken = renderEvidenceJournalSection(
    { status: 'ready', summary: summary({ chain: { ok: false, count: 6, brokenAtSeq: 7 } }) },
    { busy: false },
  );
  assert.match(broken, /hash chain broken at entry 7/);
  assert.match(broken, /changed outside the app/);
  const head = describeEvidenceJournal({ status: 'ready', summary: summary({ chain: { ok: false, count: 3, brokenAtSeq: null, reason: 'head mismatch' } }) });
  assert.match(head, /head does not match/);
  const full = renderEvidenceJournalSection(
    { status: 'ready', summary: summary({ sizeBytes: 250 * 1024 * 1024 }) },
    { busy: false },
  );
  assert.match(full, /refused, never deleted/);
});

test('export messages are escaped', () => {
  const html = renderEvidenceJournalSection(
    { status: 'ready', summary: summary() },
    { busy: false, error: true, message: '<img src=x onerror=alert(1)>' },
  );
  assert.equal(html.includes('<img'), false);
  assert.match(html, /&lt;img/);
});

function diagnostics(overrides: Partial<OutboxDiagnostics> = {}): OutboxDiagnostics {
  return {
    savedAwaitingSync: 0, hashing: 0, awaitingStorage: 0, terminalBlocked: 0,
    refused: 0, interrupted: 0, quarantined: 0, blocked: false,
    diagnosticsUnsaved: false, storageFailures: 0, saturated: false,
    lastReason: null, lastRefusedAt: null, byReason: {}, byKind: {}, journalFull: false,
    slots: 0, reservedBytes: 0, transientBytes: 0, workers: 0,
    highWater: { slots: 0, reservedBytes: 0, transientBytes: 0, workers: 0 },
    limits: { slots: 4096, storageBytes: 2097152, transientBytes: 2097152, inputBytes: 8192, payloadBytes: 4096, workers: 4 },
    ...overrides,
  };
}

test('local pending counts remain visible while the journal is unavailable', () => {
  const html = renderEvidenceJournalSection({ status: 'unavailable' }, { busy: false }, diagnostics({
    savedAwaitingSync: 12, hashing: 3, awaitingStorage: 2,
  }));
  assert.match(html, /12 scored changes saved locally and awaiting sync/);
  assert.match(html, /3 captures hashing; scored fields not yet saved/);
  assert.match(html, /2 scored changes awaiting local storage; not saved/);
  assert.match(html, /saved pending changes survive renderer restart while local storage is preserved/i);
  assert.match(html, /Restart before hashing or storage completes can lose those captures/);
  assert.match(html, /Resetting local storage can lose pending changes and capture diagnostics/);
  assert.match(html, /data-evidence-action="export" disabled/);
});

test('refused interrupted rejected and quarantined captures are visible with quota and capacity limits', () => {
  const html = renderEvidenceJournalSection({ status: 'loading' }, { busy: false }, diagnostics({
    refused: 9, interrupted: 3, terminalBlocked: 2, quarantined: 1,
    blocked: true, diagnosticsUnsaved: true, storageFailures: 4, saturated: true,
    lastReason: 'storage-quota', journalFull: true,
    byReason: { 'storage-quota': 5, capacity: 2 },
    slots: 4096, reservedBytes: 2097152, transientBytes: 1024,
  }));
  assert.match(html, /at least 9 captures refused/);
  assert.match(html, /at least 3 captures interrupted before scored fields were saved/);
  assert.match(html, /2 rejected captures blocked/);
  assert.match(html, /1 quarantined local slot/);
  assert.match(html, /at least 4 local storage failures/);
  assert.match(html, /at least 5 quota refusals/);
  assert.match(html, /at least 2 capacity refusals/);
  assert.match(html, /Last refusal: storage-quota/);
  assert.match(html, /Capture admission blocked/);
  assert.match(html, /Journal full; pending changes retained/);
  assert.match(html, /Some capture diagnostics could not be saved/);
  assert.match(html, /4,096 of 4,096 slots/);
  assert.match(html, /2,097,152 of 2,097,152 reserved storage bytes/);
  assert.match(html, /1,024 of 2,097,152 transient bytes/);
});

test('capture diagnostics escape dynamic labels and numeric formatting', () => {
  const injected = '<img src=x onerror=alert(1)>';
  const hostileNumber = { toLocaleString: () => injected } as unknown as number;
  const html = renderEvidenceJournalSection({ status: 'unavailable' }, { busy: false }, diagnostics({
    lastReason: injected as OutboxDiagnostics['lastReason'], refused: hostileNumber,
    limits: { ...diagnostics().limits, storageBytes: hostileNumber },
  }));
  assert.equal(html.includes('<img'), false);
  assert.match(html, /Last refusal: &lt;img/);
  assert.match(html, /&lt;img/);
});

test('export result warns that pending and refused captures are not backed up', () => {
  const html = renderEvidenceJournalSection({ status: 'ready', summary: summary() }, {
    busy: false, message: 'Exported 3 committed journal entries.',
  }, diagnostics({ savedAwaitingSync: 2, refused: 7, terminalBlocked: 1 }));
  assert.match(html, /Exported 3 committed journal entries/);
  assert.match(html, /Exports contain accepted journal entries only; do not treat them as a backup of pending, refused or rejected captures/);
  assert.match(html, /2 scored changes saved locally and awaiting sync/);
  assert.match(html, /7 captures refused/);
  assert.match(html, /1 rejected capture blocked/);
});
