/**
 * Alert reactions — multi-pronged response to high-score alerts.
 *
 * Subscribes to unifiedAlertStore, and on genuinely-new high-priority alerts:
 *   - plays a sound (sound-manager handles ghost-mode suppression upstream)
 *   - flashes the window border
 *   - flashes + scrolls the source panel
 * Desktop notifications are already dispatched by notificationDispatcher
 * inside the store's ingest() path, so we don't double-fire here.
 */

import { unifiedAlertStore, type UnifiedAlert } from './unified-alerts';
import { scoreAlert, panelForAlert } from './alert-routing';
import { playAlertPing, playSonarPing } from './sound-manager';
import { isGhostMode } from './mode-manager';

const FLASH_CLASS = 'panel-alert-flash';
const FLASH_MS = 2400;
const BORDER_FLASH_CLASS = 'window-alert-flash';
const REACT_THRESHOLD = 50; // score floor for sound + border flash

function panelEl(panelId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-panel="${panelId}"]`);
}

export function flashPanel(panelId: string): void {
  const el = panelEl(panelId);
  if (!el) return;
  el.classList.remove(FLASH_CLASS);
  // force reflow so the animation restarts if already applied
  void el.offsetWidth;
  el.classList.add(FLASH_CLASS);
  window.setTimeout(() => el.classList.remove(FLASH_CLASS), FLASH_MS);
}

export function jumpToPanel(panelId: string): void {
  const el = panelEl(panelId);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function flashWindowBorder(): void {
  const root = document.body;
  root.classList.remove(BORDER_FLASH_CLASS);
  void root.offsetWidth;
  root.classList.add(BORDER_FLASH_CLASS);
  window.setTimeout(() => root.classList.remove(BORDER_FLASH_CLASS), FLASH_MS);
}

const seen = new Set<string>();
let started = false;

interface PulseTarget { id: string; lat: number; lon: number; severity: UnifiedAlert['severity']; expiresAt: number; }
const pulses: PulseTarget[] = [];
const PULSE_TTL_MS = 60_000;

function publishPulses(): void {
  const now = Date.now();
  for (let i = pulses.length - 1; i >= 0; i--) {
    const p = pulses[i];
    if (p && p.expiresAt <= now) pulses.splice(i, 1);
  }
  document.dispatchEvent(new CustomEvent('cb:alert-pulses', {
    detail: pulses.map(p => ({ id: p.id, lat: p.lat, lon: p.lon, severity: p.severity })),
  }));
}

/** Wire reactions to the unified alert store. Idempotent. */
export function startAlertReactions(): void {
  if (started) return;
  started = true;
  // Seed seen-set with current alerts so we don't re-react to history on boot.
  for (const a of unifiedAlertStore.getAll()) seen.add(a.id);

  unifiedAlertStore.subscribe(() => {
    const now = Date.now();
    const fresh: UnifiedAlert[] = [];
    for (const a of unifiedAlertStore.getAll()) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      fresh.push(a);
    }
    if (fresh.length === 0) return;

    // React to the single highest-scoring fresh alert this tick.
    let top: UnifiedAlert | null = null;
    let topScore = 0;
    for (const a of fresh) {
      const s = scoreAlert(a, now);
      if (s > topScore) { topScore = s; top = a; }
    }
    if (!top || topScore < REACT_THRESHOLD) return;

    const panelId = panelForAlert(top);
    flashPanel(panelId);
    // Add a map pulse for any fresh hot alert that has coordinates.
    for (const a of fresh) {
      if (scoreAlert(a, now) < REACT_THRESHOLD) continue;
      if (!a.location) continue;
      pulses.push({
        id: a.id,
        lat: a.location.lat,
        lon: a.location.lon,
        severity: a.severity,
        expiresAt: now + PULSE_TTL_MS,
      });
    }
    publishPulses();
    // Ghost Mode: visual triage stays, but no audio + no border flash.
    if (!isGhostMode()) {
      flashWindowBorder();
      if (top.severity === 'critical') playAlertPing();
      else playSonarPing();
    }

    // Re-escalation: critical alerts get re-fired after 5 minutes if still unacked.
    if (top.severity === 'critical') {
      window.setTimeout(() => {
        const still = unifiedAlertStore.getAll().find(a => a.id === top.id);
        if (still && !still.acknowledged) {
          flashPanel(panelId);
          if (!isGhostMode()) { flashWindowBorder(); playAlertPing(); }
        }
      }, 5 * 60_000);
    }
  });
}
