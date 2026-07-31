# Agent Access

Crystal Ball exposes live, local-first intelligence to MCP-compatible agents. The desktop app owns credentials and upstream access; the MCP server communicates over standard input/output and calls only the authenticated localhost sidecar.

## Requirements

- Crystal Ball for macOS must be installed and open for live intelligence.
- Node.js 20 or newer is required.
- Provider keys remain in Crystal Ball's credential store. Agent clients do not receive them.

## Install

From a Crystal Ball checkout:

```sh
npm run mcp:install-local
```

The default command prefix is `~/.local`. Add `~/.local/bin` to `PATH` if it is not already present.

Use a custom prefix or skip the optional safety-monitor LaunchAgent:

```sh
npm run mcp:install-local -- --prefix /your/prefix
npm run mcp:install-local -- --no-monitor
```

Existing `crystalball-mcp`, `crystalball-monitor`, and `crystalball-monitor-install` commands remain available. The installer also adds the task-oriented `crystalball` command.

## First checks

```sh
crystalball doctor
crystalball capabilities
crystalball safeguard-demo
```

`doctor` checks installation, Node.js, the local sidecar, discovered agent clients, the safety monitor, compatibility, and the canonical tool registry. Checks are independent, so one failure does not hide the remaining results. Use `--json` for automation.

Stable doctor exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Ready |
| `1` | Available with warnings |
| `2` | Unavailable or incompatible |
| `64` | Invalid command usage |

Doctor output is deliberately limited. It never returns bearer tokens, credentials, client configuration contents, or user-specific filesystem paths.

## Connect an agent client

Configure a local stdio MCP server with:

```json
{
  "mcpServers": {
    "crystalball": {
      "command": "crystalball-mcp"
    }
  }
}
```

Restart the client after changing its MCP configuration. Ask it to call `check_feed_health` and `get_capabilities` before a broad intelligence request. A useful first query is: "Check Crystal Ball's available capabilities, then give me a sourced situation report and identify missing feeds."

## Commands

| Command | Purpose |
| --- | --- |
| `crystalball doctor [--json]` | Diagnose installation, runtime, clients, monitor, and compatibility |
| `crystalball capabilities [--json]` | List every tool with its user-facing permission |
| `crystalball monitor [--json]` | Read the latest local safety-monitor result |
| `crystalball safeguard-demo [--json]` | Prove synthetic fail-closed boundaries without live access |
| `crystalball evidence --input FILE --output FILE [--json]` | Export Evidence Packet v1 |
| `crystalball help` | Show command help |

## Permissions

Permission labels are generated from each tool's canonical MCP safety annotations. Runtime authorization remains authoritative.

| Code | Meaning |
| --- | --- |
| `read_external` | Reads local Crystal Ball data that may come from external providers; no state change |
| `read_local` | Reads only local status or history; no provider contact or state change |
| `change_local` | Changes local state without deleting records or contacting providers |
| `manage_local` | Creates, updates, or deletes local records; confirm the requested change |
| `act_external` | Contacts live providers and records local results; run only on request |

The complete generated registry is in `tools/mcp-server/docs/registry.md` and `registry.json`. `npm run mcp:docs:check` fails when these files drift from runtime metadata.

## Safeguard demo

The safeguard demo uses fixed synthetic fixtures. It does not read production monitor state or raw files, read credentials, write state, or make network requests. It demonstrates that unsafe derived conclusions are quarantined while independent direct-source observations remain available.

The demo is educational evidence, not a replacement for `doctor` or live monitor status.

## Evidence Packet v1

Prepare a JSON input containing a fixed `generatedAt`, query context, and a Crystal Ball result, then export it:

```sh
crystalball evidence --input observation.json --output evidence.json
```

Evidence Packet v1 includes producer and contract versions, compatibility, permission context, direct-source provenance, observation freshness, warnings, missing capabilities, algorithm versions, quarantine state, and a SHA-256 integrity digest. Sensitive key names and common credential/path patterns are removed. Inputs larger than 1 MB are rejected. Output is written atomically with owner-only `0600` permissions, so a failed export does not leave a partial file.

For reproducibility, provide an explicit `generatedAt`. Identical sanitized input produces the same packet and digest.

## The two schedules

- The safety monitor normally runs every 15 minutes. It checks feed health, algorithm drift, and quarantine state.
- Sentinel's intelligence sweep normally runs every 30 minutes. It builds historical intelligence snapshots for trends, anomalies, watchlists, and alert rules.

They are separate systems. Changing or disabling one schedule does not change the other.

## Update, uninstall, and rollback

Rerun the install command after updating the checkout. To remove a custom-prefix installation:

```sh
npm uninstall --global --prefix /your/prefix crystalball-mcp
```

Use `~/.local` as the prefix when removing the default installation. The CLI and evidence contract are additive; rolling back the package does not rewrite monitor history. Existing Evidence Packet v1 files remain plain JSON and readable.

## Troubleshooting

- **Runtime unavailable:** Open Crystal Ball and rerun `crystalball doctor`.
- **No configured client:** Confirm the client points to the installed `crystalball-mcp` executable, then restart it.
- **Monitor unknown:** Run `crystalball-monitor` once or install the optional monitor scheduler.
- **Compatibility warning:** Update Crystal Ball and the installed MCP package from the same release.
- **Missing capabilities:** Configure the relevant provider key in Crystal Ball. Do not put provider keys in agent configuration.
- **Permission denied on export:** Choose a directory you own. The exporter never weakens filesystem permissions.

If a check is still failing, use `crystalball doctor --json`. Its output is designed to be safe to share, but review any diagnostic artifact before publishing it.
