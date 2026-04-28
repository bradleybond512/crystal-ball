/**
 * Panel smoke harness — boots every panel listed in the smoke registry,
 * fires its first refresh, and asserts the DOM produced one of:
 *
 *   - rendered  — non-empty content with ≥ minTextLength chars
 *   - degraded  — visible "no data" / loading / error banner
 *   - silent    — empty content AND no banner (likely broken)
 *   - errored   — constructor or refresh threw
 *   - skipped   — id has no factory yet (gap audit)
 *
 * Output:
 *   - Tabular Markdown report streamed to stdout
 *   - JSON report at tests/panels/.last-report.json (gitignored)
 *
 * Each panel mounts in its own test() so a single broken panel can't
 * poison the rest. Tests complete-but-do-not-fail when a panel is silent
 * — we want the harness to *report* status, not turn into a flake gate
 * for unrelated PRs. CI consumers can grep the report for "silent"/"errored"
 * if they want a hard fail.
 */

import { POST_MOUNT_ERRORS } from './setup-dom.mts';

import test from 'node:test';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadPanelInventory } from './panel-inventory.mts';
import { PANEL_SMOKE_REGISTRY, PANEL_SMOKE_EXCLUSIONS } from './panel-smoke-registry.mts';
import { clearFixtures } from './fixture-store.mts';

type PanelState = 'rendered' | 'degraded' | 'silent' | 'errored' | 'skipped';

interface PanelReport {
  id: string;
  state: PanelState;
  variants: string[];
  reason: string;
  textLength: number;
  durationMs: number;
  /** Any unhandledRejection or uncaughtException observed while this
   *  panel was mounted. Captured per-panel via process listeners
   *  installed/removed inside the test() body. Empty array (or
   *  omitted) when none. */
  asyncErrors?: string[];
}

const reports: PanelReport[] = [];

const DEGRADED_BANNER_SELECTORS = [
  '.panel-empty',
  '.error-message',
  '.config-error-message',
  '.panel-error-fallback',
  '.panel-loading',
  '.panel-degraded',
  '[data-degraded]',
];

const DEGRADED_TEXT_PATTERNS = [
  /no data/i,
  /no .* (yet|reported|available)/i,
  /not configured/i,
  /failed to load/i,
  /loading/i,
  /retrying/i,
  /unavailable/i,
];

function classify(panelEl: HTMLElement, minTextLength: number): { state: PanelState; reason: string; textLength: number } {
  const content = panelEl.querySelector('.panel-content') as HTMLElement | null;
  if (!content) {
    return { state: 'silent', reason: 'no .panel-content child', textLength: 0 };
  }
  const text = (content.textContent ?? '').trim();
  const len = text.length;

  // 1) explicit degraded banner
  for (const sel of DEGRADED_BANNER_SELECTORS) {
    if (content.querySelector(sel)) {
      return { state: 'degraded', reason: `degraded banner ${sel}`, textLength: len };
    }
  }
  // 2) banner-style text
  for (const re of DEGRADED_TEXT_PATTERNS) {
    if (re.test(text)) return { state: 'degraded', reason: `banner text /${re.source}/`, textLength: len };
  }

  if (len === 0 || content.children.length === 0) {
    return { state: 'silent', reason: 'empty content', textLength: 0 };
  }

  if (len < minTextLength) {
    return { state: 'silent', reason: `text below threshold (${len} < ${minTextLength})`, textLength: len };
  }

  return { state: 'rendered', reason: '', textLength: len };
}

