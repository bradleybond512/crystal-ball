/**
 * Maps WelcomeFlow's human interest labels to operator-model interest terms.
 * Pure + DOM-free so the mapping can be unit-tested without a browser.
 */

const INTEREST_TERM_MAP: Record<string, string[]> = {
  Geopolitical: ['geopolitical', 'conflict', 'diplomacy'],
  Weather: ['weather', 'storm', 'climate'],
  Cyber: ['cyber', 'breach', 'malware'],
  Markets: ['markets', 'finance', 'economy'],
  Infrastructure: ['infrastructure', 'grid', 'outage'],
  Military: ['military', 'defense', 'conflict'],
  Health: ['health', 'outbreak', 'disease'],
  Space: ['space', 'satellite', 'launch'],
};

/** Deduped operator-model terms for a set of WelcomeFlow interest labels. */
export function mapInterestsToTerms(interests: string[]): string[] {
  const seen = new Set<string>();
  for (const label of interests) {
    const terms = INTEREST_TERM_MAP[label] ?? [label.toLowerCase()];
    for (const term of terms) seen.add(term);
  }
  return [...seen];
}
