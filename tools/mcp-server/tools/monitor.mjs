import { z } from 'zod';
import { quarantinedAlgorithmIds } from '../safety-policy.mjs';

const STATE_PATH = 'monitor/state.json';
const HISTORY_PATH = 'monitor/history.json';
const MAX_HISTORY = 96;

export const schemas = {
  get_monitor_status: {
    description: 'Read the latest persistent drift, cohort-health, feed-health, and quarantine monitor result.',
    inputSchema: z.object({}),
  },
  run_monitor_cycle: {
    description: 'Run and persist one drift, cohort-health, feed-health, and quarantine evaluation cycle now.',
    inputSchema: z.object({}),
  },
};

export function makeMonitorTools({ storage, granular, diagnostics, now = Date.now }) {
  async function run_monitor_cycle() {
    const [feedHealth, algorithmResult] = await Promise.all([
      granular.check_feed_health(),
      diagnostics.get_algorithm_diagnostics(),
    ]);
    const previous = storage.readJSON(STATE_PATH);
    const snapshot = captureSnapshot(feedHealth, algorithmResult, now());
    const findings = detectFindings(previous?.snapshot, snapshot);
    const activeIds = findings.map((finding) => finding.id);
    const previousIds = Array.isArray(previous?.activeIds) ? previous.activeIds : [];
    const newlyTriggered = activeIds.filter((id) => !previousIds.includes(id));
    const recovered = previousIds.filter((id) => !activeIds.includes(id));
    const state = {
      available: true,
      lastRunAt: snapshot.at,
      status: findings.some((finding) => finding.severity === 'red')
        ? 'red'
        : findings.length > 0
          ? 'yellow'
          : 'green',
      summary: findings.length === 0
        ? 'No active drift or quarantine findings.'
        : `${findings.length} active monitor finding(s); ${newlyTriggered.length} new; ${recovered.length} recovered.`,
      findings,
      newlyTriggered,
      recovered,
      activeIds,
      snapshot,
    };
    storage.writeJSON(STATE_PATH, state);
    const history = storage.readJSON(HISTORY_PATH);
    const rows = Array.isArray(history) ? history : [];
    rows.push({
      at: snapshot.at,
      status: state.status,
      activeIds,
      newlyTriggered,
      recovered,
      snapshot,
    });
    storage.writeJSON(HISTORY_PATH, rows.slice(-MAX_HISTORY));
    return publicState(state);
  }

  async function get_monitor_status() {
    const state = storage.readJSON(STATE_PATH);
    if (!state) {
      return {
        available: false,
        status: 'unknown',
        summary: 'The monitor has not completed a cycle yet.',
        findings: [],
        newlyTriggered: [],
        recovered: [],
      };
    }
    return publicState(state);
  }

  return { get_monitor_status, run_monitor_cycle };
}

export function startMonitorScheduler(runCycle, {
  intervalMs,
  setIntervalFn = setInterval,
} = {}) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return null;
  const timer = setIntervalFn(() => {
    Promise.resolve(runCycle()).catch(() => {
      console.error('[crystalball-mcp] Scheduled monitor cycle failed.');
    });
  }, intervalMs);
  timer.unref?.();
  return timer;
}

export function monitorIntervalMs(env = process.env) {
  const raw = env.CRYSTALBALL_MCP_MONITOR_INTERVAL_MINUTES;
  if (raw === '0' || raw === 'off') return 0;
  const minutes = raw === undefined ? 15 : Number(raw);
  if (!Number.isFinite(minutes) || minutes < 1) return 0;
  return Math.min(minutes, 24 * 60) * 60_000;
}

function captureSnapshot(feedHealth, algorithmResult, at) {
  const diagnostics = algorithmResult?.diagnostics ?? {};
  const forecast = diagnostics.forecastCalibration ?? {};
  const evaluation = forecast.evaluation ?? {};
  const exclusions = evaluation.overall?.exclusions ?? {};
  return {
    at,
    sidecarAvailable: !feedHealth?.data?.sidecar?.error,
    algorithmDiagnosticsAvailable: algorithmResult?.available === true,
    feeds: Object.fromEntries((feedHealth?.data?.feeds ?? [])
      .map((feed) => [feed.route, feed.status])),
    brier: metricValue(evaluation.overall?.brier),
    resolutionCoverage: finiteOrNull(
      forecast.resolutionQuality?.summary?.resolutionCoverage),
    predictionVolume: finiteOrNull(forecast.summary?.total),
    missingness: ['proxyLabels', 'invalidProbabilities', 'trainingWindowOverlap']
      .reduce((total, key) => total + (finiteOrNull(exclusions[key]) ?? 0), 0),
    versionLoss: Object.fromEntries((evaluation.lossAttribution?.byAlgorithmVersion ?? [])
      .filter((row) => typeof row?.key === 'string')
      .map((row) => [row.key, finiteOrNull(row.shareOfBrierLoss) ?? 0])),
    quarantinedAlgorithms: quarantinedAlgorithmIds(diagnostics.health),
  };
}

