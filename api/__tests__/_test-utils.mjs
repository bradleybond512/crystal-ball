/**
 * Shared mock request/response utilities for api/__tests__/*.test.mjs
 *
 * Handlers run on Vercel Edge runtime and follow the Fetch API contract:
 *   export default async function handler(req) { return new Response(...); }
 *
 * `req` is a real `Request`; response-shape helpers below mirror the returned
 * `Response` into a Node-style `res` object so existing characterization tests
 * (which assert on `res.statusCode`, `res.body`, `res.ended`) keep working.
 */

/**
 * @param {{
 *   method?: string,
 *   query?: Record<string, string | number | boolean>,
 *   headers?: Record<string, string>,
 *   body?: unknown,
 *   url?: string,
 * }} [opts]
 * @returns {Request & { query: Record<string, string>, body?: unknown }}
 */
export function mockReq(opts = {}) {
  const method = opts.method || 'GET';
  const baseUrl = opts.url || 'http://localhost/api/test';
  const query = opts.query || {};
  const qs = new URLSearchParams(
    Object.entries(query).map(([k, v]) => [k, String(v)]),
  ).toString();
  const fullUrl = qs ? `${baseUrl}?${qs}` : baseUrl;
  const headers = new Headers(opts.headers || {});
  if (!headers.has('origin')) headers.set('origin', 'http://localhost');

  /** @type {RequestInit} */
  const init = { method, headers };
  if (opts.body !== undefined && method !== 'GET' && method !== 'HEAD') {
    init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  }

  const req = new Request(fullUrl, init);
  // Back-compat convenience fields used by some handlers / tests.
  Object.defineProperty(req, 'query', {
    value: Object.fromEntries(new URL(fullUrl).searchParams),
    writable: false,
    enumerable: false,
  });
  if (opts.body !== undefined) {
    Object.defineProperty(req, '_rawBody', { value: opts.body, enumerable: false });
  }
  return req;
}

export function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    ended: false,
    status(code) { this.statusCode = code; return this; },
    setHeader(k, v) { this.headers[k] = v; return this; },
    json(data) { this.body = data; this.ended = true; return this; },
    send(data) { this.body = data; this.ended = true; return this; },
    end(data) { if (data !== undefined) this.body = data; this.ended = true; return this; },
  };
  return res;
}

/**
 * Invoke an edge-runtime handler and mirror its Response onto a mockRes-shaped
 * object so tests can assert with the same API used for Node-style handlers.
 *
 * @param {(req: Request) => Promise<Response> | Response} handler
 * @param {Parameters<typeof mockReq>[0]} [reqOpts]
 * @returns {Promise<{ req: Request, res: ReturnType<typeof mockRes>, response: Response | null }>}
 */
export async function invokeHandler(handler, reqOpts = {}) {
  const req = mockReq(reqOpts);
  const res = mockRes();
  let response = null;
  try {
    const result = await handler(req);
    if (result instanceof Response) {
      response = result;
      res.statusCode = result.status;
      res.headers = Object.fromEntries(result.headers.entries());
      const contentType = result.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        try { res.body = await result.clone().json(); } catch { res.body = await result.text(); }
      } else {
        res.body = await result.text();
      }
      res.ended = true;
    }
  } catch (err) {
    res.statusCode = 500;
    res.body = err instanceof Error ? err.message : String(err);
    res.ended = true;
  }
  return { req, res, response };
}

export function mockFetch(responses) {
  // responses: Map<urlPattern, { status, json?, text?, headers? }>
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const urlStr = typeof url === 'string' ? url : (url?.url ?? String(url));
    for (const [pattern, response] of responses) {
      if (urlStr.includes(pattern)) {
        return new Response(
          response.text ?? JSON.stringify(response.json ?? {}),
          {
            status: response.status ?? 200,
            headers: {
              'content-type': response.text ? 'text/plain' : 'application/json',
              ...(response.headers ?? {}),
            },
          },
        );
      }
    }
    throw new Error(`Unmocked fetch: ${urlStr}`);
  };
  return () => { globalThis.fetch = originalFetch; };
}
