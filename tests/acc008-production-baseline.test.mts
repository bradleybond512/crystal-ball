import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildBaselineReport,
  readInstalledStorage,
  STORAGE_KEYS,
  type StorageSnapshot,
} from '../scripts/acc008-production-baseline.mts';
import type { PredictionRecord } from '../src/services/intelligence/forecast-calibration.ts';
import type { ShadowComparison } from '../src/services/intelligence/shadow-mode.ts';

const NOW = 1_800_000_000_000;
const metadata = {
  installedRelease: '2.25.147',
  evaluationCodeRevision: 'a'.repeat(40),
  manifestRecordedUtc: new Date(NOW).toISOString(),
};

function record(index: number, overrides: Partial<PredictionRecord> = {}): PredictionRecord {
  const outcome = index % 2 === 0;
  return {
    id: `private-record-${index}`,
    targetKey: `private-target-${index}`,
    sourceId: 'analyst-loop', domain: 'weather', algorithmVersion: '2.0.0',
    claim: 'PRIVATE CLAIM AND LOCATION',
    probability: outcome ? 0.8 : 0.2,
    predictedAt: NOW - 2_000, resolveBy: NOW - 1_000, resolvedAt: NOW - 500,
    status: outcome ? 'resolved_true' : 'resolved_false',
    resolutionNote: 'direct: PRIVATE EVIDENCE',
    ...overrides,
  };
}

function comparison(r: PredictionRecord, index: number, overrides: Partial<ShadowComparison> = {}): ShadowComparison {
  return {
    id: `private-comparison-${index}`, algorithmId: 'hierarchical-base-rate',
    runId: 'production-vs-hierarchical-base-rate', inputHash: 'PRIVATE INPUT',
    joinKey: {
      targetKey: r.targetKey!, predictedAt: r.predictedAt, resolveBy: r.resolveBy,
      liveModelId: r.sourceId, liveModelVersion: r.algorithmVersion,
      shadowModelId: 'hierarchical-base-rate', shadowModelVersion: '1.0.0',
    },
    liveOutput: r.probability,
    shadowOutput: r.status === 'resolved_true' ? 0.6 : 0.4,
    timestamp: NOW - 1_500, diverged: true, divergenceScore: 0.2,
    ...overrides,
  };
}

function snapshot(records = Array.from({ length: 20 }, (_, i) => record(i)), comparisons = records.map((r, i) => comparison(r, i))): StorageSnapshot {
  return {
    measurementUtc: new Date(NOW).toISOString(),
    values: {
      [STORAGE_KEYS.calibration]: JSON.stringify(records),
      [STORAGE_KEYS.runs]: '[]',
      [STORAGE_KEYS.comparisons]: JSON.stringify(comparisons),
      [STORAGE_KEYS.champion]: null,
    },
  };
}

test('scores the same exact paired cohort and reconciles label origins', () => {
  const report = buildBaselineReport(snapshot(), metadata);
  assert.equal(report.retained.inputCount, 20);
  assert.equal(report.retained.resolved, 20);
  assert.deepEqual(report.retained.origins, { direct: 20, proxy: 0, manual: 0 });
  const pair = report.paired.rows[0];
  assert.ok(pair);
  assert.equal(pair.count, 20);
  assert.equal(pair.productionBrier.status, 'ok');
  assert.equal(pair.baselineBrier.status, 'ok');
  assert.equal(pair.skill.status, 'ok');
  if (pair.productionBrier.status === 'ok' && pair.baselineBrier.status === 'ok' && pair.skill.status === 'ok') {
    assert.ok(Math.abs(pair.productionBrier.value - 0.04) < 1e-12);
    assert.ok(Math.abs(pair.baselineBrier.value - 0.16) < 1e-12);
    assert.ok(Math.abs(pair.skill.value - 0.75) < 1e-12);
  }
});

test('retains the twenty-sample floor instead of presenting small cohorts as scored', () => {
  const report = buildBaselineReport(snapshot(Array.from({ length: 19 }, (_, i) => record(i))), metadata);
  assert.equal(report.paired.rows[0]?.productionBrier.status, 'insufficient_evidence');
  assert.equal(report.paired.rows[0]?.skill.status, 'insufficient_evidence');
});

