/**
 * Pure helper functions and static data for DigitalInfrastructurePanel.
 *
 * Side-effect-free so unit tests can import them without DOM or live
 * services. The panel covers seven digital-infrastructure threat surfaces:
 *   1. Undersea cable cuts
 *   2. Internet exchange point disruptions
 *   3. BGP hijacks and route leaks
 *   4. DNS infrastructure attacks
 *   5. Cloud provider outages (AWS / Azure / GCP)
 *   6. CDN disruptions
 *   7. Satellite internet status
 */

// ── Shared types ─────────────────────────────────────────────────────────

export type InfraSeverity = 'low' | 'medium' | 'high' | 'critical';

export type InfraStatus = 'operational' | 'degraded' | 'partial_outage' | 'major_outage';

// ── 1. Undersea cables ───────────────────────────────────────────────────

export type CableIncidentType = 'shunt_fault' | 'shallow_cut' | 'deep_cut' | 'multiple_cuts' | 'sabotage_suspected';

export interface UnderseaCableIncident {
  cableName: string;
  /** E.g. "Red Sea", "Baltic Sea". */
  region: string;
  incidentType: CableIncidentType;
  severity: InfraSeverity;
  affectedCountries: string[];
  /** Megabits per second of capacity reduced, 0 if unknown. */
  capacityLossGbps: number;
  /** ISO date of incident report. */
  reportedAt: string;
  detail: string;
}

// ── 2. Internet exchange points ──────────────────────────────────────────

export interface IxpDisruption {
  ixpName: string;
  city: string;
  countryCode: string;
  status: InfraStatus;
  /** Percent of peers currently unreachable, 0-100. */
  peersAffectedPct: number;
  cause: string;
}

// ── 3. BGP hijacks / route leaks ─────────────────────────────────────────

export type BgpEventKind = 'hijack' | 'route_leak' | 'origin_spoof' | 'subprefix_hijack';

export interface BgpEvent {
  kind: BgpEventKind;
  /** Origin AS number performing the hijack/leak. */
  originAsn: number;
  originName: string;
  /** Victim AS number whose prefix was hijacked. */
  victimAsn: number;
  victimName: string;
  prefix: string;
  severity: InfraSeverity;
  /** Duration in minutes since detection; -1 if ongoing. */
  durationMin: number;
}

// ── 4. DNS infrastructure attacks ────────────────────────────────────────

export type DnsAttackType = 'ddos' | 'cache_poisoning' | 'registrar_compromise' | 'nx_amplification' | 'water_torture';

export interface DnsAttack {
  target: string;
  attackType: DnsAttackType;
  severity: InfraSeverity;
  /** Queries per second peak. */
  peakQps: number;
  /** Whether mitigation is in place. */
  mitigated: boolean;
  detail: string;
}

// ── 5. Cloud provider outages ────────────────────────────────────────────

export type CloudProvider = 'aws' | 'azure' | 'gcp' | 'oracle' | 'ibm';

export interface CloudOutage {
  provider: CloudProvider;
  service: string;
  region: string;
  status: InfraStatus;
  /** Customer-facing impact summary. */
  impact: string;
  /** ISO datetime when the incident started. */
  startedAt: string;
}

// ── 6. CDN disruptions ───────────────────────────────────────────────────

export interface CdnDisruption {
  cdnName: string;
  pop: string;
  status: InfraStatus;
  /** Percent of requests failing in the affected POP. */
  errorRatePct: number;
  cause: string;
}

// ── 7. Satellite internet status ─────────────────────────────────────────

export type SatStatus = 'nominal' | 'reduced_capacity' | 'regional_outage' | 'constellation_event';

export interface SatelliteSystem {
  systemName: string;
  /** E.g. "LEO Constellation", "GEO Spot Beam". */
  orbitClass: string;
  status: SatStatus;
  /** Approximate active user count in millions. */
  activeUsersM: number;
  /** Most recent significant event or note. */
  note: string;
}

// ── Color and label helpers ──────────────────────────────────────────────

