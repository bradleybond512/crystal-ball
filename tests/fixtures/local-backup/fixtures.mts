import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync } from 'node:crypto';

export const passphrase = 'synthetic backup password';
export const ids = ['saved-places', 'entity-watchlist', 'webcam-pins'];
export const place = (changes = {}) => ({ id: 'home', name: '', lat: 0, lon: 0, radiusKm: 1, tags: ['home'], priority: 0, notes: '', offlinePinned: false, primary: true, source: 'manual', sortIndex: 0, createdAt: 0, updatedAt: 0, ...changes });
export const entity = (changes = {}) => ({ id: 'entity-a', label: '', keywords: ['', 'same', 'same'], ...changes });
export const store = (id, records) => ({ id, schemaVersion: 1, count: records.length, records });
export const backup = (stores = [store(ids[0], [place()]), store(ids[1], [entity()]), store(ids[2], ['cam-b', 'cam-a'])]) => ({ version: 1, createdAtMs: 123, stores });
export const destination = (stores = backup().stores) => ({ stores });
export const canonical = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]));
  return value;
}
export function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export const fingerprint = stores => createHash('sha256').update('crystalball-local-backup-destination-v1\0').update(canonical(stores)).digest('hex');
export function independentArchive(plaintext, password = passphrase) {
  const bytes = typeof plaintext === 'string' ? Buffer.from(plaintext) : Buffer.from(plaintext);
  const header = Buffer.alloc(48);
  header.set(Buffer.from('CBSTATE\0')); header[8] = 1; header[9] = 1; header.writeUInt32BE(600_000, 12);
  header.set(Buffer.from(Array.from({ length: 16 }, (_, i) => i)), 16);
  header.set(Buffer.from(Array.from({ length: 12 }, (_, i) => i + 16)), 32);
  header.writeUInt32BE(bytes.length + 16, 44);
  const key = pbkdf2Sync(password, header.subarray(16, 32), 600_000, 32, 'sha256');
  const cipher = createCipheriv('aes-256-gcm', key, header.subarray(32, 44), { authTagLength: 16 });
  cipher.setAAD(Buffer.concat([Buffer.from('crystalball-local-backup-v1\0'), header]));
  return Buffer.concat([header, cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
}
export function independentDecrypt(archive, password = passphrase) {
  const bytes = Buffer.from(archive), header = bytes.subarray(0, 48);
  const key = pbkdf2Sync(password, header.subarray(16, 32), 600_000, 32, 'sha256');
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(32, 44), { authTagLength: 16 });
  decipher.setAAD(Buffer.concat([Buffer.from('crystalball-local-backup-v1\0'), header]));
  decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([decipher.update(bytes.subarray(48, -16)), decipher.final()]);
}
export async function withGlobal(name, value, action) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  try { return await action(); } finally {
    if (previous) Object.defineProperty(globalThis, name, previous); else Reflect.deleteProperty(globalThis, name);
  }
}
