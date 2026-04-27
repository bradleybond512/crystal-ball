import type { RuntimeSecretKey, RuntimeFeatureId } from './runtime-config';

// Side-effect import: injects KEY_DESCRIPTIONS as "<div class='settings-
// secret-desc'>" under each API-key field. No-op in windows that don't
// render a settings-secret-row. Doing it this way avoids touching the
// pre-existing settings-main.ts render path (which carries legacy lint
// errors unrelated to this change).
import './settings-descriptions';

export const SIGNUP_URLS: Partial<Record<RuntimeSecretKey, string>> = {
  CRYSTALBALL_API_KEY: 'https://crystalball.app',
  GROQ_API_KEY: 'https://console.groq.com/keys',
  OPENROUTER_API_KEY: 'https://openrouter.ai/settings/keys',
  FRED_API_KEY: 'https://fred.stlouisfed.org/docs/api/api_key.html',
  EIA_API_KEY: 'https://www.eia.gov/opendata/register.php',
  CLOUDFLARE_API_TOKEN: 'https://dash.cloudflare.com/profile/api-tokens',
  ACLED_ACCESS_TOKEN: 'https://developer.acleddata.com/',
  ACLED_EMAIL: 'https://developer.acleddata.com/',
  URLHAUS_AUTH_KEY: 'https://auth.abuse.ch/',
  OTX_API_KEY: 'https://otx.alienvault.com/',
  ABUSEIPDB_API_KEY: 'https://www.abuseipdb.com/login',
  WINGBITS_API_KEY: 'https://wingbits.com/register',
  AISSTREAM_API_KEY: 'https://aisstream.io/authenticate',
  OPENSKY_CLIENT_ID: 'https://opensky-network.org/login?view=registration',
  OPENSKY_CLIENT_SECRET: 'https://opensky-network.org/login?view=registration',
  FINNHUB_API_KEY: 'https://finnhub.io/register',
  NASA_FIRMS_API_KEY: 'https://firms.modaps.eosdis.nasa.gov/api/area/',
  UC_DP_KEY: 'https://ucdp.uu.se/downloads/',
  OLLAMA_API_URL: 'https://ollama.com/download',
  OLLAMA_MODEL: 'https://ollama.com/library',
  WTO_API_KEY: 'https://apiportal.wto.org/',
  AVIATIONSTACK_API: 'https://aviationstack.com/signup/free',
  ICAO_API_KEY: 'https://dataservices.icao.int/',
  THREATFOX_API_KEY: 'https://auth.abuse.ch/',
  NEWSAPI_KEY: 'https://newsapi.org/register',
  NEWSDATA_API_KEY: 'https://newsdata.io/register',
  VIRUSTOTAL_API_KEY: 'https://www.virustotal.com/gui/join-us',
  FMP_API_KEY: 'https://financialmodelingprep.com/developer/docs',
  SHODAN_API_KEY: 'https://account.shodan.io/',
  OWM_API_KEY: 'https://openweathermap.org/api',
  GREYNOISE_API_KEY: 'https://www.greynoise.io/plans/community',
  NASA_API_KEY: 'https://api.nasa.gov/#signUp',
  URLSCAN_API_KEY: 'https://urlscan.io/user/signup',
  BITCOINABUSE_API_KEY: 'https://www.bitcoinabuse.com/api-docs',
  VULNERS_API_KEY: 'https://vulners.com/docs/api/',
  MEDIASTACK_API_KEY: 'https://mediastack.com/signup/free',
  PULSEDIVE_API_KEY: 'https://pulsedive.com/api/',
  HIBP_API_KEY: 'https://haveibeenpwned.com/API/Key',
  GEONAMES_USERNAME: 'https://www.geonames.org/login',
  IPINFO_TOKEN: 'https://ipinfo.io/signup',
  CESIUM_ION_TOKEN: 'https://ion.cesium.com/signup/',
  GOOGLE_MAPS_API_KEY: 'https://console.cloud.google.com/apis/credentials',
  MAPBOX_API_KEY: 'https://account.mapbox.com/auth/signup/',
  MAPTILER_API_KEY: 'https://cloud.maptiler.com/auth/widget?next=https://cloud.maptiler.com/maps/',
};

