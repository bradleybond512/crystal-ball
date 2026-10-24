# Privacy and data handling

This describes the repository's current data paths. macOS is the primary desktop
platform; Windows/Linux builds are experimental. Hosting providers, feed providers
and connected agents apply their own processing and retention policies.

## Data kept on this device

The app uses localStorage, IndexedDB, caches and desktop app-data files for different
purposes. These stores do not share one encryption or retention policy. Saved-place
names, coordinates and notes are stored in localStorage (`wm_saved_places_v1`), along
with other preferences and state. Alerts, snapshots, watchlists, reasoning records
and exports can contain personal or operational context. Treat the device profile,
backups and exported files accordingly. There is no universal automatic deletion
deadline or guarantee that clearing one feature removes all copies.

Desktop credentials use the consolidated `secrets-vault` item under native service
`crystal-ball`. Variants using that service share its namespace. Native code supplies
sidecar-only credentials to the local process; an explicit 17-entry allowlist also
returns values needed by the renderer, including map tokens, connection settings and
the cloud client key. The renderer therefore does see some credential values.

On macOS, an AES-256-GCM encrypted `secrets-vault-shadow.json` copy supports recovery
when Keychain reads time out. Its key is derived from the machine identifier rather
than stored in Keychain. This limits use of a copied file on another machine, but
does not protect against code running on the same host that can derive that key.
The shadow copy is skipped where a stable machine-bound key is unavailable. Credential
storage is not encryption of every saved place, alert or application record.

Web builds can save user-entered keys in a passphrase-encrypted IndexedDB vault
(AES-GCM, PBKDF2-SHA-256 with 600,000 iterations). Unlocked keys are available in
memory for enabled features. The vault locks when the tab becomes visible after at
least 15 minutes hidden; there is no timer guaranteeing a wipe while the tab stays
hidden. The app cannot recover a lost passphrase. Destroying the vault affects that
vault, not every other app store or previously exported file.

## Product analytics

PostHog capture requires a configured build key and explicit user opt-in.
Ghost Mode gates initialization, app-managed events and queue flush. The app sends
PostHog events directly, without the PostHog SDK's automatic page-leave capture.
Enabling Ghost or revoking consent stops new captures and aborts the app's in-flight
PostHog capture requests. Web Vercel Analytics sends use the product analytics
consent/Ghost check. Consent can be changed in Settings.

PostHog uses a random persistent installation ID, app version, platform and variant.
This is pseudonymous identification, not anonymity. Event schemas allow specific
interaction properties such as panel/layer IDs, country codes, webcam selections,
search query length/result count and update actions. Key-configuration telemetry
contains a configured-key count, not key values or a per-key presence map. The app
does not initialize PostHog interaction autocapture, session recording or automatic
page-leave capture. Desktop offline events may queue locally and send after
reconnection when allowed. Revoking consent stops capture and tries to clear the
app's installation ID and queued events; it does not erase events already delivered
to a service.

## Error reporting is separate

Web Sentry reporting is enabled by a non-empty `VITE_SENTRY_DSN`, except the localhost
and native-desktop cases disabled by `src/main.ts`. It does not use the product
analytics consent or Ghost gate. Its configuration uses `sendDefaultPii: false`,
error filters and performance sampling. Those settings do not guarantee that every
message, stack, URL, context or integration payload is free of personal information.
An empty DSN disables this configured reporting path.

## Data that can leave the device

Enabled features can request feeds, maps, geocoding, routes, provider lookups, cloud
fallbacks and AI services. Requests can reveal network metadata and feature-specific
inputs such as coordinates, account/indicator queries, selected content or prompts.
Local Ollama is one AI option; choosing a hosted provider sends its request context
to that provider. Optional messaging/notification integrations and explicit agent
actions have their own destinations and permissions.

The MCP server uses local stdio and an authenticated loopback sidecar client, but
the connected agent receives tool results and may transmit them to its model or
other services. Some tools change local records or perform live checks. Review tool
permissions and agent configuration. Exported reports, diagnostic bundles, backups
and Evidence Packets become separate copies under the control of whoever receives
them. Local-first does not mean nothing leaves the device; Ghost is not a network
air gap or a universal suppression switch.

## Controls and reporting

Use Settings to manage keys, optional features, product analytics consent and Ghost
Mode. Self-hosted builds can omit telemetry keys/DSNs and choose their provider
configuration. Removing browser site data or a desktop profile can remove local
state but is destructive and does not recall remote requests, backups or exports.
Review the relevant service's policy for data already sent there.

Report suspected leaks through [the security reporting process](SECURITY.md).
Implementation references: [analytics](src/services/analytics.ts),
[Sentry initialization](src/main.ts), [saved places](src/services/saved-places.ts),
[web key vault](src/services/web-secret-store.ts),
[native credential boundary](src-tauri/src/main.rs), and
[MCP permissions](tools/mcp-server/tool-registry.mjs).
