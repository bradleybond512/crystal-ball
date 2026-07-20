/* eslint-disable sonarjs/no-nested-template-literals */
/**
 * Counterfactual Replay Panel — "what if?" scenario UI.
 *
 * Two-column layout: scenario list on the left, result view on the
 * right. New Scenario button opens an inline form that picks a
 * Situation as the base snapshot and one domain override. Running a
 * scenario applies the overrides to the snapshot and computes a
 * cascade score with narrative summary.
 */

import { Panel } from './Panel';
import {
  CounterfactualReplayEngine,
  type CounterfactualScenario,
  type DomainOverride,
  type ReplayResult,
} from '@/services/intelligence/counterfactual-replay';
import { getSituationStoreV2 } from '@/services/intelligence/situation-store-v2';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30_000;

interface FormState {
  open: boolean;
  name: string;
  baseSnapshotId: string;
  domain: string;
  severityDelta: number;
  eventCountDelta: number;
  error: string | null;
}

interface PanelState {
  selectedScenarioId: string | null;
  form: FormState;
}

export class CounterfactualReplayPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private state: PanelState = {
    selectedScenarioId: null,
    form: {
      open: false,
      name: '',
      baseSnapshotId: '',
      domain: '',
      severityDelta: 0.5,
      eventCountDelta: 0,
      error: null,
    },
  };

  constructor() {
    super({
      id: 'counterfactual-replay',
      title: 'Counterfactual Replay',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        '"What if?" scenario engine. Pick a historical snapshot, apply domain overrides (severity delta, event count delta), and run to compute a cascade score and narrative summary.',
    });
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
  }

  public destroy(): void {
    super.destroy();
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private snapshotOptions(): { id: string; label: string }[] {
    return getSituationStoreV2().list().map((s) => ({
      id: s.id,
      label: `${s.domain} — ${s.id.slice(0, 8)}`,
    }));
  }

  private render(): void {
    const engine = CounterfactualReplayEngine.getInstance();
    const scenarios = engine.listScenarios();
    this.setCount(scenarios.length);

    const selected = this.state.selectedScenarioId
      ? scenarios.find((s) => s.id === this.state.selectedScenarioId)
      : scenarios[scenarios.length - 1];
    const selectedId = selected?.id ?? null;

    const html = `<div style="padding:12px;display:flex;flex-direction:column;gap:12px;">
      ${this.renderToolbar()}
      ${this.state.form.open ? this.renderNewScenarioForm() : ''}
      <div style="display:grid;grid-template-columns:minmax(180px,1fr) 2fr;gap:12px;align-items:flex-start;">
        ${renderScenarioList(scenarios, selectedId)}
        ${renderResultPane(selected)}
      </div>
    </div>`;
    this.setContent(html, () => this.wireHandlers());
  }

  private renderToolbar(): string {
    const label = this.state.form.open ? 'Cancel' : '+ New Scenario';
    return `<div style="display:flex;align-items:center;gap:8px;">
      <button id="cfReplayNewBtn" style="padding:6px 12px;background:var(--accent,#4a9eff);color:#fff;border:0;border-radius:3px;cursor:pointer;font-weight:600;font-size:12px;">${label}</button>
      <span style="font-size:11px;color:var(--text-secondary,#aaa);">cascade score = mean |severityDelta| across overrides</span>
    </div>`;
  }

  private renderNewScenarioForm(): string {
    const snapshots = this.snapshotOptions();
    const snapOptions = snapshots.length === 0
      ? `<option value="">No situations available yet</option>`
      : snapshots.map((s) => `<option value="${escapeHtml(s.id)}"${s.id === this.state.form.baseSnapshotId ? ' selected' : ''}>${escapeHtml(s.label)}</option>`).join('');
    const errorBlock = this.state.form.error
      ? `<div style="color:#ff453a;font-size:11px;margin-top:6px;">${escapeHtml(this.state.form.error)}</div>`
      : '';
    return `<div style="border:1px solid var(--border-subtle,#333);border-radius:4px;padding:10px;display:flex;flex-direction:column;gap:8px;">
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">New scenario</div>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;">
        <span style="color:var(--text-secondary,#aaa);">Name</span>
        <input id="cfReplayName" type="text" value="${escapeHtml(this.state.form.name)}" placeholder="e.g. No cyber threat" style="padding:4px 6px;background:var(--surface-2,#1a1a1a);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:11px;">
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;">
        <span style="color:var(--text-secondary,#aaa);">Base snapshot (situation)</span>
        <select id="cfReplaySnapSelect" style="padding:4px 6px;background:var(--surface-2,#1a1a1a);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:11px;">${snapOptions}</select>
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;">
        <span style="color:var(--text-secondary,#aaa);">Domain override</span>
        <input id="cfReplayDomain" type="text" value="${escapeHtml(this.state.form.domain)}" placeholder="e.g. cyber, weather" style="padding:4px 6px;background:var(--surface-2,#1a1a1a);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:11px;">
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;">
        <span style="color:var(--text-secondary,#aaa);">Severity delta (-1 to 1)</span>
        <input id="cfReplaySevDelta" type="number" min="-1" max="1" step="0.1" value="${this.state.form.severityDelta}" style="padding:4px 6px;background:var(--surface-2,#1a1a1a);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:11px;">
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;">
        <span style="color:var(--text-secondary,#aaa);">Event count delta</span>
        <input id="cfReplayEvtDelta" type="number" step="1" value="${this.state.form.eventCountDelta}" style="padding:4px 6px;background:var(--surface-2,#1a1a1a);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:11px;">
      </label>
      <div>
        <button id="cfReplayCreateBtn" style="padding:6px 12px;background:#4caf50;color:#fff;border:0;border-radius:3px;cursor:pointer;font-weight:600;font-size:12px;">Create & Run</button>
      </div>
      ${errorBlock}
    </div>`;
  }

  private wireHandlers(): void {
    setTimeout(() => {
      const root = this.content;
      root.querySelector<HTMLButtonElement>('#cfReplayNewBtn')?.addEventListener('click', () => {
        this.state.form.open = !this.state.form.open;
        this.state.form.error = null;
        this.render();
      });
      root.querySelector<HTMLSelectElement>('#cfReplaySnapSelect')?.addEventListener('change', (e) => {
        this.state.form.baseSnapshotId = (e.target as HTMLSelectElement).value;
      });
      root.querySelector<HTMLInputElement>('#cfReplayName')?.addEventListener('input', (e) => {
        this.state.form.name = (e.target as HTMLInputElement).value;
      });
      root.querySelector<HTMLInputElement>('#cfReplayDomain')?.addEventListener('input', (e) => {
        this.state.form.domain = (e.target as HTMLInputElement).value;
      });
      root.querySelector<HTMLInputElement>('#cfReplaySevDelta')?.addEventListener('input', (e) => {
        this.state.form.severityDelta = Number((e.target as HTMLInputElement).value);
      });
      root.querySelector<HTMLInputElement>('#cfReplayEvtDelta')?.addEventListener('input', (e) => {
        this.state.form.eventCountDelta = Number((e.target as HTMLInputElement).value);
      });
      root.querySelector<HTMLButtonElement>('#cfReplayCreateBtn')?.addEventListener('click', () => this.handleCreate());

      root.querySelectorAll<HTMLElement>('[data-cf-scenario-id]').forEach((el) => {
        el.addEventListener('click', () => {
          const id = el.dataset.cfScenarioId;
          if (id) {
            this.state.selectedScenarioId = id;
            this.render();
          }
        });
      });
      root.querySelector<HTMLButtonElement>('#cfReplayRunBtn')?.addEventListener('click', () => this.handleRerun());
    }, 0);
  }

  private handleCreate(): void {
    const name = this.state.form.name.trim();
    if (!name) {
      this.state.form.error = 'Enter a scenario name.';
      this.render();
      return;
    }
    const domain = this.state.form.domain.trim();
    if (!domain) {
      this.state.form.error = 'Enter a domain for the override.';
      this.render();
      return;
    }
    const snapshots = this.snapshotOptions();
    const baseSnapshotId = this.state.form.baseSnapshotId || (snapshots[0]?.id ?? 'manual');
    const overrides: DomainOverride[] = [
      {
        domain,
        severityDelta: this.state.form.severityDelta,
        eventCountDelta: this.state.form.eventCountDelta,
      },
    ];
    const engine = CounterfactualReplayEngine.getInstance();
    const scenario = engine.createScenario(name, baseSnapshotId, overrides);
    engine.runScenario(scenario.id);
    this.state.selectedScenarioId = scenario.id;
    this.state.form.open = false;
    this.state.form.error = null;
    this.render();
  }

  private handleRerun(): void {
    const id = this.state.selectedScenarioId;
    if (!id) return;
    CounterfactualReplayEngine.getInstance().runScenario(id);
    this.render();
  }
}

