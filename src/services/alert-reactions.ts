/* eslint-disable sonarjs/void-use, sonarjs/cognitive-complexity */
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
import { getChannels } from './alerting-prefs';
import { logEvent } from './alert-debug';

const FLASH_CLASS = 'panel-alert-flash';
const FLASH_MS = 2400;
const BORDER_FLASH_CLASS = 'window-alert-flash';
const REACT_THRESHOLD = 50; // score floor for sound + border flash

function panelEl(panelId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-panel="${panelId}"]`);
}

function shellActive(): boolean {
  return document.body.classList.contains('home-shell-active');
}

export function flashPanel(panelId: string): void {
  // Under the Home Shell the classic grid is content-visibility: hidden —
  // flashing it is invisible, and jumpToPanel already routes the panel into
  // the focus view, which IS the visual feedback.
  if (shellActive()) return;
  const el = panelEl(panelId);
  if (!el) return;
  el.classList.remove(FLASH_CLASS);
  // force reflow so the animation restarts if already applied
  void el.offsetWidth;
  el.classList.add(FLASH_CLASS);
  window.setTimeout(() => el.classList.remove(FLASH_CLASS), FLASH_MS);
}

export function jumpToPanel(panelId: string): void {
  if (shellActive()) {
    // Scrolling the hidden grid is a silent no-op. Route through the shell:
    // it opens the panel in the focus view, or falls back to classic
    // navigation itself when the panel can't be hosted.
    document.dispatchEvent(new CustomEvent('cb:open-panel', { detail: { panelKey: panelId } }));
    return;
  }
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

/** Add a one-shot pulse on the map for a specific alert (e.g. user click). */
export function pulseAlertOnMap(alert: UnifiedAlert): void {
  if (!alert.location) return;
  pulses.push({
    id: alert.id,
    lat: alert.location.lat,
    lon: alert.location.lon,
    severity: alert.severity,
    expiresAt: Date.now() + PULSE_TTL_MS,
  });
  publishPulses();
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
    for (const a of fresh) {
      logEvent({ kind: 'ingest', alertId: a.id, source: a.source, severity: a.severity, score: scoreAlert(a, now) });
    }
    if (!top || topScore < REACT_THRESHOLD) return;
    logEvent({ kind: 'react', alertId: top.id, source: top.source, severity: top.severity, score: topScore });

    const panelId = panelForAlert(top);
    // Ghost Mode forces silent regardless of preset.
    const ch = isGhostMode() ? { sound: false, borderFlash: false, desktopNotif: false, mapPulse: true, panelFlash: true } : getChannels();

    if (ch.panelFlash) flashPanel(panelId);

    // Add a map pulse for any fresh hot alert that has coordinates.
    if (ch.mapPulse) {
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
    }

    if (ch.borderFlash) flashWindowBorder();
    if (ch.sound) {
      if (top.severity === 'critical') playAlertPing();
      else playSonarPing();
    }

    // Re-escalation: critical alerts get re-fired after 5 minutes if still unacked.
    if (top.severity === 'critical') {
      window.setTimeout(() => {
        const still = unifiedAlertStore.getAll().find(a => a.id === top.id);
        if (still && !still.acknowledged) {
          const ch2 = isGhostMode() ? { sound: false, borderFlash: false } : getChannels();
          if (ch.panelFlash) flashPanel(panelId);
          if (ch2.borderFlash) flashWindowBorder();
          if (ch2.sound) playAlertPing();
        }
      }, 5 * 60_000);
    }
  });
}
