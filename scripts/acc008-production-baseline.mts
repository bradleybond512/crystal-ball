import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ForecastCalibrationStore, PredictionRecord } from '../src/services/intelligence/forecast-calibration.ts';
import { horizonBucket, meanBrierScore, type EvidenceMetric } from '../src/services/intelligence/forecast-evaluation.ts';
import { auditResolutionQuality } from '../src/services/intelligence/resolution-quality-audit.ts';
import { ShadowModeAlgorithmService, type ShadowComparison } from '../src/services/intelligence/shadow-mode.ts';
import { collectJoinedEvidence, resetShadowRolloutForTests, RUN_IDS, type RunId } from '../src/services/cognition/shadow-rollout.ts';
import { ChampionRegistry } from '../src/services/cognition/champion-registry.ts';

export const STORAGE_KEYS = {
  calibration: 'crystalball-forecast-calibration-v1',
  runs: 'wm-shadow-mode-runs',
  comparisons: 'wm-shadow-mode-comparisons',
  champion: 'crystalball-champion-registry-v1',
} as const;

const SOURCES = new Set([
  'analyst-loop', 'nws-warning', 'superforecast', 'operator-journal', 'production',
  'hierarchical-base-rate', 'persistence-baseline', 'momentum-baseline',
  ...['finance', 'security', 'disaster', 'cyber'].map((id) => `mode-forecast:${id}`),
  ...['wheat', 'diesel', 'corn', 'gasoline', 'sugar', 'coffee', 'cocoa', 'fertilizer',
    'crude', 'propane', 'electricity', 'rice', 'soybeans', 'natural-gas', 'jet-fuel']
    .map((id) => `shortage:${id}`),
]);
const VERSIONS = new Set(['1.0.0', '2.0.0']);
const DOMAINS = new Set(['weather', 'cyber', 'aviation', 'maritime', 'markets',
  'conflict', 'humanitarian', 'space', 'infra', 'macro', 'other']);
const STATUSES = new Set(['pending', 'resolved_true', 'resolved_false', 'expired']);
const BASELINES = new Map<string, RunId>([
  ['hierarchical-base-rate', RUN_IDS.BASELINE_HIERARCHICAL],
  ['persistence-baseline', RUN_IDS.BASELINE_PERSISTENCE],
  ['momentum-baseline', RUN_IDS.BASELINE_MOMENTUM],
]);
const MAX_BYTES = 8 * 1024 * 1024;
type Origin = 'direct' | 'proxy' | 'manual';
type Unavailable = { status: 'unavailable'; reason: string; sampleSize?: number };
type Skill = EvidenceMetric | Unavailable;
type ParsedStore = { status: 'available' | 'missing' | 'malformed'; value: unknown };
export interface StorageSnapshot {
  measurementUtc: string;
  values: Record<string, string | null>;
}
export interface BaselineMetadata {
  installedRelease: string;
  evaluationCodeRevision: string;
  manifestRecordedUtc: string;
}

const SQLITE_READ = `import datetime,json,pathlib,sqlite3,sys
keys=json.loads(sys.argv[2])
c=sqlite3.connect(pathlib.Path(sys.argv[1]).resolve().as_uri()+'?mode=ro',uri=True,timeout=3)
c.execute('PRAGMA query_only=ON')
c.execute('BEGIN')
values={}
try:
 for key in keys:
  row=c.execute('SELECT typeof(value),length(value) FROM ItemTable WHERE key=?',(key,)).fetchone()
  if row is None: values[key]=None; continue
  if row[0] not in ('text','blob') or row[1]>8388608: raise ValueError('invalid_value')
  value=c.execute('SELECT value FROM ItemTable WHERE key=?',(key,)).fetchone()[0]
  values[key]=value.decode('utf-16-le') if isinstance(value,bytes) else value
 print(json.dumps({'measurementUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'values':values}))
finally:
 c.rollback()
 c.close()
`;

