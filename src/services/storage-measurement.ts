const STORAGE_PLAN = [
  { scopeId: 'persistent-cache-indexeddb', classification: 'owned-cache', protected: false, allowedMetrics: ['recordCount'] },
  { scopeId: 'persistent-cache-file', classification: 'owned-cache', protected: false, allowedMetrics: ['fileLengthBytes'] },
  { scopeId: 'shared-db-snapshots', classification: 'protected-evidence', protected: true, allowedMetrics: ['recordCount'] },
  { scopeId: 'shared-db-baselines', classification: 'protected-unresolved', protected: true, allowedMetrics: ['recordCount'] },
  { scopeId: 'shared-db-reasoning', classification: 'mixed-protected', protected: true, allowedMetrics: ['recordCount'] },
  { scopeId: 'origin-local-storage', classification: 'mixed-protected', protected: true, allowedMetrics: ['entryCount'] },
  { scopeId: 'evidence-sqlite-main', classification: 'protected-evidence', protected: true, allowedMetrics: ['fileLengthBytes'] },
  { scopeId: 'evidence-sqlite-wal', classification: 'protected-evidence', protected: true, allowedMetrics: ['fileLengthBytes'] },
  { scopeId: 'evidence-sqlite-shm', classification: 'protected-evidence', protected: true, allowedMetrics: ['fileLengthBytes'] },
  { scopeId: 'browser-origin-estimate', classification: 'mixed-diagnostic-estimate', protected: true, allowedMetrics: ['estimatedUsageBytes', 'estimatedQuotaBytes'] },
] as const;

const OBSERVATION_STATUSES = ['complete', 'partial', 'absent', 'unavailable', 'unsupported'] as const;

export type StorageScopeId = (typeof STORAGE_PLAN)[number]['scopeId'];
export type StorageMetric = (typeof STORAGE_PLAN)[number]['allowedMetrics'][number];
export type StorageObservationStatus = (typeof OBSERVATION_STATUSES)[number];

export interface StorageMeasurementScope {
  scopeId: StorageScopeId;
  classification: (typeof STORAGE_PLAN)[number]['classification'];
  protected: boolean;
  allowedMetrics: StorageMetric[];
}

export interface StorageScopeMeasurement extends StorageMeasurementScope {
  status: StorageObservationStatus | 'not-observed';
  metrics: Partial<Record<StorageMetric, number>>;
}

export interface StorageMeasurement {
  schemaVersion: 1;
  coverage: 'selected-scopes';
  liveBaselineEstablished: false;
  scopes: StorageScopeMeasurement[];
}

function invalidObservation(): never {
  throw new Error('Invalid storage measurement observations');
}

function readFields(value: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object') return invalidObservation();
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalidObservation();
  const fields: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowedKeys.includes(key)) return invalidObservation();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) return invalidObservation();
    fields[key] = descriptor.value;
  }
  return fields;
}

function readObservations(observations: unknown): unknown[] {
  if (!Array.isArray(observations)) return invalidObservation();
  const length: unknown = Object.getOwnPropertyDescriptor(observations, 'length')?.value;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || length > 32) return invalidObservation();
  if (Reflect.ownKeys(observations).length !== length + 1) return invalidObservation();
  const values: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(observations, String(index));
    if (!descriptor || !('value' in descriptor)) return invalidObservation();
    values.push(descriptor.value);
  }
  return values;
}

function hasField(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function readMetrics(fields: Record<string, unknown>, scope: StorageMeasurementScope, status: StorageObservationStatus): Partial<Record<StorageMetric, number>> {
  const rawMetrics = hasField(fields, 'metrics') ? readFields(fields.metrics, scope.allowedMetrics) : {};
  const metrics: Partial<Record<StorageMetric, number>> = {};
  for (const metric of scope.allowedMetrics) {
    if (!hasField(rawMetrics, metric)) continue;
    const value = rawMetrics[metric];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return invalidObservation();
    metrics[metric] = value;
  }
  if (status === 'complete' && scope.allowedMetrics.some((metric) => !hasField(metrics, metric))) return invalidObservation();
  if (status !== 'complete' && status !== 'partial' && Object.keys(metrics).length > 0) return invalidObservation();
  return metrics;
}

export function getStorageMeasurementPlan(): StorageMeasurementScope[] {
  return STORAGE_PLAN.map((scope) => ({ ...scope, allowedMetrics: [...scope.allowedMetrics] }));
}

export function buildStorageMeasurement(observations: unknown): StorageMeasurement {
  try {
    const values = readObservations(observations);
    const plan = getStorageMeasurementPlan();
    const measured = new Map<StorageScopeId, Pick<StorageScopeMeasurement, 'status' | 'metrics'>>();
    for (const value of values) {
      const fields = readFields(value, ['scopeId', 'status', 'metrics']);
      const scope = plan.find((candidate) => candidate.scopeId === fields.scopeId);
      if (!scope || measured.has(scope.scopeId)) return invalidObservation();
      if (!OBSERVATION_STATUSES.includes(fields.status as StorageObservationStatus)) return invalidObservation();
      const status = fields.status as StorageObservationStatus;
      const metrics = readMetrics(fields, scope, status);
      measured.set(scope.scopeId, { status, metrics });
    }
    return {
      schemaVersion: 1,
      coverage: 'selected-scopes',
      liveBaselineEstablished: false,
      scopes: plan.map((scope) => ({ ...scope, ...(measured.get(scope.scopeId) ?? { status: 'not-observed', metrics: {} }) })),
    };
  } catch {
    return invalidObservation();
  }
}
