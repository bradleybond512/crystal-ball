/**
 * Pure-renderer tests for src/services/export/enhanced-brief-generator.ts
 *
 * The renderer is fully pure (input → jsPDF). Tests fall into four buckets:
 *   1. Pure derivation helpers (deriveExecutiveSummary, formatTrendArrow,
 *      topWildfiresByThreat, computeFireThreatScore, formatAuroraLat)
 *   2. Page contract (cover page count, body page break, footer stamp)
 *   3. Empty-state contract (every section accepts empty/null and renders
 *      a placeholder rather than throwing)
 *   4. Filename / blob output shape
 *
 * jsPDF is exercised against its real API (no mock) — these tests catch
 * the kind of contract drift (renamed methods, signature changes) that
 * a mocked test would miss.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFireThreatScore,
  deriveExecutiveSummary,
  enhancedBriefPdfFilename,
  formatAuroraLat,
  formatTrendArrow,
  renderEnhancedBriefingPdf,
  renderEnhancedBriefingPdfBlob,
  topWildfiresByThreat,
  type EnhancedBriefingInput,
} from '../enhanced-brief-generator.ts';

/** Decode the PDF's binary output as latin-1 so test assertions can
 *  match against the literal text in content streams. jsPDF's
 *  `output('string')` returns null in Node; the arraybuffer path is
 *  the portable way to inspect what we actually wrote. */
function pdfText(doc: { output: (kind: 'arraybuffer') => ArrayBuffer }): string {
  return new TextDecoder('latin1').decode(doc.output('arraybuffer'));
}

const minimalInput: EnhancedBriefingInput = {
  threatMatrix: [],
  activeAlerts: [],
  spaceWeather: null,
  topWildfires: [],
  economicIndicators: [],
  feedHealth: [],
  dataCurrentAt: Date.parse('2026-05-08T12:00:00Z'),
  appVersion: '2.12.2',
};

// ── deriveExecutiveSummary ───────────────────────────────────────────

test('deriveExecutiveSummary: empty matrix → "no active threats" sentence', () => {
  const out = deriveExecutiveSummary([]);
  assert.match(out, /no active threats/i);
});

test('deriveExecutiveSummary: surfaces critical-severity domains by name', () => {
  const out = deriveExecutiveSummary([
    { domain: 'Weather', severity: 'critical', label: '1 active' },
    { domain: 'Cyber',   severity: 'high',     label: '3 active' },
  ]);
  assert.match(out, /1 critical-severity threat/);
  assert.match(out, /Weather/);
  assert.match(out, /1 high-severity in Cyber/);
  assert.match(out, /situational awareness elevated/);
});

test('deriveExecutiveSummary: low-only matrix → "low-severity activity only"', () => {
  const out = deriveExecutiveSummary([
    { domain: 'Maritime', severity: 'low', label: '2 active' },
  ]);
  assert.match(out, /low-severity activity only/);
});

test('deriveExecutiveSummary: lists three+ critical domains with Oxford comma', () => {
  const out = deriveExecutiveSummary([
    { domain: 'Weather', severity: 'critical', label: '1' },
    { domain: 'Cyber',   severity: 'critical', label: '1' },
    { domain: 'Energy',  severity: 'critical', label: '1' },
  ]);
  assert.match(out, /Weather, Cyber, and Energy/);
});

// ── formatTrendArrow ─────────────────────────────────────────────────

test('formatTrendArrow: null inputs → em dash', () => {
  assert.equal(formatTrendArrow(null, 100), '—');
  assert.equal(formatTrendArrow(100, null), '—');
});

test('formatTrendArrow: positive change → up arrow + percent', () => {
  const out = formatTrendArrow(110, 100);
  assert.equal(out, '↑ +10.0%');
});

test('formatTrendArrow: negative change → down arrow + percent', () => {
  const out = formatTrendArrow(90, 100);
  assert.equal(out, '↓ -10.0%');
});

test('formatTrendArrow: tiny change (<1%) → flat arrow', () => {
  assert.match(formatTrendArrow(100.5, 100), /^→/);
});

test('formatTrendArrow: zero baseline edge case', () => {
  assert.equal(formatTrendArrow(5, 0), '↑');
  assert.equal(formatTrendArrow(-5, 0), '↓');
  assert.equal(formatTrendArrow(0, 0), '→');
});

// ── computeFireThreatScore ────────────────────────────────────────────

test('computeFireThreatScore: 1000ac × 30% contained → 700', () => {
  assert.equal(computeFireThreatScore(1000, 30), 700);
});

test('computeFireThreatScore: null acreage → 0', () => {
  assert.equal(computeFireThreatScore(null, 50), 0);
  assert.equal(computeFireThreatScore(0, 50), 0);
});

test('computeFireThreatScore: null containment treated as 0% (worst case)', () => {
  assert.equal(computeFireThreatScore(500, null), 500);
});

test('computeFireThreatScore: containment clamped to [0,100]', () => {
  assert.equal(computeFireThreatScore(1000, 150), 0);     // clamped to 100% → 0 score
  assert.equal(computeFireThreatScore(1000, -10), 1000);  // clamped to 0% → full score
});

// ── topWildfiresByThreat ──────────────────────────────────────────────

test('topWildfiresByThreat: returns top 5 sorted desc by score', () => {
  const fires = Array.from({ length: 8 }, (_, i) => ({
    name: `F${i}`, state: 'CA', acres: 100 * (i + 1),
    containmentPct: 0, threatScore: 100 * (i + 1),
  }));
  const top = topWildfiresByThreat(fires);
  assert.equal(top.length, 5);
  assert.equal(top[0].name, 'F7');     // highest threatScore = 800
  assert.equal(top[4].name, 'F3');
});

