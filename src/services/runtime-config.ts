import { getApiBaseUrl, isDesktopRuntime } from './runtime';
import { invokeTauri } from './tauri-bridge';
import { keychainService } from './keychain';
import { safeSetItem } from '../utils/safe-storage';
import {
  isVaultUnlocked as isWebVaultUnlocked,
  listSecrets as listWebVaultSecrets,
  setSecret as setWebVaultSecret,
  onVaultChange as onWebVaultChange,
  isSupported as isWebVaultSupported,
} from './web-secret-store';

export type RuntimeSecretKey =
  | 'CRYSTALBALL_API_KEY'
  | 'ANTHROPIC_API_KEY'
  | 'GROQ_API_KEY'
  | 'OPENROUTER_API_KEY'
  | 'FRED_API_KEY'
  | 'EIA_API_KEY'
  | 'CLOUDFLARE_API_TOKEN'
  | 'ACLED_ACCESS_TOKEN'
  | 'ACLED_EMAIL'
  | 'ACLED_REFRESH_TOKEN'
  | 'URLHAUS_AUTH_KEY'
  | 'OTX_API_KEY'
  | 'ABUSEIPDB_API_KEY'
  | 'WINGBITS_API_KEY'
  | 'WS_RELAY_URL'
  | 'VITE_WS_RELAY_URL'
  | 'VITE_OPENSKY_RELAY_URL'
  | 'OPENSKY_CLIENT_ID'
  | 'OPENSKY_CLIENT_SECRET'
  | 'AISSTREAM_API_KEY'
  | 'FINNHUB_API_KEY'
  | 'NASA_FIRMS_API_KEY'
  | 'AIRNOW_API_KEY'
  | 'PURPLEAIR_API_KEY'
  | 'OLLAMA_API_URL'
  | 'OLLAMA_MODEL'
  | 'WTO_API_KEY'
  | 'AVIATIONSTACK_API'
  | 'ICAO_API_KEY'
  | 'THREATFOX_API_KEY'
  | 'NEWSAPI_KEY'
  | 'NEWSDATA_API_KEY'
  | 'VIRUSTOTAL_API_KEY'
  | 'SHODAN_API_KEY'
  | 'UCDP_API_TOKEN'
  | 'FMP_API_KEY'
  | 'OWM_API_KEY'
  | 'GREYNOISE_API_KEY'
  | 'NASA_API_KEY'
  | 'URLSCAN_API_KEY'
  | 'BITCOINABUSE_API_KEY'
  | 'VULNERS_API_KEY'
  | 'MEDIASTACK_API_KEY'
  | 'PULSEDIVE_API_KEY'
  | 'HIBP_API_KEY'
  | 'GEONAMES_USERNAME'
  | 'IPINFO_TOKEN'
  | 'CESIUM_ION_TOKEN'
  | 'GOOGLE_MAPS_API_KEY'
  | 'MAPBOX_API_KEY'
  | 'MAPTILER_API_KEY'
  | 'S2U_XMPP_JID'
  | 'S2U_XMPP_SECRET'
  | 'S2U_TAK_URL'
  | 'S2U_TAK_USERNAME'
  | 'S2U_TAK_SECRET'
  | 'S2U_TLS_INSECURE_OPT_IN'
  | 'CENSYS_API_ID'
  | 'CENSYS_API_SECRET'
  | 'SECURITYTRAILS_API_KEY'
  | 'WHOISXML_API_KEY'
  | 'MISP_URL'
  | 'MISP_API_KEY'
  | 'OPENCTI_URL'
  | 'OPENCTI_API_KEY'
  | 'PATREON_OAUTH_CLIENT_ID'
  | 'PATREON_OAUTH_CLIENT_SECRET'
  | 'PATREON_ACCESS_TOKEN'
  | 'PATREON_REFRESH_TOKEN'
  | 'PATREON_AUDIO_RSS_URL'
  | 'OPENAQ_API_KEY'
  | 'WINDY_WEBCAMS_API_KEY'
  | 'NPS_API_KEY';

export type RuntimeFeatureId =
  | 'cloudApiFallbackAuth'
  | 'aiClaude'
  | 'aiGroq'
  | 'aiOpenRouter'
  | 'economicFred'
  | 'energyEia'
  | 'internetOutages'
  | 'acledConflicts'
  | 'acledAirstrikes'
  | 'ucdpEvents'
  | 'abuseChThreatIntel'
  | 'alienvaultOtxThreatIntel'
  | 'abuseIpdbThreatIntel'
  | 'wingbitsEnrichment'
  | 'aisRelay'
  | 'openskyRelay'
  | 'finnhubMarkets'
  | 'nasaFirms'
  | 'epaAirNow'
  | 'purpleAirSensors'
  | 'aiOllama'
  | 'wtoTrade'
  | 'supplyChain'
  | 'aviationStack'
  | 'icaoNotams'
  | 'threatfoxThreatIntel'
  | 'openPhishThreatIntel'
  | 'spamhausDrop'
  | 'cisaKev'
  | 'newsApiHeadlines'
  | 'newsDataFeed'
  | 'virusTotalEnrichment'
  | 'bgpViewEnrichment'
  | 'shodanIcsExposure'
  | 'fmpMarketsFallback'
  | 'openWeatherMap'
  | 'greynoiseIntel'
  | 'openSanctions'
  | 'secEdgar'
  | 'phishstatsFeed'
  | 'urlscanThreatIntel'
  | 'bitcoinabuseIocs'
  | 'cveTracker'
  | 'vulnersCve'
  | 'mediastackNews'
  | 'pulsediveThreatIntel'
  | 'hibpBreach'
  | 'redditOsint'
  | 'geoDbCities'
  | 'openAqMonitor'
  | 'geoNames'
  | 'ripeNccData'
  | 'ripeAtlasMeasurements'
  | 'ipInfoLookup'
  | 'iswSituationReports'
  | 'reliefwebCrises'
  | 'bellingcatOsint'
  | 'emscSeismic'
  | 'fcdoTravelWarnings'
  | 'dfatTravelWarnings'
  | 'gacTravelWarnings'
  | 'govWarningConvergence'
  | 'dodNewsRss'
  | 'natoNewsRss'
  | 'acapsCrisisSeverity'
  | 'liveUaMapFeed'
  | 'godsVision3dGlobe'
  | 'owmWeatherTiles'
  | 'google3dTiles'
  | 'cyberReactor'
  | 'cyberReactorNotifyNative'
  | 'cyberReactorNotifyToast'
  | 'cyberReactorNotifyMap'
  | 'navigationMapbox'
  | 'navigationMaptiler'
  | 'navigationRouting'
  | 's2uXmppFeed'
  | 's2uTakFeeds'
  | 's2Patreon';

export interface RuntimeFeatureDefinition {
  id: RuntimeFeatureId;
  name: string;
  description: string;
  requiredSecrets: RuntimeSecretKey[];
  desktopRequiredSecrets?: RuntimeSecretKey[];
  fallback: string;
}

export interface RuntimeSecretState {
  value: string;
  source: 'env' | 'vault';
}

