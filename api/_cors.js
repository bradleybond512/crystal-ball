// Vercel preview URLs follow the shape `{project}-{branch-hash}-{username}.vercel.app`.
// Patterns MUST end with a trusted username segment — never a wildcard `*.vercel.app`
// match that could let an unrelated third-party project (e.g. `crystal-ball-foo.vercel.app`)
// gain CORS approval just by owning a similarly-named Vercel project.
const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/crystalball\.app$/,
  /^https:\/\/(tech|finance|happy|api)\.crystalball\.app$/,
  // `crystalball` (no dash) project previews.
  /^https:\/\/crystalball-[a-z0-9-]+-elie-[a-z0-9]+\.vercel\.app$/,
  /^https:\/\/crystalball-[a-z0-9-]+-bradleybond512\.vercel\.app$/,
  // `crystal-ball` (hyphenated) project previews — anchored on the trusted user suffix.
  /^https:\/\/crystal-ball-[a-z0-9-]+-bradleybond512\.vercel\.app$/,
  /^https:\/\/crystal-ball-[a-z0-9-]+-elie-[a-z0-9]+\.vercel\.app$/,
  /^https?:\/\/tauri\.localhost(:\d+)?$/,
  /^https?:\/\/[a-z0-9-]+\.tauri\.localhost(:\d+)?$/i,
  /^tauri:\/\/localhost$/,
  /^asset:\/\/localhost$/,
  // Only allow bare localhost/127.0.0.1 in non-production (matches server/cors.ts)
  ...(process.env.NODE_ENV === 'production' ? [] : [
 /^https?:\/\/localhost(:\d+)?$/,
 /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  ]),
];

function isAllowedOrigin(origin) {
  return Boolean(origin) && ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}

export function getCorsHeaders(req, methods = 'GET, OPTIONS') {
  const origin = req.headers.get('origin') || '';
  const allowOrigin = isAllowedOrigin(origin) ? origin : 'https://crystalball.app';
  return {
 'Access-Control-Allow-Origin': allowOrigin,
 'Access-Control-Allow-Methods': methods,
 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CrystalBall-Key',
 // `Date`/`Age` are NOT CORS-safelisted response headers. The fusion fetchers
 // age a payload against the SERVER's clock (see usgs-fusion-fetch.ts), and
 // the desktop build falls back to this edge route cross-origin whenever the
 // sidecar is unavailable — denied these two the age is unknowable and the
 // vote fails closed. Both describe the response's own age, nothing about the
 // requester, so exposing them leaks nothing.
 'Access-Control-Expose-Headers': 'Date, Age',
 'Access-Control-Max-Age': '86400',
 'Vary': 'Origin',
  };
}

export function isDisallowedOrigin(req) {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  return !isAllowedOrigin(origin);
}
