#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
/**
 * GDACS RSS parser for the sidecar.
 *
 * Source: https://www.gdacs.org/xml/rss.xml (free, no key)
 * Parses events: type (TC/EQ/FL/VO/DR/WF), severity (green/orange/red),
 * country, coordinates, and score.
 *
 * The existing client-side gdacs.ts uses the JSON events API.
 * This module uses the RSS feed so the sidecar can serve it without
 * CORS issues and cache at the correct 30-min TTL.
 */

/** @typedef {{ id: string, eventType: string, name: string, alertLevel: 'Green'|'Orange'|'Red', score: number, country: string, coordinates: [number,number]|null, fromDate: string, severity: string, url: string }} GdacsRssEvent */

const GDACS_RSS_URL = 'https://www.gdacs.org/xml/rss.xml';
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Safari/537.36';

const EVENT_TYPE_NAMES = {
  EQ: 'Earthquake',
  FL: 'Flood',
  TC: 'Tropical Cyclone',
  VO: 'Volcano',
  WF: 'Wildfire',
  DR: 'Drought',
};

/**
 * Extract the text content of a single XML element.
 * Handles both plain text and CDATA sections.
 * @param {string} xml
 * @param {string} tag
 * @returns {string}
 */
export function xmlText(xml, tag) {
  const escaped = tag.replace(/[-/\\^$*+?.()|[\]{}]/g, String.raw`\$&`).replace(':', String.raw`[:\w]*:`);
  const re = new RegExp(String.raw`<${escaped}[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/`, 'i');
  const m = re.exec(xml); // eslint-disable-line no-restricted-syntax
  return (m?.[1] ?? m?.[2] ?? '').trim();
}

/**
 * Parse the alert level from GDACS XML.
 * @param {string} item
 * @returns {'Green'|'Orange'|'Red'}
 */
export function parseAlertLevel(item) {
  const raw = (xmlText(item, 'gdacs:alertlevel') || xmlText(item, 'alertlevel')).toLowerCase();
  if (raw === 'red') return 'Red';
  if (raw === 'orange') return 'Orange';
  return 'Green';
}

/**
 * Extract [lon, lat] from a GDACS RSS item.
 * @param {string} item
 * @returns {[number,number]|null}
 */
export function parseCoordinates(item) {
  const latRaw = xmlText(item, 'geo:lat') || xmlText(item, 'gdacs:lat') || xmlText(item, 'lat');
  const lonRaw = xmlText(item, 'geo:long') || xmlText(item, 'gdacs:long') || xmlText(item, 'long');
  const lat = Number.parseFloat(latRaw);
  const lon = Number.parseFloat(lonRaw);
  if (Number.isFinite(lat) && Number.isFinite(lon)
    && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) return [lon, lat];

  // georss:point "lat lon"
  const geoPoint = xmlText(item, 'georss:point') || xmlText(item, 'georss:Point');
  if (geoPoint) {
    const parts = geoPoint.trim().split(/\s+/);
    if (parts.length >= 2) {
      const glat = Number.parseFloat(parts[0]);
      const glon = Number.parseFloat(parts[1]);
      if (Number.isFinite(glat) && Number.isFinite(glon)
        && glat >= -90 && glat <= 90 && glon >= -180 && glon <= 180) return [glon, glat];
    }
  }
  return null;
}

/**
 * Parse a single GDACS RSS <item> block into a structured event.
 * @param {string} item
 * @returns {GdacsRssEvent|null}
 */
export function parseRssItem(item) {
  const eventType = (
    xmlText(item, 'gdacs:eventtype') ||
    xmlText(item, 'eventtype') ||
    ''
  ).trim().toUpperCase();
  if (!eventType) return null;

  const eventId = xmlText(item, 'gdacs:eventid') || xmlText(item, 'eventid') || '';
  const id = `gdacs-rss-${eventType}-${eventId || randomBytes(4).toString('hex')}`;

  const name = xmlText(item, 'title') || `${EVENT_TYPE_NAMES[eventType] ?? eventType} Event`;
  const alertLevel = parseAlertLevel(item);
  const scoreRaw = xmlText(item, 'gdacs:alertscore') || xmlText(item, 'alertscore') || '0';
  const score = Number.parseFloat(scoreRaw) || 0;
  const country = xmlText(item, 'gdacs:country') || xmlText(item, 'country') || '';
  const coordinates = parseCoordinates(item);
  const fromDate = xmlText(item, 'pubDate') || xmlText(item, 'gdacs:fromdate') || '';
  const severityRaw = xmlText(item, 'gdacs:severity') || xmlText(item, 'severity') || '';
  const severity = severityRaw.length > 80 ? `${severityRaw.slice(0, 80)}…` : severityRaw;
  const url = xmlText(item, 'link') || '';

  return { id, eventType, name, alertLevel, score, country, coordinates, fromDate, severity, url };
}

/**
 * Split an RSS/XML string into individual <item> blocks.
 * @param {string} xml
 * @returns {string[]}
 */
export function splitRssItems(xml) {
  return [...xml.matchAll(/<item[^>]*>[\s\S]*?<\/item>/gi)].map((m) => m[0]);
}

/**
 * Parse the full GDACS RSS XML into structured events.
 * Dedupes by event type+id.
 * @param {string} xml
 * @returns {GdacsRssEvent[]}
 */
export function parseGdacsRss(xml) {
  const items = splitRssItems(xml);
  const seen = new Set();
  const results = [];
  for (const item of items) {
    const event = parseRssItem(item);
    if (!event) continue;
    const key = `${event.eventType}-${event.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(event);
  }
  return results;
}

/**
 * Group events by eventType for the panel display.
 * @param {GdacsRssEvent[]} events
 * @returns {Record<string, GdacsRssEvent[]>}
 */
export function groupByType(events) {
  const groups = {};
  for (const e of events) {
    const list = groups[e.eventType] ?? [];
    list.push(e);
    groups[e.eventType] = list;
  }
  for (const g of Object.values(groups)) {
    g.sort((a, b) => b.score - a.score);
  }
  return groups;
}

/**
 * Map an alert level to an RGBA array for globe markers.
 * @param {'Green'|'Orange'|'Red'} level
 * @returns {[number,number,number,number]}
 */
export function alertLevelRgba(level) {
  switch (level) {
    case 'Red': { return [229, 57, 53, 220];
    }
    case 'Orange': { return [251, 140, 0, 200];
    }
    default: { return [67, 160, 71, 180];
    }
  }
}

/**
 * Fetch the GDACS RSS feed and return parsed events.
 * @param {(url: string, opts: object, timeoutMs: number) => Promise<Response>} fetcher
 * @returns {Promise<GdacsRssEvent[]>}
 */
export async function fetchGdacsRss(fetcher) {
  const resp = await fetcher(
    GDACS_RSS_URL,
    { headers: { 'User-Agent': CHROME_UA, Accept: 'application/rss+xml,application/xml,text/xml' } },
    15_000,
  );
  if (!resp.ok) throw new Error(`GDACS RSS HTTP ${resp.status}`);
  const xml = await resp.text();
  return parseGdacsRss(xml);
}