export const PLAINTEXT_KEYS = new Set<RuntimeSecretKey>([
  'OLLAMA_API_URL',
  'OLLAMA_MODEL',
  'WS_RELAY_URL',
  'VITE_OPENSKY_RELAY_URL',
  'ACLED_EMAIL',
]);

export const MASKED_SENTINEL = '__WM_MASKED__';

export const HUMAN_LABELS: Record<RuntimeSecretKey, string> = {
  CRYSTALBALL_API_KEY: 'Crystal Ball Cloud API Key',
  ANTHROPIC_API_KEY: 'Anthropic API Key',
  GROQ_API_KEY: 'Groq API Key',
  OPENROUTER_API_KEY: 'OpenRouter API Key',
  FRED_API_KEY: 'FRED API Key',
  EIA_API_KEY: 'EIA API Key',
  CLOUDFLARE_API_TOKEN: 'Cloudflare API Token',
  ACLED_ACCESS_TOKEN: 'ACLED Access Token',
  ACLED_EMAIL: 'ACLED Registered Email',
  ACLED_REFRESH_TOKEN: 'ACLED Refresh Token',
  URLHAUS_AUTH_KEY: 'URLhaus Auth Key',
  OTX_API_KEY: 'AlienVault OTX Key',
  ABUSEIPDB_API_KEY: 'AbuseIPDB API Key',
  WINGBITS_API_KEY: 'Wingbits API Key',
  WS_RELAY_URL: 'WebSocket Relay URL',
  VITE_OPENSKY_RELAY_URL: 'OpenSky Relay URL',
  OPENSKY_CLIENT_ID: 'OpenSky Client ID',
  OPENSKY_CLIENT_SECRET: 'OpenSky Client Secret',
  AISSTREAM_API_KEY: 'AISStream API Key',
  FINNHUB_API_KEY: 'Finnhub API Key',
  NASA_FIRMS_API_KEY: 'NASA FIRMS API Key',
  UC_DP_KEY: 'UCDP API Key',
  OLLAMA_API_URL: 'Ollama Server URL',
  OLLAMA_MODEL: 'Ollama Model',
  WTO_API_KEY: 'WTO API Key',
  AVIATIONSTACK_API: 'AviationStack API Key',
  ICAO_API_KEY: 'ICAO NOTAM API Key',
  THREATFOX_API_KEY: 'ThreatFox API Key',
  NEWSAPI_KEY: 'NewsAPI Key',
  NEWSDATA_API_KEY: 'NewsData API Key',
  VIRUSTOTAL_API_KEY: 'VirusTotal API Key',
  FMP_API_KEY: 'Financial Modeling Prep API Key',
  SHODAN_API_KEY: 'Shodan API Key',
  OWM_API_KEY: 'OpenWeatherMap API Key',
  GREYNOISE_API_KEY: 'GreyNoise API Key',
  NASA_API_KEY: 'NASA API Key (optional — improves DONKI rate limit)',
  URLSCAN_API_KEY: 'URLScan.io API Key',
  BITCOINABUSE_API_KEY: 'Bitcoin Abuse API Key',
  VULNERS_API_KEY: 'Vulners API Key',
  MEDIASTACK_API_KEY: 'MediaStack API Key',
  PULSEDIVE_API_KEY: 'Pulsedive API Key',
  HIBP_API_KEY: 'Have I Been Pwned API Key',
  GEONAMES_USERNAME: 'GeoNames Username',
  IPINFO_TOKEN: 'IPInfo Token',
  CESIUM_ION_TOKEN: 'Cesium Ion Token',
  GOOGLE_MAPS_API_KEY: 'Google Maps API Key',
  MAPBOX_API_KEY: 'Mapbox',
  MAPTILER_API_KEY: 'MapTiler',
};

/**
 * One-line plain-language descriptions for every API key. Rendered
 * directly under the field in the Settings → API Keys overlay so the
 * user knows what they're providing. Keep each under ~110 chars.
 */
