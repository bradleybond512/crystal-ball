/**
 * Fixture-backed panel functional smoke — per
 * docs/CLAUDE_FUNCTIONALITY_DIAGNOSTICS_PERFORMANCE_ROADMAP_2026-04-29.md
 * Priority 5.
 *
 * Empty-response smoke (panel-smoke.test.mts) proves panels do not
 * crash. This complement proves the high-value panels actually
 * *render meaningful data* when the API returns a realistic payload.
 *
 * Acceptance:
 *   - For every panel id with a fixture entry, the panel reaches
 *     `rendered` state (text length > minTextLength) within the wait
 *     window after we install fixtures.
 *   - Panels that explicitly document a degraded contract (e.g.
 *     shortage-radar — fed via setRequests, not fetch) skip with a
 *     reason rather than failing.
 */

import './setup-dom.mts';

import test from 'node:test';
import assert from 'node:assert/strict';

import { PANEL_SMOKE_REGISTRY } from './panel-smoke-registry.mts';
import { PANEL_FIXTURES } from './panel-fixtures.mts';
import { clearFixtures } from './fixture-store.mts';

interface FixtureRow {
  id: string;
  state: 'rendered' | 'degraded' | 'silent' | 'errored' | 'skipped';
  reason: string;
  textLength: number;
}

const reports: FixtureRow[] = [];

const DEGRADED_BANNER_SELECTORS = [
  '.panel-empty',
  '.error-message',
  '.config-error-message',
  '.panel-error-fallback',
  '.panel-loading',
  '.panel-degraded',
  '[data-degraded]',
];

function classify(panelEl: HTMLElement, minTextLength: number): { state: FixtureRow['state']; reason: string; textLength: number } {
  const content = panelEl.querySelector('.panel-content') as HTMLElement | null;
  if (!content) return { state: 'silent', reason: 'no .panel-content child', textLength: 0 };
  const text = (content.textContent ?? '').trim();
  const len = text.length;
  for (const sel of DEGRADED_BANNER_SELECTORS) {
    if (content.querySelector(sel)) return { state: 'degraded', reason: `banner ${sel}`, textLength: len };
  }
  if (len === 0 || content.children.length === 0) return { state: 'silent', reason: 'empty content', textLength: 0 };
  if (len < minTextLength) return { state: 'silent', reason: `text < ${minTextLength}`, textLength: len };
  return { state: 'rendered', reason: '', textLength: len };
}

for (const [id, bundle] of Object.entries(PANEL_FIXTURES)) {
  const factory = PANEL_SMOKE_REGISTRY[id];
  if (!factory) {
    test(`fixture-smoke:${id} — skipped (no factory)`, () => {
      reports.push({ id, state: 'skipped', reason: 'no factory', textLength: 0 });
    });
    continue;
  }

  test(`fixture-smoke:${id}`, async () => {
    clearFixtures();
    bundle.install();

    const panel = await factory.create();
    const el = panel.getElement();
    const container = document.createElement('div');
    container.id = `mount-fixture-${id}`;
    document.body.append(container);
    container.append(el);

    // Give the panel time to fetch + render. Use a generous window
    // because some panels chain awaits + setContent() debounces.
    await new Promise<void>((resolve) => setTimeout(resolve, factory.waitMs ?? 100));
    await Promise.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, 250));

    // If the panel exposes a direct-update path (data-loader-driven
    // panels that don't fetch on mount), drive it now and re-wait
    // for the debounced setContent to flush.
    if (bundle.directUpdate) {
      await bundle.directUpdate(panel as unknown);
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }

    const verdict = classify(el, factory.minTextLength ?? 1);

    try {
      const disposable = panel as unknown as { dispose?: () => void; destroy?: () => void };
      disposable.dispose?.();
      disposable.destroy?.();
    } catch {
      // ignore
    }
    el.remove();
    container.remove();

    reports.push({ id, ...verdict });

    // Acceptance: with a fixture installed (URL-based or direct-update),
    // the panel should reach `rendered`. shortage-radar is the
    // remaining exception — it uses `panel.setRequests([...])` and
    // its smoke factory doesn't expose that method without seeding
    // commodity inputs the harness doesn't have.
    const SETRESQUEST_ONLY = new Set(['shortage-radar']);
    if (SETRESQUEST_ONLY.has(id)) return;
    assert.equal(
      verdict.state,
      'rendered',
      `Panel ${id} did not render after fixture install: state=${verdict.state} reason=${verdict.reason} text=${verdict.textLength}`,
    );
  });
}

test('fixture-smoke summary', () => {
  const counts: Record<string, number> = {};
  for (const r of reports) counts[r.state] = (counts[r.state] ?? 0) + 1;

  console.log('\n# Fixture-backed Panel Smoke Report\n');
  console.log(`- rendered: ${counts.rendered ?? 0}`);
  console.log(`- degraded: ${counts.degraded ?? 0}`);
  console.log(`- silent:   ${counts.silent ?? 0}`);
  console.log(`- errored:  ${counts.errored ?? 0}`);
  console.log(`- skipped:  ${counts.skipped ?? 0}`);
  console.log('');
  for (const r of reports.slice().sort((a, b) => a.id.localeCompare(b.id))) {
    console.log(`  ${r.state.padEnd(8)} ${r.id.padEnd(24)} text=${r.textLength}${r.reason ? '  ' + r.reason : ''}`);
  }
  console.log('');

  // Force-exit after summary so panel timers don't keep node:test alive.
  setImmediate(() => process.exit(0));
});
