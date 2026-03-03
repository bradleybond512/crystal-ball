// OSINT intelligence engine type definitions.
// These mirror the Go types in src-tauri/go/pkg/api/types.go.

/** WHOIS registration information for a domain. */
export interface WhoisData {
  registrar: string;
  created_date: string;
  expires_date: string;
  updated_date: string;
  name_servers: string[];
  status: string[];
  registrant: string;
  raw_text: string;
}

/** A single mail exchange record. */
export interface MXRecord {
  host: string;
  priority: number;
}

/** Resolved DNS records for a domain. */
export interface DNSRecords {
  a: string[];
  mx: MXRecord[];
  ns: string[];
  txt: string[];
}

/** TLS/SSL certificate information for a domain. */
export interface SSLCertificate {
  subject: string;
  issuer: string;
  valid_from: string;
  valid_until: string;
  sans: string[];
  is_expired: boolean;
}

/** A single archived snapshot from the Wayback Machine. */
export interface WaybackSnapshot {
  timestamp: string;
  url: string;
  mime_type: string;
  status_code: number;
}

/** Full domain intelligence result. */
export interface DomainIntelligence {
  domain: string;
  whois: WhoisData | null;
  dns: DNSRecords;
  ssl: SSLCertificate | null;
  wayback_snapshots: WaybackSnapshot[];
  virustotal_score: number | null;
  last_updated: number;
  cached: boolean;
}

/** A result for a single platform check during username search. */
export interface PlatformMatch {
  platform: string;
  url: string;
  found: boolean;
}

/** Result of searching for a username across social platforms. */
export interface UsernameSearchResult {
  username: string;
  found_on: PlatformMatch[];
  total_checked: number;
  last_updated: number;
  cached: boolean;
}

/** Whether the search input looks like a domain or username. */
export type OsintSearchMode = 'domain' | 'username';

/** Detect whether a search string is a domain or username. */
export function detectSearchMode(input: string): OsintSearchMode {
  const trimmed = input.trim().toLowerCase();
  // Strip protocol prefix for detection
  const stripped = trimmed.replace(/^https?:\/\//, '');
  // If it contains a dot but no @ or special username chars, treat as domain
  if (stripped.includes('.') && !stripped.includes('@')) {
    return 'domain';
  }
  return 'username';
}
