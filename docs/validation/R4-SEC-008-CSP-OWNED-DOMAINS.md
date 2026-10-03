# R4-SEC-008 / R3-SEC-004 validation — CSP without `unsafe-eval`, trust only owned origins

Validated October 1, 2026 on branch `claude/r4-sec-008-csp-owned-domains`.
It is stacked on PR #1768 (`claude/r4-sec-001-secret-boundary`). Approved
design: [plan](../plans/2026-10-01-r4-sec-008-csp-owned-domains.md)
(images: keep `https:` for now; shares: no link; ports: fixed range).

## Behavior

### CSP (R3-SEC-004)

- Both policies (`src-tauri/tauri.conf.json`, `index.html`) drop
  `'unsafe-eval'` and keep `'wasm-unsafe-eval'`.
- `font-src` is `'self' data:` on desktop and adds
  `https://fonts.gstatic.com` on the web.
- Loopback is exact. `connect-src` lists the 11 sidecar ports
  (46123–46133) plus Ollama (11434) and LM Studio (1234); `frame-src` lists
  the sidecar ports. There is no `127.0.0.1:*` wildcard, in the Tauri
  policy or in the desktop meta CSP that `vite.config.ts` injects. Both come
  from `src/config/csp-policy.ts`.
- `img-src` / `media-src https:` are unchanged (decision A; image proxy is a
  follow-up).
- Build-time rewrite: `cspSafeGlobalThisPlugin` turns Knockout's
  `(0,eval)("this")` into `globalThis` in Cesium modules.
- Build gate: `distEvalGatePlugin` runs `scripts/check-dist-eval.mjs` after
  every `vite build`. The build fails on any eval-family construct in a
  main-thread chunk.
  - Three library snippets that never run in a webview are tolerated, and
    only in their exact form: the globalThis polyfill fallback, Knockout's
    JSON fallback, and Knockout's data-bind compiler. The last one holds only
    while every Cesium Knockout widget stays disabled, which a test pins.
  - Three workers are allowlisted by path, each with a reason.
  - The Function-constructor pattern flags any call, not only string
    arguments. That caught two embind invokers in `@spz-loader/core` that the
    narrower pattern missed. See the next item.
- SPZ Gaussian splats: Cesium decodes them with an Emscripten embind build
  that compiles code with the Function constructor. Without `'unsafe-eval'`
  that decoder could never run, and the app loads no splat content. A vite
  alias replaces `@spz-loader/core` with
  `src/shims/spz-loader-unsupported.ts`, which rejects with a clear message.
  Cesium records that as the loader's error, so a splat tile fails cleanly
  instead of with a CSP `EvalError`.
- Runtime visibility: `src/services/csp-violation-reporter.ts` (installed in
  `main.ts` and `settings-main.ts`) logs each distinct directive and blocked
  origin once, at most 50 per window. It logs the origin only, and the
  source path without its query.

### Owned domains (R4-SEC-008)

- `src/config/owned-origins.ts` holds the only trusted web host,
  `bradleybond512.github.io`. The sidecar mirrors it.
- The for-sale domain is gone from code and config: both CSPs, edge CORS,
  `api/` and `server/` allowlists, UA strings, meta tags, `llms.txt`, the
  Little Snitch rules and the GitHub templates.
- `APP_HOSTS` matches exact hosts only. There is no suffix match.
- Edge CORS (`api/_cors.js`, `api/_api-key.js`, `server/cors.ts`,
  `api/youtube/embed.js`) no longer trusts another account's Vercel previews
  (`-elie-`). An unowned origin is never reflected.
- Sidecar:
  - no default cloud fallback (`remoteBase` is empty);
  - theater posture is computed locally only;
  - CORS allows only the owned host and the Tauri origins.
- Story shares carry text and the image only. There is no link and no
  third-party handle (`@CrystalBallApp` was removed).
- Sidecar ports: the sidecar tries 46123–46133 in order. If all are busy, it
  falls back to an OS-assigned port and logs that the webview cannot reach
  it. A request for port 0 (tests) binds an OS port directly.

### Cleanups in touched files

CI lints every changed file strictly, so findings that already existed in
these files were fixed:

- `api/fwdstart.js` is split into `parseArchiveItems` and `renderRss`.
  Scraped titles, descriptions and links are now escaped. Before, a `]]>` in
  a scraped title could inject markup into the feed. New
  `api/fwdstart.test.mjs`.
- `api/og-story.js`: the dead `type` variable is removed and the arc fill is
  extracted.
- `src/services/story-share.ts` is rewritten as line lists. The dead
  `parseStoryParams` and `generateQRCode` are removed; `meta-tags.ts` has its
  own parser. A score of 0 and a 24h change of 0 now render as numbers
  instead of N/A. New `story-share.test.mts` pins the exact texts.
