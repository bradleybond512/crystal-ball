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

export interface ProbeSidecarOptions {
  /** Override the timeout for tests. Default 4 s. */
  timeoutMs?: number;
  /** Override fetch for tests. */
  fetchImpl?: typeof fetch;
  /** Override the clock for tests. */
  now?: () => number;
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
      const verdict = sidecarHealthFromError(new Error(`HTTP ${res.status}`), attemptedAt);
      setSidecarHealth(verdict);
      return verdict;
    }
    const payload: unknown = await res.json();
    const verdict = sidecarHealthFromPayload(payload, now());
    setSidecarHealth(verdict);
    return verdict;
  } catch (error) {
    const verdict = sidecarHealthFromError(error, attemptedAt);
    setSidecarHealth(verdict);
    return verdict;
  } finally {
    clearTimeout(timeout);
  }
}
