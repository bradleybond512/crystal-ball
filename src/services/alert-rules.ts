/**
 * Alert Rules Engine
 *
 * Lets users define condition→action rules that are evaluated against incoming
 * UnifiedAlert items. Rules are stored in localStorage and evaluated in order;
 * the first matching rule wins.
 */

import type { UnifiedAlert, AlertSeverity } from './unified-alerts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AlertCondition {
  field: 'source' | 'severity' | 'distance' | 'title' | 'category';
  op: 'eq' | 'neq' | 'gte' | 'lte' | 'contains' | 'matches';
  value: string | number;
}

export interface AlertAction {
  notify: 'sound+banner' | 'banner' | 'badge' | 'silent' | 'suppress';
  highlight?: string;
  autoPin?: boolean;
  autoAcknowledge?: boolean;
}

export interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  conditions: AlertCondition[];  // AND logic
  action: AlertAction;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'wm-alert-rules-v1';

export function loadRules(): AlertRule[] {
  try {
 const raw = localStorage.getItem(STORAGE_KEY);
 if (!raw) return [];
 const parsed: unknown = JSON.parse(raw);
 if (!Array.isArray(parsed)) return [];
 return parsed as AlertRule[];
  } catch {
 return [];
  }
}

export function saveRules(rules: AlertRule[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
}

// ---------------------------------------------------------------------------
// Severity comparison helpers
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  info: 1,
  low: 2,
  medium: 3,
  high: 4,
  critical: 5,
};

function severityToRank(sev: string): number {
  return SEVERITY_RANK[sev as AlertSeverity] ?? 0;
}

// ---------------------------------------------------------------------------
// Condition matching
// ---------------------------------------------------------------------------

/**
 * Extract a comparable value from an alert for a given field name.
 * `category` is not a first-class field on UnifiedAlert, so we derive it from
 * the source string (the closest available proxy).
 */
function fieldValue(alert: UnifiedAlert, field: AlertCondition['field']): string {
  switch (field) {
 case 'source': { return alert.source;
 }
 case 'severity': { return alert.severity;
 }
 case 'title': { return alert.title;
 }
 case 'distance': { return String(alert.distanceKm ?? -1);
 }
 case 'category': { return alert.source;
 } // proxy — rules can match source strings
  }
}

function matchNumeric(raw: string, cond: AlertCondition): boolean {
  if (cond.field === 'severity') {
 const numericValue = severityToRank(String(raw));
 const threshold = typeof cond.value === 'number' ? cond.value : severityToRank(String(cond.value));
 return cond.op === 'gte' ? numericValue >= threshold : numericValue <= threshold;
  }

  const numericValue = Number(raw);
  if (!Number.isFinite(numericValue)) return false;

  const threshold = typeof cond.value === 'number' ? cond.value : Number(cond.value);
  if (!Number.isFinite(threshold)) return false;

  return cond.op === 'gte' ? numericValue >= threshold : numericValue <= threshold;
}

function matchString(strVal: string, condVal: string, op: AlertCondition['op'], rawCondValue: string | number): boolean {
  switch (op) {
 case 'eq': { return strVal === condVal;
 }
 case 'neq': { return strVal !== condVal;
 }
 case 'contains': {
 const parts = condVal.split('|').map(s => s.trim()).filter(Boolean);
 return parts.some(part => strVal.includes(part));
 }
 case 'matches': {
 try { return new RegExp(String(rawCondValue), 'i').test(strVal); }
 catch { return false; }
 }
 default: {
 return false;
 }
  }
}

export function matchesCondition(alert: UnifiedAlert, cond: AlertCondition): boolean {
  const raw = fieldValue(alert, cond.field);

  if (cond.op === 'gte' || cond.op === 'lte') {
 return matchNumeric(raw, cond);
  }

  return matchString(String(raw).toLowerCase(), String(cond.value).toLowerCase(), cond.op, cond.value);
}

// ---------------------------------------------------------------------------
// Rule evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate all enabled rules against an alert. Returns the action from the
 * first rule whose every condition matches, or null if none match.
 */
export function evaluateRules(alert: UnifiedAlert, rules: AlertRule[]): AlertAction | null {
  for (const rule of rules) {
 if (!rule.enabled) continue;
 if (rule.conditions.length === 0) continue;
 const allMatch = rule.conditions.every(c => matchesCondition(alert, c));
 if (allMatch) return rule.action;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Preset templates
// ---------------------------------------------------------------------------

let _idCounter = 0;
function uid(): string {
  _idCounter += 1;
  return `rule-${Date.now()}-${_idCounter}`;
}

export const PRESET_TEMPLATES: { label: string; rules: AlertRule[] }[] = [
  {
 label: 'Earthquake Watcher',
 rules: [{
 id: uid(), name: 'Earthquake Watcher', enabled: true,
 conditions: [
 { field: 'source', op: 'eq', value: 'gdacs' },
 { field: 'severity', op: 'gte', value: 'high' },
 ],
 action: { notify: 'sound+banner' },
 createdAt: Date.now(),
 }],
  },
  {
 label: 'Storm Chaser',
 rules: [{
 id: uid(), name: 'Storm Chaser', enabled: true,
 conditions: [
 { field: 'source', op: 'eq', value: 'nws' },
 { field: 'title', op: 'contains', value: 'tornado|hurricane|severe' },
 ],
 action: { notify: 'sound+banner' },
 createdAt: Date.now(),
 }],
  },
  {
 label: 'Conflict Monitor',
 rules: [{
 id: uid(), name: 'Conflict Monitor', enabled: true,
 conditions: [
 { field: 'source', op: 'contains', value: 'correlation|breaking-news' },
 { field: 'category', op: 'contains', value: 'conflict|military|war' },
 ],
 action: { notify: 'banner', autoPin: true },
 createdAt: Date.now(),
 }],
  },
  {
 label: 'Financial Alert',
 rules: [{
 id: uid(), name: 'Financial Alert', enabled: true,
 conditions: [
 { field: 'source', op: 'eq', value: 'correlation' },
 { field: 'category', op: 'contains', value: 'market|economic|finance' },
 ],
 action: { notify: 'badge' },
 createdAt: Date.now(),
 }],
  },
  {
 label: 'Cyber Sentinel',
 rules: [{
 id: uid(), name: 'Cyber Sentinel', enabled: true,
 conditions: [
 { field: 'source', op: 'eq', value: 'cyber' },
 { field: 'severity', op: 'gte', value: 'medium' },
 ],
 action: { notify: 'banner', autoPin: true },
 createdAt: Date.now(),
 }],
  },
];
