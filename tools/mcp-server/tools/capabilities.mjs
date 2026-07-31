import { TOOL_CATALOG, TOOL_INDEX } from '../tool-registry.mjs';
import { SERVER_NAME, SERVER_VERSION, SKILL_CONTRACT_VERSION } from '../server-meta.mjs';

const DOMAIN_ROUTES = {
  conflicts: ['/api/acled-events'],
  markets: ['/api/market-quotes', '/api/fear-greed'],
  weather: ['/api/nws-alerts', '/api/owm-current'],
  cyber: ['/api/threatfox-iocs', '/api/cisa-kev'],
  military: ['/api/adsb-military', '/api/ais-snapshot', '/api/isw-reports'],
};

function classifyDomain(routes, feedByRoute) {
  const feeds = routes.map((route) => (
    feedByRoute.get(route) ?? { route, status: 'error', error: 'health probe missing' }
  ));
  const ready = feeds.filter((feed) => feed.status === 'ok').length;
  const status = ready === routes.length
    ? 'ready'
    : ready > 0
      ? 'partial'
      : 'unavailable';
  return {
    status,
    ready,
    total: routes.length,
    unavailable: feeds
      .filter((feed) => feed.status !== 'ok')
      .map((feed) => ({ route: feed.route, reason: feed.error || 'unavailable' })),
  };
}

export function makeCapabilityTools(granular) {
  async function get_capabilities() {
    const health = await granular.check_feed_health();
    const sidecar = health?.data?.sidecar || { error: 'unreachable' };
    const sidecarReady = !sidecar.error;
    const feedByRoute = new Map((health?.data?.feeds || []).map((feed) => [feed.route, feed]));
    const domains = {
      core: {
        status: sidecarReady ? 'ready' : 'unavailable',
        ready: sidecarReady ? 1 : 0,
        total: 1,
        unavailable: sidecarReady ? [] : [{ route: '/api/health', reason: sidecar.error }],
      },
    };

    for (const [domain, routes] of Object.entries(DOMAIN_ROUTES)) {
      domains[domain] = classifyDomain(routes, feedByRoute);
    }

    const counts = Object.values(domains).reduce((acc, domain) => {
      acc[domain.status] = (acc[domain.status] || 0) + 1;
      return acc;
    }, {});
    const warnings = sidecarReady ? [] : [`Crystal Ball sidecar is unavailable: ${sidecar.error}`];

    return {
      summary: `Capabilities: ${counts.ready || 0} ready, ${counts.partial || 0} partial, ${counts.unavailable || 0} unavailable.`,
      data: {
        server: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
          skillContractVersion: SKILL_CONTRACT_VERSION,
          tools: Object.keys(TOOL_CATALOG).length,
          categories: Object.keys(TOOL_INDEX.categories).length,
        },
        domains,
        credentials: {
          configured: sidecar.keys_configured || 0,
          total: sidecar.keys_total || 0,
          missing: sidecar.keys_missing_count || 0,
        },
      },
      sources: health?.sources || [],
      warnings,
      timestamp: new Date().toISOString(),
      healthy: sidecarReady,
    };
  }

  return { get_capabilities };
}
