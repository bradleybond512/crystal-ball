import type { WebcamFeed } from './webcam-types';

export interface StreamGaugeRecord {
  siteNo: string;
  name: string;
  lat: number;
  lon: number;
  state?: string;
  hasPhoto: boolean;
}

export const STREAM_GAUGE_PHOTO_BASE =
  'https://waterdata.usgs.gov/nwisweb/get_site?format=photo&site_no=';

export function adaptStreamGauge(rec: StreamGaugeRecord): WebcamFeed | null {
  if (!rec || typeof rec !== 'object') return null;
  if (!rec.hasPhoto) return null;
  if (!rec.siteNo) return null;
  if (!Number.isFinite(rec.lat) || !Number.isFinite(rec.lon)) return null;
  return {
    id: `USGS_STREAM:${rec.siteNo}`,
    source: 'USGS_STREAM',
    name: rec.name || `USGS Gauge ${rec.siteNo}`,
    lat: rec.lat,
    lon: rec.lon,
    snapshotUrl: `${STREAM_GAUGE_PHOTO_BASE}${encodeURIComponent(rec.siteNo)}`,
    refreshIntervalSec: 3600,
    category: 'stream',
    metadata: {
      siteNo: rec.siteNo,
      ...(rec.state ? { state: rec.state } : {}),
    },
  };
}

export function adaptStreamGauges(records: StreamGaugeRecord[]): WebcamFeed[] {
  if (!Array.isArray(records)) return [];
  const out: WebcamFeed[] = [];
  for (const rec of records) {
    const f = adaptStreamGauge(rec);
    if (f) out.push(f);
  }
  return out;
}

export const KNOWN_STREAM_GAUGE_CAMS: StreamGaugeRecord[] = [
  { siteNo: '11447650', name: 'Sacramento River at Freeport, CA', lat: 38.4555, lon: -121.5021, state: 'CA', hasPhoto: true },
  { siteNo: '01646500', name: 'Potomac River near Wash, DC Little Falls Pump Sta', lat: 38.9498, lon: -77.1278, state: 'DC', hasPhoto: true },
  { siteNo: '07010000', name: 'Mississippi River at St. Louis, MO', lat: 38.6296, lon: -90.1798, state: 'MO', hasPhoto: true },
  { siteNo: '02035000', name: 'James River at Cartersville, VA', lat: 37.6712, lon: -78.0867, state: 'VA', hasPhoto: true },
  { siteNo: '03612600', name: 'Ohio River at Olmsted, IL', lat: 37.18, lon: -89.0567, state: 'IL', hasPhoto: true },
  { siteNo: '08374550', name: 'Rio Grande at Foster Ranch, TX', lat: 29.6306, lon: -102.0339, state: 'TX', hasPhoto: true },
  { siteNo: '14211720', name: 'Willamette River at Portland, OR', lat: 45.5167, lon: -122.6692, state: 'OR', hasPhoto: true },
  { siteNo: '12150800', name: 'Snohomish River near Monroe, WA', lat: 47.83, lon: -121.9967, state: 'WA', hasPhoto: true },
];
