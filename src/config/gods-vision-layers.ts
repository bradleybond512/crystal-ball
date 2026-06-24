export interface GodsVisionLayerConfig {
  name: string;
  category: 'spatial' | 'intelligence' | 'aesthetic' | 'analytical';
  enabled: boolean;
  description: string;
}

export type GodsVisionLayers = Record<string, GodsVisionLayerConfig>;

export const DEFAULT_GODS_VISION_LAYERS: GodsVisionLayers = {
  // ── Data Layers (shown in HUD bar) ──
  earthquakes: {
 name: 'Earthquakes',
 category: 'intelligence',
 enabled: true,
 description: 'USGS seismic events worldwide',
  },
  gdacs: {
 name: 'Disasters',
 category: 'intelligence',
 enabled: true,
 description: 'GDACS disaster alerts — floods, cyclones, earthquakes',
  },
  conflicts: {
 name: 'Conflicts',
 category: 'intelligence',
 enabled: true,
 description: 'ACLED conflict events — battles, explosions, violence',
  },
  airstrikes: {
 name: 'Airstrikes',
 category: 'intelligence',
 enabled: true,
 description: 'Air strikes and drone attacks',
  },
  flights: {
 name: 'Mil. Flights',
 category: 'intelligence',
 enabled: true,
 description: 'Military aircraft positions with heading and trails',
  },
  vessels: {
 name: 'Mil. Vessels',
 category: 'intelligence',
 enabled: true,
 description: 'Military and naval vessel positions with heading',
  },
  maritimeVessels: {
 name: 'AIS Vessels',
 category: 'intelligence',
 enabled: false,
 description: 'Live AIS positions in maritime risk zones — orange tankers, blue cargo, red military, gray other',
  },
  darkVessels: {
 name: 'Dark Ships',
 category: 'intelligence',
 enabled: true,
 description: 'Vessels with AIS transponder disabled — suspicious activity',
  },
  cyber: {
 name: 'Cyber',
 category: 'intelligence',
 enabled: true,
 description: 'Cyber threat indicators — C2 servers, malware, phishing',
  },
  nuclear: {
 name: 'Nuclear',
 category: 'intelligence',
 enabled: true,
 description: 'Nuclear facilities, weapons sites, and test locations',
  },
  fires: {
 name: 'Fires',
 category: 'intelligence',
 enabled: false,
 description: 'NASA FIRMS satellite fire detections + NIFC active perimeters',
  },
  airQuality: {
 name: 'Air Quality',
 category: 'intelligence',
 enabled: false,
 description: 'PurpleAir community PM2.5 sensors colored by AQI band',
  },
  volcanoes: {
 name: 'Volcanoes',
 category: 'intelligence',
 enabled: true,
 description: 'USGS/Smithsonian volcano alert levels',
  },
  cyclones: {
 name: 'Cyclones',
 category: 'intelligence',
 enabled: true,
 description: 'Active tropical cyclones with category and wind speed',
  },
  protests: {
 name: 'Protests',
 category: 'intelligence',
 enabled: true,
 description: 'Social unrest, protests, and civil disturbance events',
  },
  gpsJamming: {
 name: 'GPS Jamming',
 category: 'intelligence',
 enabled: true,
 description: 'GPS interference zones from GPSJam.org',
  },
  disease: {
 name: 'Disease',
 category: 'intelligence',
 enabled: true,
 description: 'Disease outbreak hotspots by country',
  },
  displacement: {
 name: 'Refugees',
 category: 'intelligence',
 enabled: true,
 description: 'UNHCR displacement data with refugee flow arcs',
  },
  satChange: {
 name: 'Sat. Change',
 category: 'intelligence',
 enabled: true,
 description: 'Satellite imagery change detection at watched locations',
  },
  spaceWeather: {
 name: 'Space Wx',
 category: 'intelligence',
 enabled: false,
 description: 'Aurora oval (Kp ≥ 5) + pulsing subsolar X-flare halo',
  },
  warRiskZones: {
 name: 'War Risk',
 category: 'intelligence',
 enabled: false,
 description: 'Lloyd-style war-risk maritime zones — Red Sea, Hormuz, Black Sea, Gulf of Guinea',
  },
  infrastructure: {
 name: 'Infra Outage',
 category: 'intelligence',
 enabled: false,
 description: 'US grid outages by state (severity-colored) + RadNet stations pulsing above threshold',
  },
  powerInfrastructure: {
 name: 'Power Grid',
 category: 'intelligence',
 enabled: false,
 description: 'OSM power infrastructure near your data-center site (or the map center) — plants, substations, transmission lines, data centers',
  },
  // ── Static Geo Layers ──
  bases: {
 name: 'Mil. Bases',
 category: 'spatial',
 enabled: true,
 description: 'Military installations worldwide — US/NATO, Russia, China, others',
  },
  cables: {
 name: 'Cables',
 category: 'spatial',
 enabled: false,
 description: 'Undersea fiber optic cables and landing points',
  },
  waterways: {
 name: 'Chokepoints',
 category: 'spatial',
 enabled: true,
 description: 'Strategic waterways — Suez, Hormuz, Malacca, etc.',
  },
  hotspots: {
 name: 'Intel Hotspots',
 category: 'analytical',
 enabled: true,
 description: 'Geopolitical hotspots with escalation scores',
  },
  autoFollow: {
 name: 'Auto-Follow',
 category: 'analytical',
 enabled: false,
 description: 'Intelligent camera auto-pilot — cycles through highest-priority events',
  },
  spaceports: {
 name: 'Spaceports',
 category: 'spatial',
 enabled: false,
 description: 'Launch facilities worldwide',
  },
  minerals: {
 name: 'Minerals',
 category: 'spatial',
 enabled: false,
 description: 'Critical mineral projects — lithium, cobalt, rare earth',
  },
  satellites: {
 name: 'Satellites',
 category: 'intelligence',
 enabled: true,
 description: 'Real-time orbital positions for active satellites and space stations',
  },
  // ── Future / Aesthetic ──
  terrain: {
 name: '3D Terrain',
 category: 'spatial',
 enabled: false,
 description: 'Cesium World Terrain with elevation',
  },
  buildings: {
 name: '3D Buildings',
 category: 'aesthetic',
 enabled: false,
 description: 'Google Photorealistic 3D Tiles / OSM Buildings',
  },
  aircraft3d: {
 name: '3D Aircraft',
 category: 'spatial',
 enabled: false,
 description: 'Detailed glTF aircraft models at real altitude with heading',
  },
  entityGraph: {
 name: 'Entity Graph',
 category: 'analytical',
 enabled: false,
 description: 'Force-directed graph of entity relationships and connections',
  },
  rfCoverage: {
 name: 'RF Coverage',
 category: 'intelligence',
 enabled: false,
 description: 'Radio frequency coverage and signal propagation zones',
  },
  timeline: {
 name: 'Timeline',
 category: 'analytical',
 enabled: false,
 description: 'Temporal playback with event scrubbing',
  },
  atmosphere: {
 name: 'Atmosphere Glow',
 category: 'aesthetic',
 enabled: false,
 description: 'Atmospheric scatter shader on globe edge',
  },
  scanlines: {
 name: 'Scanlines',
 category: 'aesthetic',
 enabled: false,
 description: 'Subtle CRT/tactical display effect',
  },
  bloom: {
 name: 'Bloom',
 category: 'aesthetic',
 enabled: false,
 description: 'Glow effect on bright elements',
  },
  // ── Weather Overlay Layers ──
  weatherRadar: {
 name: 'Radar',
 category: 'intelligence',
 enabled: false,
 description: 'RainViewer global weather radar composite',
  },
  weatherSatellite: {
 name: 'Satellite Wx',
 category: 'intelligence',
 enabled: false,
 description: 'NOAA GOES/Himawari satellite weather imagery',
  },
  lightningStrikes: {
 name: 'Lightning',
 category: 'intelligence',
 enabled: false,
 description: 'Blitzortung real-time lightning strike detection',
  },
  redFlagWarnings: {
 name: 'Fire Weather',
 category: 'intelligence',
 enabled: true,
 description: 'NWS Red Flag Warnings and fire weather watches',
  },
  floodAlerts: {
 name: 'Flood Alerts',
 category: 'intelligence',
 enabled: false,
 description: 'NWS active flood watches and warnings — polygons colored by severity',
  },
};

const STORAGE_KEY = 'crystalball-gods-vision-layers';

export function loadGodsVisionLayers(): GodsVisionLayers {
  try {
 const stored = localStorage.getItem(STORAGE_KEY);
 if (!stored) return structuredClone(DEFAULT_GODS_VISION_LAYERS);
 const parsed = JSON.parse(stored) as Record<string, boolean>;
 const layers = structuredClone(DEFAULT_GODS_VISION_LAYERS);
 for (const [key, enabled] of Object.entries(parsed)) {
 if (key in layers) {
 layers[key]!.enabled = enabled;
 }
 }
 return layers;
  } catch {
 return structuredClone(DEFAULT_GODS_VISION_LAYERS);
  }
}

export function saveGodsVisionLayers(layers: GodsVisionLayers): void {
  const simplified: Record<string, boolean> = {};
  for (const [key, config] of Object.entries(layers)) {
 simplified[key] = config.enabled;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(simplified));
}
