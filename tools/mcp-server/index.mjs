#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createSidecarClient } from './sidecar-client.mjs';
import { makeAggregateTools } from './tools/aggregate.mjs';
import { makeGranularTools } from './tools/granular.mjs';
import { makeFoundationTools, schemas as foundationSchemas } from './tools/foundation.mjs';
import { makeIntelligenceTools, schemas as intelligenceSchemas } from './tools/intelligence.mjs';
import { makeStatefulTools, schemas as statefulSchemas } from './tools/stateful.mjs';
import { makeAnalystTools, schemas as analystSchemas } from './tools/analyst.mjs';
import { makeDiagnosticsTools, schemas as diagnosticsSchemas } from './tools/diagnostics.mjs';
import { makeHelpTools, schemas as helpSchemas } from './tools/help.mjs';
import { makeIntelExpansionTools } from './tools/intel-expansion.mjs';
import { makeCapabilityTools } from './tools/capabilities.mjs';
import {
  makeMonitorTools,
  monitorIntervalMs,
  schemas as monitorSchemas,
  startMonitorScheduler,
} from './tools/monitor.mjs';
import { createStorage } from './storage.mjs';
import { textResult } from './result.mjs';
import { catalogSummary, createToolConfig } from './tool-registry.mjs';
import { SERVER_NAME, SERVER_VERSION } from './server-meta.mjs';

const client = createSidecarClient();
const storage = createStorage();
const aggregate = makeAggregateTools(client);
const granular = makeGranularTools(client);
const foundation = makeFoundationTools(client);
const intelligence = makeIntelligenceTools(client, storage);
const stateful = makeStatefulTools(client, storage);
const analyst = makeAnalystTools(client);
const diagnostics = makeDiagnosticsTools(client);
const helpTools = makeHelpTools();
const intelExpansion = makeIntelExpansionTools(client);
const capabilities = makeCapabilityTools(granular);
const monitorCadenceMs = monitorIntervalMs();
const monitor = makeMonitorTools({
  storage,
  granular,
  diagnostics,
  scheduleOptions: { expectedIntervalMs: monitorCadenceMs || undefined },
});

const server = new McpServer(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { instructions: `Crystal Ball provides ${catalogSummary()} for real-time global intelligence. Start with check_feed_health and get_capabilities before broad analysis. Use aggregate tools for situational awareness, granular tools for specific lookups, intelligence tools for analysis, and stateful tools only when the user requests persistent changes. Call help() for generated documentation.` },
);

function registerTool(name, config, handler) {
  return server.registerTool(name, createToolConfig(name, config), handler);
}

// ---- Aggregate Tools ----

const aggregateOpts = {
  summary_only: z.boolean().optional().describe('Return only the summary and counts, omit raw data arrays. Dramatically reduces output size.'),
  limit: z.number().optional().describe('Max items to return per data source (default: unlimited). Use 10-20 for a concise overview.'),
};

registerTool('get_sitrep', {
  description: 'Full situational report: top conflicts, market moves, weather alerts, service health. Start here for broad awareness. Use summary_only=true for a compact brief.',
  inputSchema: z.object({ ...aggregateOpts }),
}, async (args) => textResult(await aggregate.get_sitrep(args)));

registerTool('get_threat_landscape', {
  description: 'Active threats across conflict, cyber, and crisis domains. Includes ACLED conflicts, ThreatFox IOCs, CISA KEVs, and crisis alerts. Use summary_only=true for a compact brief.',
  inputSchema: z.object({ ...aggregateOpts }),
}, async (args) => textResult(await aggregate.get_threat_landscape(args)));

registerTool('get_market_overview', {
  description: 'Financial markets snapshot: indices, crypto, BTC ETF flows, Fear & Greed, WSB sentiment, FRED macro signals. Use summary_only=true for a compact brief.',
  inputSchema: z.object({ ...aggregateOpts }),
}, async (args) => textResult(await aggregate.get_market_overview(args)));

registerTool('get_cyber_intel', {
  description: 'Cyber threat intelligence: ThreatFox IOCs, CISA KEVs, OpenPhish, URLhaus malware URLs, OTX threat pulses. Use summary_only=true for a compact brief.',
  inputSchema: z.object({ ...aggregateOpts }),
}, async (args) => textResult(await aggregate.get_cyber_intel(args)));

registerTool('get_weather_environment', {
  description: 'Weather and environment: conditions for 28 global cities, NWS alerts, NASA DONKI space weather, NOAA SWPC. Use summary_only=true for a compact brief.',
  inputSchema: z.object({ ...aggregateOpts }),
}, async (args) => textResult(await aggregate.get_weather_environment(args)));

