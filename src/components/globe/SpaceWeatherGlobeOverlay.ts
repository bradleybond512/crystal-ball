/**
 * Cesium globe overlay for space-weather state.
 *
 * Consumes the pure descriptors from `services/spaceweather/globe-overlay.ts`
 * and paints them onto a CustomDataSource:
 *   - Aurora oval as a polyline ring at the visibility latitude (north +
 *     mirrored south), clamped to ground.
 *   - Subsolar X-flare halo as a CallbackProperty-driven ellipse — the
 *     radius triangle-waves between innerRadiusM and outerRadiusM each
 *     pulsePeriodMs.
 *
 * The G3+ banner is NOT this component's job — `EEWStatusBar` already
 * consumes `deriveSpaceWxBanner` via `status-bar-poller`.
 */

import {
  Cartesian3,
  Color,
  ColorMaterialProperty,
  type CustomDataSource,
  HeightReference,
} from 'cesium';
import { timeCoherentRadius } from '@/services/globe/time-coherent-radius';

import {
  
  flarePulseRadiusAt,
  type GlobeOverlayDescriptor,
} from '@/services/spaceweather/globe-overlay';
import type { SpaceWxStatus } from '@/services/spaceweather/swpc-monitor';
import { getApiBaseUrl } from '@/services/runtime';

const FLARE_PULSE_COLOR = '#ffaa00';

export interface SpaceWeatherLayerLike {
  source: CustomDataSource;
}

export async function fetchSpaceWxStatus(
  signal?: AbortSignal,
): Promise<SpaceWxStatus | null> {
  try {
    const r = await fetch(`${getApiBaseUrl()}/api/spaceweather/status`, {
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!r.ok) return null;
    const data = await r.json() as SpaceWxStatus;
    if (!data || typeof data !== 'object' || !Array.isArray(data.earthwardCmes)) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function renderSpaceWeatherDescriptor(
  layer: SpaceWeatherLayerLike,
  descriptor: GlobeOverlayDescriptor,
  nowFn: () => number = Date.now,
): void {
  if (!descriptor.visible) return;

  if (descriptor.aurora) {
    const a = descriptor.aurora;
    const lineColor = new Color(a.color.r, a.color.g, a.color.b, a.color.a);
    const material = new ColorMaterialProperty(lineColor);

    layer.source.entities.add({
      polyline: {
        positions: ringToCartesian(a.ringNorth),
        width: a.widthPx,
        material,
        clampToGround: true,
      },
      name: `aurora-ring-north-lat${a.latN.toFixed(0)}`,
    });

    layer.source.entities.add({
      polyline: {
        positions: ringToCartesian(a.ringSouth),
        width: a.widthPx,
        material,
        clampToGround: true,
      },
      name: `aurora-ring-south-lat${a.latS.toFixed(0)}`,
    });
  }

  if (descriptor.flarePulse) {
    const pulse = descriptor.flarePulse;
    const startMs = nowFn();
    // Time-coherent so both ellipse axes read one radius per frame; a raw
    // CallbackProperty can grow between the semiMajor/semiMinor reads and throw
    // "semiMajorAxis must be >= semiMinorAxis", halting the Cesium render loop.
    const radiusCallback = timeCoherentRadius(
      () => flarePulseRadiusAt(nowFn() - startMs, pulse),
    );
    const fill = Color.fromCssColorString(FLARE_PULSE_COLOR).withAlpha(0.35);
    const outline = Color.fromCssColorString(FLARE_PULSE_COLOR);

    layer.source.entities.add({
      position: Cartesian3.fromDegrees(pulse.subsolarLonDeg, pulse.subsolarLatDeg),
      ellipse: {
        semiMajorAxis: radiusCallback,
        semiMinorAxis: radiusCallback,
        material: new ColorMaterialProperty(fill),
        outline: true,
        outlineColor: outline,
        heightReference: HeightReference.CLAMP_TO_GROUND,
      },
      name: 'flare-pulse-subsolar',
    });
  }
}

function ringToCartesian(ring: readonly [number, number][]): Cartesian3[] {
  const flat: number[] = [];
  for (const [lon, lat] of ring) flat.push(lon, lat);
  return Cartesian3.fromDegreesArray(flat);
}



export {buildOverlayDescriptor} from '@/services/spaceweather/globe-overlay';