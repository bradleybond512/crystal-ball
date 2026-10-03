# R4-SEC-004 validation: MCP output framed as untrusted, read-only by default

Validated October 3, 2026 on branch `claude/r4-sec-004-mcp-untrusted`, which
is based on `main` (`a255546ee`). Approved design:
[plan](../plans/2026-10-02-r4-sec-004-mcp-untrusted.md). Bradley's choices:

- A: implement as designed.
- B: keep the repo `.mcp.json`; it sets no profile, so it is read-only.
- C: his own clients are read-only by default and opt in per config.
- D: agent feedback waits for his confirmation in the Analyst HUD.

## Behavior

- **Profiles** (`tools/mcp-server/profile.mjs`):
  - `CRYSTALBALL_MCP_PROFILE` unset, `read`, or any unknown value gives the
    **read** profile: 53 tools, all marked `readOnlyHint: true`. An unknown
    value logs one line to stderr.
  - `analyst` (case and spaces ignored) registers all 61 tools.
  - A withheld tool is never registered, so a client can neither list nor
    call it.
- **Framing** (`tools/mcp-server/framing.mjs`, wired once in `registerTool`):
  - Every string and object key is cleaned of characters a reader cannot
    see: Unicode `Cc`, `Cf` and `Cs` (zero-width, bidi marks, embeddings,
    overrides and isolates, the BOM, the Unicode tag block used for "ASCII
    smuggling"), both variation-selector blocks, Hangul fillers and similar.
    `\n` and `\t` are kept, and CR, CRLF, NEL, U+2028 and U+2029 become `\n`.
  - The copy follows JSON rules. It is bounded to 32 levels and 250,000
    nodes, and cycles are cut. Keys that collide after cleaning are all kept
    (`name~2`), and `__proto__` stays an own key.
  - Every result except `help` becomes
    `{ notice, source: "crystal-ball:<tool>", retrieved_at, untrusted_external_data }`,
    in both the text content and `structuredContent.result`. A thrown error
    becomes an `isError` result in the same frame, cleaned and capped at
    2,000 characters.
  - The server instructions name the profile and its tool count, say that
    all output is untrusted data, never instructions, and list the withheld
    tools with the setting that enables them.
- **Sidecar:** every command queued on `/api/analyst-commands` gets
  `origin: 'external'`, whatever the caller sends. `hypothesisId` is capped
  at 128 characters and `signature` at 512.
- **Renderer:**
  - The command listener validates each drained command.
  - `run_skeptic` still applies at once.
  - `thumbs_up`, `thumbs_down` and `dismiss` become pending suggestions
    (`src/services/agent-suggestions.ts`), whatever `origin` says. They are
    keyed by the matched hypothesis's signature, capped at 50, expire after
    7 days, and are validated when loaded from storage. A newer suggestion of
    the same kind for the same hypothesis replaces the older one.
- **Analyst HUD:** an **Agent suggestions (N)** section appears while any are
  pending:
  - Each row shows what will happen, the hypothesis statement, the agent's
    note labelled "unverified", and its age. All of it is set with
    `textContent`.
  - **Confirm** records the vote or the 24-hour dismissal by signature, so it
    still works after the hypothesis leaves the snapshot. **Discard** drops
    the suggestion. Each applies at most once.
  - The buttons go through the HUD's delegated root listener, so a
    background re-render cannot make them dead.
- **Docs:** `docs/AGENT_ACCESS.md` explains the profiles, the envelope and the
  HUD confirmation.

### Stricter than the plan

The plan put the envelope on tools marked `openWorldHint` only. Several
tools marked local relay renderer state that holds feed-derived text:
`get_reasoning_debug_log`, `get_pipeline_trace`, the monitor and the weekly
reports. So every tool except `help` is enveloped; `help` returns docs
generated from this repo and is only cleaned.

### Found while testing

- **The poll cursor.** The first mutation run left M35 (the listener's
  `issuedAt` check removed) alive: the suggestion store's own check dropped
  the malformed feedback anyway. But a bad timestamp would still reach
  `lastSeenAt = Math.max(...)` and make it `NaN`. The next poll would ask for
  `since=NaN`, which matches nothing, while the sidecar drains its queue, so
  every later command would be lost. The test now also sends a malformed
  `run_skeptic`, and M35 goes red.
- **Real coverage.** With a fake sidecar, 21 of the 61 tools carried the
  injected feed text through to their results, so the cleaning applies to
  real paths, not only to the unit fixtures.

### Not changed here

- `help` in the read profile still documents the 8 withheld tools. The
  server instructions say which tools are missing and how to enable them.
- The background monitor (`CRYSTALBALL_MCP_MONITOR_INTERVAL_MINUTES`) still
  runs its local cycle under either profile. It is configured by the user,
  not called by an agent.
- The HUD shows pending suggestions only when it is open. There is no badge
  while it is closed.

## Actual validation

All tests use fakes: a throwaway `HOME`, a fake sidecar on `127.0.0.1:0`
with a fake token, happy-dom and in-memory storage. No real Crystal Ball
data, token or Keychain entry is touched.

| Suite | Result |
|---|---|
| `test:mcp-untrusted` (new): MCP unit 15, MCP stdio 5, sidecar 3, store 9, listener 7, HUD 5 | 44/44 |
| `tools/mcp-server` `npm test` (all MCP tests, including the install smoke test) | 251/251 |
| Sidecar `local-api-server` + `analyst-diagnostics-mirror` | 177/177 |
| `hypothesis-feedback` + `hypothesis-feedback-mult` | 7/7 + 4/4 |
| Existing Analyst HUD suites (action delegation, visibility, control delegation) | 2/2 + 4/4 + 9/9 |

- `tsc --noEmit` and ESLint are clean on every changed file. `lint:colors`
  shows no increase; the new CSS uses tokens only.
- `mcp:docs:check` passes: the generated registry did not change.

## Mutation proof

Each mutation was applied alone, and each file was restored and its SHA-256
re-verified. Baselines were green. "MCP unit" is `profile` + `framing`;
"MCP stdio" is `untrusted-framing-stdio` + `stdio-integration`; "MCP package"
is `tool-registry` + `install-smoke`.

| # | Mutation | File (sha before) | Red suite(s), failing tests |
|---|---|---|---|
| M01 | unknown profile widens | `profile.mjs` (`c13dab48bbbc`) | MCP unit (1), MCP stdio (1) |
| M02 | read profile admits write tools | `profile.mjs` (`c13dab48bbbc`) | MCP unit (3), MCP stdio (3) |
| M03 | prototype names count as tools | `profile.mjs` (`c13dab48bbbc`) | MCP unit (1) |
| M04 | profile value not normalized | `profile.mjs` (`c13dab48bbbc`) | MCP unit (1) |
| M05 | registration ignores profile | `index.mjs` (`1b2fa1e66bb0`) | MCP stdio (3) |
| M06 | handler output bypasses framing | `framing.mjs` (`7d26ad558ab4`) | MCP unit (1), MCP stdio (1) |
| M07 | envelope without sanitizing | `framing.mjs` (`7d26ad558ab4`) | MCP unit (2), MCP stdio (1) |
| M08 | get_ tools skip the envelope | `framing.mjs` (`7d26ad558ab4`) | MCP unit (1), MCP stdio (1) |
| M09 | local tool trusted | `framing.mjs` (`7d26ad558ab4`) | MCP unit (1), MCP stdio (1) |
| M10 | format characters kept | `framing.mjs` (`7d26ad558ab4`) | MCP unit (6), MCP stdio (1) |
| M11 | variation selectors kept | `framing.mjs` (`7d26ad558ab4`) | MCP unit (1) |
| M12 | line breaks not normalized | `framing.mjs` (`7d26ad558ab4`) | MCP unit (1) |
| M13 | newlines and tabs stripped | `framing.mjs` (`7d26ad558ab4`) | MCP unit (1) |
| M14 | keys not sanitized | `framing.mjs` (`7d26ad558ab4`) | MCP unit (2), MCP stdio (1) |
| M15 | colliding key overwrites | `framing.mjs` (`7d26ad558ab4`) | MCP unit (1) |
| M16 | __proto__ assigned | `framing.mjs` (`7d26ad558ab4`) | MCP unit (1) |
| M17 | depth unbounded | `framing.mjs` (`7d26ad558ab4`) | MCP unit (1) |
| M18 | node budget off by one | `framing.mjs` (`7d26ad558ab4`) | MCP unit (1) |
| M19 | cycles not detected | `framing.mjs` (`7d26ad558ab4`) | MCP unit (1) |
| M20 | error text unbounded | `framing.mjs` (`7d26ad558ab4`) | MCP unit (1) |
| M21 | error text raw | `framing.mjs` (`7d26ad558ab4`) | MCP unit (2) |
| M22 | thrown errors unframed | `framing.mjs` (`7d26ad558ab4`) | MCP unit (1) |
| M23 | instructions drop the security line | `profile.mjs` (`c13dab48bbbc`) | MCP unit (1), MCP stdio (1) |
| M24 | new module not packaged | `package.json` (`56a7c19d1eda`) | MCP package (2) |
| M25 | caller sets origin | `local-api-server.mjs` (`546188894cf9`) | sidecar origin (1) |
| M26 | hypothesisId unbounded | `local-api-server.mjs` (`546188894cf9`) | sidecar origin (1) |
| M27 | signature unbounded | `local-api-server.mjs` (`546188894cf9`) | sidecar origin (1) |
| M28 | agent thumbs-up applies directly | `analyst-command-listener.ts` (`5c04fc091e7d`) | command listener (4) |
| M29 | non-external origin skips confirmation | `analyst-command-listener.ts` (`5c04fc091e7d`) | command listener (1) |
| M30 | agent dismissal applies directly | `analyst-command-listener.ts` (`5c04fc091e7d`) | command listener (2) |
| M31 | confirmed thumbs-down votes up | `analyst-command-listener.ts` (`5c04fc091e7d`) | command listener (1) |
| M32 | confirmed dismissal ignored | `analyst-command-listener.ts` (`5c04fc091e7d`) | command listener (1) |
| M33 | discard applies | `analyst-command-listener.ts` (`5c04fc091e7d`) | command listener (1), HUD (1) |
| M34 | skeptic held for confirmation | `analyst-command-listener.ts` (`5c04fc091e7d`) | command listener (1) |
| M35 | issuedAt not validated | `analyst-command-listener.ts` (`5c04fc091e7d`) | command listener (1) |
| M36 | confirm can repeat | `agent-suggestions.ts` (`83bd8c47ec75`) | suggestion store (1), command listener (1) |
| M37 | list not capped | `agent-suggestions.ts` (`83bd8c47ec75`) | suggestion store (1) |
| M38 | suggestions never expire | `agent-suggestions.ts` (`83bd8c47ec75`) | suggestion store (1) |
| M39 | duplicates kept | `agent-suggestions.ts` (`83bd8c47ec75`) | suggestion store (1), command listener (1) |
| M40 | hidden characters kept in agent text | `agent-suggestions.ts` (`83bd8c47ec75`) | suggestion store (2) |
| M41 | note not capped | `agent-suggestions.ts` (`83bd8c47ec75`) | suggestion store (1) |
| M42 | storage not validated | `agent-suggestions.ts` (`83bd8c47ec75`) | suggestion store (1) |
| M43 | oversized signature accepted | `agent-suggestions.ts` (`83bd8c47ec75`) | suggestion store (1) |
| M44 | expired suggestion can be taken | `agent-suggestions.ts` (`83bd8c47ec75`) | suggestion store (1) |
| M45 | view renders markup | `agent-suggestions-view.ts` (`2224576f00fc`) | HUD (1) |
| M46 | note not labelled unverified | `agent-suggestions-view.ts` (`2224576f00fc`) | HUD (1) |
| M47 | HUD Confirm discards | `AnalystHUD.ts` (`85fa0070d0bd`) | HUD (1) |
| M48 | HUD hides pending suggestions | `AnalystHUD.ts` (`85fa0070d0bd`) | HUD (2) |
| M49 | HUD buttons not delegated | `AnalystHUD.ts` (`85fa0070d0bd`) | HUD (2) |
| M50 | vote direction swapped | `hypothesis-feedback.ts` (`74010ab1244e`) | hypothesis-feedback (2), command listener (2) |
| M51 | dismissal stamped stale | `analyst-command-listener.ts` (`5c04fc091e7d`) | command listener (1) |

All 51 mutations went red. M35 survived the first run; the listener test was
strengthened (see "Found while testing"), and the rerun went red.

## Rollback

Revert the commit. All 61 tools would be registered for every client again,
including the coding agents this repo's `.mcp.json` starts, feed text would
reach them unframed, and agent feedback would apply to calibration directly.
