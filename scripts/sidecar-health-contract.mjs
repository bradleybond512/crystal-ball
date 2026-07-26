export function summarizeSidecarHealth(payload) {
  if (
    !payload
    || typeof payload !== 'object'
    || payload.ok !== true
    || !Array.isArray(payload.feeds)
    || !Number.isInteger(payload.keys_configured)
    || !Number.isInteger(payload.keys_total)
  ) {
    return null;
  }

  return {
    feedCount: payload.feeds.length,
    keysConfigured: payload.keys_configured,
    keysTotal: payload.keys_total,
  };
}
