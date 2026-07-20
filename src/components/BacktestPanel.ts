/**
 * Backtest Panel — Phase 4 backtest-before-apply gate UI.
 *
 * Runs the BacktestEngine against the built-in scenario library with
 * user-supplied parameter overrides. Renders baseline vs proposed
 * accuracy per scenario, an overall recommendation badge, and the most
 * recent 10 historical runs.
 */

import { Panel } from './Panel';
import {
  getBacktestEngine,
  type BacktestParameterChanges,
  type BacktestRecommendation,
  type BacktestResult,
  type ScenarioOutcome,
} from '@/services/intelligence/backtest-engine';
import { getBuiltInScenarios } from '@/services/intelligence/built-in-scenarios';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30_000;
const HISTORY_LIMIT = 10;

const REC_LABEL: Record<BacktestRecommendation, string> = {
  apply: 'APPLY',
  review: 'REVIEW',
  reject: 'REJECT',
};

const REC_COLOR: Record<BacktestRecommendation, string> = {
  apply: '#4caf50',
  review: '#ffb74d',
  reject: '#ff453a',
};

interface RunFormState {
  algorithmId: string;
  parameterChangesText: string;
  minAccuracyDelta: number;
  lastError: string | null;
  lastResultId: string | null;
  /** Whether the "Advanced: parameter overrides" disclosure is open (survives re-renders). */
  advancedOpen: boolean;
}

/**
 * Validation message for the overrides textarea, or null when parseable.
 * Empty input is valid (= no overrides).
 */
function overridesJsonError(text: string): string | null {
  if (text.trim().length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return 'Invalid JSON — overrides must be an object like { "driverWeights": { … } }.';
    }
    return null;
  } catch {
    return 'Invalid JSON — fix the overrides to run.';
  }
}