function renderScenarioList(scenarios: readonly CounterfactualScenario[], selectedId: string | null): string {
  if (scenarios.length === 0) {
    return `<div style="font-size:12px;color:var(--text-secondary,#aaa);">No scenarios yet. Create one above.</div>`;
  }
  const items = [...scenarios].sort((a, b) => b.createdAt - a.createdAt).map((s) => {
    const isSelected = s.id === selectedId;
    const bg = isSelected ? 'var(--accent,#4a9eff)26' : 'transparent';
    const borderColor = isSelected ? 'var(--accent,#4a9eff)' : 'var(--border-subtle,#333)';
    const score = s.result ? ` · ${s.result.cascadeScore.toFixed(2)}` : '';
    return `<li data-cf-scenario-id="${escapeHtml(s.id)}" style="cursor:pointer;padding:6px 8px;border:1px solid ${borderColor};border-radius:3px;background:${bg};display:flex;flex-direction:column;gap:2px;">
      <span style="font-size:12px;font-weight:600;">${escapeHtml(s.name)}</span>
      <span style="font-size:10px;color:var(--text-secondary,#aaa);">${s.overrides.length} override${s.overrides.length === 1 ? '' : 's'}${score}</span>
    </li>`;
  }).join('');
  return `<div>
    <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Scenarios</div>
    <ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px;">${items}</ul>
  </div>`;
}

