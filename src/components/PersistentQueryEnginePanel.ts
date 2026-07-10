/* eslint-disable sonarjs/no-nested-template-literals */
/**
 * Persistent Query Engine Panel — three-section operator surface:
 *   1. Stats row (total / enabled / matches / top query)
 *   2. Query list (toggle enable, edit, delete)
 *   3. Create form (name, combinator, up to 5 condition rows)
 *   4. Recent matches feed
 *   5. "Test Against Stub" button to fire a sample observation
 */

import { Panel } from './Panel';
import {
  getPersistentQueryEngineService,
  type Combinator,
  type EvaluationSource,
  type QueryCondition,
  type QueryEngineStats,
  type QueryField,
  type QueryMatch,
  type QueryOperator,
  type SavedQuery,
} from '@/services/intelligence/persistent-query-engine';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30_000;
const MATCH_DISPLAY_LIMIT = 30;
const MAX_FORM_CONDITIONS = 5;

const FIELDS: readonly QueryField[] = ['domain', 'severity', 'region', 'keyword'];
const OPERATORS: readonly QueryOperator[] = ['equals', 'contains', 'gte'];

interface FormCondition {
  field: QueryField;
  operator: QueryOperator;
  value: string;
}

interface PanelState {
  formName: string;
  formCombinator: Combinator;
  formConditions: FormCondition[];
}

function blankCondition(): FormCondition {
  return { field: 'domain', operator: 'equals', value: '' };
}

export class PersistentQueryEnginePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsub: (() => void) | null = null;
  private state: PanelState = {
    formName: '',
    formCombinator: 'AND',
    formConditions: [blankCondition()],
  };

  constructor() {
    super({
      id: 'persistent-query-engine',
      title: 'Persistent Query Engine',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Saved "alert-me-when" queries that auto-evaluate against incoming observations and Situations. Each match increments the query\'s counter and stamps lastMatchedAt.',
    });
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsub = getPersistentQueryEngineService().subscribe(() => this.render());
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
    const svc = getPersistentQueryEngineService();
    const queries = svc.getQueries();
    const matches = svc.getMatches(undefined, MATCH_DISPLAY_LIMIT);
    const stats = svc.getStats();
    this.setCount(stats.enabledQueries);

    const html = `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      ${renderStatsRow(stats)}
      ${renderQueryList(queries)}
      ${this.renderCreateForm()}
      ${renderMatchesFeed(matches)}
      ${renderFooter()}
    </div>`;
    this.setContent(html, () => this.wireHandlers());
  }

  private renderCreateForm(): string {
    const conditionRows = this.state.formConditions.map((c, idx) => renderConditionRow(c, idx)).join('');
    const canAdd = this.state.formConditions.length < MAX_FORM_CONDITIONS;
    return `<div style="display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--border-subtle,#333);border-radius:4px;background:var(--surface-2,#1a1a1a);">
      <span style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">Create Query</span>
      <div style="display:grid;grid-template-columns:1fr 100px;gap:6px;">
        <input id="pqeFormName" type="text" placeholder="Query name (e.g. Severe Tokyo events)" value="${escapeHtml(this.state.formName)}" style="padding:5px 8px;background:var(--surface-3,#222);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:12px;" />
        <select id="pqeFormCombinator" style="padding:5px 8px;background:var(--surface-3,#222);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:12px;">
          <option value="AND"${this.state.formCombinator === 'AND' ? ' selected' : ''}>AND</option>
          <option value="OR"${this.state.formCombinator === 'OR' ? ' selected' : ''}>OR</option>
        </select>
      </div>
      <div id="pqeConditionRows" style="display:flex;flex-direction:column;gap:5px;">${conditionRows}</div>
      <div style="display:flex;gap:8px;">
        ${canAdd ? `<button id="pqeAddCondition" style="padding:4px 10px;font-size:11px;background:var(--surface-3,#222);color:var(--text-secondary,#aaa);border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;">+ Condition</button>` : ''}
        <button id="pqeSaveQuery" style="padding:4px 12px;font-size:11px;background:#4caf5026;color:#4caf50;border:1px solid #4caf5055;border-radius:3px;cursor:pointer;">Save Query</button>
      </div>
    </div>`;
  }

  private wireHandlers(): void {
    setTimeout(() => {
      const root = this.content;
      const svc = getPersistentQueryEngineService();

      root.querySelector<HTMLInputElement>('#pqeFormName')?.addEventListener('input', (e) => {
        this.state.formName = (e.target as HTMLInputElement).value;
      });
      root.querySelector<HTMLSelectElement>('#pqeFormCombinator')?.addEventListener('change', (e) => {
        this.state.formCombinator = (e.target as HTMLSelectElement).value as Combinator;
      });
      root.querySelectorAll<HTMLSelectElement>('[data-pqe-cond-field]').forEach((el) => {
        el.addEventListener('change', () => {
          const idx = Number(el.dataset.pqeCondField);
          const target = this.state.formConditions[idx];
          if (target) target.field = el.value as QueryField;
        });
      });
      root.querySelectorAll<HTMLSelectElement>('[data-pqe-cond-op]').forEach((el) => {
        el.addEventListener('change', () => {
          const idx = Number(el.dataset.pqeCondOp);
          const target = this.state.formConditions[idx];
          if (target) target.operator = el.value as QueryOperator;
        });
      });
      root.querySelectorAll<HTMLInputElement>('[data-pqe-cond-value]').forEach((el) => {
        el.addEventListener('input', () => {
          const idx = Number(el.dataset.pqeCondValue);
          const target = this.state.formConditions[idx];
          if (target) target.value = el.value;
        });
      });
      root.querySelectorAll<HTMLButtonElement>('[data-pqe-cond-remove]').forEach((el) => {
        el.addEventListener('click', () => {
          const idx = Number(el.dataset.pqeCondRemove);
          this.state.formConditions.splice(idx, 1);
          if (this.state.formConditions.length === 0) this.state.formConditions.push(blankCondition());
          this.render();
        });
      });
      root.querySelector<HTMLButtonElement>('#pqeAddCondition')?.addEventListener('click', () => {
        if (this.state.formConditions.length >= MAX_FORM_CONDITIONS) return;
        this.state.formConditions.push(blankCondition());
        this.render();
      });
      root.querySelector<HTMLButtonElement>('#pqeSaveQuery')?.addEventListener('click', () => this.handleSaveQuery());
      root.querySelectorAll<HTMLInputElement>('[data-pqe-toggle]').forEach((el) => {
        el.addEventListener('change', () => {
          const id = el.dataset.pqeToggle;
          if (id) svc.update(id, { enabled: el.checked });
        });
      });
      root.querySelectorAll<HTMLButtonElement>('[data-pqe-delete]').forEach((el) => {
        el.addEventListener('click', () => {
          const id = el.dataset.pqeDelete;
          if (id) svc.delete(id);
        });
      });
      root.querySelector<HTMLButtonElement>('#pqeTestStub')?.addEventListener('click', () => {
        svc.evaluate(buildStubSource());
      });
    }, 0);
  }

  private handleSaveQuery(): void {
    const name = this.state.formName.trim();
    if (name.length === 0) return;
    const conditions: QueryCondition[] = this.state.formConditions
      .filter((c) => c.value.trim().length > 0)
      .map((c) => ({ field: c.field, operator: c.operator, value: c.value.trim() }));
    if (conditions.length === 0) return;
    getPersistentQueryEngineService().save({
      name,
      conditions,
      combinator: this.state.formCombinator,
      enabled: true,
    });
    this.state = { formName: '', formCombinator: 'AND', formConditions: [blankCondition()] };
    this.render();
  }
}

