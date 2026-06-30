import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const src = readFileSync(path.join(repoRoot, 'src', 'app', 'vault-intro.ts'), 'utf8');

// Scanner wiring characterization for the current vault intro. See
// vault-intro-open-sequence.test.mjs for the full architecture note.
// Contract enforced by these assertions:
//   - Exactly ONE click listener on the scanner button (retry must reuse the
//     same handler, not re-register).
//   - Retry path is guarded by an `inFlight` flag so double-taps can't race.
//   - Authentication goes through a single `invokeTauri('plugin:biometry|…')`
//     call, not a home-grown fingerprint overlay.

test('vault intro scanner wiring is single-registration and retry-safe', () => {
  const clickListenerMatches = src.match(/refs\.scannerBtn\.addEventListener\('click'/g) ?? [];
  assert.equal(
 clickListenerMatches.length,
 1,
 'scanner button should register exactly one click listener across the flow',
  );

  assert.match(
 src,
 /let inFlight = false;[\s\S]*if \(settled \|\| inFlight\) return;[\s\S]*inFlight = true;/m,
 'tryAuth should gate on an inFlight flag so rapid retries cannot race',
  );

  // The biometry invoke is wrapped in `await Promise.race([invokeTauri(CMD,…),
  // timeout])` so `await` is no longer adjacent to the call — match the call
  // itself, which is the wiring contract we care about.
  assert.match(
 src,
 /const CMD = 'plugin:biometry\|authenticate';[\s\S]*invokeTauri<void>\(CMD,/m,
 'authentication should route through the Tauri biometry plugin, not a custom scanner',
  );

  assert.match(
 src,
 /setScannerError\(refs, text\);[\s\S]*setTimeout\(\(\) => \{ if \(!settled\) setScannerIdle\(refs\); \}, \d+\);/m,
 'on error the scanner should flip to an error state and auto-reset to idle so retry works',
  );

  assert.match(
 src,
 /export async function runVaultIntro\(appReady\?: Promise<void>\): Promise<boolean>/m,
 'runVaultIntro should expose an appReady hook so the shell can gate on bootstrap completion',
  );
});
