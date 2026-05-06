import type { FAACamera } from '@/services/faa-cameras';
import type { WebcamCategory, WebcamFeed } from './webcam-types';

function mapCategory(faaCategory: string): WebcamCategory {
  switch (faaCategory) {
    case 'remote':
    case 'mountain': {
      return 'nature';
    }
    case 'coastal': {
      return 'coastal';
    }
    default: {
      return 'weather';
    }
  }
}

export function adaptFAACamera(cam: FAACamera): WebcamFeed {
  return {
    id: `FAA:${cam.id}`,
    source: 'FAA',
    name: cam.name,
    lat: cam.lat,
    lon: cam.lon,
    snapshotUrl: cam.imageUrl,
    refreshIntervalSec: 300,
    category: mapCategory(cam.category),
    metadata: {
      state: cam.state,
      faaCategory: cam.category,
    },
    isOnline: cam.isOnline,
    lastChecked: new Date(cam.lastUpdated).getTime() || undefined,
  };
}

export function adaptFAACameras(cams: FAACamera[]): WebcamFeed[] {
  return Array.isArray(cams) ? cams.map((cam) => adaptFAACamera(cam)) : [];
}