function buildStubSource(): EvaluationSource {
  return {
    id: `stub-${Date.now()}`,
    type: 'observation',
    domain: 'cyber',
    severity: 'high',
    region: 'EU',
    title: 'Panel-generated test observation',
  };
}

// ── Rendering helpers ───────────────────────────────────────────────

function renderStatsRow(stats: QueryEngineStats): string {
  const top = stats.topQuery
    ? `<span><strong style="color:#ffb74d;">${escapeHtml(stats.topQuery.name)}</strong> (${stats.topQuery.matchCount})</span>`
    : '<span style="color:var(--text-secondary,#666);">No matches yet</span>';
  return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:11px;color:var(--text-secondary,#aaa);">
    <span><strong style="color:var(--text-primary,#ddd);">${stats.totalQueries}</strong> queries · <strong style="color:#4a9eff;">${stats.enabledQueries}</strong> enabled · <strong>${stats.totalMatches}</strong> matches</span>
    ${top}
  </div>`;
}

function renderQueryList(queries: readonly SavedQuery[]): string {
  if (queries.length === 0) {
    return `<div style="font-size:12px;color:var(--text-secondary,#aaa);padding:14px;text-align:center;border:1px dashed var(--border-subtle,#333);border-radius:4px;">No saved queries yet. Use the form below to create one.</div>`;
  }
  const rows = queries.map((q) => renderQueryRow(q)).join('');
  return `<div>
    <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:5px;">Saved Queries (${queries.length})</div>
    <ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px;">${rows}</ul>
  </div>`;
}

function renderQueryRow(q: SavedQuery): string {
  const condSummary = q.conditions.map((c) => `${c.field} ${c.operator} ${c.value}`).join(` ${q.combinator} `);
  const last = q.lastMatchedAt ? new Date(q.lastMatchedAt).toISOString().slice(0, 16).replace('T', ' ') : 'never';
  return `<li style="display:grid;grid-template-columns:30px 1fr 80px 130px 60px;gap:8px;align-items:center;padding:6px 10px;border:1px solid var(--border-subtle,#333);border-radius:3px;background:var(--surface-2,#1a1a1a);font-size:11px;">
    <input type="checkbox" data-pqe-toggle="${escapeHtml(q.id)}"${q.enabled ? ' checked' : ''} style="accent-color:#4caf50;" />
    <div style="display:flex;flex-direction:column;gap:2px;min-width:0;">
      <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(q.name)}</span>
      <span style="font-size:10px;color:var(--text-secondary,#aaa);font-family:ui-monospace,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(condSummary)}</span>
    </div>
    <span style="font-family:ui-monospace,monospace;text-align:right;">${q.matchCount} hits</span>
    <span style="font-family:ui-monospace,monospace;color:var(--text-secondary,#aaa);font-size:10px;">${escapeHtml(last)}</span>
    <button data-pqe-delete="${escapeHtml(q.id)}" style="padding:3px 8px;font-size:10px;background:#f4433626;color:#f44336;border:1px solid #f4433655;border-radius:3px;cursor:pointer;">Delete</button>
  </li>`;
}

function renderConditionRow(c: FormCondition, idx: number): string {
  const fieldOpts = FIELDS.map((f) =>
    `<option value="${f}"${f === c.field ? ' selected' : ''}>${f}</option>`,
  ).join('');
  const opOpts = OPERATORS.map((o) =>
    `<option value="${o}"${o === c.operator ? ' selected' : ''}>${o}</option>`,
  ).join('');
  return `<div style="display:grid;grid-template-columns:1fr 1fr 1.5fr 24px;gap:5px;align-items:center;">
    <select data-pqe-cond-field="${idx}" style="padding:4px 6px;background:var(--surface-3,#222);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:11px;">${fieldOpts}</select>
    <select data-pqe-cond-op="${idx}" style="padding:4px 6px;background:var(--surface-3,#222);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:11px;">${opOpts}</select>
    <input data-pqe-cond-value="${idx}" type="text" value="${escapeHtml(c.value)}" placeholder="value" style="padding:4px 6px;background:var(--surface-3,#222);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:11px;" />
    <button data-pqe-cond-remove="${idx}" title="Remove" style="padding:2px 6px;font-size:11px;background:transparent;color:#f44336;border:1px solid #f4433655;border-radius:3px;cursor:pointer;">×</button>
  </div>`;
}

function renderMatchesFeed(matches: readonly QueryMatch[]): string {
  if (matches.length === 0) {
    return `<div style="font-size:11px;color:var(--text-secondary,#aaa);padding:10px;text-align:center;border:1px dashed var(--border-subtle,#333);border-radius:4px;">No matches recorded yet.</div>`;
  }
  const rows = matches.map((m) => renderMatchRow(m)).join('');
  return `<div>
    <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:5px;">Recent Matches (${matches.length})</div>
    <ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:3px;max-height:240px;overflow-y:auto;">${rows}</ul>
  </div>`;
}

function renderMatchRow(m: QueryMatch): string {
  const snapshot = Object.entries(m.fieldSnapshot)
    .map(([k, v]) => `${escapeHtml(k)}=${escapeHtml(v)}`)
    .join(' · ');
  const when = new Date(m.matchedAt).toISOString().slice(0, 16).replace('T', ' ');
  return `<li style="display:grid;grid-template-columns:1fr 100px;gap:6px;align-items:center;padding:5px 8px;border:1px solid var(--border-subtle,#333);border-radius:3px;background:var(--surface-2,#1a1a1a);font-size:10px;">
    <div style="display:flex;flex-direction:column;gap:1px;min-width:0;">
      <span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(m.queryName)} <span style="color:var(--text-secondary,#aaa);font-weight:400;">↤ ${escapeHtml(m.sourceType)} ${escapeHtml(m.sourceId)}</span></span>
      <span style="font-family:ui-monospace,monospace;color:var(--text-secondary,#aaa);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${snapshot}</span>
    </div>
    <span style="font-family:ui-monospace,monospace;color:var(--text-secondary,#666);text-align:right;">${escapeHtml(when)}</span>
  </li>`;
}

function renderFooter(): string {
  return `<div style="display:flex;justify-content:flex-end;">
    <button id="pqeTestStub" style="padding:4px 12px;font-size:11px;background:#4a9eff26;color:#4a9eff;border:1px solid #4a9eff55;border-radius:3px;cursor:pointer;">Test Against Stub</button>
  </div>`;
}
