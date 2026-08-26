import type {
  EmergencyPackBodiesBoundary,
  EmergencyPackMetadataBoundary,
} from './emergency-pack-store';

const DEFAULT_CACHE_NAME = 'wm-emergency-pack-v2';
const METADATA_PREFIX = 'wm-emergency-pack-v2:';
const BODY_REQUEST_ORIGIN = 'https://crystal-ball.invalid/__emergency-pack-v2__/';
const MAX_KEY_LENGTH = 4096;

export interface BrowserMetadataStorageBoundary {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface BrowserCacheBoundary {
  put(request: RequestInfo | URL, response: Response): Promise<void>;
  match(request: RequestInfo | URL): Promise<Response | undefined>;
  delete(request: RequestInfo | URL): Promise<boolean>;
}

export interface BrowserCacheStorageBoundary {
  open(name: string): Promise<BrowserCacheBoundary>;
}

export interface EmergencyPackBrowserAdaptersInput {
  cacheStorage: BrowserCacheStorageBoundary;
  metadataStorage: BrowserMetadataStorageBoundary;
  cacheName?: string;
  crypto?: Pick<Crypto, 'subtle'>;
}

function validCacheName(value: string): boolean {
  return value.length > 0 && value.length <= 128 && /^[a-zA-Z0-9._-]+$/.test(value);
}

function requireMetadataKey(key: string): void {
  if (!key.startsWith(METADATA_PREFIX) || key.length > MAX_KEY_LENGTH) {
    throw new TypeError('invalid emergency pack metadata key');
  }
}

function bodyRequestUrl(key: string): string {
  if (key.length === 0 || key.length > MAX_KEY_LENGTH) {
    throw new TypeError('invalid emergency pack body key');
  }
  return `${BODY_REQUEST_ORIGIN}${encodeURIComponent(key)}`;
}

function exactUtf8Body(body: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(body);
  if (new TextDecoder().decode(encoded) !== body) throw new TypeError('body is not exact UTF-8');
  return Uint8Array.from(encoded).buffer;
}

function createMetadataBoundary(
  storage: BrowserMetadataStorageBoundary,
): EmergencyPackMetadataBoundary {
  return {
    getItem(key: string): string | null {
      requireMetadataKey(key);
      return storage.getItem(key);
    },
    setItem(key: string, value: string): void {
      requireMetadataKey(key);
      storage.setItem(key, value);
    },
    removeItem(key: string): void {
      requireMetadataKey(key);
      storage.removeItem(key);
    },
    keys(): string[] {
      const keys: string[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key?.startsWith(METADATA_PREFIX) && key.length <= MAX_KEY_LENGTH) keys.push(key);
      }
      return keys;
    },
  };
}

function createBodiesBoundary(
  cacheStorage: BrowserCacheStorageBoundary,
  cacheName: string,
): EmergencyPackBodiesBoundary {
  return {
    async put(key: string, body: string): Promise<void> {
      const requestUrl = bodyRequestUrl(key);
      const encoded = exactUtf8Body(body);
      const cache = await cacheStorage.open(cacheName);
      await cache.put(requestUrl, new Response(encoded, {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      }));
    },
    async get(key: string): Promise<string | null> {
      const cache = await cacheStorage.open(cacheName);
      const response = await cache.match(bodyRequestUrl(key));
      return response ? response.text() : null;
    },
    async delete(key: string): Promise<void> {
      const cache = await cacheStorage.open(cacheName);
      await cache.delete(bodyRequestUrl(key));
    },
  };
}

export function createEmergencyPackBrowserAdapters(input: EmergencyPackBrowserAdaptersInput): {
  metadata: EmergencyPackMetadataBoundary;
  bodies: EmergencyPackBodiesBoundary;
  digest(body: string): Promise<string>;
} {
  const cacheName = input.cacheName ?? DEFAULT_CACHE_NAME;
  if (!validCacheName(cacheName)) throw new TypeError('invalid emergency pack cache name');
  return {
    metadata: createMetadataBoundary(input.metadataStorage),
    bodies: createBodiesBoundary(input.cacheStorage, cacheName),
    async digest(body: string): Promise<string> {
      const cryptoProvider = input.crypto ?? globalThis.crypto;
      if (!cryptoProvider?.subtle) throw new Error('Web Crypto unavailable');
      const digest = await cryptoProvider.subtle.digest('SHA-256', exactUtf8Body(body));
      return [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    },
  };
}
