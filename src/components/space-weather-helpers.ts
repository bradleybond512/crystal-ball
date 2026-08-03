import type {
  GeomagStormLevel,
  RiskBand,
  SpaceWxAlert,
} from '@/services/spaceweather/swpc-monitor';

const HOUR_MS = 60 * 60 * 1000;

export function stormLevelLabel(level: GeomagStormLevel): string {
  switch (level) {
    case 'G0': { return 'Quiet';
    }
    case 'G1': { return 'Minor storm';
    }
    case 'G2': { return 'Moderate storm';
    }
    case 'G3': { return 'Strong storm';
    }
    case 'G4': { return 'Severe storm';
    }
    case 'G5': { return 'Extreme storm';
    }
  }
}

export function gpsRiskBlurb(risk: RiskBand): string {
  switch (risk) {
    case 'high': { return 'X-class — degraded fixes';
    }
    case 'moderate': { return 'M-class — possible drift';
    }
    case 'low': { return 'C-class — minor';
    }
    case 'none': { return 'Nominal';
    }
  }
}

export function alertSeverityClass(sev: string): string {
  if (sev === 'alert') return 'sw-danger';
  if (sev === 'warning') return 'sw-warning';
  if (sev === 'watch') return 'sw-warning';
  return 'sw-info';
}

export function xrayBadgeColor(cls: string | null): string {
  if (!cls) return '#9e9e9e';
  const head = cls.charAt(0).toUpperCase();
  if (head === 'X') return '#ff453a';
  if (head === 'M') return '#ff5722';
  if (head === 'C') return '#ffeb3b';
  if (head === 'B') return '#4caf50';
  return '#9e9e9e';
}

export const G_LEVEL_COLOR: Record<GeomagStormLevel, string> = {
  G0: '#9e9e9e',
  G1: '#ffeb3b',
  G2: '#ff9800',
  G3: '#ff5722',
  G4: '#ff453a',
  G5: '#b71c1c',
};

export const RISK_COLOR: Record<RiskBand, string> = {
  none: '#9e9e9e',
  low: '#ffeb3b',
  moderate: '#ff9800',
  high: '#ff453a',
};

export interface ArrivalCountdown {
  label: string;
  severityClass: string;
}

export function formatArrivalCountdown(arrivalMs: number, nowMs: number): ArrivalCountdown {
  if (!Number.isFinite(arrivalMs)) return { label: 'arrival unknown', severityClass: 'sw-info' };
  const deltaMs = arrivalMs - nowMs;
  if (deltaMs <= 0) {
    const hoursPast = Math.abs(deltaMs) / HOUR_MS;
    if (hoursPast < 6) return { label: 'arriving now', severityClass: 'sw-danger' };
    return { label: 'arrived', severityClass: 'sw-info' };
  }
  const hours = deltaMs / HOUR_MS;
  if (hours < 12) return { label: `T-${hours.toFixed(1)}h`, severityClass: 'sw-danger' };
  if (hours < 24) return { label: `T-${hours.toFixed(0)}h`, severityClass: 'sw-warning' };
  if (hours < 72) return { label: `T-${(hours / 24).toFixed(1)}d`, severityClass: 'sw-warning' };
  return { label: `T-${(hours / 24).toFixed(1)}d`, severityClass: 'sw-info' };
}

export function legacyAlertToStatus(a: {
  id: string; severity: 'watch' | 'warning' | 'alert' | 'summary'; message: string; issuedAt: Date;
}): SpaceWxAlert {
  return {
    id: a.id,
    severity: a.severity,
    headline: a.message,
    issuedAt: a.issuedAt.toISOString(),
  };
}

/**
 * Bz is the north-south component of the interplanetary magnetic field, and it
 * is the single best short-horizon predictor of a geomagnetic storm — but only
 * in one direction. A SOUTHWARD (negative) Bz reconnects with Earth's field and
 * lets solar-wind energy in; a strongly northward Bz is a quiet sky. So this
 * scale is deliberately asymmetric: +18 nT is green, -18 nT is red. A symmetric
 * "large absolute value is bad" scale would cry wolf on the calmest conditions.
 */
