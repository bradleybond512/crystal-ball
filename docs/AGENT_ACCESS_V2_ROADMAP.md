# Agent Access v2 Roadmap

Status: design complete; implementation awaiting high-assurance approval  
Owner: Codex  
Branch: `codex/agent-access-v2`

## Goal

Make Crystal Ball's local agent surface understandable, diagnosable,
permission-transparent, evidence-preserving, and operationally calm without
weakening authentication, quarantine, provenance, monitor atomicity, or direct
source availability.

## User value

- One installed command explains whether Crystal Ball, MCP, the monitor, and
  agent compatibility are working.
- Every tool has a plain-language permission label derived from runtime policy.
- Evidence can be exported with provenance, freshness, compatibility, and
  quarantine context.
- The desktop app shows a redacted live safety status instead of raw monitor
  files.
- Documentation and the public ChatGPT Site use the same canonical terms and
  generated capability data.

## Acceptance criteria

1. `crystalball doctor` works from an installed temporary prefix and returns
   human-readable and privacy-safe JSON reports with stable exit codes.
2. Compatibility is reported across desktop, MCP, skill contract, and protocol
   versions as `compatible`, `warning`, `incompatible`, or `unknown`.
3. Every canonical MCP tool has a user-facing permission label generated from
   the canonical registry; runtime authorization remains authoritative.
4. A synthetic, read-only safeguard demo proves that quarantine, raw-file,
   secret, and mutation boundaries fail closed without touching real state.
5. Monitor events are transition-based, deduplicated, cooldown-bounded, and
   include stopped/resumed detection plus last/next-run metadata.
6. The desktop consumes only an authenticated, allowlisted, redacted, bounded
   monitor projection and visibly distinguishes live, stale, degraded, stopped,
   incompatible, and unavailable states.
7. Evidence Packet v1 includes producer versions, compatibility, provenance,
   freshness, missing capabilities, permission context, algorithm versions,
   quarantine state, and a deterministic integrity digest.
8. Human documentation covers install, update, uninstall, `--no-monitor`,
   custom prefixes, client configuration, first query, privacy, troubleshooting,
   compatibility, permissions, evidence packets, and rollback.
9. Generated documentation fails CI when registry-derived files are stale.
10. The ChatGPT Site links to the current repository and clearly separates the
    15-minute safety monitor from the 30-minute Sentinel intelligence sweep.

## Constraints and non-goals

- No new dependencies unless separately approved with maintenance, licensing,
  bundle, and security evidence.
- No remote MCP exposure, cloud account system, autonomous remediation,
  prediction-algorithm changes, or raw monitor-file access from the renderer.
- Preserve localhost authentication, quarantine behavior, source attribution,
  monitor locking and atomic writes, and installer rollback.
- Missing or future-version data is `unknown` or `incompatible`, never healthy.

## Architecture

### Canonical contracts

- Extend `tools/mcp-server/tool-registry.mjs` with stable, user-facing permission
  metadata derived from existing MCP annotations.
- Extend `tools/mcp-server/server-meta.mjs` with explicit compatibility ranges.
- Introduce versioned evidence and compatibility builders beside
  `tools/mcp-server/result.mjs`; retain current transport shapes during one
  deprecation window.
- Generate reference documentation from the canonical registry and schema
  metadata rather than maintaining parallel hand-written lists.

### Runtime doctor and safeguard demo

- Extract reusable privacy-safe doctor checks from `scripts/doctor-core.mjs`.
- Add installed `crystalball` command dispatch with `doctor`, `capabilities`,
  `monitor`, `evidence`, and `safeguard-demo` subcommands.
- Doctor checks run independently with bounded timeouts and return partial
  results when one subsystem is unavailable.
- Safeguard demo uses synthetic fixtures only and cannot access the network,
  filesystem writes, production monitor state, or real credentials.

### Monitor events and projection

- Derive events only from committed monitor generations.
- Persist versioned cooldown/event metadata separately using the existing
  locking and atomic-replacement discipline.
- Emit one transition for opened, resolved, stopped, resumed, and materially
  escalated findings; never notify on every poll.
- Add an authenticated localhost sidecar route that serializes an explicit
  allowlist, applies recursive redaction and size limits, and never returns raw
  monitor files, credentials, environment values, request headers, or paths.
- Cache one immutable projection per monitor generation.

### Desktop and evidence

- Extend `agent-intelligence-view.ts` and `AlgorithmDiagnosticPanel.ts` with live
  monitor projection states, last/next run, recovery, capability, compatibility,
  and quarantine context.
- Evidence Packet v1 is deterministic JSON with a SHA-256 digest and atomic file
  output. Future formats add versions instead of redefining v1.

## Delivery plan

### Phase 0 — Discovery and design

- [x] Fresh branch from user `main`
- [x] Repository analyst execution-path review
- [x] Independent architecture design
- [x] Trust-boundary and rollback design
- [ ] Human approval for high-assurance implementation

Evidence: repository analysis and architecture review recorded in the task.

### Phase 1 — Installed CLI, contracts, and documentation

Files:

