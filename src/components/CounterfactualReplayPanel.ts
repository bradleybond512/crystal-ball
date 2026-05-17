/* eslint-disable sonarjs/no-nested-template-literals */
/**
 * Counterfactual Replay Panel — Phase 4 "what if?" UI.
 *
 * Two-column layout: scenario list on the left, result view on the
 * right. New Scenario button opens an inline form that picks a built-in
 * template + a Situation observation as the baseline. Re-running an
 * existing scenario produces a fresh ReplayResult and updates the
 * right-hand pane.
 */

import { Panel } from './Panel';
import {
  BUILT_IN_REPLAY_TEMPLATES,
  getCounterfactualReplayEngine,
  type ReplayModification,
  type ReplayResult,
  type ReplayScenario,
} from '@/services/intelligence/counterfactual-replay';
import { getSituationStoreV2, type Situation } from '@/services/intelligence/situation-store-v2';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30_000;

interface FormState {
  open: boolean;
  observationId: string | null;
  templateId: string;
  name: string;
  description: string;
  error: string | null;
}

interface PanelState {
  selectedScenarioId: string | null;
  form: FormState;
}

export class CounterfactualReplayPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsub: (() => void) | null = null;
  private state: PanelState = {
    selectedScenarioId: null,
    form: {
      open: false,
      observationId: null,
      templateId: BUILT_IN_REPLAY_TEMPLATES[0]!.id,
      name: '',
      description: '',
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
        'Phase 4 "what if?" replay. Modify the severity, domain, location, magnitude, or confidence on a past observation and re-score it through a deterministic local scorer to see how brittle the original conclusion was. Built-in templates: severity downgrade, source reduction, ~1000 km location shift, -6 h timing shift.',
    });
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.render(), REFRESH_MS);
    this.unsub = getCounterfactualReplayEngine().subscribe(() => this.render());
  }

  public dispose(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
  }

  private collectObservations(): { situation: Situation; observationId: string; title: string }[] {
    const out: { situation: Situation; observationId: string; title: string }[] = [];
    for (const s of getSituationStoreV2().list()) {
      for (const o of s.observations) {
        out.push({ situation: s, observationId: o.id, title: o.title || o.id });
      }
    }
    return out;
  }

  private render(): void {
    const engine = getCounterfactualReplayEngine();
    const scenarios = engine.getAllScenarios();
    this.setCount(scenarios.length);

    const selected = this.state.selectedScenarioId
      ? scenarios.find((s) => s.id === this.state.selectedScenarioId)
      : scenarios[scenarios.length - 1];
    const selectedId = selected?.id ?? null;
    const results = selectedId ? engine.getResults(selectedId) : [];
    const latestResult = results[results.length - 1];

    const html = `<div style="padding:12px;display:flex;flex-direction:column;gap:12px;">
      ${this.renderToolbar()}
      ${this.state.form.open ? this.renderNewScenarioForm() : ''}
      <div style="display:grid;grid-template-columns:minmax(180px,1fr) 2fr;gap:12px;align-items:flex-start;">
        ${renderScenarioList(scenarios, selectedId)}
        ${renderResultPane(selected, latestResult, results.length)}
      </div>
    </div>`;
    this.setContent(html);
    this.wireHandlers();
  }

  private renderToolbar(): string {
    const label = this.state.form.open ? 'Cancel' : '+ New Scenario';
    return `<div style="display:flex;align-items:center;gap:8px;">
      <button id="cfReplayNewBtn" style="padding:6px 12px;background:var(--accent,#4a9eff);color:#fff;border:0;border-radius:3px;cursor:pointer;font-weight:600;font-size:12px;">${label}</button>
      <span style="font-size:11px;color:var(--text-secondary,#aaa);">${BUILT_IN_REPLAY_TEMPLATES.length} built-in templates · scoring is self-contained (no live-pipeline side effects)</span>
    </div>`;
  }

  private renderNewScenarioForm(): string {
    const observations = this.collectObservations();
    const obsOptions = observations.length === 0
      ? `<option value="">No observations available — ingest a Situation first</option>`
      : observations.map((o) => `<option value="${escapeHtml(o.observationId)}"${o.observationId === this.state.form.observationId ? ' selected' : ''}>${escapeHtml(o.title)} · ${escapeHtml(o.situation.domain)}</option>`).join('');
    const templateOptions = BUILT_IN_REPLAY_TEMPLATES.map((t) =>
      `<option value="${escapeHtml(t.id)}"${t.id === this.state.form.templateId ? ' selected' : ''}>${escapeHtml(t.label)} — ${escapeHtml(t.description)}</option>`,
    ).join('');
    const errorBlock = this.state.form.error
      ? `<div style="color:#f44336;font-size:11px;margin-top:6px;">${escapeHtml(this.state.form.error)}</div>`
      : '';
    return `<div style="border:1px solid var(--border-subtle,#333);border-radius:4px;padding:10px;display:flex;flex-direction:column;gap:8px;">
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">New scenario</div>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;">
        <span style="color:var(--text-secondary,#aaa);">Baseline observation</span>
        <select id="cfReplayObsSelect" style="padding:4px 6px;background:var(--surface-2,#1a1a1a);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:11px;">${obsOptions}</select>
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;">
        <span style="color:var(--text-secondary,#aaa);">Template</span>
        <select id="cfReplayTemplateSelect" style="padding:4px 6px;background:var(--surface-2,#1a1a1a);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:11px;">${templateOptions}</select>
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;">
        <span style="color:var(--text-secondary,#aaa);">Name (optional)</span>
        <input id="cfReplayName" type="text" value="${escapeHtml(this.state.form.name)}" placeholder="defaults to template label" style="padding:4px 6px;background:var(--surface-2,#1a1a1a);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:11px;">
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;">
        <span style="color:var(--text-secondary,#aaa);">Description (optional)</span>
        <input id="cfReplayDesc" type="text" value="${escapeHtml(this.state.form.description)}" placeholder="defaults to template description" style="padding:4px 6px;background:var(--surface-2,#1a1a1a);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:11px;">
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
      root.querySelector<HTMLSelectElement>('#cfReplayObsSelect')?.addEventListener('change', (e) => {
        this.state.form.observationId = (e.target as HTMLSelectElement).value;
      });
      root.querySelector<HTMLSelectElement>('#cfReplayTemplateSelect')?.addEventListener('change', (e) => {
        this.state.form.templateId = (e.target as HTMLSelectElement).value;
      });
      root.querySelector<HTMLInputElement>('#cfReplayName')?.addEventListener('input', (e) => {
        this.state.form.name = (e.target as HTMLInputElement).value;
      });
      root.querySelector<HTMLInputElement>('#cfReplayDesc')?.addEventListener('input', (e) => {
        this.state.form.description = (e.target as HTMLInputElement).value;
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
    const obsId = this.state.form.observationId;
    if (!obsId) {
      this.state.form.error = 'Pick a baseline observation first.';
      this.render();
      return;
    }
    const observations = this.collectObservations();
    const target = observations.find((o) => o.observationId === obsId);
    if (!target) {
      this.state.form.error = 'Selected observation no longer available.';
      this.render();
      return;
    }
    const observation = target.situation.observations.find((o) => o.id === obsId);
    if (!observation) {
      this.state.form.error = 'Observation lookup failed.';
      this.render();
      return;
    }
    const engine = getCounterfactualReplayEngine();
    const name = this.state.form.name.trim();
    const description = this.state.form.description.trim();
    const scenario = engine.createFromTemplate(
      this.state.form.templateId,
      observation,
      name === '' ? undefined : name,
      description === '' ? undefined : description,
    );
    if (!scenario) {
      this.state.form.error = 'Unknown template id.';
      this.render();
      return;
    }
    engine.runReplay(scenario.id);
    this.state.selectedScenarioId = scenario.id;
    this.state.form.open = false;
    this.state.form.error = null;
    this.render();
  }

  private handleRerun(): void {
    const id = this.state.selectedScenarioId;
    if (!id) return;
    getCounterfactualReplayEngine().runReplay(id);
    this.render();
  }
}

function renderScenarioList(scenarios: readonly ReplayScenario[], selectedId: string | null): string {
  if (scenarios.length === 0) {
    return `<div style="font-size:12px;color:var(--text-secondary,#aaa);">No scenarios yet. Create one with a baseline observation and a built-in template.</div>`;
  }
  const items = [...scenarios].sort((a, b) => b.createdAt - a.createdAt).map((s) => {
    const isSelected = s.id === selectedId;
    const bg = isSelected ? 'var(--accent,#4a9eff)26' : 'transparent';
    const borderColor = isSelected ? 'var(--accent,#4a9eff)' : 'var(--border-subtle,#333)';
    return `<li data-cf-scenario-id="${escapeHtml(s.id)}" style="cursor:pointer;padding:6px 8px;border:1px solid ${borderColor};border-radius:3px;background:${bg};display:flex;flex-direction:column;gap:2px;">
      <span style="font-size:12px;font-weight:600;">${escapeHtml(s.name)}</span>
      <span style="font-size:10px;color:var(--text-secondary,#aaa);">${escapeHtml(s.baselineObservation.domain)} · ${s.modifications.length} mod${s.modifications.length === 1 ? '' : 's'}</span>
    </li>`;
  }).join('');
  return `<div>
    <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Scenarios</div>
    <ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px;">${items}</ul>
  </div>`;
}

function deltaColor(delta: number): string {
  if (delta > 0.05) return '#f44336';
  if (delta < -0.05) return '#4caf50';
  return '#9e9e9e';
}

function renderResultPane(
  scenario: ReplayScenario | undefined,
  latestResult: ReplayResult | undefined,
  resultCount: number,
): string {
  if (!scenario) {
    return `<div style="font-size:12px;color:var(--text-secondary,#aaa);">Select a scenario to see the replay outcome.</div>`;
  }
  const baselineSummary = `${scenario.baselineObservation.domain} · ${scenario.baselineObservation.severity}`;
  const modBlock = scenario.modifications.map((m) => renderModification(m)).join('');
  const resultBlock = latestResult
    ? renderResult(latestResult, resultCount)
    : `<div style="font-size:12px;color:var(--text-secondary,#aaa);">No replay results yet — click Re-run.</div>`;
  return `<div style="display:flex;flex-direction:column;gap:10px;">
    <div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">${escapeHtml(scenario.name)}</div>
      <div style="font-size:11px;color:var(--text-primary,#fff);">${escapeHtml(scenario.description)}</div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:4px;">Baseline · ${escapeHtml(baselineSummary)}</div>
    </div>
    <div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Modifications</div>
      <div style="display:flex;flex-direction:column;gap:4px;">${modBlock}</div>
    </div>
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
        <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">Latest result</div>
        <button id="cfReplayRunBtn" style="padding:4px 10px;background:transparent;color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;font-size:11px;">Re-run</button>
      </div>
      ${resultBlock}
    </div>
  </div>`;
}

function renderModification(m: ReplayModification): string {
  return `<div style="font-size:11px;border-left:2px solid var(--border-subtle,#333);padding:4px 8px;background:var(--surface-2,#1a1a1a);border-radius:0 3px 3px 0;">
    <span style="font-family:ui-monospace,monospace;color:var(--text-primary,#fff);">${escapeHtml(m.field)}</span>
    <span style="color:var(--text-secondary,#aaa);"> · ${escapeHtml(String(m.originalValue))} → <span style="color:var(--text-primary,#fff);">${escapeHtml(String(m.modifiedValue))}</span></span>
    <div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:2px;font-style:italic;">${escapeHtml(m.rationale)}</div>
  </div>`;
}

function renderResult(r: ReplayResult, runCount: number): string {
  const color = deltaColor(r.deltaScore);
  const deltaStr = (r.deltaScore >= 0 ? '+' : '') + r.deltaScore.toFixed(3);
  return `<div style="border:1px solid var(--border-subtle,#333);border-radius:4px;padding:8px;display:flex;flex-direction:column;gap:8px;">
    <div style="display:flex;align-items:center;gap:12px;font-size:12px;font-family:ui-monospace,monospace;">
      <div style="flex:1;">
        <span style="color:var(--text-secondary,#aaa);">Original</span>
        <div style="font-weight:600;">${escapeHtml(r.originalOutcome)}</div>
      </div>
      <div style="font-size:18px;color:${color};">→</div>
      <div style="flex:1;text-align:right;">
        <span style="color:var(--text-secondary,#aaa);">Replayed</span>
        <div style="font-weight:600;">${escapeHtml(r.replayedOutcome)}</div>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;font-size:11px;">
      <span style="font-weight:700;color:${color};padding:2px 6px;border-radius:3px;background:${color}26;">Δ ${deltaStr}</span>
      <span style="color:var(--text-secondary,#aaa);">across ${runCount} run${runCount === 1 ? '' : 's'}</span>
    </div>
    <ul style="margin:0;padding-left:18px;font-size:11px;line-height:1.5;color:var(--text-primary,#fff);">
      ${r.insights.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}
    </ul>
  </div>`;
}
