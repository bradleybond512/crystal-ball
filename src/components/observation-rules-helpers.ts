/**
 * Pure helpers for ObservationRulesPanel. Lives in its own file so tests
 * can import without dragging in i18n (Vite's import.meta.glob).
 */

import type {
  AlertRule,
  RuleAction,
  RuleCondition,
  RuleConditionField,
  RuleConditionOperator,
} from '@/types/intelligence';

export const FIELD_OPTIONS: { id: RuleConditionField; label: string }[] = [
  { id: 'domain', label: 'Domain' },
  { id: 'severity', label: 'Severity' },
  { id: 'location', label: 'Location' },
  { id: 'keyword', label: 'Keyword' },
  { id: 'magnitude', label: 'Magnitude' },
  { id: 'containment', label: 'Containment %' },
];

export const OPERATOR_OPTIONS: { id: RuleConditionOperator; label: string }[] = [
  { id: 'equals', label: 'equals' },
  { id: 'contains', label: 'contains' },
  { id: 'gt', label: '>' },
  { id: 'lt', label: '<' },
  { id: 'near', label: 'within' },
];

export const ACTION_LABEL: Record<RuleAction['type'], string> = {
  notify: 'Notify',
  escalate: 'Escalate',
  log: 'Log',
};

/** Operators that make sense per field — used to gate the dropdown so the
 *  user can't pick a nonsensical combo like `magnitude near`. */
export const OPERATORS_FOR_FIELD: Record<RuleConditionField, RuleConditionOperator[]> = {
  domain:      ['equals', 'contains'],
  keyword:     ['equals', 'contains'],
  severity:    ['equals', 'gt', 'lt'],
  magnitude:   ['equals', 'gt', 'lt'],
  containment: ['equals', 'gt', 'lt'],
  location:    ['near'],
};

/** Built-in starter rules surfaced in the empty-state CTA. */
export const PRESET_RULES: { name: string; description: string;
  conditions: RuleCondition[]; conditionOperator: 'AND' | 'OR'; actions: RuleAction[] }[] = [
  {
    name: 'Earthquake M5+ near saved places',
    description: 'Notify on any natural-hazard observation with magnitude ≥ 5 within 200 km of (41.6, -86.7).',
    conditionOperator: 'AND',
    conditions: [
      { field: 'domain', operator: 'equals', value: 'natural' },
      { field: 'magnitude', operator: 'gt', value: 5 },
      { field: 'location', operator: 'near', value: '41.6,-86.7', radiusKm: 200 },
    ],
    actions: [{ type: 'notify', channel: 'push' }],
  },
  {
    name: 'Wildfire HIGH within 100 km',
    description: 'Escalate any HIGH-severity wildfire observation within 100 km of home.',
    conditionOperator: 'AND',
    conditions: [
      { field: 'keyword', operator: 'contains', value: 'wildfire' },
      { field: 'severity', operator: 'equals', value: 'HIGH' },
      { field: 'location', operator: 'near', value: '41.6,-86.7', radiusKm: 100 },
    ],
    actions: [{ type: 'escalate', channel: 'push' }, { type: 'log' }],
  },
  {
    name: 'CRITICAL anything, anywhere',
    description: 'Log every CRITICAL observation — useful as a tripwire while tuning other rules.',
    conditionOperator: 'AND',
    conditions: [{ field: 'severity', operator: 'equals', value: 'CRITICAL' }],
    actions: [{ type: 'log' }],
  },
];

export function formatLastTriggered(rule: AlertRule, now = Date.now()): string {
  if (!rule.lastTriggered) return 'never';
  const ageMs = now - rule.lastTriggered;
  if (ageMs < 0) return 'just now';
  if (ageMs < 60_000) return `${Math.floor(ageMs / 1000)}s ago`;
  if (ageMs < 60 * 60_000) return `${Math.floor(ageMs / 60_000)}m ago`;
  if (ageMs < 24 * 60 * 60_000) return `${Math.floor(ageMs / (60 * 60_000))}h ago`;
  return `${Math.floor(ageMs / (24 * 60 * 60_000))}d ago`;
}

export function summarizeCondition(c: RuleCondition): string {
  const op = OPERATOR_OPTIONS.find((o) => o.id === c.operator)?.label ?? c.operator;
  if (c.operator === 'near') {
    return `location within ${c.radiusKm ?? '?'} km of ${c.value}`;
  }
  return `${c.field} ${op} ${c.value}`;
}

export function summarizeRule(rule: AlertRule): string {
  if (rule.conditions.length === 0) return '(no conditions)';
  const join = rule.conditionOperator === 'OR' ? ' OR ' : ' AND ';
  return rule.conditions.map((c) => summarizeCondition(c)).join(join);
}

/** True when the rule is structurally complete enough to evaluate. */
export function isRuleComplete(rule: Pick<AlertRule, 'name' | 'conditions' | 'actions'>): boolean {
  if (!rule.name.trim()) return false;
  if (rule.conditions.length === 0) return false;
  if (rule.actions.length === 0) return false;
  return rule.conditions.every((c) => {
    if (typeof c.value === 'string' && c.value.trim().length === 0) return false;
    if (c.operator === 'near' && (!c.radiusKm || c.radiusKm <= 0)) return false;
    return true;
  });
}
