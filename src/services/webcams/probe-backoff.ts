/** Next delay (ms) given consecutive failures: base*2^fails, capped, with ±20% jitter. rand∈[0,1). */
export function nextProbeDelay(fails: number, baseMs = 60_000, capMs = 15 * 60_000, rand = 0.5): number {
  const raw = Math.min(capMs, baseMs * 2 ** Math.max(0, fails));
  return Math.round(raw * (0.8 + 0.4 * rand));
}
