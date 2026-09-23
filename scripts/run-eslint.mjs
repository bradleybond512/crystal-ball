#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_PROGRESS_INTERVAL_MS = 30_000;
const DEFAULT_KILL_GRACE_MS = 5000;

export function runCommandWithProgress(command, args, {
  label = 'command',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  progressIntervalMs = DEFAULT_PROGRESS_INTERVAL_MS,
  killGraceMs = DEFAULT_KILL_GRACE_MS,
  stdio = 'inherit',
  logger = console,
} = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, args, { stdio });
    let timedOut = false;
    let settled = false;
    let forceKillTimer;

    const finish = (exitCode, signal = null, error = null) => {
      if (settled) return;
      settled = true;
      clearInterval(progressTimer);
      clearTimeout(timeoutTimer);
      clearTimeout(forceKillTimer);
      resolve({ exitCode, timedOut, signal, error });
    };

    const progressTimer = setInterval(() => {
      const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
      logger.log(`[lint] ${label} still running (${elapsedSeconds}s elapsed)`);
    }, progressIntervalMs);

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      logger.error(`[lint] ${label} exceeded ${timeoutMs}ms; terminating`);
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), killGraceMs);
    }, timeoutMs);

    child.once('error', error => finish(1, null, error));
    child.once('close', (code, signal) => finish(timedOut ? 124 : (code ?? 1), signal));
  });
}

export function runEslint(files, options = {}) {
  const eslintBin = path.join(repoRoot, 'node_modules', 'eslint', 'bin', 'eslint.js');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  console.log(`[lint] Starting ESLint for ${files.length} target(s); timeout ${Math.round(timeoutMs / 1000)}s`);
  return runCommandWithProgress(process.execPath, [eslintBin, ...files], {
    label: 'ESLint',
    ...options,
    timeoutMs,
  });
}

function configuredTimeoutMs() {
  const value = Number.parseInt(process.env.CB_ESLINT_TIMEOUT_MS ?? '', 10);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const files = process.argv.slice(2);
  const result = await runEslint(files.length > 0 ? files : ['.'], {
    timeoutMs: configuredTimeoutMs(),
  });
  if (result.error) {
    console.error(`[lint] Failed to start ESLint: ${result.error.message}`);
  }
  process.exitCode = result.exitCode;
}
