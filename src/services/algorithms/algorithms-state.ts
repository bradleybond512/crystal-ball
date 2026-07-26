/**
 * Algorithms state singleton wiring.
 *
 * Single source of truth: the catalog of algorithms is derived directly
 * from `algorithm-registry.ts` so health diagnostics, the evaluation
 * ledger, and the safe-adjustment proposal engine all see identical
 * ids, versions, criticalities, and domains. Previously this module
 * shadowed the registry with its own copy and used `-v1`-suffixed ids
 * that didn't join cleanly to evaluation records — that drift is now
 * removed.
 */

import {
  createAlgorithmEvaluationLedger,
  type AlgorithmEvaluationLedger,
  type AlgorithmDomain,
} from './algorithm-evaluation-ledger';
import type { AlgorithmDefinition as HealthDefinition } from './algorithm-health';
import { listAlgorithms, type AlgorithmDefinition as RegistryDefinition } from './algorithm-registry';
import { resetAlgorithmLedgerPersistence, setDefaultLedgerProvider } from './algorithm-ledger-persistence';

let ledger: AlgorithmEvaluationLedger | undefined;
let definitions: HealthDefinition[] | undefined;

export function getAlgorithmEvaluationLedger(): AlgorithmEvaluationLedger {
  ledger ??= createAlgorithmEvaluationLedger();
  return ledger;
}

// Register the default-ledger fallback so algorithm-ledger-persistence can reach
// it without importing this module back (breaks the runtime cycle browser-safely).
setDefaultLedgerProvider(getAlgorithmEvaluationLedger);

export function getAlgorithmDefinitions(): readonly HealthDefinition[] {
  definitions ??= deriveDefinitionsFromRegistry();
  return definitions;
}

export function resetAlgorithmsState(): void {
  ledger = undefined;
  definitions = undefined;
  resetAlgorithmLedgerPersistence();
}

/** Project a registry entry onto the health-aggregator's
 *  AlgorithmDefinition shape. The registry's `healthDomain` field is
 *  authoritative; entries without one fall through to the catch-all
 *  `'other'` domain so the health surface still tracks them. */
export function toHealthDefinition(reg: RegistryDefinition): HealthDefinition {
  return {
    algorithmId: reg.id,
    label: reg.label,
    version: reg.version,
    domain: (reg.healthDomain ?? 'other') as AlgorithmDomain,
    criticality: reg.criticality,
  };
}

function deriveDefinitionsFromRegistry(): HealthDefinition[] {
  return listAlgorithms().map((entry) => toHealthDefinition(entry));
}