- `tools/mcp-server/package.json`
- `tools/mcp-server/server-meta.mjs`
- `tools/mcp-server/tool-registry.mjs`
- `tools/mcp-server/result.mjs`
- `tools/mcp-server/generate-docs.mjs`
- `tools/mcp-server/cli.mjs` (new)
- `tools/mcp-server/doctor.mjs` (new)
- `tools/mcp-server/safeguard-demo.mjs` (new)
- `scripts/install-crystalball-mcp.mjs`
- `docs/AGENT_ACCESS.md` (new)
- `docs/MCP_PIPELINE.md`

Tasks:

- [ ] Add permission and compatibility contracts with stable machine codes.
- [ ] Add installed `crystalball doctor` and temporary-prefix installation test.
- [ ] Add synthetic safeguard demo with fail-closed negative cases.
- [ ] Generate complete permission/tool/compatibility reference documentation.
- [ ] Correct stale counts and Sentinel-versus-safety-monitor language.

Validation:

```bash
npm run mcp:test
npm run mcp:docs:check
npm run test:diagnostics
npm run typecheck:all
npm run lint:strict
```

### Phase 2 — Calm monitor event model

Files:

- `tools/mcp-server/tools/monitor.mjs`
- `tools/mcp-server/monitor-once.mjs`
- `tools/mcp-server/install-monitor.mjs`
- `tools/mcp-server/launch-agent.mjs`
- monitor tests

Tasks:

- [ ] Persist schedule metadata and calculate `nextRunAt`.
- [ ] Add versioned opened/resolved/escalated/stopped/resumed events.
- [ ] Add deterministic deduplication, cooldowns, bounded history, and restart
      persistence.
- [ ] Preserve one default scheduler and installer rollback.

Validation:

```bash
npm run mcp:test
npm run secrets:scan
```

### Phase 3 — Authenticated projection and desktop status

Files:

- `src-tauri/sidecar/local-api-server.mjs`
- `src-tauri/sidecar/__tests__/agent-monitor-projection.test.mjs` (new)
- `src/components/agent-intelligence-view.ts`
- `src/components/AlgorithmDiagnosticPanel.ts`
- `src/components/__tests__/agent-intelligence-view.test.mts`

Tasks:

- [ ] Add localhost-authenticated, read-only, redacted, bounded projection route.
- [ ] Reject invalid, future, oversized, unauthenticated, and raw-field requests.
- [ ] Add desktop live/stale/degraded/stopped/incompatible/unavailable states.
- [ ] Add bounded reconnect/reconciliation behavior without notification storms.

Validation:

```bash
node --test src-tauri/sidecar/__tests__/agent-monitor-projection.test.mjs
npx tsx --test src/components/__tests__/agent-intelligence-view.test.mts
npm run test:sidecar
npm run test:renderer
```

### Phase 4 — Evidence Packet v1

Files:

- `tools/mcp-server/evidence-packet.mjs` (new)
- `tools/mcp-server/cli.mjs`
- evidence contract and CLI tests

Tasks:

- [ ] Build deterministic, redacted evidence packets from projected data.
- [ ] Preserve direct-versus-derived provenance and missing-capability warnings.
- [ ] Write exports atomically with restrictive permissions and no partial files.
- [ ] Verify digest stability, malformed input rejection, and output size bounds.

Validation:

```bash
npm run mcp:test
npm run secrets:scan
```

### Phase 5 — Public documentation and ChatGPT Site

Repositories:

- Crystal Ball documentation in this repository
- `crystal-ball-observatory.bradleybond512.chatgpt.site` source repository

Tasks:

- [ ] Publish task-oriented Agent Access guide and generated references.
- [ ] Correct public repository/download links and release facts.
- [ ] Expand the Site with doctor, permission, evidence, compatibility, monitor,
      and safeguard-demo documentation.
- [ ] Keep public claims static and explicit; do not imply access to local state.

Validation:

```bash
npm run mcp:docs:check
# ChatGPT Site: npm test, npm run lint, npx tsc --noEmit, npm run build
```

### Phase 6 — Full release gate

- [ ] Targeted tests pass.
- [ ] `bash scripts/agentic-validate.sh` passes or any baseline-only failure is
      reproduced on unchanged `main` and documented.
- [ ] `npm run typecheck:all`, `npm run lint:strict`, `npm run test:renderer`,
      `npm run test:sidecar`, `npm run build`, and `npm run secrets:scan` pass.
- [ ] Independent reviewer passes the final diff with at most two repair cycles.
- [ ] Draft PR records scope, evidence, rollback, and review outcome.
- [ ] Auto-merge only after required checks pass.
- [ ] ChatGPT Site publication is verified at its production URL.

## Failure behavior

- Invalid/future schema: incompatible or unknown; retain only the last valid
  snapshot with a visible stale timestamp.
- Lock contention: bounded retry, then degraded last-valid projection.
- Authentication failure: no payload and no secret-bearing logs.
- Doctor failure: independent checks continue and return partial results.
- Export failure: no partial file; previous export remains untouched.
- UI disconnection: stale/disconnected state with bounded backoff.
- Missing versions: unknown, never compatible.

## Rollback

- CLI/contract work is additive and can be reverted without changing monitor
  state.
- Event metadata is stored separately and can be ignored by older versions.
- Projection route and desktop consumption are independently removable.
- Evidence Packet v1 exports remain readable after rollback.
- Installer changes preserve the existing backup/restore behavior and must pass
  a temporary-prefix smoke test before replacing installed artifacts.
- Site deployment keeps version history for immediate rollback.
