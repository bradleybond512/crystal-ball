export interface FrameSample {
  width: number;
  height: number;
  /** RGBA pixel buffer in row-major order. Length = width * height * 4. */
  pixels: Uint8ClampedArray;
}

export interface SmokeAnalysis {
  smokeProbability: number;
  motionPixels: number;
  totalPixels: number;
  changedFraction: number;
  meanDelta: number;
  upperRegionMeanDelta: number;
  isAlert: boolean;
}

export const SMOKE_DETECT_DOWNSAMPLE_W = 160;
export const SMOKE_DETECT_DOWNSAMPLE_H = 120;
export const SMOKE_INTERVAL_MS = 5000;

// Trigger thresholds — calibrated from the spec.
const ALERT_MEAN_DELTA = 15;
const ALERT_CHANGED_FRACTION = 0.08;
const PIXEL_CHANGE_THRESHOLD = 24; // per-channel delta required to count a pixel as "changed"

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Pure pixel-delta analysis. The browser-side caller is responsible for
 *  sampling two frames (5s apart, downsampled to 160×120) and providing
 *  them here; this module computes the motion / smoke signature without
 *  any DOM or network. */
export function analyzeFrameDelta(a: FrameSample, b: FrameSample): SmokeAnalysis {
  if (a.width !== b.width || a.height !== b.height) {
    return {
      smokeProbability: 0,
      motionPixels: 0,
      totalPixels: 0,
      changedFraction: 0,
      meanDelta: 0,
      upperRegionMeanDelta: 0,
      isAlert: false,
    };
  }
  const W = a.width;
  const H = a.height;
  const total = W * H;
  if (total === 0) {
    return {
      smokeProbability: 0,
      motionPixels: 0,
      totalPixels: 0,
      changedFraction: 0,
      meanDelta: 0,
      upperRegionMeanDelta: 0,
      isAlert: false,
    };
  }
  const upperCutoff = Math.floor(H / 3);

  let motionPixels = 0;
  let totalDelta = 0;
  let upperDelta = 0;
  let upperCount = 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4;
      const dr = Math.abs(a.pixels[idx]! - b.pixels[idx]!);
      const dg = Math.abs(a.pixels[idx + 1]! - b.pixels[idx + 1]!);
      const db = Math.abs(a.pixels[idx + 2]! - b.pixels[idx + 2]!);
      const meanChannel = (dr + dg + db) / 3;
      totalDelta += meanChannel;
      if (meanChannel > PIXEL_CHANGE_THRESHOLD) motionPixels++;
      if (y < upperCutoff) {
        upperDelta += meanChannel;
        upperCount++;
      }
    }
  }

  const meanDelta = totalDelta / total;
  const upperRegionMeanDelta = upperCount > 0 ? upperDelta / upperCount : 0;
  const changedFraction = motionPixels / total;

  // Smoke signature: high upper-third delta plus enough changed pixels overall.
  const upperWeight = upperRegionMeanDelta / 30; // normalize against expected dynamic range
  const fractionWeight = changedFraction * 5;
  const score = upperWeight + fractionWeight - 0.5;
  const smokeProbability = sigmoid(score);

  const isAlert =
    upperRegionMeanDelta > ALERT_MEAN_DELTA && changedFraction > ALERT_CHANGED_FRACTION;

  return {
    smokeProbability,
    motionPixels,
    totalPixels: total,
    changedFraction,
    meanDelta,
    upperRegionMeanDelta,
    isAlert,
  };
}

// ── Browser-side sampler ───────────────────────────────────────────────

/** Loads an image URL into a downsampled FrameSample. Browser-only;
 *  callers from Node tests should use the pure analyzeFrameDelta with
 *  hand-built FrameSample fixtures. */
export async function sampleFrame(
  snapshotUrl: string,
  cacheBust: number = Date.now(),
): Promise<FrameSample | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null;
  return new Promise<FrameSample | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.addEventListener('load', () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = SMOKE_DETECT_DOWNSAMPLE_W;
        canvas.height = SMOKE_DETECT_DOWNSAMPLE_H;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, SMOKE_DETECT_DOWNSAMPLE_W, SMOKE_DETECT_DOWNSAMPLE_H);
        const data = ctx.getImageData(0, 0, SMOKE_DETECT_DOWNSAMPLE_W, SMOKE_DETECT_DOWNSAMPLE_H);
        resolve({ width: data.width, height: data.height, pixels: data.data });
      } catch {
        resolve(null);
      }
    });
    img.addEventListener('error', () => resolve(null));
    const sep = snapshotUrl.includes('?') ? '&' : '?';
    img.src = `${snapshotUrl}${sep}smoke=${cacheBust}`;
  });
}

export interface SmokeDetectorConfig {
  intervalMs?: number;
  /** Optional override for sampleFrame (testing). */
  sampler?: (url: string, t: number) => Promise<FrameSample | null>;
}

export interface SmokeDetectionResult {
  camId: string;
  analysis: SmokeAnalysis | null;
  ranAt: number;
}

/** High-level: runs analyzeFrameDelta against two samples. Pure given the
 *  sampler — the caller can mock it. */
export async function runSmokeDetection(
  camId: string,
  snapshotUrl: string,
  config: SmokeDetectorConfig = {},
): Promise<SmokeDetectionResult> {
  const sampler = config.sampler ?? sampleFrame;
  const intervalMs = config.intervalMs ?? SMOKE_INTERVAL_MS;
  const ranAt = Date.now();
  const a = await sampler(snapshotUrl, ranAt);
  if (!a) return { camId, analysis: null, ranAt };
  await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  const b = await sampler(snapshotUrl, Date.now());
  if (!b) return { camId, analysis: null, ranAt };
  return { camId, analysis: analyzeFrameDelta(a, b), ranAt };
}