export function severityColor(s: InfraSeverity): string {
  switch (s) {
    case 'critical': { return '#b71c1c';
    }
    case 'high': {     return '#e53935';
    }
    case 'medium': {   return '#fb8c00';
    }
    case 'low': {      return '#fdd835';
    }
  }
}

export function statusColor(s: InfraStatus): string {
  switch (s) {
    case 'major_outage': {   return '#b71c1c';
    }
    case 'partial_outage': { return '#e53935';
    }
    case 'degraded': {       return '#fb8c00';
    }
    case 'operational': {    return '#43a047';
    }
  }
}

export function statusLabel(s: InfraStatus): string {
  switch (s) {
    case 'major_outage': {   return 'Major Outage';
    }
    case 'partial_outage': { return 'Partial Outage';
    }
    case 'degraded': {       return 'Degraded';
    }
    case 'operational': {    return 'Operational';
    }
  }
}

export function cableIncidentLabel(t: CableIncidentType): string {
  switch (t) {
    case 'shunt_fault': {       return 'Shunt Fault';
    }
    case 'shallow_cut': {       return 'Shallow Cut';
    }
    case 'deep_cut': {          return 'Deep Cut';
    }
    case 'multiple_cuts': {     return 'Multiple Cuts';
    }
    case 'sabotage_suspected': { return 'Sabotage Suspected';
    }
  }
}

export function bgpEventLabel(k: BgpEventKind): string {
  switch (k) {
    case 'hijack': {            return 'Full Prefix Hijack';
    }
    case 'route_leak': {        return 'Route Leak';
    }
    case 'origin_spoof': {      return 'Origin Spoof';
    }
    case 'subprefix_hijack': {  return 'Sub-prefix Hijack';
    }
  }
}

export function dnsAttackLabel(t: DnsAttackType): string {
  switch (t) {
    case 'ddos': {                  return 'Volumetric DDoS';
    }
    case 'cache_poisoning': {       return 'Cache Poisoning';
    }
    case 'registrar_compromise': {  return 'Registrar Compromise';
    }
    case 'nx_amplification': {      return 'NXDOMAIN Amplification';
    }
    case 'water_torture': {         return 'Random-subdomain Flood';
    }
  }
}

export function cloudProviderLabel(p: CloudProvider): string {
  switch (p) {
    case 'aws': {    return 'AWS';
    }
    case 'azure': {  return 'Azure';
    }
    case 'gcp': {    return 'GCP';
    }
    case 'oracle': { return 'Oracle Cloud';
    }
    case 'ibm': {    return 'IBM Cloud';
    }
  }
}

export function satStatusLabel(s: SatStatus): string {
  switch (s) {
    case 'nominal': {              return 'Nominal';
    }
    case 'reduced_capacity': {     return 'Reduced Capacity';
    }
    case 'regional_outage': {      return 'Regional Outage';
    }
    case 'constellation_event': {  return 'Constellation Event';
    }
  }
}

export function satStatusColor(s: SatStatus): string {
  switch (s) {
    case 'constellation_event': { return '#b71c1c';
    }
    case 'regional_outage': {     return '#e53935';
    }
    case 'reduced_capacity': {    return '#fb8c00';
    }
    case 'nominal': {             return '#43a047';
    }
  }
}

// ── Aggregate counts ─────────────────────────────────────────────────────

export function countCriticalCableIncidents(events: readonly UnderseaCableIncident[]): number {
  return events.filter((e) => e.severity === 'critical' || e.severity === 'high').length;
}

export function countOutageIxps(disruptions: readonly IxpDisruption[]): number {
  return disruptions.filter((d) => d.status === 'partial_outage' || d.status === 'major_outage').length;
}

export function countActiveBgpEvents(events: readonly BgpEvent[]): number {
  return events.filter((e) => e.durationMin === -1 || e.severity === 'critical' || e.severity === 'high').length;
}

export function countUnmitigatedDnsAttacks(attacks: readonly DnsAttack[]): number {
  return attacks.filter((a) => !a.mitigated).length;
}

export function countSevereCloudOutages(outages: readonly CloudOutage[]): number {
  return outages.filter((o) => o.status === 'partial_outage' || o.status === 'major_outage').length;
}

