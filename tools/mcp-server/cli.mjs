#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

import {
  buildAgentDoctorReport,
  DOCTOR_EXIT,
  formatDoctorReport,
  readLocalMonitorStatus,
} from './doctor.mjs';
import { buildEvidencePacket, writeEvidencePacket } from './evidence-packet.mjs';
import { createStorage } from './storage.mjs';
import { makeEvaluationReportTools, parseEvaluationWeek } from './tools/evaluation-report.mjs';
import { runSafeguardDemo } from './safeguard-demo.mjs';
import { COMPATIBILITY } from './server-meta.mjs';
import { TOOL_CATALOG } from './tool-registry.mjs';

const HELP = `Crystal Ball agent access

Usage: crystalball <command> [options]

Commands:
  doctor [--json]                 Check install, runtime, clients, monitor, and compatibility
  capabilities [--json]           List tools and their plain-language permissions
  monitor [--json]                Read the latest local safety-monitor status
  evaluation-report [--json] [--week YYYY-MM-DD] [--generate]
                                   Read or finalize completed UTC weekly evaluations
  safeguard-demo [--json]         Run a synthetic read-only boundary demonstration
  evidence --input FILE --output FILE [--json]
                                   Export a redacted Evidence Packet v1
  help                             Show this help
`;

const [command = 'help', ...args] = process.argv.slice(2);
const json = args.includes('--json');

try {
  if (command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(HELP);
  } else if (command === 'doctor') {
    const report = await buildAgentDoctorReport();
    output(report, json, formatDoctorReport(report));
    process.exitCode = report.exitCode;
  } else if (command === 'capabilities') {
    const report = {
      compatibility: COMPATIBILITY,
      tools: Object.entries(TOOL_CATALOG).map(([name, metadata]) => ({
        name,
        category: metadata.category,
        description: metadata.description,
        permission: metadata.permission,
      })),
    };
    output(report, json, `${report.tools.length} tools. Use --json for the complete permission reference.\n`);
  } else if (command === 'monitor') {
    const state = await readLocalMonitorStatus();
    output(state, json, `${state.status ?? 'unknown'}: ${state.summary ?? ''}\n`);
    process.exitCode = state.available
      && state.status === 'green'
      && state.schedule?.status === 'running'
      ? DOCTOR_EXIT.READY
      : DOCTOR_EXIT.DEGRADED;
  } else if (command === 'evaluation-report') {
    const options = evaluationReportOptions(args);
    const tools = makeEvaluationReportTools({ storage: createStorage() });
    const generated = options.generate
      ? tools.generate_weekly_evaluation_report()
      : null;
    const result = options.week || !options.generate
      ? tools.get_weekly_evaluation_report(options.week ? { week: options.week } : {})
      : generated;
    output(result, options.json, formatEvaluationReport(result, options.generate));
    process.exitCode = result.available ? DOCTOR_EXIT.READY : DOCTOR_EXIT.UNAVAILABLE;
  } else if (command === 'safeguard-demo') {
    const report = runSafeguardDemo();
    output(report, json, `${report.passed ? 'PASS' : 'FAIL'}: ${report.summary}\n`);
    process.exitCode = report.passed ? 0 : DOCTOR_EXIT.UNAVAILABLE;
  } else if (command === 'evidence') {
    const inputPath = optionValue(args, '--input');
    const outputPath = optionValue(args, '--output');
    if (!inputPath || !outputPath) usageError('evidence requires --input FILE and --output FILE.');
    const input = JSON.parse(await readFile(inputPath, 'utf8'));
    const packet = buildEvidencePacket(input);
    await writeEvidencePacket(outputPath, packet);
    output(packet, json, `Wrote Evidence Packet v1 to ${outputPath}.\n`);
  } else {
    usageError(`Unknown command: ${command}`);
  }
} catch (error) {
  if (error?.usage) {
    process.stderr.write(`${error.message}\n${HELP}`);
    process.exitCode = DOCTOR_EXIT.USAGE;
  } else {
    process.stderr.write(`Crystal Ball command failed: ${safeError(error)}\n`);
    process.exitCode = DOCTOR_EXIT.UNAVAILABLE;
  }
}

function output(value, asJson, human) {
  process.stdout.write(asJson ? `${JSON.stringify(value, null, 2)}\n` : human);
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1] ?? null;
}

function evaluationReportOptions(args) {
  const result = { json: false, generate: false, week: null };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      if (result.json) usageError('evaluation-report accepts --json only once.');
      result.json = true;
      continue;
    }
    if (arg === '--generate') {
      if (result.generate) usageError('evaluation-report accepts --generate only once.');
      result.generate = true;
      continue;
    }
    if (arg === '--week') {
      if (result.week !== null) usageError('evaluation-report accepts --week only once.');
      const value = args[index + 1];
      if (!value || value.startsWith('--')) usageError('evaluation-report requires a value after --week.');
      try {
        parseEvaluationWeek(value);
      } catch (error) {
        usageError(error.message);
      }
      result.week = value;
      index += 1;
      continue;
    }
    usageError(`Unknown evaluation-report option: ${arg}`);
  }
  return result;
}

function formatEvaluationReport(result, generated) {
  if (!result.available) {
    return `Weekly evaluation unavailable (${result.reasonCode}).\n`;
  }
  if (generated && Array.isArray(result.reports)) {
    return `Weekly evaluation generation complete: ${result.finalizedReports.length} finalized; ${result.reports.length} report(s) available.\n`;
  }
  const report = result.report;
  const week = new Date(report.period.weekStart).toISOString().slice(0, 10);
  return [
    `Weekly evaluation ${week} UTC: ${report.availability}`,
    `Observations: ${report.coverage.observations} (${report.coverage.fresh} fresh)`,
    `Next recommendation: ${report.nextRecommendedTask.code}`,
    '',
  ].join('\n');
}

function usageError(message) {
  const error = new Error(message);
  error.usage = true;
  throw error;
}

function safeError(error) {
  return String(error?.message ?? 'Unknown error')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\/Users\/[^/\s]+/g, '/Users/[USER]');
}
