import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const src = readFileSync(path.join(repoRoot, 'src', 'app', 'vault-intro.ts'), 'utf8');

// Startup-animation wiring characterization for the current vault intro.
// The scanner-shaped control is decorative and must never claim or perform
// authentication.

test('vault intro animation is single-registration and retry-safe', () => {
  const clickListenerMatches = src.match(/refs\.scannerBtn\.addEventListener\('click'/g) ?? [];
  assert.equal(
 clickListenerMatches.length,
 1,
 'scanner button should register exactly one click listener across the flow',
  );

  assert.match(
 src,
 /let inFlight = false;[\s\S]*if \(settled \|\| inFlight\) return;[\s\S]*inFlight = true;/m,
 'the animation should gate on an inFlight flag so rapid clicks cannot race',
  );

  assert.doesNotMatch(
 src,
 /plugin:biometry|attemptAuth|ACCESS GRANTED|BIOMETRIC SCAN READY/i,
 'the startup animation must not invoke or claim biometric authentication',
  );

  assert.match(
 src,
 /export async function runVaultIntro\(appReady\?: Promise<void>\): Promise<boolean>/m,
 'runVaultIntro should expose an appReady hook so the animation can overlap bootstrap',
  );
});
