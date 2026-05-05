/**
 * Tunable Registry — PR 5 of the Algorithm Accuracy Enhancement Plan.
 *
 * Extends the algorithm registry to declare tunable parameters with type
 * + bound constraints. Stores active values in a separate config layer
 * (so tuning doesn't pollute the static algorithm registry) and supports
 * hot-reload: a parameter change is visible to the algorithm's next run
 * without process restart.
 *
 * Pure deterministic: parameter declarations and validation are pure
 * functions. The active-values store is a small in-memory Map exposed
 * via getter/setter helpers; persistence is the caller's job (via
 * persistent-cache, file, or whatever).
 *
 * Plan invariant: no algorithm may consume a parameter value that
 * violates its declared bounds. Bound violations throw eagerly so the
 * caller sees the failure rather than a silently-clamped value.
 */

// Public types

export type TunableType = 'float' | 'int' | 'bool';

export interface TunableParam<TValue = TunableValue> {
  name: string;
  type: TunableType;
  /** Default value used when no override is set. Must satisfy the
   *  declared bounds. */
  default: TValue;
  /** Inclusive lower bound for numeric types. Ignored for bool. */
  min?: number;
  /** Inclusive upper bound for numeric types. Ignored for bool. */
  max?: number;
  /** Discrete legal values. When present, the value must be one of
   *  these (overrides min/max for that purpose). */
  oneOf?: readonly TValue[];
  description: string;
}

export type TunableValue = number | boolean;

export interface AlgorithmTunables {
  algorithmId: string;
  params: readonly TunableParam[];
}

export interface ParamSnapshot {
  algorithmId: string;
  params: Record<string, TunableValue>;
}

// Module state

const declarations = new Map<string, AlgorithmTunables>();
const overrides = new Map<string, Map<string, TunableValue>>();
const listeners = new Set<(algorithmId: string, name: string, value: TunableValue) => void>();

// Declaration

export function declareAlgorithmTunables(spec: AlgorithmTunables): void {
  validateAllDefaults(spec);
  declarations.set(spec.algorithmId, spec);
}

function validateAllDefaults(spec: AlgorithmTunables): void {
  for (const p of spec.params) {
    if (!validateParamValue(p, p.default)) {
      throw new Error(
        `Default for ${spec.algorithmId}.${p.name} (${JSON.stringify(p.default)}) violates declared bounds`,
      );
    }
  }
}

export function getAlgorithmTunables(algorithmId: string): AlgorithmTunables | undefined {
  return declarations.get(algorithmId);
}

export function listTunableAlgorithms(): AlgorithmTunables[] {
  return [...declarations.values()];
}

// Validation

function inBounds(value: number, min: number | undefined, max: number | undefined): boolean {
  if (min !== undefined && value < min) return false;
  if (max !== undefined && value > max) return false;
  return true;
}

function validateNumeric(param: TunableParam, value: unknown, requireInt: boolean): boolean {
  if (typeof value !== 'number') return false;
  if (requireInt && !Number.isInteger(value)) return false;
  if (!requireInt && !Number.isFinite(value)) return false;
  return inBounds(value, param.min, param.max);
}

export function validateParamValue(param: TunableParam, value: unknown): boolean {
  if (param.oneOf && param.oneOf.length > 0) {
    return param.oneOf.includes(value as TunableValue);
  }
  if (param.type === 'bool') return typeof value === 'boolean';
  return validateNumeric(param, value, param.type === 'int');
}

// Read

export function getParamValue<TValue extends TunableValue>(
  algorithmId: string,
  paramName: string,
): TValue {
  const spec = declarations.get(algorithmId);
  if (!spec) {
    throw new Error(`No tunables declared for algorithm "${algorithmId}"`);
  }
  const param = spec.params.find((p) => p.name === paramName);
  if (!param) {
    throw new Error(`No param "${paramName}" on algorithm "${algorithmId}"`);
  }
  const ovr = overrides.get(algorithmId)?.get(paramName);
  return (ovr ?? param.default) as TValue;
}

export function getParamSnapshot(algorithmId: string): ParamSnapshot {
  const spec = declarations.get(algorithmId);
  if (!spec) {
    throw new Error(`No tunables declared for algorithm "${algorithmId}"`);
  }
  const out: Record<string, TunableValue> = {};
  for (const p of spec.params) {
    out[p.name] = getParamValue(algorithmId, p.name);
  }
  return { algorithmId, params: out };
}