function detectFindings(previous, current) {
  const findings = [];
  if (!current.sidecarAvailable) {
    findings.push({
      id: 'collection.sidecar-unavailable',
      severity: 'red',
      summary: 'Crystal Ball live collection is unavailable.',
      nextAction: 'Launch Crystal Ball and verify the authenticated local sidecar.',
    });
  }
  if (!current.algorithmDiagnosticsAvailable) {
    findings.push({
      id: 'collection.algorithm-diagnostics-unavailable',
      severity: 'red',
      summary: 'Algorithm diagnostics are unavailable.',
      nextAction: 'Restore renderer diagnostics before trusting derived conclusions.',
    });
  }
  findings.push(...current.quarantinedAlgorithms.map((algorithmId) => ({
    id: `algorithm.quarantined.${algorithmId}`,
    severity: 'red',
    summary: `${algorithmId} is quarantined from derived conclusions.`,
    nextAction: 'Replay recent direct-outcome evidence and require manual review before restoring output.',
  })));
  if (!previous) return findings;

  for (const [route, status] of Object.entries(current.feeds)) {
    if (previous.feeds?.[route] === 'ok' && status !== 'ok') {
      findings.push({
        id: `drift.feed.${route}`,
        severity: 'yellow',
        summary: `${route} changed from ready to ${status}.`,
        nextAction: 'Check credentials, provider health, and recent request errors.',
      });
    }
  }
  if (hasDelta(previous.brier, current.brier, 0.05)) {
    findings.push({
      id: 'drift.calibration.brier',
      severity: 'red',
      summary: `Holdout Brier worsened from ${previous.brier.toFixed(3)} to ${current.brier.toFixed(3)}.`,
      nextAction: 'Inspect matched cohorts and block promotion until the regression is explained.',
    });
  }
  if (
    previous.resolutionCoverage !== null
    && current.resolutionCoverage !== null
    && previous.resolutionCoverage - current.resolutionCoverage >= 0.1
  ) {
    findings.push({
      id: 'drift.resolution.coverage',
      severity: 'yellow',
      summary: `Resolution coverage fell from ${percent(previous.resolutionCoverage)} to ${percent(current.resolutionCoverage)}.`,
      nextAction: 'Inspect resolver cadence, expired predictions, and provider coverage.',
    });
  }
  if (
    previous.predictionVolume > 0
    && current.predictionVolume !== null
    && (current.predictionVolume / previous.predictionVolume < 0.5
      || current.predictionVolume / previous.predictionVolume > 2)
  ) {
    findings.push({
      id: 'drift.prediction.volume',
      severity: 'yellow',
      summary: `Prediction volume changed from ${previous.predictionVolume} to ${current.predictionVolume}.`,
      nextAction: 'Check ingestion volume, feature missingness, and algorithm version rollout.',
    });
  }
  if (current.missingness - (previous.missingness ?? 0) >= 5) {
    findings.push({
      id: 'drift.feature.missingness',
      severity: 'yellow',
      summary: `Evaluation exclusions increased from ${previous.missingness ?? 0} to ${current.missingness}.`,
      nextAction: 'Inspect missing features and cohort contamination before recalibration.',
    });
  }
  for (const [version, share] of Object.entries(current.versionLoss)) {
    const before = previous.versionLoss?.[version];
    if (typeof before === 'number' && share - before >= 0.2) {
      findings.push({
        id: `drift.version-loss.${version}`,
        severity: 'red',
        summary: `${version} Brier-loss share rose from ${percent(before)} to ${percent(share)}.`,
        nextAction: 'Hold or roll back this version and inspect its matched cohort.',
      });
    }
  }
  return findings;
}

function publicState(state) {
  return {
    available: state.available,
    lastRunAt: state.lastRunAt,
    status: state.status,
    summary: state.summary,
    findings: state.findings,
    newlyTriggered: state.newlyTriggered,
    recovered: state.recovered,
    snapshot: state.snapshot,
  };
}

function metricValue(metric) {
  return metric?.status === 'ok' ? finiteOrNull(metric.value) : null;
}

function finiteOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function hasDelta(before, after, threshold) {
  return before !== null && after !== null && after - before >= threshold;
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}