export class BacktestPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsub: (() => void) | null = null;
  private form: RunFormState = {
    algorithmId: 'driver-scorer',
    parameterChangesText: '{\n  "driverWeights": {}\n}',
    minAccuracyDelta: 0,
    lastError: null,
    lastResultId: null,
    advancedOpen: false,
  };

  constructor() {
    super({
      id: 'backtest',
      title: 'Backtest Gate',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Phase 4 backtest-before-apply gate. Replays proposed parameter changes against historical scenarios to validate that accuracy improves (or at least does not regress) before any change reaches the live scoring pipeline.',
    });
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsub = getBacktestEngine().subscribe(() => this.render());
  }

  public destroy(): void {
    super.destroy();
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
  }

  private render(): void {
    const engine = getBacktestEngine();
    const history = engine.getHistory();
    // Newest first. tsc target lib is es2020 → no Array#toReversed.
    const recent = history.slice(-HISTORY_LIMIT).reverse();
    const latest = this.form.lastResultId
      ? history.find((r) => r.id === this.form.lastResultId)
      : undefined;

    this.setCount(history.length);

    const html = `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      ${this.renderRunSection()}
      ${latest ? renderLatestResult(latest) : ''}
      ${renderHistory(recent)}
    </div>`;
    this.setContent(html);
    this.wireRunButton();
  }

  private renderRunSection(): string {
    const errorBlock = this.form.lastError
      ? `<div style="color:#ff453a;font-size:11px;margin-top:6px;">${escapeHtml(this.form.lastError)}</div>`
      : '';
    const minPct = (this.form.minAccuracyDelta * 100).toFixed(1);
    const jsonError = overridesJsonError(this.form.parameterChangesText);
    const invalid = jsonError !== null;
    const textareaBorder = invalid ? 'var(--sev-high,#ef4444)' : 'var(--border-subtle,#333)';
    return `<div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">Run backtest</div>
      <div style="display:flex;flex-direction:column;gap:8px;font-size:12px;">
        <label style="display:flex;align-items:center;gap:8px;">
          <span style="width:120px;color:var(--text-secondary,#aaa);">Algorithm</span>
          <select id="backtestAlgorithmId" style="flex:1;padding:4px 6px;background:var(--surface-2,#1a1a1a);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;">
            <option value="driver-scorer"${this.form.algorithmId === 'driver-scorer' ? ' selected' : ''}>driver-scorer</option>
          </select>
        </label>
        <details id="backtestParamsDetails"${this.form.advancedOpen ? ' open' : ''}>
          <summary style="cursor:pointer;color:var(--text-secondary,#aaa);font-size:11px;">Advanced: parameter overrides (JSON)</summary>
          <div style="display:flex;flex-direction:column;gap:4px;margin-top:6px;">
            <textarea id="backtestParamsText" rows="5" aria-label="Parameter overrides (JSON)" aria-invalid="${invalid}"
              placeholder='{ "driverWeights": { "weather": 1.2 } }'
              style="font-family:ui-monospace,monospace;font-size:11px;padding:6px;background:var(--surface-2,#1a1a1a);color:inherit;border:1px solid ${textareaBorder};border-radius:3px;">${escapeHtml(this.form.parameterChangesText)}</textarea>
            <div id="backtestParamsError" role="status" style="font-size:11px;color:var(--sev-high,#ef4444);${invalid ? '' : 'display:none;'}">${escapeHtml(jsonError ?? 'Invalid JSON — fix the overrides to run.')}</div>
          </div>
        </details>
        <label style="display:flex;align-items:center;gap:8px;">
          <span style="width:120px;color:var(--text-secondary,#aaa);">Min Δ accuracy</span>
          <input type="range" id="backtestMinDelta" min="0" max="0.1" step="0.005" value="${this.form.minAccuracyDelta}" style="flex:1;">
          <span style="width:48px;text-align:right;font-family:ui-monospace,monospace;">+${minPct}%</span>
        </label>
        <div>
          <button id="backtestRunBtn"${invalid ? ' disabled' : ''} style="padding:6px 12px;background:var(--accent,#4a9eff);color:#fff;border:0;border-radius:3px;cursor:pointer;font-weight:600;${invalid ? 'opacity:0.5;cursor:not-allowed;' : ''}">Run backtest</button>
        </div>
      </div>
      ${errorBlock}
    </div>`;
  }

  private wireRunButton(): void {
    // Defer the wiring so the freshly-rendered HTML is in the DOM.
    setTimeout(() => {
      const root = this.content;
      const algoSel = root.querySelector<HTMLSelectElement>('#backtestAlgorithmId');
      const paramsEl = root.querySelector<HTMLTextAreaElement>('#backtestParamsText');
      const minDeltaEl = root.querySelector<HTMLInputElement>('#backtestMinDelta');
      const runBtn = root.querySelector<HTMLButtonElement>('#backtestRunBtn');

      const detailsEl = root.querySelector<HTMLDetailsElement>('#backtestParamsDetails');
      const errorEl = root.querySelector<HTMLElement>('#backtestParamsError');

      algoSel?.addEventListener('change', () => {
        this.form.algorithmId = algoSel.value;
      });
      detailsEl?.addEventListener('toggle', () => {
        this.form.advancedOpen = detailsEl.open;
      });
      paramsEl?.addEventListener('input', () => {
        this.form.parameterChangesText = paramsEl.value;
        // Live-validate without re-rendering so the textarea keeps focus.
        const message = overridesJsonError(paramsEl.value);
        const invalid = message !== null;
        paramsEl.style.borderColor = invalid ? 'var(--sev-high,#ef4444)' : 'var(--border-subtle,#333)';
        paramsEl.setAttribute('aria-invalid', String(invalid));
        if (errorEl) {
          errorEl.style.display = invalid ? '' : 'none';
          if (message) errorEl.textContent = message;
        }
        if (runBtn) {
          runBtn.disabled = invalid;
          runBtn.style.opacity = invalid ? '0.5' : '';
          runBtn.style.cursor = invalid ? 'not-allowed' : 'pointer';
        }
      });
      minDeltaEl?.addEventListener('input', () => {
        const v = Number(minDeltaEl.value);
        if (Number.isFinite(v)) this.form.minAccuracyDelta = v;
      });
      runBtn?.addEventListener('click', () => this.handleRun());
    }, 0);
  }

  private handleRun(): void {
    // Backstop for the disabled-button guard — never run with unparseable overrides.
    if (overridesJsonError(this.form.parameterChangesText) !== null) return;
    let parsed: BacktestParameterChanges & Record<string, unknown>;
    try {
      const parsedRaw: unknown = JSON.parse(this.form.parameterChangesText || '{}');
      if (!parsedRaw || typeof parsedRaw !== 'object' || Array.isArray(parsedRaw)) {
        throw new Error('parameter overrides must be a JSON object');
      }
      parsed = parsedRaw as BacktestParameterChanges & Record<string, unknown>;
    } catch (error) {
      this.form.lastError = error instanceof Error ? error.message : String(error);
      this.render();
      return;
    }
    this.form.lastError = null;
    const result = getBacktestEngine().runBacktest({
      algorithmId: this.form.algorithmId,
      parameterChanges: parsed,
      scenarios: getBuiltInScenarios(),
      minAccuracyDelta: this.form.minAccuracyDelta,
    });
    this.form.lastResultId = result.id;
    this.render();
  }
}

