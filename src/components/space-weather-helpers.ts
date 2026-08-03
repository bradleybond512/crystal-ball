import { toUtcIsoTag } from '@/services/space-weather-parse';
import type {
  GeomagStormLevel,
  RiskBand,
  SpaceWxAlert,
} from '@/services/spaceweather/swpc-monitor';

const HOUR_MS = 60 * 60 * 1000;

/**
 * One severity ramp, shared by every badge in this panel. X-ray class, Kp storm
 * level, GPS risk, wind speed and Bz all mean "how bad is this" on the same
 * scale, so they should be the same colour at the same tier — four independent
 * copies of these hues drift apart the moment one of them is adjusted.
 *
 * Literal hues rather than CSS vars: these are read into inline `style=`
 * attributes, not stylesheets, and `unknown` in particular must be a real grey
 * — a var() that fails to resolve renders as inherited text colour, which reads
 * as a confident value rather than as no value.
 */
const SEVERITY_HEX = {
  unknown: '#9e9e9e',
  calm: '#4caf50',
  low: '#ffeb3b',
  moderate: '#ff9800',
  high: '#ff5722',
  severe: '#ff453a',
  extreme: '#b71c1c',
} as const;

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
  if (!cls) return SEVERITY_HEX.unknown;
  const head = cls.charAt(0).toUpperCase();
  if (head === 'X') return SEVERITY_HEX.severe;
  if (head === 'M') return SEVERITY_HEX.high;
  if (head === 'C') return SEVERITY_HEX.low;
  if (head === 'B') return SEVERITY_HEX.calm;
  return SEVERITY_HEX.unknown;
}

export const G_LEVEL_COLOR: Record<GeomagStormLevel, string> = {
  G0: SEVERITY_HEX.unknown,
  G1: SEVERITY_HEX.low,
  G2: SEVERITY_HEX.moderate,
  G3: SEVERITY_HEX.high,
  G4: SEVERITY_HEX.severe,
  G5: SEVERITY_HEX.extreme,
};

export const RISK_COLOR: Record<RiskBand, string> = {
  none: SEVERITY_HEX.unknown,
  low: SEVERITY_HEX.low,
  moderate: SEVERITY_HEX.moderate,
  high: SEVERITY_HEX.severe,
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
  if (bz === null || !Number.isFinite(bz)) return SEVERITY_HEX.unknown;
  if (bz <= -15) return SEVERITY_HEX.severe;
  if (bz <= -10) return SEVERITY_HEX.high;
  if (bz <= -5) return SEVERITY_HEX.moderate;
  return SEVERITY_HEX.calm;
}

/** Ambient solar wind runs 300–500 km/s; a coronal-hole stream runs 600–800. */
export function windSpeedBadgeColor(speedKmS: number | null): string {
  if (speedKmS === null || !Number.isFinite(speedKmS)) return SEVERITY_HEX.unknown;
  if (speedKmS >= 800) return SEVERITY_HEX.severe;
  if (speedKmS >= 600) return SEVERITY_HEX.moderate;
  if (speedKmS >= 500) return SEVERITY_HEX.low;
  return SEVERITY_HEX.calm;
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

const finiteOrNull = (n: number | null): number | null =>
  n !== null && Number.isFinite(n) ? n : null;

export interface WindObservationAge {
  label: string;
  stale: boolean;
}

export function windObservationAge(
  observedAt: string | null,
  now = Date.now(),
): WindObservationAge {
  if (!observedAt) return { label: 'age unknown', stale: true };
  // parseSolarWindFeed already hands us a Z-stamped ISO string, but this helper
  // is exported and SWPC's raw tags are naïve UTC — which bare Date.parse reads
  // as host-LOCAL. That has silently shifted timestamps twice in this codebase
  // already, so normalize here rather than trust every future caller.
  const at = Date.parse(toUtcIsoTag(observedAt));
  if (!Number.isFinite(at)) return { label: 'age unknown', stale: true };
  const ageMs = now - at;
  if (ageMs < -WIND_FUTURE_SKEW_TOLERANCE_MS) return { label: 'age unknown', stale: true };
  const label = timeAgo(new Date(at), now);
  return { label, stale: ageMs > WIND_STALE_AFTER_MS };
}

function bzSubtitle(bz: number | null): string {
  if (bz === null) return 'No magnetometer reading';
  return bz < 0 ? 'Southward — storm driver' : 'Northward is quiet';
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
  // A null is not the only way a reading goes missing: NaN and Infinity survive
  // a `=== null` check and format as "NaN km/s" with confident units. The badge
  // helpers already treat non-finite as unknown, so the value formatting has to
  // agree with them or the number and its colour tell different stories.
  const speed = finiteOrNull(wind.solarWindSpeed);
  const density = finiteOrNull(wind.solarWindDensity);
  const bz = finiteOrNull(wind.bz);
  const missing = speed === null && density === null && bz === null;
  const age = windObservationAge(wind.windObservedAt, now);
  // The sign carries the whole meaning of Bz, so a positive value is written
  // with an explicit "+" rather than left bare next to its negative sibling.
  const bzSign = bz !== null && bz > 0 ? '+' : '';
  // A stale reading keeps its numbers — they are real, just old — but loses its
  // badge colour. Green on an hour-old sample asserts "calm right now" off
  // evidence that says nothing about right now, and the colour is the part of
  // the cell read at a glance; the small age line beside it is not.
  const tint = (c: string): string => (age.stale ? SEVERITY_HEX.unknown : c);
  return {
    meta: missing ? 'no solar-wind telemetry in this fetch' : `measured ${age.label}`,
    metaWarn: missing || age.stale,
    cells: [
      {
        label: 'Speed',
        value: speed === null ? '—' : `${Math.round(speed)} km/s`,
        color: tint(windSpeedBadgeColor(speed)),
        sub: age.stale && speed !== null ? 'Last known — not current' : 'Ambient 300–500',
      },
      {
        label: 'Density',
        value: density === null ? '—' : `${density.toFixed(1)} p/cm³`,
        // Density alone carries no severity — a dense slow wind is unremarkable
        // — so it is deliberately neutral rather than scaled.
        color: SEVERITY_HEX.unknown,
        sub: 'Protons per cm³',
      },
      {
        label: 'Bz',
        value: bz === null ? '—' : `${bzSign}${bz.toFixed(1)} nT`,
        color: tint(bzBadgeColor(bz)),
        // Three states, not two. A missing Bz must not read as "Northward is
        // quiet" — that is the magnetometer going dark reported as an all-clear,
        // and Bz is the single best short-horizon storm predictor we have.
        sub: bzSubtitle(bz),
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
