/**
 * Reads the canonical panel id list straight from src/config/panels.ts so
 * the harness automatically picks up new panels (or notices when one is
 * removed). The variant-aware registries live in the same file; we pull
 * the union across all four variants (full, tech, finance, happy) so the
 * harness audits every id the app ever exposes.
 *
 * NOTE: this file is consumed by the smoke harness, NOT by the running
 * app. It re-implements the variant union by parsing the source so it
 * doesn't accidentally tie itself to the active SITE_VARIANT at test time.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const panelsConfigPath = path.join(projectRoot, 'src', 'config', 'panels.ts');

export interface PanelInventoryEntry {
  /** Panel id (e.g. "shortage-radar"). */
  id: string;
  /** Variants that include this panel. */
  variants: ('full' | 'tech' | 'finance' | 'happy')[];
}

const VARIANT_BLOCKS: Array<{ name: 'full' | 'tech' | 'finance' | 'happy'; marker: string }> = [
  { name: 'full', marker: 'const FULL_PANELS' },
  { name: 'tech', marker: 'const TECH_PANELS' },
  { name: 'finance', marker: 'const FINANCE_PANELS' },
  { name: 'happy', marker: 'const HAPPY_PANELS' },
];

function extractKeysFromBlock(source: string, startIdx: number): string[] {
  const open = source.indexOf('{', startIdx);
  if (open < 0) return [];
  let depth = 0;
  let end = open;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  const block = source.slice(open + 1, end);
  const matcher = /(?:^|[\s,{])(?:'([^']+)'|"([^"]+)"|([a-zA-Z_$][\w-]*))\s*:\s*\{\s*name\s*:/g;
  const ids: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(block)) !== null) {
    ids.push((match[1] ?? match[2] ?? match[3]) as string);
  }
  return ids;
}

export function loadPanelInventory(): PanelInventoryEntry[] {
  const source = readFileSync(panelsConfigPath, 'utf8');
  const byId = new Map<string, Set<'full' | 'tech' | 'finance' | 'happy'>>();
  for (const block of VARIANT_BLOCKS) {
    const idx = source.indexOf(block.marker);
    if (idx < 0) continue;
    for (const id of extractKeysFromBlock(source, idx)) {
      let set = byId.get(id);
      if (!set) {
        set = new Set();
        byId.set(id, set);
      }
      set.add(block.name);
    }
  }
  return [...byId.entries()]
    .map(([id, set]) => ({ id, variants: [...set].sort() as PanelInventoryEntry['variants'] }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
