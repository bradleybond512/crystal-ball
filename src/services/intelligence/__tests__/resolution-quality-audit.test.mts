import assert from 'node:assert/strict';
import test from 'node:test';

import {
  auditResolutionQuality,
  validateResolutionMetadata,
} from '../resolution-quality-audit.ts';
import type {
  PredictionRecord,
  ResolutionEvidence,
  ResolutionMetadata,
} from '../forecast-calibration.ts';

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60_000;

function prediction(overrides: Partial<PredictionRecord> = {}): PredictionRecord {
  return {
    id: 'forecast-1',
    sourceId: 'analyst-loop',
    targetKey: 'hypothesis:ukraine',
    domain: 'conflict',
    claim: 'Escalation continues',
    probability: 0.7,
    predictedAt: NOW,
    resolveBy: NOW + HOUR,
    status: 'resolved_true',
    resolvedAt: NOW + 30 * 60_000,
    algorithmVersion: '2.0.0',
    ...overrides,
  };
}

function evidence(
  sourceId: string,
  observedAt: number,
  overrides: Partial<ResolutionEvidence> = {},
): ResolutionEvidence {
  return {
    sourceIds: [sourceId],
    observedAt,
    reference: `${sourceId}:event`,
    supportsOutcome: true,
    ...overrides,
  };
}

function metadata(
  kind: 'direct' | 'proxy',
  rows: readonly ResolutionEvidence[],
): ResolutionMetadata {
  return {
    note: `${kind}:fixture`,
    provenance: {
      resolverId: 'fixture-v1',
      kind,
      evidence: rows,
    },
  };
}

test('audit reports label leakage from pre-prediction direct evidence', () => {
  const record = prediction({
    resolutionNote: 'direct:fixture',
    resolutionProvenance: metadata('direct', [
      evidence('provider-a', NOW - 1),
    ]).provenance,
  });

  const audit = auditResolutionQuality([record], NOW + 2 * HOUR);

  assert.equal(audit.summary.labelLeakage, 1);
  assert.equal(audit.summary.malformed, 0);
  assert.equal(audit.byDomain[0]?.domain, 'conflict');
});

test('audit detects duplicated outcomes without exposing prediction identifiers', () => {
  const first = prediction({
    resolutionNote: 'direct:fixture',
    resolutionProvenance: metadata('direct', [
      evidence('provider-a', NOW + 1_000),
    ]).provenance,
  });
  const second = {
    ...first,
    id: 'forecast-duplicate',
  };

  const audit = auditResolutionQuality([first, second], NOW + 2 * HOUR);

  assert.equal(audit.summary.duplicateOutcomes, 1);
  assert.doesNotMatch(JSON.stringify(audit), /forecast-1|forecast-duplicate|Escalation continues/);
});

test('audit separates late resolution from label leakage', () => {
  const record = prediction({
    resolvedAt: NOW + HOUR + 10_000,
    resolutionNote: 'direct:fixture',
    resolutionProvenance: metadata('direct', [
      evidence('provider-a', NOW + HOUR - 1),
    ]).provenance,
  });

  const audit = auditResolutionQuality([record], NOW + 2 * HOUR);

  assert.equal(audit.summary.lateResolutions, 1);
  assert.equal(audit.summary.labelLeakage, 0);
});

test('audit detects contradictory provider evidence', () => {
  const record = prediction({
    resolutionNote: 'proxy:fixture',
    resolutionProvenance: metadata('proxy', [
      evidence('provider-a', NOW + 1_000),
      evidence('provider-b', NOW + 2_000, { supportsOutcome: false }),
    ]).provenance,
  });

  const audit = auditResolutionQuality([record], NOW + 2 * HOUR);

  assert.equal(audit.summary.contradictoryEvidence, 1);
});

