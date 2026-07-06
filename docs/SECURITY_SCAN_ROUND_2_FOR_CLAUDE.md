# Security Scan Round 2 For Claude

Checked: April 28, 2026. **Reconciled against the codebase: July 4, 2026** —
most findings below have since been fixed; per-finding status:

| Finding | Status (2026-07-04) |
|---------|---------------------|
| R2-SEC-001 Rust audit tooling | ✅ cargo-audit + ✅ cargo-deny (sources/bans, `src-tauri/deny.toml`) in `security-audit.yml`. License allowlist enforcement still deferred. |
| R2-SEC-002 Semgrep SAST | ✅ `.github/workflows/sast.yml` (`p/typescript` + `p/secrets`, SHA-pinned action) |
| R2-SEC-003 auto-PR `contents: write` | ✅ top-level `contents: read`; single job re-elevates with documented justification (`enablePullRequestAutoMerge` requirement) |
| R2-SEC-004 cleanup workflow writes | 🟢 Accepted — `deleteRef`/PR-close genuinely need write; mitigated by dry-run default, deletion allowlist, merged-only + open-PR guards, audit log |
| R2-SEC-005 sebuf wildcard CORS fallback | ✅ fail-closed 403 (`api/[domain]/v1/[rpc].ts`) |
| R2-SEC-006 relay trusts any `.vercel.app` | ✅ owner-anchored preview patterns behind `ALLOW_VERCEL_PREVIEW_ORIGINS` (`scripts/ais-relay.cjs`) |
| R2-SEC-007 unauthenticated relay bypass | ✅ flag removed entirely; relay hard-exits without `RELAY_SHARED_SECRET`; timing-safe compare |
| R2-SEC-008 AppImage disables WebKit sandbox | ✅ loud stderr warning on disable + `CRYSTALBALL_KEEP_WEBKIT_SANDBOX=1` opt-out (`src-tauri/src/main.rs`). AppImage-level isolation rationale documented inline |
| R2-SEC-009 DMG mounted before verification | ✅ SHA-256 verified before write/mount; URL host allowlist; post-mount codesign verify |
| R2-SEC-010 version endpoint wildcard CORS | 🟢 Accepted exception — `PUBLIC_WILDCARD_CORS` annotation documented in `api/version.js`, now ENFORCED by `api/__tests__/wildcard-cors-policy.test.mjs` (unannotated wildcard = CI failure) |
| R2-SEC-011 scripted downloads need hash checks | ✅ `scripts/download-node.sh` verifies SHASUMS256 fail-closed; updater hash mandatory |
| R2-SEC-012 placeholder API tests | 🔴 Open — scaffolds under `api/__tests__/` still need real assertions |

This is an additional security scan pass after
`docs/SECURITY_SCAN_FINDINGS_FOR_CLAUDE.md`. Treat this as additive, not a
replacement.

## Copy/Paste Prompt For Claude

```text
Read docs/SECURITY_SCAN_FINDINGS_FOR_CLAUDE.md and
docs/SECURITY_SCAN_ROUND_2_FOR_CLAUDE.md.

Fix round-2 findings in priority order after the first security list. Focus on:
CI least privilege, relay/API CORS drift, Rust/Tauri audit tooling, Linux
sandbox posture, update installer hardening, and API cache/auth boundaries.
Add regression tests or CI checks for every fixed boundary.
```

## Three Additional Scan Angles

### Scan 1: Dependency And Supply Chain

Commands/checks:

- `npm audit --json`
- `cd src-tauri && cargo tree -e features`
- attempted `cargo audit --version`
- attempted `cargo deny --version`
- attempted `npx --yes semgrep --version`

Results:

- npm audit reported 0 vulnerabilities across 1149 dependencies.
- Rust dependency graph was generated successfully.
- `cargo-audit` is not installed.
- `cargo-deny` is not installed.
- Semgrep did not run because `npx` could not determine an executable.

