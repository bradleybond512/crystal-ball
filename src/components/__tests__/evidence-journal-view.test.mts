/** R4-LOW-008: evidence journal section markup in Belief Calibration. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

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
