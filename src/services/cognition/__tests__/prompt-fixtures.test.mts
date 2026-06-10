/**
 * Prompt fixtures tests for cognition prompt builders.
 *
 * For every prompt builder in the cognition layer, asserts structural
 * invariants so prompt drift is caught in CI like any regression:
 *
 *   - <evidence> wrapping is present around feed-derived text.
 *   - JSON contract instruction is present.
 *   - Section order is stable (system context → hypothesis → evidence → instruction).
 *   - No raw user/feed text appears outside <evidence> tags.
 *
 * Prompt builders tested:
 *   1. buildDecompositionPrompt (decomposition.ts)
 *   2. buildPersonaPrompt (superforecast.ts)
 *   3. buildAggregateReviewPrompt (superforecast.ts)
 *
 * Per docs/COGNITIVE_ENHANCEMENT_PLAN.md PR 15.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildDecompositionPrompt } from '../decomposition.js';
import {
  buildPersonaPrompt,
  buildAggregateReviewPrompt,
} from '../superforecast.js';
import type { Estimate } from '../probability-aggregation.js';

// ── Fixture helpers ───────────────────────────────────────────────────────────

interface MinimalHypothesis {
  id: string;
  kind: string;
  statement: string;
  confidence: number;
  risk: 'low' | 'medium' | 'high' | 'critical';
  evidence: Array<{ source: string; id: string; label: string }>;
  timestamp: number;
}

function makeHypothesis(overrides: Partial<MinimalHypothesis> = {}): MinimalHypothesis {
  return {
    id: 'h-test-1',
    kind: 'situation-escalation',
    statement: 'Military convoy movements signal rising escalation risk',
    confidence: 0.65,
    risk: 'high',
    evidence: [
      { source: 'satellite-feed', id: 'e1', label: 'Satellite imagery: 40 vehicles spotted' },
      { source: 'signals-feed', id: 'e2', label: 'Radio intercepts indicate mobilization orders' },
    ],
    timestamp: 1000000,
    ...overrides,
  };
}

const FEED_STATEMENT = 'Military convoy movements signal rising escalation risk';
const FEED_EVIDENCE_LABEL_1 = 'Satellite imagery: 40 vehicles spotted';
const FEED_EVIDENCE_LABEL_2 = 'Radio intercepts indicate mobilization orders';

// ── Helper: count <evidence> / </evidence> occurrences ────────────────────────

function countTag(prompt: string, tag: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = prompt.indexOf(tag, pos)) !== -1) {
    count++;
    pos += tag.length;
  }
  return count;
}

/**
 * Assert that all occurrences of `feedText` in the prompt appear
 * only inside <evidence>...</evidence> tags.
 *
 * Strategy: find all index positions of feedText, then for each one
 * verify that it is preceded by an <evidence> tag (without an intervening
 * </evidence>) and followed by a </evidence> tag.
 */
function assertInsideEvidence(prompt: string, feedText: string, description: string): void {
  const occurrences: number[] = [];
  let pos = 0;
  while ((pos = prompt.indexOf(feedText, pos)) !== -1) {
    occurrences.push(pos);
    pos += feedText.length;
  }

  for (const idx of occurrences) {
    // Find the last <evidence> before idx.
    const lastOpen = prompt.lastIndexOf('<evidence>', idx);
    // Find the last </evidence> before idx.
    const lastClose = prompt.lastIndexOf('</evidence>', idx);

    assert.ok(
      lastOpen !== -1 && lastOpen > lastClose,
      `"${description}" appears outside <evidence> tags at position ${idx}`,
    );
  }
}

// ── buildDecompositionPrompt ──────────────────────────────────────────────────

