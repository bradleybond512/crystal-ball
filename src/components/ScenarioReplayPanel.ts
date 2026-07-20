/**
 * Scenario Replay panel — runs the 5 built-in disaster scenarios through
 * the real intelligence pipeline (observation-store + situation-detector)
 * and reports pass/fail per scenario.
 *
 * Zero network calls — fixtures and pipeline are entirely in-process.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  runScenario,
  type ScenarioFixture,
  type ScenarioRunReport,
} from '@/services/intelligence/scenario-replay';
import { BUILT_IN_SCENARIOS } from '@/services/intelligence/scenarios';

type ScenarioStatus = 'idle' | 'running' | 'pass' | 'fail';

interface ScenarioState {
  status: ScenarioStatus;
  report: ScenarioRunReport | null;
  /** Wall-clock ms the replay took, including DOM work. */
  durationMs: number | null;
}

function statusAccentColor(status: ScenarioStatus): string {
  if (status === 'pass') return '#4caf50';
  if (status === 'fail') return '#ff453a';
  if (status === 'running') return '#ffeb3b';
  return 'rgba(255,255,255,0.12)';
}

function statusLabel(status: ScenarioStatus): string {
  if (status === 'pass') return '✓ pass';
  if (status === 'fail') return '✗ fail';
  if (status === 'running') return '… running';
  return '— idle';
}

function pluralizeAlerts(n: number): string {
  return `${n} alert${n === 1 ? '' : 's'}`;
}

function pluralizeSituations(n: number): string {
  return `${n} situation${n === 1 ? '' : 's'}`;
}

export class ScenarioReplayPanel extends Panel {
  private states = new Map<string, ScenarioState>();

  constructor() {
    super({
      id: 'scenario-replay',
      title: 'Scenario Replay',
      showCount: false,
      trackActivity: true,
      infoTooltip:
        'Replays 5 built-in disaster fixtures through the live intelligence pipeline (observation-store + situation-detector) and verifies the expected alerts and situations land. Zero network calls — fixtures are in-process.',
    });
    for (const fixture of BUILT_IN_SCENARIOS) {
      this.states.set(fixture.id, { status: 'idle', report: null, durationMs: null });
    }
    this.render();
  }

  private runOne(fixture: ScenarioFixture): void {
    this.states.set(fixture.id, { status: 'running', report: null, durationMs: null });
    this.render();
    // Defer to a microtask so the "running" state actually paints before
    // the replay's synchronous work blocks the main thread.
    queueMicrotask(() => {
      const t0 = performance.now();
      const report = runScenario(fixture);
      const durationMs = performance.now() - t0;
      this.states.set(fixture.id, {
        status: report.validation.ok ? 'pass' : 'fail',
        report,
        durationMs,
      });
      this.render();
    });
  }

  private runAll(): void {
    for (const fixture of BUILT_IN_SCENARIOS) this.runOne(fixture);
  }

  private resetAll(): void {
    for (const fixture of BUILT_IN_SCENARIOS) {
      this.states.set(fixture.id, { status: 'idle', report: null, durationMs: null });
    }
    this.render();
  }

  private render(): void {
    const cards = BUILT_IN_SCENARIOS.map((fixture) => this.renderCard(fixture)).join('');
    const passCount = [...this.states.values()].filter((s) => s.status === 'pass').length;
    const failCount = [...this.states.values()].filter((s) => s.status === 'fail').length;
    const summary = this.renderSummary(passCount, failCount);
    this.setContent(`
      <div style="padding:10px;font-size:12px;line-height:1.45;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div>${summary}</div>
          <div style="display:flex;gap:6px;">
            <button class="scenario-run-all" type="button" style="padding:4px 10px;background:rgba(74,158,255,0.18);color:inherit;border:1px solid rgba(74,158,255,0.4);border-radius:4px;cursor:pointer;font-size:11px;">Run all</button>
            <button class="scenario-reset" type="button" style="padding:4px 10px;background:transparent;color:inherit;border:1px solid rgba(255,255,255,0.15);border-radius:4px;cursor:pointer;font-size:11px;">Reset</button>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">${cards}</div>
      </div>
    `, () => this.wireHandlers());
  }

  private renderSummary(passCount: number, failCount: number): string {
    if (passCount + failCount === 0) {
      return '<span style="opacity:0.6;">No replays run yet.</span>';
    }
    const failSegment = failCount > 0
      ? ` · <span style="color:#ff453a;">${failCount} fail</span>`
      : '';
    return `<span style="color:#4caf50;">${passCount} pass</span>${failSegment}`;
  }

