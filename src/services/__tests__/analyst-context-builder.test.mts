import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Hypothesis } from '../analyst-loop.js';
import type { PCIScore } from '../intelligence/predictive-crisis-index.js';
import type { ForecastAdvisory } from '../analyst-context-builder.js';
import { buildAnalystContext } from '../analyst-context-builder.js';

function makeHypothesis(id: string, confidence: number): Hypothesis {
  return {
    id,
    kind: 'cross-domain-cluster',
    statement: `Hypothesis ${id}`,
    confidence,
    risk: 'moderate',
    evidence: [],
    timestamp: 1000,
  };
}

function makePCI(index: number): PCIScore {
  return {
    index,
    level: 'moderate',
    trend: 'rising',
    trendDelta: 5,
    domainBreakdown: [],
    topThreats: [],
    computedAt: 1000,
    windowMs: 21600000,
  };
}

function makeAdvisory(domain: string): ForecastAdvisory {
  return {
    domain: domain as ForecastAdvisory['domain'],
    pressure: 0.6,
    slope: 0.1,
    etaMin: null,
    statement: `${domain} pressure rising`,
    timestamp: 1000,
  };
}

describe('buildAnalystContext', () => {
  it('empty input returns empty strings', () => {
    const result = buildAnalystContext({ hypotheses: [], advisories: [], pci: null });
    assert.equal(result.systemPromptAddendum, '');
    assert.equal(result.summaryLine, '');
  });

  it('with hypotheses returns systemPromptAddendum containing Live Intelligence Context', () => {
    const result = buildAnalystContext({
      hypotheses: [makeHypothesis('h1', 0.8)],
      advisories: [],
      pci: null,
    });
    assert.ok(result.systemPromptAddendum.includes('Live Intelligence Context'));
  });

  it('summaryLine contains PCI index when pci is provided', () => {
    const result = buildAnalystContext({
      hypotheses: [makeHypothesis('h1', 0.8)],
      advisories: [],
      pci: makePCI(42),
    });
    assert.ok(result.summaryLine.includes('PCI 42'));
  });

  it('only includes top 3 hypotheses when 5 are provided', () => {
    const hypotheses = [
      makeHypothesis('h1', 0.9),
      makeHypothesis('h2', 0.8),
      makeHypothesis('h3', 0.7),
      makeHypothesis('h4', 0.6),
      makeHypothesis('h5', 0.5),
    ];
    const result = buildAnalystContext({ hypotheses, advisories: [], pci: makePCI(50) });
    const lines = result.systemPromptAddendum.split('\n').filter(l => /^\d\./.test(l));
    assert.equal(lines.length, 3);
    assert.ok(result.systemPromptAddendum.includes('Hypothesis h1'));
    assert.ok(result.systemPromptAddendum.includes('Hypothesis h2'));
    assert.ok(result.systemPromptAddendum.includes('Hypothesis h3'));
    assert.ok(!result.systemPromptAddendum.includes('Hypothesis h4'));
  });

  it('includes advisories in output', () => {
    const result = buildAnalystContext({
      hypotheses: [makeHypothesis('h1', 0.8)],
      advisories: [makeAdvisory('finance'), makeAdvisory('cyber')],
      pci: null,
    });
    assert.ok(result.systemPromptAddendum.includes('finance'));
    assert.ok(result.systemPromptAddendum.includes('cyber'));
    assert.ok(result.summaryLine.includes('2 advisor'));
  });
});
