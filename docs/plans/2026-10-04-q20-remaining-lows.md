# Q20: the remaining lows (R3-SEC-006/007/008, R4-LOW-001/002/003/004/007)

Status: **approved by Bradley on October 4, 2026** with every recommended
option (A: four PRs by area; B: Bradley checks the app after the next
install; C: add a pinned zizmor job; D: ask once more for consent).

Eight low-severity findings in four unrelated areas. Each area ships as its
own PR on the branch it would otherwise conflict with:

| PR | Findings | Base | Why that base |
|---|---|---|---|
| A: sidecar | R3-SEC-006, R3-SEC-007, R4-LOW-004 | `main` | Local, self-contained regions of `local-api-server.mjs` |
| B: CI | R4-LOW-002, R4-LOW-003 | #1772 | #1772 already edits `auto-merge-agent-branches.yml` and `dependabot.yml` |
| C: native | R3-SEC-008, R4-LOW-007 | #1776 | Every open stack PR edits `main.rs` |
| D: renderer | R4-LOW-001 | `main` | Self-contained `analytics.ts` change |

## A: sidecar

- **R3-SEC-006: the SMS webhook fails open.**
  - With SMS enabled and no `TWILIO_AUTH_TOKEN`, any caller without an
    Origin header who names an allowlisted `From` number gets STATUS, BRIEF
    or SITREP, which can reveal personal context.
  - Fix: without a Twilio token, only a bearer-token caller (the in-app test
    path) is accepted. Anyone else gets 503 "Twilio signature required".
  - **`/api/sms/config` POST** currently spreads any patch into the live
    config. It will accept only `enabled` (boolean) and `allowlist`: at most
    25 entries of `{ phoneNumber: E.164, name ≤ 64 chars, tier: admin |
    readonly }`. Unknown keys return 400.
- **R3-SEC-007: `/api/feed-discovery`'s first hop isn't IP-pinned.**
  - The homepage fetch and the HEAD probes re-resolve DNS after `isSafeUrl`
    has checked it (a DNS-rebinding window).
  - Fix: reuse the rss-proxy approach. Pin each hop to the address
    `isSafeUrl` resolved, follow redirects manually, and re-validate every
    hop.
- **R4-LOW-004: the Patreon OAuth callback** writes `JSON.stringify(payload)`
  into an inline `<script>`, where a `</script>` in the payload breaks out.
  Fix: escape `<`, `>`, `&`, U+2028 and U+2029 before interpolating.

## B: CI

- **R4-LOW-002: actions expression injection.**
  - `auto-merge-agent-branches.yml` pastes `github.ref_name` and step outputs
    into bash and into JS string literals, and also pastes the
    `AUTO_MERGE_PAT` secret into a JS literal to test whether it exists.
  - Fix: every value travels through `env:` and is read as `"$BRANCH"` or
    `process.env.BRANCH`; the PAT check becomes an env boolean.
  - Add a pinned `zizmor` audit to `actionlint.yml` (decision C).
- **R4-LOW-003: unpinned MCP servers in `.github/mcp.json`.** Pin exact
  versions: npm `@x.y.z`, `uvx mcp-server-fetch==x.y.z`, and the
  github-mcp-server image by `@sha256:` digest. Versions are checked against
  the registries at implementation time.

## C: native

- **R3-SEC-008:** remove `com.apple.security.cs.allow-unsigned-executable-memory`
  from `Entitlements.plist`; keep `allow-jit`.
  - The bundled `node` keeps the Node.js Foundation's own signature and
    entitlements: Q17 verified that packaging doesn't re-sign it.
  - WebKit's JIT and the ML worker run in Apple's WebContent process, not in
    our binary.
  - The Rust host doesn't JIT. A plist test pins the change. Smoke test:
    decision B.
- **R4-LOW-007:** the sidecar's stdout/stderr file (`local-api.log`) rotates
  only at spawn, so a multi-week session can grow it without bound.
  - Your log folder is 46 MB today; `local-api.log` is 3.6 MB as of the last
    run on September 21. That confirms the gap, but it isn't urgent.
  - Fix: a background check every 60 s rotates by **copy-then-truncate**. The
    child keeps its append-mode descriptor, so truncation is safe, which is
    the standard logrotate technique for processes that can't reopen their
    log.
  - The trade-off is that a line written between the copy and the truncate
    can be lost. Piping through Rust was rejected, because a stalled reader
    could block the sidecar on a full pipe.

## D: renderer

- **R4-LOW-001:** `migrateAnalyticsConsent()` writes consent `'true'` for any
  install that predates the consent banner. Implied consent is the wrong
  default for a privacy-first app (inert today: no PostHog key in any build).
  - Fix: migration never writes `'true'`. Existing installs are left
    unanswered, so the banner asks.
  - What to do about installs already auto-migrated to `'true'` is
    decision D.

## Decisions for you

| | Recommended | Alternatives |
|---|---|---|
| **A. PR split** | Four PRs by area, as above | Eight PRs (one per finding); one combined PR (conflicts with three stacks) |
| **B. Entitlement smoke test** | Remove it; you check the app after main-sync next installs it (map, sidecar status, ML features) | I build and package a local release to smoke-test before the PR (about 20 min of builds); defer R3-SEC-008 |
| **C. zizmor in CI** | Add a version-pinned zizmor job | Fix the injections only |
| **D. Existing consent** | Ask once more: consent recorded before this change is reset to "unanswered", so the banner asks explicitly | Fix new migrations only (an install already auto-set to `'true'` stays `'true'`) |

## Tests (fakes only; mutation proof per behavior)

- **A:** SMS 503 without a Twilio token, the bearer path still passing, and
  config schema rejections; pinned fetches for feed-discovery (resolver and
  fetch stubbed); a hostile payload that can't escape the script.
- **B:** a workflow lint test (no `${{ }}` inside `run:` or `script:`
  blocks); exact pins in `mcp.json`.
- **C:** a plist assertion; a Rust unit test for copy-then-truncate on a
  temporary file.
- **D:** migration never writes `'true'`; reset of pre-version consent; an
  explicit choice persists.

## Approval requirement

Implementation starts only after Bradley answers A–D.
