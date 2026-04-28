/**
 * Algorithms state singleton wiring.
 *
 * Holds the Evaluation Ledger and a default algorithm catalog so the
 * Algorithm Diagnostic Panel can read live state without each panel
 * rebuilding the registries.
 */

import {
  createAlgorithmEvaluationLedger,
  type AlgorithmEvaluationLedger,
} from './algorithm-evaluation-ledger';
import type { AlgorithmDefinition } from './algorithm-health';

let ledger: AlgorithmEvaluationLedger | undefined;
let definitions: AlgorithmDefinition[] | undefined;

export function getAlgorithmEvaluationLedger(): AlgorithmEvaluationLedger {
  ledger ??= createAlgorithmEvaluationLedger();
  return ledger;
}

export function getAlgorithmDefinitions(): readonly AlgorithmDefinition[] {
  definitions ??= defaultAlgorithmCatalog();
  return definitions;
}

export function resetAlgorithmsState(): void {
  ledger = undefined;
  definitions = undefined;
}

function defaultAlgorithmCatalog(): AlgorithmDefinition[] {
  return [
    {
      algorithmId: 'truth-score-v1',
      label: 'Truth scorer',
      domain: 'truth_score',
      criticality: 'high',
    },
    {
      algorithmId: 'evidence-graph-v1',
      label: 'Evidence graph',
      domain: 'evidence_graph',
      criticality: 'high',
    },
    {
      algorithmId: 'situation-clustering-v1',
      label: 'Situation clustering',
      domain: 'situation_clustering',
      criticality: 'medium',
    },
    {
      algorithmId: 'baseline-deviation-v1',
      label: 'Baseline deviation',
      domain: 'baseline_deviation',
      criticality: 'medium',
    },
    {
      algorithmId: 'compound-risk-v1',
      label: 'Compound risk',
      domain: 'compound_risk',
      criticality: 'high',
    },
    {
      algorithmId: 'forecast-calibration-v1',
      label: 'Forecast calibration',
      domain: 'forecast_calibration',
      criticality: 'medium',
    },
    {
      algorithmId: 'watchlist-relevance-v1',
      label: 'Watchlist relevance',
      domain: 'watchlist_relevance',
      criticality: 'medium',
    },
    {
      algorithmId: 'negative-evidence-v1',
      label: 'Negative evidence',
      domain: 'negative_evidence',
      criticality: 'medium',
    },
    {
      algorithmId: 'shortage-score-v1',
      label: 'Shortage scorer',
      domain: 'shortage_score',
      criticality: 'medium',
    },
    {
      algorithmId: 'weather-polygon-v1',
      label: 'Weather polygon match',
      domain: 'weather_polygon',
      criticality: 'safety',
    },
    {
      algorithmId: 'weather-urgency-v1',
      label: 'Weather urgency ladder',
      domain: 'weather_urgency',
      criticality: 'safety',
    },
    {
      algorithmId: 'reasoning-hypothesis-v1',
      label: 'Reasoning hypothesis fuser',
      domain: 'reasoning_hypothesis',
      criticality: 'medium',
    },
  ];
}
