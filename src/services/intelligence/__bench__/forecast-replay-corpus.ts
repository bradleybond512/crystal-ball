import type { ForecastReplayFixture } from '../forecast-replay-benchmark';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const ANCHOR = Date.UTC(2025, 0, 1);
const RECORD_COUNT = 120;
const HORIZONS = [2 * HOUR, 18 * HOUR, 3 * DAY, 14 * DAY] as const;

export const FORECAST_REPLAY_CORPUS: readonly ForecastReplayFixture[] =
  Array.from({ length: RECORD_COUNT }, (_, index) => buildFixture(index));

function buildFixture(index: number): ForecastReplayFixture {
  const predictedAt = ANCHOR + index * DAY;
  const source = sourceFor(index);
  const domain = domainFor(source, index);
  const outcome = (index * 7 + Math.floor(index / 5)) % 10 < 4 ? 1 : 0;
  const horizon = HORIZONS[index % HORIZONS.length]!;
  const unresolved = index >= 40 && (index % 17 === 0 || index % 23 === 0);

  return {
    id: `replay-${String(index + 1).padStart(3, '0')}`,
    sourceId: source,
    domain,
    probability: probabilityFor(source, outcome, index),
    predictedAt,
    resolveBy: predictedAt + horizon,
    status: statusFor(unresolved, outcome, index),
    ...(unresolved ? {} : { resolvedAt: predictedAt + horizon }),
    labelOrigin: labelOriginFor(index),
    algorithmVersion: versionFor(source, index),
  };
}

function sourceFor(index: number): string {
  if (index % 5 < 2) return 'analyst-loop';
  if (index % 5 < 4) return 'security-mode';
  return 'weather-warning';
}

function domainFor(
  source: string,
  index: number,
): ForecastReplayFixture['domain'] {
  if (source === 'weather-warning') return 'weather';
  if (source === 'security-mode') {
    return index % 2 === 0 ? 'cyber' : 'conflict';
  }
  if (index % 3 === 0) return 'markets';
  if (index % 3 === 1) return 'conflict';
  return 'macro';
}

function probabilityFor(
  source: string,
  outcome: 0 | 1,
  index: number,
): number {
  if (source === 'analyst-loop') {
    if (index % 4 === 0) return outcome === 1 ? 0.15 : 0.88;
    return outcome === 1 ? 0.58 : 0.62;
  }
  if (source === 'security-mode') return outcome === 1 ? 0.78 : 0.22;
  if (index % 6 === 0) return outcome === 1 ? 0.82 : 0.86;
  return outcome === 1 ? 0.68 : 0.32;
}

function versionFor(source: string, index: number): string {
  if (source === 'analyst-loop') return index < 80 ? 'analyst-v1' : 'analyst-v2';
  if (source === 'security-mode') return 'security-v1';
  return 'weather-v1';
}

function statusFor(
  unresolved: boolean,
  outcome: 0 | 1,
  index: number,
): ForecastReplayFixture['status'] {
  if (unresolved) return index % 17 === 0 ? 'pending' : 'expired';
  return outcome === 1 ? 'resolved_true' : 'resolved_false';
}

function labelOriginFor(
  index: number,
): ForecastReplayFixture['labelOrigin'] {
  if (index % 13 === 0) return 'proxy';
  if (index % 11 === 0) return 'manual';
  return 'direct';
}