test('audit contains malformed persisted provenance without throwing', () => {
  const invalidContainer = prediction({
    resolutionNote: 'direct:fixture',
    resolutionProvenance: {
      resolverId: undefined,
      kind: 'unknown',
      evidence: 'corrupt',
    } as unknown as ResolutionMetadata['provenance'],
  });
  const invalidItem = prediction({
    id: 'forecast-malformed-item',
    targetKey: 'hypothesis:malformed-item',
    resolutionNote: 'proxy:fixture',
    resolutionProvenance: {
      resolverId: 'fixture-v1',
      kind: 'proxy',
      evidence: [null],
    } as unknown as ResolutionMetadata['provenance'],
  });

  const audit = auditResolutionQuality(
    [invalidContainer, invalidItem],
    NOW + 2 * HOUR,
  );

  assert.equal(audit.summary.malformed, 2);
  assert.deepEqual(audit.summary.origins, {
    direct: 1,
    proxy: 1,
    manual: 0,
  });
});

test('audit reports uncertain proxy labels and origin coverage by domain', () => {
  const proxy = prediction({
    resolutionNote: 'proxy:fixture',
    resolutionProvenance: metadata('proxy', [
      evidence('single-provider', NOW + 1_000, { supportsOutcome: undefined }),
    ]).provenance,
  });
  const manual = prediction({
    id: 'manual',
    domain: 'weather',
    targetKey: 'warning:test',
    resolutionNote: 'human-reviewed',
  });
  const pending = prediction({
    id: 'pending',
    domain: 'weather',
    targetKey: 'warning:pending',
    status: 'pending',
    resolvedAt: undefined,
  });

  const audit = auditResolutionQuality([proxy, manual, pending], NOW + 2 * HOUR);
  const conflict = audit.byDomain.find((row) => row.domain === 'conflict');
  const weather = audit.byDomain.find((row) => row.domain === 'weather');

  assert.equal(audit.summary.uncertainProxy, 1);
  assert.deepEqual(conflict?.origins, {
    direct: 0,
    proxy: 1,
    manual: 0,
  });
  assert.equal(conflict?.resolutionCoverage, 1);
  assert.deepEqual(weather?.origins, {
    direct: 0,
    proxy: 0,
    manual: 1,
  });
  assert.equal(weather?.resolutionCoverage, 0.5);
});

test('resolution metadata validation fails closed on malformed, leaked, and ambiguous evidence', () => {
  const pending = prediction({ status: 'pending', resolvedAt: undefined });

  assert.deepEqual(
    validateResolutionMetadata(
      pending,
      NOW + 10_000,
      { note: 'direct:fixture' } as unknown as ResolutionMetadata,
    ),
    { ok: false, reason: 'invalid_resolver' },
  );
  assert.deepEqual(
    validateResolutionMetadata(
      pending,
      NOW + 10_000,
      metadata('direct', []),
    ),
    { ok: false, reason: 'missing_evidence' },
  );
  assert.deepEqual(
    validateResolutionMetadata(
      pending,
      NOW + 10_000,
      metadata('direct', [evidence('provider-a', NOW - 1)]),
    ),
    { ok: false, reason: 'label_leakage' },
  );
  assert.deepEqual(
    validateResolutionMetadata(
      pending,
      NOW + 10_000,
      metadata('proxy', [
        evidence('provider-a', NOW + 1_000),
        evidence('provider-b', NOW + 2_000, { supportsOutcome: false }),
      ]),
    ),
    { ok: false, reason: 'contradictory_evidence' },
  );
});

test('resolution metadata validation accepts bounded direct and proxy evidence', () => {
  const pending = prediction({ status: 'pending', resolvedAt: undefined });

  assert.deepEqual(
    validateResolutionMetadata(
      pending,
      NOW + 10_000,
      metadata('direct', [
        evidence('provider-a', NOW + 1_000),
        evidence('provider-b', NOW + 2_000),
      ]),
    ),
    { ok: true },
  );
  assert.deepEqual(
    validateResolutionMetadata(
      pending,
      NOW + HOUR + 10_000,
      metadata('proxy', [
        evidence('coverage-provider', NOW + HOUR + 1_000),
      ]),
    ),
    { ok: true },
  );
});
