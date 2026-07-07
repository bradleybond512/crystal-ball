/**
 * statLine — shared value+label stat-pair renderer for panel headers.
 *
 * Replaces unpunctuated stat runs like "0 open 0 total avg resolution 0m"
 * with clearly separated pairs: "0 open · 0 total · avg resolution 0m".
 * Values render in tabular numerals (`.cb-stat-value` in main.css) so
 * refreshing numbers don't jitter the row.
 *
 * Pure HTML-string helper (vanilla TS panels interpolate it into their
 * template literals). All user-supplied text is escaped here — callers
 * pass raw values.
 */

import { escapeHtml } from '@/utils/sanitize';

export interface StatPair {
  /** The number (or short value string) to emphasize. */
  value: string | number;
  /** Muted descriptor, e.g. "open", "runs", "avg resolution". */
  label?: string;
  /** Render the label before the value ("avg resolution 4m"). Default after ("3 open"). */
  labelFirst?: boolean;
  /** Optional CSS color for the value (tokens only, e.g. 'var(--sev-high,#ef4444)'). */
  valueColor?: string;
  /** Optional title attribute for the whole pair (e.g. uncapped count). */
  title?: string;
}

/** One value+label segment. */
function pairHtml(pair: StatPair): string {
  const color = pair.valueColor ? ` style="color:${pair.valueColor};"` : '';
  const value = `<strong class="cb-stat-value"${color}>${escapeHtml(String(pair.value))}</strong>`;
  const label = pair.label === undefined ? '' : escapeHtml(pair.label);
  let body: string;
  if (label.length === 0) {
    body = value;
  } else {
    body = pair.labelFirst ? `${label} ${value}` : `${value} ${label}`;
  }
  const title = pair.title ? ` title="${escapeHtml(pair.title)}"` : '';
  return `<span class="cb-stat-pair"${title}>${body}</span>`;
}

/**
 * Render stat pairs separated by a muted " · " dot. Returns inline
 * content — callers keep their existing flex/row wrapper so panel DOM
 * shape stays unchanged.
 */
export function statLine(pairs: readonly StatPair[]): string {
  const sep = '<span class="cb-stat-sep" aria-hidden="true">·</span>';
  return pairs.map((p) => pairHtml(p)).join(sep);
}