test('topWildfiresByThreat: respects custom topN', () => {
  const fires = [
    { name: 'A', state: null, acres: 100, containmentPct: 0, threatScore: 100 },
    { name: 'B', state: null, acres: 200, containmentPct: 0, threatScore: 200 },
  ];
  assert.equal(topWildfiresByThreat(fires, 1).length, 1);
});

test('topWildfiresByThreat: empty input returns []', () => {
  assert.deepEqual(topWildfiresByThreat([]), []);
});

// ── formatAuroraLat ───────────────────────────────────────────────────

test('formatAuroraLat: null → "Not visible"', () => {
  assert.match(formatAuroraLat(null), /Not visible/);
});

test('formatAuroraLat: 65°N → "Visible from 65°N or higher"', () => {
  assert.equal(formatAuroraLat(65), 'Visible from 65°N or higher');
});

test('formatAuroraLat: 89+ treated as not visible', () => {
  assert.match(formatAuroraLat(89), /Not visible/);
});

// ── renderEnhancedBriefingPdf — page / output contract ───────────────

test('renderEnhancedBriefingPdf: minimal input still produces ≥2 pages (cover + body)', () => {
  const doc = renderEnhancedBriefingPdf(minimalInput);
  assert.ok(doc.getNumberOfPages() >= 2, `expected ≥2 pages, got ${doc.getNumberOfPages()}`);
});

test('renderEnhancedBriefingPdf: all-empty sections render placeholders without throwing', () => {
  // The point of this test: every section's empty branch must be reachable.
  const doc = renderEnhancedBriefingPdf(minimalInput);
  const pdfStr = pdfText(doc);
  // Empty markers from each section.
  assert.match(pdfStr, /No active threats in matrix/);
  assert.match(pdfStr, /No active alerts/);
  assert.match(pdfStr, /Space-weather data unavailable/);
  assert.match(pdfStr, /No active wildfire incidents/);
  assert.match(pdfStr, /Economic stress feed not available/);
  assert.match(pdfStr, /Feed health snapshot unavailable/);
});

test('renderEnhancedBriefingPdf: large input adds pages (page break works)', () => {
  const huge: EnhancedBriefingInput = {
    ...minimalInput,
    threatMatrix: Array.from({ length: 30 }, (_, i) => ({
      domain: `Domain ${i}`, severity: 'high', label: '1 active',
    })),
    activeAlerts: Array.from({ length: 25 }, (_, i) => ({
      source: 'NWS', title: `Long alert title number ${i} that takes up real space`,
      severity: 'high' as const, location: `Place ${i}, State`,
    })),
  };
  const doc = renderEnhancedBriefingPdf(huge);
  assert.ok(doc.getNumberOfPages() >= 3, `expected page break, got ${doc.getNumberOfPages()} pages`);
});

test('renderEnhancedBriefingPdf: cover page includes title + classification + version', () => {
  const doc = renderEnhancedBriefingPdf(minimalInput, { classification: 'UNCLASSIFIED' });
  const pdfStr = pdfText(doc);
  assert.match(pdfStr, /CRYSTAL BALL INTELLIGENCE BRIEF/);
  assert.match(pdfStr, /UNCLASSIFIED/);
  assert.match(pdfStr, /Crystal Ball v2\.12\.2/);
});

test('renderEnhancedBriefingPdf: footer carries data-current-as-of timestamp', () => {
  const doc = renderEnhancedBriefingPdf(minimalInput);
  const pdfStr = pdfText(doc);
  assert.match(pdfStr, /Data current as of 2026-05-08/);
});

test('renderEnhancedBriefingPdf: caller-supplied executiveSummary wins over derived', () => {
  const doc = renderEnhancedBriefingPdf({
    ...minimalInput,
    executiveSummary: 'A bespoke executive summary the AI brief produced.',
    threatMatrix: [{ domain: 'Cyber', severity: 'critical', label: '1 active' }],
  });
  const pdfStr = pdfText(doc);
  assert.match(pdfStr, /bespoke executive summary/);
  // The derived path's "1 critical-severity" would also fire — but only when
  // executiveSummary is empty. Confirm it didn't fire here.
  assert.doesNotMatch(pdfStr, /1 critical-severity threat/);
});

test('renderEnhancedBriefingPdf: feed-health rows render with status indicator', () => {
  const doc = renderEnhancedBriefingPdf({
    ...minimalInput,
    feedHealth: [
      { feedId: 'nws',  label: 'NWS Weather Alerts', status: 'green', ageSeconds: 30 },
      { feedId: 'eew',  label: 'USGS EEW',           status: 'red',   ageSeconds: 7200 },
    ],
  });
  const pdfStr = pdfText(doc);
  assert.match(pdfStr, /NWS Weather Alerts/);
  assert.match(pdfStr, /USGS EEW/);
  assert.match(pdfStr, /2h ago/);     // age formatter for 7200s
});

test('renderEnhancedBriefingPdfBlob: returns a Blob with PDF mime type', () => {
  const blob = renderEnhancedBriefingPdfBlob(minimalInput);
  assert.ok(blob instanceof Blob);
  assert.equal(blob.type, 'application/pdf');
  assert.ok(blob.size > 0);
});

test('enhancedBriefPdfFilename: uses ISO date prefix', () => {
  const fn = enhancedBriefPdfFilename(minimalInput);
  assert.equal(fn, 'crystal-ball-intel-brief-2026-05-08.pdf');
});
