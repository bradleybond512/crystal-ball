/**
 * User-defined correlation rules — persisted to localStorage,
 * injected into the correlator alongside built-in rules.
 */

import type { AlertSource } from './unified-alerts';

export interface CustomCausalRule {
  id: string;
  cause: AlertSource;
  effect: AlertSource;
  maxLagMs: number;
  radiusKm: number;
  label: string;
  enabled: boolean;
}

const STORAGE_KEY = 'crystalball-custom-corr-rules-v1';

let rules: CustomCausalRule[] = [];

function load(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) rules = JSON.parse(raw) as CustomCausalRule[];
  } catch { /* noop */ }
}

function save(): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rules)); } catch { /* noop */ }
}

export function getCustomRules(): CustomCausalRule[] {
  return [...rules];
}

export function getEnabledCustomRules(): CustomCausalRule[] {
  return rules.filter(r => r.enabled);
}

export function addCustomRule(rule: Omit<CustomCausalRule, 'id' | 'enabled'>): CustomCausalRule {
  const newRule: CustomCausalRule = { ...rule, id: `custom-${Date.now()}`, enabled: true };
  rules.push(newRule);
  save();
  return newRule;
}

export function removeCustomRule(id: string): void {
  rules = rules.filter(r => r.id !== id);
  save();
}

export function toggleCustomRule(id: string): void {
  const rule = rules.find(r => r.id === id);
  if (rule) { rule.enabled = !rule.enabled; save(); }
}

export function initCustomCorrelationRules(): void {
  load();
}
