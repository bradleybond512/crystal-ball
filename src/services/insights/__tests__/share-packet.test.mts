import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSharePacket,
  selectFormat,
  type ProvenanceEntry,
  type DiagnosticsAppendix,
} from '../share-packet.ts';
import type { BriefingContent } from '../presentation-export.ts';

const NOW = 1_745_000_000_000;

function briefing(): BriefingContent {
  return {
    title: 'Tornado warning at home',
    generatedAt: NOW,
    summary: 'Severe tornado approaching saved place "Home"; lead time 22 minutes.',
    metadata: [
      { label: 'Domain', value: 'weather' },
      { label: 'Severity', value: 'CRITICAL' },
    ],
    sections: [
      {
        heading: 'What is happening',
        bullets: [
          'NWS Tornado Warning issued',
          'Polygon overlaps Home',
          'Wind gust tag: 70 mph',
        ],
      },
    ],
  };
}

const PROVENANCE: ProvenanceEntry[] = [
  { sourceId: 'nws', label: 'NWS Alerts', claim: 'Tornado Warning polygon issued', observedAt: NOW, confidence: 0.95 },
  { sourceId: 'radar', label: 'NOAA Radar', claim: 'Hook echo within 15 km of Home', observedAt: NOW, confidence: 0.85 },
];

const DIAGNOSTICS: DiagnosticsAppendix = {
  whyOrWhyNot: 'Warning delivered: NWS polygon → saved-place match → critical rung.',
  trace: [
    { stage: 'alert-received', outcome: 'ok', at: NOW - 1000 },
    { stage: 'polygon-match', outcome: 'ok', reason: 'Home inside polygon' },
    { stage: 'router-decision', outcome: 'ok', reason: 'Critical rung' },
  ],
  remediation: ['none — delivered correctly'],
};

// ── Build ───────────────────────────────────────────────────────────────

test('buildSharePacket: returns all four formats', () => {
  const p = buildSharePacket({ shareId: 'sh-1', now: () => NOW, briefing: briefing() });
  assert.equal(p.shareId, 'sh-1');
  assert.equal(p.generatedAt, NOW);
  assert.ok(typeof p.markdown === 'string' && p.markdown.length > 0);
  assert.ok(typeof p.clipboard === 'string');
  assert.ok(typeof p.shareSheet === 'string');
  assert.ok(typeof p.claudeDebug === 'string');
});

test('buildSharePacket: markdown includes the briefing title', () => {
  const p = buildSharePacket({ shareId: 'sh-1', now: () => NOW, briefing: briefing() });
  assert.match(p.markdown, /Tornado warning/);
});

test('shareId surfaces as a metadata row', () => {
  const p = buildSharePacket({ shareId: 'sh-XYZ', now: () => NOW, briefing: briefing() });
  // Metadata is appended to the enriched briefing.
  assert.ok(p.briefing.metadata?.some((m) => m.label === 'Share ID' && m.value === 'sh-XYZ'));
});

test('followUpUrl appears as a metadata row', () => {
  const p = buildSharePacket({
    shareId: 'sh-1',
    now: () => NOW,
    briefing: briefing(),
    followUpUrl: 'https://crystalball.local/event/123',
  });
  assert.ok(p.briefing.metadata?.some((m) => m.label === 'Follow-up'));
});

// ── Provenance appendix ────────────────────────────────────────────────

test('provenance entries appear as a Sources section in the briefing', () => {
  const p = buildSharePacket({
    shareId: 'sh-1',
    now: () => NOW,
    briefing: briefing(),
    provenance: PROVENANCE,
  });
  const sources = p.briefing.sections.find((s) => s.heading === 'Sources');
  assert.ok(sources);
  assert.equal(sources!.bullets?.length, 2);
  assert.match(sources!.bullets?.[0] ?? '', /NWS Alerts/);
  assert.match(sources!.bullets?.[0] ?? '', /confidence 95%/);
});

test('empty provenance produces no Sources section', () => {
  const p = buildSharePacket({
    shareId: 'sh-1',
    now: () => NOW,
    briefing: briefing(),
    provenance: [],
  });
  const sources = p.briefing.sections.find((s) => s.heading === 'Sources');
  assert.equal(sources, undefined);
});

// ── Diagnostics appendix ───────────────────────────────────────────────

test('diagnostics appears as a Why-or-why-not section', () => {
  const p = buildSharePacket({
    shareId: 'sh-1',
    now: () => NOW,
    briefing: briefing(),
    diagnostics: DIAGNOSTICS,
  });
  const diag = p.briefing.sections.find((s) => s.heading === 'Why or why not');
  assert.ok(diag);
  // First bullet is the headline; subsequent bullets are trace stages.
  assert.equal(diag!.bullets?.[0], DIAGNOSTICS.whyOrWhyNot);
  assert.ok((diag!.bullets?.length ?? 0) >= 4);
});

// ── selectFormat ───────────────────────────────────────────────────────

test('selectFormat returns the right string for each format', () => {
  const p = buildSharePacket({ shareId: 'sh-1', now: () => NOW, briefing: briefing() });
  assert.equal(selectFormat(p, 'markdown'), p.markdown);
  assert.equal(selectFormat(p, 'clipboard'), p.clipboard);
  assert.equal(selectFormat(p, 'share_sheet'), p.shareSheet);
  assert.equal(selectFormat(p, 'claude_debug'), p.claudeDebug);
});

// ── JSON ───────────────────────────────────────────────────────────────

test('packet is JSON-serializable', () => {
  const p = buildSharePacket({
    shareId: 'sh-1',
    now: () => NOW,
    briefing: briefing(),
    provenance: PROVENANCE,
    diagnostics: DIAGNOSTICS,
  });
  const parsed = JSON.parse(JSON.stringify(p)) as { shareId: string };
  assert.equal(parsed.shareId, 'sh-1');
});