export interface RuntimeConfig {
  featureToggles: Record<RuntimeFeatureId, boolean>;
  secrets: Partial<Record<RuntimeSecretKey, RuntimeSecretState>>;
}

const TOGGLES_STORAGE_KEY = 'crystalball-runtime-feature-toggles';
function getSidecarEnvUpdateUrl(): string {
  return `${getApiBaseUrl()}/api/local-env-update`;
}
function getSidecarSecretValidateUrl(): string {
  return `${getApiBaseUrl()}/api/local-validate-secret`;
}

const defaultToggles: Record<RuntimeFeatureId, boolean> = {
  cloudApiFallbackAuth: true,
  aiClaude: true,
  aiGroq: true,
  aiOpenRouter: true,
  economicFred: true,
  energyEia: true,
  internetOutages: true,
  acledConflicts: true,
  acledAirstrikes: true,
  ucdpEvents: true,
  abuseChThreatIntel: true,
  alienvaultOtxThreatIntel: true,
  abuseIpdbThreatIntel: true,
  wingbitsEnrichment: true,
  aisRelay: true,
  openskyRelay: true,
  finnhubMarkets: true,
  nasaFirms: true,
  epaAirNow: true,
  purpleAirSensors: true,
  aiOllama: true,
  wtoTrade: true,
  supplyChain: true,
  aviationStack: true,
  icaoNotams: true,
  threatfoxThreatIntel: true,
  openPhishThreatIntel: true,
  spamhausDrop: true,
  cisaKev: true,
  newsApiHeadlines: true,
  newsDataFeed: true,
  virusTotalEnrichment: true,
  bgpViewEnrichment: true,
  shodanIcsExposure: true,
  fmpMarketsFallback: true,
  openWeatherMap: true,
  greynoiseIntel: true,
  openSanctions: true,
  secEdgar: true,
  phishstatsFeed: true,
  urlscanThreatIntel: true,
  bitcoinabuseIocs: true,
  cveTracker: true,
  vulnersCve: true,
  mediastackNews: true,
  pulsediveThreatIntel: true,
  hibpBreach: true,
  redditOsint: true,
  geoDbCities: true,
  openAqMonitor: true,
  geoNames: true,
  ripeNccData: true,
  ripeAtlasMeasurements: true,
  ipInfoLookup: true,
  iswSituationReports: true,
  reliefwebCrises: true,
  bellingcatOsint: true,
  emscSeismic: true,
  fcdoTravelWarnings: true,
  dfatTravelWarnings: true,
  gacTravelWarnings: true,
  govWarningConvergence: true,
  dodNewsRss: true,
  natoNewsRss: true,
  acapsCrisisSeverity: true,
  liveUaMapFeed: true,
  godsVision3dGlobe: true,
  owmWeatherTiles: true,
  google3dTiles: true,
  cyberReactor: true,
  cyberReactorNotifyNative: true,
  cyberReactorNotifyToast: true,
  cyberReactorNotifyMap: true,
  navigationMapbox: true,
  navigationMaptiler: true,
  navigationRouting: true,
  s2uXmppFeed: true,
  s2uTakFeeds: true,
  s2Patreon: true,
};

