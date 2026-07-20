import type { WebcamSource } from './webcam-types';
import type { WebcamSourceConfig } from './webcam-config-loader';

interface CaltransCctvRow {
  cctv?: {
    index?: string;
    location?: { locationName?: string; latitude?: string; longitude?: string; district?: string };
    imageData?: {
      static?: { currentImageURL?: string };
      streamingVideoURL?: string;
    };
  };
}

interface TflRow {
  id?: string;
  commonName?: string;
  lat?: number;
  lon?: number;
  additionalProperties?: { key: string; value: string }[];
}

const CALTRANS_DISTRICTS = Array.from({ length: 12 }, (_, i) => {
  const nn = String(i + 1).padStart(2, '0');
  return `https://cwwp2.dot.ca.gov/data/d${nn}/cctv/cctvStatusD${nn}.json`;
});

export const CALTRANS_CONFIG: WebcamSourceConfig = {
  id: 'CALTRANS',
  mode: 'json',
  url: CALTRANS_DISTRICTS,
  arrayPath: 'data',
  map: {
    id: (row) => {
      const r = row as CaltransCctvRow;
      const district = r?.cctv?.location?.district ?? 'UNK';
      const idx = r?.cctv?.index ?? 'UNK';
      return `d${district}:${idx}`;
    },
    name: 'cctv.location.locationName',
    lat: 'cctv.location.latitude',
    lon: 'cctv.location.longitude',
    snapshotUrl: 'cctv.imageData.static.currentImageURL',
    streamUrl: 'cctv.imageData.streamingVideoURL',
  },
  category: 'traffic',
  refreshIntervalSec: 60,
  metadata: { attribution: 'Caltrans CWWP2', country: 'US', state: 'CA' },
};

export const TFL_CONFIG: WebcamSourceConfig = {
  id: 'TFL',
  mode: 'json',
  url: 'https://api.tfl.gov.uk/Place/Type/JamCam',
  map: {
    id: (row) => (row as TflRow).id ?? '',
    name: 'commonName',
    lat: 'lat',
    lon: 'lon',
    snapshotUrl: (row) => {
      const r = row as TflRow;
      return r.additionalProperties?.find((p) => p.key === 'imageUrl')?.value ?? '';
    },
  },
  category: 'traffic',
  refreshIntervalSec: 60,
  metadata: { attribution: 'Transport for London JamCams', country: 'GB', city: 'London' },
};

interface SingaporeCamera {
  camera_id?: string;
  location?: { latitude?: number; longitude?: number };
  image?: string;
}

export const SINGAPORE_CONFIG: WebcamSourceConfig = {
  id: 'SINGAPORE',
  mode: 'json',
  url: 'https://api.data.gov.sg/v1/transport/traffic-images',
  arrayPath: 'items.0.cameras',
  map: {
    id: (row) => (row as SingaporeCamera).camera_id ?? '',
    name: (row) => `Singapore Cam ${(row as SingaporeCamera).camera_id ?? ''}`,
    lat: 'location.latitude',
    lon: 'location.longitude',
    snapshotUrl: 'image',
  },
  category: 'traffic',
  refreshIntervalSec: 60,
  snapshotTtlSec: 240,
  metadata: { attribution: 'Singapore LTA Traffic Images', country: 'SG', city: 'Singapore' },
};

interface GeoNetFeature {
  geometry?: { coordinates?: number[] };
  properties?: { title?: string; 'latest-image-large'?: string };
}

// GeoNet all.json is a LIST of FeatureCollections (one per volcano); the sidecar
// spreads that list as payloads and this extracts each FC's `features`.
// NOTE: GeoNet uses non-standard [lat, lon] coordinate order (verified live).
const GEONET_IMAGE_BASE = 'https://images.geonet.org.nz/volcano/cameras/';

export const GEONET_CONFIG: WebcamSourceConfig = {
  id: 'GEONET',
  mode: 'json',
  url: 'https://images.geonet.org.nz/volcano/cameras/all.json',
  arrayPath: 'features',
  map: {
    id: (row) => {
      const img = (row as GeoNetFeature).properties?.['latest-image-large'] ?? '';
      return img.replace(/^latest\//, '').replace(/\.jpg$/, '') || 'cam';
    },
    name: 'properties.title',
    lat: 'geometry.coordinates.0',
    lon: 'geometry.coordinates.1',
    snapshotUrl: (row) => {
      const img = (row as GeoNetFeature).properties?.['latest-image-large'] ?? '';
      return img ? `${GEONET_IMAGE_BASE}${img}` : '';
    },
  },
  category: 'volcano',
  refreshIntervalSec: 300,
  metadata: { attribution: 'GeoNet NZ (CC-BY 3.0 NZ)', country: 'NZ' },
};

export const WEBCAM_SOURCE_CONFIGS: Record<Extract<WebcamSource, 'CALTRANS' | 'TFL' | 'SINGAPORE' | 'GEONET'>, WebcamSourceConfig> = {
  CALTRANS: CALTRANS_CONFIG,
  TFL: TFL_CONFIG,
  SINGAPORE: SINGAPORE_CONFIG,
  GEONET: GEONET_CONFIG,
};
