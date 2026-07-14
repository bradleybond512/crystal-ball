#!/usr/bin/env node
/**
 * generate-panel-metadata.mjs — one-time seeder for the Library metadata
 * registry (Phase 2 of the UI shell re-imagination).
 *
 * Reads FULL_PANELS + PANEL_CATEGORY_MAP out of src/config/panels.ts and
 * icon/keyword seeds out of src/config/commands.ts, then emits
 * src/config/panel-metadata.ts covering every FULL_PANELS key exactly once.
 * Category keys with no FULL_PANELS entry (phantoms) are reported and
 * skipped. The emitted file is HAND-CURATED after seeding — re-running
 * this script overwrites curation; do so only deliberately.
 *
 * Re-seeding OVERWRITES hand-curation — diff against git before committing
 * a re-seed.
 *
 * Output: src/config/panel-metadata.ts
 * Run:    node scripts/generate-panel-metadata.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// GUARD: the emitted registry has been hand-curated since seeding (evidenceFor
// on 88 entries, the 2026-07-14 twelve-domain split, featured picks). This
// script still seeds the ORIGINAL eight domains — re-running it destroys all
// of that. Refuse unless the caller explicitly opts in.
if (!process.argv.includes('--force-overwrite-curation')) {
  console.error(
    '[generate-panel-metadata] REFUSING to run: src/config/panel-metadata.ts is hand-curated\n' +
    '(12-domain split, evidenceFor, featured picks) and this seeder would overwrite it with\n' +
    'the original 8-domain seed. If you really mean to re-seed, pass --force-overwrite-curation\n' +
    'and diff against git before committing.',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Parse panels.ts (regex extraction — the file is data-shaped; a TS import
// would drag in the vite alias graph, so we scrape like check-docs-freshness
// does).
// ---------------------------------------------------------------------------

const panelsSrc = fs.readFileSync(path.join(projectRoot, 'src/config/panels.ts'), 'utf8');

/** Structural anchor lookup — throws with a clear message if panels.ts has drifted. */
function requireIndex(src, marker) {
  const idx = src.indexOf(marker);
  if (idx === -1) {
    throw new Error(
      `[generate-panel-metadata] structural anchor '${marker}' not found in src/config/panels.ts — ` +
        'the file has drifted from what this generator expects; update the generator before re-seeding.',
    );
  }
  return idx;
}

// FULL_PANELS block: from "const FULL_PANELS" to the next top-level "const".
const fullBlock = panelsSrc.slice(
  requireIndex(panelsSrc, 'const FULL_PANELS'),
  requireIndex(panelsSrc, 'const FULL_MAP_LAYERS'),
);
const panelEntry = /(?:'([\w-]+)'|^\s{0,2}([\w$]+)):\s*\{\s*name:\s*'((?:[^'\\]|\\.)*)'/gmu;
const fullPanels = new Map(); // key -> name
for (const m of fullBlock.matchAll(panelEntry)) {
  const key = m[1] ?? m[2];
  fullPanels.set(key, m[3].replace(/\\'/gu, "'"));
}

// Category → keys (full-variant categories only).
const catBlock = panelsSrc.slice(
  requireIndex(panelsSrc, 'PANEL_CATEGORY_MAP'),
  requireIndex(panelsSrc, 'MONITOR_COLORS'),
);
const FULL_VARIANT_CATS = ['core', 'intelligence', 'regionalNews', 'marketsFinance', 'topical', 'dataTracking', 'hazards', 'healthEnv'];

// Category bodies contain no nested braces, and each of the 8 full-variant
// category names appears exactly once as a `name: {` header in
// PANEL_CATEGORY_MAP, so a plain indexOf scan (rather than a regex spanning
// the header and body — which sonarjs's slow-regex heuristic flags) finds
// each block's panelKeys array without changing what gets captured.
const categories = {};
for (const name of FULL_VARIANT_CATS) {
  const headerIdx = catBlock.indexOf(`${name}:`);
  if (headerIdx === -1) continue;
  const braceIdx = catBlock.indexOf('{', headerIdx);
  const bodyEnd = catBlock.indexOf('}', braceIdx);
  const body = catBlock.slice(braceIdx + 1, bodyEnd);
  const panelKeysMatch = body.match(/panelKeys:\s*\[([^\]]*)\]/su);
  if (!panelKeysMatch) continue;
  categories[name] = [...panelKeysMatch[1].matchAll(/'([\w-]+)'/gu)].map((k) => k[1]);
}

// commands.ts icon/keyword seeds.
const commandsSrc = fs.readFileSync(path.join(projectRoot, 'src/config/commands.ts'), 'utf8');
// Each panel command is a single-line object literal — scope the match to
// one line at a time rather than bounding on '{'..'}': icon values often
// use \u{XXXXX} code-point escapes, whose literal '{'/'}' in the source
// text would otherwise truncate a brace-bounded match before the closing
// quote. (A single combined regex with a reluctant run before an optional
// `icon:` group has the same failure mode from a different angle — it
// never backtracks far enough to find it, so icon comes back undefined
// for every entry.)
const seeds = new Map();
for (const line of commandsSrc.split('\n')) {
  const idMatch = line.match(/id:\s*'panel:([\w-]+)'/u);
  if (!idMatch) continue;
  const keywordsMatch = line.match(/keywords:\s*\[([^\]]*)\]/u);
  const iconMatch = line.match(/icon:\s*'([^']*)'/u);
  seeds.set(idMatch[1], {
    keywords: keywordsMatch ? [...keywordsMatch[1].matchAll(/'([^']*)'/gu)].map((k) => k[1].toLowerCase()) : [],
    icon: iconMatch ? iconMatch[1] : undefined,
  });
}