function escapeMd(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function renderMarkdown(rows: PanelReport[]): string {
  const counts: Record<PanelState, number> = {
    rendered: 0, degraded: 0, silent: 0, errored: 0, skipped: 0,
  };
  for (const r of rows) counts[r.state]++;

  const lines: string[] = [];
  lines.push('# Panel Smoke Report');
  lines.push('');
  lines.push(`Total panels (across full/tech/finance/happy variants): **${rows.length}**`);
  lines.push('');
  lines.push(`- rendered: **${counts.rendered}**`);
  lines.push(`- degraded: **${counts.degraded}**  (acceptable — panel showed banner)`);
  lines.push(`- silent: **${counts.silent}**     (empty + no banner — likely broken)`);
  lines.push(`- errored: **${counts.errored}**   (threw during mount/refresh)`);
  lines.push(`- skipped: **${counts.skipped}**   (no factory yet — gap audit)`);
  lines.push('');
  lines.push('| Panel | State | Variants | Text len | Reason |');
  lines.push('|---|---|---|---:|---|');
  const order: Record<PanelState, number> = { errored: 0, silent: 1, degraded: 2, skipped: 3, rendered: 4 };
  for (const row of [...rows].sort((a, b) => order[a.state] - order[b.state] || a.id.localeCompare(b.id))) {
    lines.push(`| \`${row.id}\` | ${row.state} | ${row.variants.join(',')} | ${row.textLength} | ${escapeMd(row.reason)} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function writeReports(rows: PanelReport[]): void {
  const projectRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
  const outDir = path.join(projectRoot, 'tests', 'panels');
  mkdirSync(outDir, { recursive: true });
  const json = {
    generatedAt: new Date(0).toISOString(), // deterministic — wallclock-free
    panelCount: rows.length,
    states: rows.reduce<Record<PanelState, number>>((acc, r) => {
      acc[r.state] = (acc[r.state] ?? 0) + 1;
      return acc;
    }, { rendered: 0, degraded: 0, silent: 0, errored: 0, skipped: 0 }),
    panels: rows,
  };
  writeFileSync(path.join(outDir, '.last-report.json'), JSON.stringify(json, null, 2));
  writeFileSync(path.join(outDir, '.last-report.md'), renderMarkdown(rows));
}

const inventory = loadPanelInventory();

for (const entry of inventory) {
  const exclusion = PANEL_SMOKE_EXCLUSIONS[entry.id];
  if (exclusion) {
    test(`panel:${entry.id} skipped (excluded)`, () => {
      reports.push({
        id: entry.id,
        state: 'skipped',
        variants: entry.variants,
        reason: `excluded: ${exclusion}`,
        textLength: 0,
        durationMs: 0,
      });
    });
    continue;
  }

  const factory = PANEL_SMOKE_REGISTRY[entry.id];

  if (!factory) {
    test(`panel:${entry.id} skipped (no factory)`, () => {
      reports.push({
        id: entry.id,
        state: 'skipped',
        variants: entry.variants,
        reason: 'no factory in registry',
        textLength: 0,
        durationMs: 0,
      });
    });
    continue;
  }

  test(`panel:${entry.id}`, async (t) => {
    clearFixtures();
    const startedAt = performance.now();
    // node:test treats any unhandled rejection during a test as a failure.
    // Panels that fire-and-forget `void this.fetchData()` and crash inside
    // the .then() block trip this. We track the rejection ourselves and
    // record the panel as `errored` rather than failing the test row,
    // because the harness's job is to *report* state, not gate.
    const localErrors: unknown[] = [];
    const onReject = (reason: unknown): void => { localErrors.push(reason); };
    process.on('unhandledRejection', onReject);
    process.on('uncaughtException', onReject);

    let row: PanelReport;
    try {
      const panel = await factory.create();
      const el = panel.getElement();
      const container = document.createElement('div');
      container.id = `mount-${entry.id}`;
      document.body.append(container);
      container.append(el);

      await new Promise<void>((resolve) => setTimeout(resolve, factory.waitMs ?? 50));
      await Promise.resolve();
      // Panel.setContent uses 150ms debounce — give it room
      await new Promise<void>((resolve) => setTimeout(resolve, 200));

      const verdict = classify(el, factory.minTextLength ?? 1);
      // Async errors are a hard signal: if a fire-and-forget refresh
      // rejected and the panel did not recover to `rendered`, classify
      // as `errored`. A panel that catches internally and renders a
      // proper degraded banner WITHOUT triggering unhandledRejection
      // stays `degraded`. A panel stuck on a loading banner with a
      // bubbled-up rejection becomes `errored`.
      const hasAsyncError = localErrors.length > 0;
      const finalState: PanelState = hasAsyncError && verdict.state !== 'rendered'
        ? 'errored'
        : verdict.state;
      const finalReason = hasAsyncError && finalState === 'errored'
        ? errorMessage(localErrors[0]).slice(0, 240)
        : verdict.reason;

      row = {
        id: entry.id,
        state: finalState,
        variants: entry.variants,
        reason: finalReason,
        textLength: verdict.textLength,
        durationMs: Math.round(performance.now() - startedAt),
        asyncErrors: hasAsyncError
          ? localErrors.map((e) => errorMessage(e).slice(0, 240))
          : undefined,
      };

      try {
        const disposable = panel as unknown as { dispose?: () => void; destroy?: () => void };
        disposable.dispose?.();
        disposable.destroy?.();
      } catch {
        // ignore
      }
      el.remove();
      container.remove();
    } catch (error) {
      row = {
        id: entry.id,
        state: 'errored',
        variants: entry.variants,
        reason: errorMessage(error).slice(0, 240),
        textLength: 0,
        durationMs: Math.round(performance.now() - startedAt),
      };
    } finally {
      process.off('unhandledRejection', onReject);
      process.off('uncaughtException', onReject);
    }
    // Propagate captured rejections to global tally for the summary log.
    for (const e of localErrors) POST_MOUNT_ERRORS.push(errorMessage(e));
    reports.push(row);
    // Mark this test as passed regardless — the report row IS the assertion.
    t.diagnostic(`state=${row.state} text=${row.textLength}`);
  });
}

function errorMessage(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  return String(value);
}

test('panel-smoke summary', () => {
  // Sort and dedupe reports (in case of test re-runs)
  const unique = new Map<string, PanelReport>();
  for (const r of reports) unique.set(r.id, r);
  const finalRows = [...unique.values()].sort((a, b) => a.id.localeCompare(b.id));
  writeReports(finalRows);
   
  console.log('\n' + renderMarkdown(finalRows));

  if (POST_MOUNT_ERRORS.length > 0) {
     
    console.log(`\nNote: ${POST_MOUNT_ERRORS.length} post-mount async error(s) ignored (panel timers continue past mount).`);
  }
  // Force-exit. Mounted panels register setInterval refresh timers that
  // node:test won't unref for us; without this, the runner hangs at end.
  // Schedule the exit on a microtask so the summary log flushes first.
  setImmediate(() => process.exit(0));
});
