#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

import {
  buildAgentDoctorReport,
  DOCTOR_EXIT,
  formatDoctorReport,
  readLocalMonitorStatus,
} from './doctor.mjs';
import { buildEvidencePacket, writeEvidencePacket } from './evidence-packet.mjs';
import { runSafeguardDemo } from './safeguard-demo.mjs';
import { COMPATIBILITY } from './server-meta.mjs';
import { TOOL_CATALOG } from './tool-registry.mjs';

const HELP = `Crystal Ball agent access

Usage: crystalball <command> [options]

Commands:
  doctor [--json]                 Check install, runtime, clients, monitor, and compatibility
  capabilities [--json]           List tools and their plain-language permissions
  monitor [--json]                Read the latest local safety-monitor status
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