export function countCdnIssues(disruptions: readonly CdnDisruption[]): number {
  return disruptions.filter((d) => d.status !== 'operational').length;
}

export function countSatAnomalies(systems: readonly SatelliteSystem[]): number {
  return systems.filter((s) => s.status !== 'nominal').length;
}

/**
 * Total panel badge count: number of meaningfully impaired surfaces across
 * all seven sections. Static-data-only baseline.
 */
export function totalImpairmentCount(input: {
  cables: readonly UnderseaCableIncident[];
  ixps: readonly IxpDisruption[];
  bgp: readonly BgpEvent[];
  dns: readonly DnsAttack[];
  cloud: readonly CloudOutage[];
  cdn: readonly CdnDisruption[];
  sat: readonly SatelliteSystem[];
}): number {
  return (
    countCriticalCableIncidents(input.cables) +
    countOutageIxps(input.ixps) +
    countActiveBgpEvents(input.bgp) +
    countUnmitigatedDnsAttacks(input.dns) +
    countSevereCloudOutages(input.cloud) +
    countCdnIssues(input.cdn) +
    countSatAnomalies(input.sat)
  );
}

// ── Static data (representative real-world inventory) ────────────────────

export const UNDERSEA_CABLE_INCIDENTS: UnderseaCableIncident[] = [
  {
    cableName: 'SEACOM / TGN-EA / AAE-1',
    region: 'Red Sea',
    incidentType: 'multiple_cuts',
    severity: 'critical',
    affectedCountries: ['IN', 'EG', 'KE', 'TZ', 'SA'],
    capacityLossGbps: 1800,
    reportedAt: '2024-02-26',
    detail: 'Three cables severed near Yemen coast; suspected anchor drag or hostile activity',
  },
  {
    cableName: 'BCS East-West Interlink (C-Lion1)',
    region: 'Baltic Sea',
    incidentType: 'sabotage_suspected',
    severity: 'high',
    affectedCountries: ['FI', 'DE', 'EE', 'LT'],
    capacityLossGbps: 320,
    reportedAt: '2024-11-18',
    detail: 'Simultaneous cuts on BCS and C-Lion1 within hours; vessel of interest under investigation',
  },
  {
    cableName: 'Africa Coast to Europe (ACE)',
    region: 'Gulf of Guinea',
    incidentType: 'deep_cut',
    severity: 'high',
    affectedCountries: ['NG', 'GH', 'CI', 'GN'],
    capacityLossGbps: 580,
    reportedAt: '2024-03-14',
    detail: 'Single break ~1,200 km offshore; repair ship ETA ~3 weeks',
  },
  {
    cableName: 'Matsu-Taiwan #2 + #3',
    region: 'Taiwan Strait',
    incidentType: 'multiple_cuts',
    severity: 'high',
    affectedCountries: ['TW'],
    capacityLossGbps: 80,
    reportedAt: '2023-02-08',
    detail: 'Two cables to Matsu islands cut by suspected Chinese vessels; ~14k residents on backup links',
  },
  {
    cableName: 'Tonga Cable',
    region: 'South Pacific',
    incidentType: 'shallow_cut',
    severity: 'medium',
    affectedCountries: ['TO'],
    capacityLossGbps: 20,
    reportedAt: '2024-08-22',
    detail: 'Single fault ~37 km offshore; satellite fallback active for emergency services',
  },
  {
    cableName: 'JUNO / FASTER',
    region: 'Sea of Japan',
    incidentType: 'shunt_fault',
    severity: 'low',
    affectedCountries: ['JP', 'KR'],
    capacityLossGbps: 0,
    reportedAt: '2024-06-30',
    detail: 'Power-feed equipment shunt fault; no traffic impact, repair scheduled',
  },
];