export function readInstalledStorage(databasePath: string): StorageSnapshot {
  try {
    const output = execFileSync('python3', ['-c', SQLITE_READ, resolve(databasePath), JSON.stringify(Object.values(STORAGE_KEYS))], {
      encoding: 'utf8', timeout: 10_000, maxBuffer: 40 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(output) as StorageSnapshot;
  } catch {
    throw new Error('installed_storage_unavailable');
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function parseStore(value: string | null | undefined, array: boolean, limit: number): ParsedStore {
  if (value === null || value === undefined) return { status: 'missing', value: null };
  if (typeof value !== 'string' || Buffer.byteLength(value) > MAX_BYTES) return { status: 'malformed', value: null };
  try {
    const parsed: unknown = JSON.parse(value);
    const valid = array ? Array.isArray(parsed) && parsed.length <= limit : object(parsed) !== null;
    return valid ? { status: 'available', value: parsed } : { status: 'malformed', value: null };
  } catch { return { status: 'malformed', value: null }; }
}

function time(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 8_640_000_000_000_000;
}

function probability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 1_024;
}

function validRecord(value: unknown, now: number): value is PredictionRecord {
  const r = object(value);
  if (!r || !text(r.id) || !text(r.sourceId) || typeof r.domain !== 'string' || !DOMAINS.has(r.domain)
    || typeof r.status !== 'string' || !STATUSES.has(r.status) || !probability(r.probability)
    || !time(r.predictedAt) || !time(r.resolveBy) || r.resolveBy <= r.predictedAt
    || r.predictedAt > now || (r.resolutionNote !== undefined && typeof r.resolutionNote !== 'string')) return false;
  if (r.targetKey !== undefined && !text(r.targetKey)) return false;
  if (r.algorithmVersion !== undefined && !text(r.algorithmVersion)) return false;
  return !resolved(r as unknown as PredictionRecord)
    || (time(r.resolvedAt) && r.resolvedAt >= r.predictedAt && r.resolvedAt <= now);
}

function resolved(r: PredictionRecord): boolean {
  return r.status === 'resolved_true' || r.status === 'resolved_false';
}

function origin(r: PredictionRecord, now: number): Origin {
  const counts = auditResolutionQuality([r], now).summary.origins;
  return counts.direct ? 'direct' : counts.proxy ? 'proxy' : 'manual';
}

function source(value: string): string | null { return SOURCES.has(value) ? value : null; }
function version(value: string | undefined): string | null { return value && VERSIONS.has(value) ? value : null; }
function identity(r: PredictionRecord): string {
  return JSON.stringify([r.targetKey, r.predictedAt, r.resolveBy, r.sourceId, r.algorithmVersion]);
}

function metrics(records: PredictionRecord[], now: number, knownVersion: boolean) {
  const resolvedRows = records.filter(resolved);
  const score = (rows: PredictionRecord[]): EvidenceMetric | Unavailable => knownVersion
    ? meanBrierScore(rows.map((r) => ({ probability: r.probability, outcome: r.status === 'resolved_true' ? 1 : 0 })))
    : { status: 'unavailable', reason: 'unknown_model_identity', sampleSize: rows.length };
  return {
    all: score(resolvedRows),
    direct: score(resolvedRows.filter((r) => origin(r, now) === 'direct')),
    proxy: score(resolvedRows.filter((r) => origin(r, now) === 'proxy')),
    manual: score(resolvedRows.filter((r) => origin(r, now) === 'manual')),
  };
}

function groupRecords(records: PredictionRecord[], now: number, cohort: boolean) {
  const groups = new Map<string, PredictionRecord[]>();
  for (const r of records) {
    const key = JSON.stringify([source(r.sourceId), version(r.algorithmVersion),
      ...(cohort ? [r.domain, horizonBucket(r.resolveBy - r.predictedAt)] : [])]);
    const group = groups.get(key) ?? [];
    group.push(r);
    groups.set(key, group);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, rows]) => {
    const first = rows[0]!;
    return {
      forecaster: source(first.sourceId), modelVersion: version(first.algorithmVersion),
      ...(cohort ? { domain: first.domain, horizon: horizonBucket(first.resolveBy - first.predictedAt) } : {}),
      total: rows.length, resolved: rows.filter(resolved).length,
      pending: rows.filter((r) => r.status === 'pending').length,
      expired: rows.filter((r) => r.status === 'expired').length,
      origins: auditResolutionQuality(rows, now).summary.origins,
      positive: rows.filter((r) => r.status === 'resolved_true').length,
      negative: rows.filter((r) => r.status === 'resolved_false').length,
      metrics: metrics(rows, now, Boolean(source(first.sourceId) && version(first.algorithmVersion))),
    };
  });
}

function pairedSkill(production: EvidenceMetric, baseline: EvidenceMetric): Skill {
  if (production.status !== 'ok') return production;
  if (baseline.status !== 'ok') return baseline;
  if (baseline.value <= Number.EPSILON) return { status: 'unavailable', reason: 'zero_baseline_error', sampleSize: production.sampleSize };
  return { status: 'ok', sampleSize: production.sampleSize, value: 1 - production.value / baseline.value };
}

interface PairGroup {
  forecaster: string; modelVersion: string; baselineModel: string; baselineVersion: string;
  domain: PredictionRecord['domain']; horizon: string; origin: Origin; runId: RunId;
  comparisons: ShadowComparison[]; records: PredictionRecord[];
}

function pairedRows(raw: unknown[], records: PredictionRecord[], now: number) {
  const exclusions: Record<string, number> = {};
  const exclude = (reason: string) => { exclusions[reason] = (exclusions[reason] ?? 0) + 1; };
  const resolvedIndex = new Map<string, PredictionRecord[]>();
  for (const r of records.filter(resolved)) {
    if (!r.targetKey) continue;
    const key = identity(r);
    const group = resolvedIndex.get(key) ?? [];
    group.push(r);
    resolvedIndex.set(key, group);
  }
  const candidates: { cmp: ShadowComparison; key: string }[] = [];
  for (const value of raw) {
    const c = object(value);
    const jk = object(c?.joinKey);
    if (!c || !jk || !text(c.id) || !text(jk.targetKey) || !text(jk.liveModelId)
      || !text(jk.shadowModelId) || !BASELINES.has(jk.shadowModelId)
      || BASELINES.get(jk.shadowModelId) !== c.runId || !probability(c.liveOutput)
      || !probability(c.shadowOutput) || !time(c.timestamp) || !time(jk.predictedAt)
      || !time(jk.resolveBy) || jk.resolveBy <= jk.predictedAt) { exclude('malformed_or_unsupported'); continue; }
    if (!source(jk.liveModelId) || !version(jk.liveModelVersion as string | undefined)
      || !version(jk.shadowModelVersion as string | undefined)) { exclude('unknown_model_identity'); continue; }
    candidates.push({ cmp: c as unknown as ShadowComparison,
      key: JSON.stringify([c.runId, jk.targetKey, jk.predictedAt, jk.resolveBy, jk.liveModelId,
        jk.liveModelVersion, jk.shadowModelId, jk.shadowModelVersion]) });
  }
  const multiplicities = new Map<string, number>();
  for (const c of candidates) multiplicities.set(c.key, (multiplicities.get(c.key) ?? 0) + 1);
  const groups = new Map<string, PairGroup>();
  for (const { cmp, key } of candidates) {
    if (multiplicities.get(key)! > 1) { exclude('duplicate_identity'); continue; }
    const jk = cmp.joinKey!;
    const matches = resolvedIndex.get(JSON.stringify([jk.targetKey, jk.predictedAt, jk.resolveBy, jk.liveModelId, jk.liveModelVersion]));
    if (!matches?.length) { exclude('unmatched_identity'); continue; }
    if (matches.length > 1) { exclude('duplicate_outcome_identity'); continue; }
    const first = matches[0]!;
    const quality = auditResolutionQuality([first], now).summary;
    if (quality.malformed || quality.labelLeakage || quality.contradictoryEvidence) {
      exclude('invalid_outcome_quality'); continue;
    }
    const outcomeObservedAt = Math.min(first.resolvedAt!,
      ...(first.resolutionProvenance?.evidence?.map((item) => item.observedAt) ?? []));
    if (cmp.timestamp < first.predictedAt || cmp.timestamp >= outcomeObservedAt || cmp.timestamp > now) {
      exclude('temporal_integrity'); continue;
    }
    if (cmp.liveOutput !== first.probability) { exclude('forecast_probability_mismatch'); continue; }
    const labelOrigin = origin(first, now);
    const groupKey = JSON.stringify([cmp.runId, jk.liveModelId, jk.liveModelVersion,
      jk.shadowModelId, jk.shadowModelVersion, first.domain, horizonBucket(jk.resolveBy - jk.predictedAt), labelOrigin]);
    const group = groups.get(groupKey) ?? {
      forecaster: jk.liveModelId!, modelVersion: jk.liveModelVersion!, baselineModel: jk.shadowModelId!,
      baselineVersion: jk.shadowModelVersion!, domain: first.domain,
      horizon: horizonBucket(jk.resolveBy - jk.predictedAt), origin: labelOrigin, runId: cmp.runId as RunId,
      comparisons: [], records: [],
    };
    group.comparisons.push(cmp);
    group.records.push(first);
    groups.set(groupKey, group);
  }
  const rows = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, group]) => {
    const data = { [STORAGE_KEYS.comparisons]: JSON.stringify(group.comparisons) };
    const storage = { getItem: (key: string) => data[key as keyof typeof data] ?? null, setItem: () => {}, removeItem: () => {} };
    resetShadowRolloutForTests();
    let pairs;
    try {
      pairs = collectJoinedEvidence(group.runId, {
        shadowService: new ShadowModeAlgorithmService({ storage, clock: () => now }),
        calibrationStore: { all: () => group.records } as ForecastCalibrationStore,
        storage: null, putMemoryFn: async () => {}, clock: () => now,
      });
    } finally { resetShadowRolloutForTests(); }
    if (pairs.length !== group.comparisons.length) throw new Error('exact_join_reconciliation_failed');
    const productionBrier = meanBrierScore(pairs.map((p) => ({ probability: p.liveP, outcome: p.outcome ? 1 : 0 })));
    const baselineBrier = meanBrierScore(pairs.map((p) => ({ probability: p.shadowP, outcome: p.outcome ? 1 : 0 })));
    return {
      forecaster: group.forecaster, modelVersion: group.modelVersion, baselineModel: group.baselineModel,
      baselineVersion: group.baselineVersion, domain: group.domain, horizon: group.horizon,
      origin: group.origin, count: pairs.length, productionBrier, baselineBrier,
      skill: pairedSkill(productionBrier, baselineBrier),
    };
  });
  return { inputCount: raw.length, acceptedCount: rows.reduce((n, r) => n + r.count, 0), exclusions, rows };
}

