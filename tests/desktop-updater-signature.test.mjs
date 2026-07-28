import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const mainRs = readFileSync(path.join(repoRoot, 'src-tauri', 'src', 'main.rs'), 'utf8');

test('macOS updater preserves bundle signatures when installing app updates', () => {
  assert.match(
 mainRs,
 /Command::new\("ditto"\)/,
 'updater should use ditto to preserve bundle metadata and _CodeSignature during install',
  );
  assert.doesNotMatch(
 mainRs,
 /Command::new\("cp"\)\s*\.args\(\["-r", &source, dest\]\)/,
 'updater should not use cp -r for app bundle installs because it can break code signatures',
  );
  assert.match(
 mainRs,
 /Copy to install path failed/,
 'install path should still surface copy failures clearly without hardcoding /Applications',
  );
  assert.match(
 mainRs,
 /verify_app_bundle_signature\(&dest, "Installed app"\)/,
 'updater should verify the installed bundle signature after copying before relaunching',
  );
  assert.match(
 mainRs,
 /resolve_update_install_path|current_exe/,
 'updater should resolve the active install path instead of hardcoding /Applications',
  );
  assert.doesNotMatch(
 mainRs,
 /let dest = "\/Applications\/Crystal Ball\.app";/,
 'updater should not hardcode /Applications as the install destination',
  );
  assert.match(
 mainRs,
 /staged|backup/,
 'updater should stage a verified replacement and preserve the current install until swap time',
  );
  assert.doesNotMatch(
 mainRs,
 /Command::new\("rm"\)\.args\(\["-rf", dest\]\)/,
 'updater should not delete the current install before a verified replacement exists',
  );
});

test('updater is split into background stage + prompted apply commands', () => {
  assert.match(
 mainRs,
 /async fn stage_update\(/,
 'updater should expose stage_update to download+verify+stage in the background',
  );
  assert.match(
 mainRs,
 /async fn apply_staged_update\(/,
 'updater should expose apply_staged_update to swap the staged bundle on restart',
  );
  assert.match(
 mainRs,
 /fn maybe_apply_staged_update_on_boot\(/,
 'updater should apply a staged update at boot for seamless quit/relaunch',
  );
  assert.doesNotMatch(
 mainRs,
 /fn install_update\(/,
 'the one-shot install_update command should be gone (replaced by stage + apply)',
  );
  assert.match(
 mainRs,
 /verify_app_bundle_signature\(&staged, "Staged app"\)/,
 'apply/boot paths should re-verify the staged bundle signature before swapping',
  );
});

test('updater pins the update to an Apple-anchored designated requirement', () => {
  assert.match(
 mainRs,
 /fn verify_same_signer_as_installed\(/,
 'updater should verify the update is signed by the same signer as the installed app',
  );
  assert.match(
 mainRs,
 /fn build_signer_requirement\(/,
 'signer pinning should build a designated requirement (pure + unit-testable)',
  );
  // The requirement MUST chain to Apple's root — a self-signed cert claiming the
  // expected Team OU can never satisfy `anchor apple generic`.
  assert.match(
 mainRs,
 /anchor apple generic and identifier .* certificate leaf\[subject\.OU\]/,
 'signer requirement must be Apple-anchored and pin bundle id + team OU',
  );
  // The staging path pins BOTH the mounted source and the copied staged bundle.
  const stagePins = mainRs.match(/verify_same_signer_as_installed\(&(?:source|staged), &dest\)/g) ?? [];
  assert.ok(
 stagePins.length >= 2,
 `expected signer pinning on the mounted source and staged copy; found ${stagePins.length}`,
  );
});

test('apply and boot share one staged-bundle validator (no weaker door)', () => {
  assert.match(
 mainRs,
 /fn validate_staged_bundle\(/,
 'a shared validator should gate both swap entry points identically',
  );
  // Both the manual apply command and the boot-time auto-apply must run it.
  const validatorCalls = mainRs.match(/validate_staged_bundle\(&staged, &requirement\)/g) ?? [];
  assert.ok(
 validatorCalls.length >= 2,
 `expected validate_staged_bundle in both apply and boot; found ${validatorCalls.length}`,
  );
});

test('signer pin + version are captured once and re-checked after the swap', () => {
  // The Apple signer requirement is derived from the live install exactly once
  // per apply/boot and threaded through, never re-derived inside the swap (which
  // could otherwise trust a tampered dest's team).
  const captures = mainRs.match(/installed_signer_requirement\(&dest\)/g) ?? [];
  assert.ok(
 captures.length >= 2,
 `expected one up-front signer-pin capture in each of apply and boot; found ${captures.length}`,
  );
  // The swap threads the captured requirement + expected version through.
  assert.match(
 mainRs,
 /swap_staged_into_place\(&staged, &dest, &backup, &requirement, &staged_version\)/,
 'swap must receive the captured pin + version, not re-derive them',
  );
  // Post-swap must re-read the installed version and reject a mismatch, blocking a
  // downgrade substituted into the rename window.
  assert.match(
 mainRs,
 /read_bundle_short_version\(dest\)/,
 'post-swap must re-read the installed bundle version',
  );
  assert.match(
 mainRs,
 /does not match the validated staged version/,
 'post-swap must reject a version mismatch (downgrade in the rename window)',
  );
});

test('a missing install path fails signer resolution closed', () => {
  // installed_signer_requirement must never read a missing bundle as "unsigned
  // dev build" and silently disable signer enforcement.
  assert.match(
 mainRs,
 /is missing — refusing update/,
 'a missing install path must error, not return Ok(None)',
  );
});