### Scan 2: CI, GitHub Actions, Release Automation

Commands/checks:

- reviewed `.github/workflows/*`
- searched workflow permissions, pinned actions, token usage, `sudo`,
  shell/download patterns, and release automation

Results:

- Most GitHub Actions are pinned by SHA.
- Several workflows correctly use read-only permissions.
- Some automation has broader permissions than strictly necessary.
- Release workflow downloads a Node runtime via script and later builds signed
  desktop artifacts.

### Scan 3: API, Relay, CORS, Tauri Desktop Boundary

Commands/checks:

- searched CORS wildcard behavior
- reviewed relay authentication and preview-origin handling
- reviewed Tauri capabilities and sensitive commands
- reviewed updater/download/install path
- searched Linux sandbox/environment overrides

Results:

- Additional CORS and preview-origin drift found.
- Relay has an emergency unauthenticated bypass and broad Vercel preview option.
- Linux AppImage path disables WebKit sandbox under some conditions.
- Updater validates host, bundle ID, and codesign, but does not visibly verify a
  release manifest/hash before mounting.

## New Findings

### R2-SEC-001: Rust Security Audit Tooling Is Missing

Severity: High.

Location:

- `src-tauri/Cargo.toml`
- CI workflows

Evidence:

```text
cargo audit --version -> no such command
cargo deny --version -> no such command
```

Impact:

The desktop app depends on a large Rust/Tauri graph, but CI does not currently
prove RustSec advisories, yanked crates, duplicate crate policy, or license
policy. This is a blind spot for a high-security desktop app.

Fix:

- Add CI jobs for `cargo audit` and `cargo deny`.
- Add `deny.toml` with explicit policies for advisories, yanked crates, license
  allowlist, and duplicate versions.
- Run these on PRs touching `src-tauri/**`, `Cargo.toml`, or `Cargo.lock`.

### R2-SEC-002: Semgrep Or Equivalent SAST Is Not Operational

Severity: Medium.

Location:

- CI/security tooling

Evidence:

```text
npx --yes semgrep --version -> npm error could not determine executable to run
```

Impact:

Current scans rely mostly on custom regexes, lint, and manual review. That is
useful, but not enough for the "highest standards" target.

Fix:

- Add a working SAST job using Semgrep, CodeQL, or both.
- Include TypeScript, JavaScript, GitHub Actions, and Rust rules.
- Make the job non-blocking for the first PR if noise is high, then ratchet to
  required after triage.

### R2-SEC-003: Auto-PR Workflow Grants `contents: write`

Severity: Medium.

Location:

- `.github/workflows/auto-merge-agent-branches.yml:16-18`

Evidence:

```yaml
permissions:
  contents: write
  pull-requests: write
```

Impact:

This workflow creates/updates PRs and enables auto-merge. It likely does not
need repository contents write permission. Reducing token scope lowers blast
radius if an action/script path is compromised.

Fix:

- Change to `contents: read` unless a specific step proves write is required.
- Keep `pull-requests: write`.
- Add a workflow-permissions lint/check so new workflows default to read-only.

### R2-SEC-004: Cleanup Workflow Has Broad Write Permissions

Severity: Medium.

Location:

- `.github/workflows/cleanup-stale-branches.yml:8-10`

Evidence:

```yaml
permissions:
  contents: write
  pull-requests: write
```

Impact:

This scheduled/manual workflow closes PRs and deletes branches. That may be
intentional, but it is powerful automation that can remove remote refs.

Fix:

- Keep only the permissions each job needs.
- Add an allowlist so it can delete only agent branches.
- Add dry-run mode and require manual confirmation for branch deletion if
  possible.
- Add audit log comments that include branch/ref and reason.

### R2-SEC-005: Sebuf RPC CORS Fallback Opens `*` If CORS Helper Throws

Severity: Medium.

Location:

- `api/[domain]/v1/[rpc].ts:177-182`

Evidence:

