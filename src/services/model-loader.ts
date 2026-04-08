/**
 * 3D Aircraft Model Loader — glTF/glb cache with type-to-model mapping
 *
 * Lazy-loads aircraft models from public/models/aircraft/ on first use.
 * Deduplicates in-flight fetch requests. Caches ArrayBuffer in memory.
 */

import type { MilitaryAircraftType } from '@/types';

export interface AircraftModel {
  url: string;
  buffer: ArrayBuffer;
}

const MODEL_BASE = '/models/aircraft';

/** Maps MilitaryAircraftType to glb filename */
const MILITARY_MODEL_MAP: Record<MilitaryAircraftType, string> = {
  fighter: 'f16.glb',
  bomber: 'b52.glb',
  transport: 'c17.glb',
  tanker: 'kc135.glb',
  awacs: 'e3.glb',
  reconnaissance: 'e3.glb',
  helicopter: 'blackhawk.glb',
  drone: 'mq9.glb',
  patrol: 'c130.glb',
  special_ops: 'c130.glb',
  vip: 'generic-jet.glb',
  unknown: 'generic-arrow.glb',
};

/** Maps common ICAO type designators to glb filename */
const ICAO_MODEL_MAP: Record<string, string> = {
  B738: 'b737.glb',
  B739: 'b737.glb',
  B737: 'b737.glb',
  A320: 'a320.glb',
  A321: 'a320.glb',
  A319: 'a320.glb',
  B77W: 'generic-widebody.glb',
  B772: 'generic-widebody.glb',
  B788: 'generic-widebody.glb',
  A332: 'generic-widebody.glb',
  A333: 'generic-widebody.glb',
  A388: 'generic-widebody.glb',
  C17:  'c17.glb',
  C130: 'c130.glb',
  C5M:  'c17.glb',
  F16:  'f16.glb',
  F15:  'f16.glb',
  F35:  'f35.glb',
  B52H: 'b52.glb',
  H60:  'blackhawk.glb',
  AH64: 'apache.glb',
  V22:  'generic-arrow.glb',
};

const FALLBACK_MODEL = 'generic-arrow.glb';

class ModelLoaderSingleton {
  private cache = new Map<string, Promise<ArrayBuffer>>();

  /** Get the glb URL for a military aircraft type */
  getUrlForMilitary(type: MilitaryAircraftType): string {
 const file = MILITARY_MODEL_MAP[type] ?? FALLBACK_MODEL;
 return `${MODEL_BASE}/${file}`;
  }

  /** Get the glb URL for an ICAO type designator */
  getUrlForIcao(typeCode: string): string {
 const file = ICAO_MODEL_MAP[typeCode.toUpperCase()] ?? FALLBACK_MODEL;
 return `${MODEL_BASE}/${file}`;
  }

  /** Get the fallback model URL */
  getFallbackUrl(): string {
 return `${MODEL_BASE}/${FALLBACK_MODEL}`;
  }

  /** Fetch and cache a glb model by URL */
  async loadModel(url: string): Promise<ArrayBuffer> {
 const existing = this.cache.get(url);
 if (existing) return existing;

 const promise = fetch(url)
 .then(res => {
 if (!res.ok) throw new Error(`Model fetch failed: ${url} (${String(res.status)})`);
 return res.arrayBuffer();
 })
 .catch(error => {
 this.cache.delete(url);
 throw error;
 });

 this.cache.set(url, promise);
 return promise;
  }

  /** Preload a set of commonly used models */
  preload(urls: string[]): void {
 for (const url of urls) {
 void this.loadModel(url);
 }
  }
}

export const modelLoader = new ModelLoaderSingleton();
