/**
 * Observation Rules Panel (panel id: `observation-rules`).
 *
 * Browses + edits user-defined IF/THEN rules from
 * `src/services/intelligence/rules-engine.ts` (Phase 3, ObservationEvent-
 * based). Distinct from the legacy `AlertRulesPanel` (panel id
 * `alert-rules`) which operates on UnifiedAlert rows — the two coexist.
 *
 * UI:
 *   - List of rules with enable/disable toggle, last-triggered, count
 *   - "+ New Rule" expands an inline form: name, conditions, AND/OR,
 *     actions; uses `OPERATORS_FOR_FIELD` to gate the operator dropdown
 *   - Empty state offers the three preset rules from the spec
 *
 * Persistence: the engine's `loadRules` / `saveRules` (localStorage key
 * `wm-alert-rules`).
 */
/* eslint-disable sonarjs/no-nested-template-literals -- short row markup */

import { Panel } from './Panel';
import {
  createRule,
  deleteRuleById,
  loadRules,
  saveRules,
  upsertRule,
} from '@/services/intelligence/rules-engine';
import {
  ACTION_LABEL,
  FIELD_OPTIONS,
  OPERATORS_FOR_FIELD,
  OPERATOR_OPTIONS,
  PRESET_RULES,
  formatLastTriggered,
  isRuleComplete,
  summarizeRule,
} from './observation-rules-helpers';
import type {
  AlertRule,
  RuleAction,
  RuleActionType,
  RuleCondition,
  RuleConditionField,
  RuleConditionOperator,
} from '@/types/intelligence';
import { escapeHtml } from '@/utils/sanitize';

interface DraftRule {
  name: string;
  enabled: boolean;
  conditions: RuleCondition[];
  conditionOperator: 'AND' | 'OR';
  actions: RuleAction[];
}

function blankDraft(): DraftRule {
  return {
    name: '',
    enabled: true,
    conditions: [{ field: 'domain', operator: 'equals', value: '' }],
    conditionOperator: 'AND',
    actions: [{ type: 'notify' }],
  };
}

export class ObservationRulesPanel extends Panel {
  private rules: AlertRule[] = [];
  private editingDraft: DraftRule | null = null;
  private editingExistingId: string | null = null;

  constructor() {
    super({
      id: 'observation-rules',
      title: 'Observation Rules',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'User-defined IF/THEN rules evaluated against every incoming ObservationEvent. Rule actions fire wm:rule-triggered DOM events.',
    });
    this.rules = loadRules();
    this.getContentElement().addEventListener('click', (e) => this.handleClick(e));
    this.getContentElement().addEventListener('change', (e) => this.handleChange(e));
    this.getContentElement().addEventListener('input', (e) => this.handleInput(e));
    this.render();
  }

  private persistAndRender(): void {
    saveRules(this.rules);
    this.render();
  }

  private render(): void {
    this.setCount(this.rules.length);
    this.setContent(this.buildHtml());
  }

  private buildHtml(): string {
    const header = `<div class="obr-toolbar">
      <button class="obr-btn obr-btn-add" data-action="new">+ New rule</button>
    </div>`;
    const draftBlock = this.editingDraft ? this.renderDraft(this.editingDraft) : '';
    const list = this.rules.length === 0 && !this.editingDraft
      ? this.renderEmptyState()
      : this.renderRuleList();
    return `<div class="obr-panel">${header}${draftBlock}${list}</div>`;
  }

  private renderRuleList(): string {
    return `<div class="obr-rules">${
      this.rules.map((r) => this.renderRuleRow(r)).join('')
    }</div>`;
  }

