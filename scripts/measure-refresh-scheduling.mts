import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runSchedulingScenario } from '../tests/helpers/refresh-scheduler-clock.mjs';

export async function measureRefreshScheduling({ seed = 36, horizonMs = 7_200_000 } = {}) {
  assert.ok(Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffff_ffff, 'Seed must be uint32');
  assert.ok(Number.isSafeInteger(horizonMs) && horizonMs >= 0 && horizonMs <= 28_800_000, 'Horizon must be bounded to eight hours');
  const scenarios = [];
  for (const [cohort, intervals, cohortSize] of [['equal', [60_000], 12], ['mixed', [60_000, 180_000, 300_000, 480_000, 600_000, 1_800_000, 3_600_000, 7_200_000], 1]]) {
    for (const [mode, policy] of [['ac', {}], ['battery', { onBattery: true }], ['low-power', { lowPower: true }], ['ghost', { ghost: true }]]) {
      for (const [loader, durationMs, outcome] of [['immediate', 0, 'success'], ['slow', 2500, 'success'], ['unchanged', 0, 'unchanged'], ['failure', 0, 'failure']]) {
        scenarios.push({ cohort, mode, loader, ...await runSchedulingScenario({ seed, horizonMs, intervals, cohortSize, durationMs, outcome, policy }) });
      }
    }
  }
  for (const [boundary, value] of [['lower', 0], ['mid', 0.5], ['upper', 1]]) scenarios.push({ boundary, ...await runSchedulingScenario({ seed, horizonMs, intervals: [60_000], cohortSize: 12, randomValues: [value] }) });
  scenarios.push({ mode: 'hidden-resume', ...await runSchedulingScenario({ seed, horizonMs, intervals: [60_000], cohortSize: 12, durationMs: 2500, hiddenUntilMs: Math.floor(horizonMs / 2), policy: { alwaysOn: false } }) });
  return { evidence: 'Synthetic scheduler timing only; no CPU, energy, native battery or warning-latency claim', windowConvention: 'half-open [start, start + width)', concurrency: 'Modeled active synthetic loaders; six-slot bound applies only to recovery admission', seed, horizonMs, scenarios };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2); const options = {};
  assert.equal(args.length % 2, 0, 'Expected flag/value pairs');
  for (let i = 0; i < args.length; i += 2) {
    assert.ok(args[i] === '--seed' || args[i] === '--horizon-ms', 'Unknown argument');
    options[args[i] === '--seed' ? 'seed' : 'horizonMs'] = Number(args[i + 1]);
  }
  console.log(JSON.stringify(await measureRefreshScheduling(options), null, 2));
}
