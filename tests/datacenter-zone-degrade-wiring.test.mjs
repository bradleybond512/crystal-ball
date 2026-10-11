// R3-BUG-002 source gate: the datacenter posture block in data-loader must
// degrade on a failed NWS /points lookup instead of skipping the tick, and a
// skipped recompute must mark the previous posture stale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const loader = readFileSync(new URL('../src/app/data-loader.ts', import.meta.url), 'utf8');

function postureBlock() {
  const anchor = 'const refreshDatacenterPosture = async (): Promise<void> => {';
  const start = loader.indexOf(anchor);
  assert.ok(start >= 0, 'datacenter posture block');
  assert.equal(loader.indexOf(anchor, start + anchor.length), -1, 'unique production datacenter closure');
  const end = loader.indexOf("markDatacenterPostureStale('posture recompute failed');", start);
  assert.ok(end > start, 'the posture catch marks the posture stale');
  const invocation = loader.indexOf('await refreshDatacenterPosture();', end);
  assert.ok(invocation > end, 'actual awaited invocation follows the contained catch');
  return loader.slice(start, invocation + 'await refreshDatacenterPosture();'.length);
}

test('zone lookup goes through the best-effort helper, never the throwing lookup', () => {
  const block = postureBlock();
  assert.match(block, /await resolveSiteZonesBestEffort\(site, _siteUgcZoneCache, fetchUgcZonesForPoint\)/);
  assert.doesNotMatch(block, /await fetchUgcZonesForPoint\(/);
  assert.doesNotMatch(block, /_siteUgcZoneCache\.set\(/, 'only the helper writes the cache (never a failure)');
});

test('the degraded flag reaches the posture and the catch marks it stale', () => {
  const block = postureBlock();
  const recompute = block.indexOf('recomputeDatacenterPosture({');
  const flag = block.indexOf('weatherZonesUnverified: zoneResolution.degraded,');
  assert.ok(recompute >= 0 && flag > recompute, 'flag passed to recompute');
  const catchAt = block.lastIndexOf('} catch (error) {');
  assert.ok(catchAt > flag, 'catch follows the recompute');
  assert.match(block.slice(catchAt), /markDatacenterPostureStale\('posture recompute failed'\)/);
});
