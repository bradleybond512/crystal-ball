const REDACTION_PATTERNS = [
  [/\bBearer\s+\S+/gi, 'Bearer [REDACTED]'],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL]'],
  [/([?&](?:api[_-]?key|token|secret|password|access_token)=)[^&#\s]+/gi, '$1[REDACTED]'],
  [/\/Users\/[^/\s]+/g, '/Users/[USER]'],
];

const HEALTHY_FEED_STATES = new Set(['healthy', 'ok', 'fresh', 'up', 'operational']);
const DEGRADED_FEED_STATES = new Set(['degraded', 'stale', 'fallback', 'limited', 'never']);
const FAILED_FEED_STATES = new Set(['error', 'failed', 'failing', 'down', 'outage', 'unavailable']);
const SEVERITY_RANK = { red: 0, yellow: 1 };

export function redactDiagnosticText(value) {
  let output = String(value ?? '');
  for (const [pattern, replacement] of REDACTION_PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

export function buildDoctorReport(input) {
  const findings = [];
  const health = objectOrNull(input.health);
  const heartbeat = objectOrNull(input.heartbeat);
  const analyst = objectOrNull(input.analyst);
  const algorithmDiagnostics = objectOrNull(analyst?.algorithmDiagnostics);

  inspectRuntime({ health, heartbeat, now: input.now, findings });
  inspectFeeds(input.feeds, findings);
  inspectAnalyst(analyst, findings);
  inspectAlgorithms(algorithmDiagnostics, findings);
  inspectSelfTest(input.selfTest, findings);
  inspectLogs(input.logLines, findings);

  findings.sort((a, b) => {
    const severityDelta = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (severityDelta !== 0) return severityDelta;
    return a.priority - b.priority;
  });

  const status = statusFromFindings(findings);

  const report = {
    schemaVersion: 1,
    generatedAt: input.now,
    durationMs: input.durationMs,
    status,
    summary: summarizeStatus(status, findings),
    runtime: {
      available: health?.ok === true,
      pid: finiteOrNull(health?.pid),
      port: finiteOrNull(health?.port) ?? finiteOrNull(heartbeat?.port),
      uptimeMs: finiteOrNull(health?.uptime_ms),
      rssMb: finiteOrNull(health?.rss_mb),
      heapMb: finiteOrNull(health?.heap_mb),
      eventLoopLagMs: finiteOrNull(heartbeat?.event_loop_lag_ms),
      heartbeatAgeMs: heartbeatAgeMs(heartbeat, input.now),
      keysConfigured: finiteOrNull(health?.keys_configured),
      keysTotal: finiteOrNull(health?.keys_total),
    },
    feeds: summarizeFeeds(input.feeds),
    analyst: {
      available: analyst?.available === true,
      stale: analyst?.stale === true,
      ageMs: finiteOrNull(analyst?.ageMs),
      errorCounts: objectOrEmpty(analyst?.debugErrorCounts),
    },
    algorithms: {
      available: algorithmDiagnostics !== null,
      health: objectOrNull(algorithmDiagnostics?.health),
      ledger: objectOrNull(algorithmDiagnostics?.ledger),
      runtime: Array.isArray(algorithmDiagnostics?.runtime) ? algorithmDiagnostics.runtime : [],
      proposals: Array.isArray(algorithmDiagnostics?.proposals) ? algorithmDiagnostics.proposals : [],
      tunings: Array.isArray(algorithmDiagnostics?.tunings) ? algorithmDiagnostics.tunings : [],
      recentEvaluations: Array.isArray(algorithmDiagnostics?.recentEvaluations)
        ? algorithmDiagnostics.recentEvaluations
        : [],
      recentTuningDecisions: Array.isArray(algorithmDiagnostics?.recentTuningDecisions)
        ? algorithmDiagnostics.recentTuningDecisions
        : [],
    },
    selfTest: input.selfTest ?? null,
    findings: findings.map((finding) => publicFinding(finding)),
  };
  return redactDiagnosticValue(report);
}

function inspectRuntime({ health, heartbeat, now, findings }) {
  if (!health || health.ok !== true) {
    addFinding(findings, {
      id: 'runtime.sidecar_unavailable',
      severity: 'red',
      priority: 1,
      summary: 'The local API sidecar is not reachable.',
      evidence: redactDiagnosticText(health?.error ?? 'No valid /api/health response'),
      nextAction: 'Launch Crystal Ball, then rerun `npm run doctor`; inspect desktop.log if the sidecar still does not start.',
    });
    return;
  }

  if (!heartbeat) {
    addFinding(findings, {
      id: 'runtime.heartbeat_missing',
      severity: 'yellow',
      priority: 15,
      summary: 'The sidecar heartbeat file is missing or unreadable.',
      evidence: 'No sidecar.health.json payload was available.',
      nextAction: 'Confirm the installed app can write to its private log directory and restart Crystal Ball.',
    });
    return;
  }

  const lag = finiteOrNull(heartbeat.event_loop_lag_ms);
  if (lag !== null && lag > 2000) {
    addFinding(findings, {
      id: 'runtime.event_loop_lag',
      severity: 'red',
      priority: 2,
      summary: `The sidecar event loop stalled for ${Math.round(lag)} ms.`,
      evidence: `sidecar.health.json event_loop_lag_ms=${lag}`,
      nextAction: 'Inspect the latest local-api.log requests around this heartbeat and profile the slow route before changing retry thresholds.',
    });
  } else if (lag !== null && lag > 500) {
    addFinding(findings, {
      id: 'runtime.event_loop_lag',
      severity: 'yellow',
      priority: 2,
      summary: `The sidecar event loop lagged for ${Math.round(lag)} ms.`,
      evidence: `sidecar.health.json event_loop_lag_ms=${lag}`,
      nextAction: 'Compare local-api.log timestamps with active feed refreshes and rerun with `WM_TRACE=1` if the lag repeats.',
    });
  }

  const ageMs = heartbeatAgeMs(heartbeat, now);
  if (ageMs !== null && ageMs > 30_000) {
    addFinding(findings, {
      id: 'runtime.heartbeat_stale',
      severity: 'red',
      priority: 3,
      summary: `The sidecar heartbeat is ${Math.round(ageMs / 1000)} seconds old.`,
      evidence: `last_heartbeat=${redactDiagnosticText(heartbeat.last_heartbeat)}`,
      nextAction: 'Restart Crystal Ball and inspect local-api.log for the last completed request before the heartbeat stopped.',
    });
  }

  if (
    finiteOrNull(health.pid) !== null
    && finiteOrNull(heartbeat.pid) !== null
    && health.pid !== heartbeat.pid
  ) {
    addFinding(findings, {
      id: 'runtime.pid_mismatch',
      severity: 'yellow',
      priority: 4,
      summary: 'Health and heartbeat report different sidecar processes.',
      evidence: `/api/health pid=${health.pid}; heartbeat pid=${heartbeat.pid}`,
      nextAction: 'Wait ten seconds and rerun; if the mismatch persists, restart the app to clear stale runtime files.',
    });
  }
}

function inspectFeeds(payload, findings) {
  for (const feed of feedRows(payload)) {
    const state = feedState(feed);
    if (HEALTHY_FEED_STATES.has(state) || state === '') continue;
    if (!DEGRADED_FEED_STATES.has(state) && !FAILED_FEED_STATES.has(state)) continue;
    const id = String(feed.id ?? feed.name ?? feed.feedId ?? 'unknown');
    const reason = feed.lastError ?? feed.error ?? feed.reason ?? state;
    addFinding(findings, {
      id: `feed.${id}`,
      severity: 'yellow',
      priority: FAILED_FEED_STATES.has(state) ? 50 : 60,
      summary: `${id} is ${state}.`,
      evidence: redactDiagnosticText(reason),
      nextAction: 'Check provider credentials and the upstream response; keep fallback data labeled instead of weakening validation.',
    });
  }
}

function inspectAnalyst(analyst, findings) {
  if (!analyst || analyst.available !== true) {
    addFinding(findings, {
      id: 'renderer.mirror_unavailable',
      severity: 'yellow',
      priority: 35,
      summary: 'Renderer diagnostics have not reached the sidecar.',
      evidence: redactDiagnosticText(analyst?.message ?? 'No analyst-state snapshot'),
      nextAction: 'Keep the Crystal Ball window open for fifteen seconds, then rerun the doctor command.',
    });
    return;
  }
  if (analyst.stale === true) {
    addFinding(findings, {
      id: 'renderer.mirror_stale',
      severity: 'yellow',
      priority: 36,
      summary: 'The renderer diagnostics mirror is stale.',
      evidence: `snapshot age=${Math.round((finiteOrNull(analyst.ageMs) ?? 0) / 1000)}s`,
      nextAction: 'Inspect the latest renderer errors and confirm the sidecar-pusher loop is ticking.',
    });
  }
  const errorCounts = objectOrEmpty(analyst.debugErrorCounts);
  const totalErrors = Object.values(errorCounts)
    .filter((value) => Number.isFinite(value))
    .reduce((sum, value) => sum + Number(value), 0);
  if (totalErrors > 0) {
    addFinding(findings, {
      id: 'renderer.reasoning_errors',
      severity: 'yellow',
      priority: 37,
      summary: `${totalErrors} reasoning error(s) were recorded in this renderer session.`,
      evidence: JSON.stringify(errorCounts),
      nextAction: 'Use the MCP `get_reasoning_debug_log` tool or inspect the doctor JSON to isolate the failing category.',
    });
  }
}

function inspectAlgorithms(snapshot, findings) {
  if (!snapshot) return;
  inspectAlgorithmHealth(snapshot, findings);
  inspectAlgorithmPersistence(snapshot, findings);
  inspectAlgorithmRuntimes(snapshot, findings);
}

function inspectAlgorithmHealth(snapshot, findings) {
  const algorithms = Array.isArray(snapshot.health?.algorithms) ? snapshot.health.algorithms : [];
  for (const algorithm of algorithms) {
    if (!['unsafe', 'failing', 'degraded'].includes(algorithm.status)) continue;
    addFinding(findings, {
      id: `algorithm.${algorithm.status}.${algorithm.algorithmId}`,
      severity: algorithm.status === 'degraded' ? 'yellow' : 'red',
      priority: algorithmPriority(algorithm.status),
      summary: `${algorithm.algorithmId} is ${algorithm.status}.`,
      evidence: redactDiagnosticText(algorithm.reason ?? ''),
      nextAction: redactDiagnosticText(
        algorithm.recommendedAdjustment
          || 'Replay recent evaluations before changing any bounded tuning parameter.',
      ),
    });
  }
}

function inspectAlgorithmPersistence(snapshot, findings) {
  const persistence = objectOrNull(snapshot.ledger?.persistence);
  if (persistence?.lastLoadStatus === 'error' || persistence?.lastSaveStatus === 'error') {
    addFinding(findings, {
      id: 'algorithm.ledger_persistence',
      severity: 'red',
      priority: 22,
      summary: 'Algorithm evaluation history is not persisting reliably.',
      evidence: redactDiagnosticText(persistence.lastError ?? 'ledger persistence error'),
      nextAction: 'Repair the persistent-cache failure before tuning; otherwise calibration decisions will be based on incomplete history.',
    });
  }
}

function inspectAlgorithmRuntimes(snapshot, findings) {
  const runtimes = Array.isArray(snapshot.runtime) ? snapshot.runtime : [];
  for (const runtime of runtimes) {
    if ((runtime.errors ?? 0) > 0) {
      addFinding(findings, {
        id: `algorithm.runtime_errors.${runtime.algorithmId}`,
        severity: 'yellow',
        priority: 31,
        summary: `${runtime.algorithmId} recorded ${runtime.errors} runtime error(s).`,
        evidence: `${runtime.totalRuns ?? 0} total runs; lastRunAt=${runtime.lastRunAt ?? 'never'}`,
        nextAction: 'Inspect recentEvaluations for the failing label, reproduce with the replay harness, and only then adjust parameters.',
      });
    }
    const p95 = finiteOrNull(runtime.latencyMs?.p95);
    if (p95 !== null && p95 > 5000) {
      addFinding(findings, {
        id: `algorithm.slow.${runtime.algorithmId}`,
        severity: p95 > 10_000 ? 'red' : 'yellow',
        priority: 32,
        summary: `${runtime.algorithmId} p95 latency is ${Math.round(p95)} ms.`,
        evidence: JSON.stringify(runtime.latencyMs),
        nextAction: 'Profile the algorithm input size and hot path; compare against a replay fixture before increasing timeouts.',
      });
    }
  }
}

function algorithmPriority(status) {
  if (status === 'unsafe') return 20;
  if (status === 'failing') return 25;
  return 30;
}

function inspectSelfTest(selfTest, findings) {
  if (!selfTest) return;
  const summary = objectOrEmpty(selfTest.summary);
  const failed = Number(summary.fail ?? summary.failed ?? 0);
  const degraded = Number(summary.degraded ?? 0);
  if (failed > 0) {
    addFinding(findings, {
      id: 'self_test.failed',
      severity: 'red',
      priority: 10,
      summary: `${failed} deep self-test probe(s) failed.`,
      evidence: summarizeFailedSelfTests(selfTest.results),
      nextAction: 'Inspect the named routes and their upstream providers; do not treat the sidecar as fully operational until they recover.',
    });
  } else if (degraded > 0) {
    addFinding(findings, {
      id: 'self_test.degraded',
      severity: 'yellow',
      priority: 40,
      summary: `${degraded} deep self-test probe(s) were degraded.`,
      evidence: summarizeFailedSelfTests(selfTest.results),
      nextAction: 'Compare route latency with its provider status and retry after the upstream cooldown.',
    });
  }
}

function inspectLogs(lines, findings) {
  if (!Array.isArray(lines) || lines.length === 0) return;
  const fatal = lines.filter((line) =>
    /\bpanic\b|watchdog.*(?:reload|stall)|\[ERROR\].*(?:thread|main\.rs|src-tauri)/i.test(line),
  );
  if (fatal.length > 0) {
    addFinding(findings, {
      id: 'log.fatal',
      severity: 'red',
      priority: 5,
      summary: `${fatal.length} fatal/watchdog event(s) appear in the current app session.`,
      evidence: redactDiagnosticText(fatal.at(-1)).slice(0, 500),
      nextAction: 'Open the latest desktop.log session and the paired watchdog sample before relaunching again.',
    });
  }

  const analysisFailures = lines.filter((line) =>
    /Correlation analysis failed|analysis-worker.*(?:error|failed|timeout)/i.test(line),
  );
  if (analysisFailures.length > 0) {
    addFinding(findings, {
      id: 'log.analysis_failure',
      severity: 'yellow',
      priority: 33,
      summary: `${analysisFailures.length} analysis worker failure(s) appear in the current app session.`,
      evidence: redactDiagnosticText(analysisFailures.at(-1)).slice(0, 500),
      nextAction: 'Compare the algorithm runtime row with the correlation input cap and reproduce the same cluster count in a benchmark.',
    });
  }
}

function summarizeFeeds(payload) {
  const summary = { total: 0, healthy: 0, degraded: 0, failed: 0, unknown: 0 };
  for (const feed of feedRows(payload)) {
    summary.total += 1;
    const state = feedState(feed);
    if (HEALTHY_FEED_STATES.has(state)) summary.healthy += 1;
    else if (DEGRADED_FEED_STATES.has(state)) summary.degraded += 1;
    else if (FAILED_FEED_STATES.has(state)) summary.failed += 1;
    else summary.unknown += 1;
  }
  return summary;
}

function feedRows(payload) {
  return Array.isArray(payload?.feeds) ? payload.feeds : [];
}

function feedState(feed) {
  return String(feed?.status ?? feed?.state ?? feed?.health ?? '').toLowerCase();
}

function heartbeatAgeMs(heartbeat, now) {
  if (!heartbeat) return null;
  const timestamp = Date.parse(String(heartbeat.last_heartbeat ?? ''));
  return Number.isFinite(timestamp) ? Math.max(0, now - timestamp) : null;
}

function summarizeFailedSelfTests(results) {
  if (!Array.isArray(results)) return 'No per-route results returned.';
  return results
    .filter((result) => result.verdict !== 'ok' && result.ok !== true)
    .slice(0, 5)
    .map((result) => `${result.route ?? 'unknown'}: ${result.error ?? result.verdict ?? result.status}`)
    .join('; ');
}

function summarizeStatus(status, findings) {
  if (status === 'green') return 'No actionable runtime problems detected.';
  const red = findings.filter((finding) => finding.severity === 'red').length;
  const yellow = findings.filter((finding) => finding.severity === 'yellow').length;
  return `${red} critical and ${yellow} warning finding(s), ranked by likely operational impact.`;
}

function statusFromFindings(findings) {
  if (findings.some((finding) => finding.severity === 'red')) return 'red';
  if (findings.some((finding) => finding.severity === 'yellow')) return 'yellow';
  return 'green';
}

function publicFinding(finding) {
  return {
    id: finding.id,
    severity: finding.severity,
    summary: finding.summary,
    evidence: finding.evidence,
    nextAction: finding.nextAction,
  };
}

function redactDiagnosticValue(value) {
  if (typeof value === 'string') return redactDiagnosticText(value);
  if (Array.isArray(value)) return value.map((item) => redactDiagnosticValue(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, redactDiagnosticValue(item)]),
  );
}

function addFinding(findings, finding) {
  if (!findings.some((candidate) => candidate.id === finding.id)) findings.push(finding);
}

function objectOrNull(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function objectOrEmpty(value) {
  return objectOrNull(value) ?? {};
}

function finiteOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
