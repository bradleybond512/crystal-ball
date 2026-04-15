import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createSidecarClient } from './sidecar-client.mjs';
import { makeAggregateTools } from './tools/aggregate.mjs';
import { makeGranularTools } from './tools/granular.mjs';
import { makeFoundationTools, schemas as foundationSchemas } from './tools/foundation.mjs';
import { makeIntelligenceTools, schemas as intelligenceSchemas } from './tools/intelligence.mjs';
import { makeStatefulTools, schemas as statefulSchemas } from './tools/stateful.mjs';
import { makeHelpTools, schemas as helpSchemas } from './tools/help.mjs';
import { createStorage } from './storage.mjs';

const client = createSidecarClient();
const storage = createStorage();
const aggregate = makeAggregateTools(client);
const granular = makeGranularTools(client);
const foundation = makeFoundationTools(client);
const intelligence = makeIntelligenceTools(client, storage);
const stateful = makeStatefulTools(client, storage);
const helpTools = makeHelpTools();

const server = new McpServer(
  { name: 'crystalball', version: '0.2.0' },
  { instructions: 'Crystal Ball provides real-time global intelligence: conflicts, markets, cyber threats, weather, military posture, infrastructure status, and more. Use aggregate tools for broad situational awareness, granular tools for specific lookups. Foundation tools (query_raw, chain_query, compare_snapshots) give direct sidecar access and query chaining. Intelligence tools (correlate, trend, anomaly_scan) enable cross-domain correlation and time-series analysis from sentinel history. Stateful tools (watchlist_manage, watchlist_check, alert_rules_manage, alert_check) provide persistent tracking and threshold alerts. Call help() for full documentation.' },
);

function textResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

// ---- Aggregate Tools ----

server.registerTool('get_sitrep', {
  description: 'Full situational report: top conflicts, market moves, weather alerts, service health. Start here for broad awareness.',
  inputSchema: z.object({}),
}, async () => textResult(await aggregate.get_sitrep()));

server.registerTool('get_threat_landscape', {
  description: 'Active threats across conflict, cyber, and crisis domains. Includes ACLED conflicts, ThreatFox IOCs, CISA KEVs, and crisis alerts.',
  inputSchema: z.object({}),
}, async () => textResult(await aggregate.get_threat_landscape()));

server.registerTool('get_market_overview', {
  description: 'Financial markets snapshot: indices, crypto, BTC ETF flows, Fear & Greed, WSB sentiment, FRED macro signals.',
  inputSchema: z.object({}),
}, async () => textResult(await aggregate.get_market_overview()));

server.registerTool('get_cyber_intel', {
  description: 'Cyber threat intelligence: ThreatFox IOCs, CISA KEVs, OpenPhish, URLhaus malware URLs, OTX threat pulses.',
  inputSchema: z.object({}),
}, async () => textResult(await aggregate.get_cyber_intel()));

server.registerTool('get_weather_environment', {
  description: 'Weather and environment: conditions for 28 global cities, NWS alerts, NASA DONKI space weather, NOAA SWPC.',
  inputSchema: z.object({}),
}, async () => textResult(await aggregate.get_weather_environment()));

server.registerTool('get_infrastructure_status', {
  description: 'Critical infrastructure: power grid status, grid outage alerts, EPA water quality, RadNet radiation, USGS water.',
  inputSchema: z.object({}),
}, async () => textResult(await aggregate.get_infrastructure_status()));

server.registerTool('get_military_posture', {
  description: 'Military activity: tracked aircraft (ADS-B), naval vessels (AIS), theater posture, ISW analysis reports.',
  inputSchema: z.object({}),
}, async () => textResult(await aggregate.get_military_posture()));

// ---- Granular Tools ----

server.registerTool('search_conflicts', {
  description: 'Search ACLED armed conflict events by region, country, date range, or event type.',
  inputSchema: z.object({
    region: z.string().optional().describe('Region name (e.g., "Middle East", "Europe")'),
    country: z.string().optional().describe('Country name (e.g., "Ukraine", "Syria")'),
    date_from: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    date_to: z.string().optional().describe('End date (YYYY-MM-DD)'),
    event_type: z.string().optional().describe('Event type (e.g., "Battles", "Explosions/Remote violence")'),
  }),
}, async (args) => textResult(await granular.search_conflicts(args)));

server.registerTool('search_news', {
  description: 'Search news headlines from NewsAPI, NewsData, DoD press releases, and NATO news.',
  inputSchema: z.object({
    query: z.string().optional().describe('Search query'),
    category: z.string().optional().describe('News category'),
    country: z.string().optional().describe('Country code (e.g., "us", "gb")'),
  }),
}, async (args) => textResult(await granular.search_news(args)));

server.registerTool('lookup_ip', {
  description: 'IP intelligence: combines GreyNoise classification, AbuseIPDB reputation, and IPinfo geolocation.',
  inputSchema: z.object({
    ip: z.string().describe('IP address to look up'),
  }),
}, async (args) => textResult(await granular.lookup_ip(args)));