test('never joins a comparison to a different model version', () => {
  const records = Array.from({ length: 20 }, (_, i) => record(i));
  const comparisons = records.map((r, i) => {
    const c = comparison(r, i);
    c.joinKey!.liveModelVersion = '1.0.0';
    return c;
  });
  const report = buildBaselineReport(snapshot(records, comparisons), metadata);
  assert.equal(report.paired.acceptedCount, 0);
  assert.equal(report.paired.exclusions.unmatched_identity, 20);
});

test('does not pool undersampled source, version, domain or horizon partitions', () => {
  const changes: Partial<PredictionRecord>[] = [
    { sourceId: 'mode-forecast:security' }, { algorithmVersion: '1.0.0' },
    { domain: 'conflict' }, { predictedAt: NOW - 12 * 60 * 60 * 1_000 },
  ];
  for (const change of changes) {
    const records = Array.from({ length: 38 }, (_, i) => record(i, i < 19 ? {} : change));
    const report = buildBaselineReport(snapshot(records), metadata);
    assert.equal(report.paired.acceptedCount, 38);
    assert.equal(report.paired.rows.length, 2);
    for (const row of report.paired.rows) {
      assert.equal(row.count, 19);
      assert.equal(row.productionBrier.status, 'insufficient_evidence');
      assert.equal(row.baselineBrier.status, 'insufficient_evidence');
      assert.equal(row.skill.status, 'insufficient_evidence');
    }
  }
});

test('rejects a comparison whose live probability differs from the forecast being graded', () => {
  const records = Array.from({ length: 20 }, (_, i) => record(i));
  const comparisons = records.map((r, i) => comparison(r, i));
  comparisons[0]!.liveOutput = 0.3;
  const report = buildBaselineReport(snapshot(records, comparisons), metadata);
  assert.equal(report.paired.acceptedCount, 19);
  assert.equal(report.paired.exclusions.forecast_probability_mismatch, 1);
});

test('preserves direct, proxy and manual cohorts separately', () => {
  const records = Array.from({ length: 60 }, (_, i) => record(i, {
    resolutionNote: i < 20 ? 'direct: evidence' : i < 40 ? 'proxy: evidence' : 'operator judgement',
  }));
  const report = buildBaselineReport(snapshot(records), metadata);
  assert.deepEqual(report.retained.origins, { direct: 20, proxy: 20, manual: 20 });
  assert.deepEqual(report.paired.rows.map((row) => row.origin).sort(), ['direct', 'manual', 'proxy']);
  assert.equal(report.paired.rows.find((row) => row.origin === 'manual')?.count, 20);
});

test('missing and unknown versions stay unavailable and cannot qualify a proof window', () => {
  const records = [record(0, { algorithmVersion: undefined }), record(1, { algorithmVersion: 'PRIVATE-VERSION' })];
  const report = buildBaselineReport(snapshot(records), metadata);
  assert.equal(report.manifest.proofWindowEligible, false);
  assert.equal(report.manifest.missingModelVersionCount, 2);
  assert.equal(report.paired.acceptedCount, 0);
  assert.equal(JSON.stringify(report).includes('PRIVATE-VERSION'), false);
});

test('excludes duplicate comparison identities instead of inflating pair counts', () => {
  const records = Array.from({ length: 20 }, (_, i) => record(i));
  const comparisons = records.map((r, i) => comparison(r, i));
  comparisons.push({ ...comparisons[0]!, id: 'duplicate', shadowOutput: 0.9 });
  const report = buildBaselineReport(snapshot(records, comparisons), metadata);
  assert.equal(report.paired.acceptedCount, 19);
  assert.equal(report.paired.exclusions.duplicate_identity, 2);
});

test('excludes conflicting outcomes or domains for the same resolved identity', () => {
  for (const change of [{ status: 'resolved_false' as const }, { domain: 'conflict' as const }]) {
    const records = Array.from({ length: 20 }, (_, i) => record(i));
    const comparisons = records.map((r, i) => comparison(r, i));
    records.push(record(0, { id: 'conflict', ...change }));
    const report = buildBaselineReport(snapshot(records, comparisons), metadata);
    assert.equal(report.paired.acceptedCount, 19);
    assert.equal(report.paired.exclusions.ambiguous_outcome, 1);
  }
});

