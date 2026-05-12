/**
 * Tests for the three new PDF sections added in the PDF brief upgrade:
 *   — Cross-domain correlations
 *   — Shortage radar
 *   — Personalized alerts — saved places
 *
 * Covers pure helpers only (no jsPDF rendering calls needed for the
 * logic under test). Follows the node:test + node:assert/strict pattern
 * used throughout this project.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  topCorrelationsByConfidence,
  formatCorrelationLine,
  formatShortageArrow,
  prettifyCommodity,
  formatPersonalAlertLine,
  type CorrelationEntry,
  type PersonalizedAlertEntry,
} from '../enhanced-brief-generator.ts';

// ── topCorrelationsByConfidence ──────────────────────────────────────

test('topCorrelationsByConfidence: returns top 5 sorted by confidence desc', () => {
  const entries: CorrelationEntry[] = Array.from({ length: 8 }, (_, i) => ({
    type: 'spatial' as const,
    confidence: (i + 1) / 10,   // 0.1 … 0.8
    title: `Event ${i}`,
    detectedAt: Date.now(),
  }));
  const top = topCorrelationsByConfidence(entries);
  assert.equal(top.length, 5);
  // Highest confidence first.
  assert.equal(top[0].confidence, 0.8);
  assert.equal(top[1].confidence, 0.7);
  assert.equal(top[4].confidence, 0.4);
});

test('topCorrelationsByConfidence: caps at topN when specified', () => {
  const entries: CorrelationEntry[] = Array.from({ length: 10 }, (_, i) => ({
    type: 'temporal' as const,
    confidence: (i + 1) / 10,
    title: `E${i}`,
    detectedAt: Date.now(),
  }));
  const top3 = topCorrelationsByConfidence(entries, 3);
  assert.equal(top3.length, 3);
  assert.equal(top3[0].confidence, 1.0);
});

// ── formatCorrelationLine ────────────────────────────────────────────

test('formatCorrelationLine: formats type uppercase, confidence as integer pct', () => {
  const entry: CorrelationEntry = {
    type: 'spatial',
    confidence: 0.87,
    title: 'Event A (aviation) + Event B (earthquake) — spatial + earthquake correlation',
    detectedAt: Date.now(),
  };
  const line = formatCorrelationLine(entry);
  assert.ok(line.startsWith('[SPATIAL]'), `expected "[SPATIAL]" prefix, got: ${line}`);
  assert.match(line, /87% confidence/);
  assert.match(line, /Event A \(aviation\)/);
});

test('formatCorrelationLine: rounds confidence to nearest integer', () => {
  const entry: CorrelationEntry = {
    type: 'entity',
    confidence: 0.334,
    title: 'Some correlation',
    detectedAt: Date.now(),
  };
  const line = formatCorrelationLine(entry);
  assert.match(line, /\[ENTITY\]/);
  assert.match(line, /33% confidence/);
});

// ── formatShortageArrow ──────────────────────────────────────────────

test('formatShortageArrow: rising → ↑', () => {
  assert.equal(formatShortageArrow('rising'), '↑');
});

test('formatShortageArrow: falling → ↓', () => {
  assert.equal(formatShortageArrow('falling'), '↓');
});

test('formatShortageArrow: stable → →', () => {
  assert.equal(formatShortageArrow('stable'), '→');
});

test('formatShortageArrow: unknown value defaults to →', () => {
  assert.equal(formatShortageArrow('unknown'), '→');
  assert.equal(formatShortageArrow(''), '→');
});

// ── prettifyCommodity ────────────────────────────────────────────────

test('prettifyCommodity: simple name → capitalized', () => {
  assert.equal(prettifyCommodity('wheat'), 'Wheat');
  assert.equal(prettifyCommodity('diesel'), 'Diesel');
});

test('prettifyCommodity: hyphenated name → title-cased with spaces', () => {
  assert.equal(prettifyCommodity('natural-gas'), 'Natural Gas');
  assert.equal(prettifyCommodity('jet-fuel'), 'Jet Fuel');
});

// ── formatPersonalAlertLine ──────────────────────────────────────────

test('formatPersonalAlertLine: produces correct bullet text', () => {
  const entry: PersonalizedAlertEntry = {
    placeName: 'La Porte, IN',
    eventCount: 3,
    topEventTitle: 'Tornado Warning',
    topSeverity: 9,
  };
  const line = formatPersonalAlertLine(entry);
  assert.equal(
    line,
    'Events near La Porte, IN: 3 alerts — top: Tornado Warning (severity 9/10)',
  );
});

test('formatPersonalAlertLine: handles single event correctly', () => {
  const entry: PersonalizedAlertEntry = {
    placeName: 'Chicago, IL',
    eventCount: 1,
    topEventTitle: 'Winter Storm Watch',
    topSeverity: 5,
  };
  const line = formatPersonalAlertLine(entry);
  assert.match(line, /Events near Chicago, IL: 1 alerts/);
  assert.match(line, /severity 5\/10/);
});
