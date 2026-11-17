import { BackupError, MAX_PLAINTEXT_BYTES, decodeBackup, encodeBackup, utf8Size } from './schema';
import type { Backup } from './schema';

export const HEADER_BYTES = 48;
export const PBKDF2_ITERATIONS = 600_000;
export const MAX_CIPHERTEXT_BYTES = MAX_PLAINTEXT_BYTES + 16;
export const MAX_ARCHIVE_BYTES = HEADER_BYTES + MAX_CIPHERTEXT_BYTES;
const MAGIC = [0x43, 0x42, 0x53, 0x54, 0x41, 0x54, 0x45, 0x00];
const AAD_DOMAIN = new TextEncoder().encode('crystalball-local-backup-v1\0');

function cryptoProvider(): Crypto {
  try {
    const provider = globalThis.crypto;
    if (provider && typeof provider.getRandomValues === 'function'
      && typeof provider.subtle?.importKey === 'function'
      && typeof provider.subtle.deriveKey === 'function'
      && typeof provider.subtle.encrypt === 'function'
      && typeof provider.subtle.decrypt === 'function') return provider;
  } catch { /* Report only the bounded public error. */ }
  throw new BackupError('crypto-unavailable');
}
function passphraseBytes(passphrase: string): Uint8Array<ArrayBuffer> {
  try {
    if (typeof passphrase !== 'string' || utf8Size(passphrase, 1024) > 1024 || [...passphrase].length < 12) {
      throw new BackupError('invalid-passphrase');
    }
    return new TextEncoder().encode(passphrase);
  } catch { throw new BackupError('invalid-passphrase'); }
}
function additionalData(header: Uint8Array): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(AAD_DOMAIN.length + HEADER_BYTES);
  result.set(AAD_DOMAIN);
  result.set(header, AAD_DOMAIN.length);
  return result;
}
async function deriveKey(provider: Crypto, password: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  try {
    const base = await provider.subtle.importKey('raw', password, 'PBKDF2', false, ['deriveKey']);
    return await provider.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, [usage],
    );
  } catch { throw new BackupError('crypto-unavailable'); }
}
function archiveSnapshot(input: Uint8Array): Uint8Array<ArrayBuffer> {
  try {
    if (!(input instanceof Uint8Array)) throw new BackupError('invalid-archive');
    if (input.byteLength > MAX_ARCHIVE_BYTES) throw new BackupError('limit-exceeded');
    if (input.byteLength < HEADER_BYTES + 16) throw new BackupError('invalid-archive');
    const bytes = new Uint8Array(input.byteLength);
    bytes.set(input);
    const view = new DataView(bytes.buffer);
    if (!MAGIC.every((byte, index) => byte === bytes[index]) || bytes[10] !== 0 || bytes[11] !== 0) {
      throw new BackupError('invalid-archive');
    }
    if (bytes[8] !== 1 || bytes[9] !== 1 || view.getUint32(12, false) !== PBKDF2_ITERATIONS) {
      throw new BackupError('unsupported-format');
    }
    const ciphertextLength = view.getUint32(44, false);
    if (ciphertextLength > MAX_CIPHERTEXT_BYTES) throw new BackupError('limit-exceeded');
    if (ciphertextLength < 16 || bytes.length !== HEADER_BYTES + ciphertextLength) throw new BackupError('invalid-archive');
    return bytes;
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError('invalid-archive');
  }
}
export async function encryptBackup(snapshot: unknown, passphrase: string): Promise<Uint8Array<ArrayBuffer>> {
  const plaintext = encodeBackup(snapshot);
  const password = passphraseBytes(passphrase);
  const provider = cryptoProvider();
  const header = new Uint8Array(HEADER_BYTES);
  header.set(MAGIC);
  header[8] = 1;
  header[9] = 1;
  const view = new DataView(header.buffer);
  view.setUint32(12, PBKDF2_ITERATIONS, false);
  view.setUint32(44, plaintext.length + 16, false);
  try {
    header.set(provider.getRandomValues(new Uint8Array(16)), 16);
    header.set(provider.getRandomValues(new Uint8Array(12)), 32);
  } catch { throw new BackupError('crypto-unavailable'); }
  const salt = header.slice(16, 32);
  const iv = header.slice(32, 44);
  const aad = additionalData(header);
  const key = await deriveKey(provider, password, salt, 'encrypt');
  try {
    const ciphertext = new Uint8Array(await provider.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, key, plaintext));
    if (ciphertext.length !== plaintext.length + 16) throw new BackupError('crypto-unavailable');
    const result = new Uint8Array(HEADER_BYTES + ciphertext.length);
    result.set(header);
    result.set(ciphertext, HEADER_BYTES);
    return result;
  } catch { throw new BackupError('crypto-unavailable'); }
}
export async function decryptBackup(archive: Uint8Array, passphrase: string): Promise<Backup> {
  const bytes = archiveSnapshot(archive);
  const password = passphraseBytes(passphrase);
  const provider = cryptoProvider();
  const header = bytes.slice(0, HEADER_BYTES);
  const salt = header.slice(16, 32);
  const iv = header.slice(32, 44);
  const aad = additionalData(header);
  const key = await deriveKey(provider, password, salt, 'decrypt');
  let plaintext: ArrayBuffer;
  try {
    plaintext = await provider.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, key, bytes.subarray(HEADER_BYTES));
  } catch { throw new BackupError('authentication-failed'); }
  return decodeBackup(new Uint8Array(plaintext));
}
