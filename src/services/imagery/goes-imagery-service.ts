/**
 * GOES imagery service — thin renderer-side fetch wrapper over the
 * sidecar `/api/satellite/goes-imagery` route. Pure catalog logic lives
 * in goes-catalog.ts; this module is the I/O edge.
 */

import { getApiBaseUrl } from '../runtime';
import {
  isValidSelection,
  type GoesSatelliteId,
  type GoesSectorId,
} from './goes-catalog';

export interface GoesImageryFrame {
  timestamp: string;
  epochMs: number;
  url: string;
}

export interface GoesImageryResponse {
  satellite: GoesSatelliteId;
  sector: GoesSectorId;
  product: string;
  latestUrl: string;
  stillUrl: string;
  animationSize: string;
  stillSize: string;
  frames: GoesImageryFrame[];
  frameCount: number;
  latestFrameAt: string | null;
  degraded: boolean;
  reason?: string;
  generatedAt: string;
}

export async function fetchGoesImagery(
  sat: GoesSatelliteId,
  sector: GoesSectorId,
  product: string,
  signal?: AbortSignal,
): Promise<GoesImageryResponse> {
  if (!isValidSelection(sat, sector, product)) {
    throw new Error(`Invalid GOES selection: ${sat}/${sector}/${product}`);
  }
  const url =
    `${getApiBaseUrl()}/api/satellite/goes-imagery` +
    `?sat=${encodeURIComponent(sat)}` +
    `&sector=${encodeURIComponent(sector)}` +
    `&product=${encodeURIComponent(product)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`goes-imagery HTTP ${res.status}`);
  }
  return (await res.json()) as GoesImageryResponse;
}