  private renderCard(fixture: ScenarioFixture): string {
    const state = this.states.get(fixture.id) ?? { status: 'idle' as const, report: null, durationMs: null };
    const accent = statusAccentColor(state.status);
    const label = statusLabel(state.status);
    const expectations = `${pluralizeAlerts(fixture.expectedAlerts.length)}, `
      + pluralizeSituations(fixture.expectedSituations.length);
    const detail = state.report ? this.renderDetail(state.report, fixture) : '';
    const duration = state.durationMs === null
      ? ''
      : `<span style="opacity:0.6;font-size:10px;">${state.durationMs.toFixed(1)} ms</span>`;
    const buttonLabel = state.status === 'running' ? '…' : 'Run replay';

    return `<div style="border:1px solid rgba(255,255,255,0.08);border-left:3px solid ${accent};border-radius:3px;padding:8px 10px;">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:8px;">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;display:flex;align-items:center;gap:8px;">
            ${escapeHtml(fixture.name)}
            <span style="font-size:10px;font-weight:600;color:${accent};text-transform:uppercase;letter-spacing:0.04em;">${label}</span>
            ${duration}
          </div>
          <div style="font-size:11px;opacity:0.75;margin-top:3px;">${escapeHtml(fixture.description)}</div>
          <div style="font-size:10px;opacity:0.55;margin-top:3px;">Expects: ${escapeHtml(expectations)} · ${fixture.events.length} events</div>
        </div>
        <button class="scenario-run-btn" data-fixture="${escapeHtml(fixture.id)}" type="button" style="padding:4px 10px;background:rgba(74,158,255,0.18);color:inherit;border:1px solid rgba(74,158,255,0.4);border-radius:4px;cursor:pointer;font-size:11px;height:fit-content;">${buttonLabel}</button>
      </div>
      ${detail}
    </div>`;
  }

  private renderDetail(report: ScenarioRunReport, fixture: ScenarioFixture): string {
    const expectedAlertRows = fixture.expectedAlerts.map((exp) => {
      const hit = !report.result.missedAlerts.includes(exp);
      return this.renderExpectationRow(hit, `${exp.domain} · ${exp.severity}`, exp.titleContains);
    }).join('');
    const expectedSitRows = fixture.expectedSituations.map((exp) => {
      const hit = !report.result.missedSituations.includes(exp);
      return this.renderExpectationRow(hit, exp.domain, exp.titleContains);
    }).join('');
    const summaryColor = report.validation.ok ? '#4caf50' : '#ff453a';
    const summary = `<div style="font-size:11px;margin-top:6px;color:${summaryColor};">${escapeHtml(report.validation.summary)}</div>`;
    return `<div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06);">
      <div style="font-size:10px;text-transform:uppercase;opacity:0.65;margin-bottom:3px;">Alerts</div>
      ${expectedAlertRows}
      <div style="font-size:10px;text-transform:uppercase;opacity:0.65;margin:6px 0 3px;">Situations</div>
      ${expectedSitRows}
      ${summary}
    </div>`;
  }

  private renderExpectationRow(hit: boolean, label: string, detail: string): string {
    const color = hit ? '#4caf50' : '#ff453a';
    const mark = hit ? '✓' : '✗';
    return `<div style="display:flex;gap:6px;font-size:11px;padding:2px 0;">
      <span style="color:${color};font-weight:700;width:12px;">${mark}</span>
      <span style="font-family:ui-monospace,monospace;opacity:0.85;">${escapeHtml(label)}</span>
      <span style="opacity:0.55;">→ ${escapeHtml(detail)}</span>
    </div>`;
  }

  private wireHandlers(): void {
    const root = this.getElement();
    if (!root) return;
    const runAllBtn = root.querySelector<HTMLButtonElement>('.scenario-run-all');
    runAllBtn?.addEventListener('click', () => this.runAll());
    const resetBtn = root.querySelector<HTMLButtonElement>('.scenario-reset');
    resetBtn?.addEventListener('click', () => this.resetAll());
    for (const btn of root.querySelectorAll<HTMLButtonElement>('.scenario-run-btn')) {
      btn.addEventListener('click', () => {
        const id = btn.dataset.fixture;
        if (!id) return;
        const fixture = BUILT_IN_SCENARIOS.find((f) => f.id === id);
        if (fixture) this.runOne(fixture);
      });
    }
  }
}

// Re-export types so other panels can reference the shapes if needed.
export type { ScenarioFixture, ExpectedAlert, ExpectedSituation } from '@/services/intelligence/scenario-replay';
