/**
 * Inline SVG icon set for control glyphs.
 *
 * Replaces emoji used as button/menu glyphs (👻 🌍 📍 📡 …) so controls render
 * with an SF-Symbols-like monochrome line weight in every theme instead of
 * platform-dependent color emoji. All icons are 16×16 viewBox, stroke =
 * currentColor at 1.5, round caps/joins.
 *
 * Scope: interactive controls only. Emoji used as data/content (severity
 * glyphs inside feed rows, map popups, etc.) intentionally stay emoji.
 */

import { escapeHtml } from '@/utils/sanitize';

export type IconName =
  | 'bell'
  | 'bell-slash'
  | 'eye'
  | 'ghost'
  | 'globe'
  | 'pin'
  | 'antenna'
  | 'alert-triangle'
  | 'pencil'
  | 'clipboard'
  | 'magnifier';

const PATHS: Record<IconName, string> = {
  bell:
    '<path d="M8 2a4.2 4.2 0 0 0-4.2 4.2v2.6L2.5 11.2h11L12.2 8.8V6.2A4.2 4.2 0 0 0 8 2z"/>' +
    '<path d="M6.6 13.2a1.5 1.5 0 0 0 2.8 0"/>',
  'bell-slash':
    '<path d="M8 2a4.2 4.2 0 0 0-4.2 4.2v2.6L2.5 11.2h11L12.2 8.8V6.2A4.2 4.2 0 0 0 8 2z"/>' +
    '<path d="M6.6 13.2a1.5 1.5 0 0 0 2.8 0"/>' +
    '<path d="M2.5 2.5l11 11"/>',
  eye:
    '<path d="M1.8 8s2.2-4.2 6.2-4.2S14.2 8 14.2 8s-2.2 4.2-6.2 4.2S1.8 8 1.8 8z"/>' +
    '<circle cx="8" cy="8" r="1.9"/>',
  ghost:
    '<path d="M8 1.8a4.9 4.9 0 0 0-4.9 4.9v7l1.9-1.5 1.5 1.5L8 12.2l1.5 1.5 1.5-1.5 1.9 1.5v-7A4.9 4.9 0 0 0 8 1.8z"/>' +
    '<circle cx="6.2" cy="6.9" r="0.9" fill="currentColor" stroke="none"/>' +
    '<circle cx="9.8" cy="6.9" r="0.9" fill="currentColor" stroke="none"/>',
  globe:
    '<circle cx="8" cy="8" r="6.2"/>' +
    '<ellipse cx="8" cy="8" rx="2.7" ry="6.2"/>' +
    '<path d="M1.8 8h12.4"/>',
  pin:
    '<path d="M8 14.4S3.4 10.3 3.4 7.1a4.6 4.6 0 0 1 9.2 0c0 3.2-4.6 7.3-4.6 7.3z"/>' +
    '<circle cx="8" cy="7.1" r="1.7"/>',
  antenna:
    '<circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none"/>' +
    '<path d="M5.3 10.7A3.8 3.8 0 0 1 5.3 5.3"/>' +
    '<path d="M10.7 5.3a3.8 3.8 0 0 1 0 5.4"/>' +
    '<path d="M3.4 12.6A6.5 6.5 0 0 1 3.4 3.4"/>' +
    '<path d="M12.6 3.4a6.5 6.5 0 0 1 0 9.2"/>',
  'alert-triangle':
    '<path d="M8 2.2 1.7 13h12.6L8 2.2z"/>' +
    '<path d="M8 6.4v3.2"/>' +
    '<circle cx="8" cy="11.4" r="0.7" fill="currentColor" stroke="none"/>',
  pencil:
    '<path d="M11.2 2.2l2.6 2.6-8.2 8.2-3.1.5.5-3.1 8.2-8.2z"/>' +
    '<path d="M9.6 3.8l2.6 2.6"/>',
  clipboard:
    '<rect x="3.4" y="2.6" width="9.2" height="11.6" rx="1.5"/>' +
    '<rect x="5.6" y="1.2" width="4.8" height="2.8" rx="0.9"/>',
  magnifier:
    '<circle cx="7.2" cy="7.2" r="4.4"/>' +
    '<path d="M10.4 10.4 14 14"/>',
};

export interface IconOptions {
  /** Rendered width/height in px (viewBox stays 16). Default 16. */
  size?: number;
  /** Accessible name. Omit for purely decorative icons (aria-hidden). */
  label?: string;
}

/**
 * Returns an inline-SVG HTML string for the named icon. Decorative by
 * default (aria-hidden); pass `label` when the icon is the only content of
 * a control.
 */
export function icon(name: IconName, options: IconOptions = {}): string {
  const size = options.size ?? 16;
  const a11y = options.label
    ? `role="img" aria-label="${escapeHtml(options.label)}"`
    : 'aria-hidden="true"';
  return (
    `<svg class="cb-icon cb-icon-${name}" width="${size}" height="${size}" viewBox="0 0 16 16" ` +
    `fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" ` +
    `stroke-linejoin="round" focusable="false" ${a11y}>${PATHS[name]}</svg>`
  );
}