function renderLatestResult(result: BacktestResult): string {
  const recColor = REC_COLOR[result.recommendation];
  const recLabel = REC_LABEL[result.recommendation];
  const baseline = (result.baselineAccuracy * 100).toFixed(1);
  const proposed = (result.proposedAccuracy * 100).toFixed(1);
  const delta = result.accuracyDelta;
  const deltaStr = (delta >= 0 ? '+' : '') + (delta * 100).toFixed(1) + '%';
  const rows = result.scenarioResults.map((s) => renderScenarioRow(s)).join('');
  return `<div>
    <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">Latest result</div>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
      <span style="font-size:11px;font-weight:700;letter-spacing:0.06em;padding:3px 8px;border-radius:3px;background:${recColor}26;color:${recColor};">${recLabel}</span>
      <span style="font-size:12px;font-family:ui-monospace,monospace;">${baseline}% → ${proposed}% (${deltaStr})</span>
      <span style="font-size:11px;color:var(--text-secondary,#aaa);">${result.durationMs.toFixed(0)} ms</span>
    </div>
    <div style="font-size:12px;color:var(--text-secondary,#aaa);margin-bottom:8px;">${escapeHtml(result.explanation)}</div>
    <table style="width:100%;border-collapse:collapse;font-size:12px;font-family:ui-monospace,monospace;">
      <thead>
        <tr style="color:var(--text-secondary,#aaa);text-align:left;">
          <th style="padding:4px 8px;font-weight:600;">Scenario</th>
          <th style="padding:4px 8px;font-weight:600;text-align:right;">Baseline</th>
          <th style="padding:4px 8px;font-weight:600;text-align:right;">Proposed</th>
          <th style="padding:4px 8px;font-weight:600;text-align:right;">Δ</th>
          <th style="padding:4px 8px;font-weight:600;text-align:right;">Pass</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function renderScenarioRow(s: ScenarioOutcome): string {
  const delta = s.proposedAccuracy - s.baselineAccuracy;
  const deltaStr = (delta >= 0 ? '+' : '') + (delta * 100).toFixed(1) + '%';
  const passColor = s.passed ? '#4caf50' : '#ff453a';
  const passLabel = s.passed ? 'pass' : 'fail';
  return `<tr>
    <td style="padding:4px 8px;">${escapeHtml(s.scenarioName)}</td>
    <td style="padding:4px 8px;text-align:right;">${(s.baselineAccuracy * 100).toFixed(0)}%</td>
    <td style="padding:4px 8px;text-align:right;">${(s.proposedAccuracy * 100).toFixed(0)}%</td>
    <td style="padding:4px 8px;text-align:right;">${deltaStr}</td>
    <td style="padding:4px 8px;text-align:right;color:${passColor};">${passLabel}</td>
  </tr>`;
}

function renderHistory(history: readonly BacktestResult[]): string {
  if (history.length === 0) {
    return `<div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">History</div>
      <div style="font-size:12px;color:var(--text-secondary,#aaa);">No backtests recorded yet.</div>
    </div>`;
  }
  const now = Date.now();
  const items = history.map((r) => {
    const ageMs = now - r.runAt.getTime();
    const recColor = REC_COLOR[r.recommendation];
    const recLabel = REC_LABEL[r.recommendation];
    return `<li style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border-subtle,rgba(255,255,255,0.05));font-size:12px;">
      <span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:3px;background:${recColor}26;color:${recColor};">${recLabel}</span>
      <span style="font-family:ui-monospace,monospace;">${escapeHtml(r.config.algorithmId)}</span>
      <span style="color:var(--text-secondary,#aaa);">${(r.accuracyDelta >= 0 ? '+' : '') + (r.accuracyDelta * 100).toFixed(1)}%</span>
      <span style="color:var(--text-secondary,#aaa);margin-left:auto;">${formatAgo(ageMs)}</span>
    </li>`;
  }).join('');
  return `<div>
    <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">History</div>
    <ul style="margin:0;padding:0;list-style:none;">${items}</ul>
  </div>`;
}

function formatAgo(ms: number): string {
  if (ms < 0) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
