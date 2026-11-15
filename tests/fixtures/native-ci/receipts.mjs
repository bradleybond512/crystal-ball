import { inventory, stageIds } from '../../../scripts/native-test-driver.mjs';

export const controlDefinitions = [
  { id: 'watchdog', source: 'src-tauri/tests/watchdog_contract.rs', target: 'watchdog_contract', failureNames: ['main_focus_tracks_gain_and_loss'] },
  { id: 'crypto-nonce-rejection', source: 'src-tauri/src/main.rs', target: 'crystalball', failureNames: ['vault_shadow_crypto_tests::malformed_nonce_lengths_are_rejected'] },
  { id: 'crypto-auth-rejection', source: 'src-tauri/src/main.rs', target: 'crystalball', failureNames: ['modified_nonce_is_rejected', 'modified_tag_is_rejected', 'tampered_ciphertext_is_rejected', 'wrong_key_fails_authentication'].map(name => `vault_shadow_crypto_tests::${name}`) },
];

export function passingCounts(targetName, platform) {
  const target = inventory.targets.find(target => target.name === targetName);
  const total = target.tests.length + (platform === 'darwin-arm64' ? target.darwinOnly.length : 0);
  return { tests: total, passed: total, failed: 0, ignored: 0, measured: 0, filtered: 0 };
}

export function validReceipt(platform, sourceSha = 'a'.repeat(40)) {
  const controls = controlDefinitions.map(control => {
    const counts = passingCounts(control.target, platform);
    return { ...control, appliedDiff: true, detectedFailure: true, restored: true,
      originalHash: 'c'.repeat(64), mutatedHash: 'd'.repeat(64), restoredHash: 'c'.repeat(64), counts,
      redCounts: { ...counts, passed: counts.tests - control.failureNames.length, failed: control.failureNames.length },
    };
  });
  return { schemaVersion: 1, platform, sourceSha, lockHash: 'b'.repeat(64), stages: stageIds.map(id => ({ id, status: 'passed', exitCode: 0,
    kind: id.startsWith('test:') ? 'test' : id.startsWith('list:') ? 'inventory' : id === 'mutation' ? 'control' : 'build',
    ...(id.startsWith('test:') ? { counts: passingCounts(id.slice(5), platform) } : {}),
    ...(id === 'mutation' ? { detectedFailure: true, restored: true, controls } : {}),
  })) };
}