test('exposes outcome-quality defects and excludes contradictory pairs', () => {
  const records = Array.from({ length: 20 }, (_, i) => record(i));
  records[0]!.resolutionProvenance = {
    kind: 'direct', resolverId: 'test-resolver', evidence: [{
      sourceIds: ['test'], observedAt: NOW - 600, supportsOutcome: false,
    }],
  };
  const report = buildBaselineReport(snapshot(records), metadata);
  assert.equal(report.retained.quality.contradictoryEvidence, 1);
  assert.equal(report.paired.acceptedCount, 19);
  assert.equal(report.paired.exclusions.invalid_outcome_quality, 1);
});

test('excludes pairs observed at or after resolution and before forecast emission', () => {
  const records = Array.from({ length: 20 }, (_, i) => record(i));
  const comparisons = records.map((r, i) => comparison(r, i));
  comparisons[0]!.timestamp = records[0]!.resolvedAt!;
  comparisons[1]!.timestamp = records[1]!.predictedAt - 1;
  const report = buildBaselineReport(snapshot(records, comparisons), metadata);
  assert.equal(report.paired.acceptedCount, 18);
  assert.equal(report.paired.exclusions.temporal_integrity, 2);
});

test('rejects malformed probabilities and timestamps before pure scorers can clamp them', () => {
  const records = [record(0, { probability: 1.1 }), record(1, { resolveBy: NOW - 3_000 }), record(2)];
  const comparisons = records.map((r, i) => comparison(r, i));
  comparisons[2]!.shadowOutput = -0.1;
  const report = buildBaselineReport(snapshot(records, comparisons), metadata);
  assert.equal(report.retained.excludedCount, 2);
  assert.equal(report.paired.acceptedCount, 0);
});

test('does not accept object-shaped domains or statuses through string coercion', () => {
  const input = snapshot([]);
  input.values[STORAGE_KEYS.calibration] = JSON.stringify([
    { ...record(0), domain: ['weather'] },
    { ...record(1), status: ['resolved_false'] },
  ]);
  const report = buildBaselineReport(input, metadata);
  assert.equal(report.retained.acceptedCount, 0);
  assert.equal(report.retained.excludedCount, 2);
});

test('reads a valid persisted production champion without making a new promotion decision', () => {
  const input = snapshot();
  input.values[STORAGE_KEYS.champion] = JSON.stringify({ 'forecast-primary': [{
    slot: 'forecast-primary', modelId: 'production', version: '1.0.0',
    activatedAt: NOW - 1_000, reason: 'initial', decision: { private: 'PRIVATE' },
  }] });
  const report = buildBaselineReport(input, metadata);
  assert.equal(report.champion.availability, 'available');
  assert.equal(report.champion.model, 'production');
  assert.equal(JSON.stringify(report.champion).includes('PRIVATE'), false);
});

test('does not present an older champion when the latest persisted entry is malformed', () => {
  const input = snapshot();
  input.values[STORAGE_KEYS.champion] = JSON.stringify({ 'forecast-primary': [
    { slot: 'forecast-primary', modelId: 'production', version: '1.0.0', activatedAt: NOW - 1_000, reason: 'initial' },
    { slot: 'forecast-primary', modelId: null, version: '1.0.0', activatedAt: NOW - 500, reason: 'promotion' },
  ] });
  assert.equal(buildBaselineReport(input, metadata).champion.availability, 'unavailable');
});

test('distinguishes missing, malformed and valid empty storage', () => {
  for (const [value, status] of [[null, 'missing'], ['{', 'malformed'], ['[]', 'available']] as const) {
    const input = snapshot([]);
    input.values[STORAGE_KEYS.calibration] = value;
    const report = buildBaselineReport(input, metadata);
    assert.equal(report.stores.calibration?.status, status);
    assert.equal(report.retained.inputCount, status === 'available' ? 0 : null);
  }
});

test('treats zero baseline error as unavailable skill', () => {
  const records = Array.from({ length: 20 }, (_, i) => record(i));
  const comparisons = records.map((r, i) => comparison(r, i, { shadowOutput: r.status === 'resolved_true' ? 1 : 0 }));
  const report = buildBaselineReport(snapshot(records, comparisons), metadata);
  assert.deepEqual(report.paired.rows[0]?.skill, { status: 'unavailable', reason: 'zero_baseline_error', sampleSize: 20 });
});

