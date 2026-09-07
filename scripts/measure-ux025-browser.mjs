import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const FIXED_NOW = Date.UTC(2026, 7, 31, 12, 0, 0);

export function parseBrowserArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]; const value = argv[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error(`missing value for ${key ?? 'option'}`);
    values[key.slice(2)] = value;
  }
  for (const key of ['label', 'output']) if (!values[key]) throw new Error(`--${key} is required`);
  const port = Number(values.port ?? process.env.E2E_PORT ?? 4187);
  const durationMs = Number(values['duration-ms'] ?? 3000);
  const runs = Number(values.runs ?? 3);
  if (!Number.isInteger(port) || port < 1 || port > 65_535 || !Number.isFinite(durationMs) || durationMs <= 0 || !Number.isInteger(runs) || runs !== 3) {
    throw new Error('port and duration must be valid; UX-025 browser measurement requires exactly three runs');
  }
  return { label: values.label, output: values.output, port, durationMs, runs, baseUrl: values['base-url'] ?? `http://127.0.0.1:${port}` };
}

function currentSha() {
  const result = spawnSync('/usr/bin/git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git rev-parse failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

export function summarizeIntervals(intervals) {
  if (intervals.length === 0) throw new Error('no animation-frame intervals captured');
  const sorted = [...intervals].sort((a, b) => a - b);
  const percentile = (q) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
  return { count: intervals.length, medianMs: percentile(0.5), p95Ms: percentile(0.95), maxMs: sorted.at(-1) };
}

export function buildBrowserReport({ args, commit, rawRuns, measuredAt = new Date().toISOString() }) {
  return {
    schemaVersion: 1,
    kind: 'ux025-browser-performance',
    label: args.label,
    commit,
    measuredAt,
    os: { platform: os.platform(), release: os.release(), arch: os.arch() },
    scenario: {
      fixture: '/e2e/fixtures/smoked-glass/index.html',
      state: 'home-dark',
      fixedNow: FIXED_NOW,
      locale: 'en-US',
      timezone: 'UTC',
      viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
      durationMs: args.durationMs,
      runs: args.runs,
      networkPolicy: 'same-origin-only',
    },
    runs: rawRuns,
    summary: {
      animationFrameIntervals: summarizeIntervals(rawRuns.flatMap((run) => run.animationFrameIntervalsMs)),
      longTaskCount: rawRuns.reduce((sum, run) => sum + run.longTasksMs.length, 0),
      longTaskTotalMs: rawRuns.flatMap((run) => run.longTasksMs).reduce((sum, value) => sum + value, 0),
    },
  };
}

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const response = await fetch(url); if (response.ok) return; } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`fixture server did not become ready: ${url}`);
}

export async function runBrowserMeasurement(argv) {
  const args = parseBrowserArgs(argv);
  const fixtureUrl = `${args.baseUrl}/e2e/fixtures/smoked-glass/index.html`;
  let server;
  try {
    try { await waitForServer(fixtureUrl, 500); }
    catch {
      server = spawn(process.execPath, [path.resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(args.port)], {
        stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, VITE_E2E: '1', VITE_VARIANT: 'full' },
      });
      await waitForServer(fixtureUrl);
    }
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--use-gl=swiftshader'] });
    try {
      const rawRuns = [];
      for (let run = 0; run < args.runs; run += 1) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, colorScheme: 'dark', locale: 'en-US', timezoneId: 'UTC' });
        const page = await context.newPage();
        const externalRequests = [];
        await page.clock.install({ time: FIXED_NOW });
        await page.route('**/*', async (route) => {
          const requestUrl = new URL(route.request().url());
          if (requestUrl.origin !== args.baseUrl) { externalRequests.push(requestUrl.href); await route.abort('blockedbyclient'); return; }
          await route.continue();
        });
        await page.goto(fixtureUrl);
        await page.waitForFunction(() => document.documentElement.dataset.fixtureReady === 'true');
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(() => globalThis.__UX025_FIXTURE__.setState('home', 'dark'));
        const sample = await page.evaluate(async (durationMs) => {
          const longTasks = [];
          const observer = typeof PerformanceObserver === 'function' && PerformanceObserver.supportedEntryTypes.includes('longtask')
            ? new PerformanceObserver((list) => longTasks.push(...list.getEntries().map((entry) => entry.duration))) : null;
          observer?.observe({ entryTypes: ['longtask'] });
          const intervals = [];
          const start = performance.now();
          let previous = start;
          await new Promise((resolveDone) => {
            const tick = (now) => {
              intervals.push(now - previous); previous = now;
              if (now - start >= durationMs) resolveDone(); else requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          });
          observer?.disconnect();
          return { animationFrameIntervalsMs: intervals, longTasksMs: longTasks };
        }, args.durationMs);
        if (externalRequests.length > 0) throw new Error(`external requests attempted: ${externalRequests.join(', ')}`);
        rawRuns.push({ run: run + 1, ...sample, externalRequests });
        await context.close();
      }
      const report = buildBrowserReport({ args, commit: currentSha(), rawRuns });
      mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
      writeFileSync(path.resolve(args.output), `${JSON.stringify(report, null, 2)}\n`);
      return report;
    } finally { await browser.close(); }
  } finally { if (server && !server.killed) server.kill('SIGTERM'); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await runBrowserMeasurement(process.argv.slice(2));
    console.log(JSON.stringify(report.summary, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