function championState(store: ParsedStore, raw: string | null | undefined, now: number) {
  if (store.status !== 'available') return { availability: 'unavailable', reason: `registry_${store.status}` };
  const entries = object(store.value)?.['forecast-primary'];
  if (!Array.isArray(entries) || entries.length > 20 || entries.some((value) => {
    const entry = object(value);
    return !entry || entry.slot !== 'forecast-primary' || typeof entry.modelId !== 'string'
      || !SOURCES.has(entry.modelId) || typeof entry.version !== 'string' || !VERSIONS.has(entry.version)
      || !time(entry.activatedAt) || entry.activatedAt > now
      || !['initial', 'promotion', 'rollback'].includes(entry.reason as string);
  })) return { availability: 'unavailable', reason: 'registry_slot_malformed' };
  const storage = { getItem: () => raw ?? null, setItem: () => {}, removeItem: () => {} };
  const active = new ChampionRegistry({ storage, clock: () => now }).getActiveChampion('forecast-primary');
  if (!active || !SOURCES.has(active.modelId) || !version(active.version) || !time(active.activatedAt)
    || active.activatedAt > now || !['initial', 'promotion', 'rollback'].includes(active.reason)) {
    return { availability: 'unavailable', reason: 'active_champion_unavailable' };
  }
  return { availability: 'available', model: active.modelId, version: active.version, activatedAt: active.activatedAt, reason: active.reason };
}

