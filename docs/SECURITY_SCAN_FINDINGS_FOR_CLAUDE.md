# Security Scan Findings For Claude

Checked: April 28, 2026. Reconciled against `SECURITY_AUDIT_2026-06-11.md` on
June 11, 2026.

Goal: bring Crystal Ball toward an elite desktop/web security posture. This is
not a full third-party penetration test, but it is an actionable repo-grounded
scan using existing scripts, dependency audit, and targeted static review.

**Status legend** (per-finding labels reflect the 2026-06-11 reconciliation):
🔴 Open · 🟡 In Progress · ✅ Fixed · 🟢 Tracked/Accepted (mitigated).

## Copy/Paste Prompt For Claude

```text
Read docs/SECURITY_SCAN_FINDINGS_FOR_CLAUDE.md before writing code.

Fix the findings in priority order. Start with the smallest safe PR:
1. remove or narrow broad secret-returning Tauri commands,
2. tighten CSP without breaking the desktop sidecar,
3. add centralized safe HTML/sanitizer rules and tests,
4. align preview-origin allowlists,
5. harden RSS/proxy URL validation.

Do not disable security protections to make tests pass. Add regression tests for
each security boundary. Run npm run secrets:scan, npm audit --audit-level=moderate,
npm run lint:strict, and npm run typecheck:all before claiming completion.
```

## Scan Evidence

Commands run:

- `npm run secrets:scan`: passed, 1887 files scanned.
- `npm audit --audit-level=moderate`: passed, 0 vulnerabilities.
- `npm run lint:strict`: passed.
- targeted static scan for HTML sinks, eval, Tauri commands, local sidecar auth,
  CORS/CSP, shell/process calls, secret handling, and proxy allowlists.
- `npm run typecheck:all`: failed on current untracked local UI work, not on the
  security scan itself.

Current typecheck blockers:

- `src/components/AlgorithmDiagnosticPanel.ts`: missing
  `@/services/algorithms/safe-adjustment`, unused `refreshTimer`.
- `src/components/CommandCenterPanel.ts`: unused `refreshTimer`.
- `src/components/SystemDiagnosticPanel.ts`: missing
  `@/services/diagnostics/self-test`, unused `refreshTimer`, implicit `any`
  parameters.

## Executive Summary

No committed secrets and no npm advisory vulnerabilities were found.

The major security work is architectural hardening:

- reduce what a compromised trusted renderer can do
- remove or justify CSP escape hatches
- centralize HTML sanitization instead of relying on many local `innerHTML`
  call sites
- align all origin allowlists to the strictest pattern
- harden proxy URL validation across direct and relay paths

## Findings

### SEC-001: Trusted-Window Renderer Can Read Every Configured Secret Key-By-Key

Severity: High. **Status: 🔴 Open** (description corrected 2026-06-11 — original
overstated the exposure).

> **Correction (2026-06-11 audit):** the original finding claimed a broad
> `get_all_secrets` IPC command that returns a `HashMap<String, String>` of
> every key in one call. **No such command exists** in the current 33-command
> IPC surface — the audit enumerated all `#[tauri::command]` functions and found
> only the per-key `get_secret`. The real (lesser, but still High-severity)
> exposure is described below.

Location:

- `src-tauri/src/main.rs:724` (`get_secret`)
- `src-tauri/src/main.rs:42` (`SUPPORTED_SECRET_KEYS: [&str; 73]`)
- `src/services/runtime-config.ts` (renderer call sites)

Evidence:

```text
#[tauri::command]
fn get_secret(webview: Webview, key: String, ...) -> Result<Option<String>, String> {
    require_trusted_window(webview.label())?;
    if !SUPPORTED_SECRET_KEYS.contains(&key.as_str()) { return Err(...); }
    Ok(secrets.get(&key).cloned())
}
```

Impact:

`get_secret` is gated by `require_trusted_window`, but a trusted-window renderer
(or any XSS / malicious dependency executing inside it) can iterate the 73 known
`SUPPORTED_SECRET_KEYS` and call `get_secret` once per key, reconstructing the
full secret set. There is no single-call dump, so the blast radius is narrower
than originally documented, but the effective outcome for a compromised trusted
renderer is the same. The code already acknowledges this renderer trust boundary
in `src/services/runtime.ts:231-249`.

Fix:

- Return only the specific key the active settings screen is editing, after an
  explicit user action; avoid bulk per-key enumeration paths in the renderer.
- Keep actual provider secrets in Keychain and sidecar memory, not renderer
  memory, wherever a feature can run server-side.
- Consider a capability split so only the settings window can read secret values
  and the main window cannot.
- Add tests proving unsupported windows cannot invoke `get_secret` and that the
  command rejects keys outside `SUPPORTED_SECRET_KEYS`.