export const IXP_DISRUPTIONS: IxpDisruption[] = [
  {
    ixpName: 'DE-CIX Frankfurt',
    city: 'Frankfurt',
    countryCode: 'DE',
    status: 'operational',
    peersAffectedPct: 0,
    cause: 'No active incidents',
  },
  {
    ixpName: 'AMS-IX Amsterdam',
    city: 'Amsterdam',
    countryCode: 'NL',
    status: 'degraded',
    peersAffectedPct: 4,
    cause: 'Route-server software upgrade in progress',
  },
  {
    ixpName: 'LINX London',
    city: 'London',
    countryCode: 'GB',
    status: 'operational',
    peersAffectedPct: 0,
    cause: 'No active incidents',
  },
  {
    ixpName: 'MSK-IX Moscow',
    city: 'Moscow',
    countryCode: 'RU',
    status: 'partial_outage',
    peersAffectedPct: 18,
    cause: 'Sanctions-related peer withdrawals over past 18 months',
  },
  {
    ixpName: 'HKIX Hong Kong',
    city: 'Hong Kong',
    countryCode: 'HK',
    status: 'operational',
    peersAffectedPct: 0,
    cause: 'No active incidents',
  },
  {
    ixpName: 'NAP Africa CPT',
    city: 'Cape Town',
    countryCode: 'ZA',
    status: 'degraded',
    peersAffectedPct: 7,
    cause: 'Upstream cable repair work; alternate paths reduced',
  },
];

/* eslint-disable sonarjs/no-hardcoded-ip -- documented public BGP hijack prefixes */
export const BGP_EVENTS: BgpEvent[] = [
  {
    kind: 'subprefix_hijack',
    originAsn: 39_523,
    originName: 'DV-LINK-AS',
    victimAsn: 16_509,
    victimName: 'Amazon.com',
    prefix: '52.95.0.0/24',
    severity: 'high',
    durationMin: 47,
  },
  {
    kind: 'route_leak',
    originAsn: 4837,
    originName: 'CHINA-UNICOM',
    victimAsn: 174,
    victimName: 'Cogent Communications',
    prefix: '149.6.0.0/16',
    severity: 'medium',
    durationMin: 12,
  },
  {
    kind: 'hijack',
    originAsn: 9009,
    originName: 'M247',
    victimAsn: 13_335,
    victimName: 'Cloudflare',
    prefix: '1.1.1.0/24',
    severity: 'critical',
    durationMin: -1,
  },
  {
    kind: 'origin_spoof',
    originAsn: 50_384,
    originName: 'PORTLANE',
    victimAsn: 32_934,
    victimName: 'Facebook',
    prefix: '157.240.0.0/17',
    severity: 'high',
    durationMin: 8,
  },
];
/* eslint-enable sonarjs/no-hardcoded-ip */

export const DNS_ATTACKS: DnsAttack[] = [
  {
    target: 'Dyn (Managed DNS)',
    attackType: 'ddos',
    severity: 'high',
    peakQps: 1_200_000,
    mitigated: true,
    detail: 'Mirai-style botnet flood against authoritative resolvers; sustained ~6 hours',
  },
  {
    target: 'TLD ccTLD .ua',
    attackType: 'ddos',
    severity: 'high',
    peakQps: 480_000,
    mitigated: true,
    detail: 'Sustained query flood against Ukrainian ccTLD nameservers',
  },
  {
    target: 'Cloudflare 1.1.1.1',
    attackType: 'water_torture',
    severity: 'medium',
    peakQps: 220_000,
    mitigated: true,
    detail: 'Random-subdomain query flood targeting public resolver',
  },
  {
    target: 'Quad9 9.9.9.9',
    attackType: 'nx_amplification',
    severity: 'medium',
    peakQps: 95_000,
    mitigated: false,
    detail: 'NXDOMAIN amplification against open resolver; ongoing scrubbing',
  },
  {
    target: 'gTLD .xyz authoritative',
    attackType: 'cache_poisoning',
    severity: 'high',
    peakQps: 0,
    mitigated: false,
    detail: 'Suspected Kaminsky-class attack targeting recursive resolver caches',
  },
];

