/* eslint-disable sonarjs/function-return-type */
/**
 * User-defined Alert Rules Engine
 *
 * Lets users configure IF/THEN rules that override default notification behavior.
 * Rules are stored in localStorage and evaluated for every incoming UnifiedAlert.
 *
 * Quiet-hours config is owned by notification-dispatcher.ts under the
 * localStorage key `wm-quiet-hours` — this module does not duplicate it.
 */

import type { UnifiedAlert, AlertSource, AlertSeverity } from './unified-alerts';
import { computeDistanceKm } from './unified-alerts';
import type { NotificationAction } from './notification-dispatcher';

const STORAGE_KEY = 'cb-alert-rules';
/** Quiet-hours config is read by notification-dispatcher.ts; referenced here for discoverability. */
export const QUIET_HOURS_KEY = 'wm-quiet-hours';

export type RuleOperator = 'equals' | 'contains' | 'gte' | 'lte' | 'in' | 'within-km';

export interface RuleCondition {
  field: 'source' | 'severity' | 'title' | 'body' | 'distanceKm' | 'category';
  operator: RuleOperator;
  value: string | number | string[];
}

export type RuleAction = NotificationAction | 'suppress' | 'boost';

export interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  conditions: RuleCondition[]; // AND-joined
  action: RuleAction;
  priority: number; // higher = evaluated first
}

// Severity ordering for gte/lte comparisons.
const SEVERITY_RANK: Record<AlertSeverity, number> = {
  info: 0, low: 1, medium: 2, high: 3, critical: 4,
};

// ── Storage ─────────────────────────────────────────────────────────────

/** Structural guard for a single deserialized AlertRule. */
function isValidAlertRule(r: unknown): r is AlertRule {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
  const rule = r as Record<string, unknown>;
  return (
    typeof rule.id === 'string' && rule.id.length > 0 &&
    typeof rule.name === 'string' &&
    typeof rule.enabled === 'boolean' &&
    Array.isArray(rule.conditions) &&
    typeof rule.action === 'string' &&
    typeof rule.priority === 'number'
  );
}

/** Read all rules from localStorage. Returns empty array on error or no rules. */
export function getAlertRules(): AlertRule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r) => isValidAlertRule(r));
  } catch {
    return [];
  }
}

/** Persist rules array to localStorage. */
function writeRules(rules: AlertRule[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  } catch { /* storage full — silently drop */ }
}

/** Insert or update a rule by id. */
export function saveAlertRule(rule: AlertRule): void {
  const rules = getAlertRules();
  const idx = rules.findIndex(r => r.id === rule.id);
  if (idx === -1) {rules.push(rule);}
  else {rules[idx] = rule;}
  writeRules(rules);
}

/** Remove a rule by id. */
export function deleteAlertRule(id: string): void {
  writeRules(getAlertRules().filter(r => r.id !== id));
}

// ── Condition evaluation ────────────────────────────────────────────────

/** Extract the field value from an alert for condition comparison. */
function fieldValue(
  alert: UnifiedAlert,
  field: RuleCondition['field'],
  userLocation?: { lat: number; lon: number },
): string | number | undefined {
  switch (field) {
    case 'source': { return alert.source;
    }
    case 'severity': { return alert.severity;
    }
    case 'title': { return alert.title;
    }
    case 'body': { return alert.body;
    }
    case 'category': { return alert.source;
    } // alias — AlertSource is our category taxonomy
    case 'distanceKm': {
      if (typeof alert.distanceKm === 'number') return alert.distanceKm;
      if (userLocation && alert.location) {
        return computeDistanceKm(userLocation.lat, userLocation.lon, alert.location.lat, alert.location.lon);
      }
      return undefined;
    }
  }
}

