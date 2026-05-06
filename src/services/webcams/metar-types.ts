export type FlightRule = 'VFR' | 'MVFR' | 'IFR' | 'LIFR';

export interface MetarCloudLayer {
  cover: 'SKC' | 'CLR' | 'FEW' | 'SCT' | 'BKN' | 'OVC' | 'VV' | 'OVX';
  baseFt: number | null;
}

export interface MetarData {
  stationId: string;
  observedAtSec: number | null;
  rawObservation: string | null;
  windDirDeg: number | null;
  windSpeedKt: number | null;
  windGustKt: number | null;
  visibilityMi: number | null;
  ceilingFt: number | null;
  weather: string | null;
  tempC: number | null;
  dewpointC: number | null;
  altimeterInHg: number | null;
  clouds: MetarCloudLayer[];
}

export interface MetarStation {
  icaoId: string;
  lat: number;
  lon: number;
  elevFt: number | null;
  site: string;
  state: string;
  country: string;
}

export interface FaaCameraEnrichment {
  nearestMetarStation: string | null;
  currentMetar: MetarData | null;
  flightRule: FlightRule | null;
  adsbCount: number;
}