registerTool('get_infrastructure_status', {
  description: 'Critical infrastructure: power grid status, grid outage alerts, EPA water quality, RadNet radiation, USGS water. Use summary_only=true for a compact brief.',
  inputSchema: z.object({ ...aggregateOpts }),
}, async (args) => textResult(await aggregate.get_infrastructure_status(args)));

registerTool('get_military_posture', {
  description: 'Military activity: tracked aircraft (ADS-B), naval vessels (AIS), theater posture, ISW analysis reports. Use summary_only=true for a compact brief.',
  inputSchema: z.object({ ...aggregateOpts }),
}, async (args) => textResult(await aggregate.get_military_posture(args)));

// ---- Diagnostic Tools ----

registerTool('check_feed_health', {
  description: 'Pre-flight check: probes the sidecar and key data feeds. Returns which feeds are healthy vs erroring, sidecar memory/uptime, and AIS connection status. Run this before aggregate tools to know what data is available.',
  inputSchema: z.object({}),
}, async () => textResult(await granular.check_feed_health()));

registerTool('get_capabilities', {
  description: 'Capability matrix showing which intelligence domains are ready, partial, or unavailable and why.',
  inputSchema: z.object({}),
}, async () => textResult(await capabilities.get_capabilities()));

registerTool('get_monitor_status', monitorSchemas.get_monitor_status, async () =>
  textResult(await monitor.get_monitor_status()));

registerTool('run_monitor_cycle', monitorSchemas.run_monitor_cycle, async () =>
  textResult(await monitor.run_monitor_cycle()));

registerTool('sitrep_bundle', {
  description: 'Pre-filtered intelligence bundle with per-domain severity scores (1-5). Returns all domains in one call, pre-filtered by severity (quiet domains compressed). Use this instead of calling multiple aggregate tools.',
  inputSchema: z.object({}),
}, async () => textResult(await client.get('/api/sitrep-bundle')));

// ---- Granular Tools ----

registerTool('search_conflicts', {
  description: 'Search ACLED armed conflict events by region, country, date range, or event type.',
  inputSchema: z.object({
    region: z.string().optional().describe('Region name (e.g., "Middle East", "Europe")'),
    country: z.string().optional().describe('Country name (e.g., "Ukraine", "Syria")'),
    date_from: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    date_to: z.string().optional().describe('End date (YYYY-MM-DD)'),
    event_type: z.string().optional().describe('Event type (e.g., "Battles", "Explosions/Remote violence")'),
  }),
}, async (args) => textResult(await granular.search_conflicts(args)));

registerTool('search_news', {
  description: 'Search news headlines from NewsAPI, NewsData, DoD press releases, and NATO news.',
  inputSchema: z.object({
    query: z.string().optional().describe('Search query'),
    category: z.string().optional().describe('News category'),
    country: z.string().optional().describe('Country code (e.g., "us", "gb")'),
  }),
}, async (args) => textResult(await granular.search_news(args)));

registerTool('lookup_ip', {
  description: 'IP intelligence: combines GreyNoise classification, AbuseIPDB reputation, and IPinfo geolocation.',
  inputSchema: z.object({
    ip: z.string().describe('IP address to look up'),
  }),
}, async (args) => textResult(await granular.lookup_ip(args)));

registerTool('lookup_cve', {
  description: 'Search for CVE vulnerabilities via Vulners.',
  inputSchema: z.object({
    query: z.string().describe('CVE ID or search query (e.g., "CVE-2024-1234" or "apache log4j")'),
  }),
}, async (args) => textResult(await granular.lookup_cve(args)));

registerTool('lookup_vessel', {
  description: 'Look up a vessel by MMSI or name from AIS data.',
  inputSchema: z.object({
    mmsi: z.string().optional().describe('MMSI number'),
    name: z.string().optional().describe('Vessel name'),
  }),
}, async (args) => textResult(await granular.lookup_vessel(args)));

registerTool('lookup_flight', {
  description: 'Look up a military aircraft by hex code or callsign from ADS-B data.',
  inputSchema: z.object({
    hex: z.string().optional().describe('ICAO hex code'),
    callsign: z.string().optional().describe('Aircraft callsign (e.g., "DOOM01")'),
  }),
}, async (args) => textResult(await granular.lookup_flight(args)));

registerTool('get_sanctions', {
  description: 'Search OpenSanctions database for sanctioned entities.',
  inputSchema: z.object({
    name: z.string().optional().describe('Entity name to search'),
    country: z.string().optional().describe('Country filter'),
  }),
}, async (args) => textResult(await granular.get_sanctions(args)));

