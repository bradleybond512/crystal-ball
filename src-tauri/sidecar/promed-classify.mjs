// src-tauri/sidecar/promed-classify.mjs
//
// Pure parsing + classification for ProMED-mail RSS items. Lives sidecar-side
// so the renderer doesn't have to drag in a DOMParser fallback.
//
/* eslint-disable sonarjs/slow-regex, sonarjs/regex-complexity -- bounded inputs (RSS titles + descriptions sliced to 800 chars); regex-heavy parser pattern matches sibling sidecar feeds */

const RE_HTML_TAGS = /<[^>]+>/g;
const RE_ITEM = /<item>([\s\S]*?)<\/item>/g;
const RE_TITLE_CDATA = /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/;
const RE_TITLE = /<title>([\s\S]*?)<\/title>/;
const RE_DESC_CDATA = /<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/;
const RE_DESC = /<description>([\s\S]*?)<\/description>/;
const RE_LINK = /<link>([\s\S]*?)<\/link>/;
const RE_PUBDATE = /<pubDate>([\s\S]*?)<\/pubDate>/;
const RE_GUID = /<guid[^>]*>([\s\S]*?)<\/guid>/;

const NOVEL_RX = /\b(?:novel|new|unidentified|undiagnosed|unknown\s+etiolog\w*|first\s+(?:\w+\s+){0,3}cases?)\b/i;
const OUTBREAK_RX = /\b(outbreak|epidemic|surge)\b/i;
const CLUSTER_RX = /\b(cluster|unusual|spike|excess)\b/i;

const DISEASE_PATTERNS = [
  /avian influenza/i,
  /yellow fever/i,
  /rift valley/i,
  /mystery illness/i,
  /mpox/i, /ebola/i, /cholera/i, /dengue/i, /measles/i, /covid/i, /influenza/i,
  /marburg/i, /lassa/i, /nipah/i, /hantavirus/i, /plague/i,
  /monkeypox/i, /tuberculosis/i, /polio/i, /rabies/i, /meningitis/i,
];

const MAX_ITEMS = 100;

export function classifySeverity(item) {
  const haystack = `${item?.title ?? ''} ${item?.description ?? ''}`;
  if (NOVEL_RX.test(haystack)) return 'NOVEL_PATHOGEN';
  if (OUTBREAK_RX.test(haystack)) return 'OUTBREAK';
  if (CLUSTER_RX.test(haystack)) return 'UNUSUAL_CLUSTER';
  return 'ROUTINE';
}

export function extractCaseCount(item) {
  const description = item?.description ?? '';
  if (typeof description !== 'string' || description.length === 0) return {};
  const result = {};
  const casesMatch = description.match(/([\d,]+)\s+(?:confirmed\s+)?cases?\b/i);
  if (casesMatch) {
    const n = Number.parseInt(casesMatch[1].replace(/,/g, ''), 10);
    if (Number.isFinite(n)) result.cases = n;
  }
  const deathsMatch = description.match(/([\d,]+)\s+deaths?\b/i);
  if (deathsMatch) {
    const n = Number.parseInt(deathsMatch[1].replace(/,/g, ''), 10);
    if (Number.isFinite(n)) result.deaths = n;
  }
  return result;
}

export function extractDisease(title) {
  const t = String(title ?? '');
  for (const p of DISEASE_PATTERNS) {
    const m = t.match(p);
    if (m) {
      const matched = m[0];
      return matched.charAt(0).toUpperCase() + matched.slice(1).toLowerCase();
    }
  }
  const trimmed = t.replace(/^(outbreak of|case of|cases of|situation report:?)\s*/i, '').trim();
  const segment = trimmed.split(/[\-–—:,]/)[0]?.trim();
  return segment || t.slice(0, 40);
}

export function extractCountry(title, description) {
  const t = String(title ?? '');
  const parenMatch = t.match(/\(([^)]+)\)\s*$/);
  if (parenMatch?.[1]) return parenMatch[1].trim();
  const inMatch = t.match(/\bin\s+([A-Z][a-zA-Z\s]+?)(?:\s*[-–]|\s*$)/);
  if (inMatch?.[1]) return inMatch[1].trim();
  const d = String(description ?? '');
  const inDesc = d.match(/\bin\s+([A-Z][a-zA-Z\s]+?)(?:\s*[-–.,]|\s*$)/);
  if (inDesc?.[1]) return inDesc[1].trim();
  return 'Unknown';
}

function readBlockField(block, cdataRe, plainRe, { stripHtml = false, slice } = {}) {
  const m = block.match(cdataRe) ?? block.match(plainRe);
  if (!m) return '';
  let value = m[1] ?? '';
  value = value.trim();
  if (stripHtml) value = value.replace(RE_HTML_TAGS, '').trim();
  if (slice && value.length > slice) value = value.slice(0, slice);
  return value;
}

function parseGuidBlock(block) {
  const m = block.match(RE_GUID);
  if (!m) return '';
  return m[1].replace(/<!\[CDATA\[/, '').replace(/\]\]>/, '').trim();
}

export function parseProMedRss(xml) {
  if (typeof xml !== 'string' || xml.length === 0) return [];
  if (!xml.includes('<item>')) return [];
  const out = [];
  for (const m of xml.matchAll(RE_ITEM)) {
    if (out.length >= MAX_ITEMS) break;
    const block = m[1];
    const title = readBlockField(block, RE_TITLE_CDATA, RE_TITLE);
    const link = readBlockField(block, /a^/, RE_LINK);
    const pubDate = readBlockField(block, /a^/, RE_PUBDATE);
    const description = readBlockField(block, RE_DESC_CDATA, RE_DESC, { stripHtml: true, slice: 800 });
    const guid = parseGuidBlock(block);
    if (!title) continue;
    const item = { title, description };
    const severity = classifySeverity(item);
    const counts = extractCaseCount(item);
    const id = guid || link || `${pubDate}|${title}`;
    out.push({
      id,
      title,
      link,
      pubDate,
      description,
      disease: extractDisease(title),
      country: extractCountry(title, description),
      severity,
      ...(typeof counts.cases === 'number' ? { cases: counts.cases } : {}),
      ...(typeof counts.deaths === 'number' ? { deaths: counts.deaths } : {}),
    });
  }
  return out;
}

export function summarizeProMedAlerts(alerts) {
  let novelCount = 0;
  let outbreakCount = 0;
  for (const alert of alerts) {
    if (alert.severity === 'NOVEL_PATHOGEN') novelCount++;
    else if (alert.severity === 'OUTBREAK') outbreakCount++;
  }
  return { novelCount, outbreakCount };
}
