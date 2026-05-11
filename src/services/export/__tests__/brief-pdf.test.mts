import assert from 'node:assert/strict';
import test from 'node:test';

import {
  briefPdfFilename,
  renderBriefingPdf,
  renderBriefingPdfBase64,
  renderBriefingPdfBlob,
} from '../brief-pdf.ts';
import type { IntelligenceBriefing } from '../../intelligence-briefing.ts';

const SHORT_BRIEFING: IntelligenceBriefing = {
  id: 'brief-2026-04-15-1200',
  generatedAt: Date.parse('2026-04-15T12:00:00Z'),
  provider: 'claude',
  raw: 'Short briefing with two sections.',
  sections: [
    {
      type: 'executive-summary',
      title: 'Executive Summary',
      content: 'Active critical situations: 2. Elevated watch items: 4. Markets: stable.',
      severity: 'high',
    },
    {
      type: 'active-threats',
      title: 'Active Threats',
      content: '',
      severity: 'critical',
      items: [
        { title: 'M5.4 quake near Mosul', detail: 'Reviewed by USGS NEIC; PAGER yellow.', severity: 'high' },
        { title: 'Severe Thunderstorm Warning Bucks Co.', detail: '60 mph winds, 1" hail; expires 13:30Z.', severity: 'high' },
      ],
    },
  ],
};

const EMPTY_BRIEFING: IntelligenceBriefing = {
  id: 'brief-empty', generatedAt: Date.parse('2026-04-15T00:00:00Z'),
  provider: 'browser', raw: '', sections: [],
};

// ── Page count + structure ───────────────────────────────────────────

test('renderBriefingPdf: short briefing fits on a single page', () => {
  const doc = renderBriefingPdf(SHORT_BRIEFING);
  assert.equal(doc.getNumberOfPages(), 1);
});

test('renderBriefingPdf: empty briefing still produces one page (no crash)', () => {
  const doc = renderBriefingPdf(EMPTY_BRIEFING);
  assert.equal(doc.getNumberOfPages(), 1);
});

test('renderBriefingPdf: long content overflows to multiple pages', () => {
  const long = 'Lorem ipsum dolor sit amet consectetur adipiscing elit. '.repeat(200);
  const briefing: IntelligenceBriefing = {
    ...SHORT_BRIEFING,
    sections: [
      { type: 'executive-summary', title: 'Long', content: long, severity: 'medium' },
    ],
  };
  const doc = renderBriefingPdf(briefing);
  assert.ok(doc.getNumberOfPages() >= 2, `expected ≥2 pages, got ${doc.getNumberOfPages()}`);
});

test('renderBriefingPdf: many items also force a page break', () => {
  const items = Array.from({ length: 60 }, (_, i) => ({
    title: `Item ${i + 1}`,
    detail: `Detail for item ${i + 1}. ${'x'.repeat(120)}`,
    severity: 'low' as const,
  }));
  const briefing: IntelligenceBriefing = {
    ...SHORT_BRIEFING,
    sections: [
      { type: 'active-threats', title: 'Threats', content: '', severity: 'high', items },
    ],
  };
  const doc = renderBriefingPdf(briefing);
  assert.ok(doc.getNumberOfPages() >= 2);
});

// ── Footer / classification stamp ────────────────────────────────────

test('renderBriefingPdf: default classification stamp is present', () => {
  const doc = renderBriefingPdf(SHORT_BRIEFING);
  // jsPDF returns a string from output('text') that includes the
  // rendered text on the page. We assert the classification line
  // appears in the data uri (base64-decoded would be heavier).
  const dataUri = doc.output('datauristring');
  // PDF text shows up as literal substrings in the encoded stream for
  // simple Helvetica usage — adequate for a smoke check.
  const decoded = Buffer.from(dataUri.split(',')[1] ?? '', 'base64').toString('binary');
  assert.ok(
    decoded.includes('UNCLASSIFIED') || decoded.includes('FOR OFFICIAL USE ONLY'),
    'default classification stamp should appear in the PDF stream',
  );
});

test('renderBriefingPdf: custom classification overrides the default', () => {
  const doc = renderBriefingPdf(SHORT_BRIEFING, { classification: 'PUBLIC' });
  const dataUri = doc.output('datauristring');
  const decoded = Buffer.from(dataUri.split(',')[1] ?? '', 'base64').toString('binary');
  assert.ok(decoded.includes('PUBLIC'));
});

test('renderBriefingPdf: custom title overrides the default', () => {
  const doc = renderBriefingPdf(SHORT_BRIEFING, { title: 'CUSTOM BRIEF' });
  const dataUri = doc.output('datauristring');
  const decoded = Buffer.from(dataUri.split(',')[1] ?? '', 'base64').toString('binary');
  assert.ok(decoded.includes('CUSTOM BRIEF'));
});

// ── Output helpers ───────────────────────────────────────────────────

test('renderBriefingPdfBlob: returns a Blob with type application/pdf', () => {
  const blob = renderBriefingPdfBlob(SHORT_BRIEFING);
  assert.equal(blob.type, 'application/pdf');
  assert.ok(blob.size > 0);
});

test('renderBriefingPdfBase64: returns a non-empty string with no data URI prefix', () => {
  const b64 = renderBriefingPdfBase64(SHORT_BRIEFING);
  assert.ok(b64.length > 0);
  assert.ok(!b64.startsWith('data:'));
  // Decodes to a PDF byte stream — first 4 bytes should be %PDF.
  const head = Buffer.from(b64.slice(0, 8), 'base64').toString('binary');
  assert.equal(head.slice(0, 4), '%PDF');
});

// ── Filename ─────────────────────────────────────────────────────────

test('briefPdfFilename: yields crystal-ball-brief-YYYY-MM-DD.pdf in UTC', () => {
  assert.equal(briefPdfFilename(SHORT_BRIEFING), 'crystal-ball-brief-2026-04-15.pdf');
});

test('briefPdfFilename: empty-briefing UTC date still works', () => {
  assert.equal(briefPdfFilename(EMPTY_BRIEFING), 'crystal-ball-brief-2026-04-15.pdf');
});
