/**
 * Globe-overlay sidecar pusher — Layer 5 renderer side.
 *
 * The renderer is the source of truth for fused seismic events. Layer 4
 * (`globe-overlay-emitter`) computes per-event ring radii. This module
 * mirrors the resulting `GlobeSeismicOverlay[]` to the sidecar so the
 * God's Eye Cesium panel (Layer 6) and any external tools can read them
 * via HTTP without the renderer being open.
 *
 * Mirrors `sidecar-pusher.ts` (analyst state):
 *   - Desktop-only — web build skips the push entirely.
 *   - Errors are swallowed; this is a best-effort mirror.
 *   - Min interval debounce so a 1Hz tick can't blast the sidecar.
 */

import { isDesktopRuntime } from '../runtime';
import {
  buildGlobeOverlays,
  type GlobeSeismicOverlay,
} from './globe-overlay-emitter';
import type { FusedSeismicEvent } from './seismic-fusion';

const ENDPOINT = '/api/seismic-globe-overlays';
const MIN_PUSH_INTERVAL_MS = 4000;

let lastPushAt = 0;
let inFlight = false;

/**
 * Compute and push the current overlay snapshot. Returns `true` when a
 * push was attempted (regardless of HTTP outcome), `false` when the
 * call was a no-op (web build, debounced, or in-flight).
 */
export async function pushGlobeOverlays(input: {
  events: readonly FusedSeismicEvent[];
  nowMs: number;
  minMagnitude?: number;
  maxOverlays?: number;
}): Promise<boolean> {
  if (!isDesktopRuntime()) return false;
  const now = input.nowMs;
  if (now - lastPushAt < MIN_PUSH_INTERVAL_MS) return false;
  if (inFlight) return false;

  const overlays = buildGlobeOverlays(input);
  inFlight = true;
  lastPushAt = now;
  try {
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overlays, asOf: now }),
    });
  } catch {
    /* silent — best effort */
  } finally {
    inFlight = false;
  }
  return true;
}

/** Test hook: reset the debounce + in-flight gate. */
export function __resetGlobeOverlayPusher(): void {
  lastPushAt = 0;
  inFlight = false;
}

/** Test hook: build the overlay payload without pushing. */
export function __buildPayload(input: {
  events: readonly FusedSeismicEvent[];
  nowMs: number;
  minMagnitude?: number;
  maxOverlays?: number;
}): { overlays: GlobeSeismicOverlay[]; asOf: number } {
  return { overlays: buildGlobeOverlays(input), asOf: input.nowMs };
}
