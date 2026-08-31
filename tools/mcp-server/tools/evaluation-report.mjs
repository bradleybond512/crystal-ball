import { z } from 'zod';

import {
  generateWeeklyEvaluationReports as generateWeeklyEvaluationReportsDefault,
  readWeeklyEvaluationReport as readWeeklyEvaluationReportDefault,
  readWeeklyProviderStatus as readWeeklyProviderStatusDefault,
} from '../weekly-evaluation-report.mjs';

const WEEK = /^\d{4}-\d{2}-\d{2}$/;

const weekSchema = z.string().refine((value) => {
  try {
    parseEvaluationWeek(value);
    return true;
  } catch {
    return false;
  }
}, 'Week must be a valid YYYY-MM-DD UTC Monday.');

export const schemas = {
  get_weekly_evaluation_report: {
    description: 'Read the latest completed weekly evaluation report, or select one by its UTC Monday start date.',
    inputSchema: z.object({
      week: weekSchema.optional().describe('UTC Monday week start in YYYY-MM-DD format.'),
    }).strict(),
  },
  generate_weekly_evaluation_report: {
    description: 'Finalize accumulated completed UTC weeks into immutable local evaluation reports without contacting providers.',
    inputSchema: z.object({}).strict(),
  },
};

export function parseEvaluationWeek(value) {
  if (typeof value !== 'string' || !WEEK.test(value)) {
    throw new Error('Evaluation week must use YYYY-MM-DD format.');
  }
  const [year, month, day] = value.split('-').map(Number);
  const weekStart = Date.UTC(year, month - 1, day);
  if (new Date(weekStart).toISOString().slice(0, 10) !== value) {
    throw new Error('Evaluation week must be a valid YYYY-MM-DD date.');
  }
  if (new Date(weekStart).getUTCDay() !== 1) {
    throw new Error('Evaluation week must start on a UTC Monday.');
  }
  return weekStart;
}

export function makeEvaluationReportTools({
  storage,
  now = Date.now,
  readWeeklyEvaluationReport = readWeeklyEvaluationReportDefault,
  readWeeklyProviderStatus = readWeeklyProviderStatusDefault,
  generateWeeklyEvaluationReports = generateWeeklyEvaluationReportsDefault,
} = {}) {
  function get_weekly_evaluation_report(args = {}) {
    const weekStart = args.week === undefined ? undefined : parseEvaluationWeek(args.week);
    const report = weekStart === undefined
      ? readWeeklyEvaluationReport(storage)
      : readWeeklyEvaluationReport(storage, { weekStart });
    if (report === null) {
      return {
          available: false,
          reasonCode: weekStart === undefined ? 'no_weekly_report' : 'weekly_report_not_found',
          report: null,
      };
    }
    const providerStatus = readWeeklyProviderStatus(storage, report.period.weekStart);
    return {
      available: true,
      reasonCode: null,
      report,
      ...(providerStatus === null ? {} : { providerStatus }),
    };
  }

  function generate_weekly_evaluation_report() {
    return generateWeeklyEvaluationReports({ storage, at: now() });
  }

  return { get_weekly_evaluation_report, generate_weekly_evaluation_report };
}
