import { replaceNonemptyAngleSpans } from '@/utils/angle-span-text';

export interface ArmsTransfer {
  id: string;
  title: string;
  description: string;
  recipient: string;
  systems: string[];
  valueEstimate: string | null;
  transmittalNumber: string | null;
  pubDate: Date;
  url: string;
  source: 'federal-register' | 'dsca';
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'major-defense' | 'commercial' | 'training' | 'logistics' | 'general';
}

const CACHE_TTL_MS = 30 * 60 * 1000;

interface Cache {
  items: ArmsTransfer[];
  ts: number;
}

let _cache: Cache | null = null;

const FEDERAL_REGISTER_URL =
  'https://www.federalregister.gov/api/v1/documents.json' +
  '?conditions[agencies][]=defense-security-cooperation-agency' +
  '&per_page=20&order=newest&conditions[type][]=Notice';

const DSCA_RSS_URL = 'https://www.dsca.mil/rss.xml';

function proxyFeedUrl(feedUrl: string): string {
  return `/api/rss-proxy?url=${encodeURIComponent(feedUrl)}`;
}

function stripHtml(html: string): string {
  return replaceNonemptyAngleSpans(html)
 .replace(/&amp;/g, '&')
 .replace(/&lt;/g, '<')
 .replace(/&gt;/g, '>')
 .replace(/&quot;/g, '"')
 .replace(/&#039;/g, "'")
 .replace(/&nbsp;/g, ' ')
 .replace(/\s{2,}/g, ' ')
 .trim();
}

const WEAPON_SYSTEMS = [
  'F-16', 'F-35', 'F-15', 'C-130', 'AH-64', 'UH-60', 'M1A2', 'Abrams',
  'Patriot', 'HIMARS', 'JDAM', 'AIM-120', 'Harpoon', 'Javelin', 'Stinger',
  'Apache', 'Black Hawk', 'submarine', 'frigate', 'destroyer', 'corvette',
  'radar', 'missile', 'helicopter',
];

function hasMajorDefenseSystem(text: string): boolean {
  return /aircraft|f-16|f-35|f-15|c-130|ah-64|uh-60|m1a2|abrams|patriot|himars|jdam/i.test(text)
    || /aim-120|harpoon|javelin|stinger|apache|black hawk|submarine|frigate|destroyer|corvette|radar/i.test(text);
}

function extractSystems(text: string): string[] {
  const found: string[] = [];
  for (const sys of WEAPON_SYSTEMS) {
 const re = new RegExp(sys.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`), 'i');
 if (re.test(text)) found.push(sys);
  }
  return found;
}

function recipientWhitespace(char: string | undefined): boolean {
  return char !== undefined && /\s/.test(char);
}

function recipientUpper(char: string | undefined): boolean {
  return char !== undefined && char >= 'A' && char <= 'Z';
}

function recipientLetter(char: string | undefined): boolean {
  return recipientUpper(char) || (char !== undefined && char >= 'a' && char <= 'z');
}

function recipientWord(char: string | undefined): boolean {
  return recipientLetter(char) || (char !== undefined && char >= '0' && char <= '9') || char === '_';
}

function recipientWhitespaceEnd(text: string, start: number): number {
  let end = start;
  while (end < text.length && recipientWhitespace(text[end])) end++;
  return end;
}

function recipientStart(text: string, index: number, government: boolean): number {
  if (government) {
    return text.startsWith('Government of ', index) && recipientUpper(text[index + 14]) ? index + 14 : -1;
  }
  if (!text.startsWith('to', index) || recipientWord(text[index - 1]) || !recipientWhitespace(text[index + 2])) return -1;
  const start = recipientWhitespaceEnd(text, index + 2);
  return recipientUpper(text[start]) ? start : -1;
}

function recipientSuffix(text: string, index: number, whitespaceEnd: number, government: boolean): boolean {
  const whitespace = recipientWhitespace(text[index]);
  const end = whitespace ? whitespaceEnd : index;
  if (index === text.length || text[end] === ',' || text[end] === '.' || text[end] === '(') return true;
  if (!whitespace) return false;
  if (text.startsWith('for', end)) return true;
  if (government) return text.startsWith('to', end);
  return (text[end] === 'a' && recipientWhitespace(text[end + 1]))
    || (text.startsWith('the', end) && recipientWhitespace(text[end + 3]));
}

// Earliest viable capture dominates later prefixes in the same allowed run.
// Separate passes preserve Government-of priority, not textual-prefix priority.
// Whitespace endpoints advance monotonically: linear work, constant extra state.
function findRecipient(text: string, government: boolean): string | null {
  let start = -1;
  let whitespaceEnd = 0;
  let index = 0;
  while (index <= text.length) {
    const char = text[index];
    const whitespace = recipientWhitespace(char);
    if (whitespace && index >= whitespaceEnd) whitespaceEnd = recipientWhitespaceEnd(text, index);
    // A suffix is outside capture: check before invalidating on punctuation.
    if (start >= 0 && index >= start + 2 && recipientSuffix(text, index, whitespaceEnd, government)) return text.slice(start, index).trim();
    if (start >= 0 && !(recipientLetter(char) || whitespace || char === '-')) start = -1;
    if (start < 0) {
      start = recipientStart(text, index, government);
      if (start >= 0) index = start - 1;
    }
    index++;
  }
  return null;
}

function extractRecipient(text: string): string {
  return findRecipient(text, true) ?? findRecipient(text, false) ?? 'Unknown';
}

function extractValue(text: string): string | null {
  const m = /\$[\d,.]+\s*(?:million|billion)/i.exec(text);
  return m ? m[0] : null;
}

function extractTransmittal(text: string): string | null {
  const m = /Transmittal\s+(?:No\.?\s*)?(\d{2}-\d+)/i.exec(text);
  return m ? (m[1] ?? null) : null;
}

function detectCategory(text: string, systems: string[]): ArmsTransfer['category'] {
  const t = text.toLowerCase();
  if (t.includes('training') && !hasMajorDefenseSystem(t)) return 'training';
  if (/spare parts|logistics|maintenance|support/.test(t) && !hasMajorDefenseSystem(t)) return 'logistics';
  if (/letter of offer|commercial/.test(t) && !hasMajorDefenseSystem(t)) return 'commercial';
  if (systems.length > 0 || hasMajorDefenseSystem(t)) return 'major-defense';
  return 'general';
}

function detectSeverity(
  category: ArmsTransfer['category'],
  valueEstimate: string | null,
): ArmsTransfer['severity'] {
  if (category !== 'major-defense') return 'low';

  if (valueEstimate) {
 const billions = /\$([\d,.]+)\s*billion/i.exec(valueEstimate);
 if (billions) return 'critical';

 const millions = /\$([\d,.]+)\s*million/i.exec(valueEstimate);
 if (millions) {
 const amount = Number.parseFloat((millions[1] ?? '0').replace(/,/g, ''));
 if (amount >= 100) return 'high';
 }
  }

  return 'medium';
}

interface FederalRegisterDoc {
  title?: string;
  abstract?: string;
  publication_date?: string;
  html_url?: string;
  document_number?: string;
}

function parseFederalRegisterDocs(docs: FederalRegisterDoc[]): ArmsTransfer[] {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

  return docs.flatMap((doc): ArmsTransfer[] => {
 const title = (doc.title ?? '').trim();
 const description = (doc.abstract ?? '').trim();
 const combined = `${title} ${description}`;

 // Relevance filter
 if (!/sale|transfer|transmittal/i.test(combined)) return [];

 const pubDate = doc.publication_date ? new Date(doc.publication_date) : new Date();
 if (Number.isNaN(pubDate.getTime()) || pubDate.getTime() < cutoff) return [];

 const systems = extractSystems(combined);
 const valueEstimate = extractValue(combined);
 const transmittalNumber = extractTransmittal(combined);
 const recipient = extractRecipient(combined);
 const category = detectCategory(combined, systems);
 const severity = detectSeverity(category, valueEstimate);

 return [{
 id: doc.document_number ?? `fr-${pubDate.getTime()}-${title.slice(0, 20)}`,
 title,
 description,
 recipient,
 systems,
 valueEstimate,
 transmittalNumber,
 pubDate,
 url: doc.html_url ?? '',
 source: 'federal-register',
 severity,
 category,
 }];
  });
}

function parseDscaRss(xmlText: string): ArmsTransfer[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');
  if (doc.querySelector('parsererror')) return [];

  const items  = [...doc.querySelectorAll('item')];
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

  return items.flatMap((item): ArmsTransfer[] => {
 const title = stripHtml(item.querySelector('title')?.textContent?.trim() ?? '');
 const description = stripHtml(item.querySelector('description')?.textContent?.trim() ?? '');
 const link = item.querySelector('link')?.textContent?.trim() ?? '';
 const pubDateStr  = item.querySelector('pubDate')?.textContent?.trim() ?? '';
 const combined = `${title} ${description}`;

 if (!/sale|transfer|transmittal/i.test(combined)) return [];

 const pubDate = pubDateStr ? new Date(pubDateStr) : new Date();
 if (Number.isNaN(pubDate.getTime()) || pubDate.getTime() < cutoff) return [];

 const systems = extractSystems(combined);
 const valueEstimate = extractValue(combined);
 const transmittalNumber = extractTransmittal(combined);
 const recipient = extractRecipient(combined);
 const category = detectCategory(combined, systems);
 const severity = detectSeverity(category, valueEstimate);

 return [{
 id: transmittalNumber ? `dsca-${transmittalNumber}` : `dsca-${pubDate.getTime()}-${title.slice(0, 20)}`,
 title,
 description,
 recipient,
 systems,
 valueEstimate,
 transmittalNumber,
 pubDate,
 url: link,
 source: 'dsca',
 severity,
 category,
 }];
  });
}

export async function fetchArmsTransfers(): Promise<ArmsTransfer[]> {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) return _cache.items;

  const [frResult, dscaResult] = await Promise.allSettled([
 fetch(FEDERAL_REGISTER_URL, {
 signal: AbortSignal.timeout(12_000),
 headers: { Accept: 'application/json' },
 }).then(async (res): Promise<ArmsTransfer[]> => {
 if (!res.ok) return [] as ArmsTransfer[];
 return res.json().then((json: { results?: FederalRegisterDoc[] }): ArmsTransfer[] =>
 parseFederalRegisterDocs(json.results ?? []),
 );
 }),
 fetch(proxyFeedUrl(DSCA_RSS_URL), {
 signal: AbortSignal.timeout(12_000),
 headers: { Accept: 'application/rss+xml, application/xml, text/xml, */*' },
 }).then(async (res): Promise<ArmsTransfer[]> => {
 if (!res.ok) return [] as ArmsTransfer[];
 return parseDscaRss(await res.text());
 }),
  ]);

  const all: ArmsTransfer[] = [];
  if (frResult.status === 'fulfilled') all.push(...frResult.value);
  if (dscaResult.status === 'fulfilled') all.push(...dscaResult.value);

  // Deduplicate by transmittal number, then by document id
  const seen = new Set<string>();
  const deduped = all.filter(item => {
 const key = item.transmittalNumber ?? item.id;
 if (seen.has(key)) return false;
 seen.add(key);
 return true;
  });

  // Sort by pubDate desc
  deduped.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());

  const items = deduped.slice(0, 30);
  _cache = { items, ts: Date.now() };
  return items;
}

export function armsTransferSeverityClass(severity: ArmsTransfer['severity']): string {
  switch (severity) {
 case 'critical': { return 'text-red-500';
 }
 case 'high': { return 'text-orange-500';
 }
 case 'medium': { return 'text-yellow-500';
 }
 default: { return 'text-gray-400';
 }
  }
}
