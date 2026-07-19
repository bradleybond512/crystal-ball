export type WebcamSource =
  | 'FAA'
  | 'DOT511'
  | 'USGS_VOLCANO'
  | 'NPS'
  | 'ALERTWILDFIRE'
  | 'WINDY'
  | 'USFS'
  | 'USGS_STREAM'
  | 'NOAA_COASTAL'
  | 'CALTRANS'
  | 'TFL'
  | 'SINGAPORE'
  | 'GEONET'
  | 'HAZECAM';

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
  streamType?: WebcamStreamType;
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
  sourceHealth?: WebcamSourceHealth[];
}

export type SourceStatus = 'ok' | 'missing_key' | 'down' | 'rate_limited' | 'empty';

export interface WebcamSourceHealth {
  source: WebcamSource;
  status: SourceStatus;
  count: number;
  needsKey: boolean;
  error?: string;
  lastChecked: number;
}

/** Streaming kind for a feed; 'snapshot' = refreshing image (Phase 1 default). */
export type WebcamStreamType = 'hls' | 'mjpeg' | 'youtube' | 'embed' | 'snapshot';
