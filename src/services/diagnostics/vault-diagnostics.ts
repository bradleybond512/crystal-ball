/**
 * Keys & signing status from the native `get_vault_diagnostics` command
 * (R3-SEC-003 phase A). Value-free: how the app is signed, where this
 * session's keys came from, whether saves are paused, and how often the
 * shadow (backup) vault was used. Validation and view logic are pure; the
 * fetch takes an injectable invoke for tests.
 */

import { tryInvokeTauri } from '../tauri-bridge';

export type SigningKind = 'stable' | 'adhoc' | 'unknown';
export type VaultSourceName = 'pending' | 'vault' | 'absent' | 'shadow' | 'unavailable';

export interface VaultDiagnostics {
  signing: { kind: SigningKind; authority: string | null };
  vaultSource: VaultSourceName;
  savesGated: boolean;
  shadowFallbacks: { count: number; lastAtMs: number | null };
}

export type Invoke = <T>(command: string) => Promise<T | null>;

const SIGNING_KINDS: ReadonlySet<string> = new Set(['stable', 'adhoc', 'unknown']);
const SOURCES: ReadonlySet<string> = new Set(['pending', 'vault', 'absent', 'shadow', 'unavailable']);

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Strictly validate the native payload; anything malformed is `null`. */
export function parseVaultDiagnostics(raw: unknown): VaultDiagnostics | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const signing = o.signing as Record<string, unknown> | null;
  if (!signing || typeof signing !== 'object' || typeof signing.kind !== 'string' || !SIGNING_KINDS.has(signing.kind)) return null;
  const authority = signing.authority ?? null;
  if (authority !== null && typeof authority !== 'string') return null;
  if (typeof o.vaultSource !== 'string' || !SOURCES.has(o.vaultSource)) return null;
  if (typeof o.savesGated !== 'boolean') return null;
  const fallbacks = o.shadowFallbacks as Record<string, unknown> | null;
  if (!fallbacks || typeof fallbacks !== 'object' || !isCount(fallbacks.count)) return null;
  const lastAtMs = fallbacks.lastAtMs ?? null;
  if (lastAtMs !== null && !isCount(lastAtMs)) return null;
  return {
    signing: { kind: signing.kind as SigningKind, authority },
    vaultSource: o.vaultSource as VaultSourceName,
    savesGated: o.savesGated,
    shadowFallbacks: { count: fallbacks.count, lastAtMs },
  };
}

export async function fetchVaultDiagnostics(invoke: Invoke = tryInvokeTauri): Promise<VaultDiagnostics | null> {
  return parseVaultDiagnostics(await invoke<unknown>('get_vault_diagnostics'));
}

export type VaultDiagnosticsTone = 'ok' | 'warn' | 'bad';

export interface VaultDiagnosticsView {
  tone: VaultDiagnosticsTone;
  text: string;
}

const SOURCE_TEXT: Record<VaultSourceName, { tone: VaultDiagnosticsTone; text: string }> = {
  vault: { tone: 'ok', text: 'keys from the Keychain' },
  absent: { tone: 'ok', text: 'no keys stored yet' },
  pending: { tone: 'warn', text: 'keys still loading' },
  shadow: { tone: 'bad', text: 'keys from the backup copy; saves paused (use Reload keys from Keychain)' },
  unavailable: { tone: 'bad', text: 'Keychain unreadable; saves paused (use Reload keys from Keychain)' },
};

const RANK: Record<VaultDiagnosticsTone, number> = { ok: 0, warn: 1, bad: 2 };

export function buildVaultDiagnosticsView(diag: VaultDiagnostics | null): VaultDiagnosticsView {
  if (!diag) return { tone: 'warn', text: 'Keys & signing status unavailable' };
  const parts: { tone: VaultDiagnosticsTone; text: string }[] = [];
  switch (diag.signing.kind) {
    case 'stable': {
      parts.push({ tone: 'ok', text: `signed as ${diag.signing.authority ?? 'a stable identity'}` });
      break;
    }
    case 'adhoc': {
      parts.push({ tone: 'bad', text: 'ad hoc build (the Keychain re-prompts after every rebuild)' });
      break;
    }
    default: {
      parts.push({ tone: 'warn', text: 'signature unknown' });
    }
  }
  parts.push(SOURCE_TEXT[diag.vaultSource]);
  const { count } = diag.shadowFallbacks;
  if (count > 0) parts.push({ tone: 'warn', text: count === 1 ? '1 backup-copy fallback' : `${count} backup-copy fallbacks` });
  const tone = parts.reduce<VaultDiagnosticsTone>((worst, part) => (RANK[part.tone] > RANK[worst] ? part.tone : worst), 'ok');
  return { tone, text: `Keys & signing: ${parts.map((part) => part.text).join(' · ')}` };
}
