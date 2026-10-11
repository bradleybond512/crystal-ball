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
import { getApiBaseUrl } from '../runtime';
import { getEvidenceOutbox, isEvidenceCaptureOwner } from './evidence-outbox';
import { captureEvidence, setEvidenceChangeHandler } from './evidence-bus';
import { createEvidenceJournal, type EvidenceJournal, type EvidenceSourceAdapter } from './evidence-journal';
import {
  evidenceDraftRefusal,
  emaForecastFromEvidence,
  emaTotalsFromEvidence,
  forecastFromEvidence,
  outcomeFromEvidence,
  projectEvidenceDrafts,
  snapshotEvidence,
  type EvidenceCapture,
  type EvidenceDraft,
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

function workingDraft(change: EvidenceCapture): EvidenceDraft | null {
  try {
    const draft = snapshotEvidence(change);
    if (draft && evidenceDraftRefusal(draft)) { captureEvidence(change); return null; }
    return draft;
  } catch {
    // Capture reports the malformed state's refusal without retaining its data.
    captureEvidence(change);
    return null;
  }
}

export function buildEvidenceSources(): EvidenceSourceAdapter[] {
  return [
    {
      kind: 'forecast',
      capacity: FORECAST_CALIBRATION_CAPACITY,
      rebuildKinds: ['forecast'],
      collect: () => projectEvidenceDrafts(getCalibrationStore().all().map(record => workingDraft({ kind: 'forecast', record })).filter(value => present(value))),
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
      collect: () => projectEvidenceDrafts(getOutcomeLedger().list().map(record => workingDraft({ kind: 'alert-outcome', record })).filter(value => present(value))),
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
        const drafts = predictions.map(record => workingDraft({ kind: 'ema-forecast', record })).filter(value => present(value));
        const totalsDraft = workingDraft({ kind: 'ema-forecast-totals', record: totals });
        if (totalsDraft) drafts.push(totalsDraft);
        return projectEvidenceDrafts(drafts);
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
    available: isEvidenceCaptureOwner,
    outbox: getEvidenceOutbox(),
    sources: buildEvidenceSources(),
    log: (message, data) => logDebug({ level: 'warn', category: 'other', source: 'evidence-journal', message, data }),
  });
  return journal;
}

/** Start syncing in the desktop app; a no-op in the browser build. */
export function startEvidenceJournal(): void {
  if (!isEvidenceCaptureOwner()) return;
  const instance = getEvidenceJournal();
  setEvidenceChangeHandler(() => instance.noteChanged());
  instance.start();
}
