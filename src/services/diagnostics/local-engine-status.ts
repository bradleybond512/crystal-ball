/**
 * Local engine (sidecar) supervisor status, read from the native
 * `get_local_api_status` command (R4-BUG-004). Validation and view logic are
 * pure; the two IPC helpers take an injectable invoke for tests.
 */

import { tryInvokeTauri } from '../tauri-bridge';

export type LocalEnginePhase = 'idle' | 'running' | 'restarting' | 'stopped' | 'shutting_down';

export interface LocalEngineStatus {
  phase: LocalEnginePhase;
  generation: number;
  port: number | null;
  portConfirmed: boolean;
  restarts: number;
  lastExit: { code: number | null; signal: number | null; secondsAgo: number } | null;
  nextRetryInMs: number | null;
  failureLimit: number;
  failureWindowMs: number;
}

export type Invoke = <T>(command: string) => Promise<T | null>;

const PHASES: ReadonlySet<string> = new Set(['idle', 'running', 'restarting', 'stopped', 'shutting_down']);

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function optionalInt(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}

/** Strictly validate the native payload; anything malformed is `null`. */
export function parseLocalEngineStatus(raw: unknown): LocalEngineStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.phase !== 'string' || !PHASES.has(o.phase)) return null;
  if (!isCount(o.generation) || !isCount(o.restarts) || !isCount(o.failureLimit) || !isCount(o.failureWindowMs)) return null;
  if (typeof o.portConfirmed !== 'boolean') return null;
  const port = optionalInt(o.port);
  if (port === undefined || (port !== null && (port < 1 || port > 65_535))) return null;
  const nextRetryInMs = optionalInt(o.nextRetryInMs);
  if (nextRetryInMs === undefined || (nextRetryInMs !== null && nextRetryInMs < 0)) return null;
  let lastExit: LocalEngineStatus['lastExit'] = null;
  if (o.lastExit !== null && o.lastExit !== undefined) {
    if (typeof o.lastExit !== 'object') return null;
    const e = o.lastExit as Record<string, unknown>;
    const code = optionalInt(e.code);
    const signal = optionalInt(e.signal);
    if (code === undefined || signal === undefined || !isCount(e.secondsAgo)) return null;
    lastExit = { code, signal, secondsAgo: e.secondsAgo };
  }
  return {
    phase: o.phase as LocalEnginePhase,
    generation: o.generation,
    port,
    portConfirmed: o.portConfirmed,
    restarts: o.restarts,
    lastExit,
    nextRetryInMs,
    failureLimit: o.failureLimit,
    failureWindowMs: o.failureWindowMs,
  };
}

export async function fetchLocalEngineStatus(invoke: Invoke = tryInvokeTauri): Promise<LocalEngineStatus | null> {
  return parseLocalEngineStatus(await invoke<unknown>('get_local_api_status'));
}

/** Manual retry; the native side only acts when the supervisor gave up. */
export async function requestLocalEngineRestart(invoke: Invoke = tryInvokeTauri): Promise<LocalEngineStatus | null> {
  return parseLocalEngineStatus(await invoke<unknown>('restart_local_api'));
}

function seconds(ms: number): string {
  return `${Math.max(1, Math.ceil(ms / 1000))} s`;
}

export type LocalEngineTone = 'ok' | 'warn' | 'bad';

export interface LocalEngineView {
  tone: LocalEngineTone;
  text: string;
  /** True only when a manual restart can do anything (supervisor stopped). */
  canRestart: boolean;
}

export function buildLocalEngineView(status: LocalEngineStatus | null): LocalEngineView {
  if (!status) return { tone: 'warn', text: 'Local engine status unavailable', canRestart: false };
  const restarts = status.restarts === 1 ? '1 restart' : `${status.restarts} restarts`;
  switch (status.phase) {
    case 'running': {
      return {
        tone: 'ok',
        text: status.restarts > 0 ? `Local engine running (${restarts} this session)` : 'Local engine running',
        canRestart: false,
      };
    }
    case 'restarting': {
      const next = status.nextRetryInMs === null ? '' : ` (next try in ${seconds(status.nextRetryInMs)})`;
      return { tone: 'warn', text: `Local engine restarting${next}`, canRestart: false };
    }
    case 'stopped': {
      return {
        tone: 'bad',
        text: `Local engine stopped after ${status.failureLimit} failures in ${Math.round(status.failureWindowMs / 60_000)} min — use Restart local engine`,
        canRestart: true,
      };
    }
    case 'shutting_down': {
      return { tone: 'warn', text: 'Local engine shutting down', canRestart: false };
    }
    default: {
      return { tone: 'warn', text: 'Local engine starting', canRestart: false };
    }
  }
}
