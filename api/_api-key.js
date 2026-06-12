const DESKTOP_ORIGIN_PATTERNS = [
  /^https?:\/\/tauri\.localhost(:\d+)?$/,
  /^https?:\/\/[a-z0-9-]+\.tauri\.localhost(:\d+)?$/i,
  /^tauri:\/\/localhost$/,
  /^asset:\/\/localhost$/,
];

const BROWSER_ORIGIN_PATTERNS = [
  /^https:\/\/crystalball\.app$/,
  /^https:\/\/(tech|finance|happy|api)\.crystalball\.app$/,
  // Vercel preview URLs anchored to known owner accounts (mirrors _cors.ts).
  // The `-<account-slug>` suffix (e.g. `-bradleybond512`) is appended by Vercel
  // from the OWNING account and cannot be forged by a third party. Without it,
  // `crystalball-[a-z0-9-]+\.vercel\.app` would match any project literally named
  // `crystalball-<anything>` — e.g. an attacker's `crystalball-evil.vercel.app` —
  // granting it trusted-browser CORS. Keep every preview pattern account-anchored.
  /^https:\/\/crystalball-[a-z0-9-]+-bradleybond512\.vercel\.app$/,
  /^https:\/\/crystal-ball-[a-z0-9-]+-bradleybond512\.vercel\.app$/,
  /^https:\/\/crystalball-[a-z0-9-]+-elie-[a-z0-9]+\.vercel\.app$/,
  /^https:\/\/crystal-ball-[a-z0-9-]+-elie-[a-z0-9]+\.vercel\.app$/,
  ...(process.env.NODE_ENV === 'production' ? [] : [
	/^https?:\/\/localhost(:\d+)?$/,
	/^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  ]),
];

function isDesktopOrigin(origin) {
  return Boolean(origin) && DESKTOP_ORIGIN_PATTERNS.some(p => p.test(origin));
}

function isTrustedBrowserOrigin(origin) {
  return Boolean(origin) && BROWSER_ORIGIN_PATTERNS.some(p => p.test(origin));
}

function hasTrustedBrowserFetchMetadata(req) {
  const fetchSite = (req.headers.get('Sec-Fetch-Site') || '').toLowerCase();
  const fetchMode = (req.headers.get('Sec-Fetch-Mode') || '').toLowerCase();

  if (!['same-origin', 'same-site'].includes(fetchSite)) return false;
  if (fetchMode && !['cors', 'same-origin', 'navigate', 'no-cors'].includes(fetchMode)) return false;
  return true;
}

function isTrustedBrowserRequest(req, origin) {
  if (!hasTrustedBrowserFetchMetadata(req)) return false;
  return isTrustedBrowserOrigin(origin);
}

function isReadRequest(req) {
  const method = (req.method || 'GET').toUpperCase();
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}

// Sidecar mode: the sidecar already authenticates via LOCAL_API_TOKEN,
// so skip the API-key check entirely for requests it proxies.
const IS_SIDECAR = (process.env.LOCAL_API_MODE || '').includes('sidecar');
const SIDECAR_PASS = { valid: true, required: false };

function requireKey(key, validKeys, errorMsg) {
  if (!key) return { valid: false, required: true, error: errorMsg };
  if (!validKeys.has(key)) return { valid: false, required: true, error: 'Invalid API key' };
  return { valid: true, required: true };
}

export function validateApiKey(req) {
  if (IS_SIDECAR) return SIDECAR_PASS;

  const key = req.headers.get('X-CrystalBall-Key');
  const origin = req.headers.get('Origin') || '';
  const validKeys = new Set((process.env.CRYSTALBALL_VALID_KEYS || '').split(',').filter(Boolean));

  if (isDesktopOrigin(origin)) {
	return requireKey(key, validKeys, 'API key required for desktop access');
  }

  if (isTrustedBrowserRequest(req, origin)) {
	if (!isReadRequest(req)) {
	  return requireKey(key, validKeys, 'API key required for trusted browser non-read requests');
	}
	if (key && !validKeys.has(key)) return { valid: false, required: true, error: 'Invalid API key' };
	return { valid: true, required: false };
  }

  if (key) return requireKey(key, validKeys, 'API key required');

  return { valid: false, required: true, error: 'API key required' };
}