export function buildBaselineReport(snapshot: StorageSnapshot, metadata: BaselineMetadata) {
  const now = Date.parse(snapshot.measurementUtc);
  const recorded = Date.parse(metadata.manifestRecordedUtc);
  if (!time(now) || !time(recorded) || !/^\d+\.\d+\.\d+$/.test(metadata.installedRelease)
    || !/^[a-f0-9]{40}$/.test(metadata.evaluationCodeRevision)) throw new Error('invalid_acquisition_metadata');
  const stores = {
    calibration: parseStore(snapshot.values[STORAGE_KEYS.calibration], true, 500),
    runs: parseStore(snapshot.values[STORAGE_KEYS.runs], true, 100),
    comparisons: parseStore(snapshot.values[STORAGE_KEYS.comparisons], true, 1800),
    champion: parseStore(snapshot.values[STORAGE_KEYS.champion], false, 0),
  };
  const raw = Array.isArray(stores.calibration.value) ? stores.calibration.value as unknown[] : [];
  const records = raw.filter((r): r is PredictionRecord => validRecord(r, now));
  const audit = auditResolutionQuality(records, now).summary;
  const comparisons = Array.isArray(stores.comparisons.value) ? stores.comparisons.value as unknown[] : [];
  return {
    schemaVersion: 1,
    scope: 'retained_installed_working_set',
    measurementUtc: new Date(now).toISOString(), manifestRecordedUtc: new Date(recorded).toISOString(),
    installedRelease: metadata.installedRelease, evaluationCodeRevision: metadata.evaluationCodeRevision,
    installedEvaluationRevision: null,
    stores: Object.fromEntries(Object.entries(stores).map(([key, store]) => [key, { status: store.status }])),
    retained: {
      inputCount: stores.calibration.status === 'available' ? raw.length : null,
      acceptedCount: records.length, excludedCount: raw.length - records.length,
      resolved: audit.resolved, origins: audit.origins, duplicateOutcomeCount: audit.duplicateOutcomes,
      metricPopulation: 'retained_records_including_duplicates_and_reported_quality_defects',
      quality: {
        malformed: audit.malformed, labelLeakage: audit.labelLeakage,
        contradictoryEvidence: audit.contradictoryEvidence, uncertainProxy: audit.uncertainProxy,
        lateResolutions: audit.lateResolutions,
      },
      overduePending: records.filter((r) => r.status === 'pending' && r.resolveBy < now).length,
      byForecaster: groupRecords(records, now, false),
    },
    paired: {
      temporalPolicy: 'before_earliest_structured_evidence_or_legacy_resolved_at',
      availability: stores.calibration.status === 'available' && stores.comparisons.status === 'available' ? 'available' : 'unavailable',
      ...pairedRows(comparisons, records, now),
    },
    champion: championState(stores.champion, snapshot.values[STORAGE_KEYS.champion], now),
    manifest: {
      proofWindowEligible: false,
      reasons: ['retained_working_set_only', 'installed_evaluation_revision_unavailable', 'production_window_not_assessed'],
      missingModelVersionCount: records.filter((r) => !version(r.algorithmVersion)).length,
      unknownForecasterCount: records.filter((r) => !source(r.sourceId)).length,
      cohorts: groupRecords(records, now, true),
    },
    modelReadiness: 'not_established_by_retained_working_set',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [databasePath, installedRelease, evaluationCodeRevision, ...extra] = process.argv.slice(2);
    if (!databasePath || !installedRelease || !evaluationCodeRevision || extra.length) throw new Error('invalid_arguments');
    const snapshot = readInstalledStorage(databasePath);
    const report = buildBaselineReport(snapshot, { installedRelease, evaluationCodeRevision, manifestRecordedUtc: new Date().toISOString() });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch {
    process.stderr.write('ACC-008 acquisition failed; verify arguments, read-only storage access and supported data shape. No raw values are printed.\n');
    process.exitCode = 1;
  }
}
