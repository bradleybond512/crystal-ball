import type {
  EmergencyPackBodiesBoundary,
  EmergencyPackMetadataBoundary,
} from './emergency-pack-store';
import { EMERGENCY_PACK_ARTIFACT_BYTE_CAPS } from './emergency-pack-schema';
import type { EmergencyPackArtifactKind } from './emergency-pack-schema';

const DEFAULT_CACHE_NAME = 'wm-emergency-pack-v2';
const METADATA_PREFIX = 'wm-emergency-pack-v2:';
const BODY_REQUEST_ORIGIN = 'https://crystal-ball.invalid/__emergency-pack-v2__/';
const MAX_KEY_LENGTH = 4096;
const BODY_KEY_PREFIX = `${METADATA_PREFIX}body:`;

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

function bodyByteCap(key: string): number {
  if (!key.startsWith(BODY_KEY_PREFIX) || key.length > MAX_KEY_LENGTH) {
    throw new TypeError('invalid emergency pack body key');
  }
  const encodedPackAndKind = key.slice(BODY_KEY_PREFIX.length);
  const separator = encodedPackAndKind.lastIndexOf(':');
  if (separator <= 0) throw new TypeError('invalid emergency pack body key');
  const encodedPackId = encodedPackAndKind.slice(0, separator);
  const kind = encodedPackAndKind.slice(separator + 1) as EmergencyPackArtifactKind;
  try {
    if (encodeURIComponent(decodeURIComponent(encodedPackId)) !== encodedPackId
      || !Object.prototype.hasOwnProperty.call(EMERGENCY_PACK_ARTIFACT_BYTE_CAPS, kind)) {
      throw new TypeError('invalid emergency pack body key');
    }
  } catch {
    throw new TypeError('invalid emergency pack body key');
  }
  return EMERGENCY_PACK_ARTIFACT_BYTE_CAPS[kind];
}

function bodyRequestUrl(key: string): string {
  bodyByteCap(key);
  return `${BODY_REQUEST_ORIGIN}${encodeURIComponent(key)}`;
}

function exactUtf8Body(body: string, byteCap?: number): ArrayBuffer {
  const encoded = new TextEncoder().encode(body);
  if (byteCap !== undefined && encoded.byteLength > byteCap) {
    throw new TypeError('emergency pack body byte cap exceeded');
  }
  if (new TextDecoder().decode(encoded) !== body) throw new TypeError('body is not exact UTF-8');
  return Uint8Array.from(encoded).buffer;
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // The original validation or stream failure remains authoritative.
  }
}

async function rejectResponseBody(response: Response): Promise<never> {
  try {
    await response.body?.cancel();
  } catch {
    // Response validation remains authoritative.
  }
  throw new TypeError('invalid emergency pack body response');
}

function declaredByteLength(response: Response): number | null {
  const value = response.headers.get('content-length');
  if (value === null) return null;
  if (!/^(0|[1-9]\d*)$/.test(value)) return Number.NaN;
  const byteLength = Number(value);
  return Number.isSafeInteger(byteLength) ? byteLength : Number.NaN;
}

async function failReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  message: string,
): Promise<never> {
  await cancelReader(reader);
  reader.releaseLock();
  throw new TypeError(message);
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  try {
    return await reader.read();
  } catch {
    return failReader(reader, 'emergency pack body stream failed');
  }
}

async function decodeBoundedStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  byteCap: number,
): Promise<{ body: string; byteLength: number }> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let body = '';
  let byteLength = 0;
  while (true) {
    const chunk = await readChunk(reader);
    if (chunk.done) break;
    if (!(chunk.value instanceof Uint8Array)) {
      return failReader(reader, 'emergency pack body stream failed');
    }
    byteLength += chunk.value.byteLength;
    if (!Number.isSafeInteger(byteLength) || byteLength > byteCap) {
      return failReader(reader, 'emergency pack body byte cap exceeded');
    }
    try {
      body += decoder.decode(chunk.value, { stream: true });
    } catch {
      return failReader(reader, 'emergency pack body stream failed');
    }
  }
  try {
    body += decoder.decode();
  } catch {
    return failReader(reader, 'emergency pack body stream failed');
  }
  return { body, byteLength };
}

async function readBoundedBody(response: Response, byteCap: number): Promise<string> {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (response.status !== 200 || contentType !== 'text/plain' || response.body === null) {
    return rejectResponseBody(response);
  }

  const reader = response.body.getReader();
  const declaredLength = declaredByteLength(response);
  if (declaredLength !== null && (!Number.isSafeInteger(declaredLength) || declaredLength > byteCap)) {
    return failReader(reader, 'emergency pack body byte cap exceeded');
  }

  const { body, byteLength } = await decodeBoundedStream(reader, byteCap);
  if (declaredLength !== null && declaredLength !== byteLength) {
    return failReader(reader, 'emergency pack body length mismatch');
  }
  reader.releaseLock();
  return body;
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
      const encoded = exactUtf8Body(body, bodyByteCap(key));
      const cache = await cacheStorage.open(cacheName);
      await cache.put(requestUrl, new Response(encoded, {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      }));
    },
    async get(key: string): Promise<string | null> {
      const cache = await cacheStorage.open(cacheName);
      const response = await cache.match(bodyRequestUrl(key));
      return response ? readBoundedBody(response, bodyByteCap(key)) : null;
    },
    async delete(key: string): Promise<boolean> {
      const cache = await cacheStorage.open(cacheName);
      const requestUrl = bodyRequestUrl(key);
      await cache.delete(requestUrl);
      const retained = await cache.match(requestUrl);
      if (!retained) return true;
      try {
        await retained.body?.cancel();
      } catch {
        // The retained response remains authoritative.
      }
      return false;
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
