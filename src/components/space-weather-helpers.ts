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

export function timeAgo(d: Date, now = Date.now()): string {
  const secs = Math.floor((now - d.getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}