Mitigation if a full split is too large:

- Mask values in the renderer unless the user is actively editing one key.
- Add diagnostics that flag when many distinct `get_secret` reads occur in a
  short window (bulk-enumeration heuristic).

### SEC-002: Desktop CSP Allows `unsafe-eval` And Broad Local Frame/Connect Access

Severity: High. **Status: 🔴 Open** — `frame-src` narrowing is scheduled
(audit M-2, plan T3-B); `unsafe-eval` removal is blocked on Cesium strict-CSP
support (audit I-1/I-2, backlog T4-C); `connect-src https:` narrowing is backlog
T4-B.

Location:

- `src-tauri/tauri.conf.json:34`
- `index.html:7`

Evidence:

```text
script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'
connect-src 'self' https: http://127.0.0.1:* ws: wss:
frame-src 'self' http://127.0.0.1:*
```

Impact:

`unsafe-eval` weakens XSS containment. Broad `127.0.0.1:*` connect/frame access
also increases the impact of a renderer compromise because the app can reach or
embed arbitrary local services, not only Crystal Ball's sidecar.

Fix:

- Inventory which libraries require `unsafe-eval` or `wasm-unsafe-eval`.
- Remove `unsafe-eval` if possible.
- If WebAssembly requires eval-like behavior, scope and document why.
- Replace `127.0.0.1:*` with the specific sidecar port where feasible.
- If the sidecar port must remain dynamic, add a startup-generated CSP or a
  narrower allowlist.

Mitigation:

- Add a CI check that fails on new CSP weakening.
- Add a security note documenting any unavoidable CSP exception.

### SEC-003: Web CSP Allows Inline Scripts And Eval-Like Execution

Severity: High. **Status: 🔴 Open** — not yet scheduled; depends on HTML-sink
centralization (SEC-007) before `unsafe-inline` can be safely removed.

Location:

- `index.html:7`

Evidence:

```text
script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'
```

Impact:

The web build has weaker XSS defenses than an elite security posture should
allow. If any HTML injection lands, inline script and eval allowances reduce CSP
as a defense-in-depth layer.

Fix:

- Remove `unsafe-inline` and `unsafe-eval` from web CSP.
- Move inline bootstrapping into bundled scripts.
- Add script nonces or hashes only where strictly required.
- Consider Trusted Types once risky HTML sinks are centralized.

Mitigation:

- If Vite/dev tooling needs exceptions, make them dev-only.
- Add production CSP tests that inspect the built `index.html`.

### SEC-004: Broad Vercel Preview Origin Regexes Are Inconsistent With Stricter CORS Rules

Severity: Medium. **Status: 🟡 In Progress** — being anchored to the deploy
account slug (`…-bradleybond512.vercel.app`) under audit M-5 / plan T2-D
(`claude/sec-vercel-origin-regex`).

> **Related item ✅ Fixed (2026-06-11 audit):** the separate *sebuf wildcard-CORS
> fallback* flagged in `SECURITY_SCAN_ROUND_2_FOR_CLAUDE.md` is now fail-closed.
> The handler at `api/[domain]/v1/[rpc].ts:167-185` rejects disallowed origins
> with HTTP 403 (`isDisallowedOrigin` check + a `getCorsHeaders` try/catch that
> also returns 403). Verified directly during the 2026-06-11 audit. This is a
> distinct code path from the Vercel preview-origin regexes below, which remain
> open.

Location:

- `api/_api-key.js:8-15`
- `api/youtube/embed.js:13-20`
- stricter reference: `api/_cors.js:1-23`

Evidence:

```text
// api/_api-key.js
/^https:\/\/crystalball-[a-z0-9-]+\.vercel\.app$/

// api/youtube/embed.js
/^https:\/\/crystalball-[a-z0-9-]+\.vercel\.app$/

// api/_cors.js documents avoiding broad wildcard-like Vercel matches.
```

Impact:

The CORS helper was tightened to avoid unrelated Vercel projects gaining trust
by matching a similar preview hostname, but `_api-key.js` and the YouTube embed
endpoint still use broader patterns. That creates policy drift and possible
confused-origin trust.

Fix:

- Replace broad preview regexes with the username-anchored patterns from
  `api/_cors.js`.
- Put the origin patterns in one shared module so API key validation, CORS, and
  embed endpoints cannot drift.
- Add tests for accepted Bradley/Elie preview hosts and rejected lookalikes.

### SEC-005: RSS Proxy Does Not Require HTTPS For Allowlisted Feeds

