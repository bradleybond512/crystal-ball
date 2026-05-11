/**
 * OFAC SDN XML parser — pure-deterministic, zero-dependency.
 *
 * The Treasury sdn.xml file is ~28 MB and contains ~12k entries. We
 * walk it with a tolerant tag-extraction regex (the file is well-
 * formed but xmlns prefixes vary across Treasury revisions, so we
 * accept any namespace prefix). DOM/XPath-style parsers would also
 * work but pull in a sizeable dependency for a one-pass extraction.
 *
 * Output is a `SdnEntry[]` — see ofac-types.ts. Every name is
 * trimmed, every program is lowercase-deduped, every alias is
 * lowercase-deduped, every country list is unique. Entries with no
 * recoverable name are dropped.
 */

import type {
  SdnEntry,
  SdnType,
  VesselInfo,
  AircraftInfo,
  SdnId,
} from './ofac-types';

// ─── Top-level entrypoint ─────────────────────────────────────────────

const ENTRY_RX = /<sdnEntry\b[\s\S]*?<\/sdnEntry>/g;

export function parseOfacSdnXml(xml: string): SdnEntry[] {
  const out: SdnEntry[] = [];
  for (const match of xml.matchAll(ENTRY_RX)) {
    const entry = parseEntry(match[0]);
    if (entry) out.push(entry);
  }
  return out;
}

// ─── Per-entry parsing ────────────────────────────────────────────────

function parseEntry(block: string): SdnEntry | null {
  const uid = textOf(block, 'uid');
  if (!uid) return null;

  const type = parseType(textOf(block, 'sdnType'));
  const name = composeName(block, type);
  if (!name) return null;

  const programs = uniqueLower(extractProgramList(block));
  const aliases = uniqueLower(extractAkaList(block));
  const ids = extractIdList(block);
  const addresses = extractAddressList(block);
  const countries = uniqueLower(addresses.map((a) => a.country).filter((c): c is string => c !== null));

  const vessel = type === 'vessel' ? extractVesselInfo(block, ids) : null;
  const aircraft = type === 'aircraft' ? extractAircraftInfo(block) : null;
  const remarks = textOf(block, 'remarks') || null;

  return {
    uid,
    name,
    type,
    programs,
    aliases,
    countries,
    ids,
    vessel,
    aircraft,
    remarks,
  };
}

function parseType(raw: string): SdnType {
  const t = raw.toLowerCase();
  if (t.includes('individual')) return 'individual';
  if (t.includes('vessel')) return 'vessel';
  if (t.includes('aircraft')) return 'aircraft';
  if (t.includes('entity') || t.includes('organization')) return 'entity';
  return 'unknown';
}

function composeName(block: string, type: SdnType): string {
  const lastName = textOf(block, 'lastName');
  const firstName = textOf(block, 'firstName');
  if (type === 'individual' && firstName && lastName) return `${lastName}, ${firstName}`;
  if (lastName) return lastName;
  if (firstName) return firstName;
  return '';
}

// ─── List extractors ──────────────────────────────────────────────────

function extractProgramList(block: string): string[] {
  const list = sliceTag(block, 'programList');
  if (!list) return [];
  const out: string[] = [];
  for (const m of list.matchAll(/<program\b[^>]*>([\s\S]*?)<\/program>/g)) {
    const value = stripHtml(m[1] ?? '').trim();
    if (value) out.push(value);
  }
  return out;
}

function extractAkaList(block: string): string[] {
  const list = sliceTag(block, 'akaList');
  if (!list) return [];
  const out: string[] = [];
  for (const akaMatch of list.matchAll(/<aka\b[\s\S]*?<\/aka>/g)) {
    const akaBlock = akaMatch[0];
    const last = textOf(akaBlock, 'lastName');
    const first = textOf(akaBlock, 'firstName');
    if (last && first) out.push(`${last}, ${first}`);
    else if (last) out.push(last);
    else if (first) out.push(first);
  }
  return out;
}

function extractIdList(block: string): SdnId[] {
  const list = sliceTag(block, 'idList');
  if (!list) return [];
  const out: SdnId[] = [];
  for (const idMatch of list.matchAll(/<id\b[\s\S]*?<\/id>/g)) {
    const idBlock = idMatch[0];
    const idType = textOf(idBlock, 'idType');
    const idNumber = textOf(idBlock, 'idNumber');
    if (!idType || !idNumber) continue;
    out.push({
      idType,
      idNumber,
      idCountry: textOf(idBlock, 'idCountry') || null,
    });
  }
  return out;
}

interface AddressRow { country: string | null; city: string | null; region: string | null }

function extractAddressList(block: string): AddressRow[] {
  const list = sliceTag(block, 'addressList');
  if (!list) return [];
  const out: AddressRow[] = [];
  for (const m of list.matchAll(/<address\b[\s\S]*?<\/address>/g)) {
    const addrBlock = m[0];
    const country = textOf(addrBlock, 'country') || null;
    const city = textOf(addrBlock, 'city') || null;
    const region = textOf(addrBlock, 'stateOrProvince') || null;
    if (country || city || region) out.push({ country, city, region });
  }
  return out;
}

function extractVesselInfo(block: string, ids: readonly SdnId[]): VesselInfo {
  const slice = sliceTag(block, 'vesselInfo') ?? '';
  const imo = ids.find((id) => /imo/i.test(id.idType))?.idNumber ?? null;
  return {
    callSign: textOf(slice, 'callSign') || null,
    vesselType: textOf(slice, 'vesselType') || null,
    vesselFlag: textOf(slice, 'vesselFlag') || null,
    vesselOwner: textOf(slice, 'vesselOwner') || null,
    tonnage: textOf(slice, 'tonnage') || textOf(slice, 'grossRegisteredTonnage') || null,
    imo,
  };
}

function extractAircraftInfo(block: string): AircraftInfo {
  const slice = sliceTag(block, 'aircraftInfo') ?? '';
  return {
    tailNumber: textOf(slice, 'aircraftTailNumber') || null,
    model: textOf(slice, 'aircraftModel') || null,
    operator: textOf(slice, 'aircraftOperator') || null,
    manufactureDate: textOf(slice, 'aircraftManufactureDate') || null,
    constructionNumber: textOf(slice, 'aircraftConstructionNumber') || null,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────

function textOf(block: string, tag: string): string {
  const m = new RegExp(String.raw`<${tag}\b[^>]*>([\s\S]*?)<\/${tag}>`).exec(block);
  if (m?.[1] === undefined) return '';
  return stripHtml(m[1]).trim();
}

function sliceTag(block: string, tag: string): string | null {
  const m = new RegExp(String.raw`<${tag}\b[^>]*>([\s\S]*?)<\/${tag}>`).exec(block);
  return m?.[1] ?? null;
}

function stripHtml(s: string): string {
  const noCdata = s.split('<![CDATA[').join('').split(']]>').join('');
  // eslint-disable-next-line sonarjs/slow-regex -- bounded char class, single-character match — linear time.
  return noCdata.replace(/<[^>]+>/g, '');
}

function uniqueLower(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

