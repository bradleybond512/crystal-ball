# UX-055 — Credential validation evidence

Draft #1851 implements the approved design. The API Keys dashboard, setup wizard and standalone Settings show when a provider check ran. At 24 hours, both accepted and rejected results become stale. A failed attempt keeps the last conclusive result identifiable as history. Removing a key takes precedence over all receipts. The vault and feature-enablement rules remain independent of status age.

## Behavior and boundaries

A provider-specific authenticated response can establish acceptance or rejection. An outage, rate limit, public model list, generic denial or malformed response cannot. The wizard saves first. In buffered Settings a definitive rejection retains the draft for correction, while an outage allows an explicitly requested save after local format validation. Draft checks cannot verify the saved slot. Storage uses an allowlisted reason and a timestamp. A native saved check describes the local engine’s copy because the renderer cannot attest that the latest keychain write reached that process.

The changes span the three settings views and shared draft manager, the evidence and probe modules under `src/services`, the browser vault consistency check, and the authenticated sidecar route and its packaged verifier. Browser windows coordinate through Web Locks. A second attempt in another window cannot issue an additional request for the same key during the 60-second window. At most two providers are checked concurrently. Browser checks have eight seconds and desktop checks have twelve, including response bodies. Only the tested value and its required OpenSky companion can enter a draft request. Raw provider messages are never used as status labels.

## Reproductions and acceptance

On the original code, a 306-day-old result remained green even after removal. Groq HTTP 503 received contradictory validity labels on web and desktop, and a desktop Anthropic 429 could be read as success. The protected desktop route contacted a public OpenRouter endpoint and repeated immediately when clicked again. An unsaved draft test could overwrite the saved credential’s status.

The renderer acceptance exercises the actual dashboard, wizard and standalone Settings with isolated profiles and controlled transports. Chromium web uses a temporary encrypted IndexedDB vault. Desktop Chromium and macOS WKWebView use synthetic native responses. A separate fixture runs the real loopback sidecar route with a recording provider. The fixture covers age boundaries, removal, stale completions, rejected versus unavailable saves, editable focus, cross-window changes and retained status. Nothing in these checks attests to the validity of an operator credential or the live success response of an account-only provider.

Anonymous GET controls sent no credentials. The public OpenRouter model list returned HTTP 200 with 454 entries under `data`. Groq’s model endpoint returned HTTP 401 with an `error` object containing `message`, `type` and `code`. The final classifier admitted zero of 24 anonymous responses, including an HTTP 200 Google Directions response with empty routes. The [control matrix](UX055-PROVIDER-CONTROLS.json) records the request URL, field names, row count where available, and omitted account/POST probes. Conclusive authenticated responses were verified with synthetic fixtures.

## Validation

The tested implementation is `4417ac686`, tree `9f289127d`. The complete gate ran on `8a50aa6ae`. Its only subsequent source difference was the wizard keyboard trap using DOM node identity to satisfy repository lint. The final tree reran all 125 focused tests, both TypeScript configurations, sidecar tests, lint, mutation controls and three-renderer acceptance. The clean verification used Node 22.23.1. The focused suite and repository gate executed the following commands. Counts below are literal runner summaries.

| Command | Output |
| --- | --- |
| `npm run test:ux055` | `# pass 125`, `# fail 0` |
| `npm run test:settings` | `# pass 19`, `# fail 0` |
| `npm run test:secret-boundary` | `# pass 21`, `# fail 0` followed by `# pass 36`, `# fail 0` |
| `npm run test:sidecar-ci` | `# pass 13`, `# fail 0` |
| `npm run test:ux032` | `# pass 17`, `# fail 0` |
| `npm run test:sidecar` (commit hook) | `# pass 713`, `# fail 0` |
| `npm run sidecar:bundle-check` | `[check-sidecar-bundle] OK — all 29 statically-imported sidecar .mjs modules are present in bundle.resources.` |

The aggregate command was `bash scripts/agentic-validate.sh --tests 'test:ux055 test:settings test:secret-boundary test:sidecar-ci test:ux032'`. Its concluding output included `Agentic validation gate passed.` The local commit hook ran `tsc --noEmit && tsc --noEmit -p tsconfig.api.json` successfully. The build emitted existing Vite import-extension warnings.

Three renderers collected 52 observations apiece. The acceptance assertions reported 27/27 in Chromium web, 25/25 in desktop-mode Chromium, 25/25 in macOS WKWebView and 14/14 against the protected sidecar route. Among 83 code reversals, the intended assertions failed 117 times. A separate resource-manifest reversal produced the expected missing-module diagnostic. No reversal remained unresolved.

The [mutation certificate](UX055-MUTATIONS.json) identifies the inspected diff, failing assertion, counts before and after each reversal and the restored SHA-256. The [acceptance report](UX055-ACCEPTANCE.json) records the engine and route assertions. The published mutation record omits selected fixture values and one pairing-map literal flagged by the repository secret scanner. Full per-diff hashes are preserved. These certificates use controlled credentials and response fixtures.

## Independent review and manual verification

The first independent review reproduced an undated global footer that outlived a result. The fix dates the attempt and clears feedback after a replacement, edit or change in age. Cross-window browser checks also exposed duplicate outbound requests and a refused contender superseding the first attempt. Both regressions have two-window controls. The independent Sol reviewer reported zero blocking code findings on the repaired implementation and independently reran 67 focused tests. See the SHA-pinned verdict commit for the separate Sonnet review.

To reproduce manually in a disposable profile, stage a synthetic key and click Test with a recording transport. Keep the editor focused and advance the fixture clock through 24 hours. Replace or remove the key in a second window. In standalone Settings, simulate an authentication-specific rejection and then a provider outage on separate eligible attempts. Confirm that rejection leaves the draft open, outage allows saving, and reopening the view never sends a passive probe.

Rollback consists of reverting the implementation commit, including the paired sidecar protocol and resource manifest. Earlier builds ignore the versioned receipt namespace. No keychain migration, key rotation or installed-profile operation is required.
