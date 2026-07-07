/**
 * entityRef — de-jargon raw internal IDs in user-facing prose.
 *
 * Panels used to print sentences like
 *   "Confirmation bias: hypothesis sit-v2-mquz61u7-73 has run 15h …"
 * This helper resolves the entity's human title from the situation store
 * and demotes the raw ID to secondary metadata: a muted monospace chip
 * with the full ID in the tooltip and click-to-copy behavior.
 *
 * When no title resolves, the chip shows a shortened tail ("…u7-73")
 * and the full ID stays available via tooltip + copy.
 *
 * All output is escaped here — callers pass RAW (unescaped) prose.
 */

import { escapeHtml } from '@/utils/sanitize';
import { getSituationStoreV2 } from '@/services/intelligence/situation-store-v2';

/** Matches store-generated IDs (sit-v2-<ts36>-<n>, hyp-…, …) in prose. */
const ENTITY_ID_RE = /\b(?:sit|hyp)-[a-z0-9]+(?:-[a-z0-9]+)+\b/giu;

/** Tail shown when no title resolves, e.g. "…u7-73". */
const SHORT_TAIL_CHARS = 5;

/**
 * Resolve a human title for a store ID. Currently backed by the
 * Situation Store v2 (the source of every `sit-v2-…` ID the bias
 * detectors print). Fault-isolated: a store hiccup returns null and the
 * caller falls back to the shortened ID.
 */
export function resolveEntityTitle(id: string): string | null {
  try {
    const match = getSituationStoreV2().list().find((s) => s.id === id);
    const name = match?.name.trim();
    return name && name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

/** Shortened display form of an ID: "…u7-73". */
export function shortEntityId(id: string): string {
  return id.length <= SHORT_TAIL_CHARS ? id : `…${id.slice(-SHORT_TAIL_CHARS)}`;
}

/**
 * Muted monospace ID chip: full ID in the tooltip, click copies it
 * (delegated handler — see installEntityIdCopyHandler). Style lives in
 * main.css (`.cb-entity-id`).
 */
export function entityIdChipHtml(id: string): string {
  const esc = escapeHtml(id);
  return (
    `<button type="button" class="cb-entity-id" data-entity-id="${esc}" ` +
    `title="${esc} — click to copy" aria-label="Copy ID ${esc}">${escapeHtml(shortEntityId(id))}</button>`
  );
}

/** Title (when resolvable) + ID chip, for standalone reference slots. */
export function entityRefHtml(id: string): string {
  const title = resolveEntityTitle(id);
  return title
    ? `${escapeHtml(title)} ${entityIdChipHtml(id)}`
    : entityIdChipHtml(id);
}

/**
 * Escape a raw prose string and replace embedded store IDs with
 * title-plus-chip references. Non-ID text passes through escaped.
 */
export function dejargonProse(raw: string): string {
  let out = '';
  let last = 0;
  // Fresh regex state per call (the shared constant is /g/).
  const re = new RegExp(ENTITY_ID_RE.source, ENTITY_ID_RE.flags);
  for (let m = re.exec(raw); m !== null; m = re.exec(raw)) {
    out += escapeHtml(raw.slice(last, m.index));
    out += entityRefHtml(m[0]);
    last = m.index + m[0].length;
  }
  out += escapeHtml(raw.slice(last));
  return out;
}

let copyHandlerInstalled = false;

/**
 * Install the document-level delegated click handler for `.cb-entity-id`
 * chips (idempotent — call from any panel that renders them). Copies the
 * full ID and flashes "copied" as feedback.
 */
export function installEntityIdCopyHandler(): void {
  if (copyHandlerInstalled || typeof document === 'undefined') return;
  copyHandlerInstalled = true;
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const chip = target?.closest<HTMLElement>('.cb-entity-id');
    if (!chip) return;
    event.stopPropagation();
    const id = chip.dataset.entityId;
    if (!id) return;
    void navigator.clipboard?.writeText(id).then(() => {
      const original = chip.textContent;
      chip.textContent = 'copied';
      chip.classList.add('cb-entity-id--copied');
      setTimeout(() => {
        chip.textContent = original;
        chip.classList.remove('cb-entity-id--copied');
      }, 900);
    }).catch(() => { /* clipboard unavailable — tooltip still shows the ID */ });
  });
}