export const RUNTIME_FEATURES: RuntimeFeatureDefinition[] = [
  {
 id: 'cloudApiFallbackAuth',
 name: 'Cloud fallback API authentication',
 description: 'Desktop cloud fallback requests use X-CrystalBall-Key for Vercel API trust boundary validation.',
 requiredSecrets: [],
 desktopRequiredSecrets: ['CRYSTALBALL_API_KEY'],
 fallback: 'Cloud fallback to crystalball.app is blocked without a Crystal Ball API key.',
  },
  {
 id: 'aiOllama',
 name: 'Ollama local summarization',
 description: 'Local LLM provider via OpenAI-compatible endpoint (Ollama or LM Studio, desktop-first).',
 requiredSecrets: ['OLLAMA_API_URL', 'OLLAMA_MODEL'],
 fallback: 'Falls back to Groq, then OpenRouter, then local browser model.',
  },
  {
 id: 'aiGroq',
 name: 'Groq summarization',
 description: 'Primary fast LLM provider used for AI summary generation.',
 requiredSecrets: ['GROQ_API_KEY'],
 desktopRequiredSecrets: [],
 fallback: 'Falls back to OpenRouter, then local browser model.',
  },
  {
 id: 'aiOpenRouter',
 name: 'OpenRouter summarization',
 description: 'Secondary LLM provider for AI summary fallback.',
 requiredSecrets: ['OPENROUTER_API_KEY'],
 desktopRequiredSecrets: [],
 fallback: 'Falls back to local browser model only.',
  },
  {
 id: 'economicFred',
 name: 'FRED economic indicators',
 description: 'Macro indicators from Federal Reserve Economic Data.',
 requiredSecrets: ['FRED_API_KEY'],
 desktopRequiredSecrets: [],
 fallback: 'Economic panel remains available with non-FRED metrics.',
  },
  {
 id: 's2Patreon',
 name: 'S2 Underground Patreon supporter',
 description: 'Connects your Patreon account to unlock supporter-only S2 Underground audio briefings.',
 requiredSecrets: [],
 desktopRequiredSecrets: ['PATREON_OAUTH_CLIENT_ID', 'PATREON_OAUTH_CLIENT_SECRET'],
 fallback: 'S2 Underground panel shows public content only until a Patreon account is connected.',
  },
  {
 id: 'energyEia',
 name: 'EIA oil analytics',
 description: 'US Energy Information Administration oil metrics.',
 requiredSecrets: ['EIA_API_KEY'],
 desktopRequiredSecrets: [],
 fallback: 'Oil analytics cards show disabled state.',
  },
  {
 id: 'internetOutages',
 name: 'Cloudflare outage radar',
 description: 'Internet outages from Cloudflare Radar annotations API.',
 requiredSecrets: ['CLOUDFLARE_API_TOKEN'],
 desktopRequiredSecrets: [],
 fallback: 'Outage layer is disabled and map continues with other feeds.',
  },
  {
 id: 'acledConflicts',
 name: 'ACLED conflicts & protests',
 description: 'Conflict and protest event feeds from ACLED.',
 requiredSecrets: ['ACLED_ACCESS_TOKEN'],
 desktopRequiredSecrets: [],
 fallback: 'Conflict/protest overlays are hidden.',
  },
  {
 id: 'ucdpEvents',
 name: 'UCDP georeferenced events',
 description: 'Uppsala Conflict Data Program — peer-reviewed georeferenced conflict events feed.',
 requiredSecrets: ['UCDP_API_TOKEN'],
 desktopRequiredSecrets: [],
 fallback: 'UCDP overlay shows degraded state until a token is provided.',
  },
  {
 id: 'acledAirstrikes',
 name: 'ACLED air strikes & drone events',
 description: 'Air/drone strikes and missile attacks from ACLED (last 30 days, global).',
 requiredSecrets: ['ACLED_ACCESS_TOKEN', 'ACLED_EMAIL'],
 desktopRequiredSecrets: [],
 fallback: 'Air strikes & drone layer is hidden.',
  },
  {
 id: 'abuseChThreatIntel',
 name: 'abuse.ch cyber IOC feeds',
 description: 'URLhaus and ThreatFox IOC ingestion for the cyber threat layer.',
 requiredSecrets: ['URLHAUS_AUTH_KEY'],
 desktopRequiredSecrets: [],
 fallback: 'URLhaus/ThreatFox IOC ingestion is disabled.',
  },
  {
 id: 'alienvaultOtxThreatIntel',
 name: 'AlienVault OTX threat intel',
 description: 'Optional OTX IOC ingestion for cyber threat enrichment.',
 requiredSecrets: ['OTX_API_KEY'],
 desktopRequiredSecrets: [],
 fallback: 'OTX IOC enrichment is disabled.',
  },
  {
 id: 'abuseIpdbThreatIntel',
 name: 'AbuseIPDB threat intel',
 description: 'Optional AbuseIPDB IOC/reputation enrichment for the cyber threat layer.',
 requiredSecrets: ['ABUSEIPDB_API_KEY'],
 desktopRequiredSecrets: [],
 fallback: 'AbuseIPDB enrichment is disabled.',
  },
  {
 id: 'wingbitsEnrichment',
 name: 'Wingbits aircraft enrichment',
 description: 'Military flight operator/aircraft enrichment metadata.',
 requiredSecrets: ['WINGBITS_API_KEY'],
 desktopRequiredSecrets: [],
 fallback: 'Flight map still renders with heuristic-only classification.',
  },
  {
 id: 'aisRelay',
 name: 'AIS vessel tracking',
 description: 'Live vessel positions from aisstream.io. Get a free key at aisstream.io.',
 requiredSecrets: ['AISSTREAM_API_KEY'],
 desktopRequiredSecrets: ['AISSTREAM_API_KEY'],
 fallback: 'AIS layer is disabled.',
  },
  {
 id: 'openskyRelay',
 name: 'OpenSky military flights',
 description: 'OpenSky OAuth credentials for military flight data.',
 requiredSecrets: ['VITE_OPENSKY_RELAY_URL', 'OPENSKY_CLIENT_ID', 'OPENSKY_CLIENT_SECRET'],
 desktopRequiredSecrets: [],
 fallback: 'Military flights fall back to limited/no data.',
  },
  {
 id: 'finnhubMarkets',
 name: 'Finnhub market data',
 description: 'Real-time stock quotes and market data from Finnhub.',
 requiredSecrets: ['FINNHUB_API_KEY'],
 desktopRequiredSecrets: [],
 fallback: 'Stock ticker uses limited free data.',
  },
  {
 id: 'nasaFirms',
 name: 'NASA FIRMS fire data',
 description: 'Fire Information for Resource Management System satellite data.',
 requiredSecrets: ['NASA_FIRMS_API_KEY'],
 fallback: 'FIRMS fire layer uses public VIIRS feed.',
  },
  {
 id: 'epaAirNow',
 name: 'EPA AirNow AQI for saved places',
 description: 'Real-time US AQI per saved place (PM2.5 / O3) — enables wildfire smoke health alerts.',
 requiredSecrets: ['AIRNOW_API_KEY'],
 desktopRequiredSecrets: [],
 fallback: 'Wildfire panel shows AQI as "key required" until configured.',
  },
  {
 id: 'purpleAirSensors',
 name: 'PurpleAir hyper-local sensors',
 description: 'Community PurpleAir sensor network — top-500 outdoor PM2.5 readings with EPA AQI conversion. Optional key unlocks the v1 API; without a key the deprecated public /json endpoint is tried.',
 requiredSecrets: [],
 desktopRequiredSecrets: [],
 fallback: 'Falls back to the public /json endpoint when no PURPLEAIR_API_KEY is configured.',
  },
  {
 id: 'wtoTrade',
 name: 'WTO trade policy data',
 description: 'Trade restrictions, tariff trends, barriers, and flows from WTO.',
 requiredSecrets: ['WTO_API_KEY'],
 desktopRequiredSecrets: [],
 fallback: 'Trade policy panel shows disabled state.',
  },
  {
 id: 'supplyChain',
 name: 'Supply Chain Intelligence',
 description: 'Shipping rates via FRED Baltic Dry Index. Chokepoints and minerals use public data.',
 requiredSecrets: ['FRED_API_KEY'],
 desktopRequiredSecrets: [],
 fallback: 'Chokepoints and minerals always available; shipping requires FRED key.',
  },
  {
 id: 'aviationStack',
 name: 'AviationStack flight delays',
 description: 'Real-time international airport delay data from AviationStack API.',
 requiredSecrets: ['AVIATIONSTACK_API'],
 desktopRequiredSecrets: [],
 fallback: 'Non-US airports use simulated delay data.',
  },
  {
 id: 'icaoNotams',
 name: 'ICAO NOTAM closures (Middle East)',
 description: 'Airport closure detection for MENA airports from ICAO NOTAM data service.',
 requiredSecrets: ['ICAO_API_KEY'],
 desktopRequiredSecrets: [],
 fallback: 'Closures detected only via AviationStack flight cancellation data.',
  },
  {
 id: 'threatfoxThreatIntel',
 name: 'ThreatFox malware IOC feed',
 description: 'Abuse.ch ThreatFox C2/malware indicator feed — requires a free auth key from auth.abuse.ch.',
 requiredSecrets: ['THREATFOX_API_KEY'],
 desktopRequiredSecrets: [],
 fallback: 'ThreatFox IOC ingestion is disabled.',
  },
  {
 id: 'openPhishThreatIntel',
 name: 'OpenPhish phishing feed',
 description: 'OpenPhish community phishing URL feed — no key required, always on.',
 requiredSecrets: [],
 desktopRequiredSecrets: [],
 fallback: 'OpenPhish feed is disabled.',
  },
  {
 id: 'spamhausDrop',
 name: 'Spamhaus DROP/EDROP blocklist',
 description: 'Spamhaus Don\'t Route Or Peer (DROP) CIDR blocklist — no key required.',
 requiredSecrets: [],
 desktopRequiredSecrets: [],
 fallback: 'Spamhaus CIDR blocklist is disabled.',
  },
  {
 id: 'cisaKev',
 name: 'CISA Known Exploited Vulnerabilities',
 description: 'CISA KEV catalog of actively exploited CVEs — no key required.',
 requiredSecrets: [],
 desktopRequiredSecrets: [],
 fallback: 'CISA KEV catalog is disabled.',
  },
  {
 id: 'newsApiHeadlines',
 name: 'NewsAPI headlines',
 description: 'Global headline search from 150k+ news sources via NewsAPI.org — free developer plan.',
 requiredSecrets: ['NEWSAPI_KEY'],
 desktopRequiredSecrets: [],
 fallback: 'NewsAPI headline augmentation is disabled.',
  },
  {
 id: 'newsDataFeed',
 name: 'NewsData.io feed',
 description: 'Real-time and historical news from 95k+ sources via NewsData.io — free tier.',
 requiredSecrets: ['NEWSDATA_API_KEY'],
 desktopRequiredSecrets: [],
 fallback: 'NewsData feed augmentation is disabled.',
  },
  {
 id: 'virusTotalEnrichment',
 name: 'VirusTotal IOC enrichment',
 description: 'On-demand reputation lookups for IPs, domains, and URLs via VirusTotal public API.',
 requiredSecrets: ['VIRUSTOTAL_API_KEY'],
 desktopRequiredSecrets: [],
 fallback: 'VirusTotal enrichment is disabled.',
  },
  {
 id: 'bgpViewEnrichment',
 name: 'ASN enrichment',
 description: 'ASN metadata, prefix counts, and country from PeeringDB (primary) with RIPE stat fallback. No key needed.',
 requiredSecrets: [],
 desktopRequiredSecrets: [],
 fallback: 'ASN enrichment is disabled.',
  },
  {
 id: 'shodanIcsExposure',
 name: 'Shodan ICS internet exposure',
 description: 'Shodan search for internet-exposed ICS/SCADA systems (Modbus, S7, DNP3, EtherNet/IP, BACnet).',
 requiredSecrets: ['SHODAN_API_KEY'],
 desktopRequiredSecrets: [],
 fallback: 'Shodan ICS exposure feed is disabled.',
  },
  {
 id: 'fmpMarketsFallback',
 name: 'Financial Modeling Prep fallback',
 description: 'FMP provides quotes for indices, commodities, and equities when Yahoo Finance is rate-limited (429). Free tier: 250 req/day.',
 requiredSecrets: ['FMP_API_KEY'],
 desktopRequiredSecrets: [],
 fallback: 'Markets panel falls back to Yahoo Finance only — may show stale data when rate-limited.',
  },
  {
 id: 'openWeatherMap',
 name: 'Global weather conditions',
 description: 'Current weather conditions for 28 major world cities via Open-Meteo (no API key required).',
 requiredSecrets: [],
 desktopRequiredSecrets: [],
 fallback: 'Global weather panel shows no data.',
  },
  {
 id: 'greynoiseIntel',
 name: 'GreyNoise IP noise classification',
 description: 'Classify IPs as internet background noise vs. targeted threats via GreyNoise Community API (free: 50 lookups/day).',
 requiredSecrets: ['GREYNOISE_API_KEY'],
 desktopRequiredSecrets: [],
 fallback: 'GreyNoise IP enrichment is disabled.',
  },
  {
 id: 'openSanctions',
 name: 'OpenSanctions global database',
 description: 'Global consolidated sanctions from 100+ lists (EU, UN, UK, OFAC, and more) — no key required.',
 requiredSecrets: [],
 desktopRequiredSecrets: [],
 fallback: 'OpenSanctions feed is disabled.',
  },
  {
 id: 'secEdgar',
 name: 'SEC EDGAR filings',
 description: 'Recent material event disclosures (8-K filings) from SEC EDGAR — completely free, no key required.',
 requiredSecrets: [],
 desktopRequiredSecrets: [],
 fallback: 'SEC EDGAR filing feed is disabled.',
  },
  {
 id: 'phishstatsFeed',
 name: 'PhishStats phishing database',
 description: 'Crowdsourced phishing URL database from PhishStats — no key required.',
 requiredSecrets: [],
 desktopRequiredSecrets: [],
 fallback: 'PhishStats feed is disabled.',
  },
  {
 id: 'urlscanThreatIntel',
 name: 'URLScan.io threat feed',
 description: 'Malicious URL scanner results and threat intelligence from URLScan.io — free key required.',
 requiredSecrets: ['URLSCAN_API_KEY'],
 desktopRequiredSecrets: [],
 fallback: 'URLScan threat feed is disabled.',
  },
  {
 id: 'bitcoinabuseIocs',
 name: 'Bitcoin Abuse ransomware tracker',
 description: 'Bitcoin addresses linked to ransomware, blackmail, and fraud from the Bitcoin Abuse database.',
 requiredSecrets: ['BITCOINABUSE_API_KEY'],
 desktopRequiredSecrets: [],
 fallback: 'Bitcoin Abuse IOC feed is disabled.',
  },
  {
 id: 'cveTracker',
 name: 'NVD CVE vulnerability tracker',
 description: 'Recent CVEs from NIST National Vulnerability Database — no key required.',
 requiredSecrets: [],
 desktopRequiredSecrets: [],
 fallback: 'CVE tracker is disabled.',
  },
  {
 id: 'vulnersCve',
 name: 'Vulners CVE intelligence',
 description: 'Vulnerability intelligence and exploit availability from Vulners — free API key required.',
 requiredSecrets: ['VULNERS_API_KEY'],
 desktopRequiredSecrets: [],
 fallback: 'Vulners CVE enrichment is disabled.',
  },
  {
 id: 'mediastackNews',
 name: 'MediaStack news feed',
 description: 'Real-time global news from 7,500+ sources via MediaStack API — free tier: 500 req/month.',
 requiredSecrets: ['MEDIASTACK_API_KEY'],
 desktopRequiredSecrets: [],
 fallback: 'MediaStack news augmentation is disabled.',
  },
  {
 id: 'pulsediveThreatIntel',
 name: 'Pulsedive threat intelligence',
 description: 'IP/domain/URL threat enrichment and risk scoring from Pulsedive — free tier.',
 requiredSecrets: ['PULSEDIVE_API_KEY'],
 desktopRequiredSecrets: [],
 fallback: 'Pulsedive threat enrichment is disabled.',
  },
  {
 id: 'hibpBreach',
 name: 'Have I Been Pwned breach data',
 description: 'Domain-level breach exposure data from Have I Been Pwned — free key required.',
 requiredSecrets: ['HIBP_API_KEY'],
 desktopRequiredSecrets: [],
 fallback: 'HIBP breach data is disabled.',
  },
  {
 id: 'redditOsint',
 name: 'Reddit geopolitical signals',
 description: 'Real-time posts from r/worldnews and r/geopolitics via public RSS — no key required.',
 requiredSecrets: [],
 desktopRequiredSecrets: [],
 fallback: 'Reddit OSINT feed is disabled.',
  },
  {
 id: 'geoDbCities',
 name: 'GeoDB Cities',
 description: 'Population-weighted city data and administrative regions from GeoDB Cities — no key required.',
 requiredSecrets: [],
 desktopRequiredSecrets: [],
 fallback: 'GeoDB city data is disabled.',
  },
  {
 id: 'openAqMonitor',
 name: 'OpenAQ air quality monitor',
 description: 'Real-time air quality readings (PM2.5, PM10, NO2, O3) from 10,000+ stations worldwide via OpenAQ. OpenAQ now requires a free API key.',
 requiredSecrets: ['OPENAQ_API_KEY'],
 fallback: 'OpenAQ readings show "key required" until an OPENAQ_API_KEY is configured.',
  },
  {
 id: 'geoNames',
 name: 'GeoNames place database',
 description: 'Global geographic name lookup and place disambiguation via GeoNames — free username required.',
 requiredSecrets: ['GEONAMES_USERNAME'],
 desktopRequiredSecrets: [],
 fallback: 'GeoNames place lookup is disabled.',
  },
  {
 id: 'ripeNccData',
 name: 'RIPE NCC BGP data',
 description: 'BGP routing data, ASN registrations, and prefix announcements from RIPE NCC — no key required.',
 requiredSecrets: [],
 desktopRequiredSecrets: [],
 fallback: 'RIPE NCC BGP data is disabled.',
  },
  {
 id: 'ripeAtlasMeasurements',
 name: 'RIPE Atlas Measurements',
 description: 'Real internet connectivity measurements from global probe network',
 requiredSecrets: [],
 fallback: 'Internet infrastructure monitoring disabled',
  },
  {
 id: 'ipInfoLookup',
 name: 'IPInfo IP intelligence',
 description: 'IP geolocation, ASN, and abuse contact data from IPInfo — free tier: 50,000 req/month.',
 requiredSecrets: ['IPINFO_TOKEN'],
 desktopRequiredSecrets: [],
 fallback: 'IPInfo IP lookup is disabled.',
  },
  {
 id: 'iswSituationReports',
 name: 'ISW daily situation reports',
 description: 'Institute for the Study of War daily conflict analysis — Ukraine/Russia, Gaza, Sudan, and global hotspots. Authoritative open-source intelligence used by NATO and DoD staff.',
 requiredSecrets: [],
 desktopRequiredSecrets: [],
 fallback: 'ISW situation reports are disabled.',
  },
  {
 id: 'reliefwebCrises',
 name: 'UN OCHA ReliefWeb crisis reports',
 description: 'UN Office for the Coordination of Humanitarian Affairs authoritative situation reports for all active conflict and disaster zones — no key required.',
 requiredSecrets: [],
 desktopRequiredSecrets: [],
 fallback: 'ReliefWeb crisis reports are disabled.',
  },
  {
 id: 'bellingcatOsint',
 name: 'Bellingcat OSINT investigations',
 description: 'Open-source intelligence investigations into covert military movements, equipment losses, geolocation, and conflict verification — no key required.',
 requiredSecrets: [],
 desktopRequiredSecrets: [],
 fallback: 'Bellingcat OSINT feed is disabled.',
  },
  {
 id: 'emscSeismic',
 name: 'EMSC seismic (nuclear test watch)',
 description: 'European Mediterranean Seismological Centre — independent sensor network for M≥3.5 events. Proximity-flagged against known nuclear test sites (Punggye-ri, Novaya Zemlya, Lop Nor, Nevada) for suspected nuclear test detection.',
 requiredSecrets: [],
 desktopRequiredSecrets: [],
 fallback: 'EMSC seismic feed and nuclear test watch are disabled.',
  },
  {
 id: 'fcdoTravelWarnings',
 name: 'UK FCDO travel warnings',
 description: 'UK Foreign Commonwealth & Development Office country-level travel advisories (Level 1–4) — updated in response to security deterioration.',
 requiredSecrets: [],
 desktopRequiredSecrets: [],
 fallback: 'UK FCDO travel warnings are disabled.',
  },
  {
 id: 'dfatTravelWarnings',
 name: 'Australia DFAT travel warnings',
 description: 'Australian Department of Foreign Affairs & Trade Smartraveller country advisories — independent government threat assessment.',
 requiredSecrets: [],
 desktopRequiredSecrets: [],
 fallback: 'Australia DFAT travel warnings are disabled.',
  },
  {
 id: 'gacTravelWarnings',
 name: 'Canada GAC travel warnings',
 description: 'Global Affairs Canada country travel advisories — independent government threat assessment from a Five Eyes intelligence partner.',
 requiredSecrets: [],
 desktopRequiredSecrets: [],
 fallback: 'Canada GAC travel warnings are disabled.',
  },
  {
 id: 'govWarningConvergence',
 name: 'Multi-government warning convergence',
 description: 'Composite signal: when 2+ governments (UK, Australia, Canada) simultaneously upgrade warnings for the same country within 7 days, emits a high-confidence escalation alert.',
 requiredSecrets: [],
 desktopRequiredSecrets: [],
 fallback: 'Multi-government convergence alerts are disabled.',
  },
  {
 id: 'dodNewsRss',
 name: 'US Department of Defense news',
 description: 'Official Pentagon press releases — deployment announcements, exercise starts, force posture shifts, and security cooperation events.',
 requiredSecrets: [],
 desktopRequiredSecrets: [],
 fallback: 'US DoD news feed is disabled.',
  },
  {
 id: 'natoNewsRss',
 name: 'NATO official newsroom',
 description: 'Official NATO press releases — Article 4/5 consultations, force posture changes, new member activations, and summit outcomes.',
 requiredSecrets: [],
 desktopRequiredSecrets: [],
 fallback: 'NATO news feed is disabled.',
  },
  {
 id: 'acapsCrisisSeverity',
 name: 'ACAPS humanitarian crisis index',
 description: 'ACAPS INFORM Crisis Severity Index — quantified severity scores for all active humanitarian crises by country, updated weekly by professional analysts.',
 requiredSecrets: [],
 desktopRequiredSecrets: [],
 fallback: 'ACAPS crisis severity index is disabled.',
  },
  {
 id: 'liveUaMapFeed',
 name: 'LiveUAMap Ukraine frontline',
 description: 'Near-real-time Ukraine frontline events from LiveUAMap OSINT aggregation — geolocated conflict events updated within minutes.',
 requiredSecrets: [],
 desktopRequiredSecrets: [],
 fallback: 'LiveUAMap Ukraine frontline feed is disabled.',
  },
  {
 id: 'godsVision3dGlobe',
 name: "God's Eye 3D Globe",
 description: 'Cesium-powered 3D globe with dark tactical imagery, terrain, and Three.js overlay effects. Requires a free Cesium Ion token.',
 requiredSecrets: ['CESIUM_ION_TOKEN'],
 fallback: 'Falls back to OpenStreetMap tiles without a Cesium Ion token.',
  },
  {
 id: 'owmWeatherTiles',
 name: 'Weather map tile overlays',
 description: 'Weather map tile overlays from OpenWeatherMap for temperature, precipitation, clouds, wind, and pressure.',
 requiredSecrets: ['OWM_API_KEY'],
 desktopRequiredSecrets: [],
 fallback: 'Weather tile overlays disabled. Free weather radar (RainViewer), satellite imagery (NOAA), and lightning data still available.',
  },
  {
 id: 'google3dTiles',
 name: 'Google Photorealistic 3D Tiles',
 description: 'Photorealistic 3D building tiles from Google Maps Platform. Free tier covers ~28,500 session loads/month.',
 requiredSecrets: ['GOOGLE_MAPS_API_KEY'],
 fallback: 'Falls back to Cesium OSM Buildings (with Ion token), then Esri I3S, then flat rendering.',
  },
  {
 id: 'cyberReactor',
 name: 'Cyber Threat Reactor',
 description: 'Evaluates incoming cyber threats against your device fingerprint and emits relevance-scored alerts.',
 requiredSecrets: [],
 fallback: 'Cyber threat panel continues without personalized alerting.',
  },
  {
 id: 'cyberReactorNotifyNative',
 name: 'Cyber Reactor native notifications',
 description: 'Route Cyber Reactor alerts to native OS notifications.',
 requiredSecrets: [],
 fallback: 'Native notifications disabled for Cyber Reactor alerts.',
  },
  {
 id: 'cyberReactorNotifyToast',
 name: 'Cyber Reactor toast notifications',
 description: 'Route Cyber Reactor alerts to in-app toasts.',
 requiredSecrets: [],
 fallback: 'Toast notifications disabled for Cyber Reactor alerts.',
  },
  {
 id: 'cyberReactorNotifyMap',
 name: 'Cyber Reactor map pings',
 description: 'Route Cyber Reactor alerts to map pings.',
 requiredSecrets: [],
 fallback: 'Map pings disabled for Cyber Reactor alerts.',
  },
  {
 id: 'navigationMapbox',
 name: 'Mapbox Navigation',
 description: 'Street tiles and routing via Mapbox',
 requiredSecrets: ['MAPBOX_API_KEY'],
 fallback: 'Falls back to MapTiler, then OpenStreetMap raster tiles',
  },
  {
 id: 'navigationMaptiler',
 name: 'MapTiler Streets',
 description: 'Street map tiles via MapTiler',
 requiredSecrets: ['MAPTILER_API_KEY'],
 fallback: 'Falls back to OpenStreetMap raster tiles',
  },
  {
 id: 'navigationRouting',
 name: 'Turn-by-Turn Navigation',
 description: 'Route calculation and turn-by-turn directions',
 requiredSecrets: [],
 fallback: 'Uses OSRM (free) when no premium routing keys are configured',
  },
  {
 id: 's2uXmppFeed',
 name: 'S2U XMPP Wire Feed',
 description: 'Joins the S2 Underground IRT XMPP MUC rooms (wire / event tracking / emergency) using a JID + password the user supplies.',
 requiredSecrets: ['S2U_XMPP_JID', 'S2U_XMPP_SECRET'],
 fallback: 'S2U Intelligence panel hides the wire feed sections.',
  },
  {
 id: 's2uTakFeeds',
 name: 'S2U TAK Server Feeds',
 description: 'Reads the S2U public TAK server (Marti API) for data feeds, packages, and CoT points.',
 requiredSecrets: ['S2U_TAK_URL', 'S2U_TAK_USERNAME', 'S2U_TAK_SECRET'],
 fallback: 'S2U Intelligence panel hides the TAK server section.',
  },
];