```ts
try {
  corsHeaders = getCorsHeaders(request);
} catch {
  corsHeaders = { 'Access-Control-Allow-Origin': '*' };
}
```

Impact:

If the CORS helper throws, the fallback opens the response to any origin. This
is not ideal for authenticated or API-key-aware endpoints and conflicts with the
repo guidance to avoid wildcard CORS on authenticated endpoints.

Fix:

- Fail closed on CORS helper errors.
- Return `403` or default to `https://crystalball.app`, not `*`.
- Add a test that forces `getCorsHeaders` to throw and asserts no wildcard CORS.

### R2-SEC-006: Relay Can Trust Any Vercel App When Preview Flag Is Enabled

Severity: Medium.

Location:

- `scripts/ais-relay.cjs:74`
- `scripts/ais-relay.cjs:2650-2655`

Evidence:

```js
const ALLOW_VERCEL_PREVIEW_ORIGINS = process.env.ALLOW_VERCEL_PREVIEW_ORIGINS === 'true';
...
if (ALLOW_VERCEL_PREVIEW_ORIGINS && origin.endsWith('.vercel.app')) return origin;
```

Impact:

When enabled, any Vercel app origin is trusted by the relay CORS layer. This is
broader than the stricter preview-host patterns used elsewhere and can allow
lookalike third-party projects to call relay endpoints from browsers.

Fix:

- Replace `origin.endsWith('.vercel.app')` with the shared, owner-anchored
  Crystal Ball preview allowlist.
- Add tests for accepted preview origins and rejected lookalikes.
- Surface the current preview-origin mode in diagnostics as a warning when broad.

### R2-SEC-007: Relay Has Production Unauthenticated Bypass Flag

Severity: Medium.

Location:

- `scripts/ais-relay.cjs:61`
- `scripts/ais-relay.cjs:85-89`

Evidence:

```js
const ALLOW_UNAUTHENTICATED_RELAY = process.env.ALLOW_UNAUTHENTICATED_RELAY === 'true';
...
To bypass temporarily (not recommended), set ALLOW_UNAUTHENTICATED_RELAY=true
```

Impact:

The guard is explicit, which is good, but the existence of a production
unauthenticated bypass is a footgun for an internet-facing relay.

Fix:

- Remove production bypass support, or require an additional non-secret build
  flag that cannot be toggled by environment alone.
- If retained, emit a loud health-check failure and alert when enabled.
- Add CI/tests that assert production relay fails closed without
  `RELAY_SHARED_SECRET`.

### R2-SEC-008: Linux AppImage Path Disables WebKit Sandbox

Severity: Medium.

Location:

- `src-tauri/src/main.rs:2208-2218`

Evidence:

```rust
if env::var_os("APPIMAGE").is_some() {
  unsafe { env::set_var("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS", "1") };
}
```

Impact:

The comment explains this is for AppImage compatibility, but disabling WebKit's
sandbox increases impact if renderer content is compromised. This is especially
important because the app displays remote feeds, embedded media, maps, and
AI-produced content.

Fix:

- Prefer a compatibility probe or user-visible degraded mode before disabling
  sandbox globally.
- Limit the disablement to known broken distros/environments rather than every
  AppImage run.
- Add a diagnostics warning when sandbox is disabled.
- Document the exception and compensating controls.

### R2-SEC-009: Updater Mounts A Downloaded DMG Before Manifest/Hash Verification

Severity: Medium.

Location:

- `src-tauri/src/main.rs:1044-1169`

Evidence:

```rust
let host = parsed.host_str().unwrap_or("");
if !matches!(host, "objects.githubusercontent.com" | "github.com" | "codeload.github.com") ...
...
std::fs::write(tmp_dmg, &bytes)
...
hdiutil attach tmp_dmg
...
verify_app_bundle_signature(&source, "Mounted app bundle")?;
```

Impact:

The updater validates host, bundle ID, and code signature, which is strong.
However, it mounts the downloaded DMG before checking a signed manifest or
expected SHA-256. For elite update security, verify bytes before mounting.

Fix:

- Fetch release manifest/checksum first.
- Verify SHA-256 before `hdiutil attach`.
- Verify the manifest is produced by CI for the same tag/version.
- Prefer notarization/signing identity checks in addition to `codesign --verify`.

### R2-SEC-010: API Version Endpoint Uses Wildcard CORS

Severity: Low.

Location:

- `api/version.js:31-37`

Evidence:

```js
'Access-Control-Allow-Origin': '*'
```

Impact:

This endpoint appears public and read-only, so wildcard CORS may be acceptable.
But the repo should explicitly document endpoints allowed to use wildcard CORS
so future authenticated data does not copy the pattern.

Fix:

- Add a `PUBLIC_WILDCARD_CORS_ENDPOINTS` policy or comment.
- Add lint/test coverage that permits wildcard only for explicitly public
  endpoints.

### R2-SEC-011: Workflow Supply Chain Is Mostly Pinned But Scripted Downloads Need Hash Checks

Severity: Medium.

Location:

- `.github/workflows/build-desktop.yml:187`
- `.github/workflows/test-linux-app.yml:63`
- `scripts/download-node.sh`

Evidence:

```yaml
run: bash scripts/download-node.sh --target "$NODE_TARGET"
```

Impact:

Actions are mostly pinned by SHA, which is good. The remaining supply-chain
question is whether downloaded Node runtime artifacts are verified by checksum
or signature inside `scripts/download-node.sh`.

Fix:

- Audit `scripts/download-node.sh`.
- Require pinned Node version, SHA-256 verification, TLS-only URLs, and
  fail-closed behavior.
- Record the expected checksums in repo or fetch them from an authenticated,
  verified source.

### R2-SEC-012: API Test Scaffolds Are Still Placeholder-Heavy

Severity: Low to Medium.

Location examples:

- `api/__tests__/claude-agent.test.mjs`
- `api/__tests__/rss-proxy.test.mjs`
- `api/__tests__/opensky.test.mjs`
- other files matching `api/__tests__/*.test.mjs`

Evidence:

```text
TODO: Fill in handler-specific assertions. Each test currently validates...
```

Impact:

Security-sensitive API boundaries need targeted tests, not just scaffold tests.
Placeholder tests may create false confidence around CORS, auth, rate limiting,
SSRF, redirect validation, and secret redaction.

Fix:

- Add endpoint-specific negative tests for auth, CORS, malformed input, private
  IP/SSRF, redirect abuse, cache-control, and rate-limit failure.
- Prioritize `rss-proxy`, sebuf RPC, relay-backed endpoints, `claude-agent`, and
  update/version endpoints.

## Combined Priority Order

1. Keep the first security doc's high-priority items first: secret IPC, CSP,
   HTML sink policy.
2. Add RustSec/cargo-deny CI.
3. Fix sebuf wildcard CORS fallback.
4. Replace broad relay Vercel preview trust.
5. Remove or heavily alarm the unauthenticated relay bypass.
6. Harden updater with pre-mount checksum/manifest verification.
7. Tighten workflow permissions.
8. Add policy tests for wildcard CORS and public endpoints.
9. Audit Linux AppImage sandbox exception and surface diagnostics warning.
10. Replace placeholder API tests with boundary tests.

## Definition Of Done

- `npm run secrets:scan` passes.
- `npm audit --audit-level=moderate` passes.
- Rust advisory scan runs in CI.
- `cargo deny` policy exists and passes.
- SAST job exists or a documented equivalent is wired.
- No authenticated endpoint falls back to wildcard CORS.
- Relay preview origins use the shared strict allowlist.
- Update downloads are hash/manifest verified before mounting.
- Workflow permissions are least-privilege.
- `npm run typecheck:all` passes after current UI work is reconciled.
