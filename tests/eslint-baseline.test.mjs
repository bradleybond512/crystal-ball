import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareLintCounts,
  summarizeLintResults,
} from '../scripts/lint-baseline.mjs';

test('summarizes lint findings by file, severity, and rule', () => {
  const summary = summarizeLintResults([
    {
      filePath: '/repo/src/a.ts',
      messages: [
        { ruleId: 'rule-a', severity: 2, fatal: false, message: 'first' },
        { ruleId: 'rule-a', severity: 2, fatal: false, message: 'second' },
        { ruleId: 'rule-b', severity: 1, fatal: false, message: 'warning' },
      ],
    },
  ], '/repo');

  assert.deepEqual(summary.counts, {
    'src/a.ts': {
      'error:rule-a': 2,
      'warning:rule-b': 1,
    },
  });
  assert.deepEqual(summary.fatalMessages, []);
});

test('reports fatal parser failures separately from the baseline', () => {
  const summary = summarizeLintResults([
    {
      filePath: '/repo/src/bad.ts',
      messages: [
        { ruleId: null, severity: 2, fatal: true, message: 'Parsing error' },
      ],
    },
  ], '/repo');

  assert.deepEqual(summary.counts, {});
  assert.deepEqual(summary.fatalMessages, [
    { file: 'src/bad.ts', message: 'Parsing error' },
  ]);
});

test('ratchet rejects new findings while allowing equal or lower counts', () => {
  const baseline = {
    'src/a.ts': { 'error:rule-a': 2, 'warning:rule-b': 1 },
  };
  const current = {
    'src/a.ts': { 'error:rule-a': 1, 'warning:rule-b': 2 },
    'src/new.ts': { 'error:rule-c': 1 },
  };

  assert.deepEqual(compareLintCounts(current, baseline), [
    {
      file: 'src/a.ts',
      key: 'warning:rule-b',
      baseline: 1,
      current: 2,
    },
    {
      file: 'src/new.ts',
      key: 'error:rule-c',
      baseline: 0,
      current: 1,
    },
  ]);
});
