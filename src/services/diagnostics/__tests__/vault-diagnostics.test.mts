// R3-SEC-003 phase A: the keys & signing row validates the native payload and
// says plainly when the build is ad hoc or saves are paused.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildVaultDiagnosticsView,
  fetchVaultDiagnostics,
  parseVaultDiagnostics,
} from '../vault-diagnostics.ts';

const healthy = {
  signing: { kind: 'stable', authority: 'Crystal Ball Dev' },
  vaultSource: 'vault',
  savesGated: false,
  shadowFallbacks: { count: 0, lastAtMs: null },
};

test('a well-formed payload parses; anything malformed is null', () => {
  assert.deepEqual(parseVaultDiagnostics(healthy), healthy);
  const bad: unknown[] = [
    null,
    'x',
    { ...healthy, signing: { kind: 'notarized', authority: null } },
    { ...healthy, signing: { kind: 'stable', authority: 7 } },
    { ...healthy, vaultSource: 'keychain' },
    { ...healthy, savesGated: 'no' },
    { ...healthy, shadowFallbacks: { count: -1, lastAtMs: null } },
    { ...healthy, shadowFallbacks: { count: 1, lastAtMs: 'yesterday' } },
  ];
  for (const raw of bad) assert.equal(parseVaultDiagnostics(raw), null, JSON.stringify(raw));
});

test('a stable build reading the real vault is ok', () => {
  assert.deepEqual(buildVaultDiagnosticsView(parseVaultDiagnostics(healthy)), {
    tone: 'ok',
    text: 'Keys & signing: signed as Crystal Ball Dev · keys from the Keychain',
  });
});

test('an ad hoc build, the backup copy, or an unreadable Keychain is called out', () => {
  const adhoc = buildVaultDiagnosticsView({ ...healthy, signing: { kind: 'adhoc', authority: null } } as never);
  assert.equal(adhoc.tone, 'bad');
  assert.match(adhoc.text, /ad hoc build \(the Keychain re-prompts after every rebuild\)/);

  const shadow = buildVaultDiagnosticsView({ ...healthy, vaultSource: 'shadow', savesGated: true, shadowFallbacks: { count: 3, lastAtMs: 1 } } as never);
  assert.equal(shadow.tone, 'bad');
  assert.match(shadow.text, /keys from the backup copy; saves paused \(use Reload keys from Keychain\) · 3 backup-copy fallbacks/);

  const unavailable = buildVaultDiagnosticsView({ ...healthy, vaultSource: 'unavailable', savesGated: true } as never);
  assert.match(unavailable.text, /Keychain unreadable; saves paused/);

  const once = buildVaultDiagnosticsView({ ...healthy, shadowFallbacks: { count: 1, lastAtMs: 2 } } as never);
  assert.equal(once.tone, 'warn');
  assert.match(once.text, /1 backup-copy fallback$/);

  assert.deepEqual(buildVaultDiagnosticsView(null), { tone: 'warn', text: 'Keys & signing status unavailable' });
  assert.equal(buildVaultDiagnosticsView({ ...healthy, signing: { kind: 'unknown', authority: null } } as never).tone, 'warn');
});

test('the fetch asks the native command and validates the answer', async () => {
  const asked: string[] = [];
  const ok = await fetchVaultDiagnostics(async <T,>(command: string) => { asked.push(command); return healthy as T; });
  assert.deepEqual(ok, healthy);
  assert.deepEqual(asked, ['get_vault_diagnostics']);
  assert.equal(await fetchVaultDiagnostics(async <T,>() => ({ leaked: 'value' }) as T), null);
});
