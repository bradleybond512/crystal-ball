/**
 * Unit tests for firms-helpers.ts
 * Run: npx tsx --test src/components/__tests__/firms-helpers.test.mts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFirmsCsv,
  isInBbox,
  aggregateByRegion,
  aggregateConflictZones,
  getAnomalySeverity,
  formatFrp,
  summarizeSatellites,
  summarizeHotspots,
  buildDemoSummary,
  severityColor,
  REGIONS,
  CONFLICT_ZONES,
  type FirmsHotspot,
  type RegionDefinition,
} from '../firms-helpers.ts';

const HEADER =
  'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight';

function row(
  lat: number | string,
  lon: number | string,
  opts: Partial<{ ti4: string; conf: string; frp: string; sat: string; dn: string; time: string }> = {},
): string {
  const { ti4 = '320.5', conf = 'h', frp = '12.5', sat = 'N', dn = 'D', time = '0612' } = opts;
  return `${lat},${lon},${ti4},0.4,0.4,2026-06-10,${time},${sat},VIIRS,${conf},2.0NRT,295.1,${frp},${dn}`;
}

// ── parseFirmsCsv ─────────────────────────────────────────────────────────────

describe('parseFirmsCsv', () => {
  it('parses a valid CSV with all fields', () => {
    const csv = `${HEADER}\n${row(34.05, -118.25, { ti4: '330.1', conf: 'h', frp: '45.2', sat: 'N', dn: 'N' })}`;
    const out = parseFirmsCsv(csv);
    assert.equal(out.length, 1);
    const h = out[0];
    assert.equal(h.latitude, 34.05);
    assert.equal(h.longitude, -118.25);
    assert.equal(h.brightness, 330.1);
    assert.equal(h.frp, 45.2);
    assert.equal(h.confidence, 'high');
    assert.equal(h.satellite, 'N');
    assert.equal(h.daynight, 'N');
    assert.equal(h.acqDate, '2026-06-10');
    assert.equal(h.acqTime, '0612');
  });

  it('returns [] for empty string', () => {
    assert.deepEqual(parseFirmsCsv(''), []);
  });

  it('returns [] for whitespace-only string', () => {
    assert.deepEqual(parseFirmsCsv('   \n  '), []);
  });

  it('returns [] for header-only CSV (no data rows)', () => {
    assert.deepEqual(parseFirmsCsv(HEADER), []);
  });

  it('returns [] when latitude/longitude columns are missing', () => {
    const csv = 'foo,bar,baz\n1,2,3';
    assert.deepEqual(parseFirmsCsv(csv), []);
  });

  it('returns [] for non-string input', () => {
    // @ts-expect-error testing runtime guard
    assert.deepEqual(parseFirmsCsv(null), []);
    // @ts-expect-error testing runtime guard
    assert.deepEqual(parseFirmsCsv(undefined), []);
  });

  it('skips rows with NaN / invalid coordinates', () => {
    const csv = `${HEADER}\n${row('not-a-number', '10')}\n${row('10', 'xyz')}\n${row(5, 5)}`;
    const out = parseFirmsCsv(csv);
    assert.equal(out.length, 1);
    assert.equal(out[0].latitude, 5);
  });

  it('skips rows with out-of-range coordinates', () => {
    const csv = `${HEADER}\n${row(200, 10)}\n${row(10, 999)}\n${row(45, 45)}`;
    const out = parseFirmsCsv(csv);
    assert.equal(out.length, 1);
    assert.equal(out[0].latitude, 45);
  });

  it('handles malformed (short) rows gracefully', () => {
    const csv = `${HEADER}\n12.0,34.0\n${row(1, 1)}`;
    const out = parseFirmsCsv(csv);
    // short row still has valid lat/lon → kept, with defaulted fields
    assert.equal(out.length, 2);
    assert.equal(out[0].frp, 0);
    assert.equal(out[0].brightness, 0);
  });

  it('ignores blank lines between rows', () => {
    const csv = `${HEADER}\n${row(1, 1)}\n\n${row(2, 2)}\n`;
    assert.equal(parseFirmsCsv(csv).length, 2);
  });

  it('tolerates CRLF line endings', () => {
    const csv = `${HEADER}\r\n${row(1, 1)}\r\n${row(2, 2)}`;
    assert.equal(parseFirmsCsv(csv).length, 2);
  });

  it('handles quoted header fields', () => {
    const quoted = HEADER.split(',').map((c) => `"${c}"`).join(',');
    const csv = `${quoted}\n${row(1, 1)}`;
    assert.equal(parseFirmsCsv(csv).length, 1);
  });

  it('maps numeric (MODIS) confidence to bands', () => {
    const csv = `${HEADER}\n${row(1, 1, { conf: '90' })}\n${row(2, 2, { conf: '50' })}\n${row(3, 3, { conf: '10' })}`;
    const out = parseFirmsCsv(csv);
    assert.equal(out[0].confidence, 'high');
    assert.equal(out[1].confidence, 'nominal');
    assert.equal(out[2].confidence, 'low');
  });

  it('maps word-form confidence values', () => {
    const csv = `${HEADER}\n${row(1, 1, { conf: 'nominal' })}\n${row(2, 2, { conf: 'low' })}\n${row(3, 3, { conf: 'high' })}`;
    const out = parseFirmsCsv(csv);
    assert.equal(out[0].confidence, 'nominal');
    assert.equal(out[1].confidence, 'low');
    assert.equal(out[2].confidence, 'high');
  });

  it('defaults daynight to D when missing/unknown', () => {
    const csv = `${HEADER}\n${row(1, 1, { dn: '' })}`;
    assert.equal(parseFirmsCsv(csv)[0].daynight, 'D');
  });

  it('handles duplicate coordinates as separate detections', () => {
    const csv = `${HEADER}\n${row(10, 10)}\n${row(10, 10)}\n${row(10, 10)}`;
    assert.equal(parseFirmsCsv(csv).length, 3);
  });
});

// ── isInBbox ──────────────────────────────────────────────────────────────────

describe('isInBbox', () => {
  const box: [number, number, number, number] = [-10, -10, 10, 10]; // lon_min, lat_min, lon_max, lat_max

  it('returns true for a point clearly inside', () => {
    assert.equal(isInBbox(0, 0, box), true);
  });

  it('returns false for a point outside (longitude)', () => {
    assert.equal(isInBbox(0, 20, box), false);
  });

  it('returns false for a point outside (latitude)', () => {
    assert.equal(isInBbox(20, 0, box), false);
  });

  it('returns true on the boundary (inclusive)', () => {
    assert.equal(isInBbox(10, 10, box), true);
    assert.equal(isInBbox(-10, -10, box), true);
  });

  it('returns false for non-finite coordinates', () => {
    assert.equal(isInBbox(Number.NaN, 0, box), false);
    assert.equal(isInBbox(0, Number.POSITIVE_INFINITY, box), false);
  });

  it('handles a box crossing the equator/prime meridian', () => {
    const ukraine = CONFLICT_ZONES.find((z) => z.name === 'Eastern Ukraine')!;
    assert.equal(isInBbox(48.0, 38.0, ukraine.bbox), true);
    assert.equal(isInBbox(60.0, 38.0, ukraine.bbox), false);
  });
});

// ── aggregateByRegion ─────────────────────────────────────────────────────────

describe('aggregateByRegion', () => {
  const regions: RegionDefinition[] = [
    { name: 'A', bbox: [0, 0, 10, 10] },
    { name: 'B', bbox: [20, 20, 30, 30], isConflictZone: true },
  ];

  function hs(lat: number, lon: number, frp = 1, conf: FirmsHotspot['confidence'] = 'nominal'): FirmsHotspot {
    return { latitude: lat, longitude: lon, brightness: 300, frp, confidence: conf, acqDate: '', acqTime: '', satellite: 'N', daynight: 'D' };
  }

  it('counts hotspots per region', () => {
    const out = aggregateByRegion([hs(5, 5), hs(6, 6), hs(25, 25)], regions);
    assert.equal(out[0].count, 2);
    assert.equal(out[1].count, 1);
  });

  it('sums FRP per region', () => {
    const out = aggregateByRegion([hs(5, 5, 10), hs(6, 6, 5), hs(25, 25, 100)], regions);
    assert.equal(out[0].totalFrp, 15);
    assert.equal(out[1].totalFrp, 100);
  });

  it('counts only high-confidence hotspots in highConfidenceCount', () => {
    const out = aggregateByRegion(
      [hs(5, 5, 1, 'high'), hs(6, 6, 1, 'nominal'), hs(7, 7, 1, 'low'), hs(8, 8, 1, 'high')],
      regions,
    );
    assert.equal(out[0].count, 4);
    assert.equal(out[0].highConfidenceCount, 2);
  });

  it('propagates the isConflictZone flag', () => {
    const out = aggregateByRegion([], regions);
    assert.equal(out[0].isConflictZone, false);
    assert.equal(out[1].isConflictZone, true);
  });

  it('returns zeroed summaries for regions with no hotspots', () => {
    const out = aggregateByRegion([], regions);
    assert.equal(out[0].count, 0);
    assert.equal(out[0].totalFrp, 0);
    assert.equal(out[0].highConfidenceCount, 0);
  });

  it('counts a hotspot in every region whose box contains it (overlap)', () => {
    const overlapping: RegionDefinition[] = [
      { name: 'wide', bbox: [0, 0, 100, 100] },
      { name: 'narrow', bbox: [4, 4, 6, 6] },
    ];
    const out = aggregateByRegion([hs(5, 5)], overlapping);
    assert.equal(out[0].count, 1);
    assert.equal(out[1].count, 1);
  });

  it('excludes hotspots outside all regions', () => {
    const out = aggregateByRegion([hs(80, 80)], regions);
    assert.equal(out[0].count, 0);
    assert.equal(out[1].count, 0);
  });
});

// ── aggregateConflictZones ────────────────────────────────────────────────────

describe('aggregateConflictZones', () => {
  function hs(lat: number, lon: number): FirmsHotspot {
    return { latitude: lat, longitude: lon, brightness: 300, frp: 2, confidence: 'high', acqDate: '', acqTime: '', satellite: 'N', daynight: 'D' };
  }

  it('counts and severity-tags hotspots per conflict zone', () => {
    const zones = [{ name: 'Z', bbox: [0, 0, 10, 10] as [number, number, number, number], baseline: 2 }];
    // 7 hotspots vs baseline 2 → ratio 3.5 → high
    const pts = Array.from({ length: 7 }, () => hs(5, 5));
    const out = aggregateConflictZones(pts, zones);
    assert.equal(out[0].count, 7);
    assert.equal(out[0].baseline, 2);
    assert.equal(out[0].totalFrp, 14);
    assert.equal(out[0].severity, 'high');
  });

  it('reports normal severity when at/below baseline', () => {
    const zones = [{ name: 'Z', bbox: [0, 0, 10, 10] as [number, number, number, number], baseline: 10 }];
    const out = aggregateConflictZones([hs(5, 5)], zones);
    assert.equal(out[0].severity, 'normal');
  });
});

// ── getAnomalySeverity ────────────────────────────────────────────────────────

describe('getAnomalySeverity', () => {
  it('returns normal at baseline', () => {
    assert.equal(getAnomalySeverity(10, 10), 'normal');
  });

  it('returns normal just under the elevated threshold', () => {
    assert.equal(getAnomalySeverity(14, 10), 'normal'); // 1.4×
  });

  it('returns elevated at 1.5×', () => {
    assert.equal(getAnomalySeverity(15, 10), 'elevated');
  });

  it('returns high at 3×', () => {
    assert.equal(getAnomalySeverity(30, 10), 'high');
  });

  it('returns extreme at 5×', () => {
    assert.equal(getAnomalySeverity(50, 10), 'extreme');
  });

  it('returns extreme well above 5×', () => {
    assert.equal(getAnomalySeverity(89, 12), 'extreme');
  });

  it('floors baseline to 1 (zero baseline still escalates)', () => {
    assert.equal(getAnomalySeverity(5, 0), 'extreme');
    assert.equal(getAnomalySeverity(0, 0), 'normal');
    assert.equal(getAnomalySeverity(1, 0), 'normal');
    assert.equal(getAnomalySeverity(2, 0), 'elevated');
  });

  it('returns normal for zero count', () => {
    assert.equal(getAnomalySeverity(0, 8), 'normal');
  });
});

// ── formatFrp ─────────────────────────────────────────────────────────────────

describe('formatFrp', () => {
  it('formats sub-1000 values as MW (rounded)', () => {
    assert.equal(formatFrp(0), '0 MW');
    assert.equal(formatFrp(12.4), '12 MW');
    assert.equal(formatFrp(999), '999 MW');
  });

  it('formats >= 1000 as GW', () => {
    assert.equal(formatFrp(1000), '1.0 GW');
    assert.equal(formatFrp(1500), '1.5 GW');
  });

  it('drops decimals for large GW values (>= 100 GW)', () => {
    assert.equal(formatFrp(892_000), '892 GW');
    assert.equal(formatFrp(100_000), '100 GW');
  });

  it('returns 0 MW for non-finite input', () => {
    assert.equal(formatFrp(Number.NaN), '0 MW');
    assert.equal(formatFrp(Number.POSITIVE_INFINITY), '0 MW');
  });
});

// ── summarizeSatellites ───────────────────────────────────────────────────────

describe('summarizeSatellites', () => {
  function hs(sat: string): FirmsHotspot {
    return { latitude: 0, longitude: 0, brightness: 0, frp: 0, confidence: 'nominal', acqDate: '', acqTime: '', satellite: sat, daynight: 'D' };
  }

  it('detects SNPP (N) and NOAA-20 (N20)', () => {
    const cov = summarizeSatellites([hs('N'), hs('N20')]);
    assert.equal(cov.viirsSnpp, true);
    assert.equal(cov.noaa20, true);
    assert.deepEqual(cov.satellites, ['N', 'N20']);
  });

  it('detects long-form names', () => {
    const cov = summarizeSatellites([hs('Suomi-NPP'), hs('NOAA-20')]);
    assert.equal(cov.viirsSnpp, true);
    assert.equal(cov.noaa20, true);
  });

  it('deduplicates and sorts satellite tokens', () => {
    const cov = summarizeSatellites([hs('N20'), hs('N'), hs('N'), hs('N20')]);
    assert.deepEqual(cov.satellites, ['N', 'N20']);
  });

  it('ignores empty satellite tokens', () => {
    const cov = summarizeSatellites([hs(''), hs('  ')]);
    assert.deepEqual(cov.satellites, []);
    assert.equal(cov.viirsSnpp, false);
    assert.equal(cov.noaa20, false);
  });
});

// ── summarizeHotspots ─────────────────────────────────────────────────────────

describe('summarizeHotspots', () => {
  it('aggregates global counts, FRP and confidence', () => {
    const csv = `${HEADER}\n${row(48, 38, { conf: 'h', frp: '50' })}\n${row(15, 30, { conf: 'n', frp: '10' })}`;
    const summary = summarizeHotspots(parseFirmsCsv(csv), '2026-06-10T00:00:00.000Z');
    assert.equal(summary.global.count, 2);
    assert.equal(summary.global.highConfidenceCount, 1);
    assert.equal(summary.global.totalFrp, 60);
    assert.equal(summary.demo, false);
  });

  it('sorts regions and conflict zones by descending count', () => {
    const summary = summarizeHotspots([], '2026-06-10T00:00:00.000Z');
    for (let i = 1; i < summary.regions.length; i++) {
      assert.ok(summary.regions[i - 1].count >= summary.regions[i].count);
    }
    for (let i = 1; i < summary.conflictZones.length; i++) {
      assert.ok(summary.conflictZones[i - 1].count >= summary.conflictZones[i].count);
    }
  });

  it('places an Eastern-Ukraine hotspot into its conflict zone', () => {
    const csv = `${HEADER}\n${row(48.5, 38.5)}`;
    const summary = summarizeHotspots(parseFirmsCsv(csv), 'now');
    const uk = summary.conflictZones.find((z) => z.name === 'Eastern Ukraine')!;
    assert.equal(uk.count, 1);
  });

  it('honors the demo flag', () => {
    const summary = summarizeHotspots([], 'now', true);
    assert.equal(summary.demo, true);
  });
});

// ── buildDemoSummary ──────────────────────────────────────────────────────────

describe('buildDemoSummary', () => {
  it('returns a demo-flagged summary with non-empty sections', () => {
    const s = buildDemoSummary();
    assert.equal(s.demo, true);
    assert.ok(s.global.count > 0);
    assert.ok(s.regions.length >= 6);
    assert.ok(s.conflictZones.length > 0);
    assert.equal(s.satellites.viirsSnpp, true);
    assert.equal(s.satellites.noaa20, true);
  });

  it('accepts a custom generatedAt timestamp', () => {
    assert.equal(buildDemoSummary('2026-01-01T00:00:00.000Z').generatedAt, '2026-01-01T00:00:00.000Z');
  });
});

// ── severityColor ─────────────────────────────────────────────────────────────

describe('severityColor', () => {
  it('returns a distinct color per severity', () => {
    const colors = new Set([
      severityColor('normal'),
      severityColor('elevated'),
      severityColor('high'),
      severityColor('extreme'),
    ]);
    assert.equal(colors.size, 4);
  });
});

// ── static definitions ────────────────────────────────────────────────────────

describe('static definitions', () => {
  it('CONFLICT_ZONES has at least 8 entries', () => {
    assert.ok(CONFLICT_ZONES.length >= 8, `expected >= 8, got ${CONFLICT_ZONES.length}`);
  });

  it('REGIONS has at least 6 entries', () => {
    assert.ok(REGIONS.length >= 6, `expected >= 6, got ${REGIONS.length}`);
  });

  it('every conflict zone has a valid bbox and positive baseline floor', () => {
    for (const z of CONFLICT_ZONES) {
      assert.equal(z.bbox.length, 4);
      const [lonMin, latMin, lonMax, latMax] = z.bbox;
      assert.ok(lonMin < lonMax, `${z.name} lon`);
      assert.ok(latMin < latMax, `${z.name} lat`);
      assert.ok(z.baseline >= 0);
    }
  });

  it('every region has a valid bbox', () => {
    for (const r of REGIONS) {
      assert.equal(r.bbox.length, 4);
      const [lonMin, latMin, lonMax, latMax] = r.bbox;
      assert.ok(lonMin < lonMax, `${r.name} lon`);
      assert.ok(latMin < latMax, `${r.name} lat`);
    }
  });

  it('conflict-zone names are unique', () => {
    const names = CONFLICT_ZONES.map((z) => z.name);
    assert.equal(new Set(names).size, names.length);
  });
});
