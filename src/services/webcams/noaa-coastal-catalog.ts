import type { WebcamFeed } from './webcam-types';

export interface NoaaCoastalCamRecord {
  stationId: string;
  name: string;
  lat: number;
  lon: number;
  snapshotUrl: string;
  agency: 'NDBC' | 'CO-OPS';
  region?: string;
}

export const NOAA_COASTAL_CAMS: NoaaCoastalCamRecord[] = [
  {
    stationId: '44025',
    name: 'NDBC 44025 — Long Island, NY',
    lat: 40.251,
    lon: -73.165,
    snapshotUrl: 'https://www.ndbc.noaa.gov/buoycam.php?station=44025',
    agency: 'NDBC',
    region: 'Mid-Atlantic',
  },
  {
    stationId: '44013',
    name: 'NDBC 44013 — Boston, MA',
    lat: 42.346,
    lon: -70.651,
    snapshotUrl: 'https://www.ndbc.noaa.gov/buoycam.php?station=44013',
    agency: 'NDBC',
    region: 'Northeast',
  },
  {
    stationId: '46042',
    name: 'NDBC 46042 — Monterey Bay, CA',
    lat: 36.789,
    lon: -122.469,
    snapshotUrl: 'https://www.ndbc.noaa.gov/buoycam.php?station=46042',
    agency: 'NDBC',
    region: 'California',
  },
  {
    stationId: '46026',
    name: 'NDBC 46026 — San Francisco, CA',
    lat: 37.755,
    lon: -122.839,
    snapshotUrl: 'https://www.ndbc.noaa.gov/buoycam.php?station=46026',
    agency: 'NDBC',
    region: 'California',
  },
  {
    stationId: '41047',
    name: 'NDBC 41047 — Northeast Bahamas',
    lat: 27.467,
    lon: -71.516,
    snapshotUrl: 'https://www.ndbc.noaa.gov/buoycam.php?station=41047',
    agency: 'NDBC',
    region: 'Atlantic',
  },
  {
    stationId: '46059',
    name: 'NDBC 46059 — West California',
    lat: 38.094,
    lon: -129.951,
    snapshotUrl: 'https://www.ndbc.noaa.gov/buoycam.php?station=46059',
    agency: 'NDBC',
    region: 'Pacific',
  },
  {
    stationId: '42040',
    name: 'NDBC 42040 — Mobile South, AL',
    lat: 29.205,
    lon: -88.205,
    snapshotUrl: 'https://www.ndbc.noaa.gov/buoycam.php?station=42040',
    agency: 'NDBC',
    region: 'Gulf of Mexico',
  },
];

export function adaptNoaaCoastalCam(rec: NoaaCoastalCamRecord): WebcamFeed {
  return {
    id: `NOAA_COASTAL:${rec.stationId}`,
    source: 'NOAA_COASTAL',
    name: rec.name,
    lat: rec.lat,
    lon: rec.lon,
    snapshotUrl: rec.snapshotUrl,
    refreshIntervalSec: 600,
    category: 'coastal',
    metadata: {
      stationId: rec.stationId,
      agency: rec.agency,
      ...(rec.region ? { region: rec.region } : {}),
    },
  };
}

export function getNoaaCoastalCamFeeds(): WebcamFeed[] {
  return NOAA_COASTAL_CAMS.map((r) => adaptNoaaCoastalCam(r));
}