// ---------------------------------------------------------------------------
// Domain assignment: category base + keyword overrides. Order matters —
// first match wins.
// ---------------------------------------------------------------------------

const CATEGORY_TO_DOMAIN = {
  core: 'global-intel',
  intelligence: 'global-intel',
  regionalNews: 'global-intel',
  topical: 'global-intel',
  marketsFinance: 'markets-economy',
  dataTracking: 'cyber-infrastructure',
  hazards: 'hazards-weather',
  healthEnv: 'health-environment',
};

// key-substring → domain overrides (checked against the panel KEY).
const KEY_OVERRIDES = [
  [/space|satellite|orbit|reentry|neo-tracker|aerospace|aviation|air-traffic|faa|spaceflight|launch/u, 'space-aviation'],
  [/cyber|cve|vulners|hibp|phish|urlscan|pulsedive|ioc|stix|dark-web|network|ics-ot|grid|power|internet|infra/u, 'cyber-infrastructure'],
  [/watchlist|saved-places|travel-safety|evacuation|family|offline-maps|comms-plan|local-logistics|personal|resource-inventory|emergency/u, 'personal-safety'],
  [/disease|health|pandemic|air-quality|pollen|water-quality|radiation|humanitarian|food-insecurity|openaq|ecdc/u, 'health-environment'],
  [/market|crypto|econom|finance|debt|fdic|edgar|etf|stablecoin|fuel-price|commodit|trade|supply-chain|shortage/u, 'markets-economy'],
  [/weather|storm|flood|wildfire|fire|earthquake|seismic|volcano|tsunami|cyclone|avalanche|hazmat|gdacs|climate/u, 'hazards-weather'],
];

// Explicit system-tier keys (diagnostics/ops — verified against FULL_PANELS).
const SYSTEM_KEYS = new Set([
  'active-learning', 'ai-governance', 'alert-fatigue-dashboard', 'alert-rules-tuning',
  'alert-trace', 'algo-eval', 'algorithm-diagnostic', 'api-diagnostic', 'backtest',
  'belief-calibration', 'collection-gap', 'comms-health', 'counterfactual-replay',
  'event-store', 'feed-health', 'feed-health-dashboard', 'historical-playback',
  'improvement-scheduler', 'intelligence-quality-debt', 'mission-ledger-bridge',
  'model-governance', 'multi-agent-review', 'operator-mode', 'outcome-ledger',
  'repair-recommendations', 'safety-case', 'scenario-replay', 'self-test',
  'shadow-comparison', 'shadow-mode', 'signal-noise-filter', 'source-confidence',
  'system-diagnostic', 'world-state-comparator',
]);

// Featured seeds per domain — hand-curated starting point; the emitted file
// is the place to refine. Keys not in FULL_PANELS are dropped with a warning.
const FEATURED = {
  'personal-safety': ['watchlist', 'travel-safety', 'evacuation', 'family-tracker', 'offline-maps', 'comms-plan'],
  'global-intel': ['command-center', 'threat-dashboard', 'intel', 'situations', 'global-risk-heatmap', 'strategic-posture'],
  'markets-economy': ['markets', 'economic', 'crypto', 'commodities', 'shortage-radar', 'polymarket'],
  'hazards-weather': ['severe-weather', 'nws-alerts', 'earthquakes', 'wildfire-intel', 'tropical-cyclones', 'flood-monitor'],
  'cyber-infrastructure': ['cyber-threats', 'cve-tracker', 'power-grid', 'internet-disruptions', 'threat-intel-hub', 'ics-ot-dashboard'],
  'space-aviation': ['space-weather', 'air-traffic', 'neo-tracker', 'satellite-intel', 'space-launches', 'aerospace-reentry'],
  'health-environment': ['disease-outbreaks', 'air-quality', 'humanitarian-crisis', 'food-insecurity', 'water-quality', 'radiation-decay'],
  'system-health': ['system-diagnostic', 'command-center', 'feed-health', 'algorithm-diagnostic', 'source-confidence', 'self-test'],
};

