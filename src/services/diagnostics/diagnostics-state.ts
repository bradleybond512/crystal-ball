/**
 * Diagnostics state singleton wiring.
 *
 * Glues the pure-deterministic registries (panel-health,
 * feature-health, notification-trace, diagnostic-events,
 * sentinel-feed-audit) into one place the UI can read from. The
 * registries themselves stay decoupled — this module just hands out
 * the same instance to every consumer.
 *
 * No fetch, no DOM. Safe to import from any panel.
 */

import { createPanelHealthRegistry, type PanelHealthRegistry } from './panel-health-registry';
import {
  createFeatureHealthRegistry,
  defaultFeatureCatalog,
  type FeatureHealthRegistry,
} from './feature-health-registry';
import {
  createNotificationTraceRegistry,
  type NotificationTraceRegistry,
} from './notification-trace';
import {
  getDefaultDiagnosticBus,
  type DiagnosticEventBus,
} from './diagnostic-events';
import {
  defaultFeedSentinels,
  type FeedSentinel,
} from './sentinel-feed-audit';

let panels: PanelHealthRegistry | undefined;
let features: FeatureHealthRegistry | undefined;
let notifications: NotificationTraceRegistry | undefined;
let sentinels: FeedSentinel[] | undefined;

export function getPanelHealthRegistry(): PanelHealthRegistry {
  panels ??= createPanelHealthRegistry();
  return panels;
}

export function getFeatureHealthRegistry(): FeatureHealthRegistry {
  if (features === undefined) {
    const reg = createFeatureHealthRegistry();
    for (const def of defaultFeatureCatalog()) {
      reg.register(def);
    }
    features = reg;
  }
  return features;
}

export function getNotificationTraceRegistry(): NotificationTraceRegistry {
  notifications ??= createNotificationTraceRegistry();
  return notifications;
}

export function getDiagnosticEventBus(): DiagnosticEventBus {
  return getDefaultDiagnosticBus();
}

export function getFeedSentinels(): readonly FeedSentinel[] {
  sentinels ??= defaultFeedSentinels();
  return sentinels;
}

/** Reset singletons. Tests + storybook only. */
export function resetDiagnosticsState(): void {
  panels = undefined;
  features = undefined;
  notifications = undefined;
  sentinels = undefined;
}