/** Evaluate a single condition against an alert. */
function evalCondition(
  alert: UnifiedAlert,
  cond: RuleCondition,
  userLocation?: { lat: number; lon: number },
): boolean {
  const fv = fieldValue(alert, cond.field, userLocation);
  if (fv === undefined) return false;
  switch (cond.operator) {
    case 'equals': {
      return String(fv).toLowerCase() === String(cond.value).toLowerCase();
    }
    case 'contains': {
      return typeof fv === 'string' && fv.toLowerCase().includes(String(cond.value).toLowerCase());
    }
    case 'gte': {
      if (cond.field === 'severity') {
        return SEVERITY_RANK[fv as AlertSeverity] >= SEVERITY_RANK[cond.value as AlertSeverity];
      }
      return typeof fv === 'number' && fv >= Number(cond.value);
    }
    case 'lte': {
      if (cond.field === 'severity') {
        return SEVERITY_RANK[fv as AlertSeverity] <= SEVERITY_RANK[cond.value as AlertSeverity];
      }
      return typeof fv === 'number' && fv <= Number(cond.value);
    }
    case 'in': {
      return Array.isArray(cond.value) && cond.value.map(String).includes(String(fv));
    }
    case 'within-km': {
      return typeof fv === 'number' && fv <= Number(cond.value);
    }
  }
}

/**
 * Find the first matching enabled rule (highest priority first).
 * Returns `{ action: null }` if no rule matches.
 */
export function evaluateRules(
  alert: UnifiedAlert,
  userLocation?: { lat: number; lon: number },
): { action: RuleAction | null; matchedRule?: AlertRule } {
  const rules = getAlertRules()
    .filter(r => r.enabled)
    .sort((a, b) => b.priority - a.priority);
  for (const rule of rules) {
    if (rule.conditions.every(c => evalCondition(alert, c, userLocation))) {
      return { action: rule.action, matchedRule: rule };
    }
  }
  return { action: null };
}

// ── Presets ─────────────────────────────────────────────────────────────

const CONFLICT_SOURCES: AlertSource[] = ['oref', 'gdacs', 'correlation'];

export const PRESET_RULES: AlertRule[] = [
  {
    id: 'preset:earthquake-watcher',
    name: 'Earthquake Watcher',
    enabled: true,
    priority: 100,
    action: 'sound+banner',
    conditions: [
      { field: 'source', operator: 'equals', value: 'earthquake' },
      { field: 'severity', operator: 'gte', value: 'high' },
    ],
  },
  {
    id: 'preset:storm-chaser',
    name: 'Storm Chaser',
    enabled: true,
    priority: 90,
    action: 'sound+banner',
    conditions: [
      { field: 'source', operator: 'equals', value: 'nws' },
      { field: 'title', operator: 'contains', value: 'tornado' },
      { field: 'distanceKm', operator: 'within-km', value: 100 },
    ],
  },
  {
    id: 'preset:conflict-monitor',
    name: 'Conflict Monitor',
    enabled: true,
    priority: 80,
    action: 'banner',
    conditions: [
      { field: 'source', operator: 'in', value: CONFLICT_SOURCES as unknown as string[] },
      { field: 'severity', operator: 'gte', value: 'high' },
    ],
  },
  {
    id: 'preset:financial-alert',
    name: 'Financial Alert',
    enabled: true,
    priority: 70,
    action: 'banner',
    conditions: [
      { field: 'body', operator: 'contains', value: 'depeg' },
    ],
  },
  {
    id: 'preset:financial-alert-crash',
    name: 'Financial Alert (Market Crash)',
    enabled: true,
    priority: 70,
    action: 'banner',
    conditions: [
      { field: 'body', operator: 'contains', value: 'market crash' },
    ],
  },
];

/** Clone a preset into user rules (gives it a fresh id so users can edit without losing the template). */
export function applyPreset(presetId: string): void {
  const preset = PRESET_RULES.find(p => p.id === presetId);
  if (!preset) return;
  const clone: AlertRule = {
    ...preset,
    id: `user:${presetId.replace(/^preset:/, '')}:${Date.now()}`,
    conditions: preset.conditions.map(c => ({ ...c })),
  };
  saveAlertRule(clone);
}