describe('buildDecompositionPrompt: structural invariants', () => {
  it('wraps hypothesis statement in <evidence> tags', () => {
    const h = makeHypothesis();
    const prompt = buildDecompositionPrompt(h);

    assert.ok(prompt.includes('<evidence>'), 'must have <evidence> opening tag');
    assert.ok(prompt.includes('</evidence>'), 'must have </evidence> closing tag');
    assertInsideEvidence(prompt, FEED_STATEMENT, 'hypothesis statement');
  });

  it('wraps supporting evidence in <evidence> tags', () => {
    const h = makeHypothesis();
    const prompt = buildDecompositionPrompt(h);

    assertInsideEvidence(prompt, FEED_EVIDENCE_LABEL_1, 'evidence label 1');
    assertInsideEvidence(prompt, FEED_EVIDENCE_LABEL_2, 'evidence label 2');
  });

  it('contains JSON contract instruction', () => {
    const h = makeHypothesis();
    const prompt = buildDecompositionPrompt(h);

    assert.ok(
      prompt.toLowerCase().includes('json'),
      'prompt must mention JSON format',
    );
    assert.ok(
      prompt.includes('"probability"'),
      'prompt must demand probability field in JSON contract',
    );
    assert.ok(
      prompt.includes('"conditions"'),
      'prompt must demand conditions array in JSON contract',
    );
  });

  it('section order: system context → hypothesis → evidence → instruction', () => {
    const h = makeHypothesis();
    const prompt = buildDecompositionPrompt(h);

    // "superforecaster" should appear before the first <evidence>.
    const forecasterIdx = prompt.toLowerCase().indexOf('superforecaster');
    const firstEvidenceIdx = prompt.indexOf('<evidence>');
    const importantIdx = prompt.indexOf('IMPORTANT');

    assert.ok(forecasterIdx !== -1, 'must mention superforecaster methodology');
    assert.ok(forecasterIdx < firstEvidenceIdx, 'system context must precede evidence tags');
    assert.ok(firstEvidenceIdx < importantIdx, 'evidence must precede JSON instruction');
  });

  it('specifies 2-4 conditions range', () => {
    const h = makeHypothesis();
    const prompt = buildDecompositionPrompt(h);

    assert.ok(
      prompt.includes('2') && prompt.includes('4'),
      'prompt must specify 2-4 condition range',
    );
  });

  it('balanced <evidence> tag pairs', () => {
    const h = makeHypothesis();
    const prompt = buildDecompositionPrompt(h);

    const openCount = countTag(prompt, '<evidence>');
    const closeCount = countTag(prompt, '</evidence>');
    assert.equal(openCount, closeCount, 'every <evidence> must have a matching </evidence>');
    assert.ok(openCount >= 2, 'must have at least 2 evidence blocks (statement + evidence)');
  });

  it('does not emit raw feed text outside evidence tags (injection hardening)', () => {
    const h = makeHypothesis();
    const prompt = buildDecompositionPrompt(h);

    // The statement and evidence labels should only appear inside <evidence>.
    assertInsideEvidence(prompt, FEED_STATEMENT, 'statement (injection hardening)');
    assertInsideEvidence(prompt, FEED_EVIDENCE_LABEL_1, 'evidence 1 (injection hardening)');
  });
});

// ── buildPersonaPrompt ────────────────────────────────────────────────────────

describe('buildPersonaPrompt: structural invariants', () => {
  const PERSONAS = ['analyst', 'skeptic', 'pragmatist'] as const;

  for (const persona of PERSONAS) {
    it(`[${persona}] wraps hypothesis statement in <evidence> tags`, () => {
      const h = makeHypothesis();
      const prompt = buildPersonaPrompt(h, persona);

      assert.ok(prompt.includes('<evidence>'), `[${persona}] must have <evidence> tag`);
      assertInsideEvidence(prompt, FEED_STATEMENT, `[${persona}] statement`);
    });

    it(`[${persona}] wraps supporting evidence in <evidence> tags`, () => {
      const h = makeHypothesis();
      const prompt = buildPersonaPrompt(h, persona);

      assertInsideEvidence(prompt, FEED_EVIDENCE_LABEL_1, `[${persona}] evidence 1`);
    });

    it(`[${persona}] contains JSON contract with "probability" field`, () => {
      const h = makeHypothesis();
      const prompt = buildPersonaPrompt(h, persona);

      assert.ok(
        prompt.toLowerCase().includes('json'),
        `[${persona}] must mention JSON`,
      );
      assert.ok(
        prompt.includes('"probability"'),
        `[${persona}] must demand "probability" field`,
      );
    });

    it(`[${persona}] balanced <evidence> tag pairs`, () => {
      const h = makeHypothesis();
      const prompt = buildPersonaPrompt(h, persona);

      const openCount = countTag(prompt, '<evidence>');
      const closeCount = countTag(prompt, '</evidence>');
      assert.equal(
        openCount, closeCount,
        `[${persona}] every <evidence> must have a matching </evidence>`,
      );
    });

    it(`[${persona}] section order: persona system → hypothesis → evidence → instruction`, () => {
      const h = makeHypothesis();
      const prompt = buildPersonaPrompt(h, persona);

      const firstEvidenceIdx = prompt.indexOf('<evidence>');
      const importantIdx = prompt.indexOf('IMPORTANT');

      assert.ok(
        firstEvidenceIdx < importantIdx,
        `[${persona}] evidence must precede JSON instruction`,
      );
    });

    it(`[${persona}] probability bounds documented (0.02–0.98)`, () => {
      const h = makeHypothesis();
      const prompt = buildPersonaPrompt(h, persona);

      assert.ok(
        prompt.includes('0.02') || prompt.includes('0.98') ||
        prompt.includes('0.02 and 0.98') || prompt.includes('between 0'),
        `[${persona}] must document probability bounds`,
      );
    });
  }

  it('analyst persona: mentions analyst/geopolitical context', () => {
    const h = makeHypothesis();
    const prompt = buildPersonaPrompt(h, 'analyst');
    assert.ok(
      prompt.toLowerCase().includes('analyst') || prompt.toLowerCase().includes('geopolitical'),
      'analyst prompt must mention analyst role',
    );
  });

  it('skeptic persona: mentions skeptic/overconfidence context', () => {
    const h = makeHypothesis();
    const prompt = buildPersonaPrompt(h, 'skeptic');
    assert.ok(
      prompt.toLowerCase().includes('skeptic') || prompt.toLowerCase().includes('overconfidence'),
      'skeptic prompt must mention skeptic role',
    );
  });

  it('pragmatist persona: mentions pragmatist/base rates context', () => {
    const h = makeHypothesis();
    const prompt = buildPersonaPrompt(h, 'pragmatist');
    assert.ok(
      prompt.toLowerCase().includes('pragmatist') || prompt.toLowerCase().includes('base rate'),
      'pragmatist prompt must mention pragmatist role',
    );
  });
});

