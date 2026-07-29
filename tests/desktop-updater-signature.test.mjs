import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const mainRs = readFileSync(path.join(repoRoot, 'src-tauri', 'src', 'main.rs'), 'utf8');
const desktopUpdaterTs = readFileSync(
  path.join(repoRoot, 'src', 'app', 'desktop-updater.ts'),
  'utf8',
);

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

test('a non-Apple install must prove an intact signature before skipping the pin', () => {
  // codesign_satisfies("anchor apple generic") == false covers BOTH a valid
  // ad-hoc/dev build and a broken/stripped signature. Only the former may skip
  // signer enforcement, so the Ok(None) path must first require the running
  // bundle's signature to verify — a corrupted install fails closed.
  const gate = mainRs.match(
 /if !codesign_satisfies\(installed, "anchor apple generic"\) \{[\s\S]*?verify_app_bundle_signature\(installed, "Installed app"\)\?;[\s\S]*?return Ok\(None\);/,
  );
  assert.ok(
 gate,
 'the Ok(None) dev-build skip must be guarded by an intact-signature check',
  );
});

test('the swap is guarded by a cross-process advisory lock, not just an in-process mutex', () => {
  // Residual A: two running instances (the real race — a user can launch two
  // copies) must not both swap `dest` at once. flock is advisory and the kernel
  // releases it on fd-close OR process death, so a crashed updater can't wedge
  // future updates behind a stale lock.
  assert.match(
 mainRs,
 /struct CrossProcessSwapLock/,
 'a cross-process swap lock type should exist',
  );
  assert.match(
 mainRs,
 /fn flock\(fd: std::os::raw::c_int, operation: std::os::raw::c_int\)/,
 'the lock should use a raw BSD flock FFI (no new crate dependency)',
  );
  // The lockfile is a deterministic sibling of the install so both instances
  // open the SAME inode; a per-process temp path would not be mutually exclusive.
  assert.match(
 mainRs,
 /\{dest\}\.update\.lock/,
 'the lockfile must be a deterministic sibling of the install path',
  );
  // Manual apply + stage-publish block on the lock; boot only tries it so
  // startup never hangs behind another instance's swap.
  const blocking = mainRs.match(/CrossProcessSwapLock::acquire_blocking\(&dest\)/g) ?? [];
  assert.ok(
 blocking.length >= 2,
 `apply and stage-publish should block on the cross-process lock; found ${blocking.length}`,
  );
  assert.match(
 mainRs,
 /CrossProcessSwapLock::try_acquire\(&dest\)/,
 'boot-apply must use a non-blocking try-acquire so startup never hangs',
  );
});

test('concurrent staging uses a unique per-request dir, then publishes atomically', () => {
  // Residual B: two concurrent stage_update runs (or another local process) must
  // not clobber each other's download / in-progress copy. Each gets a pid+counter
  // path, is verified in full there, then renamed onto the canonical staged path.
  assert.match(
 mainRs,
 /STAGE_COUNTER\.fetch_add/,
 'a per-call counter should stamp each staging request',
  );
  assert.match(
 mainRs,
 /update-staging-\{pid\}-\{n\}/,
 'the per-request staging bundle path must include pid + counter',
  );
  assert.match(
 mainRs,
 /fs::rename\(&staged, &canonical_staged\)/,
 'the FIRST publish (no canonical yet) must move the verified bundle into place via rename',
  );
  // A failed NEW stage must delete only its own dir, never the previously
  // published good bundle at the canonical path.
  assert.doesNotMatch(
 mainRs,
 /if let Err\(e\) = stage_result \{[\s\S]*?remove_dir_all\(&canonical_staged\)/,
 'a failed stage must not delete a previously-published canonical bundle',
  );
  // Publish over an EXISTING canonical bundle is a single-syscall atomic swap
  // (renamex_np RENAME_SWAP), not remove-then-rename or move-aside/restore.
  // RENAME_SWAP has no intermediate state: on success canonical is the new
  // bundle and `staged` holds the old one; on ANY failure NEITHER path changes,
  // so the previous good bundle is never even briefly absent and there is no
  // persistent `.prev` recovery artifact to leak or later delete by mistake.
  assert.match(
 mainRs,
 /fn swap_paths_atomically\(/,
 'publish must go through a single-syscall atomic-swap helper',
  );
  assert.match(
 mainRs,
 /fn renamex_np\(/,
 'the atomic swap must use the macOS renamex_np FFI (no new crate dependency)',
  );
  assert.match(
 mainRs,
 /const RENAME_SWAP: std::os::raw::c_uint = 0x0000_0002;/,
 'the swap must pass the RENAME_SWAP flag',
  );
  assert.match(
 mainRs,
 /swap_paths_atomically\(&staged, &canonical_staged\)/,
 'the existing-canonical publish path must swap the new bundle in atomically',
  );
  // The move-aside/restore `.prev` artifact is GONE — its lifecycle (leaking a
  // stale old bundle on success, and pid-reuse deleting a recovery bundle) is
  // structurally eliminated by the atomic swap.
  assert.doesNotMatch(
 mainRs,
 /\.prev-\{pid\}-\{n\}/,
 'the move-aside `.prev` recovery artifact must be gone (replaced by atomic swap)',
  );
  // The swapped-out OLD bundle must not leak on a successful publish. A plain
  // remove_dir_all can fail persistently on a BSD immutable flag / read-only
  // dir copied from the DMG, so disposal goes through force_remove_dir_all,
  // which clears those blockers and retries — no per-update accumulation.
  assert.match(
 mainRs,
 /fn force_remove_dir_all\(/,
 'staged-bundle disposal must use a flag-clearing robust remove helper',
  );
  assert.match(
 mainRs,
 /Command::new\("chflags"\)[\s\S]*?nouchg/,
 'force_remove_dir_all must clear immutable flags before retrying',
  );
  // `ditto` preserves ACLs from the DMG; a deny delete/delete_child ACL survives
  // chmod mode-bit changes, so the helper must strip ACLs (`chmod -R -N`) too or
  // a signed bundle could resist removal and accumulate per update.
  assert.match(
 mainRs,
 /Command::new\("chmod"\)\.args\(\["-R", "-N"/,
 'force_remove_dir_all must strip ACLs (chmod -R -N) before retrying',
  );
  assert.match(
 mainRs,
 /force_remove_dir_all\(&staged\)/,
 'the post-swap old-bundle cleanup must use the robust remove',
  );
  // Concurrency guard: a slow stage for an OLDER version must not overwrite a
  // newer bundle a concurrent run already published under the lock.
  assert.match(
 mainRs,
 /is_semver_newer\(&existing, &staged_version\)/,
 'publish must refuse to regress a strictly-newer already-staged bundle',
  );
});

test('Rust filesystem state is authoritative over the localStorage staged hint', () => {
  // Residual C: the renderer must not trust a `wm-update-staged-*` localStorage
  // flag as ground truth — it queries the Rust filesystem probe and reconciles.
  assert.match(
 mainRs,
 /async fn staged_update_status\(/,
 'a staged_update_status command should expose the on-disk staged version',
  );
  assert.match(
 mainRs,
 /^\s*staged_update_status,$/m,
 'staged_update_status must be registered in the invoke handler',
  );
  assert.match(
 desktopUpdaterTs,
 /invokeTauri<string \| null>\('staged_update_status'\)/,
 'the updater must query the Rust staged-status probe before (re-)downloading',
  );
  // Reconcile in BOTH directions: re-stage when disk lacks it (stale '1'),
  // skip re-download when disk has it (cleared flag).
  assert.match(
 desktopUpdaterTs,
 /if \(!stagedOnDisk\)/,
 'the download gate must key off disk truth, not the localStorage flag',
  );
});
