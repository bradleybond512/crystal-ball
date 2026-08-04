import assert from 'node:assert/strict';
import test from 'node:test';

import {
  makeEvaluationReportTools,
  parseEvaluationWeek,
  schemas,
} from '../tools/evaluation-report.mjs';

const MONDAY = Date.UTC(2026, 6, 27);
const REPORT = Object.freeze({
  schemaVersion: 1,
  reportType: 'weekly_evaluation',
  period: { weekStart: MONDAY },
});

test('get returns the exact latest or selected compiler report', () => {
  const calls = [];
  const tools = makeEvaluationReportTools({
    storage: { marker: 'storage' },
    readWeeklyEvaluationReport(storage, options) {
      calls.push({ storage, options });
      return REPORT;
    },
  });

  assert.deepEqual(tools.get_weekly_evaluation_report(), {
    available: true,
    reasonCode: null,
    report: REPORT,
  });
  assert.deepEqual(tools.get_weekly_evaluation_report({ week: '2026-07-27' }), {
    available: true,
    reasonCode: null,
    report: REPORT,
  });
  assert.deepEqual(calls, [
    { storage: { marker: 'storage' }, options: undefined },
    { storage: { marker: 'storage' }, options: { weekStart: MONDAY } },
  ]);
});

test('get reports no data with closed reason codes', () => {
  const tools = makeEvaluationReportTools({
    storage: {},
    readWeeklyEvaluationReport: () => null,
  });

  assert.deepEqual(tools.get_weekly_evaluation_report(), {
    available: false,
    reasonCode: 'no_weekly_report',
    report: null,
  });
  assert.deepEqual(tools.get_weekly_evaluation_report({ week: '2026-07-27' }), {
    available: false,
    reasonCode: 'weekly_report_not_found',
    report: null,
  });
});

test('week validation accepts only exact UTC Mondays', () => {
  assert.equal(parseEvaluationWeek('2026-07-27'), MONDAY);
  assert.throws(() => parseEvaluationWeek('2026-07-28'), /Monday/i);
  assert.throws(() => parseEvaluationWeek('2026-7-27'), /YYYY-MM-DD/i);
  assert.throws(() => parseEvaluationWeek('2026-02-30'), /YYYY-MM-DD/i);
  assert.throws(() => parseEvaluationWeek('../2026-07-27'), /YYYY-MM-DD/i);
  assert.equal(schemas.get_weekly_evaluation_report.inputSchema.safeParse({
    week: '2026-07-28',
  }).success, false);
});

test('generate finalizes accumulated completed weeks without altering compiler output', () => {
  const generated = {
    available: true,
    reasonCode: null,
    finalizedReports: [REPORT],
    reports: [REPORT],
    accumulator: {
      initializedWeekStart: MONDAY,
      lastFinalizedWeekStart: MONDAY,
      omittedCatchupWeeks: 0,
      retainedWeeks: 0,
    },
  };
  const calls = [];
  const tools = makeEvaluationReportTools({
    storage: { marker: 'storage' },
    now: () => MONDAY + 7 * 24 * 60 * 60_000,
    generateWeeklyEvaluationReports(options) {
      calls.push(options);
      return generated;
    },
  });

  assert.equal(tools.generate_weekly_evaluation_report(), generated);
  assert.deepEqual(calls, [{
    storage: { marker: 'storage' },
    at: MONDAY + 7 * 24 * 60 * 60_000,
  }]);
  assert.equal(schemas.generate_weekly_evaluation_report.inputSchema.safeParse({ at: 1 }).success, false);
});