registerTool('get_economic_data', {
  description: 'Fetch FRED economic time series. Common IDs: FEDFUNDS (fed rate), WALCL (Fed balance sheet), T10Y2Y (yield curve), UNRATE (unemployment).',
  inputSchema: z.object({
    series_ids: z.string().describe('Comma-separated FRED series IDs (e.g., "FEDFUNDS,WALCL,T10Y2Y")'),
  }),
}, async (args) => textResult(await granular.get_economic_data(args)));

registerTool('get_sec_filings', {
  description: 'Search SEC EDGAR for 8-K filings (material events) or full-text search.',
  inputSchema: z.object({
    query: z.string().optional().describe('Full-text search query (e.g., company name)'),
    type: z.string().optional().describe('Filing type filter'),
  }),
}, async (args) => textResult(await granular.get_sec_filings(args)));

registerTool('get_earthquakes', {
  description: 'Recent seismic activity from USGS.',
  inputSchema: z.object({
    min_magnitude: z.number().optional().describe('Minimum magnitude filter (e.g., 4.5)'),
    region: z.string().optional().describe('Region name'),
  }),
}, async (args) => textResult(await granular.get_earthquakes(args)));

registerTool('get_disease_outbreaks', {
  description: 'Active disease outbreaks from WHO and ReliefWeb.',
  inputSchema: z.object({
    region: z.string().optional().describe('Region filter'),
  }),
}, async (args) => textResult(await granular.get_disease_outbreaks(args)));

registerTool('get_region_brief', {
  description: 'Everything Crystal Ball knows about a location: security, conflicts, weather, alerts. Provide a place name or lat/lon.',
  inputSchema: z.object({
    place_name: z.string().optional().describe('Place name (e.g., "Kyiv", "Strait of Hormuz")'),
    lat: z.number().optional().describe('Latitude'),
    lon: z.number().optional().describe('Longitude'),
  }),
}, async (args) => textResult(await granular.get_region_brief(args)));

// ---- Foundation Tools (Phase 1) ----

registerTool('query_raw', foundationSchemas.query_raw, async (args) => textResult(await foundation.query_raw(args)));

registerTool('chain_query', foundationSchemas.chain_query, async (args) => textResult(await foundation.chain_query(args)));

registerTool('compare_snapshots', foundationSchemas.compare_snapshots, async (args) => textResult(await foundation.compare_snapshots(args)));

// ---- Intelligence Tools (Phase 2) ----

registerTool('correlate', intelligenceSchemas.correlate, async (args) => textResult(await intelligence.correlate(args)));

registerTool('trend', intelligenceSchemas.trend, async (args) => textResult(await intelligence.trend(args)));

registerTool('anomaly_scan', intelligenceSchemas.anomaly_scan, async (args) => textResult(await intelligence.anomaly_scan(args)));

// ---- Stateful Tools (Phase 3) ----

registerTool('watchlist_manage', statefulSchemas.watchlist_manage, async (args) => textResult(await stateful.watchlist_manage(args)));

registerTool('watchlist_check', statefulSchemas.watchlist_check, async (args) => textResult(await stateful.watchlist_check(args)));

registerTool('alert_rules_manage', statefulSchemas.alert_rules_manage, async (args) => textResult(await stateful.alert_rules_manage(args)));

registerTool('alert_check', statefulSchemas.alert_check, async (args) => textResult(await stateful.alert_check(args)));

// ---- Analyst Tools (renderer-side reasoning layer) ----

registerTool('get_analyst_hypotheses', analystSchemas.get_analyst_hypotheses, async (args) => textResult(await analyst.get_analyst_hypotheses(args)));

registerTool('get_mode_forecast', analystSchemas.get_mode_forecast, async (args) => textResult(await analyst.get_mode_forecast(args)));

registerTool('get_analyst_accuracy', analystSchemas.get_analyst_accuracy, async (args) => textResult(await analyst.get_analyst_accuracy(args)));

registerTool('get_hot_entities', analystSchemas.get_hot_entities, async (args) => textResult(await analyst.get_hot_entities(args)));

registerTool('submit_hypothesis_feedback', analystSchemas.submit_hypothesis_feedback, async (args) => textResult(await analyst.submit_hypothesis_feedback(args)));

registerTool('dismiss_hypothesis', analystSchemas.dismiss_hypothesis, async (args) => textResult(await analyst.dismiss_hypothesis(args)));

registerTool('run_skeptic_now', analystSchemas.run_skeptic_now, async (args) => textResult(await analyst.run_skeptic_now(args)));

registerTool('get_reasoning_debug_log', analystSchemas.get_reasoning_debug_log, async (args) => textResult(await analyst.get_reasoning_debug_log(args)));

registerTool('get_reasoning_metrics', analystSchemas.get_reasoning_metrics, async (args) => textResult(await analyst.get_reasoning_metrics(args)));