// Write

export function setParamValue(
  algorithmId: string,
  paramName: string,
  value: TunableValue,
): void {
  const spec = declarations.get(algorithmId);
  if (!spec) {
    throw new Error(`No tunables declared for algorithm "${algorithmId}"`);
  }
  const param = spec.params.find((p) => p.name === paramName);
  if (!param) {
    throw new Error(`No param "${paramName}" on algorithm "${algorithmId}"`);
  }
  if (!validateParamValue(param, value)) {
    throw new Error(
      `Value ${JSON.stringify(value)} violates bounds for ${algorithmId}.${paramName}`,
    );
  }
  let bucket = overrides.get(algorithmId);
  if (!bucket) {
    bucket = new Map();
    overrides.set(algorithmId, bucket);
  }
  bucket.set(paramName, value);
  for (const listener of listeners) {
    listener(algorithmId, paramName, value);
  }
}

export function resetParamValue(algorithmId: string, paramName: string): void {
  overrides.get(algorithmId)?.delete(paramName);
}

export function resetAllParams(): void {
  overrides.clear();
}

// Persistence helpers

export function exportParamOverrides(): Record<string, Record<string, TunableValue>> {
  const out: Record<string, Record<string, TunableValue>> = {};
  for (const [algorithmId, bucket] of overrides) {
    out[algorithmId] = Object.fromEntries(bucket);
  }
  return out;
}

export function importParamOverrides(
  payload: Record<string, Record<string, TunableValue>>,
): void {
  overrides.clear();
  for (const [algorithmId, params] of Object.entries(payload)) {
    const spec = declarations.get(algorithmId);
    if (!spec) continue;
    const bucket = new Map<string, TunableValue>();
    for (const [name, value] of Object.entries(params)) {
      const param = spec.params.find((p) => p.name === name);
      if (!param) continue;
      if (!validateParamValue(param, value)) continue;
      bucket.set(name, value);
    }
    if (bucket.size > 0) overrides.set(algorithmId, bucket);
  }
}

// Hot-reload listeners

export function onParamChange(
  listener: (algorithmId: string, name: string, value: TunableValue) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Tests use this; app code does not.
export function resetTunableRegistry(): void {
  declarations.clear();
  overrides.clear();
  listeners.clear();
}

// Initial declarations - parameters that the existing algorithms expose
// for tuning. Kept conservative: only obvious knobs that the safe-
// adjustment engine could plausibly nudge.

declareAlgorithmTunables({
  algorithmId: 'truth-score',
  params: [
    {
      name: 'minIndependentSources',
      type: 'int',
      default: 2,
      min: 1,
      max: 5,
      description: 'Minimum independent sources for a high-confidence score',
    },
    {
      name: 'staleSourcePenalty',
      type: 'float',
      default: 0.2,
      min: 0,
      max: 0.5,
      description: 'Confidence reduction multiplier when a source is stale',
    },
  ],
});

declareAlgorithmTunables({
  algorithmId: 'big-event-detector',
  params: [
    {
      name: 'triggerThreshold',
      type: 'float',
      default: 0.65,
      min: 0.3,
      max: 0.95,
      description: 'Score threshold for declaring a big event',
    },
    {
      name: 'requireMultiTrigger',
      type: 'bool',
      default: true,
      description: 'Require at least two triggers to fire (vs any single trigger)',
    },
  ],
});

declareAlgorithmTunables({
  algorithmId: 'compound-risk',
  params: [
    {
      name: 'cascadeAmplifier',
      type: 'float',
      default: 1.25,
      min: 1,
      max: 2,
      description: 'Multiplier applied when two domains co-fire',
    },
    {
      name: 'minDomainsForCompound',
      type: 'int',
      default: 2,
      min: 2,
      max: 5,
      description: 'Minimum domains in agreement for a compound score',
    },
  ],
});

declareAlgorithmTunables({
  algorithmId: 'baseline-deviation',
  params: [
    {
      name: 'zScoreAlertThreshold',
      type: 'float',
      default: 2.5,
      min: 1,
      max: 5,
      description: 'z-score above which a sample is anomalous',
    },
  ],
});

declareAlgorithmTunables({
  algorithmId: 'watchlist-relevance',
  params: [
    {
      name: 'minRelevanceScore',
      type: 'float',
      default: 0.4,
      min: 0,
      max: 1,
      description: 'Threshold below which a hit is suppressed',
    },
  ],
});