export function bzBadgeColor(bz: number | null): string {
  if (bz === null || !Number.isFinite(bz)) return '#9e9e9e';
  if (bz <= -15) return '#ff453a';
  if (bz <= -10) return '#ff5722';
  if (bz <= -5) return '#ff9800';
  return '#4caf50';
}

/** Ambient solar wind runs 300–500 km/s; a coronal-hole stream runs 600–800. */
export function windSpeedBadgeColor(speedKmS: number | null): string {
  if (speedKmS === null || !Number.isFinite(speedKmS)) return '#9e9e9e';
  if (speedKmS >= 800) return '#ff453a';
  if (speedKmS >= 600) return '#ff9800';
  if (speedKmS >= 500) return '#ffeb3b';
  return '#4caf50';
}

/**
 * The propagated solar-wind product updates about once a minute, so a sample
 * much older than half an hour means the L1 feed has gone quiet even though the
 * request succeeded. Nothing in the parse path bounds observation age — it
 * takes the newest row it can find, however old that is — so this label is the
 * only place staleness becomes visible.
 */
export const WIND_STALE_AFTER_MS = 30 * 60 * 1000;

/**
 * Rows are propagated from L1 to the bow shock, so a stamp a few minutes ahead
 * of the wall clock is normal rather than corrupt. Beyond that the stamp is
 * wrong, and an unknown-age reading is treated as stale — claiming freshness we
 * cannot demonstrate is the failure mode worth avoiding here.
 */
const WIND_FUTURE_SKEW_TOLERANCE_MS = 15 * 60 * 1000;

export interface WindObservationAge {
  label: string;
  stale: boolean;
}

export function windObservationAge(
  observedAt: string | null,
  now = Date.now(),
): WindObservationAge {
  if (!observedAt) return { label: 'age unknown', stale: true };
  const at = Date.parse(observedAt);
  if (!Number.isFinite(at)) return { label: 'age unknown', stale: true };
  const ageMs = now - at;
  if (ageMs < -WIND_FUTURE_SKEW_TOLERANCE_MS) return { label: 'age unknown', stale: true };
  const label = timeAgo(new Date(at), now);
  return { label, stale: ageMs > WIND_STALE_AFTER_MS };
}

export interface WindCell {
  label: string;
  value: string;
  color: string;
  sub: string;
}

export interface WindStripView {
  /** Right-hand meta line: observation age, or why there is no reading. */
  meta: string;
  /** True when meta should be styled as a warning rather than dim. */
  metaWarn: boolean;
  cells: WindCell[];
}

/**
 * Builds the solar-wind strip as data so the number formatting is testable
 * without a DOM. Values are `—` rather than 0 when absent: a solar wind of
 * 0 km/s would be the end of the world, so a missing reading must never be
 * rendered as one.
 */
export function buildWindStrip(
  wind: {
    solarWindSpeed: number | null;
    solarWindDensity: number | null;
    bz: number | null;
    windObservedAt: string | null;
  },
  now = Date.now(),
): WindStripView {
  const { solarWindSpeed: speed, solarWindDensity: density, bz } = wind;
  const missing = speed === null && density === null && bz === null;
  const age = windObservationAge(wind.windObservedAt, now);
  // The sign carries the whole meaning of Bz, so a positive value is written
  // with an explicit "+" rather than left bare next to its negative sibling.
  const bzSign = bz !== null && bz > 0 ? '+' : '';
  return {
    meta: missing ? 'no solar-wind telemetry in this fetch' : `measured ${age.label}`,
    metaWarn: missing || age.stale,
    cells: [
      {
        label: 'Speed',
        value: speed === null ? '—' : `${Math.round(speed)} km/s`,
        color: windSpeedBadgeColor(speed),
        sub: 'Ambient 300–500',
      },
      {
        label: 'Density',
        value: density === null ? '—' : `${density.toFixed(1)} p/cm³`,
        color: '#9e9e9e',
        sub: 'Protons per cm³',
      },
      {
        label: 'Bz',
        value: bz === null ? '—' : `${bzSign}${bz.toFixed(1)} nT`,
        color: bzBadgeColor(bz),
        sub: bz !== null && bz < 0 ? 'Southward — storm driver' : 'Northward is quiet',
      },
    ],
  };
}

export function timeAgo(d: Date, now = Date.now()): string {
  const secs = Math.floor((now - d.getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}
