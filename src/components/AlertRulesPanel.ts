/**
 * Alert Rules Panel
 *
 * Lets users create, edit, reorder, and manage condition->action rules that
 * filter incoming UnifiedAlert items. Rules are evaluated in list order;
 * the first matching rule wins.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  loadRules,
  saveRules,
  PRESET_TEMPLATES,
  type AlertRule,
  type AlertCondition,
  type AlertAction,
} from '@/services/alert-rules';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FIELD_OPTIONS: { value: AlertCondition['field']; label: string }[] = [
  { value: 'source', label: 'Source' },
  { value: 'severity', label: 'Severity' },
  { value: 'distance', label: 'Distance (km)' },
  { value: 'title', label: 'Title' },
  { value: 'category', label: 'Category' },
];

const OP_OPTIONS: { value: AlertCondition['op']; label: string }[] = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '!=' },
  { value: 'gte', label: '>=' },
  { value: 'lte', label: '<=' },
  { value: 'contains', label: 'contains' },
  { value: 'matches', label: 'matches (regex)' },
];

const NOTIFY_OPTIONS: { value: AlertAction['notify']; label: string }[] = [
  { value: 'sound+banner', label: 'Sound + Banner' },
  { value: 'banner', label: 'Banner' },
  { value: 'badge', label: 'Badge only' },
  { value: 'silent', label: 'Silent' },
  { value: 'suppress', label: 'Suppress' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _idCounter = 0;
function uid(): string {
  _idCounter += 1;
  return `rule-${Date.now()}-${_idCounter}`;
}

function blankCondition(): AlertCondition {
  return { field: 'source', op: 'eq', value: '' };
}

function blankRule(): AlertRule {
  return {
 id: uid(),
 name: '',
 enabled: true,
 conditions: [blankCondition()],
 action: { notify: 'banner' },
 createdAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export class AlertRulesPanel extends Panel {
  private rules: AlertRule[] = [];
  private editingRuleId: string | null = null;
  private editingDraft: AlertRule | null = null;

  constructor() {
 super({
 id: 'alert-rules',
 title: 'Alert Rules',
 showCount: true,
 trackActivity: false,
 infoTooltip:
 'Define condition\u2192action rules evaluated against every incoming alert. ' +
 'Rules run in list order; first match wins. Load a preset to get started quickly.',
 });

 this.rules = loadRules();
 this.content.addEventListener('click', (e) => this.handleClick(e));
 this.content.addEventListener('change', (e) => this.handleChange(e));
 this.render();
  }

  // -----------------------------------------------------------------------
  // Persistence
  // -----------------------------------------------------------------------

  private persist(): void {
 saveRules(this.rules);
 this.setCount(this.rules.length);
  }

  // -----------------------------------------------------------------------
  // Rendering
  // -----------------------------------------------------------------------

  private render(): void {
 this.setCount(this.rules.length);

 const rows = this.rules.map((rule, idx) => {
 const isEditing = this.editingRuleId === rule.id;
 if (isEditing && this.editingDraft) {
 return this.renderEditForm(this.editingDraft);
 }
 return this.renderRuleRow(rule, idx);
 }).join('');

 this.content.innerHTML = `
 <div class="alert-rules-toolbar">
 <button class="alert-rules-btn alert-rules-btn-add" data-action="add">+ Add Rule</button>
 <select class="alert-rules-preset-select" data-action="preset-select">
 <option value="">Load Preset\u2026</option>
 ${PRESET_TEMPLATES.map((p, i) =>
 `<option value="${i}">${escapeHtml(p.label)}</option>`
 ).join('')}
 </select>
 </div>
 <div class="alert-rules-list">
 ${rows || '<div class="alert-rules-empty">No rules defined. Add one or load a preset.</div>'}
 </div>
 `;
  }

  private renderRuleRow(rule: AlertRule, idx: number): string {
 const condSummary = rule.conditions.map((c) => {
 return `<span class="alert-rules-cond-chip">${escapeHtml(c.field)} ${escapeHtml(c.op)} ${escapeHtml(String(c.value))}</span>`;
 }).join(' AND ');

 const actionLabel = rule.action.notify
 + (rule.action.autoPin ? ' +pin' : '')
 + (rule.action.autoAcknowledge ? ' +ack' : '');

 return `
 <div class="alert-rules-row${rule.enabled ? '' : ' alert-rules-row-disabled'}" data-rule-id="${escapeHtml(rule.id)}">
 <div class="alert-rules-row-header">
 <label class="alert-rules-toggle">
 <input type="checkbox" data-action="toggle" data-rule-id="${escapeHtml(rule.id)}" ${rule.enabled ? 'checked' : ''}>
 <span class="alert-rules-rule-name">${escapeHtml(rule.name || '(unnamed)')}</span>
 </label>
 <span class="alert-rules-row-actions">
 ${idx > 0 ? `<button class="alert-rules-btn-sm" data-action="move-up" data-rule-id="${escapeHtml(rule.id)}" title="Move up">\u25B2</button>` : ''}
 ${idx < this.rules.length - 1 ? `<button class="alert-rules-btn-sm" data-action="move-down" data-rule-id="${escapeHtml(rule.id)}" title="Move down">\u25BC</button>` : ''}
 <button class="alert-rules-btn-sm" data-action="edit" data-rule-id="${escapeHtml(rule.id)}" title="Edit">\u270E</button>
 <button class="alert-rules-btn-sm alert-rules-btn-danger" data-action="delete" data-rule-id="${escapeHtml(rule.id)}" title="Delete">\u2715</button>
 </span>
 </div>
 <div class="alert-rules-row-body">
 <span class="alert-rules-conditions">${condSummary}</span>
 <span class="alert-rules-arrow">\u2192</span>
 <span class="alert-rules-action-chip">${escapeHtml(actionLabel)}</span>
 ${rule.action.highlight ? `<span class="alert-rules-color-swatch" style="background:${escapeHtml(rule.action.highlight)}"></span>` : ''}
 </div>
 </div>
 `;
  }

  private renderEditForm(draft: AlertRule): string {
 const conditionsHtml = draft.conditions.map((c, ci) => `
 <div class="alert-rules-cond-row" data-cond-idx="${ci}">
 <select class="alert-rules-select" data-field="cond-field" data-cond-idx="${ci}">
 ${FIELD_OPTIONS.map((f) => `<option value="${f.value}"${c.field === f.value ? ' selected' : ''}>${escapeHtml(f.label)}</option>`).join('')}
 </select>
 <select class="alert-rules-select" data-field="cond-op" data-cond-idx="${ci}">
 ${OP_OPTIONS.map((o) => `<option value="${o.value}"${c.op === o.value ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
 </select>
 <input class="alert-rules-input" data-field="cond-value" data-cond-idx="${ci}" value="${escapeHtml(String(c.value))}" placeholder="value">
 ${draft.conditions.length > 1 ? `<button class="alert-rules-btn-sm alert-rules-btn-danger" data-action="remove-cond" data-cond-idx="${ci}">\u2715</button>` : ''}
 </div>
 `).join('');

 return `
 <div class="alert-rules-row alert-rules-row-editing" data-rule-id="${escapeHtml(draft.id)}">
 <div class="alert-rules-edit-section">
 <label class="alert-rules-edit-label">Name</label>
 <input class="alert-rules-input alert-rules-name-input" data-field="name" value="${escapeHtml(draft.name)}" placeholder="Rule name">
 </div>
 <div class="alert-rules-edit-section">
 <label class="alert-rules-edit-label">Conditions (AND)</label>
 ${conditionsHtml}
 <button class="alert-rules-btn alert-rules-btn-small" data-action="add-cond">+ Condition</button>
 </div>
 <div class="alert-rules-edit-section">
 <label class="alert-rules-edit-label">Action</label>
 <select class="alert-rules-select" data-field="notify">
 ${NOTIFY_OPTIONS.map((n) => `<option value="${n.value}"${draft.action.notify === n.value ? ' selected' : ''}>${escapeHtml(n.label)}</option>`).join('')}
 </select>
 <label class="alert-rules-inline-check"><input type="checkbox" data-field="autoPin" ${draft.action.autoPin ? 'checked' : ''}> Auto-pin</label>
 <label class="alert-rules-inline-check"><input type="checkbox" data-field="autoAcknowledge" ${draft.action.autoAcknowledge ? 'checked' : ''}> Auto-acknowledge</label>
 <label class="alert-rules-edit-label-sm">Highlight color</label>
 <input class="alert-rules-input alert-rules-color-input" data-field="highlight" value="${escapeHtml(draft.action.highlight ?? '')}" placeholder="#ff0 or empty">
 </div>
 <div class="alert-rules-edit-actions">
 <button class="alert-rules-btn alert-rules-btn-primary" data-action="save">Save</button>
 <button class="alert-rules-btn" data-action="cancel">Cancel</button>
 </div>
 </div>
 `;
  }

  // -----------------------------------------------------------------------
  // Event handling
  // -----------------------------------------------------------------------

  private handleClick(e: Event): void {
 const target = e.target as HTMLElement;
 const btn = target.closest<HTMLElement>('[data-action]');
 if (!btn) return;

 const action = btn.dataset.action;
 const ruleId = btn.dataset.ruleId;

 switch (action) {
 case 'add': { this.actionAdd(); break;
 }
 case 'edit': { this.actionEdit(ruleId); break;
 }
 case 'delete': { this.actionDelete(ruleId); break;
 }
 case 'move-up': { this.actionMove(ruleId, -1); break;
 }
 case 'move-down': {  this.actionMove(ruleId, 1); break;
 }
 case 'add-cond': { this.actionAddCond(); break;
 }
 case 'remove-cond': { this.actionRemoveCond(btn); break;
 }
 case 'save': { this.actionSave(); break;
 }
 case 'cancel': { this.actionCancel(); break;
 }
 }
  }

  private actionAdd(): void {
 const newRule = blankRule();
 this.rules.push(newRule);
 this.editingRuleId = newRule.id;
 this.editingDraft = { ...newRule, conditions: [...newRule.conditions] };
 this.render();
  }

  private actionEdit(ruleId: string | undefined): void {
 if (!ruleId) return;
 const rule = this.rules.find((r) => r.id === ruleId);
 if (!rule) return;
 this.editingRuleId = ruleId;
 this.editingDraft = {
 ...rule,
 conditions: rule.conditions.map((c) => ({ ...c })),
 action: { ...rule.action },
 };
 this.render();
  }

  private actionDelete(ruleId: string | undefined): void {
 if (!ruleId) return;
 this.rules = this.rules.filter((r) => r.id !== ruleId);
 if (this.editingRuleId === ruleId) {
 this.editingRuleId = null;
 this.editingDraft = null;
 }
 this.persist();
 this.render();
  }

  private actionMove(ruleId: string | undefined, direction: -1 | 1): void {
 if (!ruleId) return;
 const idx = this.rules.findIndex((r) => r.id === ruleId);
 const swapIdx = idx + direction;
 if (idx < 0 || swapIdx < 0 || swapIdx >= this.rules.length) return;
 const a = this.rules[idx]!;
 const b = this.rules[swapIdx]!;
 this.rules[idx] = b;
 this.rules[swapIdx] = a;
 this.persist();
 this.render();
  }

  private actionAddCond(): void {
 if (!this.editingDraft) return;
 this.editingDraft.conditions.push(blankCondition());
 this.render();
  }

  private actionRemoveCond(btn: HTMLElement): void {
 if (!this.editingDraft) return;
 const ci = Number(btn.dataset.condIdx);
 if (Number.isFinite(ci) && this.editingDraft.conditions.length > 1) {
 this.editingDraft.conditions.splice(ci, 1);
 this.render();
 }
  }

  private actionSave(): void {
 if (!this.editingDraft || !this.editingRuleId) return;
 this.syncDraftFromDom();
 const idx = this.rules.findIndex((r) => r.id === this.editingRuleId);
 if (idx !== -1) {
 this.rules[idx] = { ...this.editingDraft };
 }
 this.editingRuleId = null;
 this.editingDraft = null;
 this.persist();
 this.render();
  }

  private actionCancel(): void {
 // If this was a brand-new unsaved rule with blank name, remove it
 if (this.editingDraft && !this.editingDraft.name) {
 this.rules = this.rules.filter((r) => r.id !== this.editingRuleId);
 }
 this.editingRuleId = null;
 this.editingDraft = null;
 this.render();
  }

  private handleChange(e: Event): void {
 const target = e.target as HTMLInputElement | HTMLSelectElement;

 // Toggle enable/disable
 if (target.dataset.action === 'toggle' && target instanceof HTMLInputElement) {
 const ruleId = target.dataset.ruleId;
 const rule = this.rules.find((r) => r.id === ruleId);
 if (rule) {
 rule.enabled = target.checked;
 this.persist();
 this.render();
 }
 return;
 }

 // Preset selector
 if (target.dataset.action === 'preset-select' && target instanceof HTMLSelectElement) {
 const val = target.value;
 if (val === '') return;
 const presetIdx = Number(val);
 const preset = PRESET_TEMPLATES[presetIdx];
 if (!preset) return;
 // Append preset rules (with fresh IDs)
 for (const rule of preset.rules) {
 this.rules.push({ ...rule, id: uid(), createdAt: Date.now() });
 }
 this.persist();
 target.value = '';
 this.render();
 }
  }

  /**
 * Read current form values from the DOM into the editing draft.
 */
  private syncDraftFromDom(): void {
 if (!this.editingDraft) return;

 const row = this.content.querySelector<HTMLElement>(`.alert-rules-row-editing`);
 if (!row) return;

 // Name
 const nameInput = row.querySelector<HTMLInputElement>('[data-field="name"]');
 if (nameInput) this.editingDraft.name = nameInput.value.trim();

 // Conditions
 const condRows = row.querySelectorAll<HTMLElement>('.alert-rules-cond-row');
 condRows.forEach((cr, ci) => {
 const cond = this.editingDraft!.conditions[ci];
 if (!cond) return;
 const fieldSel = cr.querySelector<HTMLSelectElement>('[data-field="cond-field"]');
 const opSel = cr.querySelector<HTMLSelectElement>('[data-field="cond-op"]');
 const valInput = cr.querySelector<HTMLInputElement>('[data-field="cond-value"]');
 if (fieldSel) cond.field = fieldSel.value as AlertCondition['field'];
 if (opSel) cond.op = opSel.value as AlertCondition['op'];
 if (valInput) cond.value = valInput.value;
 });

 // Action
 const notifySel = row.querySelector<HTMLSelectElement>('[data-field="notify"]');
 if (notifySel) this.editingDraft.action.notify = notifySel.value as AlertAction['notify'];

 const pinCheck = row.querySelector<HTMLInputElement>('[data-field="autoPin"]');
 if (pinCheck) this.editingDraft.action.autoPin = pinCheck.checked;

 const ackCheck = row.querySelector<HTMLInputElement>('[data-field="autoAcknowledge"]');
 if (ackCheck) this.editingDraft.action.autoAcknowledge = ackCheck.checked;

 const highlightInput = row.querySelector<HTMLInputElement>('[data-field="highlight"]');
 if (highlightInput) {
 const val = highlightInput.value.trim();
 this.editingDraft.action.highlight = val || undefined;
 }
  }

  override destroy(): void {
 super.destroy();
  }
}
