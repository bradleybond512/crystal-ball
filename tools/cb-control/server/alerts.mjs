import { watch, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const ALERTS_PATH = join(homedir(), '.crystal-ball', 'sentinel', 'alerts.json');

export function createAlertProducer(broadcastFn) {
  const subscriptions = new Map();
  let lastAlertCount = 0;

  const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

  function subscribe(sessionId, filter = {}) {
    subscriptions.set(sessionId, { filter, subscribedAt: new Date().toISOString() });
    return { ok: true, sessionId, filter };
  }

  function unsubscribe(sessionId) {
    subscriptions.delete(sessionId);
    return { ok: true };
  }

  function getSubscriptions() {
    return [...subscriptions.entries()].map(([id, sub]) => ({ sessionId: id, ...sub }));
  }

  function matchesFilter(alert, filter) {
    if (filter.domains && !filter.domains.includes(alert.domain)) return false;
    if (filter.severity) {
      const minSev = SEVERITY_ORDER[filter.severity] ?? 3;
      const alertSev = SEVERITY_ORDER[alert.severity] ?? 3;
      if (alertSev > minSev) return false;
    }
    return true;
  }

  function checkForNewAlerts() {
    let alerts;
    try {
      const raw = readFileSync(ALERTS_PATH, 'utf8');
      alerts = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(alerts) || alerts.length <= lastAlertCount) {
      lastAlertCount = alerts?.length || 0;
      return;
    }
    const newAlerts = alerts.slice(lastAlertCount);
    lastAlertCount = alerts.length;

    for (const alert of newAlerts) {
      for (const [sessionId, { filter }] of subscriptions) {
        if (matchesFilter(alert, filter)) {
          const line = `[CB-ALERT] severity=${alert.severity} domain=${alert.domain} | ${alert.summary}`;
          broadcastFn(sessionId, line);
        }
      }
    }
  }

  let watcher;
  function startWatching() {
    try {
      watcher = watch(ALERTS_PATH, { persistent: false }, () => checkForNewAlerts());
    } catch {
      setTimeout(startWatching, 60000);
    }
  }

  function stop() {
    if (watcher) watcher.close();
  }

  startWatching();

  return { subscribe, unsubscribe, getSubscriptions, stop };
}