  private renderRuleRow(rule: AlertRule): string {
    const editing = this.editingExistingId === rule.id;
    return `<div class="obr-row${editing ? ' obr-row-editing' : ''}" data-rule-id="${escapeHtml(rule.id)}">
      <div class="obr-row-head">
        <label class="obr-toggle">
          <input type="checkbox" data-action="toggle" ${rule.enabled ? 'checked' : ''} />
          <span></span>
        </label>
        <div class="obr-row-text">
          <div class="obr-row-name">${escapeHtml(rule.name)}</div>
          <div class="obr-row-summary">${escapeHtml(summarizeRule(rule))}</div>
        </div>
        <div class="obr-row-meta">
          <span class="obr-meta-line">Last: ${escapeHtml(formatLastTriggered(rule))}</span>
          <span class="obr-meta-line">Fired ${rule.triggerCount}×</span>
        </div>
        <div class="obr-row-actions">
          <button class="obr-btn obr-btn-edit" data-action="edit">Edit</button>
          <button class="obr-btn obr-btn-delete" data-action="delete">Delete</button>
        </div>
      </div>
    </div>`;
  }

  private renderEmptyState(): string {
    return `<div class="obr-empty">
      <p>No rules yet. Get started with a preset:</p>
      <div class="obr-presets">
        ${PRESET_RULES.map((p, i) => `<button class="obr-btn obr-btn-preset" data-action="preset" data-preset-index="${i}">
          <strong>${escapeHtml(p.name)}</strong>
          <span>${escapeHtml(p.description)}</span>
        </button>`).join('')}
      </div>
    </div>`;
  }

  private renderDraft(d: DraftRule): string {
    const conds = d.conditions.map((c, i) => this.renderConditionRow(c, i)).join('');
    const actions = d.actions.map((a, i) => this.renderActionRow(a, i)).join('');
    const complete = isRuleComplete(d);
    return `<div class="obr-draft">
      <div class="obr-draft-head">
        <input type="text" placeholder="Rule name" class="obr-draft-name"
          value="${escapeHtml(d.name)}" data-action="draft-name" />
        <label class="obr-draft-join">
          <span>Join</span>
          <select data-action="draft-join">
            <option value="AND"${d.conditionOperator === 'AND' ? ' selected' : ''}>AND</option>
            <option value="OR"${d.conditionOperator === 'OR' ? ' selected' : ''}>OR</option>
          </select>
        </label>
      </div>
      <div class="obr-draft-conditions">${conds}
        <button class="obr-btn obr-btn-tiny" data-action="add-condition">+ Condition</button>
      </div>
      <div class="obr-draft-actions">${actions}
        <button class="obr-btn obr-btn-tiny" data-action="add-action">+ Action</button>
      </div>
      <div class="obr-draft-footer">
        <button class="obr-btn obr-btn-cancel" data-action="cancel">Cancel</button>
        <button class="obr-btn obr-btn-save" data-action="save" ${complete ? '' : 'disabled'}>
          ${this.editingExistingId ? 'Update rule' : 'Save rule'}
        </button>
      </div>
    </div>`;
  }

