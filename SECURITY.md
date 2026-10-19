# Security Policy

## Supported Versions

| Version | Supported |
| ------- | ------------------ |
| main | :white_check_mark: |

Only the latest version on the `main` branch is actively maintained and receives security updates.

## Reporting a Vulnerability

**Please do NOT report security vulnerabilities through public GitHub issues.**

If you discover a security vulnerability in Crystal Ball macOS, please report it responsibly:

1. **GitHub Private Vulnerability Reporting**: Use [GitHub's private vulnerability reporting](https://github.com/bradleybond512/crystal-ball/security/advisories/new) to submit your report directly through the repository.

2. **Direct Contact**: Alternatively, reach out to the repository owner [@bradleybond512](https://github.com/bradleybond512) directly through GitHub.

### What to Include

- A description of the vulnerability and its potential impact
- Steps to reproduce the issue
- Affected components (edge functions, client-side code, data layers, etc.)
- Any potential fixes or mitigations you've identified

### Response Timeline

- **Acknowledgment**: Within 48 hours of your report
- **Initial Assessment**: Within 1 week
- **Fix/Patch**: Depending on severity, critical issues will be prioritized

### What to Expect

- You will receive an acknowledgment of your report
- We will work with you to understand and validate the issue
- We will keep you informed of progress toward a fix
- Credit will be given to reporters in the fix commit (unless you prefer anonymity)

## Security Considerations

Crystal Ball is a client-side intelligence dashboard that aggregates publicly available data. Here are the key security areas:

### API Keys & Secrets

- **Web deployment**: hosted handlers use server-side credentials; user-entered web keys can also use a passphrase-encrypted IndexedDB vault and are available in memory while unlocked.
- **Desktop runtime**: native credential storage uses consolidated service `crystal-ball`. An explicit 17-entry allowlist exposes renderer-required values; other supported secrets expose presence to the renderer and are supplied natively to the sidecar.
- **macOS recovery copy**: an encrypted machine-bound shadow vault supports Keychain-timeout recovery. Its derivable key is not protection against code execution on the same host. See [Privacy](PRIVACY.md).
- No API keys should ever be committed to the repository
- Environment variables (`.env.local`) are gitignored
- The RSS proxy uses domain allowlisting to prevent SSRF

### Edge Functions & Sebuf Handlers

- Sebuf-generated domain APIs are served through Vercel routes in `api/[domain]/v1/[rpc].ts`, with a small set of legacy endpoints in `api/` for non-RPC or transport-specific workloads
- Edge functions and handlers should validate and sanitize all input
- CORS headers are configured per-function
- Rate limiting and circuit breakers protect against abuse

### Client-Side Security

- Saved-place names, coordinates and notes, preferences and other state use localStorage. The credential vault does not encrypt all application storage.
- External content (RSS feeds, news) is sanitized before rendering
- Provider data remains external input and must be validated at its boundary; a known source is not proof that every payload is safe or accurate.
- The desktop CSP includes `'self'`, `'unsafe-eval'` and `'wasm-unsafe-eval'` in script-src for runtime requirements; it is not a self-only/no-eval policy. See `src-tauri/tauri.conf.json` for the actual directives.

### Desktop Runtime Security (Tauri)

- **IPC origin validation**: Sensitive Tauri commands (secrets, cache, token) are gated to trusted windows only; external-origin windows (e.g., YouTube login) are blocked
- **DevTools**: Disabled in production builds; gated behind an opt-in Cargo feature for development
- **Sidecar authentication**: a per-session CSPRNG bearer token (`LOCAL_API_TOKEN`) protects authenticated routes. Explicit public callbacks/health routes have separate policy. Owner-only runtime files constrain access but do not exclude a same-user process that can read the token or a compromised renderer.
- **Capability isolation**: The YouTube login window runs under a restricted capability with no access to secret or cache IPC commands
- **Fetch patch trust boundary**: The global fetch interceptor injects the sidecar token with a 5-minute TTL; the renderer is the intended client — if renderer integrity is compromised, Tauri IPC provides strictly more access than the fetch patch

### Telemetry and external services

PostHog initialization requires explicit opt-in; Ghost gates app-managed analytics
paths, but an initialized SDK keeps automatic page-leave capture enabled. Ghost does
not invoke SDK opt-out; consent revocation does. DSN-configured web Sentry reporting
uses a separate gate; `sendDefaultPii: false` is not universal
redaction. Provider requests, optional hosted AI, cloud fallbacks, messaging, exports
and connected MCP agents can carry data beyond the device. See [Privacy](PRIVACY.md)
for storage and consent limits; no blanket no-egress or retention guarantee applies.

### Data Sources

- Crystal Ball aggregates publicly available OSINT data
- No classified or restricted data sources are used
- State-affiliated sources are flagged with propaganda risk ratings
- Feed ingestion is generally read-oriented. Optional integrations, explicit messaging,
  stateful MCP tools and user actions have their own effects and permissions; do not
  assume every operation is read-only.

## Scope

The following are **in scope** for security reports:

- Vulnerabilities in the Crystal Ball codebase
- Edge function security issues (SSRF, injection, auth bypass)
- XSS or content injection through RSS feeds or external data
- API key exposure or secret leakage
- Tauri IPC command privilege escalation or capability bypass
- Sidecar authentication bypass or token leakage
- Dependency vulnerabilities with a viable attack vector

The following are **out of scope**:

- Vulnerabilities in third-party services we consume (report to the upstream provider)
- Social engineering attacks
- Denial of service attacks
- Issues in forked copies of the repository
- Security issues in user-provided environment configurations

## Best Practices for Contributors

- Never commit API keys, tokens, or secrets
- Use environment variables for all sensitive configuration
- Sanitize external input in edge functions
- Keep dependencies updated — run `npm audit` regularly
- Follow the principle of least privilege for API access

---

Thank you for helping keep Crystal Ball and its users safe.