function assignDomain(key, cats) {
  if (SYSTEM_KEYS.has(key)) return 'system-health';
  for (const [re, domain] of KEY_OVERRIDES) if (re.test(key)) return domain;
  for (const cat of cats) {
    const d = CATEGORY_TO_DOMAIN[cat];
    if (d) return d;
  }
  return 'global-intel';
}

function tagsFor(key, name) {
  const seed = seeds.get(key)?.keywords ?? [];
  const words = new Set([
    ...key.split('-'),
    ...name.toLowerCase().split(/[^a-z0-9]+/u),
    ...seed,
  ]);
  words.delete('');
  words.delete('panel');
  return [...words].sort();
}

/** Single-quoted TS string literal for a tag value. */
function quoteTag(t) {
  return "'" + t.replace(/'/gu, String.raw`\'`) + "'";
}

// ---------------------------------------------------------------------------
// Build + emit
// ---------------------------------------------------------------------------

const keyToCats = new Map();
for (const cat of FULL_VARIANT_CATS) {
  for (const k of categories[cat] ?? []) {
    if (!keyToCats.has(k)) keyToCats.set(k, []);
    keyToCats.get(k).push(cat);
  }
}

const phantoms = [...keyToCats.keys()].filter((k) => !fullPanels.has(k));
if (phantoms.length > 0) {
  console.warn(`[generate-panel-metadata] ${phantoms.length} category keys have no FULL_PANELS entry (skipped):`);
  console.warn('  ' + phantoms.join(', '));
}

const featuredByKey = new Map();
for (const [domain, keys] of Object.entries(FEATURED)) {
  for (const k of keys) {
    if (!fullPanels.has(k)) {
      console.warn(`[generate-panel-metadata] featured key '${k}' (${domain}) not in FULL_PANELS — dropped`);
      continue;
    }
    featuredByKey.set(k, domain);
  }
}

const lines = [];
for (const [key, name] of [...fullPanels.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const cats = keyToCats.get(key) ?? [];
  const domain = assignDomain(key, cats);
  const tier = SYSTEM_KEYS.has(key) ? 'system' : 'library';
  const featured = featuredByKey.get(key) === domain;
  const icon = seeds.get(key)?.icon;
  const tags = tagsFor(key, name);
  const parts = [
    `domain: '${domain}'`,
    'tags: [' + tags.map((t) => quoteTag(t)).join(', ') + ']',
    `tier: '${tier}'`,
  ];
  if (featured) parts.push('featured: true');
  if (icon) parts.push(`icon: '${icon}'`);
  lines.push(`  '${key}': { ${parts.join(', ')} },`);
}

const out = `// GENERATED by scripts/generate-panel-metadata.mjs — seeded once,
// HAND-CURATED since; edit freely. Re-running the script OVERWRITES curation.
// Validation: src/config/__tests__/panel-metadata.test.mts

export type LibraryDomain =
  | 'personal-safety'
  | 'global-intel'
  | 'markets-economy'
  | 'hazards-weather'
  | 'cyber-infrastructure'
  | 'space-aviation'
  | 'health-environment'
  | 'system-health';

export interface PanelMeta {
  domain: LibraryDomain;
  /** Extra ⌘K search terms beyond the panel name. Lowercase. */
  tags: readonly string[];
  /** 'system' panels are excluded from Library front pages and deprioritized in ⌘K. */
  tier: 'library' | 'system';
  /** Shown on the domain's curated front page. */
  featured?: boolean;
  /** Emoji glyph for Library cards and ⌘K rows. */
  icon?: string;
  /** Flags a near-duplicate of another panel; never auto-merged. */
  aliasOf?: string;
}

export const LIBRARY_DOMAIN_LABELS: Record<LibraryDomain, string> = {
  'personal-safety': 'Personal Safety',
  'global-intel': 'Global Intel',
  'markets-economy': 'Markets & Economy',
  'hazards-weather': 'Hazards & Weather',
  'cyber-infrastructure': 'Cyber & Infrastructure',
  'space-aviation': 'Space & Aviation',
  'health-environment': 'Health & Environment',
  'system-health': 'System Health',
};

export const PANEL_METADATA: Record<string, PanelMeta> = {
${lines.join('\n')}
};
`;

if (fullPanels.size < 350) {
  throw new Error(
    `[generate-panel-metadata] parsed only ${fullPanels.size} FULL_PANELS entries (expected >= 350) — ` +
      'the panelEntry regex likely stopped matching against a changed panels.ts shape; refusing to write a truncated registry.',
  );
}

fs.writeFileSync(path.join(projectRoot, 'src/config/panel-metadata.ts'), out);
console.log(`[generate-panel-metadata] wrote ${fullPanels.size} entries (${phantoms.length} phantoms skipped)`);