function readEnvSecret(key: RuntimeSecretKey): string {
  const envValue = (import.meta as { env?: Record<string, unknown> }).env?.[key];
  return typeof envValue === 'string' ? envValue.trim() : '';
}

/**
 * Pick-list copy: only keys present in {@link defaultToggles} are accepted.
 * Prevents prototype pollution via `__proto__` / `constructor` keys in
 * attacker-controlled localStorage values.
 */
function pickKnownToggles(
  raw: unknown,
): Partial<Record<RuntimeFeatureId, boolean>> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Partial<Record<RuntimeFeatureId, boolean>> = {};
  for (const key of Object.keys(defaultToggles) as RuntimeFeatureId[]) {
 const value = (raw as Record<string, unknown>)[key];
 if (typeof value === 'boolean') out[key] = value;
  }
  return out;
}

function readStoredToggles(): Record<RuntimeFeatureId, boolean> {
  try {
 const stored = localStorage.getItem(TOGGLES_STORAGE_KEY);
 if (!stored) return { ...defaultToggles };
 const parsed = pickKnownToggles(JSON.parse(stored));
 return { ...defaultToggles, ...parsed };
  } catch {
 return { ...defaultToggles };
  }
}

const URL_SECRET_KEYS = new Set<RuntimeSecretKey>([
  'WS_RELAY_URL',
  'VITE_OPENSKY_RELAY_URL',
  'OLLAMA_API_URL',
]);

