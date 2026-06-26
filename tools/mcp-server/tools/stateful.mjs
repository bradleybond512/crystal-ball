import { z } from 'zod';
import { unlinkSync } from 'node:fs';

const TYPE_ROUTES = {
  ip:       { route: '/api/greynoise-lookup', param: 'ip', statusPath: 'classification' },
  cve:      { route: '/api/vulners-search',   param: 'query' },
  ticker:   { route: '/api/market-quotes',    param: 'symbols' },
  vessel:   { route: '/api/ais-snapshot',     param: 'mmsi' },
  callsign: { route: '/api/adsb-military',   param: 'callsign' },
  region:   { route: '/api/acled-events',     param: 'country' },
};

const METRIC_ROUTES = {
  markets:   '/api/market-quotes',
  conflicts: '/api/acled-events',
  cyber:     '/api/vulners-search',
};

function makeResponse(summary, data, sources = [], warnings = []) {
  return { summary, data, sources, warnings, timestamp: new Date().toISOString(), healthy: true };
}

function extractMetricValue(domain, metric, data) {
  if (domain === 'markets') {
    const match = metric.match(/^(.+)_price$/);
    if (match && data?.quotes) {
      const sym = match[1].toUpperCase();
      const q = data.quotes.find(q => q.symbol === sym);
      return q?.price ?? null;
    }
  }
  if (domain === 'conflicts' && metric === 'event_count') {
    return data?.events?.length ?? null;
  }
  if (domain === 'cyber') {
    if (metric === 'ioc_count') return data?.iocs?.length ?? null;
    if (metric === 'kev_count') return data?.kevs?.length ?? null;
  }
  return null;
}

function applyOperator(operator, current, threshold) {
  switch (operator) {
    case 'gt':       return current > threshold;
    case 'lt':       return current < threshold;
    case 'gte':      return current >= threshold;
    case 'lte':      return current <= threshold;
    case 'eq':       return current === threshold;
    case 'ne':       return current !== threshold;
    case 'contains': return String(current).includes(String(threshold));
    default:         return false;
  }
}

