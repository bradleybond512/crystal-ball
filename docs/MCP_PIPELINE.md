# Crystal Ball MCP Pipeline

Crystal Ball exposes its local intelligence surface to MCP-compatible agents without exposing a remote MCP port or provider credentials.

## Data flow

```text
MCP-compatible agent
  | stdio / JSON-RPC
  v
Crystal Ball MCP server (59 tools across 9 categories)
  | authenticated HTTP on 127.0.0.1
  v
Crystal Ball desktop sidecar
  | HTTPS, provider credentials owned by the app
  v
Direct intelligence providers and local analysis
```

The agent starts `crystalball-mcp` as a child process. The server discovers the current sidecar port and per-session bearer token from owner-only runtime files. Every sidecar request is constrained to loopback and authenticated. The stdio MCP transport opens no listening network port.

## Authentication and privacy boundary

1. Crystal Ball generates a per-session local token when the app launches.
2. The token and selected sidecar port are stored in the app's private runtime directory with owner-only permissions.
3. The MCP sidecar client rereads them for each request so desktop restarts and token rotation are handled safely.
4. The client rejects non-relative routes and verifies the resolved host remains `127.0.0.1` before attaching authorization.
5. The sidecar validates the token before serving protected routes.
6. The app removes session runtime credentials on exit.

Provider credentials stay in Crystal Ball's credential store. MCP results, doctor output, safeguard demonstrations, monitor projections, and Evidence Packet exports must not contain them.

## Canonical contracts

`tools/mcp-server/tool-registry.mjs` is the source of truth for tool names, categories, descriptions, MCP safety annotations, and plain-language permissions. `server-meta.mjs` owns server, protocol, skill-contract, and evidence-format compatibility metadata.

Run:

```sh
npm run mcp:docs
npm run mcp:docs:check
```

The first command regenerates the registry reference. The second fails when checked-in documentation no longer matches runtime metadata.

## Tool families

The canonical 59-tool surface has nine categories:

- Foundation: allowlisted raw queries, chaining, and snapshot comparison.
- Intelligence: correlation, trend, and anomaly analysis.
- Watchlists & Alerts: persistent local watchlists and alert rules.
- Aggregate: broad multi-source situation, threat, market, cyber, weather, infrastructure, and military summaries.
- Granular: focused conflict, news, IP, CVE, vessel, flight, sanction, economic, filing, seismic, disease, and regional lookups.
- Analyst: renderer hypotheses, forecasts, feedback, and reasoning diagnostics.
- Intel Expansion: cyber, supply, infrastructure, aviation, finance, disaster, and radiation sources.
- Diagnostics: capabilities, monitor status, runtime diagnostics, and algorithm health.
- Help: generated reference topics and examples.

See `tools/mcp-server/docs/registry.md` for the generated tool-by-tool reference.

## Responses and partial failure

Most tools return a structured envelope containing a summary, data, sources, warnings, timestamp, and health state. The MCP transport returns both readable text and structured content. Provider failures are retained as warnings when a useful partial result remains; missing or incompatible safety data is never labeled healthy.

Agents should call `check_feed_health` and `get_capabilities` before broad analysis, preserve direct-source attribution, distinguish observations from derived conclusions, and disclose unavailable domains.

## Safety and quarantine

Algorithm diagnostics can quarantine unsafe or failing derived systems. Quarantine blocks conclusions that depend on the affected algorithm. It does not conceal independent direct-source observations. Raw analyst-state files are not general-purpose MCP routes.

`crystalball safeguard-demo` demonstrates these boundaries entirely with synthetic data. It cannot read runtime state, raw files, secrets, or the network and cannot write anything.

## Monitoring schedules

The safety monitor and Sentinel are separate:

- The safety monitor normally evaluates feed health, algorithm drift, and quarantine state every 15 minutes.
- Sentinel normally collects broader intelligence snapshots every 30 minutes for history, trends, anomaly analysis, watchlists, and alerts.

The MCP server's in-process safety scheduler is off unless explicitly configured. The installed macOS LaunchAgent is the normal single owner of recurring safety-monitor execution.

## Installed command surface

`npm run mcp:install-local` installs:

- `crystalball`: doctor, capabilities, monitor, safeguard demo, evidence export, and help.
- `crystalball-mcp`: stdio MCP server.
- `crystalball-monitor`: one safety-monitor cycle.
- `crystalball-monitor-install`: optional macOS safety-monitor scheduler installation.

The installer supports `--prefix DIR` and `--no-monitor`. See `docs/AGENT_ACCESS.md` for client setup, exit codes, permissions, evidence format, upgrades, uninstall, troubleshooting, and rollback.

Client registrations should use the absolute installed `crystalball-mcp` path. The installed `crystalball doctor` verifies that sibling executable with an MCP initialize handshake and reports path-dependent registrations as non-portable without exposing the path.

## Key files

| File | Role |
| --- | --- |
| `tools/mcp-server/index.mjs` | MCP transport and tool registration |
| `tools/mcp-server/cli.mjs` | Installed task-oriented command dispatcher |
| `tools/mcp-server/tool-registry.mjs` | Canonical tools, annotations, and permissions |
| `tools/mcp-server/server-meta.mjs` | Version and compatibility contract |
| `tools/mcp-server/sidecar-client.mjs` | Loopback discovery, authentication, and requests |
| `tools/mcp-server/doctor.mjs` | Privacy-safe independent health checks |
| `tools/mcp-server/safeguard-demo.mjs` | Pure synthetic safety demonstration |
| `tools/mcp-server/evidence-packet.mjs` | Deterministic redacted Evidence Packet v1 export |
| `tools/mcp-server/tools/monitor.mjs` | Persistent safety-monitor evaluation |
| `docs/AGENT_ACCESS.md` | Task-oriented installation and operations guide |