export interface SecretVerificationResult {
  valid: boolean;
  message: string;
}

// IPv4 ranges that are almost always mistakes when supplied as OLLAMA_API_URL:
// - 169.254.0.0/16 is the cloud-metadata service link-local range (AWS, GCP,
//   Azure, Alibaba). A value that points here is likely a copy-paste accident
//   and never a legitimate Ollama host.
// - 0.0.0.0/8 is "this network" — also not a real endpoint a user should use.
// We deliberately allow 127.0.0.1 and RFC 1918 private ranges because Ollama
// typically runs on the user's own machine or LAN.
const OLLAMA_BLOCKED_HOSTS = /^(169\.254\.|0\.)/;

// eslint-disable-next-line sonarjs/cognitive-complexity -- per-key switch that's easier to read as one function
export function validateSecret(key: RuntimeSecretKey, value: string): { valid: boolean; hint?: string } {
  const trimmed = value.trim();
  if (!trimmed) return { valid: false, hint: 'Value is required' };

  if (key === 'CRYSTALBALL_API_KEY') {
 if (!/^[A-Za-z0-9_-]{16,}$/.test(trimmed)) {
 return { valid: false, hint: 'Must be at least 16 URL-safe characters' };
 }
 return { valid: true };
  }

  if (URL_SECRET_KEYS.has(key)) {
 try {
 const parsed = new URL(trimmed);
 if (key === 'OLLAMA_API_URL') {
 if (!['http:', 'https:'].includes(parsed.protocol)) {
 return { valid: false, hint: 'Must be an http(s) URL' };
 }
 if (OLLAMA_BLOCKED_HOSTS.test(parsed.hostname)) {
 return { valid: false, hint: 'Cloud-metadata and 0.0.0.0 addresses are not valid Ollama hosts' };
 }
 return { valid: true };
 }
 if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) {
 return { valid: false, hint: 'Must be an http(s) or ws(s) URL' };
 }
 return { valid: true };
 } catch {
 return { valid: false, hint: 'Must be a valid URL' };
 }
  }

  return { valid: true };
}

