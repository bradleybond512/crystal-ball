// src-tauri/sidecar/who-promed-cross-reference.mjs
//
// Cross-references WHO Disease Outbreak News items against ProMED-mail alerts.
// A WHO item is considered cross-referenced when at least one ProMED alert
// matches on disease (case-insensitive substring), country (case-insensitive
// substring), and pubDate within ±14 days of WHO PublicationDate.
/* eslint-disable sonarjs/slow-regex -- bounded inputs (RSS titles + WHO DON titles ≤ 200 chars); same parser pattern as sibling sidecar feeds */

const WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

const KNOWN_DISEASES = [
  'avian influenza',
  'yellow fever',
  'rift valley',
  'mpox', 'monkeypox', 'ebola', 'cholera', 'dengue', 'measles', 'covid',
  'influenza', 'marburg', 'lassa', 'nipah', 'hantavirus', 'plague',
  'tuberculosis', 'polio', 'rabies', 'meningitis',
];

function safeDate(value) {
  if (value == null) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

function extractDiseaseToken(text) {
  const t = String(text ?? '').toLowerCase();
  for (const disease of KNOWN_DISEASES) {
    if (t.includes(disease)) return disease;
  }
  return '';
}

function extractCountryToken(text) {
  const t = String(text ?? '');
  const dashSplit = t.split(/\s+[-–—]\s+/);
  if (dashSplit.length >= 2) {
    return dashSplit[dashSplit.length - 1].replace(/\(.*\)\s*$/, '').trim();
  }
  const parenMatch = t.match(/\(([^)]+)\)\s*$/);
  if (parenMatch?.[1]) return parenMatch[1].trim();
  return '';
}

function whoDonId(item) {
  return item?.id ?? item?.Title ?? item?.title ?? '';
}

function whoDonDisease(item) {
  return extractDiseaseToken(item?.Title ?? item?.title ?? '');
}

function whoDonCountry(item) {
  return extractCountryToken(item?.Title ?? item?.title ?? '');
}

function whoDonDate(item) {
  return safeDate(item?.PublicationDate ?? item?.publicationDate ?? item?.date);
}

function promedDisease(alert) {
  const explicit = String(alert?.disease ?? '').toLowerCase();
  if (explicit) {
    for (const disease of KNOWN_DISEASES) {
      if (explicit.includes(disease)) return disease;
    }
  }
  return extractDiseaseToken(alert?.title ?? '');
}

function promedCountry(alert) {
  const explicit = String(alert?.country ?? '').trim();
  if (explicit && explicit !== 'Unknown') return explicit;
  return extractCountryToken(alert?.title ?? '');
}

function promedDate(alert) {
  return safeDate(alert?.pubDate);
}

function countryMatches(whoCountry, promedCountryValue) {
  if (!whoCountry || !promedCountryValue) return false;
  const a = whoCountry.toLowerCase();
  const b = promedCountryValue.toLowerCase();
  return a.includes(b) || b.includes(a);
}

function promedRecordIsValid(p) {
  return Boolean(p.id && p.date && p.disease && p.country);
}

function promedRecordMatches(p, who) {
  if (p.disease !== who.disease) return false;
  if (!countryMatches(who.country, p.country)) return false;
  return Math.abs(p.date.getTime() - who.date.getTime()) <= WINDOW_MS;
}

function findMatchingPromedIds(whoCriteria, promedIndex) {
  const matches = [];
  for (const p of promedIndex) {
    if (!promedRecordIsValid(p)) continue;
    if (promedRecordMatches(p, whoCriteria)) matches.push(p.id);
  }
  return matches;
}

export function crossReferenceWhoDonWithProMed(whoDonItems, promedAlerts) {
  if (!Array.isArray(whoDonItems) || whoDonItems.length === 0) return [];
  if (!Array.isArray(promedAlerts) || promedAlerts.length === 0) return [];

  const promedIndex = promedAlerts.map((alert) => ({
    id: alert?.id ?? '',
    disease: promedDisease(alert),
    country: promedCountry(alert),
    date: promedDate(alert),
  }));

  const out = [];
  for (const who of whoDonItems) {
    const whoCriteria = {
      date: whoDonDate(who),
      disease: whoDonDisease(who),
      country: whoDonCountry(who),
    };
    if (!whoCriteria.date || !whoCriteria.disease || !whoCriteria.country) continue;
    const matches = findMatchingPromedIds(whoCriteria, promedIndex);
    if (matches.length > 0) {
      out.push({ whoDonId: whoDonId(who), promedIds: matches });
    }
  }
  return out;
}