server.registerTool('lookup_cve', {
  description: 'Search for CVE vulnerabilities via Vulners.',
  inputSchema: z.object({
    query: z.string().describe('CVE ID or search query (e.g., "CVE-2024-1234" or "apache log4j")'),
  }),
}, async (args) => textResult(await granular.lookup_cve(args)));

server.registerTool('lookup_vessel', {
  description: 'Look up a vessel by MMSI or name from AIS data.',
  inputSchema: z.object({
    mmsi: z.string().optional().describe('MMSI number'),
    name: z.string().optional().describe('Vessel name'),
  }),
}, async (args) => textResult(await granular.lookup_vessel(args)));

server.registerTool('lookup_flight', {
  description: 'Look up a military aircraft by hex code or callsign from ADS-B data.',
  inputSchema: z.object({
    hex: z.string().optional().describe('ICAO hex code'),
    callsign: z.string().optional().describe('Aircraft callsign (e.g., "DOOM01")'),
  }),
}, async (args) => textResult(await granular.lookup_flight(args)));

server.registerTool('get_sanctions', {
  description: 'Search OpenSanctions database for sanctioned entities.',
  inputSchema: z.object({
    name: z.string().optional().describe('Entity name to search'),
    country: z.string().optional().describe('Country filter'),
  }),
}, async (args) => textResult(await granular.get_sanctions(args)));

server.registerTool('get_economic_data', {
  description: 'Fetch FRED economic time series. Common IDs: FEDFUNDS (fed rate), WALCL (Fed balance sheet), T10Y2Y (yield curve), UNRATE (unemployment).',
  inputSchema: z.object({
    series_ids: z.string().describe('Comma-separated FRED series IDs (e.g., "FEDFUNDS,WALCL,T10Y2Y")'),
  }),
}, async (args) => textResult(await granular.get_economic_data(args)));

server.registerTool('get_sec_filings', {
  description: 'Search SEC EDGAR for 8-K filings (material events) or full-text search.',
  inputSchema: z.object({
    query: z.string().optional().describe('Full-text search query (e.g., company name)'),
    type: z.string().optional().describe('Filing type filter'),
  }),
}, async (args) => textResult(await granular.get_sec_filings(args)));

server.registerTool('get_earthquakes', {
  description: 'Recent seismic activity from USGS.',
  inputSchema: z.object({
    min_magnitude: z.number().optional().describe('Minimum magnitude filter (e.g., 4.5)'),
    region: z.string().optional().describe('Region name'),
  }),
}, async (args) => textResult(await granular.get_earthquakes(args)));

server.registerTool('get_disease_outbreaks', {
  description: 'Active disease outbreaks from WHO and ReliefWeb.',
  inputSchema: z.object({
    region: z.string().optional().describe('Region filter'),
  }),
}, async (args) => textResult(await granular.get_disease_outbreaks(args)));

server.registerTool('get_region_brief', {
  description: 'Everything Crystal Ball knows about a location: security, conflicts, weather, alerts. Provide a place name or lat/lon.',
  inputSchema: z.object({
    place_name: z.string().optional().describe('Place name (e.g., "Kyiv", "Strait of Hormuz")'),
    lat: z.number().optional().describe('Latitude'),
    lon: z.number().optional().describe('Longitude'),
  }),
}, async (args) => textResult(await granular.get_region_brief(args)));

// ---- Foundation Tools (Phase 1) ----

server.registerTool('query_raw', foundationSchemas.query_raw, async (args) => textResult(await foundation.query_raw(args)));

server.registerTool('chain_query', foundationSchemas.chain_query, async (args) => textResult(await foundation.chain_query(args)));

server.registerTool('compare_snapshots', foundationSchemas.compare_snapshots, async (args) => textResult(await foundation.compare_snapshots(args)));

// ---- Intelligence Tools (Phase 2) ----

server.registerTool('correlate', intelligenceSchemas.correlate, async (args) => textResult(await intelligence.correlate(args)));

server.registerTool('trend', intelligenceSchemas.trend, async (args) => textResult(await intelligence.trend(args)));

server.registerTool('anomaly_scan', intelligenceSchemas.anomaly_scan, async (args) => textResult(await intelligence.anomaly_scan(args)));

// ---- Stateful Tools (Phase 3) ----

server.registerTool('watchlist_manage', statefulSchemas.watchlist_manage, async (args) => textResult(await stateful.watchlist_manage(args)));

server.registerTool('watchlist_check', statefulSchemas.watchlist_check, async (args) => textResult(await stateful.watchlist_check(args)));

server.registerTool('alert_rules_manage', statefulSchemas.alert_rules_manage, async (args) => textResult(await stateful.alert_rules_manage(args)));

server.registerTool('alert_check', statefulSchemas.alert_check, async (args) => textResult(await stateful.alert_check(args)));

// ---- Help ----

server.registerTool('help', helpSchemas.help, async (args) => textResult(await helpTools.help(args)));

// ---- Start ----

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[crystalball-mcp] Server running on stdio');
