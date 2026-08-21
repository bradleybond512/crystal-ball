import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { readBoundedJson } from './_bounded-json.js';

export const config = { runtime: 'edge' };

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
];
const FEMA_ENDPOINT = 'https://gis.fema.gov/arcgis/rest/services/NSS/OpenShelters/FeatureServer/0/query';
const FEMA_RECOVERY_ENDPOINT = 'https://gis.fema.gov/arcgis/rest/services/FEMA/DRC_Services_Relate/FeatureServer/0/query';
const CENSUS_GEOCODER_ENDPOINT = 'https://geocoding.geo.census.gov/geocoder/geographies/coordinates';
const MAX_STRING = 240;
const MAX_OVERPASS_ELEMENTS = 5000;
const MAX_OVERPASS_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_FEMA_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_CENSUS_RESPONSE_BYTES = 256 * 1024;
const DIRECTORY_TTL_MS = 24 * 60 * 60 * 1000;
const FEMA_TTL_MS = 30 * 60 * 1000;
const DECIMAL_PATTERN = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/;

const CATEGORY_FILTERS = {
  shelter: ['["amenity"="shelter"]', '["social_facility"="shelter"]', '["emergency"="shelter"]'],
  hotel: ['["tourism"="hotel"]', '["tourism"="motel"]', '["tourism"="hostel"]'],
  hospital: ['["amenity"="hospital"]', '["healthcare"="hospital"]'],
  pharmacy: ['["amenity"="pharmacy"]', '["healthcare"="pharmacy"]'],
  fuel: ['["amenity"="fuel"]'],
  water: ['["amenity"="drinking_water"]', '["amenity"="water_point"]', '["man_made"="water_well"]'],
  // FEMA Disaster Recovery Centers are assistance sites, not shelters.
  // Keep this category out of Overpass so only the official DRC feed can
  // populate it.
  recovery: [],
};
const RESOURCE_KINDS = Object.freeze(Object.keys(CATEGORY_FILTERS));

function fetchWithTimeout(url, options, timeoutMs = 12_000, maxResponseBytes) {
  // AbortSignal.timeout remains armed while callers consume the response body;
  // clearing a manual timer when headers arrive would leave body reads unbounded.
  return fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
    // Standards-compliant edge fetch ignores this extension. The desktop
    // sidecar consumes it before its IPv4 transport buffers response chunks.
    ...(maxResponseBytes ? { maxResponseBytes } : {}),
  });
}

function boundedString(value, max = MAX_STRING) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, max) : undefined;
}

