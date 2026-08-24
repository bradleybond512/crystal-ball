import { z } from 'zod';
import {
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { acquireLocalLock } from '../local-lock.mjs';
import { quarantinedAlgorithmIds } from '../safety-policy.mjs';
import { recordWeeklyEvaluation as recordWeeklyEvaluationDefault } from '../weekly-evaluation-report.mjs';
import {
  monitorGenerationId,
  publicMonitorEvents,
  reconcileMonitorEvents,
  validCommittedMonitorState,
} from './monitor-events.mjs';

const STATE_PATH = 'monitor/state.json';
const HISTORY_PATH = 'monitor/history.json';
const EVENTS_PATH = 'monitor/events.json';
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

export function makeMonitorTools({
  storage,
  granular,
  diagnostics,
  lockOptions,
  now = Date.now,
  recordWeeklyEvaluation = recordWeeklyEvaluationDefault,
  scheduleOptions,
  writeJSONAtomic = writeMonitorJSONAtomic,
}) {
  async function run_monitor_cycle() {
    const releaseLock = acquireLocalLock(storage.resolve('monitor/cycle.lock'), lockOptions);
    try {
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
      const generationId = monitorGenerationId(snapshot.at);
      const state = {
        schemaVersion: 1,
        generationId,
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
      const eventState = reconcileMonitorEvents(
        storage.readJSON(EVENTS_PATH),
        findings,
        snapshot.at,
        scheduleOptions,
      );
      writeJSONAtomic(storage, EVENTS_PATH, eventState);
      writeJSONAtomic(storage, STATE_PATH, state);
      const history = storage.readJSON(HISTORY_PATH);
      const rows = Array.isArray(history) ? history : [];
      rows.push({
        schemaVersion: 1,
        generationId,
        at: snapshot.at,
        status: state.status,
        activeIds,
        newlyTriggered,
        recovered,
        snapshot,
      });
      writeJSONAtomic(storage, HISTORY_PATH, rows.slice(-MAX_HISTORY));
      const committed = committedGeneration(storage, generationId);
      if (committed === null) {
        throw new Error('Weekly evaluation requires a valid committed monitor generation.');
      }
      await recordWeeklyEvaluation({
        storage,
        at: snapshot.at,
        monitorState: committed.state,
        monitorEvents: committed.events,
        evaluationProjection: algorithmResult?.evaluationReportProjection ?? null,
        diagnosticsStale: snapshot.algorithmDiagnosticsStale,
      });
      return publicState(committed.state, committed.events, snapshot.at);
    } finally {
      releaseLock();
    }
  }

  async function get_monitor_status() {
    const state = storage.readJSON(STATE_PATH);
    if (!state) {
      const monitorEvents = publicMonitorEvents(storage.readJSON(EVENTS_PATH), now());
      return {
        available: false,
        status: 'unknown',
        summary: 'The monitor has not completed a cycle yet.',
        findings: [],
        newlyTriggered: [],
        recovered: [],
        schedule: monitorEvents.schedule,
        events: monitorEvents.events,
      };
    }
    return publicState(state, storage.readJSON(EVENTS_PATH), now());
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
  const minutes = raw === undefined ? 0 : Number(raw);
  if (!Number.isFinite(minutes) || minutes < 1) return 0;
  return Math.min(minutes, 24 * 60) * 60_000;
}

export function writeMonitorJSONAtomic(storage, relPath, data, {
  renameSyncFn = renameSync,
} = {}) {
  const destination = storage.resolve(relPath);
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  mkdirSync(dirname(destination), { recursive: true });
  try {
    writeFileSync(temporary, JSON.stringify(data, null, 2), {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    renameSyncFn(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function captureSnapshot(feedHealth, algorithmResult, at) {
  const diagnostics = algorithmResult?.diagnostics ?? {};
  const forecast = diagnostics.forecastCalibration ?? {};
  const evaluation = forecast.evaluation ?? {};
  const exclusions = evaluation.overall?.exclusions ?? {};
  const sidecar = feedHealth?.data?.sidecar;
  const feedRows = Array.isArray(feedHealth?.data?.feeds)
    ? feedHealth.data.feeds
    : [];
  return {
    at,
    sidecarAvailable: sidecar !== null
      && typeof sidecar === 'object'
      && !sidecar.error
      && Number.isFinite(sidecar.pid),
    feedHealthValid: Array.isArray(feedHealth?.data?.feeds),
    algorithmDiagnosticsAvailable: algorithmResult?.available === true,
    algorithmDiagnosticsStale: algorithmResult?.stale === true,
    feeds: Object.fromEntries(feedRows
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
  if (!current.feedHealthValid) {
    findings.push({
      id: 'collection.feed-health-invalid',
      severity: 'red',
      summary: 'Crystal Ball feed-health diagnostics are invalid.',
      nextAction: 'Repair the feed-health response before trusting provider readiness.',
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
  if (current.algorithmDiagnosticsStale) {
    findings.push({
      id: 'collection.algorithm-diagnostics-stale',
      severity: 'red',
      summary: 'Algorithm diagnostics are stale.',
      nextAction: 'Restore fresh renderer diagnostics before trusting weekly evaluation metrics.',
    });
  }
  findings.push(...current.quarantinedAlgorithms.map((algorithmId) => ({
    id: `algorithm.quarantined.${algorithmId}`,
    severity: 'red',
    summary: `${algorithmId} is quarantined from derived conclusions.`,
    nextAction: 'Replay recent direct-outcome evidence and require manual review before restoring output.',
  })));
  for (const [route, status] of Object.entries(current.feeds)) {
    if (status !== 'ok') {
      const changed = previous?.feeds?.[route] === 'ok';
      findings.push({
        id: `drift.feed.${route}`,
        severity: 'yellow',
        summary: changed
          ? `${route} changed from ready to ${status}.`
          : `${route} is ${status}.`,
        nextAction: 'Check credentials, provider health, and recent request errors.',
      });
    }
  }
  if (!previous) return findings;
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

function publicState(state, eventState, at) {
  const monitorEvents = publicMonitorEvents(eventState, at);
  if (!validCommittedMonitorState(state, eventState)) {
    return {
      available: false,
      status: 'unknown',
      summary: 'The monitor state is incomplete or from mismatched generations.',
      findings: [],
      newlyTriggered: [],
      recovered: [],
      schedule: monitorEvents.schedule,
      events: [],
    };
  }
  return {
    schemaVersion: state.schemaVersion,
    generationId: state.generationId,
    available: state.available,
    lastRunAt: state.lastRunAt,
    status: state.status,
    summary: state.summary,
    findings: state.findings,
    newlyTriggered: state.newlyTriggered,
    recovered: state.recovered,
    snapshot: state.snapshot,
    schedule: monitorEvents.schedule,
    events: monitorEvents.events,
  };
}

function committedGeneration(storage, generationId) {
  const state = storage.readJSON(STATE_PATH);
  const events = storage.readJSON(EVENTS_PATH);
  const history = storage.readJSON(HISTORY_PATH);
  const latest = Array.isArray(history) ? history.at(-1) : null;
  if (
    !validCommittedMonitorState(state, events)
    || state.generationId !== generationId
    || latest?.schemaVersion !== 1
    || latest?.generationId !== generationId
    || latest?.at !== state.lastRunAt
  ) return null;
  return { state, events };
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
