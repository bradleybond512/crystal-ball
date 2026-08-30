/**
 * Inline location setter for panels that need a home location.
 *
 * Shows a compact UI with:
 *  - GPS auto-detect button
 *  - Manual lat/lon + label input
 *  - Current location display if already set
 *
 * When set, updates BOTH proximity config (legacy) and saved places (primary),
 * so all panels see the same home location regardless of which system they read.
 */

import type { Panel } from '@/components/Panel';
import {
  loadProximityConfig,
  saveProximityConfig,
  getCurrentGpsLocation,
  reverseGeocode,
} from '@/services/proximity-filter';
import type { UserLocation } from '@/services/proximity-filter';
import { h, replaceChildren } from '@/utils/dom-utils';
import { invokeTauri } from '@/services/tauri-bridge';
import { isDesktopRuntime } from '@/services/runtime';

/**
 * Show an inline "Set your home location" gate inside a panel.
 * If location is already configured, does nothing and returns false.
 * If location is missing, renders the setter UI and returns true.
 */
export function showLocationGate(
  panel: Panel,
  onLocationSet: () => void,
): boolean {
  const config = loadProximityConfig();
  if (config.location) return false; // already configured

  const content = panel.getContentElement();

  const statusEl = h('span', {
 style: 'font-size:11px;color:var(--text-tertiary);min-height:16px;display:block;margin-top:4px;',
  }) as HTMLSpanElement;

  // ── GPS button ──────────────────────────────────────────────────────────
  const gpsBtn = h('button', {
 style: 'background:var(--accent-color);color:#fff;border:none;border-radius:4px;padding:6px 14px;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:6px;',
  }, '\u{1F4CD} Use My Location') as HTMLButtonElement;

  gpsBtn.addEventListener('click', () => {
 gpsBtn.disabled = true;
 gpsBtn.textContent = 'Requesting permission\u2026';
 statusEl.textContent = '';
 statusEl.style.color = 'var(--text-tertiary)';
 void (async () => {
 try {
 gpsBtn.textContent = 'Getting GPS fix\u2026';
 statusEl.textContent = 'Waiting for location (up to 15s)\u2026';
 const loc = await getCurrentGpsLocation();
 statusEl.textContent = `Got ${loc.lat.toFixed(4)}, ${loc.lon.toFixed(4)} \u2014 looking up address\u2026`;
 const label = await reverseGeocode(loc.lat, loc.lon);
 const location: UserLocation = { ...loc, label };
 saveLocation(location);
 // Show confirmation before transitioning
 gpsBtn.textContent = '\u2705 Saved!';
 statusEl.textContent = `Location set to: ${label}`;
 statusEl.style.color = '#22c55e';
 setTimeout(() => onLocationSet(), 800);
 } catch (error) {
 gpsBtn.disabled = false;
 gpsBtn.textContent = '\u{1F4CD} Use My Location';
 const msg = error instanceof Error ? error.message : 'Could not detect location.';
 const isDenied = msg.toLowerCase().includes('permission denied');
 statusEl.textContent = msg;
 statusEl.style.color = '#ef4444';
 if (isDenied && isDesktopRuntime()) {
 const openBtn = h('button', {
 style: 'margin-left:6px;background:var(--accent-color);color:#fff;border:none;border-radius:3px;padding:2px 8px;font-size:10px;cursor:pointer;',
 }, 'Open Location Settings') as HTMLButtonElement;
 openBtn.addEventListener('click', () => {
 void invokeTauri<void>('open_system_prefs_location').catch(() => {
 alert('Couldn\'t open System Settings. Go to System Settings \u2192 Privacy & Security \u2192 Location Services and enable Crystal Ball.');
 });
 });
 statusEl.appendChild(openBtn);
 }
 }
 })();
  });

  // ── Manual entry ────────────────────────────────────────────────────────
  const latInput = h('input', {
 type: 'number',
 placeholder: 'Latitude',
 step: 'any',
 style: 'width:90px;background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border-color);border-radius:4px;padding:4px 6px;font-size:11px;',
  }) as HTMLInputElement;

  const lonInput = h('input', {
 type: 'number',
 placeholder: 'Longitude',
 step: 'any',
 style: 'width:90px;background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border-color);border-radius:4px;padding:4px 6px;font-size:11px;',
  }) as HTMLInputElement;

  const labelInput = h('input', {
 type: 'text',
 placeholder: 'Label (e.g. Home)',
 style: 'width:130px;background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border-color);border-radius:4px;padding:4px 6px;font-size:11px;',
  }) as HTMLInputElement;

  const saveBtn = h('button', {
 style: 'background:var(--accent-color);color:#fff;border:none;border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer;',
  }, 'Save') as HTMLButtonElement;

  saveBtn.addEventListener('click', () => {
 const lat = Number.parseFloat(latInput.value);
 const lon = Number.parseFloat(lonInput.value);
 if (Number.isNaN(lat) || Number.isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
 statusEl.textContent = 'Enter valid coordinates (-90 to 90, -180 to 180)';
 statusEl.style.color = '#ef4444';
 return;
 }
 const label = labelInput.value.trim() || `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
 const location: UserLocation = { lat, lon, label, source: 'manual', setAt: Date.now() };
 saveLocation(location);
 saveBtn.textContent = '\u2705 Saved!';
 statusEl.textContent = `Location set to: ${label}`;
 statusEl.style.color = '#22c55e';
 setTimeout(() => onLocationSet(), 800);
  });

  const manualRow = h('div', {
 style: 'display:flex;gap:4px;align-items:center;flex-wrap:wrap;',
  }, latInput, lonInput, labelInput, saveBtn);

  const divider = h('div', {
 style: 'font-size:10px;color:var(--text-tertiary);text-align:center;padding:4px 0;',
  }, 'or enter coordinates manually');

  const wrapper = h('div', {
 style: 'padding:16px;text-align:center;',
  },
 h('div', { style: 'font-size:28px;margin-bottom:8px;' }, '\u{1F3E0}'),
 h('div', { style: 'font-weight:600;margin-bottom:4px;font-size:13px;color:var(--text-primary);' }, 'Set Your Home Location'),
 h('div', { style: 'font-size:11px;color:var(--text-secondary);margin-bottom:12px;' }, 'This panel needs your location to show nearby data. Your location is shared across all panels.'),
 h('div', { style: 'display:flex;justify-content:center;margin-bottom:4px;' }, gpsBtn),
 divider,
 manualRow,
 statusEl,
  );

  replaceChildren(content, wrapper);
  return true;
}

/**
 * Save location to the proximity config (used by all services).
 * Also dispatches the saved-places event so reactive panels update.
 */
function saveLocation(location: UserLocation): void {
  const config = loadProximityConfig();
  saveProximityConfig({ ...config, location, enabled: true });
  // Dispatch event so other panels can react
  window.dispatchEvent(new CustomEvent('wm:saved-places-changed'));
}

/**
 * Get the current home location label, or null if not set.
 */
export function getHomeLocationLabel(): string | null {
  const config = loadProximityConfig();
  return config.location?.label ?? null;
}

/**
 * Returns an HTML string for a compact "set location" banner.
 * Shows inline GPS button + manual entry. Returns empty string if location is already set.
 * Use this for panels that work without location but benefit from it (e.g. distance display).
 */
export function locationBannerHtml(): string {
  const config = loadProximityConfig();
  if (config.location) return '';
  return `<div class="location-banner" style="padding:6px 10px;background:var(--bg-tertiary);border-radius:4px;margin:8px 12px;display:flex;align-items:center;gap:8px;font-size:11px;color:var(--text-secondary);">
 <span>\u{1F3E0}</span>
 <span>Set your home location for distance data</span>
 <button class="location-banner-gps" style="margin-left:auto;background:var(--accent-color);color:#fff;border:none;border-radius:3px;padding:2px 8px;font-size:10px;cursor:pointer;">Use GPS</button>
  </div>`;
}

/**
 * Wire up click handlers for location banners rendered via locationBannerHtml().
 * Call after setting innerHTML on the panel content element.
 */
export function wireLocationBanner(container: HTMLElement, onSet: () => void): void {
  const btn = container.querySelector('.location-banner-gps') as HTMLButtonElement | null;
  if (!btn) return;
  btn.addEventListener('click', () => {
 btn.disabled = true;
 btn.textContent = 'Getting GPS\u2026';
 void (async () => {
 try {
 const loc = await getCurrentGpsLocation();
 const label = await reverseGeocode(loc.lat, loc.lon);
 saveLocation({ ...loc, label });
 btn.textContent = '\u2705 Saved!';
 btn.style.background = '#22c55e';
 setTimeout(() => onSet(), 800);
 } catch {
 btn.disabled = false;
 btn.textContent = 'Use GPS';
 }
 })();
  });
}