function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !DECIMAL_PATTERN.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerParam(value, fallback, min, max) {
  if (value === null) return fallback;
  if (!/^(?:0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseCategories(raw) {
  if (raw === null) return [...RESOURCE_KINDS];
  if (raw === '') return null;
  const values = raw.split(',').map((value) => value.trim());
  if (values.some((value) => !RESOURCE_KINDS.includes(value))) return null;
  return [...new Set(values)];
}

function buildCombinedOverpassQuery(categories, lat, lon, radiusMeters) {
  const clauses = categories.flatMap((category) => CATEGORY_FILTERS[category].flatMap((filter) => [
    `node(around:${radiusMeters},${lat},${lon})${filter};`,
    `way(around:${radiusMeters},${lat},${lon})${filter};`,
    `relation(around:${radiusMeters},${lat},${lon})${filter};`,
  ]));
  return `[out:json][timeout:20][maxsize:67108864];(${clauses.join('')});out center tags;`;
}

function kindForTags(tags, requested) {
  const candidates = [];
  if (tags.amenity === 'shelter' || tags.social_facility === 'shelter' || tags.emergency === 'shelter') candidates.push('shelter');
  if (['hotel', 'motel', 'hostel'].includes(tags.tourism)) candidates.push('hotel');
  if (tags.amenity === 'hospital' || tags.healthcare === 'hospital') candidates.push('hospital');
  if (tags.amenity === 'pharmacy' || tags.healthcare === 'pharmacy') candidates.push('pharmacy');
  if (tags.amenity === 'fuel') candidates.push('fuel');
  if (tags.amenity === 'drinking_water' || tags.amenity === 'water_point' || tags.man_made === 'water_well') candidates.push('water');
  return candidates.find((kind) => requested.includes(kind)) ?? null;
}

function formatAddress(tags) {
  return boundedString([
    tags['addr:housenumber'], tags['addr:street'], tags['addr:city'], tags['addr:state'], tags['addr:postcode'],
  ].map((part) => boundedString(part, 80)).filter(Boolean).join(', '));
}

function fallbackName(kind) {
  return ({ shelter: 'Shelter directory listing', hotel: 'Hotel directory listing', motel: 'Motel directory listing', hostel: 'Hostel directory listing', hospital: 'Hospital directory listing', pharmacy: 'Pharmacy directory listing', fuel: 'Fuel directory listing', water: 'Water directory listing' })[kind];
}

function normalizeOsmElement(element, requested, queryLat, queryLon, retrievedAt) {
  if (!element || !['node', 'way', 'relation'].includes(element.type)) return null;
  const recordId = typeof element.id === 'number' && Number.isSafeInteger(element.id) && element.id >= 0 ? element.id : null;
  const lat = finiteNumber(typeof element.lat === 'number' ? element.lat : element.center?.lat);
  const lon = finiteNumber(typeof element.lon === 'number' ? element.lon : element.center?.lon);
  if (recordId === null || lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const tags = element.tags && typeof element.tags === 'object' && !Array.isArray(element.tags) ? element.tags : {};
  const kind = kindForTags(tags, requested);
  if (!kind) return null;
  const siteId = `osm:${element.type}:${recordId}`;
  const directoryHours = boundedString(tags.opening_hours, 120);
  const site = {
    id: siteId,
    kind,
    name: boundedString(tags.name) ?? fallbackName(kind),
    lat,
    lon,
    distanceKm: haversineKm(queryLat, queryLon, lat, lon),
    sourceRefs: [{ provider: 'osm', recordId: `${element.type}/${recordId}` }],
    capabilities: {
      ...(kind === 'hotel' ? { lodgingType: tags.tourism } : {}),
      ...(directoryHours ? { directoryHours } : {}),
    },
    ...(formatAddress(tags) ? { address: formatAddress(tags) } : {}),
    ...(boundedString(tags.phone ?? tags['contact:phone'], 80) ? { publicPhone: boundedString(tags.phone ?? tags['contact:phone'], 80) } : {}),
    directoryUrl: `https://www.openstreetmap.org/${element.type}/${recordId}`,
  };
  const observation = {
    id: `osm:${element.type}:${recordId}:${retrievedAt}`,
    siteId,
    operational: 'unknown',
    inventory: 'unknown',
    power: 'unknown',
    access: 'unknown',
    observedAt: retrievedAt,
    retrievedAt,
    expiresAt: new Date(Date.parse(retrievedAt) + DIRECTORY_TTL_MS).toISOString(),
    confidence: 'low',
    verification: 'directory',
    provider: 'osm',
    sourceUrl: `https://www.openstreetmap.org/${element.type}/${recordId}`,
  };
  return { site, observation };
}

function yesNo(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (['yes', 'y', 'true'].includes(normalized)) return true;
  if (['no', 'n', 'false'].includes(normalized)) return false;
  return undefined;
}

function nonNegativeInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function arcGisTimestamp(value, retrievedAt) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  const date = new Date(value);
  const retrievalMs = Date.parse(retrievedAt);
  const earliest = Date.UTC(2000, 0, 1);
  return Number.isFinite(date.getTime()) && Number.isFinite(retrievalMs)
    && date.getTime() >= earliest && date.getTime() <= retrievalMs + 5 * 60 * 1000
    ? date.toISOString()
    : undefined;
}

function normalizeFemaFeature(feature, queryLat, queryLon, retrievedAt) {
  const a = feature?.attributes;
  if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
  const record = nonNegativeInteger(a.shelter_id) ?? nonNegativeInteger(a.objectid);
  const lat = finiteNumber(a.latitude ?? feature?.geometry?.y);
  const lon = finiteNumber(a.longitude ?? feature?.geometry?.x);
  if (record === undefined || lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const status = typeof a.shelter_status === 'string' ? a.shelter_status.trim().toLowerCase() : '';
  if (status !== 'open') return null;
  const siteId = `fema:shelter:${record}`;
  const evacuationCapacity = nonNegativeInteger(a.evacuation_capacity);
  const postImpactCapacity = nonNegativeInteger(a.post_impact_capacity);
  const reportedPopulation = nonNegativeInteger(a.total_population);
  const address = boundedString([a.address, a.city, a.state, a.zip].map((v) => boundedString(v, 100)).filter(Boolean).join(', '));
  const directoryHours = boundedString([a.hours_open, a.hours_close].map((v) => boundedString(v, 30)).filter(Boolean).join('–'), 80);
  const capabilities = {
    ...(evacuationCapacity === undefined ? {} : { evacuationCapacity }),
    ...(postImpactCapacity === undefined ? {} : { postImpactCapacity }),
    ...(reportedPopulation === undefined ? {} : { reportedPopulation }),
    ...(yesNo(a.ada_compliant) === undefined ? {} : { ada: yesNo(a.ada_compliant) }),
    ...(yesNo(a.wheelchair_accessible) === undefined ? {} : { wheelchairAccessible: yesNo(a.wheelchair_accessible) }),
    ...(yesNo(a.pet_accommodations_code) === undefined ? {} : { pets: yesNo(a.pet_accommodations_code) }),
    ...(directoryHours ? { directoryHours } : {}),
  };
  return {
    site: {
      id: siteId,
      kind: 'shelter',
      name: boundedString(a.shelter_name) ?? 'FEMA open shelter',
      lat,
      lon,
      distanceKm: haversineKm(queryLat, queryLon, lat, lon),
      ...(address ? { address } : {}),
      sourceRefs: [{ provider: 'fema', recordId: String(record) }],
      capabilities,
    },
    observation: {
      id: `fema:shelter:${record}:${retrievedAt}`,
      siteId,
      operational: 'open',
      // Capacity and population are separate facts. Their arithmetic cannot
      // establish whether a bed is actually available at retrieval time.
      inventory: 'unknown',
      power: 'unknown',
      access: 'unknown',
      observedAt: retrievedAt,
      retrievedAt,
      expiresAt: new Date(Date.parse(retrievedAt) + FEMA_TTL_MS).toISOString(),
      confidence: 'high',
      verification: 'official',
      provider: 'fema',
      sourceUrl: 'https://gis.fema.gov/arcgis/rest/services/NSS/OpenShelters/FeatureServer',
    },
  };
}

function normalizeFemaRecoveryFeature(feature, queryLat, queryLon, retrievedAt) {
  const a = feature?.attributes;
  if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
  const record = nonNegativeInteger(a.drc_id) ?? nonNegativeInteger(a.objectid);
  const lat = finiteNumber(a.latitude ?? feature?.geometry?.y);
  const lon = finiteNumber(a.longitude ?? feature?.geometry?.x);
  if (record === undefined || lat === null || lon === null
    || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const status = typeof a.status === 'string' ? a.status.trim().toLowerCase() : '';
  if (status !== 'open') return null;
  const siteId = `fema:recovery:${record}`;
  const address = boundedString(
    [a.street_1, a.street_2, a.city, a.state, a.zip]
      .map((value) => boundedString(value, 100))
      .filter(Boolean)
      .join(', '),
    400,
  );
  const directoryHours = boundedString(
    [a.days_open, a.hours]
      .map((value) => boundedString(value, 80))
      .filter(Boolean)
      .join(' · '),
    160,
  );
  const sourceUrl = 'https://gis.fema.gov/arcgis/rest/services/FEMA/DRC_Services_Relate/FeatureServer/0';
  const sourceObservedAt = arcGisTimestamp(a.last_report_date, retrievedAt)
    ?? arcGisTimestamp(a.current_as, retrievedAt);
  return {
    site: {
      id: siteId,
      kind: 'recovery',
      name: boundedString(a.drc_name) ?? 'FEMA Disaster Recovery Center',
      lat,
      lon,
      distanceKm: haversineKm(queryLat, queryLon, lat, lon),
      ...(address ? { address } : {}),
      directoryUrl: sourceUrl,
      sourceRefs: [{ provider: 'fema', recordId: String(record) }],
      capabilities: directoryHours ? { directoryHours } : {},
    },
    observation: {
      id: `fema:recovery:${record}:${retrievedAt}`,
      siteId,
      operational: 'open',
      inventory: 'unknown',
      power: 'unknown',
      access: 'unknown',
      observedAt: retrievedAt,
      retrievedAt,
      ...(sourceObservedAt ? { sourceObservedAt } : {}),
      expiresAt: new Date(Date.parse(retrievedAt) + FEMA_TTL_MS).toISOString(),
      confidence: 'high',
      verification: 'official',
      provider: 'fema',
      sourceUrl,
    },
  };
}

async function fetchOverpass(categories, lat, lon, radiusMeters) {
  const query = buildCombinedOverpassQuery(categories, lat, lon, radiusMeters);
  let lastError;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetchWithTimeout(endpoint, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'text/plain;charset=UTF-8' }, body: query }, 6000, MAX_OVERPASS_RESPONSE_BYTES);
      if (!response.ok) throw new Error('http');
      const raw = await readBoundedJson(response, MAX_OVERPASS_RESPONSE_BYTES).catch(() => null);
      if (!raw || !Array.isArray(raw.elements) || raw.elements.length > MAX_OVERPASS_ELEMENTS) throw new Error('malformed');
      return raw.elements;
    } catch (error) { lastError = error; }
  }
  throw lastError ?? new Error('unavailable');
}

async function fetchFema(lat, lon, radiusKm) {
  const params = new URLSearchParams({
    where: "shelter_status = 'Open'",
    geometry: `${lon},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    distance: String(radiusKm),
    units: 'esriSRUnit_Kilometer',
    outFields: 'objectid,shelter_id,shelter_name,address,city,state,zip,shelter_status,evacuation_capacity,post_impact_capacity,total_population,hours_open,hours_close,org_name,org_id,match_type,subfacility_code,ada_compliant,pet_accommodations_code,wheelchair_accessible,latitude,longitude',
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: '200',
    f: 'json',
  });
  const response = await fetchWithTimeout(`${FEMA_ENDPOINT}?${params}`, { headers: { Accept: 'application/json' } }, 12_000, MAX_FEMA_RESPONSE_BYTES);
  if (!response.ok) throw new Error('http');
  const raw = await readBoundedJson(response, MAX_FEMA_RESPONSE_BYTES).catch(() => null);
  if (!raw || !Array.isArray(raw.features)) throw new Error('malformed');
  if (raw.exceededTransferLimit === true) throw new Error('truncated');
  return raw.features.filter((feature) => {
    const status = feature?.attributes?.shelter_status;
    return typeof status !== 'string' || status.trim().toLowerCase() !== 'closed';
  });
}

async function fetchFemaRecoveryCenters(lat, lon, radiusKm) {
  const params = new URLSearchParams({
    where: "status = 'Open'",
    geometry: `${lon},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    distance: String(radiusKm),
    units: 'esriSRUnit_Kilometer',
    outFields: 'objectid,drc_id,drc_name,drc_num,street_1,street_2,city,state,zip,days_open,hours,status,latitude,longitude,current_as,last_report_date',
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: '200',
    f: 'json',
  });
  const response = await fetchWithTimeout(`${FEMA_RECOVERY_ENDPOINT}?${params}`, { headers: { Accept: 'application/json' } }, 12_000, MAX_FEMA_RESPONSE_BYTES);
  if (!response.ok) throw new Error('http');
  const raw = await readBoundedJson(response, MAX_FEMA_RESPONSE_BYTES).catch(() => null);
  if (!raw || !Array.isArray(raw.features)) throw new Error('malformed');
  if (raw.exceededTransferLimit === true) throw new Error('truncated');
  return raw.features.filter((feature) => {
    const status = feature?.attributes?.status;
    return typeof status !== 'string' || status.trim().toLowerCase() !== 'closed';
  });
}

async function resolveCountyFips(lat, lon) {
  // Avoid sending non-US coordinates to a US-only service. This broad bound
  // includes Alaska, Hawaii, and territories; the response remains authority.
  if (lat < 18 || lat > 72 || lon < -180 || lon > -66) return undefined;
  const params = new URLSearchParams({
    x: String(lon),
    y: String(lat),
    benchmark: 'Public_AR_Current',
    vintage: 'Current_Current',
    format: 'json',
  });
  try {
    const response = await fetchWithTimeout(`${CENSUS_GEOCODER_ENDPOINT}?${params}`, { headers: { Accept: 'application/json' } }, 8000, MAX_CENSUS_RESPONSE_BYTES);
    if (!response.ok) return undefined;
    const raw = await readBoundedJson(response, MAX_CENSUS_RESPONSE_BYTES).catch(() => null);
    const geoid = raw?.result?.geographies?.Counties?.[0]?.GEOID;
    return typeof geoid === 'string' && /^\d{5}$/.test(geoid) ? geoid : undefined;
  } catch {
    return undefined;
  }
}

function normalizeName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function dedupeResources(rows) {
  const result = [];
  for (const row of [...rows].sort((a, b) =>
    Number(b.site.sourceRefs[0].provider === 'fema') - Number(a.site.sourceRefs[0].provider === 'fema'))) {
    const duplicate = result.find((existing) => existing.site.kind === row.site.kind
      && normalizeName(existing.site.name) === normalizeName(row.site.name)
      && haversineKm(existing.site.lat, existing.site.lon, row.site.lat, row.site.lon) <= 0.25);
    if (duplicate) {
      duplicate.site.sourceRefs.push(...row.site.sourceRefs);
      continue;
    }
    result.push(row);
  }
  return result;
}

function providerStatus(id, state, acceptedRows, droppedRows, retrievedAt, reasonCode) {
  // `observedAt` remains a compatibility alias. Only `sourceObservedAt`
  // represents a real timestamp published by the upstream provider.
  return { id, state, acceptedRows, droppedRows, observedAt: retrievedAt, retrievedAt, ...(reasonCode ? { reasonCode } : {}) };
}

function json(body, status, cors, extra = {}) {
  return Response.json(body, { status, headers: { 'Content-Type': 'application/json', ...extra, ...cors } });
}

function parseLocalLogisticsQuery(url) {
  const allowedParams = new Set(['lat', 'lon', 'radiusKm', 'limitPerCategory', 'categories']);
  const paramKeys = [...url.searchParams.keys()];
  if (paramKeys.some((key) => !allowedParams.has(key))
    || [...allowedParams].some((key) => url.searchParams.getAll(key).length > 1)) return null;

  const lat = finiteNumber(url.searchParams.get('lat'));
  const lon = finiteNumber(url.searchParams.get('lon'));
  const radiusKm = finiteNumber(url.searchParams.get('radiusKm') ?? '25');
  const limitPerCategory = integerParam(url.searchParams.get('limitPerCategory'), 5, 1, 10);
  const categories = parseCategories(url.searchParams.get('categories'));
  if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  if (radiusKm === null || radiusKm < 1 || radiusKm > 50 || limitPerCategory === null) return null;
  if (!categories || categories.length === 0) return null;
  return { lat, lon, radiusKm, limitPerCategory, categories };
}

function buildProviderJobs(categories, lat, lon, radiusKm, fetchedAt) {
  const osmCategories = categories.filter((category) => CATEGORY_FILTERS[category].length > 0);
  return [
    ...(osmCategories.length > 0 ? [{ id: 'osm', fetch: () => fetchOverpass(osmCategories, lat, lon, Math.round(radiusKm * 1000)), normalize: (row) => normalizeOsmElement(row, osmCategories, lat, lon, fetchedAt) }] : []),
    ...(categories.includes('shelter') ? [{ id: 'fema-open-shelters', fetch: () => fetchFema(lat, lon, radiusKm), normalize: (row) => normalizeFemaFeature(row, lat, lon, fetchedAt) }] : []),
    ...(categories.includes('recovery') ? [{ id: 'fema-recovery-centers', fetch: () => fetchFemaRecoveryCenters(lat, lon, radiusKm), normalize: (row) => normalizeFemaRecoveryFeature(row, lat, lon, fetchedAt) }] : []),
  ];
}

function providerStateForRows(acceptedRows, droppedRows) {
  if (droppedRows > 0) return 'partial';
  return acceptedRows === 0 ? 'empty' : 'ok';
}

function normalizeProviderResults(jobs, settled, fetchedAt) {
  const providers = [];
  const accepted = [];
  for (const [index, result] of settled.entries()) {
    const job = jobs[index];
    if (result.status === 'rejected') {
      providers.push(providerStatus(job.id, 'error', 0, 0, fetchedAt, 'upstream_unavailable'));
      continue;
    }
    const normalized = result.value.map((row) => job.normalize(row)).filter(Boolean);
    const dropped = result.value.length - normalized.length;
    if (result.value.length > 0 && normalized.length === 0) {
      providers.push(providerStatus(job.id, 'error', 0, dropped, fetchedAt, 'unusable_rows'));
      continue;
    }
    const reasonCode = dropped > 0 ? 'rows_dropped' : undefined;
    providers.push(providerStatus(job.id, providerStateForRows(normalized.length, dropped), normalized.length, dropped, fetchedAt, reasonCode));
    accepted.push(...normalized.map((row) => ({ ...row, providerId: job.id })));
  }
  return { providers, accepted };
}

function reconcileProviderContributions(providers, limited) {
  for (const provider of providers) {
    if (provider.state === 'error') continue;
    const contributedRows = limited.filter((row) => row.providerId === provider.id).length;
    const adapterRows = provider.acceptedRows;
    if (adapterRows > 0 && contributedRows === 0) {
      provider.state = 'error';
      provider.acceptedRows = 0;
      provider.droppedRows += adapterRows;
      provider.reasonCode = 'no_contributed_rows';
    } else if (contributedRows < adapterRows) {
      provider.state = 'partial';
      provider.acceptedRows = contributedRows;
      provider.droppedRows += adapterRows - contributedRows;
      provider.reasonCode = 'rows_dropped';
    }
  }
}

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405, cors, { Allow: 'GET, OPTIONS' });
  if (isDisallowedOrigin(req)) return json({ error: 'Origin not allowed' }, 403, cors);

  const parsedQuery = parseLocalLogisticsQuery(new URL(req.url));
  if (!parsedQuery) return json({ error: 'Invalid local logistics query' }, 400, cors);
  const { lat, lon, radiusKm, limitPerCategory, categories } = parsedQuery;

  const fetchedAt = new Date().toISOString();
  const countyFipsPromise = resolveCountyFips(lat, lon);
  const jobs = buildProviderJobs(categories, lat, lon, radiusKm, fetchedAt);
  const settled = await Promise.allSettled(jobs.map((job) => job.fetch()));
  const countyFips = await countyFipsPromise;
  const query = { lat, lon, radiusKm, categories, ...(countyFips ? { countyFips } : {}) };
  const { providers, accepted } = normalizeProviderResults(jobs, settled, fetchedAt);

  const limited = dedupeResources(accepted)
    .sort((a, b) => a.site.distanceKm - b.site.distanceKm)
    .filter((row, index, rows) => rows.slice(0, index).filter((prior) => prior.site.kind === row.site.kind).length < limitPerCategory);
  reconcileProviderContributions(providers, limited);
  const allFailed = providers.every((provider) => provider.state === 'error');
  const partial = !allFailed && providers.some((provider) => ['partial', 'stale', 'error'].includes(provider.state));
  const sites = limited.map((row) => row.site);
  const siteIds = new Set(sites.map((site) => site.id));
  const observations = limited.map((row) => row.observation).filter((observation) => siteIds.has(observation.siteId));
  const nodes = sites.map((site) => ({
    id: site.id,
    category: site.kind,
    name: site.name,
    lat: site.lat,
    lon: site.lon,
    ...(site.distanceKm === undefined ? {} : { distanceKm: site.distanceKm }),
    ...(site.address ? { address: site.address } : {}),
    status: 'unknown',
    fetchedAt,
    deprecated: true,
  }));
  const body = { schemaVersion: 2, query, sites, observations, providers, fetchedAt, retrievedAt: fetchedAt, partial, nodes };
  if (allFailed) return json({ ...body, error: 'Local logistics lookup failed' }, 502, cors, { 'Cache-Control': 'no-store' });
  return json(body, 200, cors, { 'Cache-Control': 'public, max-age=300' });
}
