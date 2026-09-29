/**
 * Sidecar /api/health probe.
 *
 * Fetches the sidecar's lightweight liveness endpoint and feeds the
 * result into setSidecarHealth() on the live-diagnostics-snapshot
 * singleton. Runs on the host's tick (30 s by default).
 *
 * Web build: skipped — there's no sidecar in the browser. SidecarHealth
 * stays at the 'unknown' default.
 *
 * No DOM, only fetch + the singleton setter. Returns the resulting
 * SidecarHealth so callers can log / surface it directly.
 */

import { getApiBaseUrl, isDesktopRuntime } from '@/services/runtime';
import {
  setSidecarHealth,
  sidecarHealthFromError,
  sidecarHealthFromPayload,
} from './live-diagnostics-snapshot';
import type { SidecarHealth } from './system-health-types';
import {
  buildLocalEngineView,
  fetchLocalEngineStatus,
  type LocalEngineStatus,
} from './local-engine-status';

export interface ProbeSidecarOptions {
  /** Override the timeout for tests. Default 4 s. */
  timeoutMs?: number;
  /** Override fetch for tests. */
  fetchImpl?: typeof fetch;
  /** Override the clock for tests. */
  now?: () => number;
  /** Override the native supervisor status read (tests). */
  readEngineStatus?: () => Promise<LocalEngineStatus | null>;
  /** Override the follow-up probe scheduler (tests). */
  scheduleReprobe?: (delayMs: number, run: () => void) => void;
}

/** Re-probe shortly after a scheduled restart instead of waiting for the
 *  30 s tick, so the ribbon clears within seconds of recovery. */
const REPROBE_SLACK_MS = 3000;
let reprobePending = false;

/** For a failed probe, ask the native supervisor why: a restart in progress
 *  or a stopped engine is a better reason than a raw fetch error (R4-BUG-004). */
async function explainFailure(base: SidecarHealth, options: ProbeSidecarOptions): Promise<SidecarHealth> {
  let status: LocalEngineStatus | null = null;
  try {
    status = await (options.readEngineStatus ?? fetchLocalEngineStatus)();
  } catch {
    return base;
  }
  if (!status || (status.phase !== 'restarting' && status.phase !== 'stopped')) return base;
  if (status.phase === 'restarting' && status.nextRetryInMs !== null && !reprobePending) {
    reprobePending = true;
    const schedule = options.scheduleReprobe ?? ((delayMs: number, run: () => void) => { setTimeout(run, delayMs); });
    schedule(status.nextRetryInMs + REPROBE_SLACK_MS, () => {
      reprobePending = false;
      void probeSidecarHealth(options).catch(() => { /* next tick retries */ });
    });
  }
  return { ...base, status: 'failing', reason: buildLocalEngineView(status).text };
}

/** Tests only. */
export function resetSidecarProbeForTests(): void {
  reprobePending = false;
}

const DEFAULT_TIMEOUT_MS = 4000;

export async function probeSidecarHealth(options: ProbeSidecarOptions = {}): Promise<SidecarHealth> {
  const now = options.now ?? Date.now;
  // In the web build there is no sidecar to probe — return a neutral
  // 'unknown' verdict and skip the network call.
  if (!isDesktopRuntime()) {
    const verdict: SidecarHealth = {
      status: 'unknown',
      authenticated: false,
      reason: 'Sidecar probe skipped: web runtime has no local sidecar.',
    };
    setSidecarHealth(verdict);
    return verdict;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const attemptedAt = now();
  try {
    const res = await fetchImpl(`${getApiBaseUrl()}/api/health`, {
      signal: controller.signal,
    });
    if (!res.ok) {
      const verdict = await explainFailure(sidecarHealthFromError(new Error(`HTTP ${res.status}`), attemptedAt), options);
      setSidecarHealth(verdict);
      return verdict;
    }
    const payload: unknown = await res.json();
    const verdict = sidecarHealthFromPayload(payload, now());
    setSidecarHealth(verdict);
    return verdict;
  } catch (error) {
    const verdict = await explainFailure(sidecarHealthFromError(error, attemptedAt), options);
    setSidecarHealth(verdict);
    return verdict;
  } finally {
    clearTimeout(timeout);
  }
}