let secretsReadyResolve!: () => void;
export const secretsReady = new Promise<void>(r => { secretsReadyResolve = r; });

if (!isDesktopRuntime()) secretsReadyResolve();

const listeners = new Set<() => void>();

const runtimeConfig: RuntimeConfig = {
  featureToggles: readStoredToggles(),
  secrets: {},
};

let localApiTokenPromise: Promise<string | null> | null = null;

function notifyConfigChanged(): void {
  for (const listener of listeners) listener();
}

function seedSecretsFromEnvironment(): void {
  if (isDesktopRuntime()) return;

  const keys = new Set<RuntimeSecretKey>(RUNTIME_FEATURES.flatMap(feature => feature.requiredSecrets));
  for (const key of keys) {
 const value = readEnvSecret(key);
 if (value) {
 runtimeConfig.secrets[key] = { value, source: 'env' };
 }
  }
}

seedSecretsFromEnvironment();

/**
 * Reconcile the in-memory config with the web vault's current state.
 * Called after unlock/lock/set/destroy so consumers see the latest.
 * Desktop mode is a no-op here — it uses loadDesktopSecrets instead.
 */
export function syncWebVaultIntoConfig(): void {
  if (isDesktopRuntime()) return;

  // Clear any previously hydrated vault entries so locking actually hides them.
  for (const key of Object.keys(runtimeConfig.secrets) as RuntimeSecretKey[]) {
 if (runtimeConfig.secrets[key]?.source === 'vault') delete runtimeConfig.secrets[key];
  }

  if (isWebVaultUnlocked()) {
 const entries = listWebVaultSecrets();
 for (const [key, value] of entries) {
 if (value) runtimeConfig.secrets[key as RuntimeSecretKey] = { value, source: 'vault' };
 }
  } else {
 // Re-seed env fallbacks for any slot the vault used to cover.
 seedSecretsFromEnvironment();
  }

  notifyConfigChanged();
}

