import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { readBoundedJson } from './_bounded-json.js';
import { createUkpnSnapshotProvider } from '../src-tauri/sidecar/ukpn-live-faults.mjs';

export const config = { runtime: 'edge' };
const provider = createUkpnSnapshotProvider({
  fetchFn: (...args) => fetch(...args), readJson: readBoundedJson, clock: () => Date.now(),
});
const json = (body, status, cors) => Response.json(body, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors },
});

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');
  if (isDisallowedOrigin(req)) return json({ error: 'Origin not allowed' }, 403, cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405, cors);
  if (new URL(req.url).searchParams.size > 0) return json({ error: 'UKPN route accepts no query parameters' }, 400, cors);
  try {
    const result = await provider.get({ signal: req.signal });
    return json(result, result.state === 'reported' || result.state === 'empty' ? 200 : 503, cors);
  } catch {
    return json({ error: 'UKPN request cancelled' }, 499, cors);
  }
}
