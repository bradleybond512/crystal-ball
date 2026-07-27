/** Shared normalizer converging the episode-entity and situation-entityId
 *  vocabularies (they evolved independently; see the PR 14 contradiction
 *  bridge in cognition/episodic-memory.ts). */
export function slugifyEntity(raw: string): string {
  return raw
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    // Collapsing runs of non-alphanumerics first guarantees at most a single
    // leading/trailing '-' below, so the boundary trim can stay unquantified
    // (avoids the anchored-quantifier-alternation shape sonarjs/slow-regex flags).
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const COUNTRY_ISO3_BY_SLUG: Readonly<Record<string, string>> = {
  afghanistan: 'afg',
  australia: 'aus',
  bahrain: 'bhr',
  belarus: 'blr',
  brazil: 'bra',
  'burkina-faso': 'bfa',
  burma: 'mmr',
  canada: 'can',
  china: 'chn',
  cuba: 'cub',
  'democratic-republic-of-congo': 'cod',
  'democratic-republic-of-the-congo': 'cod',
  egypt: 'egy',
  ethiopia: 'eth',
  france: 'fra',
  germany: 'deu',
  haiti: 'hti',
  india: 'ind',
  iran: 'irn',
  iraq: 'irq',
  israel: 'isr',
  japan: 'jpn',
  jordan: 'jor',
  kuwait: 'kwt',
  lebanon: 'lbn',
  libya: 'lby',
  mali: 'mli',
  mexico: 'mex',
  myanmar: 'mmr',
  niger: 'ner',
  nigeria: 'nga',
  'north-korea': 'prk',
  oman: 'omn',
  pakistan: 'pak',
  palestine: 'pse',
  poland: 'pol',
  qatar: 'qat',
  russia: 'rus',
  'saudi-arabia': 'sau',
  somalia: 'som',
  'south-africa': 'zaf',
  'south-korea': 'kor',
  sudan: 'sdn',
  syria: 'syr',
  taiwan: 'twn',
  turkey: 'tur',
  uk: 'gbr',
  ukraine: 'ukr',
  uae: 'are',
  'united-arab-emirates': 'are',
  'united-kingdom': 'gbr',
  'united-states': 'usa',
  usa: 'usa',
  venezuela: 'ven',
  yemen: 'yem',
};

const COUNTRY_ISO3_SLUGS = new Set(Object.values(COUNTRY_ISO3_BY_SLUG));

export function countryIso3Slug(raw: string): string | undefined {
  const slug = slugifyEntity(raw);
  if (!slug) return undefined;
  return COUNTRY_ISO3_BY_SLUG[slug]
    ?? (COUNTRY_ISO3_SLUGS.has(slug) ? slug : undefined);
}

export function countryEntitySlugs(raw: string): string[] {
  const slug = slugifyEntity(raw);
  if (!slug) return [];
  const iso3 = countryIso3Slug(slug);
  return iso3 && iso3 !== slug ? [slug, iso3] : [slug];
}