export const KEY_DESCRIPTIONS: Record<RuntimeSecretKey, string> = {
  // ── Cloud + AI ─────────────────────────────────────────────────────────
  CRYSTALBALL_API_KEY: 'Crystal Ball cloud fallback when the local sidecar is unreachable. Optional; paid.',
  ANTHROPIC_API_KEY: 'Claude (Anthropic) — powers the agentic /sitrep, threat synthesis, and Analyst HUD skeptic/projection. Paid.',
  GROQ_API_KEY: 'Fast cloud LLM for panel summaries and the local-LLM Groq fallback. Paid (free tier available).',
  OPENROUTER_API_KEY: 'Routes summary requests across 100+ LLMs as the last fallback. Paid.',
  OLLAMA_API_URL: 'Local LLM endpoint (Ollama or LM Studio). Used first by the Analyst HUD adapter — keeps everything on-device. Free.',
  OLLAMA_MODEL: 'Model name for OLLAMA_API_URL (e.g. llama3, qwen2.5). Required when OLLAMA_API_URL is set.',
  // ── Conflict + Geopolitics ─────────────────────────────────────────────
  ACLED_ACCESS_TOKEN: 'ACLED conflict events worldwide — battles, explosions, riots, protests. Free with registration.',
  ACLED_EMAIL: 'Email registered with ACLED — paired with ACLED_ACCESS_TOKEN for airstrike data.',
  ACLED_REFRESH_TOKEN: 'Optional refresh token for ACLED auth (advanced setup).',
  UC_DP_KEY: 'Uppsala Conflict Data Program — historical conflict baselines. Free.',
  // ── Tracking sensors ───────────────────────────────────────────────────
  OPENSKY_CLIENT_ID: 'OpenSky military aircraft tracking (OAuth client ID). Free with registration.',
  OPENSKY_CLIENT_SECRET: 'OpenSky military aircraft tracking (OAuth secret). Paired with OPENSKY_CLIENT_ID.',
  VITE_OPENSKY_RELAY_URL: 'Self-hosted OpenSky relay URL — bypasses public rate limits. Optional.',
  WS_RELAY_URL: 'Generic WebSocket relay URL for live feeds.',
  AISSTREAM_API_KEY: 'AISStream maritime vessel tracking — military, dark ships, cargo. Free.',
  WINGBITS_API_KEY: 'Wingbits aircraft metadata enrichment (operator, type, registration). Paid.',
  NASA_FIRMS_API_KEY: 'NASA FIRMS — 7,000+ satellite-detected wildfires worldwide. Free.',
  ICAO_API_KEY: 'ICAO NOTAMs — airport closures, runway hazards. Paid.',
  AVIATIONSTACK_API: 'AviationStack — airport delay data. Free tier available.',
  // ── Cyber threat intel ─────────────────────────────────────────────────
  THREATFOX_API_KEY: 'ThreatFox C2 servers + malware IOCs. Free.',
  URLHAUS_AUTH_KEY: 'URLhaus malicious URL feed. Free.',
  OTX_API_KEY: 'AlienVault OTX community threat pulses. Free.',
  ABUSEIPDB_API_KEY: 'AbuseIPDB IP reputation scoring. Free tier (1k requests/day).',
  VIRUSTOTAL_API_KEY: 'VirusTotal IOC reputation lookups. Free tier (4 requests/min).',
  SHODAN_API_KEY: 'Shodan ICS/SCADA exposure scanning. Paid.',
  URLSCAN_API_KEY: 'URLScan.io — URL scanner results, screenshots, behaviour. Free.',
  BITCOINABUSE_API_KEY: 'Bitcoin Abuse — ransomware wallet tracker. Free.',
  VULNERS_API_KEY: 'Vulners — CVE + exploit intelligence. Free tier available.',
  PULSEDIVE_API_KEY: 'Pulsedive threat indicator scoring. Free tier available.',
  GREYNOISE_API_KEY: 'GreyNoise internet noise classification (benign vs malicious scanners). Free (50/day).',
  HIBP_API_KEY: 'Have I Been Pwned breach lookups. Paid.',
  // ── Markets / Macro ────────────────────────────────────────────────────
  FINNHUB_API_KEY: 'Finnhub real-time stocks + crypto quotes. Free tier (60 calls/min).',
  FMP_API_KEY: 'Financial Modeling Prep — markets fallback. Free tier (250 req/day).',
  FRED_API_KEY: 'St. Louis Fed economic data — rates, unemployment, supply chain pressure index. Free.',
  EIA_API_KEY: 'US Energy Information Administration — oil, gas, electricity production + pricing. Free.',
  WTO_API_KEY: 'World Trade Organization — international trade data. Free.',
  // ── News + Media ───────────────────────────────────────────────────────
  NEWSAPI_KEY: 'NewsAPI — 150k+ news sources. Free tier (100 req/day).',
  NEWSDATA_API_KEY: 'NewsData — 95k+ news sources. Free tier (200 req/day).',
  MEDIASTACK_API_KEY: 'MediaStack — 7,500+ news sources. Free tier (500 req/month).',
  // ── Geo + Infrastructure ───────────────────────────────────────────────
  GEONAMES_USERNAME: 'GeoNames place name lookups. Free with registration.',
  IPINFO_TOKEN: 'IPInfo IP geolocation. Free tier (50k req/month).',
  CLOUDFLARE_API_TOKEN: 'Cloudflare Radar — internet outage detection. Paid.',
  NASA_API_KEY: 'NASA developer key — boosts DONKI space-weather rate limits. Free, optional.',
  // ── Mapping ────────────────────────────────────────────────────────────
  CESIUM_ION_TOKEN: 'Cesium Ion — Bing satellite imagery for the God\'s Vision globe and OSM Buildings fallback. Free.',
  GOOGLE_MAPS_API_KEY: 'Google Photorealistic 3D Tiles for the God\'s Vision globe. Free tier (~28k loads/month).',
  OWM_API_KEY: 'OpenWeatherMap — temp/precip/cloud/wind tile layers. Free tier (limited).',
  MAPBOX_API_KEY: 'Mapbox vector tiles (alternative to MapLibre default).',
  MAPTILER_API_KEY: 'MapTiler vector + raster tiles (alternative to MapLibre default).',
};

