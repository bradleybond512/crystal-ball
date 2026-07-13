/**
 * Library view-model — groups the panel-metadata registry into the 8
 * Library domains with featured-first ordering and query filtering.
 *
 * Pure deterministic: no DOM, no fetch, no globals.
 */

import type { LibraryDomain, PanelMeta } from '../../config/panel-metadata.ts';

export interface LibraryPanelView {
  panelId: string;
  title: string;
  icon?: string;
  tier: 'library' | 'system';
}

export interface LibraryDomainView {
  domain: LibraryDomain;
  label: string;
  featured: readonly LibraryPanelView[];
  rest: readonly LibraryPanelView[];
  totalCount: number;
}

export interface LibraryView {
  domains: readonly LibraryDomainView[];
  matchCount: number;
}

export interface LibraryInputs {
  metadata: Readonly<Record<string, PanelMeta>>;
  /**
   * DEFAULT_PANELS-shaped name lookup. Also the variant gate: metadata
   * covers every panel across all variants, so a panel with no entry here
   * is not part of the active variant and is excluded entirely.
   */
  names: Readonly<Record<string, { name: string } | undefined>>;
  domainLabels: Readonly<Record<LibraryDomain, string>>;
}

/** Nav-rail order; system-health always last. */
const DOMAIN_ORDER: readonly LibraryDomain[] = [
  'personal-safety',
  'global-intel',
  'markets-economy',
  'hazards-weather',
  'cyber-infrastructure',
  'space-aviation',
  'health-environment',
  'system-health',
];

export function buildLibraryView(inputs: LibraryInputs, query: string): LibraryView {
  const q = query.trim().toLowerCase();
  const byDomain = new Map<LibraryDomain, { featured: LibraryPanelView[]; rest: LibraryPanelView[] }>();
  for (const domain of DOMAIN_ORDER) byDomain.set(domain, { featured: [], rest: [] });

  let matchCount = 0;
  for (const [panelId, meta] of Object.entries(inputs.metadata)) {
    const title = inputs.names[panelId]?.name;
    if (title === undefined) continue;
    if (q && !matches(q, title, panelId, meta)) continue;
    const bucket = byDomain.get(meta.domain);
    if (!bucket) continue;
    matchCount += 1;
    const view: LibraryPanelView = { panelId, title, icon: meta.icon, tier: meta.tier };
    if (meta.featured) bucket.featured.push(view);
    else bucket.rest.push(view);
  }

  const domains = DOMAIN_ORDER.map((domain) => {
    const bucket = byDomain.get(domain)!;
    bucket.featured.sort(byTitle);
    bucket.rest.sort(byTitle);
    return {
      domain,
      label: inputs.domainLabels[domain],
      featured: bucket.featured,
      rest: bucket.rest,
      totalCount: bucket.featured.length + bucket.rest.length,
    };
  });

  return { domains, matchCount };
}

function matches(q: string, title: string, panelId: string, meta: PanelMeta): boolean {
  if (title.toLowerCase().includes(q)) return true;
  if (panelId.includes(q)) return true;
  return meta.tags.some((t) => t.includes(q));
}

function byTitle(a: LibraryPanelView, b: LibraryPanelView): number {
  return a.title.localeCompare(b.title);
}