function cascadeColor(score: number): string {
  if (score > 0.7) return '#ff453a';
  if (score > 0.4) return '#ff9800';
  if (score > 0.1) return '#ffeb3b';
  return '#4caf50';
}

function renderResultPane(scenario: CounterfactualScenario | undefined): string {
  if (!scenario) {
    return `<div style="font-size:12px;color:var(--text-secondary,#aaa);">Select a scenario to see the outcome.</div>`;
  }
  const overrideBlock = scenario.overrides.map((o) => renderOverride(o)).join('');
  const resultBlock = scenario.result
    ? renderResult(scenario.result)
    : `<div style="font-size:12px;color:var(--text-secondary,#aaa);">No result yet — click Re-run.</div>`;
  return `<div style="display:flex;flex-direction:column;gap:10px;">
    <div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">${escapeHtml(scenario.name)}</div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);">Snapshot: ${escapeHtml(scenario.baseSnapshotId)}</div>
    </div>
    <div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Overrides</div>
      <div style="display:flex;flex-direction:column;gap:4px;">${overrideBlock}</div>
    </div>
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
        <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">Result</div>
        <button id="cfReplayRunBtn" style="padding:4px 10px;background:transparent;color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;font-size:11px;">Re-run</button>
      </div>
      ${resultBlock}
    </div>
  </div>`;
}

function renderOverride(o: DomainOverride): string {
  const sign = o.severityDelta >= 0 ? '+' : '';
  return `<div style="font-size:11px;border-left:2px solid var(--border-subtle,#333);padding:4px 8px;background:var(--surface-2,#1a1a1a);border-radius:0 3px 3px 0;">
    <span style="font-family:ui-monospace,monospace;color:var(--text-primary,#fff);">${escapeHtml(o.domain)}</span>
    <span style="color:var(--text-secondary,#aaa);"> severity ${sign}${o.severityDelta.toFixed(2)} · events ${o.eventCountDelta >= 0 ? '+' : ''}${o.eventCountDelta}</span>
  </div>`;
}

function renderResult(r: ReplayResult): string {
  const color = cascadeColor(r.cascadeScore);
  return `<div style="border:1px solid var(--border-subtle,#333);border-radius:4px;padding:8px;display:flex;flex-direction:column;gap:8px;">
    <div style="display:flex;align-items:center;gap:8px;font-size:12px;">
      <span style="font-weight:700;color:${color};padding:2px 8px;border-radius:3px;background:${color}26;">cascade ${r.cascadeScore.toFixed(2)}</span>
      <span style="font-size:10px;color:var(--text-secondary,#aaa);">${r.affectedDomains.map((d) => escapeHtml(d)).join(' · ')}</span>
    </div>
    <div style="font-size:11px;color:var(--text-primary,#fff);line-height:1.5;">${escapeHtml(r.narrativeSummary)}</div>
  </div>`;
}