export interface KeyCategory {
  id: 'llm' | 'markets' | 'cyber' | 'conflict' | 'news' | 'aviation' | 'geo' | 'weather';
  label: string;
  tier: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  keys: RuntimeSecretKey[];
}

export const KEY_CATEGORIES: readonly KeyCategory[] = [
  { id: 'llm',      label: 'Core LLMs',              tier: 1, keys: ['ANTHROPIC_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'OLLAMA_API_URL'] },
  { id: 'markets',  label: 'Markets & Macro',        tier: 2, keys: ['FRED_API_KEY', 'EIA_API_KEY', 'FINNHUB_API_KEY', 'FMP_API_KEY'] },
  { id: 'cyber',    label: 'Cyber Threat Intel',     tier: 3, keys: ['OTX_API_KEY', 'ABUSEIPDB_API_KEY', 'URLHAUS_AUTH_KEY', 'THREATFOX_API_KEY', 'VIRUSTOTAL_API_KEY', 'GREYNOISE_API_KEY', 'URLSCAN_API_KEY', 'VULNERS_API_KEY', 'PULSEDIVE_API_KEY', 'HIBP_API_KEY', 'BITCOINABUSE_API_KEY'] },
  { id: 'conflict', label: 'Conflict & Geopolitics', tier: 4, keys: ['ACLED_ACCESS_TOKEN', 'ACLED_EMAIL', 'ACLED_REFRESH_TOKEN', 'UC_DP_KEY', 'WTO_API_KEY', 'CLOUDFLARE_API_TOKEN'] },
  { id: 'news',     label: 'News',                   tier: 5, keys: ['NEWSAPI_KEY', 'NEWSDATA_API_KEY', 'MEDIASTACK_API_KEY'] },
  { id: 'aviation', label: 'Aviation & Maritime',    tier: 6, keys: ['WINGBITS_API_KEY', 'OPENSKY_CLIENT_ID', 'OPENSKY_CLIENT_SECRET', 'AISSTREAM_API_KEY', 'AVIATIONSTACK_API', 'ICAO_API_KEY'] },
  { id: 'geo',      label: 'Geo & Maps',             tier: 7, keys: ['GOOGLE_MAPS_API_KEY', 'MAPBOX_API_KEY', 'MAPTILER_API_KEY', 'GEONAMES_USERNAME', 'IPINFO_TOKEN', 'CESIUM_ION_TOKEN'] },
  { id: 'weather',  label: 'Weather & NASA',         tier: 8, keys: ['OWM_API_KEY', 'NASA_API_KEY', 'NASA_FIRMS_API_KEY'] },
];

const KEY_TO_CATEGORY = new Map<RuntimeSecretKey, KeyCategory>();
for (const cat of KEY_CATEGORIES) {
  for (const key of cat.keys) KEY_TO_CATEGORY.set(key, cat);
}

export function categoryFor(key: RuntimeSecretKey): KeyCategory | undefined {
  return KEY_TO_CATEGORY.get(key);
}

export interface SettingsCategory {
  id: string;
  label: string;
  features: RuntimeFeatureId[];
}

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  {
 id: 'ai',
 label: 'AI & Summarization',
 features: ['aiClaude', 'aiOllama', 'aiGroq', 'aiOpenRouter'],
  },
  {
 id: 'economy',
 label: 'Economic & Energy',
 features: ['economicFred', 'energyEia', 'supplyChain', 'secEdgar'],
  },
  {
 id: 'markets',
 label: 'Markets & Trade',
 features: ['finnhubMarkets', 'fmpMarketsFallback', 'wtoTrade'],
  },
  {
 id: 'security',
 label: 'Security & Threats',
 features: ['cloudApiFallbackAuth', 'internetOutages', 'acledConflicts', 'acledAirstrikes', 'abuseChThreatIntel', 'alienvaultOtxThreatIntel', 'abuseIpdbThreatIntel', 'threatfoxThreatIntel', 'openPhishThreatIntel', 'phishstatsFeed', 'spamhausDrop', 'cisaKev', 'cveTracker', 'vulnersCve', 'virusTotalEnrichment', 'bgpViewEnrichment', 'shodanIcsExposure', 'greynoiseIntel', 'urlscanThreatIntel', 'bitcoinabuseIocs', 'pulsediveThreatIntel', 'hibpBreach', 'ripeNccData', 'openSanctions'],
  },
  {
 id: 'tracking',
 label: 'Tracking & Sensing',
 features: ['aisRelay', 'openskyRelay', 'wingbitsEnrichment', 'nasaFirms', 'aviationStack', 'icaoNotams', 'openWeatherMap', 'openAqMonitor', 'geoDbCities', 'geoNames', 'ipInfoLookup'],
  },
  {
 id: 'news',
 label: 'News & Media',
 features: ['newsApiHeadlines', 'newsDataFeed', 'mediastackNews', 'redditOsint'],
  },
  {
 id: 'conflict-analysis',
 label: 'Conflict Analysis',
 features: ['iswSituationReports', 'reliefwebCrises', 'bellingcatOsint', 'liveUaMapFeed'],
  },
  {
 id: 'military-diplomatic',
 label: 'Military & Diplomatic',
 features: ['dodNewsRss', 'natoNewsRss', 'acapsCrisisSeverity', 'emscSeismic', 'govWarningConvergence'],
  },
  {
 id: 'travel-warnings',
 label: 'Travel Warnings',
 features: ['fcdoTravelWarnings', 'dfatTravelWarnings', 'gacTravelWarnings'],
  },
  {
 id: 'navigation',
 label: 'Navigation & Routing',
 features: ['navigationMapbox', 'navigationMaptiler', 'navigationRouting'],
  },
];