test('projects only approved aggregate strings and never leaks raw records or unknown model names', () => {
  const records = [record(0), record(1, { sourceId: 'PRIVATE-SOURCE', algorithmVersion: 'PRIVATE-VERSION' })];
  const report = buildBaselineReport(snapshot(records), metadata);
  const serialized = JSON.stringify(report);
  for (const value of ['PRIVATE', 'private-target', 'private-record', 'private-comparison', 'inputHash', 'targetKey', 'claim', 'resolutionNote']) {
    assert.equal(serialized.includes(value), false, value);
  }
  assert.equal(report.manifest.unknownForecasterCount, 1);
  assert.equal(report.champion.availability, 'unavailable');
});

test('is deterministic for the same in-memory snapshot and does not mutate it', () => {
  const input = snapshot();
  const before = JSON.stringify(input);
  assert.deepEqual(buildBaselineReport(input, metadata), buildBaselineReport(input, metadata));
  assert.equal(JSON.stringify(input), before);
});

test('reads only four UTF-16 SQLite values without modifying the source database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'acc008-readonly-'));
  const db = join(directory, 'localstorage.sqlite3');
  try {
    execFileSync('python3', ['-c', `import sqlite3,sys,json
c=sqlite3.connect(sys.argv[1]); c.execute('CREATE TABLE ItemTable (key TEXT UNIQUE, value BLOB NOT NULL)')
for k,v in json.loads(sys.argv[2]).items():
 if v is not None: c.execute('INSERT INTO ItemTable VALUES (?,?)',(k,v.encode('utf-16-le')))
c.execute('INSERT INTO ItemTable VALUES (?,?)',('secret-token','DO NOT READ'.encode('utf-16-le')))
c.commit(); c.close()`, db, JSON.stringify(snapshot().values)]);
    const digest = () => createHash('sha256').update(readFileSync(db)).digest('hex');
    const before = digest();
    const acquired = readInstalledStorage(db);
    assert.deepEqual(acquired.values, snapshot().values);
    assert.equal(Object.keys(acquired.values).length, 4);
    assert.equal(digest(), before);
    assert.equal(JSON.stringify(buildBaselineReport(acquired, metadata)).includes('DO NOT READ'), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('includes committed live WAL contents in a read-only snapshot', { timeout: 10_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'acc008-wal-'));
  const db = join(directory, 'localstorage.sqlite3');
  const child = spawn('python3', ['-c', `import sqlite3,sys
c=sqlite3.connect(sys.argv[1]); c.execute('PRAGMA journal_mode=WAL')
c.execute('PRAGMA wal_autocheckpoint=0')
c.execute('CREATE TABLE ItemTable (key TEXT UNIQUE, value BLOB NOT NULL)')
c.execute('INSERT INTO ItemTable VALUES (?,?)',('crystalball-forecast-calibration-v1','[]'.encode('utf-16-le')))
c.commit(); print('ready',flush=True); sys.stdin.read(); c.close()`, db], { stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    await new Promise<void>((resolveReady, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error(`fixture exited ${code}`)));
      child.stdout.once('data', () => resolveReady());
    });
    assert.equal(existsSync(`${db}-wal`), true);
    const digest = () => createHash('sha256').update(readFileSync(`${db}-wal`)).digest('hex');
    const before = digest();
    const acquired = readInstalledStorage(db);
    assert.equal(acquired.values[STORAGE_KEYS.calibration], '[]');
    assert.equal(digest(), before);
  } finally {
    child.kill();
    await new Promise<void>((done) => { if (child.exitCode !== null || child.signalCode !== null) done(); else child.once('exit', () => done()); });
    rmSync(directory, { recursive: true, force: true });
  }
});

test('unavailable databases are not created and errors omit private paths', () => {
  const directory = mkdtempSync(join(tmpdir(), 'acc008-missing-'));
  const db = join(directory, 'PRIVATE-DATABASE.sqlite3');
  try {
    assert.throws(() => readInstalledStorage(db), /^Error: installed_storage_unavailable$/);
    assert.equal(existsSync(db), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('oversized retained stores are unavailable instead of silently truncated', () => {
  const input = snapshot(Array.from({ length: 501 }, (_, i) => record(i)));
  const report = buildBaselineReport(input, metadata);
  assert.equal(report.stores.calibration?.status, 'malformed');
  assert.equal(report.retained.inputCount, null);
  assert.equal(report.manifest.proofWindowEligible, false);
});
