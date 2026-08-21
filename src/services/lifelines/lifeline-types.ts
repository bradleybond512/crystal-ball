import type {
  AccessStatus,
  InventoryStatus,
  OperationalStatus,
  PowerStatus,
  ResourceSite,
} from '../local-logistics-types';

export type LifelineFactScope = 'site' | 'area';
export type LifelineFactKnowledge = 'reported' | 'directory' | 'unknown';
export type LifelineFactProvider = 'osm' | 'fema' | 'ornl-odin';
export type LifelineUnknownReason =
  | 'not-reported'
  | 'expired'
  | 'directory-not-operational'
  | 'capacity-is-not-availability'
  | 'coverage-unknown';

export type LifelineFactAttribute =
  | 'identity'
  | 'operational'
  | 'inventory'
  | 'power'
  | 'access'
  | 'evacuation-capacity'
  | 'post-impact-capacity'
  | 'reported-population'
  | 'county-customers-out'
  | 'county-customers-restored';

export type LifelineFactValue =
  | string
  | number
  | null;

/**
 * One narrowly scoped claim with its evidence lifetime. `unknown` is a value,
 * not an all-clear: presentation code must preserve `knowledge` and `reason`.
 */
export interface LifelineFact<T extends LifelineFactValue = LifelineFactValue> {
  id: string;
  scope: LifelineFactScope;
  subjectId: string;
  attribute: LifelineFactAttribute;
  value: T;
  knowledge: LifelineFactKnowledge;
  provider: LifelineFactProvider;
  observedAt: Date | null;
  expiresAt: Date | null;
  sourceObservationId?: string;
  reason?: LifelineUnknownReason;
}

export interface LifelineSiteSituation {
  site: ResourceSite;
  identity: LifelineFact<string>;
  operational: LifelineFact<OperationalStatus>;
  inventory: LifelineFact<InventoryStatus>;
  power: LifelineFact<PowerStatus>;
  access: LifelineFact<AccessStatus>;
  capacities: Array<LifelineFact<number | null>>;
}

export interface LifelineAreaSituation {
  areaConditionId: string;
  countyFips: string;
  county: string;
  state: string;
  customersOut: LifelineFact<number | null>;
  customersRestored?: LifelineFact<number | null>;
}

/** Pure domain view derived from the existing local-logistics schema-v2 snapshot. */
export interface LifelineSituation {
  schemaVersion: 1;
  sourceSchemaVersion: 2;
  queryFingerprint: string;
  placeId: string;
  placeName: string;
  derivedAt: Date;
  sites: LifelineSiteSituation[];
  areas: LifelineAreaSituation[];
  facts: LifelineFact[];
}
