/**
 * Sidebar heat owns the alert-backed pane review trail. One projection refresh
 * updates the fixed navigator, mounted pane/sidebar accents, and the three
 * stable CSS promotion slots without changing panel DOM order.
 */

import { AttentionNavigator, applyAttentionDecorations } from '@/components/AttentionNavigator';
import { DEFAULT_PANELS } from '@/config/panels';
import { isAppActive } from '@/services/app-activity';
import { panelForAlert, scoreAlert } from '@/services/alert-routing';
import {
  loadReviewLedger,
  markPanelReviewed,
  persistReviewLedger,
  projectPanelAttention,
  type AttentionSnapshot,
  type EvidenceIdentity,
} from '@/services/panel-attention';
import { unifiedAlertStore } from '@/services/unified-alerts';

const REFRESH_INTERVAL_MS = 30_000;

export interface SidebarHeatController {
  refresh(): void;
  destroy(): void;
}

let activeController: SidebarHeatController | null = null;

function clearLegacyHeat(): void {
  document.querySelectorAll<HTMLElement>('.mac-sidebar-panel-item[data-panel-key]').forEach((item) => {
    item.classList.remove('is-hot', 'heat-critical', 'heat-high', 'heat-medium', 'heat-low');
    item.querySelector('.mac-sidebar-heat-badge')?.remove();
  });
}

function applyPromotions(snapshot: AttentionSnapshot): void {
  const promoted = new Set(snapshot.promotedPanelIds);
  document.querySelectorAll<HTMLElement>('#panelsGrid > [data-panel]').forEach((panel) => {
    panel.style.order = promoted.has(panel.dataset.panel ?? '') ? '-1' : '';
  });
}

function clearPromotions(): void {
  document.querySelectorAll<HTMLElement>('#panelsGrid > [data-panel]').forEach((panel) => {
    panel.style.order = '';
  });
}

export function startSidebarHeat(
  navigatorParent: HTMLElement = document.body,
): SidebarHeatController {
  if (activeController) return activeController;

  let reviewed: EvidenceIdentity[] = loadReviewLedger();
  let snapshot: AttentionSnapshot = { panels: [], severityCounts: {}, promotedPanelIds: [] };
  let destroyed = false;
  const navigator = new AttentionNavigator({
    getPanelName: (panelId) => DEFAULT_PANELS[panelId]?.name ?? panelId,
    onReview: (panelId) => {
      const panel = snapshot.panels.find((candidate) => candidate.panelId === panelId);
      if (!panel) return;
      reviewed = markPanelReviewed(reviewed, panel);
      const activeEvidence = snapshot.panels.flatMap((candidate) => candidate.evidence);
      if (!persistReviewLedger(reviewed, activeEvidence)) {
        navigator.setPersistenceDegraded(true);
      }
      controller.refresh();
      return snapshot.panels.find((candidate) => candidate.unreviewedCount > 0)?.panelId;
    },
  });
  navigator.mount(navigatorParent);

  const controller: SidebarHeatController = {
    refresh(): void {
      if (destroyed) return;
      snapshot = projectPanelAttention(unifiedAlertStore.getAll(), {
        score: scoreAlert,
        route: panelForAlert,
        reviewed,
        incumbents: snapshot.promotedPanelIds,
      });
      clearLegacyHeat();
      navigator.update(snapshot);
      applyAttentionDecorations(snapshot);
      applyPromotions(snapshot);
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      window.clearInterval(intervalId);
      navigator.destroy();
      clearPromotions();
      clearLegacyHeat();
      if (activeController === controller) activeController = null;
    },
  };

  const unsubscribe = unifiedAlertStore.subscribe(() => controller.refresh());
  const intervalId = window.setInterval(() => {
    if (isAppActive()) controller.refresh();
  }, REFRESH_INTERVAL_MS);
  activeController = controller;
  controller.refresh();
  return controller;
}
