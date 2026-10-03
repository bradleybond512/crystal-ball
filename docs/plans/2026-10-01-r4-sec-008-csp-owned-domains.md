# Q11: CSP without `unsafe-eval`, and no trust in `crystalball.app`

Status: approved by Bradley on October 1, 2026 ("Approve as designed"; images: keep https: for now with a proxy follow-up; shares: no link; ports: fixed range). Branch
`claude/r4-sec-008-csp-owned-domains`, stacked on
`claude/r4-sec-001-secret-boundary` (#1768 → #1759 → #1758), because it edits
the same `runtime.ts` / `runtime-config.ts` / `main.rs` lines.
Classification: **High Assurance** (CSP). Queue item Q11. It covers
R3-SEC-004 and R4-SEC-008.

## Findings (verified at 36754f628)

### `unsafe-eval` (R3-SEC-004)

- Both policies allow it: Tauri `script-src 'self' 'unsafe-eval'
  'wasm-unsafe-eval'`, and the same in the `index.html` meta CSP.
- A fresh `dist/` (210 JS files) was searched for `eval(`, `new Function(`,
  `Function("…")`, `Function.apply` and string timers. Only **one
  main-thread** hit exists:
  - The Cesium bundle (God's Eye) embeds Knockout 3.5.1:
    `var A=this||(0,eval)("this")`.
  - It is an ES module, so it runs in strict mode, `this` is undefined, and
    the `eval` **does run**. Simply deleting `'unsafe-eval'` would break God's
    Eye at load.
- All other hits are in **workers**, and each is a guarded fallback:
  - `ml.worker` (`new Function("return this")`, after a `globalThis` check);
  - Cesium `transcodeKTX2` (protobuf `inquire`, inside a try/catch);
  - the MapLibre worker (`globalThis.eval` only if a blob `import()` fails).

### Exfiltration through images, media and fonts (R3-SEC-004)

- `img-src … https:`, `media-src … https:` and `font-src … https:` remain
  open exfiltration channels.
- Images come from **arbitrary hosts**: news thumbnails from any
  publisher, many webcam providers, and **user-pinned webcam URLs**.
  An explicit host list would break those.
- Fonts: the desktop policy cannot load the Google Fonts stylesheet at all
  (`style-src` has no `fonts.googleapis.com`), so `font-src https:` buys
  nothing there.

### `crystalball.app`, a domain you don't own (R4-SEC-008)

The domain is for sale, yet it is still trusted in these places:

- Tauri `connect-src` / `frame-src`, and the `index.html` CSP (including
  `wss://*.crystalball.app`).
- **Sidecar CORS** (`SIDECAR_PROD_HOSTS`): a page on that domain could read
  the sidecar's public routes cross-origin from your browser.
- **Sidecar cloud pass-through default** (`remoteBase = 'https://crystalball.app'`).
  It is off unless `LOCAL_API_CLOUD_FALLBACK=true`.
- **Theater-posture route**: it *always* fetches
  `https://api.crystalball.app/api/military/v1/get-theater-posture` and shows
  the result. If the domain is bought, that is a direct data-injection
  channel.
- `runtime.ts` `APP_HOSTS` and `*.crystalball.app`.
- Story share links (`https://crystalball.app/api/story?…`).
- `ServiceStatusPanel` / `LiveNewsPanel` fallbacks, the
  `CRYSTALBALL_API_KEY` signup link, and the variant site URLs
  (`vite.config.ts`, `src/config/variants`).
- The Vercel `api/` allowlists and links, User-Agent contact strings, and
  the "happy" share-image watermark.

### Discovered: the sidecar's fallback port is CSP-blocked

If 46123 is busy, the sidecar binds an **OS-assigned** port. The Tauri
`connect-src` lists only `http://127.0.0.1:46123`, so every direct renderer
call to the sidecar is then blocked.

## Design

1. **`script-src` without `'unsafe-eval'`, in both policies.**
   - A small Vite plugin (`cspSafeGlobalThis`) rewrites exactly
     `(0,eval)("this")` (in any quote style) to `globalThis` in
     `cesium` / `@cesium` modules. The two mean the same thing; the rewrite
     just doesn't need eval.
   - **New `scripts/check-dist-eval.mjs` gate**, chained into `npm run build`:
     - it fails if any **non-worker** chunk contains an eval-family
       construct;
     - worker hits are listed in a reviewed allowlist (file name pattern
       plus reason).
2. **CSP violations become visible.** A `securitypolicyviolation` listener
   forwards each violation to `log_frontend`: directive, blocked origin only
   (never the full URL or query), and source file. It sends at most one
   message per directive and origin per session.
3. **Fonts:** `font-src 'self' data:` on desktop, and
   `'self' data: https://fonts.gstatic.com` on web.
4. **Images and media:** see decision A below.
5. **Remove `crystalball.app` everywhere** (code, CSP, CORS, `api/`,
   configs, UA strings). Docs and history are left as they are.
   - **One `OWNED_ORIGINS` list** (`src/config/owned-origins.ts`, with a
     mirror in the sidecar). It holds only your GitHub Pages origin
     `https://bradleybond512.github.io`.
   - **Default cloud base is empty**, so there is no pass-through target.
     #1759 already treats an empty base as "no request".
   - **Theater posture** reports "unavailable" instead of calling the
     domain.
   - **Share links:** see decision B below.
   - **New `tests/owned-domains.test.mjs`** fails if any non-owned
     first-party-looking domain appears in either CSP, `APP_HOSTS`, the
     sidecar CORS allowlist, `api/_cors.js` or `api/_api-key.js`, and if
     the string `crystalball.app` appears anywhere in code.
6. **Sidecar fallback ports** (decision C).

## Decisions for you

- **A. `img-src` / `media-src https:`** (recommended: keep for now, follow
  up with an image proxy).
  - Closing them properly means routing remote images through a sidecar
    image proxy that has its own host allowlist, with user-pinned webcams
    added explicitly. That is a separate design.
  - After Q10 the renderer no longer holds sidecar-only API keys, so the
    stake is lower. Your saved places and location could still leak this
    way, though.
- **B. Share links** (recommended: no link; share text and image only).
  The alternative is linking to the GitHub Pages web app.
- **C. Fallback port** (recommended: a fixed range).
  - The sidecar tries 46123–46133 before an OS-assigned port, and the CSP
    lists exactly those 11 ports.
  - The alternative, `http://127.0.0.1:*`, would let the renderer talk to
    any local service.

## Tests (fakes only; mutation proof per behavior)

- `csp-allowlist` is extended to check both policies:
  - no `'unsafe-eval'`;
  - `'wasm-unsafe-eval'` kept;
  - no bare `https:` in `font-src`;
  - the sidecar port range is listed exactly.
- Unit tests for the Knockout rewrite (all quote styles, and nothing else
  changed).
- The dist-eval gate, run on fixture chunks: the main-thread hit is red,
  allowlisted workers pass.
- Violation reporter: it is deduplicated, sends the origin only, and drops
  the query string.
- `owned-domains`, as above.
- Sidecar:
  - CORS refuses a `crystalball.app` origin;
  - the default `remoteBase` is empty;
  - theater posture makes no outbound call;
  - the fallback-port order.
- A manual God's Eye smoke run after a fresh build is listed for you in the
  validation doc.

## Approval requirement

Per AGENTS.md High Assurance rules, implementation starts only after
Bradley approves this design and its decisions.
