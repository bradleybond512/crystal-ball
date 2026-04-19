export interface NmeaPosition {
  latitude: number;
  longitude: number;
  altitude: number | null;
  speed: number | null;
  heading: number | null;
  accuracy: number | null;
  timestamp: number;
  satellites: number;
  fixQuality: 0 | 1 | 2;
}

function parseLatLon(raw: string, dir: string): number {
  const dotIdx = raw.indexOf('.');
  const degLen = dotIdx - 2;
  const degrees = Number.parseFloat(raw.slice(0, degLen));
  const minutes = Number.parseFloat(raw.slice(degLen));
  let decimal = degrees + minutes / 60;
  if (dir === 'S' || dir === 'W') decimal = -decimal;
  return decimal;
}

function knotsToMs(knots: string): number {
  return Number.parseFloat(knots) * 0.514_444;
}

export function parseGGA(fields: string[]): NmeaPosition | null {
  if (fields.length < 15) return null;
  const fixQuality = Number.parseInt(fields[6] ?? '0', 10) as 0 | 1 | 2;
  if (fixQuality === 0) return null;

  const latitude = parseLatLon(fields[2] ?? '', fields[3] ?? '');
  const longitude = parseLatLon(fields[4] ?? '', fields[5] ?? '');
  const satellites = Number.parseInt(fields[7] ?? '0', 10) || 0;
  const altitude = fields[9] ? Number.parseFloat(fields[9]) : null;

  return {
    latitude,
    longitude,
    altitude,
    speed: null,
    heading: null,
    accuracy: null,
    timestamp: Date.now(),
    satellites,
    fixQuality,
  };
}

export function parseRMC(fields: string[]): NmeaPosition | null {
  if (fields.length < 12) return null;
  if (fields[2] !== 'A') return null;

  const latitude = parseLatLon(fields[3] ?? '', fields[4] ?? '');
  const longitude = parseLatLon(fields[5] ?? '', fields[6] ?? '');
  const speed = fields[7] ? knotsToMs(fields[7]) : null;
  const heading = fields[8] ? Number.parseFloat(fields[8]) : null;

  return {
    latitude,
    longitude,
    altitude: null,
    speed,
    heading,
    accuracy: null,
    timestamp: Date.now(),
    satellites: 0,
    fixQuality: 1,
  };
}

export function parseNmea(sentence: string): NmeaPosition | null {
  const trimmed = sentence.trim();
  if (!trimmed.startsWith('$')) return null;

  const withoutChecksum = trimmed.split('*')[0] ?? trimmed;
  const fields = withoutChecksum.split(',');
  const type = (fields[0] ?? '').slice(3);

  switch (type) {
    case 'GGA': { return parseGGA(fields);
    }
    case 'RMC': { return parseRMC(fields);
    }
    default: { return null;
    }
  }
}
