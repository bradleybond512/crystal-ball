# Content-Security-Policy audit

This file is the standing audit record for Crystal Ball's CSP. It documents
every concession to a stricter policy, why it exists, and what would have to
change before it can be removed.

## TL;DR

- `unsafe-eval` on `script-src` — **REQUIRED** by Cesium 1.140.0; removal blocked.
- `wasm-unsafe-eval` on `script-src` — **REQUIRED** by Cesium WASM workers (KTX2 transcoder, etc.).
- `unsafe-inline` on `style-src` — **PRESENT**; lower-risk; documented TODO for nonce migration.
- `unsafe-inline` on `script-src` — **ABSENT**. The one inline bootstrap script in `index.html` is
  pinned by hash (`'sha256-CEQjAz+RfGVMlmAv8C9h16vbduoug7nuW41coE/SDtM='`).

## Where the CSP is set

There are two enforcement points:

1. **Desktop (Tauri webview):** `src-tauri/tauri.conf.json` → `security.csp`.
   Tauri injects this as the `Content-Security-Policy` HTTP header for the
   built webview. This is the binding policy at runtime in the macOS app.

2. **Web / dev preview:** `index.html` `<meta http-equiv="Content-Security-Policy">`.
   Applied when the bundle is served by Vite or hosted on `crystalball.app`.
   Slightly more permissive on `connect-src` and `frame-src` because dev
   tooling and YouTube embeds need additional hosts. Inline-script use is
   pinned by SHA-256 hash, not `'unsafe-inline'`.

## Why `unsafe-eval` cannot be removed today

Cesium 1.140.0 — currently the only 3D-globe engine we ship — uses runtime
dynamic-code evaluation in at least three documented call paths:

1. **Shader compilation pipeline.** Cesium synthesises GLSL fragments from
   user-provided properties (entity descriptions, materials, label fonts)
   and compiles them via dynamic function constructors inside
   `cesium/Build/Cesium/Cesium.js`. Replacing this would require Cesium to
   ship strict-CSP shader builds. The current upstream (1.140.0) does not.
2. **Bundled protobuf dispatch.** The vendored `protobuf.js` lite runtime
   uses dynamic function construction for fast tag-dispatch.
3. **KTX2 / Draco worker compilation.** Asynchronous worker payloads in
   `cesium/Build/Cesium/Workers/transcodeKTX2.js` instantiate Emscripten
   modules via runtime function factories. This call site is partially
   covered by `wasm-unsafe-eval` but the surrounding glue still requires
   full `unsafe-eval` until Cesium ships an opt-in strict-CSP build.

Stripping `unsafe-eval` today produces a black map view, broken labels, and
broken KTX2 texture decoding. The previous CLAUDE.md note ("Required by
Cesium (God's Eye 3D globe) for shader compilation. Do not remove without
first replacing Cesium with a non-eval globe library.") still holds.

### What would let us remove `unsafe-eval`

- Cesium ships an official strict-CSP build (tracked upstream as a long-
  standing open issue). When that lands, swap the bundle path and drop the
  directive.
- OR: replace Cesium with a globe engine that does not need runtime eval
  (e.g. MapLibre + a terrain extension). Out of scope for security work; a
  product decision.

Until one of those happens, the directive stays. The `wasm-unsafe-eval`
directive is the narrower, more modern variant; it must stay alongside
`unsafe-eval` for Cesium's WASM workers regardless.

## Why `unsafe-inline` on `style-src` is still present

A large number of panel components compose inline `style="…"` strings as
part of the table / pill / chip rendering. A nonce-based migration is
mechanical but invasive — every `<div style="…">` site needs to be
rewritten to use a class plus a stylesheet entry, or to inherit a nonce
attribute. The migration is tracked separately; no security incident has
been linked to inline-style abuse in this app.

`unsafe-inline` on `style-src` is markedly lower-risk than `unsafe-inline`
on `script-src`. CSS cannot exfiltrate cookies, cannot call back to the
network, and cannot read the DOM. The two known exploit patterns are CSS
selectors that leak input values, and font-loading that fingerprints the
browser. Neither is interesting in our threat model (single-user desktop
app, no shared sessions).

### What would let us remove `unsafe-inline`

- Sweep all `style="…"` callsites and replace with classnames + a single
  CSS module per panel. Roughly 60 files; mechanical.
- OR: switch to a nonce-based policy with `__TAURI_NONCE__`. Requires
  injecting the nonce into every dynamically-generated style attribute,
  which is harder than the classname sweep.

## CORS posture (sidecar)

Documented here for completeness because CORS and CSP are commonly audited
together.

- **No `CORS_ALLOW_ALL` env override exists.** Searched the entire
  sidecar; the only fallback is to reflect `tauri://localhost` for
  non-matching origins, which is fail-closed in any real browser.
- **Allowlist (as of 2026-05-12):**
  - `tauri://localhost`, `asset://localhost`, `*.tauri.localhost`
    (webview origins)
  - The five enumerated production hosts: `crystalball.app`,
    `tech.crystalball.app`, `finance.crystalball.app`,
    `happy.crystalball.app`, `api.crystalball.app`
  - `localhost` / `127.0.0.1` **only on the known dev-server ports**
    (3000, 1420, 5173, 46123, and port-80 bare). Other localhost ports
    are denied.
- The `crystalball.app` single-subdomain glob has been replaced with an
  explicit set so a future DNS / certificate misconfiguration cannot
  silently grant CORS to an unrelated subdomain.

The Vercel-preview regex lives in `api/_cors.js` (cloud functions, not the
sidecar) and is anchored to trusted user suffixes — left unchanged in this
pass.

## Removal criteria checklist

When any of the below becomes true, file a follow-up to drop the
corresponding directive:

| Directive | Owner | Remove when … |
|---|---|---|
| `script-src 'unsafe-eval'` | renderer | Cesium ships strict-CSP build, OR we replace Cesium |
| `script-src 'wasm-unsafe-eval'` | renderer | Cesium ships pure-JS shader/texture path |
| `style-src 'unsafe-inline'` | renderer | Inline-style sweep complete, OR nonce wiring lands |
