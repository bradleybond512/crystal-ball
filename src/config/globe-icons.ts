// SVG billboard icons for God's Eye 3D globe — white silhouettes tinted by Cesium color
// Each is a 64x64 SVG encoded as a data URI

function svg(body: string): string {
  return `data:image/svg+xml,${encodeURIComponent(
 `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">${body}</svg>`,
  )}`;
}

// ── Aircraft (top-down silhouettes, point up = heading 0°/north) ──

export const ICON_FIGHTER = svg(
  `<path d="M32 4l-4 18-16 8 2 4 14-4v16l-8 6v4l8-2 8 2v-4l-8-6V30l14 4 2-4-16-8z" fill="#fff"/>`,
);

export const ICON_BOMBER = svg(
  `<path d="M32 6l-6 16-18 6 2 4 16-2v18l-10 4v4l10-2 10 2v-4l-10-4V30l16 2 2-4-18-6z" fill="#fff"/>`,
);

export const ICON_TRANSPORT = svg(
  `<path d="M32 6l-3 14-20 4 1 4 19-2v22l-8 4v4l8-2 8 2v-4l-8-4V26l19 2 1-4-20-4z" fill="#fff"/>`,
);

export const ICON_HELICOPTER = svg(
  `<circle cx="32" cy="30" r="8" fill="none" stroke="#fff" stroke-width="2"/>` +
  `<line x1="32" y1="22" x2="32" y2="8" stroke="#fff" stroke-width="2"/>` +
  `<line x1="20" y1="8" x2="44" y2="8" stroke="#fff" stroke-width="3"/>` +
  `<line x1="32" y1="38" x2="32" y2="52" stroke="#fff" stroke-width="2"/>` +
  `<line x1="24" y1="52" x2="40" y2="52" stroke="#fff" stroke-width="2"/>` +
  `<line x1="28" y1="52" x2="24" y2="58" stroke="#fff" stroke-width="2"/>` +
  `<line x1="36" y1="52" x2="40" y2="58" stroke="#fff" stroke-width="2"/>`,
);

export const ICON_UAV = svg(
  `<path d="M32 8l-2 20-22 4 1 3 21-3v16l-6 4v3l6-1 6 1v-3l-6-4V32l21 3 1-3-22-4z" fill="#fff"/>`,
);

export const ICON_SURVEILLANCE = svg(
  `<path d="M32 6l-3 14-20 4 1 4 19-2v22l-8 4v4l8-2 8 2v-4l-8-4V26l19 2 1-4-20-4z" fill="#fff"/>` +
  `<circle cx="32" cy="22" r="5" fill="none" stroke="#fff" stroke-width="1.5"/>`,
);

// ── Vessels (top-down, bow pointing up = heading 0°/north) ──

export const ICON_WARSHIP = svg(
  `<path d="M32 6l-8 14-6 24 2 6 4 4h16l4-4 2-6-6-24z" fill="#fff"/>` +
  `<line x1="32" y1="10" x2="32" y2="48" stroke="#888" stroke-width="1"/>`,
);

export const ICON_CARRIER = svg(
  `<path d="M32 4l-12 10-4 32 2 6 4 4h20l4-4 2-6-4-32z" fill="#fff"/>` +
  `<rect x="22" y="14" width="20" height="34" rx="2" fill="#ccc" opacity="0.3"/>` +
  `<line x1="26" y1="14" x2="26" y2="48" stroke="#999" stroke-width="0.5"/>`,
);

export const ICON_SUBMARINE = svg(
  `<ellipse cx="32" cy="32" rx="8" ry="22" fill="#fff"/>` +
  `<rect x="28" y="18" width="8" height="6" rx="1" fill="#ccc" opacity="0.4"/>` +
  `<line x1="32" y1="10" x2="32" y2="54" stroke="#aaa" stroke-width="0.5"/>`,
);

export const ICON_PATROL_BOAT = svg(
  `<path d="M32 10l-6 10-4 22 2 6 3 3h10l3-3 2-6-4-22z" fill="#fff"/>`,
);

// ── Satellite ──

export const ICON_SATELLITE = svg(
  `<rect x="26" y="26" width="12" height="12" rx="2" fill="#fff"/>` +
  `<rect x="4" y="28" width="20" height="8" rx="1" fill="#fff" opacity="0.8"/>` +
  `<rect x="40" y="28" width="20" height="8" rx="1" fill="#fff" opacity="0.8"/>` +
  `<line x1="8" y1="28" x2="8" y2="36" stroke="#aaa" stroke-width="0.5"/>` +
  `<line x1="14" y1="28" x2="14" y2="36" stroke="#aaa" stroke-width="0.5"/>` +
  `<line x1="20" y1="28" x2="20" y2="36" stroke="#aaa" stroke-width="0.5"/>` +
  `<line x1="44" y1="28" x2="44" y2="36" stroke="#aaa" stroke-width="0.5"/>` +
  `<line x1="50" y1="28" x2="50" y2="36" stroke="#aaa" stroke-width="0.5"/>` +
  `<line x1="56" y1="28" x2="56" y2="36" stroke="#aaa" stroke-width="0.5"/>` +
  `<circle cx="32" cy="32" r="2" fill="#4af"/>`,
);

// ── Disasters (GDACS) ──

export const ICON_CYCLONE = svg(
  `<path d="M32 12a20 20 0 0 1 14 6c-4-1-8 1-10 5s0 9 4 11a20 20 0 0 1-22-4c4 1 8-1 10-5s0-9-4-11a20 20 0 0 1 8-2z" fill="#fff"/>` +
  `<circle cx="32" cy="32" r="4" fill="#fff"/>`,
);

export const ICON_VOLCANO = svg(
  `<path d="M10 54l18-40h8l18 40z" fill="#fff"/>` +
  `<path d="M26 14l6-8 6 8" fill="#f44" opacity="0.8"/>` +
  `<circle cx="28" cy="8" r="3" fill="#f44" opacity="0.5"/>` +
  `<circle cx="36" cy="5" r="2" fill="#f44" opacity="0.4"/>`,
);

export const ICON_FLOOD = svg(
  `<path d="M4 30c4-4 8-4 12 0s8 4 12 0 8-4 12 0 8 4 12 0" fill="none" stroke="#fff" stroke-width="3"/>` +
  `<path d="M4 40c4-4 8-4 12 0s8 4 12 0 8-4 12 0 8 4 12 0" fill="none" stroke="#fff" stroke-width="3" opacity="0.7"/>` +
  `<path d="M4 50c4-4 8-4 12 0s8 4 12 0 8-4 12 0 8 4 12 0" fill="none" stroke="#fff" stroke-width="3" opacity="0.4"/>`,
);

export const ICON_WILDFIRE = svg(
  `<path d="M32 4c-4 12-14 16-14 28a14 14 0 0 0 28 0C46 20 36 16 32 4z" fill="#fff"/>` +
  `<path d="M32 20c-2 6-7 8-7 16a7 7 0 0 0 14 0c0-8-5-10-7-16z" fill="#fa0" opacity="0.5"/>`,
);

export const ICON_DROUGHT = svg(
  `<circle cx="32" cy="24" r="10" fill="#fff"/>` +
  `<path d="M12 24h-4M56 24h-4M32 4V8M32 40v4M16 10l3 3M45 39l3 3M48 10l-3 3M19 39l-3 3" stroke="#fff" stroke-width="2" stroke-linecap="round"/>` +
  `<path d="M18 50l4-8 4 6 4-4 4 8 4-6 4 4 4-8" fill="none" stroke="#fff" stroke-width="2" opacity="0.5"/>`,
);

// ── Seismic ──

export const ICON_EARTHQUAKE = svg(
  `<circle cx="32" cy="32" r="6" fill="#fff"/>` +
  `<circle cx="32" cy="32" r="14" fill="none" stroke="#fff" stroke-width="2" opacity="0.6"/>` +
  `<circle cx="32" cy="32" r="22" fill="none" stroke="#fff" stroke-width="1.5" opacity="0.35"/>` +
  `<circle cx="32" cy="32" r="30" fill="none" stroke="#fff" stroke-width="1" opacity="0.15"/>`,
);

// ── Conflict ──

export const ICON_EXPLOSION = svg(
  `<path d="M32 4l4 14 12-8-4 14 14 2-12 8 8 12-14-4-2 14-8-12-12 8 4-14-14-2 12-8-8-12 14 4z" fill="#fff"/>`,
);

export const ICON_CROSSHAIR = svg(
  `<circle cx="32" cy="32" r="12" fill="none" stroke="#fff" stroke-width="2"/>` +
  `<circle cx="32" cy="32" r="4" fill="none" stroke="#fff" stroke-width="1.5"/>` +
  `<line x1="32" y1="4" x2="32" y2="18" stroke="#fff" stroke-width="2"/>` +
  `<line x1="32" y1="46" x2="32" y2="60" stroke="#fff" stroke-width="2"/>` +
  `<line x1="4" y1="32" x2="18" y2="32" stroke="#fff" stroke-width="2"/>` +
  `<line x1="46" y1="32" x2="60" y2="32" stroke="#fff" stroke-width="2"/>`,
);

// ── Cyber ──

export const ICON_CYBER = svg(
  `<rect x="12" y="16" width="40" height="28" rx="3" fill="none" stroke="#fff" stroke-width="2"/>` +
  `<text x="32" y="36" text-anchor="middle" font-family="monospace" font-size="14" fill="#fff">&gt;_</text>` +
  `<line x1="24" y1="48" x2="40" y2="48" stroke="#fff" stroke-width="2"/>` +
  `<line x1="20" y1="52" x2="44" y2="52" stroke="#fff" stroke-width="2"/>`,
);

export const ICON_CYBER_CRITICAL = svg(
  `<path d="M32 8l-16 8v14c0 12 7 22 16 26 9-4 16-14 16-26V16z" fill="none" stroke="#fff" stroke-width="2"/>` +
  `<text x="32" y="38" text-anchor="middle" font-family="monospace" font-size="18" font-weight="bold" fill="#fff">!</text>`,
);

// ── Unrest / Protests ──

export const ICON_PROTEST = svg(
  `<path d="M20 36V18l24-8v18" fill="none" stroke="#fff" stroke-width="2.5"/>` +
  `<rect x="36" y="10" width="8" height="14" rx="1" fill="#fff" opacity="0.3"/>` +
  `<line x1="20" y1="36" x2="20" y2="56" stroke="#fff" stroke-width="2.5"/>`,
);

// ── Nuclear ──

export const ICON_NUCLEAR = svg(
  `<circle cx="32" cy="32" r="6" fill="#fff"/>` +
  `<path d="M32 26c-3-8-10-14-18-14 2 10 8 16 16 18z" fill="#fff" opacity="0.85"/>` +
  `<path d="M32 26c3-8 10-14 18-14-2 10-8 16-16 18z" fill="#fff" opacity="0.85"/>` +
  `<path d="M26 32c-8 3-14 10-14 18 10-2 16-8 18-16z" fill="#fff" opacity="0.85"/>` +
  `<path d="M38 32c8 3 14 10 14 18-10-2-16-8-18-16z" fill="#fff" opacity="0.85"/>` +
  `<path d="M26 34c-6 6-8 14-4 22 8-6 10-14 8-20z" fill="#fff" opacity="0.85"/>` +
  `<path d="M38 34c6 6 8 14 4 22-8-6-10-14-8-20z" fill="#fff" opacity="0.85"/>`,
);

// ── Cable landing point ──

export const ICON_CABLE_LANDING = svg(
  `<circle cx="32" cy="32" r="8" fill="none" stroke="#fff" stroke-width="2"/>` +
  `<circle cx="32" cy="32" r="3" fill="#fff"/>`,
);

// ── Fire / FIRMS ──

export const ICON_FIRE = svg(
  `<path d="M32 4c-4 12-14 16-14 28a14 14 0 0 0 28 0C46 20 36 16 32 4z" fill="#fff"/>` +
  `<path d="M32 20c-2 6-7 8-7 16a7 7 0 0 0 14 0c0-8-5-10-7-16z" fill="#fff" opacity="0.6"/>`,
);

// ── Military Base ──

export const ICON_BASE = svg(
  `<rect x="14" y="28" width="36" height="24" rx="2" fill="#fff"/>` +
  `<polygon points="32,8 14,28 50,28" fill="#fff"/>` +
  `<rect x="26" y="36" width="12" height="16" fill="#000" opacity="0.3"/>`,
);

export const ICON_BASE_NAVAL = svg(
  `<rect x="12" y="30" width="40" height="20" rx="2" fill="#fff"/>` +
  `<path d="M32 10l-20 20h40z" fill="#fff"/>` +
  `<path d="M20 54c4-3 8-3 12 0s8 3 12 0" fill="none" stroke="#fff" stroke-width="2"/>`,
);

export const ICON_BASE_AIR = svg(
  `<rect x="8" y="30" width="48" height="4" rx="1" fill="#fff"/>` +
  `<rect x="20" y="26" width="24" height="12" rx="1" fill="#fff" opacity="0.4"/>` +
  `<path d="M32 14l-4 12h8z" fill="#fff"/>` +
  `<line x1="8" y1="38" x2="56" y2="38" stroke="#fff" stroke-width="1" opacity="0.5"/>`,
);

// ── Airstrike ──

export const ICON_AIRSTRIKE = svg(
  `<path d="M32 4l-3 12-14 6 1 3 13-3v10l-6 4v3l6-1 6 1v-3l-6-4V22l13 3 1-3-14-6z" fill="#fff"/>` +
  `<circle cx="32" cy="50" r="8" fill="none" stroke="#fff" stroke-width="2" opacity="0.6"/>` +
  `<line x1="32" y1="42" x2="32" y2="58" stroke="#fff" stroke-width="1.5" opacity="0.6"/>` +
  `<line x1="24" y1="50" x2="40" y2="50" stroke="#fff" stroke-width="1.5" opacity="0.6"/>`,
);

// ── Dark vessel (AIS-off) ──

export const ICON_DARK_VESSEL = svg(
  `<path d="M32 8l-10 14-4 22 2 5 3 3h18l3-3 2-5-4-22z" fill="#fff"/>` +
  `<text x="32" y="38" text-anchor="middle" font-family="monospace" font-size="16" font-weight="bold" fill="#000" opacity="0.5">?</text>`,
);

// ── GPS Jamming ──

export const ICON_GPS_JAM = svg(
  `<circle cx="32" cy="32" r="20" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="4 4"/>` +
  `<path d="M32 16v10M32 38v10M16 32h10M38 32h10" stroke="#fff" stroke-width="2"/>` +
  `<line x1="22" y1="22" x2="42" y2="42" stroke="#fff" stroke-width="3"/>` +
  `<line x1="42" y1="22" x2="22" y2="42" stroke="#fff" stroke-width="3"/>`,
);

// ── Satellite change detection ──

export const ICON_SAT_CHANGE = svg(
  `<rect x="16" y="16" width="32" height="32" rx="2" fill="none" stroke="#fff" stroke-width="2"/>` +
  `<line x1="16" y1="32" x2="48" y2="32" stroke="#fff" stroke-width="1" opacity="0.4"/>` +
  `<line x1="32" y1="16" x2="32" y2="48" stroke="#fff" stroke-width="1" opacity="0.4"/>` +
  `<circle cx="32" cy="32" r="6" fill="#fff" opacity="0.8"/>` +
  `<path d="M20 8l4 6M44 8l-4 6" stroke="#fff" stroke-width="1.5"/>`,
);

// ── Disease ──

export const ICON_DISEASE = svg(
  `<circle cx="32" cy="32" r="12" fill="#fff"/>` +
  `<circle cx="20" cy="20" r="5" fill="#fff" opacity="0.6"/>` +
  `<circle cx="44" cy="20" r="4" fill="#fff" opacity="0.5"/>` +
  `<circle cx="18" cy="40" r="3" fill="#fff" opacity="0.4"/>` +
  `<circle cx="46" cy="42" r="4" fill="#fff" opacity="0.5"/>` +
  `<circle cx="36" cy="50" r="3" fill="#fff" opacity="0.4"/>`,
);

// ── Spaceport / Rocket ──

export const ICON_SPACEPORT = svg(
  `<path d="M32 4c-4 4-6 12-6 24h12c0-12-2-20-6-24z" fill="#fff"/>` +
  `<path d="M26 28l-6 16h4l4-10" fill="#fff" opacity="0.8"/>` +
  `<path d="M38 28l6 16h-4l-4-10" fill="#fff" opacity="0.8"/>` +
  `<rect x="28" y="44" width="8" height="4" rx="1" fill="#fff"/>` +
  `<path d="M30 48l-2 12h2l2-8 2 8h2l-2-12z" fill="#fa0" opacity="0.6"/>`,
);

// ── Strategic waterway / chokepoint ──

export const ICON_CHOKEPOINT = svg(
  `<path d="M8 20h48v24H8z" fill="none" stroke="#fff" stroke-width="2" opacity="0.4"/>` +
  `<path d="M8 28c8-8 16-8 24 0s16 8 24 0" fill="none" stroke="#fff" stroke-width="2.5"/>` +
  `<path d="M8 36c8-8 16-8 24 0s16 8 24 0" fill="none" stroke="#fff" stroke-width="2.5" opacity="0.5"/>` +
  `<circle cx="32" cy="32" r="4" fill="#fff"/>`,
);

// ── Critical minerals ──

export const ICON_MINERAL = svg(
  `<path d="M32 8l-16 24 8 24h16l8-24z" fill="#fff"/>` +
  `<path d="M32 8l0 48M16 32l32 0M22 16l20 32M42 16l-20 32" stroke="#000" stroke-width="0.5" opacity="0.3"/>`,
);

// ── Intel hotspot ──

export const ICON_HOTSPOT = svg(
  `<circle cx="32" cy="32" r="8" fill="#fff"/>` +
  `<circle cx="32" cy="32" r="16" fill="none" stroke="#fff" stroke-width="2" opacity="0.5"/>` +
  `<circle cx="32" cy="32" r="24" fill="none" stroke="#fff" stroke-width="1.5" opacity="0.25"/>` +
  `<path d="M32 4v8M32 52v8M4 32h8M52 32h8" stroke="#fff" stroke-width="1.5" opacity="0.4"/>`,
);

// ── Displacement / Refugee ──

export const ICON_DISPLACEMENT = svg(
  `<circle cx="24" cy="18" r="6" fill="#fff"/>` +
  `<path d="M14 56V36a10 10 0 0 1 20 0v20" fill="#fff" opacity="0.8"/>` +
  `<circle cx="42" cy="22" r="5" fill="#fff" opacity="0.6"/>` +
  `<path d="M34 56V40a8 8 0 0 1 16 0v16" fill="#fff" opacity="0.5"/>`,
);

// ── Power infrastructure (OSM / OpenGridWorks) ──

// Lightning bolt — generation / power plant.
export const ICON_POWER_PLANT = svg(
  `<path d="M36 4 16 36h12l-4 24 24-34H34z" fill="#fff"/>`,
);

// Transformer box with terminals — substation / switching.
export const ICON_SUBSTATION = svg(
  `<rect x="16" y="18" width="32" height="28" rx="2" fill="none" stroke="#fff" stroke-width="3"/>` +
  `<path d="M24 28h16M24 36h16" stroke="#fff" stroke-width="3"/>` +
  `<path d="M32 8v10M32 46v10M8 32h8M48 32h8" stroke="#fff" stroke-width="2"/>`,
);

// Lattice pylon — transmission line.
export const ICON_TRANSMISSION_LINE = svg(
  `<path d="M12 56 32 8l20 48" fill="none" stroke="#fff" stroke-width="2.5"/>` +
  `<path d="M18 40h28M22 28h20M26 18h12" stroke="#fff" stroke-width="2"/>`,
);

// Server rack — data center / load.
export const ICON_DATA_CENTER_RACK = svg(
  `<rect x="16" y="10" width="32" height="44" rx="2" fill="none" stroke="#fff" stroke-width="2.5"/>` +
  `<path d="M16 24h32M16 38h32" stroke="#fff" stroke-width="2"/>` +
  `<circle cx="23" cy="17" r="2" fill="#fff"/>` +
  `<circle cx="23" cy="31" r="2" fill="#fff"/>` +
  `<circle cx="23" cy="45" r="2" fill="#fff"/>`,
);

/** Power-asset kind → billboard icon (keys match osm-power's `PowerAssetKind`). */
export const POWER_ICONS: Record<'plant' | 'substation' | 'line' | 'data_center' | 'other', string> = {
  plant: ICON_POWER_PLANT,
  substation: ICON_SUBSTATION,
  line: ICON_TRANSMISSION_LINE,
  data_center: ICON_DATA_CENTER_RACK,
  other: ICON_SUBSTATION,
};

// ── Mapping helpers ──

export const AIRCRAFT_ICONS: Record<string, string> = {
  fighter: ICON_FIGHTER,
  bomber: ICON_BOMBER,
  tanker: ICON_TRANSPORT,
  transport: ICON_TRANSPORT,
  surveillance: ICON_SURVEILLANCE,
  helicopter: ICON_HELICOPTER,
  trainer: ICON_FIGHTER,
  uav: ICON_UAV,
  patrol: ICON_SURVEILLANCE,
  other: ICON_TRANSPORT,
};

export const VESSEL_ICONS: Record<string, string> = {
  carrier: ICON_CARRIER,
  destroyer: ICON_WARSHIP,
  frigate: ICON_WARSHIP,
  corvette: ICON_PATROL_BOAT,
  submarine: ICON_SUBMARINE,
  amphibious: ICON_CARRIER,
  patrol: ICON_PATROL_BOAT,
  auxiliary: ICON_WARSHIP,
  other: ICON_WARSHIP,
};

export const GDACS_ICONS: Record<string, string> = {
  EQ: ICON_EARTHQUAKE,
  FL: ICON_FLOOD,
  TC: ICON_CYCLONE,
  VO: ICON_VOLCANO,
  WF: ICON_WILDFIRE,
  DR: ICON_DROUGHT,
};