if (!isDesktopRuntime()) {
  onWebVaultChange(() => { syncWebVaultIntoConfig(); });
}

// Listen for cross-window state updates (settings ↔ main).
// When one window saves secrets or toggles features, the `storage` event fires in other same-origin windows.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
 if (e.key === 'wm-secrets-updated') {
 // Another window updated the keychain — local cache is stale.
 keychainService.invalidateAll();
 void loadDesktopSecrets();
 } else if (e.key === TOGGLES_STORAGE_KEY && e.newValue) {
 try {
 const parsed = pickKnownToggles(JSON.parse(e.newValue));
 Object.assign(runtimeConfig.featureToggles, parsed);
 notifyConfigChanged();
 } catch { /* ignore malformed JSON */ }
 }
  });
}

export function subscribeRuntimeConfig(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRuntimeConfigSnapshot(): RuntimeConfig {
  return {
 featureToggles: { ...runtimeConfig.featureToggles },
 secrets: { ...runtimeConfig.secrets },
  };
}

export function isFeatureEnabled(featureId: RuntimeFeatureId): boolean {
  return runtimeConfig.featureToggles[featureId] !== false;
}

export function getSecretState(key: RuntimeSecretKey): { present: boolean; valid: boolean; source: 'env' | 'vault' | 'missing' } {
  const state = runtimeConfig.secrets[key];
  if (!state) return { present: false, valid: false, source: 'missing' };
  return { present: true, valid: validateSecret(key, state.value).valid, source: state.source };
}

export function isFeatureAvailable(featureId: RuntimeFeatureId): boolean {
  if (!isFeatureEnabled(featureId)) return false;

  const feature = RUNTIME_FEATURES.find(item => item.id === featureId);
  if (!feature) return false;

  if (!isDesktopRuntime()) {
 // Once the user has unlocked their browser vault we know whether each
 // required key is actually present locally, so gate on that. Before
 // unlock we optimistically trust server-managed credentials (the cloud
 // deployment may have keys set at the edge) rather than greying out
 // every feature the user hasn't configured yet.
 if (!isWebVaultUnlocked()) return true;
 return feature.requiredSecrets.every(secretKey => getSecretState(secretKey).valid);
  }

  const secrets = feature.desktopRequiredSecrets ?? feature.requiredSecrets;
  return secrets.every(secretKey => getSecretState(secretKey).valid);
}

export function getEffectiveSecrets(feature: RuntimeFeatureDefinition): RuntimeSecretKey[] {
  return (isDesktopRuntime() && feature.desktopRequiredSecrets) ? feature.desktopRequiredSecrets : feature.requiredSecrets;
}

export function setFeatureToggle(featureId: RuntimeFeatureId, enabled: boolean): void {
  runtimeConfig.featureToggles[featureId] = enabled;
  safeSetItem(TOGGLES_STORAGE_KEY, JSON.stringify(runtimeConfig.featureToggles));
  notifyConfigChanged();
}

async function writeWebSecret(key: RuntimeSecretKey, value: string): Promise<void> {
  if (!isWebVaultSupported()) {
 // eslint-disable-next-line no-console
 console.warn('[runtime-config] Web vault unsupported (no SubtleCrypto/IDB); ignoring secret write');
 return;
  }
  if (!isWebVaultUnlocked()) {
 throw new Error('Vault is locked. Unlock the key vault before saving secrets.');
  }
  const sanitized = value.trim();
  await setWebVaultSecret(key, sanitized);
  if (sanitized) {
 runtimeConfig.secrets[key] = { value: sanitized, source: 'vault' };
  } else {
 delete runtimeConfig.secrets[key];
 // Fall back to env seeding if a VITE_* value exists for this key.
 const envFallback = readEnvSecret(key);
 if (envFallback) runtimeConfig.secrets[key] = { value: envFallback, source: 'env' };
  }
  notifyConfigChanged();
}

export async function setSecretValue(key: RuntimeSecretKey, value: string): Promise<void> {
  if (!isDesktopRuntime()) {
 await writeWebSecret(key, value);
 return;
  }

  const sanitized = value.trim();
  if (sanitized) {
 await keychainService.set(key, sanitized);
 runtimeConfig.secrets[key] = { value: sanitized, source: 'vault' };
  } else {
 await keychainService.remove(key);
 delete runtimeConfig.secrets[key];
  }

  // Push to sidecar so handlers pick it up immediately.
  // This is best-effort: keyring persistence is the source of truth.
  // Empty values must also be pushed or the deleted key remains live in the
  // already-running sidecar environment until restart.
  try {
    await pushSecretToSidecar(key, sanitized);
  } catch {
    // Sidecar may not be ready yet — keychain is the source of truth.
  }

  // Signal other windows (main ↔ settings) to reload secrets from keychain.
  // The `storage` event fires in all same-origin windows except the one that wrote.
  try {
 localStorage.setItem('wm-secrets-updated', String(Date.now()));
  } catch { /* localStorage may be unavailable */ }

  notifyConfigChanged();
}

async function getLocalApiToken(): Promise<string | null> {
  localApiTokenPromise ??= invokeTauri<string>('get_local_api_token')
 .then((token) => token.trim() || null)
 .catch((error) => {
 // Allow retries on subsequent calls if bridge/token is temporarily unavailable.
 localApiTokenPromise = null;
 throw error;
 });
  return localApiTokenPromise;
}

async function pushSecretToSidecar(key: string, value: string): Promise<void> {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const token = await getLocalApiToken();
  if (token) {
 headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(getSidecarEnvUpdateUrl(), {
 method: 'POST',
 headers,
 body: JSON.stringify({ key, value: value || null }),
  });

  if (!response.ok) {
 let detail = '';
 try {
 detail = await response.text();
 } catch { /* ignore non-readable body */ }
 const suffix = detail ? `: ${detail.slice(0, 200)}` : '';
 throw new Error(`Sidecar secret sync failed (${response.status})${suffix}`);
  }
}

async function callSidecarWithAuth(url: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  const token = await getLocalApiToken();
  if (token) {
 headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(url, { ...init, headers });
}

interface WebProbeSpec {
  url: (value: string) => string;
  headers?: (value: string) => Record<string, string>;
}

/**
 * Browser-direct probes for providers that accept CORS preflight from
 * a web origin. A 200/2xx means the key is valid; 401/403 means bad key;
 * anything else (CORS block, network error, 5xx) falls back to a
 * non-committal "Saved" rather than marking the key invalid.
 */
const WEB_PROBES: Partial<Record<RuntimeSecretKey, WebProbeSpec>> = {
  ANTHROPIC_API_KEY: {
 url: () => 'https://api.anthropic.com/v1/models',
 headers: (v) => ({ 'x-api-key': v, 'anthropic-version': '2023-06-01' }),
  },
  GROQ_API_KEY: {
 url: () => 'https://api.groq.com/openai/v1/models',
 headers: (v) => ({ Authorization: `Bearer ${v}` }),
  },
  OPENROUTER_API_KEY: {
 url: () => 'https://openrouter.ai/api/v1/models',
 headers: (v) => ({ Authorization: `Bearer ${v}` }),
  },
  CESIUM_ION_TOKEN: {
 url: () => 'https://api.cesium.com/v1/assets?limit=1',
 headers: (v) => ({ Authorization: `Bearer ${v}` }),
  },
  MAPBOX_API_KEY: {
 url: (v) => `https://api.mapbox.com/tokens/v2?access_token=${encodeURIComponent(v)}`,
  },
  MAPTILER_API_KEY: {
 url: (v) => `https://api.maptiler.com/maps/basic-v2/style.json?key=${encodeURIComponent(v)}`,
  },
};

async function verifyWebSecret(
  key: RuntimeSecretKey,
  value: string,
): Promise<SecretVerificationResult> {
  const spec = WEB_PROBES[key];
  if (!spec) return { valid: true, message: 'Saved' };

  const trimmed = value.trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
 const res = await fetch(spec.url(trimmed), {
 method: 'GET',
 headers: spec.headers ? spec.headers(trimmed) : undefined,
 signal: controller.signal,
 // Suppress Referer so the Authorization bearer doesn't leak to a
 // redirect target if the provider 301/302s to a CDN.
 referrerPolicy: 'no-referrer',
 });
 if (res.ok) return { valid: true, message: 'Verified' };
 if (res.status === 401 || res.status === 403) {
 return { valid: false, message: `Rejected by provider (${res.status})` };
 }
 // Rate limits, 5xx, etc. — don't lie about validity.
 return { valid: true, message: `Saved (provider returned ${res.status})` };
  } catch {
 // CORS block or network failure — can't tell, so don't block the save.
 return { valid: true, message: 'Saved (could not verify from browser)' };
  } finally {
 clearTimeout(timer);
  }
}

export async function verifySecretWithApi(
  key: RuntimeSecretKey,
  value: string,
  context: Partial<Record<RuntimeSecretKey, string>> = {},
): Promise<SecretVerificationResult> {
  const localValidation = validateSecret(key, value);
  if (!localValidation.valid) {
 return { valid: false, message: localValidation.hint ?? 'Invalid value' };
  }

  if (!isDesktopRuntime()) {
 return verifyWebSecret(key, value);
  }

  try {
 const response = await callSidecarWithAuth(getSidecarSecretValidateUrl(), {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ key, value: value.trim(), context }),
 });

 let payload: unknown = null;
 try {
 payload = await response.json();
 } catch { /* non-JSON response */ }

 if (!response.ok) {
 const rec = payload && typeof payload === 'object' ? payload as Record<string, string> : null;
 const message = rec
 ? String(rec.message ?? rec.error ?? 'Secret validation failed')
 : `Secret validation failed (${response.status})`;
 return { valid: false, message };
 }

 if (!payload || typeof payload !== 'object') {
 return { valid: false, message: 'Secret validation returned an invalid response' };
 }

 const rec = payload as Record<string, string | boolean>;
 const valid = Boolean(rec.valid);
 const message = String(rec.message ?? (valid ? 'Verified' : 'Verification failed'));
 return { valid, message };
  } catch (error) {
 // Network errors reaching the sidecar should NOT block saving.
 // Only explicit 401/403 from the provider means the key is invalid.
 const message = error instanceof Error ? error.message : 'Secret validation failed';
 return { valid: true, message: `Saved (could not verify – ${message})` };
  }
}

