#!/usr/bin/env node
import { createSidecarClient } from './sidecar-client.mjs';
import { createStorage } from './storage.mjs';
import { makeDiagnosticsTools } from './tools/diagnostics.mjs';
import { makeGranularTools } from './tools/granular.mjs';
import { makeMonitorTools } from './tools/monitor.mjs';

const client = createSidecarClient();
const monitor = makeMonitorTools({
  storage: createStorage(),
  granular: makeGranularTools(client),
  diagnostics: makeDiagnosticsTools(client),
});
const result = await monitor.run_monitor_cycle();

process.stdout.write(`${JSON.stringify({
  at: result.lastRunAt,
  status: result.status,
  summary: result.summary,
  newlyTriggered: result.newlyTriggered,
  recovered: result.recovered,
})}\n`);
