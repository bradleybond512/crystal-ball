import type { WebcamFeed } from './webcam-types';

export type VolcanoAlertLevel = 'NORMAL' | 'ADVISORY' | 'WATCH' | 'WARNING' | 'UNKNOWN';

export interface VolcanoCamRecord {
  id: string;
  name: string;
  volcano: string;
  observatory: 'HVO' | 'CVO' | 'YVO' | 'AVO' | 'VHP';
  lat: number;
  lon: number;
  snapshotUrl: string;
  alertLevel?: VolcanoAlertLevel;
}

export const VOLCANO_CAMS: VolcanoCamRecord[] = [
  {
    id: 'kilauea-summit',
    name: 'Kīlauea — Summit (KW)',
    volcano: 'Kilauea',
    observatory: 'HVO',
    lat: 19.4067,
    lon: -155.2834,
    snapshotUrl: 'https://volcanoes.usgs.gov/vsc/captures/kilauea/KWcam.jpg',
  },
  {
    id: 'kilauea-east-rift',
    name: 'Kīlauea — East Rift (PG)',
    volcano: 'Kilauea',
    observatory: 'HVO',
    lat: 19.385,
    lon: -154.95,
    snapshotUrl: 'https://volcanoes.usgs.gov/vsc/captures/kilauea/PGcam.jpg',
  },
  {
    id: 'mauna-loa-summit',
    name: 'Mauna Loa — Summit (M1)',
    volcano: 'Mauna Loa',
    observatory: 'HVO',
    lat: 19.475,
    lon: -155.608,
    snapshotUrl: 'https://volcanoes.usgs.gov/vsc/captures/mauna_loa/M1cam.jpg',
  },
  {
    id: 'st-helens-johnston',
    name: 'Mount St. Helens — Johnston Ridge',
    volcano: 'St. Helens',
    observatory: 'CVO',
    lat: 46.276,
    lon: -122.218,
    snapshotUrl: 'https://volcanoes.usgs.gov/vsc/captures/cvo/MSHJRO.jpg',
  },
  {
    id: 'st-helens-coldwater',
    name: 'Mount St. Helens — Coldwater',
    volcano: 'St. Helens',
    observatory: 'CVO',
    lat: 46.295,
    lon: -122.27,
    snapshotUrl: 'https://volcanoes.usgs.gov/vsc/captures/cvo/MSHCW.jpg',
  },
  {
    id: 'mount-hood-timberline',
    name: 'Mount Hood — Timberline',
    volcano: 'Mount Hood',
    observatory: 'CVO',
    lat: 45.331,
    lon: -121.711,
    snapshotUrl: 'https://volcanoes.usgs.gov/vsc/captures/cvo/HOODTL.jpg',
  },
  {
    id: 'mount-rainier-camp-muir',
    name: 'Mount Rainier — Camp Muir',
    volcano: 'Rainier',
    observatory: 'CVO',
    lat: 46.836,
    lon: -121.731,
    snapshotUrl: 'https://volcanoes.usgs.gov/vsc/captures/cvo/RAINMUIR.jpg',
  },
  {
    id: 'redoubt-hut',
    name: 'Redoubt — Hut',
    volcano: 'Redoubt',
    observatory: 'AVO',
    lat: 60.485,
    lon: -152.742,
    snapshotUrl: 'https://avo.alaska.edu/webcam/REDhut.jpg',
  },
  {
    id: 'pavlof-cold-bay',
    name: 'Pavlof — Cold Bay',
    volcano: 'Pavlof',
    observatory: 'AVO',
    lat: 55.42,
    lon: -161.894,
    snapshotUrl: 'https://avo.alaska.edu/webcam/PVV.jpg',
  },
  {
    id: 'cleveland-pevolc',
    name: 'Cleveland — PEvolc',
    volcano: 'Cleveland',
    observatory: 'AVO',
    lat: 52.825,
    lon: -169.944,
    snapshotUrl: 'https://avo.alaska.edu/webcam/CLES.jpg',
  },
  {
    id: 'shishaldin',
    name: 'Shishaldin — ISLE',
    volcano: 'Shishaldin',
    observatory: 'AVO',
    lat: 54.756,
    lon: -163.97,
    snapshotUrl: 'https://avo.alaska.edu/webcam/SDPI.jpg',
  },
  {
    id: 'great-sitkin',
    name: 'Great Sitkin — GSCK',
    volcano: 'Great Sitkin',
    observatory: 'AVO',
    lat: 52.076,
    lon: -176.13,
    snapshotUrl: 'https://avo.alaska.edu/webcam/GSCK.jpg',
  },
  {
    id: 'yellowstone-old-faithful',
    name: 'Yellowstone — Old Faithful',
    volcano: 'Yellowstone',
    observatory: 'YVO',
    lat: 44.46,
    lon: -110.829,
    snapshotUrl: 'https://www.nps.gov/webcams-yell/oldfaithvc.jpg',
  },
];

export function adaptVolcanoCam(rec: VolcanoCamRecord): WebcamFeed {
  return {
    id: `USGS_VOLCANO:${rec.id}`,
    source: 'USGS_VOLCANO',
    name: rec.name,
    lat: rec.lat,
    lon: rec.lon,
    snapshotUrl: rec.snapshotUrl,
    refreshIntervalSec: 60,
    category: 'volcano',
    metadata: {
      volcano: rec.volcano,
      observatory: rec.observatory,
      ...(rec.alertLevel ? { alertLevel: rec.alertLevel } : {}),
    },
  };
}

export function getVolcanoCamFeeds(
  alertLevels: Record<string, VolcanoAlertLevel> = {},
): WebcamFeed[] {
  return VOLCANO_CAMS.map((rec) => {
    const merged: VolcanoCamRecord = {
      ...rec,
      alertLevel: alertLevels[rec.volcano] ?? rec.alertLevel,
    };
    return adaptVolcanoCam(merged);
  });
}
