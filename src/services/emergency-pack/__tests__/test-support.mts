import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const NOW = Date.parse('2026-08-25T15:00:00.000Z');
export const PLACE_ID = 'home';
export const PROFILE = 'v2|home|41.61110|-86.72250|25.00';
export const REQUIRED_KINDS = [
  'lifelines',
  'alerts',
  'route-primary',
  'offline-map',
  'comms-plan',
  'contacts',
] as const;

export interface ReceiptFixture {
  kind: string;
  profileFingerprint: string;
  cacheKey: string;
  sha256: string;
  byteLength: number;
  itemCount: number;
  capturedAt: string;
  expiresAt: string;
  verifiedAt: string;
  semanticState: string;
  summary: string;
}

export interface ManifestFixture {
  schemaVersion: 2;
  packId: string;
  placeId: string;
  profileFingerprint: string;
  requiredKinds: string[];
  optionalKinds: string[];
  receipts: ReceiptFixture[];
  previousPackId: string | null;
  createdAt: string;
  committedAt: string;
  migration: null | { source: 'lifeline-pack-v1'; migratedAt: string };
}

export function receipt(kind: string, overrides: Partial<ReceiptFixture> = {}): ReceiptFixture {
  const body = JSON.stringify({ kind, placeId: PLACE_ID, profileFingerprint: PROFILE });
  return {
    kind,
    profileFingerprint: PROFILE,
    cacheKey: `wm-emergency-pack:pack-1:${kind}`,
    sha256: createHash('sha256').update(body).digest('hex'),
    byteLength: new TextEncoder().encode(body).byteLength,
    itemCount: 1,
    capturedAt: new Date(NOW - 60_000).toISOString(),
    expiresAt: new Date(NOW + 60 * 60_000).toISOString(),
    verifiedAt: new Date(NOW - 30_000).toISOString(),
    semanticState: 'verified',
    summary: `${kind} captured`,
    ...overrides,
  };
}

export function manifest(overrides: Partial<ManifestFixture> = {}): ManifestFixture {
  return {
    schemaVersion: 2,
    packId: 'pack-1',
    placeId: PLACE_ID,
    profileFingerprint: PROFILE,
    requiredKinds: [...REQUIRED_KINDS],
    optionalKinds: ['route-alternate'],
    receipts: REQUIRED_KINDS.map((kind) => receipt(kind)),
    previousPackId: null,
    createdAt: new Date(NOW - 60_000).toISOString(),
    committedAt: new Date(NOW - 30_000).toISOString(),
    migration: null,
    ...overrides,
  };
}

export function requireFunction<T extends object, K extends keyof T>(api: T, name: K): NonNullable<T[K]> {
  const value = api[name];
  assert.equal(typeof value, 'function', `${String(name)} should be exported`);
  return value as NonNullable<T[K]>;
}

export class MemoryMetadata {
  readonly values = new Map<string, string>();
  fail: ((key: string) => boolean) | null = null;

  constructor(readonly operations: string[] = []) {}

  getItem(key: string): string | null {
    this.operations.push(`metadata:get:${key}`);
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.operations.push(`metadata:set:${key}`);
    if (this.fail?.(key)) throw new Error('metadata write failed');
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.operations.push(`metadata:remove:${key}`);
    this.values.delete(key);
  }

  keys(): string[] {
    return [...this.values.keys()];
  }
}

export class MemoryBodies {
  readonly values = new Map<string, string>();
  failPut = false;
  alterReadback = false;

  constructor(readonly operations: string[] = []) {}

  async put(key: string, body: string): Promise<void> {
    this.operations.push(`body:put:${key}`);
    if (this.failPut) throw new Error('quota exceeded');
    this.values.set(key, body);
  }

  async get(key: string): Promise<string | null> {
    this.operations.push(`body:get:${key}`);
    const body = this.values.get(key) ?? null;
    return this.alterReadback && body !== null ? `${body}corrupt` : body;
  }

  async delete(key: string): Promise<void> {
    this.operations.push(`body:delete:${key}`);
    this.values.delete(key);
  }
}

export function digest(body: string): Promise<string> {
  return Promise.resolve(createHash('sha256').update(body).digest('hex'));
}
