export const LOCAL_LOGISTICS_SCHEMA_VERSION = 2 as const;
export const LOCAL_LOGISTICS_CATEGORIES = ['shelter', 'hotel', 'hospital', 'pharmacy', 'fuel', 'water', 'recovery'] as const;

export type LogisticsCategory = typeof LOCAL_LOGISTICS_CATEGORIES[number];
export type LogisticsFreshness = 'fresh' | 'recent' | 'stale';
export type LogisticsHazardCompatibility = 'general' | 'evacuation' | 'medical' | 'supply';
export type OperationalStatus = 'open' | 'closed' | 'unknown';
export type InventoryStatus = 'available' | 'limited' | 'full' | 'out' | 'unknown';
export type PowerStatus = 'grid' | 'generator' | 'outage' | 'unknown';
export type AccessStatus = 'reachable' | 'blocked' | 'unknown';
export type VerificationMethod = 'directory' | 'official';
export type ObservationConfidence = 'high' | 'medium' | 'low' | 'unknown';
export type LifelineProviderId = 'osm' | 'fema' | 'fema-open-shelters' | 'fema-recovery-centers' | 'ornl-odin';
export type ProviderState = 'ok' | 'empty' | 'partial' | 'stale' | 'error';

export interface ResourceSite {
  id: string;
  kind: LogisticsCategory;
  name: string;
  lat: number;
  lon: number;
  distanceKm?: number;
  address?: string;
  publicPhone?: string;
  directoryUrl?: string;
  sourceRefs: { provider: 'osm' | 'fema'; recordId: string }[];
  capabilities: {
 lodgingType?: 'hotel' | 'motel' | 'hostel' | 'other';
 evacuationCapacity?: number;
 postImpactCapacity?: number;
 reportedPopulation?: number;
 ada?: boolean;
 wheelchairAccessible?: boolean;
 pets?: boolean;
 generatorOnsite?: boolean;
 directoryHours?: string;
  };
}

export interface ResourceObservation {
  id: string;
  siteId: string;
  provider: 'osm' | 'fema';
  verification: VerificationMethod;
  operational: OperationalStatus;
  inventory: InventoryStatus;
  power: PowerStatus;
  access: AccessStatus;
  /** Compatibility alias. When no upstream timestamp exists this is retrieval time. */
  observedAt: Date;
  /** Time Crystal Ball retrieved and validated the provider response. */
  retrievedAt?: Date;
  /** Real upstream observation/report timestamp, when the provider publishes one. */
  sourceObservedAt?: Date;
  expiresAt: Date;
  confidence: ObservationConfidence;
  sourceUrl: string;
}

export interface ProviderStatus {
  id: LifelineProviderId;
  state: ProviderState;
  acceptedRows: number;
  droppedRows: number;
  /** Compatibility alias for retrieval time. */
  observedAt: Date | null;
  retrievedAt?: Date | null;
  sourceObservedAt?: Date | null;
  reasonCode?: string;
}

export interface AreaCondition {
  id: string;
  type: 'power_outage';
  coverage: 'reported' | 'unknown';
  countyFips: string;
  county: string;
  state: string;
  customersOut: number;
  customersRestored?: number;
  utilityName?: string;
  utilityId?: string;
  /** Compatibility alias for retrieval time. */
  observedAt: Date;
  retrievedAt?: Date;
  sourceObservedAt?: Date;
  expiresAt: Date;
  source: 'ornl-odin';
}

/** Presentation model assembled only after strict v2 boundary validation. */
export interface LogisticsNode extends ResourceSite {
  category: LogisticsCategory;
  distanceKm: number;
  source: string;
  freshness: LogisticsFreshness;
  hazardCompatibility: LogisticsHazardCompatibility;
  fetchedAt: Date;
  operational: OperationalStatus;
  inventory: InventoryStatus;
  power: PowerStatus;
  access: AccessStatus;
  verification: VerificationMethod;
  observedAt: Date;
  retrievedAt?: Date;
  sourceObservedAt?: Date;
  expiresAt: Date;
  confidence: ObservationConfidence;
  sourceUrl: string;
  directoryOnly: boolean;
  address?: string;
  url?: string;
}

export interface LocalLogisticsSnapshot {
  schemaVersion: 2;
  queryFingerprint: string;
  placeId: string;
  placeName: string;
  effectiveRadiusKm: number;
  countyFips?: string;
  categories: LogisticsCategory[];
  sites: ResourceSite[];
  observations: ResourceObservation[];
  nodes: LogisticsNode[];
  areaConditions: AreaCondition[];
  providers: ProviderStatus[];
  fetchedAt: Date;
  isStale: boolean;
  isExpired: boolean;
  staleAgeMs: number;
  source: 'network' | 'offline-cache';
}

export const LOCAL_LOGISTICS_CATEGORY_LABELS: Record<LogisticsCategory, string> = {
  shelter: 'Shelter',
  hotel: 'Hotel',
  hospital: 'Hospital',
  pharmacy: 'Pharmacy',
  fuel: 'Fuel',
  water: 'Water',
  recovery: 'Recovery Center',
};
