/**
 * App wiring for the evidence journal (R4-LOW-008): binds the three
 * calibration ledgers to the journal client and starts it in the desktop app.
 */

import {
  FORECAST_ACCURACY_MAX_PREDICTIONS,
  getForecastAccuracyEvidence,
  mergeRebuiltForecastAccuracy,
  type ForecastAccuracyPrediction,
} from '../forecast-accuracy';
import { logDebug } from '../reasoning-debug';
import { getApiBaseUrl, isDesktopRuntime } from '../runtime';
import { setEvidenceChangeHandler } from './evidence-bus';
import { createEvidenceJournal, type EvidenceJournal, type EvidenceSourceAdapter } from './evidence-journal';
import {
  emaForecastFromEvidence,
  emaTotalsFromEvidence,
  forecastFromEvidence,
  outcomeFromEvidence,
  projectEmaForecast,
  projectEmaTotals,
  projectForecast,
  projectOutcome,
  type EvidenceEntry,
} from './evidence-projection';
import type { PredictionRecord } from './forecast-calibration';
import {
  FORECAST_CALIBRATION_CAPACITY,
  getCalibrationStore,
  mergeRebuiltPredictions,
} from './forecast-calibration-adapter';
import { getOutcomeLedger, OUTCOME_LEDGER_CAPACITY, type OutcomeRecord } from './outcome-ledger';

function present<T>(value: T | null): value is T {
  return value !== null;
}

export function buildEvidenceSources(): EvidenceSourceAdapter[] {
  return [
    {
      kind: 'forecast',
      capacity: FORECAST_CALIBRATION_CAPACITY,
      rebuildKinds: ['forecast'],
      collect: () => Promise.all(getCalibrationStore().all().map((record) => projectForecast(record))),
      localCount: () => getCalibrationStore().all().length,
      mergeRebuilt: (byKind) => mergeRebuiltPredictions(
        (byKind.forecast ?? [])
          .map((entry) => forecastFromEvidence(entry.payload))
          .filter((record): record is PredictionRecord => present(record)),
      ),
    },
    {
      kind: 'alert-outcome',
      capacity: OUTCOME_LEDGER_CAPACITY,
      rebuildKinds: ['alert-outcome'],
      collect: () => Promise.all(getOutcomeLedger().list().map((record) => projectOutcome(record))),
      localCount: () => getOutcomeLedger().list().length,
      mergeRebuilt: (byKind) => getOutcomeLedger().mergeRebuilt(
        (byKind['alert-outcome'] ?? [])
          .map((entry) => outcomeFromEvidence(entry.payload))
          .filter((record): record is OutcomeRecord => present(record)),
      ),
    },
    {
      kind: 'ema-forecast',
      capacity: FORECAST_ACCURACY_MAX_PREDICTIONS,
      rebuildKinds: ['ema-forecast', 'ema-forecast-totals'],
      async collect() {
        const { predictions, totals } = getForecastAccuracyEvidence();
        const entries: EvidenceEntry[] = await Promise.all(predictions.map((p) => projectEmaForecast(p)));
        const totalsEntry = await projectEmaTotals(totals);
        return totalsEntry ? [...entries, totalsEntry] : entries;
      },
      localCount: () => getForecastAccuracyEvidence().predictions.length,
      mergeRebuilt(byKind) {
        const predictions = (byKind['ema-forecast'] ?? [])
          .map((entry) => emaForecastFromEvidence(entry.payload))
          .filter((p): p is ForecastAccuracyPrediction => present(p));
        const [totalsEntry] = byKind['ema-forecast-totals'] ?? [];
        return mergeRebuiltForecastAccuracy(predictions, totalsEntry ? emaTotalsFromEvidence(totalsEntry.payload) : null);
      },
    },
  ];
}

let journal: EvidenceJournal | null = null;

export function getEvidenceJournal(): EvidenceJournal {
  journal ??= createEvidenceJournal({
    // Late-bound so the desktop fetch patch (bearer token, local-only routing) applies.
    fetch: (input, init) => globalThis.fetch(input, init),
    baseUrl: getApiBaseUrl,
    available: isDesktopRuntime,
    sources: buildEvidenceSources(),
    log: (message, data) => logDebug({ level: 'warn', category: 'other', source: 'evidence-journal', message, data }),
  });
  return journal;
}

/** Start syncing in the desktop app; a no-op in the browser build. */
export function startEvidenceJournal(): void {
  if (!isDesktopRuntime()) return;
  const instance = getEvidenceJournal();
  setEvidenceChangeHandler(() => instance.noteChanged());
  instance.start();
}
