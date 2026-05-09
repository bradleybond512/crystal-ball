/**
 * OFAC SDN (Specially Designated Nationals) types — pure data
 * shapes shared between the parser, the search index, the sidecar
 * cache file, and the renderer panel.
 *
 * Names mirror the upstream Treasury XML where reasonable, but field
 * casing follows the rest of the codebase (camelCase, no hungarian).
 */

export type SdnType = 'individual' | 'vessel' | 'aircraft' | 'entity' | 'unknown';

export interface VesselInfo {
  callSign: string | null;
  vesselType: string | null;
  vesselFlag: string | null;
  vesselOwner: string | null;
  /** Gross tonnage (raw string from upstream). */
  tonnage: string | null;
  /** IMO number, copied here when present in idList for convenience. */
  imo: string | null;
}

export interface AircraftInfo {
  tailNumber: string | null;
  model: string | null;
  operator: string | null;
  manufactureDate: string | null;
  constructionNumber: string | null;
}

export interface SdnId {
  idType: string;
  idNumber: string;
  idCountry: string | null;
}

export interface SdnAddress {
  country: string | null;
  city: string | null;
  region: string | null;
}

export interface SdnEntry {
  /** Stable upstream uid as a string ("12345"). */
  uid: string;
  /** Display name. For individuals "Last, First"; for vessels/aircraft
   *  the raw ship/tail name. Always non-empty (we drop entries
   *  upstream when no name is parseable). */
  name: string;
  type: SdnType;
  /** Sanctions programs this entry is listed under (e.g. "SDGT",
   *  "CYBER2", "UKRAINE-EO13662"). Always lowercase-trimmed and
   *  deduped. */
  programs: string[];
  /** All a.k.a. names, lowercased + deduped. Used for search +
   *  vessel-name cross-reference. */
  aliases: string[];
  countries: string[];
  ids: SdnId[];
  vessel: VesselInfo | null;
  aircraft: AircraftInfo | null;
  remarks: string | null;
}

/** The cached payload written to disk and consumed by the renderer
 *  via /api/sanctions/* — versioned so a parser change forces a
 *  refresh rather than mis-typing the old file. */
export interface OfacCacheFile {
  version: 1;
  /** ms epoch when the upstream XML was downloaded. */
  fetchedAt: number;
  /** Raw byte length of the upstream XML, used as a quick "is this
   *  the same payload as last week" sanity check. */
  upstreamBytes: number;
  /** Total entries in `entries` (kept here so the panel can show a
   *  count badge without walking the array). */
  entryCount: number;
  entries: SdnEntry[];
}
