export type WebcamSource =
  | 'FAA'
  | 'DOT511'
  | 'USGS_VOLCANO'
  | 'NPS'
  | 'ALERTWILDFIRE'
  | 'WINDY'
  | 'USFS'
  | 'USGS_STREAM'
  | 'NOAA_COASTAL';

export type WebcamCategory =
  | 'weather'
  | 'traffic'
  | 'volcano'
  | 'fire'
  | 'nature'
  | 'coastal'
  | 'stream';

export interface WebcamFeed {
  id: string;
  source: WebcamSource;
  name: string;
  lat: number;
  lon: number;
  snapshotUrl: string;
  streamUrl?: string;
  refreshIntervalSec: number;
  category: WebcamCategory;
  metadata: Record<string, string>;
  isOnline?: boolean;
  lastChecked?: number;
}

export interface WebcamCatalog {
  feeds: WebcamFeed[];
  bySource: Record<WebcamSource, WebcamFeed[]>;
  lastUpdated: number;
}
