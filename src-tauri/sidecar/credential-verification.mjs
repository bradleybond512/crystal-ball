const CHROME_UA = 'CrystalBall credential verification';
function providerRequest(key, value) {
 switch (key) {
 case 'GROQ_API_KEY': { return ['https://api.groq.com/openai/v1/models', {
 headers: { Authorization: `Bearer ${value}`, 'User-Agent': CHROME_UA },
 }];
 }
 case 'ANTHROPIC_API_KEY': { return ['https://api.anthropic.com/v1/models', {
 headers: { 'x-api-key': value, 'anthropic-version': '2023-06-01', Accept: 'application/json' },
 }];
 }
 case 'FRED_API_KEY': { return [`https://api.stlouisfed.org/fred/series?series_id=GDP&api_key=${encodeURIComponent(value)}&file_type=json`,
 { headers: { Accept: 'application/json', 'User-Agent': CHROME_UA } }];
 }
 case 'EIA_API_KEY': { return [`https://api.eia.gov/v2/?api_key=${encodeURIComponent(value)}`,
 { headers: { Accept: 'application/json', 'User-Agent': CHROME_UA } }];
 }
 case 'CLOUDFLARE_API_TOKEN': { return ['https://api.cloudflare.com/client/v4/radar/annotations/outages?dateRange=1d&limit=1',
 { headers: { Authorization: `Bearer ${value}`, 'User-Agent': CHROME_UA } }];
 }
 case 'ACLED_ACCESS_TOKEN': { return ['https://acleddata.com/api/acled/read?_format=json&limit=1', {
 headers: {
 Accept: 'application/json',
 Authorization: `Bearer ${value}`,
 'User-Agent': CHROME_UA,
 },
 }];
 }
 case 'URLHAUS_AUTH_KEY': { return ['https://urlhaus-api.abuse.ch/v1/urls/recent/limit/1/', {
 headers: {
 Accept: 'application/json',
 'Auth-Key': value,
 'User-Agent': CHROME_UA,
 },
 }];
 }
 case 'THREATFOX_API_KEY': { return ['https://threatfox-api.abuse.ch/api/v1/', {
 method: 'POST',
 headers: {
 Accept: 'application/json',
 'Auth-Key': value,
 'Content-Type': 'application/json',
 'User-Agent': CHROME_UA,
 },
 body: JSON.stringify({ query: 'get_iocs', days: 1 }),
 }];
 }
 case 'OTX_API_KEY': { return ['https://otx.alienvault.com/api/v1/user/me', {
 headers: {
 Accept: 'application/json',
 'X-OTX-API-KEY': value,
 'User-Agent': CHROME_UA,
 },
 }];
 }
 case 'ABUSEIPDB_API_KEY': { return ['https://api.abuseipdb.com/api/v2/check?ipAddress=8.8.8.8&maxAgeInDays=90', {
 headers: {
 Accept: 'application/json',
 Key: value,
 'User-Agent': CHROME_UA,
 },
 }];
 }
 case 'VIRUSTOTAL_API_KEY': { return ['https://www.virustotal.com/api/v3/files/d41d8cd98f00b204e9800998ecf8427e', {
 headers: { 'x-apikey': value, Accept: 'application/json' },
 }];
 }
 case 'URLSCAN_API_KEY': { return ['https://urlscan.io/user/quotas/', {
 headers: { 'API-Key': value, Accept: 'application/json' },
 }];
 }
 case 'VULNERS_API_KEY': { return [`https://vulners.com/api/v3/apiKey/valid/?keyID=${encodeURIComponent(value)}`, {
 headers: { Accept: 'application/json' },
 }];
 }
 case 'BITCOINABUSE_API_KEY': { return [`https://www.bitcoinabuse.com/api/reports/check?address=1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa&api_token=${encodeURIComponent(value)}`, {
 headers: { Accept: 'application/json' },
 }];
 }
 case 'WINGBITS_API_KEY': { return ['https://customer-api.wingbits.com/v1/flights', {
 headers: {
 Accept: 'application/json',
 'x-api-key': value,
 'User-Agent': CHROME_UA,
 },
 }];
 }
 case 'FINNHUB_API_KEY': { return [`https://finnhub.io/api/v1/quote?symbol=AAPL&token=${encodeURIComponent(value)}`, {
 headers: { Accept: 'application/json', 'User-Agent': CHROME_UA },
 }];
 }
 case 'FMP_API_KEY': { return [`https://financialmodelingprep.com/api/v3/profile/AAPL?apikey=${encodeURIComponent(value)}`, {
 headers: { Accept: 'application/json' },
 }];
 }
 case 'NASA_FIRMS_API_KEY': { return [`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(value)}/VIIRS_SNPP_NRT/22,44,40,53/1`,
 { headers: { Accept: 'text/csv', 'User-Agent': CHROME_UA } }];
 }
 case 'AIRNOW_API_KEY': { return [`https://www.airnowapi.org/aq/observation/latLong/current/?latitude=39.7392&longitude=-104.9903&distance=50&format=application/json&API_KEY=${encodeURIComponent(value)}`,
 { headers: { Accept: 'application/json', 'User-Agent': CHROME_UA } }];
 }
 case 'PURPLEAIR_API_KEY': { return ['https://api.purpleair.com/v1/keys',
 { headers: { 'X-API-Key': value, Accept: 'application/json', 'User-Agent': CHROME_UA } }];
 }
 case 'NEWSAPI_KEY': { return ['https://newsapi.org/v2/top-headlines?country=us&pageSize=1', {
 headers: { 'X-Api-Key': value, Accept: 'application/json' },
 }];
 }
 case 'NEWSDATA_API_KEY': { return [`https://newsdata.io/api/1/news?apikey=${encodeURIComponent(value)}&size=1`, {
 headers: { Accept: 'application/json' },
 }];
 }
 case 'MEDIASTACK_API_KEY': { return [`https://api.mediastack.com/v1/news?access_key=${encodeURIComponent(value)}&limit=1`, {
 headers: { Accept: 'application/json' },
 }];
 }
 case 'OWM_API_KEY': { return [`https://api.openweathermap.org/data/2.5/weather?q=London&appid=${encodeURIComponent(value)}`, {
 headers: { Accept: 'application/json' },
 }];
 }
 case 'NASA_API_KEY': { return [`https://api.nasa.gov/planetary/apod?api_key=${encodeURIComponent(value)}`, {
 headers: { Accept: 'application/json' },
 }];
 }
 case 'AVIATIONSTACK_API': { return [`https://api.aviationstack.com/v1/flights?access_key=${encodeURIComponent(value)}&limit=1`, {
 headers: { Accept: 'application/json' },
 }];
 }
 case 'CESIUM_ION_TOKEN': { return ['https://api.cesium.com/v1/me', {
 method: 'GET',
 headers: {
 Authorization: `Bearer ${value}`,
 Accept: 'application/json',
 },
 }];
 }
 case 'GEONAMES_USERNAME': { return [`https://secure.geonames.org/searchJSON?q=london&maxRows=1&username=${encodeURIComponent(value)}`, {
 headers: { Accept: 'application/json' },
 }];
 }
 default: { return null;
 }
 }
}

