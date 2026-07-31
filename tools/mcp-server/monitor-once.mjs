#!/usr/bin/env node
import { createSidecarClient } from './sidecar-client.mjs';
import { createStorage } from './storage.mjs';
import { makeDiagnosticsTools } from './tools/diagnostics.mjs';
import { makeGranularTools } from './tools/granular.mjs';
import { makeMonitorTools } from './tools/monitor.mjs';

const args = process.argv.slice(2);
const expectedIntervalMs = secondsArgument(args, '--expected-interval-seconds');
const stoppedGraceMs = secondsArgument(args, '--stopped-grace-seconds');

const client = createSidecarClient();
const monitor = makeMonitorTools({
  storage: createStorage(),
  granular: makeGranularTools(client),
  diagnostics: makeDiagnosticsTools(client),
  scheduleOptions: { expectedIntervalMs, stoppedGraceMs },
});
const result = await monitor.run_monitor_cycle();

process.stdout.write(`${JSON.stringify({
  at: result.lastRunAt,
  status: result.status,
  summary: result.summary,
  newlyTriggered: result.newlyTriggered,
  recovered: result.recovered,
  schedule: result.schedule,
  events: result.events.slice(-10),
})}\n`);

function secondsArgument(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const seconds = Number(args[index + 1]);
  if (!Number.isInteger(seconds) || seconds < 60 || seconds > 604_800) {
    throw new Error(`${name} must be an integer from 60 to 604800 seconds.`);
  }
  return seconds * 1_000;
}