  private renderConditionRow(c: RuleCondition, i: number): string {
    const ops = OPERATORS_FOR_FIELD[c.field];
    const fieldOpts = FIELD_OPTIONS.map((f) =>
      `<option value="${f.id}"${f.id === c.field ? ' selected' : ''}>${escapeHtml(f.label)}</option>`).join('');
    const opOpts = OPERATOR_OPTIONS.filter((o) => ops.includes(o.id)).map((o) =>
      `<option value="${o.id}"${o.id === c.operator ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
    const radius = c.operator === 'near'
      ? `<input type="number" placeholder="km" class="obr-cond-radius" min="1" max="20100"
          value="${c.radiusKm ?? ''}" data-action="draft-radius" data-cond-index="${i}" />`
      : '';
    return `<div class="obr-cond" data-cond-index="${i}">
      <select data-action="draft-field" data-cond-index="${i}">${fieldOpts}</select>
      <select data-action="draft-operator" data-cond-index="${i}">${opOpts}</select>
      <input type="text" class="obr-cond-value" placeholder="value"
        value="${escapeHtml(String(c.value))}" data-action="draft-value" data-cond-index="${i}" />
      ${radius}
      <button class="obr-btn obr-btn-tiny" data-action="remove-condition" data-cond-index="${i}">✕</button>
    </div>`;
  }

  private renderActionRow(a: RuleAction, i: number): string {
    const typeOpts = (['notify', 'escalate', 'log'] as RuleActionType[]).map((t) =>
      `<option value="${t}"${t === a.type ? ' selected' : ''}>${escapeHtml(ACTION_LABEL[t])}</option>`).join('');
    return `<div class="obr-action" data-action-index="${i}">
      <select data-action="draft-action-type" data-action-index="${i}">${typeOpts}</select>
      <button class="obr-btn obr-btn-tiny" data-action="remove-action" data-action-index="${i}">✕</button>
    </div>`;
  }

  // ── Event handlers ────────────────────────────────────────────────────

  private handleClick(e: Event): void {
    const target = e.target as HTMLElement;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (!action) return;
    const ruleId = target.closest<HTMLElement>('[data-rule-id]')?.dataset.ruleId;
    const handler = this.clickHandlers[action];
    if (handler) handler.call(this, target, ruleId);
  }

  private readonly clickHandlers: Record<string,
    (target: HTMLElement, ruleId: string | undefined) => void> = {
    new: () => this.beginDraft(blankDraft()),
    cancel: () => this.beginDraft(null),
    save: () => this.saveDraft(),
    edit: (_t, ruleId) => { if (ruleId) this.startEditing(ruleId); },
    delete: (_t, ruleId) => { if (ruleId) {
      this.rules = deleteRuleById(ruleId, this.rules);
      this.persistAndRender();
    } },
    'add-condition': () => {
      if (!this.editingDraft) return;
      this.editingDraft.conditions.push({ field: 'domain', operator: 'equals', value: '' });
      this.render();
    },
    'remove-condition': (target) => this.removeAt(target, 'condIndex', 'conditions'),
    'add-action': () => {
      if (!this.editingDraft) return;
      this.editingDraft.actions.push({ type: 'notify' });
      this.render();
    },
    'remove-action': (target) => this.removeAt(target, 'actionIndex', 'actions'),
    preset: (target) => this.applyPreset(target),
    toggle: (_t, ruleId) => {
      if (!ruleId) return;
      this.rules = this.rules.map((r) => r.id === ruleId ? { ...r, enabled: !r.enabled } : r);
      this.persistAndRender();
    },
  };

  private beginDraft(draft: DraftRule | null): void {
    this.editingDraft = draft;
    this.editingExistingId = null;
    this.render();
  }

  private removeAt(
    target: HTMLElement,
    indexAttr: 'condIndex' | 'actionIndex',
    field: 'conditions' | 'actions',
  ): void {
    if (!this.editingDraft) return;
    const i = Number(target.closest<HTMLElement>(`[data-${indexAttr.replace(/([A-Z])/g, '-$1').toLowerCase()}]`)?.dataset[indexAttr]);
    if (!Number.isFinite(i)) return;
    this.editingDraft[field].splice(i, 1);
    this.render();
  }

  private applyPreset(target: HTMLElement): void {
    const i = Number(target.closest<HTMLElement>('[data-preset-index]')?.dataset.presetIndex);
    const preset = PRESET_RULES[i];
    if (!preset) return;
    const created = createRule({
      name: preset.name,
      enabled: true,
      conditions: preset.conditions,
      conditionOperator: preset.conditionOperator,
      actions: preset.actions,
    });
    this.rules = upsertRule(created, this.rules);
    this.persistAndRender();
  }

  private handleChange(e: Event): void {
    const target = e.target as HTMLElement;
    const action = target.dataset.action;
    if (!action || !this.editingDraft) return;
    if (action === 'draft-join') {
      this.editingDraft.conditionOperator = (target as HTMLSelectElement).value as 'AND' | 'OR';
      return;
    }
    const value = (target as HTMLSelectElement).value;
    if (action === 'draft-field') this.applyFieldChange(target, value);
    else if (action === 'draft-operator') this.applyOperatorChange(target, value);
    else if (action === 'draft-action-type') this.applyActionTypeChange(target, value);
  }

  private applyFieldChange(target: HTMLElement, value: string): void {
    const c = this.condFromTarget(target);
    if (!c) return;
    c.field = value as RuleConditionField;
    c.operator = OPERATORS_FOR_FIELD[c.field][0] ?? 'equals';
    this.render();
  }

  private applyOperatorChange(target: HTMLElement, value: string): void {
    const c = this.condFromTarget(target);
    if (!c) return;
    c.operator = value as RuleConditionOperator;
    this.render();
  }

  private applyActionTypeChange(target: HTMLElement, value: string): void {
    if (!this.editingDraft) return;
    const i = Number(target.dataset.actionIndex);
    if (!Number.isFinite(i)) return;
    const a = this.editingDraft.actions[i];
    if (a) a.type = value as RuleActionType;
  }

  private condFromTarget(target: HTMLElement): RuleCondition | null {
    if (!this.editingDraft) return null;
    const i = Number(target.dataset.condIndex);
    if (!Number.isFinite(i)) return null;
    return this.editingDraft.conditions[i] ?? null;
  }

  private handleInput(e: Event): void {
    const target = e.target as HTMLElement;
    const action = target.dataset.action;
    if (!action || !this.editingDraft) return;
    if (action === 'draft-name') {
      this.editingDraft.name = (target as HTMLInputElement).value;
    } else if (action === 'draft-value') {
      this.applyValueInput(target);
    } else if (action === 'draft-radius') {
      this.applyRadiusInput(target);
    } else {
      return;
    }
    this.refreshSaveButton();
  }

  private applyValueInput(target: HTMLElement): void {
    const c = this.condFromTarget(target);
    if (!c) return;
    const raw = (target as HTMLInputElement).value;
    if (c.field === 'magnitude' || c.field === 'containment') {
      const n = Number.parseFloat(raw);
      c.value = Number.isFinite(n) ? n : raw;
    } else {
      c.value = raw;
    }
  }

  private applyRadiusInput(target: HTMLElement): void {
    const c = this.condFromTarget(target);
    if (!c) return;
    const n = Number.parseFloat((target as HTMLInputElement).value);
    c.radiusKm = Number.isFinite(n) && n > 0 ? n : undefined;
  }

  private refreshSaveButton(): void {
    if (!this.editingDraft) return;
    const saveBtn = this.getContentElement().querySelector<HTMLButtonElement>('[data-action="save"]');
    if (saveBtn) saveBtn.disabled = !isRuleComplete(this.editingDraft);
  }

  private startEditing(ruleId: string): void {
    const existing = this.rules.find((r) => r.id === ruleId);
    if (!existing) return;
    this.editingExistingId = ruleId;
    this.editingDraft = {
      name: existing.name,
      enabled: existing.enabled,
      conditions: existing.conditions.map((c) => ({ ...c })),
      conditionOperator: existing.conditionOperator,
      actions: existing.actions.map((a) => ({ ...a })),
    };
    this.render();
  }

  private saveDraft(): void {
    if (!this.editingDraft || !isRuleComplete(this.editingDraft)) return;
    if (this.editingExistingId) {
      this.rules = this.rules.map((r) => r.id === this.editingExistingId
        ? { ...r,
            name: this.editingDraft!.name,
            enabled: this.editingDraft!.enabled,
            conditions: this.editingDraft!.conditions,
            conditionOperator: this.editingDraft!.conditionOperator,
            actions: this.editingDraft!.actions }
        : r);
    } else {
      const created = createRule({
        name: this.editingDraft.name,
        enabled: this.editingDraft.enabled,
        conditions: this.editingDraft.conditions,
        conditionOperator: this.editingDraft.conditionOperator,
        actions: this.editingDraft.actions,
      });
      this.rules = upsertRule(created, this.rules);
    }
    this.editingDraft = null;
    this.editingExistingId = null;
    this.persistAndRender();
  }
}
