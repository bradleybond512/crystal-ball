import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FIELD_OPTIONS,
  OPERATORS_FOR_FIELD,
  OPERATOR_OPTIONS,
  PRESET_RULES,
  formatLastTriggered,
  isRuleComplete,
  summarizeCondition,
  summarizeRule,
} from '../observation-rules-helpers.ts';
import type { AlertRule, RuleCondition } from '@/types/intelligence';

const NOW = Date.parse('2026-05-11T12:00:00Z');

function rule(over: Partial<AlertRule> = {}): AlertRule {
  return {
    id: over.id ?? 'rule-1',
    name: over.name ?? 'r',
    enabled: over.enabled ?? true,
    conditions: over.conditions ?? [{ field: 'domain', operator: 'equals', value: 'natural' }],
    conditionOperator: over.conditionOperator ?? 'AND',
    actions: over.actions ?? [{ type: 'notify' }],
    created: over.created ?? NOW,
    lastTriggered: over.lastTriggered,
    triggerCount: over.triggerCount ?? 0,
  };
}

test('FIELD_OPTIONS / OPERATOR_OPTIONS expose all spec-mandated values', () => {
  assert.deepEqual(FIELD_OPTIONS.map((f) => f.id),
    ['domain', 'severity', 'location', 'keyword', 'magnitude', 'containment']);
  assert.deepEqual(OPERATOR_OPTIONS.map((o) => o.id),
    ['equals', 'contains', 'gt', 'lt', 'near']);
});

test('OPERATORS_FOR_FIELD restricts each field to sensible operators', () => {
  assert.deepEqual(OPERATORS_FOR_FIELD.location, ['near']);
  assert.deepEqual(OPERATORS_FOR_FIELD.magnitude, ['equals', 'gt', 'lt']);
  assert.deepEqual(OPERATORS_FOR_FIELD.domain, ['equals', 'contains']);
});

test('PRESET_RULES ships the three starter scenarios from the spec', () => {
  assert.equal(PRESET_RULES.length, 3);
  assert.match(PRESET_RULES[0]!.name, /Earthquake M5/);
  assert.match(PRESET_RULES[1]!.name, /Wildfire HIGH/);
  assert.match(PRESET_RULES[2]!.name, /CRITICAL/);
});

test('formatLastTriggered: never / seconds / minutes / hours / days ladder', () => {
  assert.equal(formatLastTriggered(rule(), NOW), 'never');
  assert.equal(formatLastTriggered(rule({ lastTriggered: NOW - 5_000 }), NOW), '5s ago');
  assert.equal(formatLastTriggered(rule({ lastTriggered: NOW - 5 * 60_000 }), NOW), '5m ago');
  assert.equal(formatLastTriggered(rule({ lastTriggered: NOW - 3 * 60 * 60_000 }), NOW), '3h ago');
  assert.equal(formatLastTriggered(rule({ lastTriggered: NOW - 2 * 24 * 60 * 60_000 }), NOW), '2d ago');
});

test('summarizeCondition: special-cases near, falls back to "field op value"', () => {
  const near: RuleCondition = { field: 'location', operator: 'near',
    value: '41.6,-86.7', radiusKm: 100 };
  assert.match(summarizeCondition(near), /within 100 km of 41\.6,-86\.7/);
  const mag: RuleCondition = { field: 'magnitude', operator: 'gt', value: 5 };
  assert.match(summarizeCondition(mag), /magnitude > 5/);
});

test('summarizeRule: joins multiple conditions with AND / OR', () => {
  const r = rule({
    conditionOperator: 'OR',
    conditions: [
      { field: 'severity', operator: 'equals', value: 'CRITICAL' },
      { field: 'magnitude', operator: 'gt', value: 6 },
    ],
  });
  assert.match(summarizeRule(r), /severity equals CRITICAL OR magnitude > 6/);
});

test('summarizeRule: handles zero-condition input gracefully', () => {
  assert.equal(summarizeRule(rule({ conditions: [] })), '(no conditions)');
});

test('isRuleComplete: rejects empty name / empty conditions / empty actions', () => {
  assert.equal(isRuleComplete(rule({ name: '' })), false);
  assert.equal(isRuleComplete(rule({ conditions: [] })), false);
  assert.equal(isRuleComplete(rule({ actions: [] })), false);
  assert.equal(isRuleComplete(rule()), true);
});

test('isRuleComplete: near operator must have a positive radiusKm', () => {
  const r = rule({
    conditions: [{ field: 'location', operator: 'near', value: '0,0' /* no radius */ }],
  });
  assert.equal(isRuleComplete(r), false);
  const r2 = rule({
    conditions: [{ field: 'location', operator: 'near', value: '0,0', radiusKm: 50 }],
  });
  assert.equal(isRuleComplete(r2), true);
});

test('isRuleComplete: string condition value cannot be blank whitespace', () => {
  const r = rule({
    conditions: [{ field: 'keyword', operator: 'contains', value: '   ' }],
  });
  assert.equal(isRuleComplete(r), false);
});