- `StoryModal.ts`:
  - share windows open with `noopener,noreferrer`;
  - render errors go to the desktop log;
  - there are no floating promises.
- `happy-share-renderer.ts`: an unknown stored category falls back to the
  default instead of crashing the renderer.
- `check-dist-eval.mjs`: the JSON-guard regex is bounded and anchored.
- `ServiceStatusPanel.ts`, `csp-violation-reporter.ts` and
  `settings-main.ts`: small lint fixes.

## Actual validation

All tests use fakes. There is no network, Keychain or real sidecar.

| Suite | Result (Bradley's Mac) |
|---|---|
| `test:csp-owned` (new: 11 node files, 3 tsx files) | 61/61 + 13/13 |
| `test:sec-hardening` (includes `csp-allowlist`) | 73/73 |
| `test:sidecar` (includes `local-api-server`, `intel-expansion-cluster3`, `ais-relay-cors`) | 642/642 |
| `test:lifelines` | 155/155 + 183/183 |
| `test:ucdp-provider` | 64/64 |
| `test:system-theme` | 22/22 |

- The agentic gate passed, including `lint:strict`, `typecheck:all`,
  `secrets:scan`, `docs:check` and `npm run build`.
  - The build ran the dist-eval gate on a real production bundle.
  - No main-thread violations; three reviewed workers were allowed.
  - The built `index.html` has no `'unsafe-eval'`.
- ESLint is clean on every changed file. `lint:colors` shows no increase.
- Each changed test file was also run on its own. Two failures exist
  outside this change:
  - `shell-a11y-contracts` "analytics consent dialog takes focus" fails the
    same way on the base branch.
  - `theme-manager` fails only under the panel `register-hook` harness. It
    passes 22/22 through `test:system-theme` on both branches.
- The first per-file run found a regression in this change: with port 0,
  the new candidate-port list started at port 1 (`EACCES`), which failed 5
  BGP route tests and hung `local-api-server`. Fixed; both suites pass.
- The first gate build found the SPZ embind invokers described above.

## Mutation proof

Each mutation was applied alone. The table records the SHA-256 prefix of the
file before mutating. Every file was restored and its hash re-verified.
Baselines were green before the run.

| # | Mutation | File (sha before) | Red test file(s) |
|---|---|---|---|
| M01 | `'unsafe-eval'` back in the Tauri CSP | `tauri.conf.json` (`c96cd4ac35d3`) | csp-allowlist (1) |
| M02 | `'unsafe-eval'` back in the meta CSP | `index.html` (`fdbc14cfb16d`) | csp-allowlist (1) |
| M03 | Knockout rewrite returns its input | `csp-policy.ts` (`76053bc3555c`) | csp-policy (1) |
| M04 | rewrite plugin unwired | `vite.config.ts` (`cb39a439ed16`) | csp-eval-gate (1) |
| M05 | dist gate stops throwing | `vite.config.ts` (`cb39a439ed16`) | csp-eval-gate (1) |
| M06 | data-bind guard widened | `check-dist-eval.mjs` (`6ac3deebfbc6`) | csp-eval-gate (3) |
| M07 | worker allowlist widened | `check-dist-eval.mjs` (`6ac3deebfbc6`) | csp-eval-gate (1) |
| M08 | Function pattern narrowed to string arguments | `check-dist-eval.mjs` (`6ac3deebfbc6`) | csp-eval-gate (1) |
| M09 | JSON guard drops its backreferences | `check-dist-eval.mjs` (`6ac3deebfbc6`) | csp-eval-gate (1) |
| M10 | for-sale domain back in edge CORS | `api/_cors.js` (`a46a2c1e37b4`) | _cors (2), owned-domains (1) |
| M11 | other account's previews back in edge CORS | `api/_cors.js` (`a46a2c1e37b4`) | _cors (1), owned-domains (1) |
| M12 | edge CORS reflects any origin | `api/_cors.js` (`a46a2c1e37b4`) | _cors (2), owned-domains (1) |
| M13 | for-sale API host back in `connect-src` | `tauri.conf.json` (`c96cd4ac35d3`) | owned-domains (2) |
| M14 | `APP_HOSTS` suffix trust | `runtime.ts` (`b085d23efd03`) | owned-domains (1) |
| M15 | cloud fallback default restored | `local-api-server.mjs` (`393bcd855805`) | owned-domains (2) |
| M16 | for-sale host in sidecar CORS | `local-api-server.mjs` (`393bcd855805`) | sidecar-cors (1), owned-domains (2) |
| M17 | for-sale host in `OWNED_WEB_HOSTS` | `owned-origins.ts` (`dfe6ee2436ad`) | owned-domains (2) |
| M18 | port range shortened to 5 | `local-api-server.mjs` (`393bcd855805`) | csp-allowlist (1) |
| M19 | port 0 walks low ports | `local-api-server.mjs` (`393bcd855805`) | csp-allowlist (1) |
| M20 | reporter does not deduplicate | `csp-violation-reporter.ts` (`8ac21018b0f8`) | csp-violation-reporter (1) |
| M21 | reporter has no cap | `csp-violation-reporter.ts` (`8ac21018b0f8`) | csp-violation-reporter (1) |
| M22 | reporter keeps the source query | `csp-violation-reporter.ts` (`8ac21018b0f8`) | csp-violation-reporter (1) |
| M23 | reporter keeps the blocked URL | `csp-violation-reporter.ts` (`8ac21018b0f8`) | csp-violation-reporter (3) |
| M24 | empty directive does not fall through | `csp-violation-reporter.ts` (`8ac21018b0f8`) | csp-violation-reporter (1) |
| M25 | share names a third-party handle | `story-share.ts` (`5f3f00b9c44a`) | story-share (2) |
| M26 | share carries a link | `story-share.ts` (`5f3f00b9c44a`) | story-share (3) |
| M27 | score 0 shown as N/A | `story-share.ts` (`5f3f00b9c44a`) | story-share (1) |
| M28 | flag accepts non-letters | `story-share.ts` (`5f3f00b9c44a`) | story-share (1) |
| M29 | CDATA not split | `api/fwdstart.js` (`b4fd126d7d37`) | fwdstart (1) |
| M30 | item link not escaped | `api/fwdstart.js` (`b4fd126d7d37`) | fwdstart (1) |
| M31 | self link not escaped | `api/fwdstart.js` (`b4fd126d7d37`) | fwdstart (1) |
| M32 | duplicate posts kept | `api/fwdstart.js` (`b4fd126d7d37`) | fwdstart (1) |
| M33 | no item cap | `api/fwdstart.js` (`b4fd126d7d37`) | fwdstart (1) |
| M34 | Cesium geocoder widget on | `CesiumGlobe.ts` (`0974228f4888`) | csp-eval-gate (1) |
| M35 | SPZ alias removed | `vite.config.ts` (`cb39a439ed16`) | csp-eval-gate (1) |
| M36 | SPZ stand-in resolves instead of rejecting | `spz-loader-unsupported.ts` (`f5695fa2aadc`) | csp-policy (1) |
| M37 | SPZ stand-in uses the Function constructor | `spz-loader-unsupported.ts` (`f5695fa2aadc`) | csp-eval-gate (1) |

All 37 mutations went red, with no survivors. M04 and M05 were re-run after
the SPZ alias changed `vite.config.ts`.

Theater posture is pinned by a source check in `owned-domains` (no
`fetchWithTimeout` or `cloudUrl` in the handler). It was not mutated
separately.

## Manual checks for Bradley (after a fresh desktop build)

1. **God's Eye:** open it, rotate, zoom, and click an entity.
2. **Map:** pan, zoom, and toggle a layer that uses workers.
3. **AI features:** a summary or classification runs (ML worker).
4. **Live News:** YouTube channels play.
5. **Story share:** X, LinkedIn and WhatsApp open with text only, no link.
6. **Settings → Service Status:** shows "cloud fallback: none (local only)".
7. **Desktop log:** search for `CSP blocked`. Send me any lines you find;
   each one names the directive and origin that needs a decision.

If the desktop build (`build:desktop`) fails with `[dist-eval-gate]`, the
message names the chunk and construct. Don't add `'unsafe-eval'` back.

## Residual risk and follow-ups

- `img-src` / `media-src https:` stay open until the image proxy lands
  (decision A).
- New finding, not changed here: the edge CORS patterns
  `crystalball-*-bradleybond512.vercel.app` and
  `crystal-ball-*-bradleybond512.vercel.app` would also match a project that
  someone else names with a `-bradleybond512` suffix, if Vercel gives it that
  production alias. This needs your decision: whether Vercel previews still
  matter.
- `CRYSTALBALL_API_KEY` is still in the renderer-readable list from R4-SEC-001.
  The cloud API it served is gone, so it should be removed in a follow-up.
- The web build's `script-src` still lists `vercel.live`, PostHog and
  Cloudflare Insights. They are unchanged here.

## Rollback

Revert the commit. That restores `'unsafe-eval'`, the SPZ decoder, and
trust in the for-sale domain. To unblock one library instead, add a reviewed
rewrite or worker entry; the gate names the construct.
