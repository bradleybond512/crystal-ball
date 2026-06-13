/**
 * Baltic Dry Index (BDI) live-feed parser (pure-deterministic).
 *
 * stooq serves the BDI as a daily CSV at
 * `https://stooq.com/q/d/l/?s=bdi&i=d` with the header
 * `Date,Open,High,Low,Close,Volume`. The most recent observation is the
 * LAST data row; the Close column (index 4) is the index value we want.
 *
 * The actual HTTP fetch + caching + FRED fallback lives in the sidecar
 * (`/api/supplychain/bdi`); this module is the canonical parse so it can be
 * unit-tested in isolation and mirrored by the sidecar's inline copy.
 */

export interface BdiReading {
  bdi: number;
  date: string;
}

/**
 * Extract the most-recent BDI Close from a stooq daily CSV.
 * Throws when there are no data rows, the last row is malformed (fewer than
 * the six expected columns), or the Close column is not a finite number.
 */
export function parseBdiCloseFromCsv(csv: string): BdiReading {
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2) {
    throw new Error('BDI CSV has no data rows');
  }
  const cols = lines[lines.length - 1]!.split(',');
  if (cols.length < 5) {
    throw new Error('BDI CSV last row malformed');
  }
  const bdi = parseFloat(cols[4]!.trim());
  if (!Number.isFinite(bdi)) {
    throw new Error('BDI close is not a finite number');
  }
  return { bdi, date: cols[0]!.trim() };
}
