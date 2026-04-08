import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const src = readFileSync(path.join(repoRoot, 'src', 'app', 'vault-intro.ts'), 'utf8');

test('vault intro scanner wiring is single-registration and retry-safe', () => {
  const clickListenerMatches = src.match(/scanBtn\.addEventListener\('click'/g) ?? [];
  assert.equal(
 clickListenerMatches.length,
 1,
 'scanner should register one click listener when the flow starts',
  );
  assert.match(
 src,
 /scene\.scanBtn\.addEventListener\('click', async \(\) => \{[\s\S]*if \(st\.phase !== 'idle'\) return;/m,
 'scanner handler should remain single-registered and guard against re-entry during active scans',
  );
  assert.match(
 src,
 /if \(granted\) \{[\s\S]*await playOpenSequence\(scene, st, appReady\);[\s\S]*\} else \{[\s\S]*await sleep\(1800\);[\s\S]*st\.phase\s*=\s*'idle';/m,
 'retry path should reset scanner state back to idle after a failed authentication attempt',
  );
});