Severity: Medium. **Status: 🟡 In Progress** — the audit re-confirmed this as
part of the plain-HTTP family (audit H-1/H-2). The sidecar's plain-HTTP external
API calls are being switched to HTTPS by PR `claude/sec-https-urls` (plan T1-A),
with a CI guardrail in T2-A. The RSS-proxy-specific HTTPS-enforcement and
dev-proxy manual-redirect parity described below are not yet covered by that PR
and remain to be scheduled.

Location:

- `api/rss-proxy.js:440-452`
- `api/rss-proxy.js:469-486`
- `vite.config.ts:509-528`

Evidence:

```text
const parsedUrl = new URL(feedUrl);
...
if (!ALLOWED_DOMAINS.has(hostname) ...)
...
const response = await fetch(feedUrl, ...)
```

The production proxy validates host allowlist and redirect host allowlist, but
does not require `https:`. The dev proxy also validates host but uses
`redirect: 'follow'`.

Impact:

An allowed HTTP feed can be downgraded or modified in transit. The dev proxy is
also weaker than production because it follows redirects automatically rather
than validating each redirect target.

Fix:

- Require `https:` for RSS proxy requests unless a feed has a documented
  exception.
- Represent exceptions as `{ host, allowHttp: true }`, not implicit behavior.
- Make the dev proxy use the same manual redirect validation as production.
- Add tests for `http://rss.cnn.com`, redirect-to-private-IP, and
  redirect-to-disallowed-domain behavior.

### SEC-006: Local API Token Is Persisted To A File For Tooling

Severity: Medium. **Status: 🟢 Tracked/Accepted (mitigated)** — re-confirmed by
the 2026-06-11 audit as M-1. The at-rest copy is accepted for now with these
mitigations in place: file written mode `0600`, the token is rotated
per-session, and the file is deleted on clean shutdown. The ideal fix —
eliminating the at-rest copy via an in-memory token handoff to the MCP server at
spawn time — is tracked as backlog plan T4-A.

Location:

- `src-tauri/src/main.rs:1767-1785`
- `src-tauri/src/main.rs:2041`

Evidence:

```text
let token_file = logs_dir_path(app)?.join("sidecar.token");
fs::write(&token_file, &local_api_token)
fs::set_permissions(&token_file, fs::Permissions::from_mode(0o600))
...
fs::remove_file(log_dir.join("sidecar.token"));
```

Impact:

Permissions are correctly set to `0600`, but a bearer token on disk still
increases exposure to local malware, backups, accidental diagnostics export, and
stale-file failures.

Fix:

- Prefer in-memory token handoff when possible.
- If the file remains necessary for MCP/local tools, rotate the token on sidecar
  restart and after diagnostics export.
- Ensure diagnostics bundles never include `sidecar.token`.
- Add a startup self-test that verifies mode `0600`, owner, and cleanup.

### SEC-007: HTML Injection Sinks Are Widespread And Need A Central Policy

Severity: Medium. **Status: 🔴 Open** — not yet scheduled; prerequisite for
hardening web CSP (SEC-003).

Location examples:

- `src/settings-window.ts:53`
- `src/settings-window.ts:68`
- `src/components/IntelligenceBriefingPanel.ts:310`
- `src/components/VirtualList.ts:391`
- `src/utils/dom-utils.ts:57-72`

Evidence:

```text
grid.innerHTML = panelHtml;
appEl.innerHTML = ...
contentEl.innerHTML = this.renderMarkdown(section.content);
element.innerHTML = html;
tpl.innerHTML = html;
```

Impact:

Many call sites are probably safe because they escape fields locally, but the
security posture depends on every future contributor remembering exactly where
escaping is required. AI-generated briefing content and feed/API data are
especially sensitive.

Fix:

- Create a `safe-html` utility with a clear contract.
- Ban raw `innerHTML` except through named reviewed helpers or constant-only
  paths.
- Replace AI-generated markdown rendering with DOM node construction or a
  sanitizer-backed markdown renderer.
- Add ESLint or custom static checks for new raw HTML sinks.
- Add tests with payloads such as `<img src=x onerror=alert(1)>`,
  `<a href="javascript:alert(1)">`, SVG payloads, and style/url payloads.

### SEC-008: Custom Sanitizer Allows Inline Style Attributes

Severity: Medium. **Status: 🔴 Open** — not yet scheduled; folds into the
SEC-007 central-sanitizer work.

Location:

- `src/utils/dom-utils.ts:63-72`
- `src/utils/dom-utils.ts:83-95`

Evidence:

```text
const SAFE_ATTRS = new Set(['style', 'class', 'href', 'target', 'rel']);
...
tpl.innerHTML = html;
```

Impact:

Allowing arbitrary `style` on sanitized HTML is broader than needed. Modern CSS
is less directly scriptable than old browser CSS, but inline styles can still
cause UI spoofing, tracking via external URLs in some contexts, or future sink
surprises. Since this app displays AI and external feed content, the safer
default is to disallow style in untrusted HTML.

Fix:

- Remove `style` from `SAFE_ATTRS` for untrusted HTML.
- If style is needed for trusted static snippets, create a separate
  `trustedStaticHtml` helper and keep it out of user/feed/AI paths.
- Consider DOMPurify or another mature sanitizer instead of maintaining a custom
  sanitizer.

### SEC-009: Window `open` Fallbacks Bypass Tauri `open_url` Policy

Severity: Low to Medium. **Status: 🔴 Open** — not yet scheduled.

Location examples:

- `src/components/api-key-gate.ts:94-96`
- `src/settings-main.ts:431-438`
- `src/components/RuntimeConfigPanel.ts:594-602`
- `src/app/event-handlers.ts:343`

Evidence:

```text
invokeTauri<void>('open_url', { url }).catch(() => window.open(url, '_blank'));
```

Impact:

The Rust `open_url` command enforces HTTPS and blocks internal/private hosts.
Fallbacks to `window.open` can bypass that policy if the URL was not already
sanitized at the call site.

Fix:

- Create one `openExternalSafe(url)` helper that validates via the same rules as
  Rust before any fallback.
- Remove direct `window.open` fallbacks for dynamic URLs.
- Add tests for `javascript:`, `http:`, localhost, private IPs, and allowed
  `https:` URLs.

### SEC-010: Clipboard Read Permission Should Be Narrowed Or Audited

Severity: Low. **Status: 🔴 Open** — not yet scheduled; the 2026-06-11 audit
notes clipboard read remains the broadest capability grant.

Location:

- `src-tauri/capabilities/default.json:6-10`
- `src/services/clipboard-watcher.ts:52`

Evidence:

```text
"clipboard-manager:allow-read-text"
...
read_text
```

Impact:

Clipboard read access can expose passwords, tokens, private messages, and other
sensitive content. It may be intentional, but it should be clearly opt-in and
diagnosable.

Fix:

- Confirm clipboard read is disabled until the user explicitly enables a feature
  that needs it.
- Add UI copy explaining what is read and when.
- Add diagnostics events for clipboard watcher start/stop, without recording
  clipboard contents.
- Consider splitting clipboard permission into a narrower window/capability if
  only one feature needs it.

## Positive Findings

- Secret scan passed across the repo.
- `npm audit --audit-level=moderate` found 0 vulnerabilities.
- Rust local API token generation uses OS CSPRNG.
- `open_url` blocks non-HTTPS and local/private addresses.
- `send_notification` and `send_imessage` strip AppleScript-meaningful
  characters and apply length/rate limits.
- RSS production proxy validates redirect host allowlist manually.
- Diagnostics export code includes redaction tests for bearer tokens and long
  hex strings.

## Suggested PR Order

### PR 1: Secret IPC Minimization

- Remove or constrain `get_all_secrets`.
- Add per-window/per-command capability tests.
- Keep renderer-visible secret data masked unless the user is actively editing a
  specific key.

### PR 2: CSP Hardening

- Split dev/web/desktop CSP explicitly.
- Remove web `unsafe-inline` and `unsafe-eval`.
- Document and minimize desktop `wasm-unsafe-eval`.
- Add a CSP regression test.

### PR 3: HTML Sink Governance

- Add a central sanitizer policy.
- Remove `style` from untrusted safe HTML.
- Add static checks that forbid new raw `innerHTML` without an allowlisted
  wrapper/comment.
- Add XSS payload tests for AI, feed, and markdown paths.

### PR 4: Origin Policy Unification

- Move origin regexes into one shared module.
- Align `_api-key.js`, `_cors.js`, and `youtube/embed.js`.
- Add lookalike Vercel preview tests.

### PR 5: Proxy URL Hardening

- Require HTTPS for RSS proxy feeds by default.
- Add explicit HTTP exceptions only where unavoidable.
- Make dev proxy match production redirect behavior.

### PR 6: Local Token And Clipboard Audit

- Add sidecar token file self-test and diagnostics redaction checks.
- Rotate or remove token file where feasible.
- Make clipboard reads opt-in and observable.

## Definition Of Done

- `npm run secrets:scan` passes.
- `npm audit --audit-level=moderate` passes.
- `npm run lint:strict` passes.
- `npm run typecheck:all` passes.
- New tests cover each changed security boundary.
- No new `unsafe-inline`, `unsafe-eval`, raw `innerHTML`, broad origin regex, or
  secret-returning IPC command is added without a documented exception.

---

Last reconciled against `SECURITY_AUDIT_2026-06-11.md` on 2026-06-11.