const result = (outcome, reason) => ({ outcome, reason });
const verified = () => result('verified', 'provider-accepted');
const rejected = () => result('rejected', 'provider-rejected');
const unavailable = (reason = 'inconclusive-response') => result('unavailable', reason);
const unsupported = () => result('not-probed', 'unsupported-probe');
const NON_AUTH_PROBES = new Set(['OPENROUTER_API_KEY', 'IPINFO_TOKEN', 'GREYNOISE_API_KEY', 'HIBP_API_KEY', 'PULSEDIVE_API_KEY', 'ICAO_API_KEY']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const rows = (value, field) => Array.isArray(value?.[field]);
const records = (value, field) => rows(value, field) && value[field].length > 0 && value[field].every(value => object(value));
const AUTH_CODES = {
 GROQ_API_KEY: p => p?.error?.code === 'invalid_api_key' || p?.error?.type === 'invalid_api_key',
 ANTHROPIC_API_KEY: p => p?.type === 'error' && p?.error?.type === 'authentication_error',
 FRED_API_KEY: p => p?.error_code === 400 && /^Bad Request\. (The value for variable api_key is not a 32 character alpha-numeric lower-case string|The value for variable api_key is not registered)/.test(p?.error_message || ''),
 EIA_API_KEY: p => ['API_KEY_INVALID'].includes(p?.error?.code),
 CLOUDFLARE_API_TOKEN: p => Array.isArray(p?.errors) && p.errors.some(e => [9109, 10_000].includes(e?.code)),
 URLHAUS_AUTH_KEY: p => p?.query_status === 'invalid_auth_key',
 THREATFOX_API_KEY: p => p?.query_status === 'invalid_auth_key',
 VULNERS_API_KEY: p => p?.result === 'OK' && p?.data?.valid === false,
 FINNHUB_API_KEY: p => p?.error === 'Invalid API key',
 FMP_API_KEY: p => p?.['Error Message'] === 'Invalid API KEY.',
 NEWSAPI_KEY: p => ['apiKeyInvalid'].includes(p?.code),
 NEWSDATA_API_KEY: p => p?.status === 'error' && ['apikey_invalid'].includes(p?.results?.code),
 MEDIASTACK_API_KEY: p => p?.error?.code === 'invalid_access_key',
 AVIATIONSTACK_API: p => p?.error?.code === 'invalid_access_key',
 NASA_API_KEY: p => ['API_KEY_INVALID'].includes(p?.error?.code),
 OPENSKY_CLIENT_ID: p => p?.error === 'invalid_client',
 OPENSKY_CLIENT_SECRET: p => p?.error === 'invalid_client',
 GOOGLE_MAPS_API_KEY: p => p?.status === 'REQUEST_DENIED' && p?.error_message === 'The provided API key is invalid.',
 GEONAMES_USERNAME: p => p?.status?.value === 10,
 VIRUSTOTAL_API_KEY: p => ['AuthenticationRequiredError','WrongCredentialsError'].includes(p?.error?.code),
 OWM_API_KEY: p => p?.cod === 401 && p?.message === 'Invalid API key. Please see https://openweathermap.org/faq#error401 for more info.',
 MAPBOX_API_KEY: p => p?.message === 'Not Authorized - Invalid Token',
 MAPTILER_API_KEY: p => p?.error?.code === 'INVALID_KEY',
 OTX_API_KEY: p => p?.detail === 'Invalid API Key',

 ABUSEIPDB_API_KEY: p => Array.isArray(p?.errors) && p.errors.some(error => error?.detail === 'The API key provided is invalid.'),
 PURPLEAIR_API_KEY: p => p?.error === 'ApiKeyInvalidError',
 CESIUM_ION_TOKEN: p => p?.code === 'InvalidCredentials',
};
const SHAPES = {
 GROQ_API_KEY: p => p?.object === 'list' && rows(p, 'data') && p.data.length > 0 && p.data.every(item => item?.object === 'model' && typeof item?.id === 'string' && item.id.trim() !== ''),
 ANTHROPIC_API_KEY: p => rows(p, 'data') && p.data.length > 0 && p.data.every(item => item?.type === 'model' && typeof item?.id === 'string' && item.id.trim() !== ''),
 FRED_API_KEY: p => records(p, 'seriess') && p.seriess.every(series => series.id === 'GDP'),
 EIA_API_KEY: p => object(p?.response) && (typeof p.response.id === 'string' || rows(p.response, 'routes')),
 CLOUDFLARE_API_TOKEN: p => p?.success === true && object(p?.result),
 ACLED_ACCESS_TOKEN: p => p?.success === true && records(p, 'data'),
 URLHAUS_AUTH_KEY: p => p?.query_status === 'ok' && records(p, 'urls'),
 THREATFOX_API_KEY: p => p?.query_status === 'ok' && records(p, 'data'),
 OTX_API_KEY: p => typeof p?.username === 'string' && (typeof p?.id === 'number' || typeof p?.id === 'string'),
 // eslint-disable-next-line sonarjs/no-hardcoded-ip -- fixed public DNS target from the existing authenticated provider probe
 ABUSEIPDB_API_KEY: p => p?.data?.ipAddress === '8.8.8.8' && typeof p?.data?.abuseConfidenceScore === 'number',
 VIRUSTOTAL_API_KEY: p => object(p?.data) && p.data.type === 'file',
 URLSCAN_API_KEY: (p, response) => object(p?.limits) && response.headers?.get('x-rate-limit-scope') === 'user',
 VULNERS_API_KEY: p => p?.result === 'OK' && p?.data?.valid === true,
 BITCOINABUSE_API_KEY: p => typeof p?.count === 'number',
 WINGBITS_API_KEY: p => (Array.isArray(p) && p.length > 0 && p.every(value => object(value))) || records(p, 'data') || records(p, 'flights'),
 FINNHUB_API_KEY: p => typeof p?.c === 'number' && Number.isFinite(p.c),
 FMP_API_KEY: p => Array.isArray(p) && p.length > 0 && p.every(v => v?.symbol === 'AAPL'),
 AIRNOW_API_KEY: p => Array.isArray(p) && p.length > 0 && p.every(v => typeof v?.AQI === 'number' && typeof v?.ParameterName === 'string'),
 PURPLEAIR_API_KEY: p => typeof p?.api_version === 'string' && typeof p?.key_type === 'string',
 NEWSAPI_KEY: p => p?.status === 'ok' && rows(p, 'articles'),
 NEWSDATA_API_KEY: p => p?.status === 'success' && rows(p, 'results'),
 MEDIASTACK_API_KEY: p => object(p?.pagination) && rows(p, 'data'),
 AVIATIONSTACK_API: p => object(p?.pagination) && rows(p, 'data'),
 OWM_API_KEY: p => p?.cod === 200 && object(p?.main),
 NASA_API_KEY: p => typeof p?.date === 'string' && typeof p?.title === 'string' && typeof p?.media_type === 'string',
 OPENSKY_CLIENT_ID: p => typeof p?.access_token === 'string' && p.access_token.length > 0,
 OPENSKY_CLIENT_SECRET: p => typeof p?.access_token === 'string' && p.access_token.length > 0,
 GOOGLE_MAPS_API_KEY: p => ['OK','ZERO_RESULTS'].includes(p?.status) && rows(p, 'routes'),
 MAPBOX_API_KEY: p => p?.type === 'FeatureCollection' && rows(p, 'features'),
 MAPTILER_API_KEY: p => p?.version === 8 && object(p?.sources) && rows(p, 'layers'),
 CESIUM_ION_TOKEN: p => typeof p?.id === 'number' && typeof p?.username === 'string',
 GEONAMES_USERNAME: p => typeof p?.totalResultsCount === 'number' && rows(p, 'geonames'),
};

function requestFor(key, value, context) {
 if (key === 'OPENSKY_CLIENT_ID' || key === 'OPENSKY_CLIENT_SECRET') {
  const clientId = key === 'OPENSKY_CLIENT_ID' ? value : context.OPENSKY_CLIENT_ID;
  const clientSecret = key === 'OPENSKY_CLIENT_SECRET' ? value : context.OPENSKY_CLIENT_SECRET;
  if (typeof clientId !== 'string' || !clientId.trim() || typeof clientSecret !== 'string' || !clientSecret.trim()) return null;
  return ['https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({grant_type:'client_credentials',client_id:clientId,client_secret:clientSecret}) }];
 }
 if (key === 'GOOGLE_MAPS_API_KEY') return [`https://maps.googleapis.com/maps/api/directions/json?origin=NY&destination=LA&key=${encodeURIComponent(value)}`, {}];
 if (key === 'MAPBOX_API_KEY') return [`https://api.mapbox.com/geocoding/v5/mapbox.places/SanFrancisco.json?access_token=${encodeURIComponent(value)}&limit=1`, {}];
 if (key === 'MAPTILER_API_KEY') return [`https://api.maptiler.com/maps/streets-v2/style.json?key=${encodeURIComponent(value)}`, {}];
 return providerRequest(key, value);
}

function classify(key, response, text) {
 if (response.status >= 300 && response.status < 400) return unavailable();
 if (response.status === 429) return unavailable('rate-limited');
 if (response.status >= 500) return unavailable('provider-unavailable');
 let payload;
 try { payload = JSON.parse(text); } catch { payload = null; }
 const authStatus = key === 'GROQ_API_KEY' || key === 'ANTHROPIC_API_KEY' ? response.status === 401 : [200,400,401,403].includes(response.status);
 if (authStatus && AUTH_CODES[key]?.(payload)) return rejected();
 if (!response.ok || payload?.error || (Array.isArray(payload?.errors) ? payload.errors.length > 0 : payload?.errors) || payload?.status === 'error') return unavailable();
 if (key === 'NASA_FIRMS_API_KEY') return text.startsWith('latitude,longitude,') ? verified() : unavailable();
 return SHAPES[key]?.(payload, response) ? verified() : unavailable();
}

function localCandidateResult(key, rawValue) {
 if (typeof rawValue !== 'string' || !rawValue.trim() || rawValue.length > 8192 || /[\r\n\0]/.test(rawValue)) return result('invalid-format','invalid-format');
 const value = rawValue.trim();
 if (['OLLAMA_API_URL','WS_RELAY_URL','VITE_WS_RELAY_URL','VITE_OPENSKY_RELAY_URL'].includes(key)) {
  try {
   const url = new URL(value);
   const protocols = key === 'OLLAMA_API_URL' ? ['http:','https:'] : ['http:','https:','ws:','wss:'];
   if (!protocols.includes(url.protocol) || url.username || url.password) return result('invalid-format','invalid-format');
  } catch { return result('invalid-format','invalid-format'); }
  return unsupported();
 }
 if (key === 'AISSTREAM_API_KEY' && !/^(?:[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}|[a-f0-9]{32,64})$/i.test(value)) return result('invalid-format','invalid-format');
 if (key === 'CRYSTALBALL_API_KEY' && !/^[A-Za-z0-9_-]{16,}$/.test(value)) return result('invalid-format','invalid-format');
 return null;
}

async function probeWithDeadline(fetch, request, key, duration) {
 const controller = new AbortController();
 let timer;
 try {
  const deadline = new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve(unavailable('timeout')); }, duration); });
  const probe = (async () => {
   const [url, init] = request;
   const response = await fetch(url, { ...init, redirect:'error', maxResponseBytes:262_144, signal:controller.signal }, duration);
   const text = await response.text();
   if (Buffer.byteLength(text) > 262_144) return unavailable();
   return classify(key, response, text);
  })();
  return await Promise.race([probe, deadline]);
 } catch {
  return unavailable(controller.signal.aborted ? 'timeout' : 'provider-unavailable');
 } finally {
  clearTimeout(timer);
 }
}