registerTool('get_pipeline_trace', analystSchemas.get_pipeline_trace, async (args) => textResult(await analyst.get_pipeline_trace(args)));

registerTool('diagnose_runtime', diagnosticsSchemas.diagnose_runtime, async (args) => textResult(await diagnostics.diagnose_runtime(args)));

registerTool('get_algorithm_diagnostics', diagnosticsSchemas.get_algorithm_diagnostics, async (args) => textResult(await diagnostics.get_algorithm_diagnostics(args)));

// ---- Intel Expansion Tools (16 new sources) ----

registerTool('get_cyber_threats', {
  description: 'Cyber threat feeds: C2 server IPs, IOC indicators, and malware URLs. Use kind to filter to one feed or fetch all three at once.',
  inputSchema: z.object({
    kind: z.enum(['c2', 'iocs', 'urls', 'all']).optional().describe('Which feed(s): c2, iocs, urls, or all (default all)'),
  }),
}, async (args) => textResult(await intelExpansion.get_cyber_threats(args)));

registerTool('get_chokepoint_status', {
  description: 'Maritime chokepoint transit data and trade-ton flows (Hormuz, Suez, Malacca, etc.).',
  inputSchema: z.object({}),
}, async () => textResult(await intelExpansion.get_chokepoint_status()));

registerTool('get_internet_outages', {
  description: 'IODA internet outage alerts. Returns BGP/telescope signals for large-scale connectivity disruptions.',
  inputSchema: z.object({
    hours: z.number().optional().describe('Lookback window in hours (default 24)'),
  }),
}, async (args) => textResult(await intelExpansion.get_internet_outages(args)));

registerTool('get_space_weather_extra', {
  description: 'Extended space weather: aurora max probability, high-latitude activity flag, and top flare-probability regions.',
  inputSchema: z.object({}),
}, async () => textResult(await intelExpansion.get_space_weather_extra()));

registerTool('get_pharma_supply', {
  description: 'Pharmaceutical supply chain: active drug shortages and recent FDA drug recalls.',
  inputSchema: z.object({}),
}, async () => textResult(await intelExpansion.get_pharma_supply()));

registerTool('get_grid_outages', {
  description: 'ORNL power grid outages by county. Returns counties sorted by meters affected.',
  inputSchema: z.object({}),
}, async () => textResult(await intelExpansion.get_grid_outages()));

registerTool('get_disaster_activations', {
  description: 'Copernicus Emergency Management Service activations for major disasters worldwide.',
  inputSchema: z.object({}),
}, async () => textResult(await intelExpansion.get_disaster_activations()));

registerTool('lookup_entity', {
  description: 'GLEIF Legal Entity Identifier (LEI) lookup by company name. Returns official legal name, jurisdiction, LEI code, and status.',
  inputSchema: z.object({
    name: z.string().describe('Company or legal entity name to look up (e.g., "Apple Inc", "Deutsche Bank AG")'),
  }),
}, async (args) => textResult(await intelExpansion.lookup_entity(args)));

registerTool('get_aviation_hazards', {
  description: 'Aviation hazards: SIGMETs (significant meteorological warnings) and FAA NAS ground-stop programs.',
  inputSchema: z.object({}),
}, async () => textResult(await intelExpansion.get_aviation_hazards()));

registerTool('get_fx_rates', {
  description: 'Foreign exchange rates for a base currency. Returns live or recent mid-market rates.',
  inputSchema: z.object({
    base: z.string().optional().describe('Base currency code (default USD, e.g. EUR, JPY)'),
    symbols: z.string().optional().describe('Comma-separated target currency codes (e.g., "EUR,GBP,JPY"); omit for all'),
  }),
}, async (args) => textResult(await intelExpansion.get_fx_rates(args)));

registerTool('get_geo_events', {
  description: 'GDELT geocoded media events: returns news events near a query topic, plotted by location.',
  inputSchema: z.object({
    query: z.string().describe('Topic or keyword query (e.g., "Taiwan strait", "oil tanker attack")'),
    timespan: z.number().optional().describe('Lookback in minutes (default 60)'),
  }),
}, async (args) => textResult(await intelExpansion.get_geo_events(args)));

registerTool('get_radiation', {
  description: 'BfS German gamma-dose radiation monitoring stations. Returns station readings in nSv/h.',
  inputSchema: z.object({}),
}, async () => textResult(await intelExpansion.get_radiation()));

// ---- Help ----

registerTool('help', helpSchemas.help, async (args) => textResult(await helpTools.help(args)));

// ---- Start ----

const transport = new StdioServerTransport();
await server.connect(transport);
startMonitorScheduler(monitor.run_monitor_cycle, { intervalMs: monitorCadenceMs });
console.error('[crystalball-mcp] Server running on stdio');