export function makeStatefulTools(client, storage) {
  const WL_DIR = 'watchlists';
  const RULES_FILE = `${WL_DIR}/_rules.json`;

  // Reject names that contain a path separator or other filesystem metacharacter
  // before building a path from caller input (storage.resolve is the backstop,
  // but this gives a clean error instead of a thrown sandbox-escape).
  const VALID_WL_NAME = /^[\w .-]{1,64}$/;
  function wlPath(name) {
    if (typeof name !== 'string' || !VALID_WL_NAME.test(name)) {
      throw new Error(`Invalid watchlist name "${name}" — use letters, digits, space, . _ - (max 64); no path separators.`);
    }
    return `${WL_DIR}/${name}.json`;
  }

  async function watchlist_manage({ action, name, type, items }) {
    switch (action) {
      case 'create': {
        const wl = {
          name,
          type,
          items: (items || []).map(v => ({ value: v, last_seen: null, last_status: null })),
          created: new Date().toISOString(),
        };
        storage.writeJSON(wlPath(name), wl);
        return makeResponse(`Created watchlist "${name}"`, wl);
      }
      case 'list': {
        const files = storage.listFiles(WL_DIR, '*.json').filter(f => f !== '_rules.json');
        const watchlists = files.map(f => {
          const wl = storage.readJSON(`${WL_DIR}/${f}`);
          return { name: wl.name, type: wl.type, count: wl.items.length };
        });
        return makeResponse(`${watchlists.length} watchlist(s)`, { watchlists });
      }
      case 'get': {
        const wl = storage.readJSON(wlPath(name));
        if (!wl) return makeResponse(`Watchlist "${name}" not found`, null, [], [`Not found: ${name}`]);
        return makeResponse(`Watchlist "${name}": ${wl.items.length} items`, wl);
      }
      case 'add_items': {
        const wl = storage.readJSON(wlPath(name));
        if (!wl) return makeResponse(`Watchlist "${name}" not found`, null, [], [`Not found: ${name}`]);
        const existing = new Set(wl.items.map(i => i.value));
        for (const v of (items || [])) {
          if (!existing.has(v)) {
            wl.items.push({ value: v, last_seen: null, last_status: null });
            existing.add(v);
          }
        }
        storage.writeJSON(wlPath(name), wl);
        return makeResponse(`Added items to "${name}": now ${wl.items.length}`, wl);
      }
      case 'remove_items': {
        const wl = storage.readJSON(wlPath(name));
        if (!wl) return makeResponse(`Watchlist "${name}" not found`, null, [], [`Not found: ${name}`]);
        const removeSet = new Set(items || []);
        wl.items = wl.items.filter(i => !removeSet.has(i.value));
        storage.writeJSON(wlPath(name), wl);
        return makeResponse(`Removed items from "${name}": now ${wl.items.length}`, wl);
      }
      case 'delete': {
        try {
          unlinkSync(storage.resolve(wlPath(name)));
        } catch { /* already gone */ }
        return makeResponse(`Deleted watchlist "${name}"`, { deleted: name });
      }
      default:
        return makeResponse('Unknown action', null, [], [`Unknown action: ${action}`]);
    }
  }

  async function watchlist_check({ name } = {}) {
    const files = name
      ? [`${name}.json`]
      : storage.listFiles(WL_DIR, '*.json').filter(f => f !== '_rules.json');

    const hits = [];
    const sources = [];

    for (const file of files) {
      const wl = storage.readJSON(`${WL_DIR}/${file}`);
      if (!wl) continue;

      const cfg = TYPE_ROUTES[wl.type];
      if (!cfg) continue;

      sources.push(cfg.route);

      for (const item of wl.items) {
        const data = await client.get(cfg.route, { [cfg.param]: item.value });
        const currentStatus = JSON.stringify(data);

        const isNew = item.last_seen === null;
        const changed = item.last_status !== null && item.last_status !== currentStatus;

        if (isNew || changed) {
          hits.push({
            watchlist: wl.name,
            type: wl.type,
            value: item.value,
            current_status: data,
            previous_status: item.last_status ? JSON.parse(item.last_status) : null,
            reason: isNew ? 'first_check' : 'status_changed',
          });
        }

        item.last_seen = new Date().toISOString();
        item.last_status = currentStatus;
      }

      storage.writeJSON(`${WL_DIR}/${file}`, wl);
    }

    return makeResponse(
      `Checked ${files.length} watchlist(s): ${hits.length} hit(s)`,
      { hits },
      [...new Set(sources)],
    );
  }

  async function alert_rules_manage({ action, rule }) {
    const rules = storage.readJSON(RULES_FILE) || [];

    switch (action) {
      case 'create': {
        rules.push(rule);
        storage.writeJSON(RULES_FILE, rules);
        return makeResponse(`Created rule "${rule.id}"`, rule);
      }
      case 'list': {
        return makeResponse(`${rules.length} rule(s)`, { rules });
      }
      case 'get': {
        const found = rules.find(r => r.id === rule.id);
        if (!found) return makeResponse(`Rule "${rule.id}" not found`, null, [], [`Not found: ${rule.id}`]);
        return makeResponse(`Rule "${rule.id}"`, found);
      }
      case 'update': {
        const idx = rules.findIndex(r => r.id === rule.id);
        if (idx === -1) return makeResponse(`Rule "${rule.id}" not found`, null, [], [`Not found: ${rule.id}`]);
        rules[idx] = { ...rules[idx], ...rule };
        storage.writeJSON(RULES_FILE, rules);
        return makeResponse(`Updated rule "${rule.id}"`, rules[idx]);
      }
      case 'delete': {
        const filtered = rules.filter(r => r.id !== rule.id);
        storage.writeJSON(RULES_FILE, filtered);
        return makeResponse(`Deleted rule "${rule.id}"`, { deleted: rule.id });
      }
      default:
        return makeResponse('Unknown action', null, [], [`Unknown action: ${action}`]);
    }
  }

  async function alert_check({ rule_id } = {}) {
    const rules = storage.readJSON(RULES_FILE) || [];
    const toCheck = rule_id ? rules.filter(r => r.id === rule_id) : rules;
    const triggered = [];
    const sources = [];

    for (const rule of toCheck) {
      const route = METRIC_ROUTES[rule.domain];
      if (!route) continue;
      sources.push(route);

      const data = await client.get(route);
      const current = extractMetricValue(rule.domain, rule.metric, data);
      const isTriggered = current !== null && applyOperator(rule.operator, current, rule.threshold);

      triggered.push({
        rule_id: rule.id,
        message: rule.message,
        current_value: current,
        threshold: rule.threshold,
        operator: rule.operator,
        triggered: isTriggered,
      });
    }

    const hitCount = triggered.filter(t => t.triggered).length;
    return makeResponse(
      `Checked ${toCheck.length} rule(s): ${hitCount} triggered`,
      { triggered },
      [...new Set(sources)],
    );
  }

  return { watchlist_manage, watchlist_check, alert_rules_manage, alert_check };
}

export const schemas = {
  watchlist_manage: {
    description: 'Create, list, get, add/remove items, or delete a watchlist for tracking IPs, tickers, regions, CVEs, vessels, or callsigns.',
    inputSchema: z.object({
      action: z.enum(['create', 'list', 'get', 'add_items', 'remove_items', 'delete']).describe('CRUD action'),
      name: z.string().optional().describe('Watchlist name'),
      type: z.enum(['ip', 'ticker', 'region', 'cve', 'vessel', 'callsign']).optional().describe('Item type (required for create)'),
      items: z.array(z.string()).optional().describe('Items to add/remove'),
    }),
  },
  watchlist_check: {
    description: 'Run watchlists against live data. Returns only items with new activity since last check.',
    inputSchema: z.object({
      name: z.string().optional().describe('Specific watchlist name (omit for all)'),
    }),
  },
  alert_rules_manage: {
    description: 'Create, list, get, update, or delete threshold-based alert rules (e.g., "alert if SPY < 400").',
    inputSchema: z.object({
      action: z.enum(['create', 'list', 'get', 'update', 'delete']).describe('CRUD action'),
      rule: z.object({
        id: z.string().describe('Unique rule identifier'),
        domain: z.string().optional().describe('Data domain: markets, conflicts, cyber'),
        metric: z.string().optional().describe('Metric name, e.g. "spy_price", "event_count"'),
        operator: z.enum(['gt', 'lt', 'gte', 'lte', 'eq', 'ne', 'contains']).optional().describe('Comparison operator'),
        threshold: z.any().optional().describe('Threshold value'),
        message: z.string().optional().describe('Human-readable alert message'),
      }).describe('Rule definition'),
    }),
  },
  alert_check: {
    description: 'Evaluate all active alert rules against current data. Returns which rules are currently triggered.',
    inputSchema: z.object({
      rule_id: z.string().optional().describe('Check a specific rule (omit for all)'),
    }),
  },
};