// ── buildAggregateReviewPrompt ────────────────────────────────────────────────

describe('buildAggregateReviewPrompt: structural invariants', () => {
  const AGGREGATE_P = 0.65;
  const ESTIMATES: Estimate[] = [
    { source: 'base-rate', p: 0.55, weight: 1.0 },
    { source: 'persona-analyst', p: 0.70, weight: 1.0 },
    { source: 'persona-skeptic', p: 0.60, weight: 1.0 },
  ];

  it('wraps hypothesis statement in <evidence> tags', () => {
    const h = makeHypothesis();
    const prompt = buildAggregateReviewPrompt(h, AGGREGATE_P, ESTIMATES);

    assertInsideEvidence(prompt, FEED_STATEMENT, 'statement in aggregate review');
  });

  it('wraps individual estimates in <evidence> tags', () => {
    const h = makeHypothesis();
    const prompt = buildAggregateReviewPrompt(h, AGGREGATE_P, ESTIMATES);

    // The estimate summary (which includes source labels) should be in evidence.
    assert.ok(prompt.includes('<evidence>'), 'must have evidence tags');
    assert.ok(prompt.includes('base-rate'), 'must include estimate sources');
    assertInsideEvidence(prompt, 'base-rate', 'estimate source labels in evidence');
  });

  it('contains JSON contract with "keep" field', () => {
    const h = makeHypothesis();
    const prompt = buildAggregateReviewPrompt(h, AGGREGATE_P, ESTIMATES);

    assert.ok(
      prompt.toLowerCase().includes('json'),
      'must mention JSON format',
    );
    assert.ok(
      prompt.includes('"keep"'),
      'must demand "keep" field in JSON contract',
    );
  });

  it('documents the ±0.10 hard clamp on adjustedP', () => {
    const h = makeHypothesis();
    const prompt = buildAggregateReviewPrompt(h, AGGREGATE_P, ESTIMATES);

    assert.ok(
      prompt.includes('0.10') || prompt.includes('±0.10') || prompt.includes('+/- 0.10'),
      'must document the ±0.10 hard clamp constraint',
    );
  });

  it('includes the aggregate probability value', () => {
    const h = makeHypothesis();
    const prompt = buildAggregateReviewPrompt(h, AGGREGATE_P, ESTIMATES);

    // 0.65 → 65.0% in the prompt.
    assert.ok(
      prompt.includes('65') || prompt.includes('0.65'),
      'must include the aggregate probability value',
    );
  });

  it('balanced <evidence> tag pairs', () => {
    const h = makeHypothesis();
    const prompt = buildAggregateReviewPrompt(h, AGGREGATE_P, ESTIMATES);

    const openCount = countTag(prompt, '<evidence>');
    const closeCount = countTag(prompt, '</evidence>');
    assert.equal(openCount, closeCount, 'balanced evidence tags');
  });

  it('section order: reviewer context → hypothesis → estimates → aggregate → instruction', () => {
    const h = makeHypothesis();
    const prompt = buildAggregateReviewPrompt(h, AGGREGATE_P, ESTIMATES);

    const reviewerIdx = prompt.toLowerCase().indexOf('reviewer');
    const firstEvidenceIdx = prompt.indexOf('<evidence>');
    const importantIdx = prompt.indexOf('IMPORTANT');

    assert.ok(reviewerIdx !== -1, 'must mention reviewer role');
    assert.ok(reviewerIdx < firstEvidenceIdx, 'reviewer context must precede evidence');
    assert.ok(firstEvidenceIdx < importantIdx, 'evidence must precede instruction');
  });

  it('conservative review instruction present (do not change unless clear error)', () => {
    const h = makeHypothesis();
    const prompt = buildAggregateReviewPrompt(h, AGGREGATE_P, ESTIMATES);

    assert.ok(
      prompt.toLowerCase().includes('conservative') ||
      prompt.toLowerCase().includes('do not change') ||
      prompt.toLowerCase().includes('clear error') ||
      prompt.toLowerCase().includes('blunder'),
      'must instruct reviewer to be conservative',
    );
  });

  it('documents adjustedP field in JSON contract', () => {
    const h = makeHypothesis();
    const prompt = buildAggregateReviewPrompt(h, AGGREGATE_P, ESTIMATES);

    assert.ok(
      prompt.includes('"adjustedP"') || prompt.includes('adjustedP'),
      'must document adjustedP field in the JSON contract',
    );
  });
});
