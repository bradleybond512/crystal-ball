export function summarizeSidecarHealth(payload) {
  if (!payload || typeof payload !== 'object' || payload.ok !== true) return null;
  if (payload.authenticated !== true) {
    return Object.keys(payload).length === 1 ? { authenticated: false } : null;
  }
  if (
    !Array.isArray(payload.feeds)
    || !Number.isInteger(payload.keys_configured)
    || !Number.isInteger(payload.keys_total)
    || payload.keys_configured < 0
    || payload.keys_total < payload.keys_configured
    || payload.feeds.some((feed) => !feed || typeof feed !== 'object')
  ) {
    return null;
  }

  return {
    authenticated: true,
    feedCount: payload.feeds.length,
    failedFeedCount: payload.feeds.filter((feed) => Boolean(feed.lastError)).length,
    keysConfigured: payload.keys_configured,
    keysTotal: payload.keys_total,
    keysMissing: payload.keys_total - payload.keys_configured,
  };
}