export const CLOUD_OUTAGES: CloudOutage[] = [
  {
    provider: 'aws',
    service: 'EC2 + IAM',
    region: 'us-east-1',
    status: 'degraded',
    impact: 'API throttling and elevated instance-launch errors',
    startedAt: '2024-12-09T07:11Z',
  },
  {
    provider: 'azure',
    service: 'Entra ID',
    region: 'global',
    status: 'partial_outage',
    impact: 'Authentication failures across Office 365 / Teams',
    startedAt: '2024-07-30T17:00Z',
  },
  {
    provider: 'gcp',
    service: 'Cloud Storage',
    region: 'us-central1',
    status: 'operational',
    impact: 'No active incidents',
    startedAt: '2024-01-01T00:00Z',
  },
  {
    provider: 'aws',
    service: 'S3',
    region: 'eu-west-1',
    status: 'operational',
    impact: 'No active incidents',
    startedAt: '2024-01-01T00:00Z',
  },
  {
    provider: 'oracle',
    service: 'OCI Networking',
    region: 'ashburn',
    status: 'degraded',
    impact: 'Inter-region VCN transit elevated latency',
    startedAt: '2024-10-15T03:22Z',
  },
];

export const CDN_DISRUPTIONS: CdnDisruption[] = [
  {
    cdnName: 'Cloudflare',
    pop: 'CDG (Paris)',
    status: 'degraded',
    errorRatePct: 2.4,
    cause: 'Local transit re-route after upstream peering issue',
  },
  {
    cdnName: 'Fastly',
    pop: 'NRT (Tokyo)',
    status: 'operational',
    errorRatePct: 0.1,
    cause: 'No active incidents',
  },
  {
    cdnName: 'Akamai',
    pop: 'JFK (New York)',
    status: 'partial_outage',
    errorRatePct: 11.8,
    cause: 'Origin shield failures during config push',
  },
  {
    cdnName: 'Cloudfront',
    pop: 'SIN (Singapore)',
    status: 'operational',
    errorRatePct: 0.2,
    cause: 'No active incidents',
  },
  {
    cdnName: 'Bunny',
    pop: 'AMS (Amsterdam)',
    status: 'operational',
    errorRatePct: 0.3,
    cause: 'No active incidents',
  },
];

export const SATELLITE_SYSTEMS: SatelliteSystem[] = [
  {
    systemName: 'Starlink',
    orbitClass: 'LEO Constellation',
    status: 'reduced_capacity',
    activeUsersM: 4.6,
    note: 'Solar storm-induced atmospheric drag reducing some plane availability',
  },
  {
    systemName: 'OneWeb',
    orbitClass: 'LEO Constellation',
    status: 'nominal',
    activeUsersM: 0.3,
    note: 'Full coverage above 50°N latitude; enterprise rollout ongoing',
  },
  {
    systemName: 'Iridium',
    orbitClass: 'LEO Constellation',
    status: 'nominal',
    activeUsersM: 2,
    note: 'Voice and data services nominal',
  },
  {
    systemName: 'Viasat (KA-SAT)',
    orbitClass: 'GEO Spot Beam',
    status: 'regional_outage',
    activeUsersM: 0.4,
    note: 'Cyber attack residual effects in Eastern Europe; some modems still bricked',
  },
  {
    systemName: 'HughesNet',
    orbitClass: 'GEO Broadcast',
    status: 'nominal',
    activeUsersM: 1,
    note: 'Nominal capacity; Jupiter-3 added headroom',
  },
  {
    systemName: 'Inmarsat',
    orbitClass: 'GEO L-band',
    status: 'nominal',
    activeUsersM: 0.2,
    note: 'Aviation and maritime services nominal',
  },
];

// ── Formatters ───────────────────────────────────────────────────────────

export function formatGbps(gbps: number): string {
  if (gbps <= 0) return '—';
  if (gbps >= 1000) return `${(gbps / 1000).toFixed(1)} Tbps`;
  return `${gbps} Gbps`;
}

export function formatQps(qps: number): string {
  if (qps <= 0) return '—';
  if (qps >= 1_000_000) return `${(qps / 1_000_000).toFixed(1)}M qps`;
  if (qps >= 1000)     return `${Math.round(qps / 1000)}k qps`;
  return `${qps} qps`;
}

export function formatUsersM(m: number): string {
  if (m <= 0) return '—';
  if (m >= 1) return `${m.toFixed(1)}M`;
  return `${Math.round(m * 1000)}k`;
}

export function formatDuration(min: number): string {
  if (min < 0) return 'ongoing';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const rem = min % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}
