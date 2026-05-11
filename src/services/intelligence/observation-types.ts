// The atomic observation unit consumed by the correlate stage
export interface ObservationEvent {
  id: string;
  domain: string;           // e.g. 'aviation', 'earthquake', 'conflict', 'weather', 'cyber', 'maritime'
  eventType: string;        // e.g. 'flight-emergency', 'M6.2-earthquake'
  title: string;            // human-readable one-liner
  severity: number;         // 0-10
  occurredAt: number;       // epoch ms
  lat?: number;             // optional — not all events have coords
  lon?: number;
  entities: string[];       // country codes, ICAO hex, tickers, CVE ids, etc.
  sourceIds: string[];      // provider ids that attested this
  active: boolean;          // false = event has resolved/ended
}

// Minimal interface the CorrelationEngine accepts — real ObservationStore must implement this
export interface ObservationStoreReader {
  getEvents(since?: number): ObservationEvent[];
}

// A detected cross-domain correlation
export interface Correlation {
  id: string;               // stable: hash/deterministic from event ids
  events: ObservationEvent[];  // 2+ events that correlate
  type: 'spatial' | 'temporal' | 'entity';
  confidence: number;       // 0-1
  title: string;            // e.g. "M6.2 earthquake near Narita Airport — aviation + seismic"
  detectedAt: number;       // epoch ms when correlation was first detected
}
