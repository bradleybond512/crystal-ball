/**
 * Sidebar heat — auto-promote panels with hot unacked alerts.
 *
 * Subscribes to the unified store and:
 *   - Adds a `.is-hot` class + count badge to sidebar items whose panel
 *     currently has scoring alerts.
 *   - Bumps the matching panel grid tile to the front via CSS `order`.
 */

import { unifiedAlertStore } from './unified-alerts';
import { panelHeatMap, panelForAlert, scoreAlert } from './alert-routing';
import { isAppActive } from '@/services/app-activity';

const HEAT_BADGE_CLASS = 'mac-sidebar-heat-badge';

function countByPanel(): Map<string, number> {
  const counts = new Map<string, number>();
  const now = Date.now();
  for (const a of unifiedAlertStore.getAll()) {
    if (scoreAlert(a, now) <= 0) continue;
    const pid = panelForAlert(a);
    counts.set(pid, (counts.get(pid) ?? 0) + 1);
  }
  return counts;
}

const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
function maxSeverityByPanel(): Map<string, string> {
  const out = new Map<string, string>();
  const now = Date.now();
  for (const a of unifiedAlertStore.getAll()) {
    if (a.acknowledged) continue;
    if (scoreAlert(a, now) <= 0) continue;
    const pid = panelForAlert(a);
    const cur = out.get(pid);
    if (!cur || (SEV_RANK[a.severity] ?? 0) > (SEV_RANK[cur] ?? 0)) out.set(pid, a.severity);
  }
  return out;
}

function applyHeat(): void {
  const heat = panelHeatMap(unifiedAlertStore.getAll());
  const counts = countByPanel();
  const maxSev = maxSeverityByPanel();

  // Sidebar items
  document.querySelectorAll<HTMLElement>('.mac-sidebar-panel-item[data-panel-key]').forEach(item => {
    const key = item.dataset.panelKey!;
    const score = heat.get(key) ?? 0;
    const count = counts.get(key) ?? 0;
    const sev = maxSev.get(key);
    item.classList.toggle('is-hot', score > 0);
    item.classList.remove('heat-critical', 'heat-high', 'heat-medium', 'heat-low');
    if (sev) item.classList.add(`heat-${sev}`);
    let badge = item.querySelector<HTMLElement>(`.${HEAT_BADGE_CLASS}`);
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = HEAT_BADGE_CLASS;
        item.append(badge);
      }
      badge.textContent = String(count);
      if (sev) badge.dataset.sev = sev;
    } else if (badge) {
      badge.remove();
    }
  });

  // Panel grid tile order
  document.querySelectorAll<HTMLElement>('#panelsGrid [data-panel]').forEach(tile => {
    const key = tile.dataset.panel!;
    const score = heat.get(key) ?? 0;
    if (score >= 100) tile.style.order = '-2';
    else if (score >= 30) tile.style.order = '-1';
    else tile.style.order = '';
  });
}

let started = false;
export function startSidebarHeat(): void {
  if (started) return;
  started = true;
  unifiedAlertStore.subscribe(applyHeat);
  // Periodic refresh so recency decay updates the heat even without ingest events.
  window.setInterval(() => { if (isAppActive()) applyHeat(); }, 30_000);
  applyHeat();
}