const COMPANIONS = { OPENSKY_CLIENT_ID:'OPENSKY_CLIENT_SECRET', OPENSKY_CLIENT_SECRET:'OPENSKY_CLIENT_ID' };

export function createCredentialVerifier({ fetch, now = Date.now, deadlineMs = 12_000 } = {}) {
 const lastAttempt = new Map();
 const inFlight = new Map();
 let active = 0;
 return (key, rawValue, context = {}) => {
  const localResult = localCandidateResult(key, rawValue);
  if (localResult) return localResult;
  const value = rawValue.trim();
  if (NON_AUTH_PROBES.has(key)) return unsupported();
  const request = requestFor(key, value, context);
  if (!request) return unsupported();
  const companion = context[COMPANIONS[key]];
  const running = inFlight.get(key);
  if (running && running.value === value && running.companion === companion) return running.promise;
  const started = now();
  if (lastAttempt.has(key) && started - lastAttempt.get(key) < 60_000) return unavailable('cooldown');
  if (active >= 2) return unavailable('concurrency-limit');
  lastAttempt.set(key, started);
  active++;
  const operation = probeWithDeadline(fetch, request, key, Math.min(12_000, Math.max(1, deadlineMs))).finally(() => {
   active--;
   inFlight.delete(key);
  });
  inFlight.set(key, {value, companion, promise:operation});
  return operation;
 };
}
