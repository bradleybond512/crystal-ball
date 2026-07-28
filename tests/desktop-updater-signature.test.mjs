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

test('updater pins the update to the same Apple signer as the installed app', () => {
  assert.match(
 mainRs,
 /fn verify_same_signer_as_installed\(/,
 'updater should compare the update Team Identifier against the installed app',
  );
  assert.match(
 mainRs,
 /fn parse_team_identifier\(/,
 'signer pinning should parse TeamIdentifier from codesign output (pure + testable)',
  );
  // Signer pinning must guard all three swap entry points: stage, apply, boot.
  const signerCalls = mainRs.match(/verify_same_signer_as_installed\(&(?:source|staged), &dest\)/g) ?? [];
  assert.ok(
 signerCalls.length >= 4,
 `expected signer checks at stage (source+staged), apply, and boot; found ${signerCalls.length}`,
  );
});
