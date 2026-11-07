import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { readBoundedJson } from './_bounded-json.js';
import { createNwsSnapshotProvider } from '../src-tauri/sidecar/nws-alert-snapshot.mjs';

export const config = { runtime: 'edge' };
const provider = createNwsSnapshotProvider({
  fetchFn: (...args) => fetch(...args), readJson: readBoundedJson, clock: () => Date.now(),
});

const json = (payload, status, cors) => Response.json(payload, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors },
});

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return json({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405, cors);
  try {
    return json(await provider.get(), 200, cors);
  } catch {
    return json({ error: 'NWS national snapshot unavailable', stale: true }, 503, cors);
  }
}