export async function loadDesktopSecrets(options?: { syncToSidecar?: boolean }): Promise<void> {
  if (!isDesktopRuntime()) return;

  const syncToSidecar = options?.syncToSidecar ?? true;

  try {
 const keys = await keychainService.listSupportedKeys();

 const keyResults = await Promise.allSettled(
 keys.map(async (key) => {
 const value = await keychainService.get(key);
 return { key, value };
 })
 );

 const syncResults = await Promise.allSettled(
 keyResults
 .filter((r): r is PromiseFulfilledResult<{ key: string; value: string | null }> => r.status === 'fulfilled' && r.value.value != null && r.value.value.trim().length > 0)
 .map(async ({ value: { key, value } }) => {
 runtimeConfig.secrets[key as RuntimeSecretKey] = { value: value!, source: 'vault' };
 if (!syncToSidecar) return;
 try {
 await pushSecretToSidecar(key as RuntimeSecretKey, value!);
 } catch {
 // Sidecar may not be ready during early bootstrap — secrets are
 // already injected into the sidecar env at launch via keychain.
 }
 })
 );

 const failures = syncResults.filter((r) => r.status === 'rejected');
 if (failures.length > 0) {
 // eslint-disable-next-line no-console
 console.warn(`[runtime-config] ${failures.length} key(s) failed to sync to sidecar`);
 }

 notifyConfigChanged();
  } catch (error) {
 // eslint-disable-next-line no-console
 console.warn('[runtime-config] Failed to load desktop secrets from vault', error);
  } finally {
 secretsReadyResolve();
  }
}

/**
 * Boot-time desktop secret load that waits for the native keychain read to
 * finish first. The keychain is now read asynchronously (so a slow Touch ID
 * never freezes the window), so loading immediately would read an empty cache
 * and memoize a null for every key for the whole session. We wait for the
 * `secrets_ready` signal, drop any nulls a stray early read may have cached,
 * then load. On web this is just `loadDesktopSecrets` (a no-op there).
 */
export async function loadDesktopSecretsWhenReady(): Promise<void> {
  if (isDesktopRuntime()) {
 await keychainService.waitUntilLoaded();
 keychainService.invalidateAll();
  }
  // Skip the JS→sidecar push at boot: the native Rust injector has already
  // delivered every loaded secret to the *confirmed* sidecar port. The JS path
  // builds its URL from getApiBaseUrl(), which falls back to the default 46123
  // until resolveLocalApiPort() runs — so if a foreign process is squatting
  // 46123 while our sidecar listens on an OS-assigned fallback port, this push
  // would leak every secret and the bearer token to that process.
  await loadDesktopSecrets({ syncToSidecar: false });
}
