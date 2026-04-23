/**
 * Web Secret Store — passphrase-encrypted API key vault for the browser build.
 *
 * Desktop uses the macOS Keychain via a Tauri command. The web build has no
 * equivalent, so keys historically could not persist across reloads.
 *
 * This module provides a client-side encrypted vault:
 *   - Passphrase → AES key via PBKDF2-SHA-256 (600k iters, OWASP 2023 baseline).
 *   - Key bundle encrypted with AES-GCM-256; random 12-byte IV rotated on
 *     every save so two writes never share an IV.
 *   - Authenticated additional data binds ciphertext to this app+version.
 *   - Ciphertext lives in IndexedDB (crystalball_db / reasoning_memory store);
 *     the derived key and plaintext map live only in this module's closure.
 *   - No key material is ever written to localStorage, sessionStorage, or
 *     globalThis, and nothing is transmitted to any server.
 *   - Auto-lock after IDLE_LOCK_MS of the tab being hidden wipes both the
 *     derived key and the plaintext map.
 */

import { getMemory, putMemory, deleteMemory } from './reasoning-memory';

export interface VaultBlob {
  v: 1;
  kdf: 'PBKDF2-SHA-256';
  iters: number;
  salt: string;
  iv: string;
  ct: string;
}

export type LockState = 'missing' | 'locked' | 'unlocked';

const VAULT_KEY = 'web-secret-vault/v1';
const PBKDF2_ITERS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const AAD = new TextEncoder().encode('crystalball-web-vault-v1');
const IDLE_LOCK_MS = 15 * 60 * 1000;
const MIN_PASSPHRASE_LEN = 12;

let derivedKey: CryptoKey | null = null;
let plaintext: Map<string, string> | null = null;
let cachedBlob: VaultBlob | null | undefined = undefined;
let hiddenSince: number | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function onVaultChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function hasSubtleCrypto(): boolean {
  const c: unknown = (globalThis as { crypto?: unknown }).crypto;
  return !!c && typeof (c as { subtle?: unknown }).subtle === 'object';
}

export function isSupported(): boolean {
  return hasSubtleCrypto() && (globalThis as { indexedDB?: unknown }).indexedDB !== undefined;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCodePoint(byte);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.codePointAt(i)!;
  return out;
}

async function loadBlob(): Promise<VaultBlob | null> {
  if (cachedBlob !== undefined) return cachedBlob;
  const blob = await getMemory<VaultBlob>(VAULT_KEY);
  cachedBlob = blob?.v === 1 ? blob : null;
  return cachedBlob;
}

async function deriveKey(passphrase: string, salt: Uint8Array, iters: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase) as BufferSource,
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iters },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptMap(key: CryptoKey, salt: Uint8Array, map: Map<string, string>): Promise<VaultBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintextJson = new TextEncoder().encode(JSON.stringify(Object.fromEntries(map)));
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: AAD as BufferSource },
    key,
    plaintextJson as BufferSource,
  ));
  return {
    v: 1,
    kdf: 'PBKDF2-SHA-256',
    iters: PBKDF2_ITERS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ct: bytesToBase64(ct),
  };
}

async function decryptBlob(key: CryptoKey, blob: VaultBlob): Promise<Map<string, string>> {
  const iv = base64ToBytes(blob.iv);
  const ct = base64ToBytes(blob.ct);
  const plaintextBytes = new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: AAD as BufferSource },
    key,
    ct as BufferSource,
  ));
  const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintextBytes));
  const map = new Map<string, string>();
  if (parsed && typeof parsed === 'object') {
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') map.set(k, v);
    }
  }
  return map;
}

export async function getVaultState(): Promise<LockState> {
  if (!isSupported()) return 'missing';
  if (derivedKey && plaintext) return 'unlocked';
  const blob = await loadBlob();
  return blob ? 'locked' : 'missing';
}

export function isVaultUnlocked(): boolean {
  return derivedKey !== null && plaintext !== null;
}

export function validatePassphrase(passphrase: string): { valid: boolean; hint?: string } {
  if (passphrase.length < MIN_PASSPHRASE_LEN) {
    return { valid: false, hint: `Use at least ${MIN_PASSPHRASE_LEN} characters` };
  }
  return { valid: true };
}

export async function createVault(passphrase: string): Promise<void> {
  if (!isSupported()) throw new Error('Web Crypto / IndexedDB not available');
  const check = validatePassphrase(passphrase);
  if (!check.valid) throw new Error(check.hint ?? 'Passphrase too weak');
  const existing = await loadBlob();
  if (existing) throw new Error('Vault already exists. Unlock it or destroy it first.');

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERS);
  const map = new Map<string, string>();
  const blob = await encryptMap(key, salt, map);
  await putMemory(VAULT_KEY, blob);

  derivedKey = key;
  plaintext = map;
  cachedBlob = blob;
  notify();
}

export async function unlockVault(passphrase: string): Promise<boolean> {
  if (!isSupported()) return false;
  const blob = await loadBlob();
  if (!blob) return false;
  let key: CryptoKey;
  try {
    key = await deriveKey(passphrase, base64ToBytes(blob.salt), blob.iters);
  } catch {
    return false;
  }
  try {
    const map = await decryptBlob(key, blob);
    derivedKey = key;
    plaintext = map;
    hiddenSince = null;
    notify();
    return true;
  } catch {
    // AES-GCM auth failure = wrong passphrase or tampered blob.
    return false;
  }
}

export function lockVault(): void {
  derivedKey = null;
  plaintext = null;
  hiddenSince = null;
  notify();
}

export async function destroyVault(): Promise<void> {
  await deleteMemory(VAULT_KEY);
  cachedBlob = null;
  lockVault();
}

export function listSecrets(): Map<string, string> {
  if (!plaintext) throw new Error('Vault is locked');
  return new Map(plaintext);
}

export function getSecret(key: string): string | undefined {
  if (!plaintext) throw new Error('Vault is locked');
  return plaintext.get(key);
}

async function persistCurrent(): Promise<void> {
  if (!derivedKey || !plaintext) throw new Error('Vault is locked');
  const blob = cachedBlob;
  if (!blob) throw new Error('Vault blob missing');
  const salt = base64ToBytes(blob.salt);
  const next = await encryptMap(derivedKey, salt, plaintext);
  await putMemory(VAULT_KEY, next);
  cachedBlob = next;
}

export async function setSecret(key: string, value: string): Promise<void> {
  if (!plaintext) throw new Error('Vault is locked');
  if (value) {
    plaintext.set(key, value);
  } else {
    plaintext.delete(key);
  }
  await persistCurrent();
  notify();
}

export async function deleteSecret(key: string): Promise<void> {
  if (!plaintext) throw new Error('Vault is locked');
  plaintext.delete(key);
  await persistCurrent();
  notify();
}

// ── Auto-lock on prolonged tab hidden ──────────────────────────────────────
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!derivedKey) return;
    if (document.visibilityState === 'hidden') {
      hiddenSince = Date.now();
    } else if (hiddenSince !== null) {
      if (Date.now() - hiddenSince >= IDLE_LOCK_MS) lockVault();
      hiddenSince = null;
    }
  });
}
