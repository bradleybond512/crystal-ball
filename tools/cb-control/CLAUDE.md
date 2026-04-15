# cb-control — Claude session guide

**If you are a Claude Code session running in this repo, read this file.**
It explains a local tool that lets you see and coordinate with other Claude
sessions running on the same Mac.

## What cb-control is

`cb-control` is a local daemon on this Mac (default `http://127.0.0.1:46987`)
that:

- Registers every Claude CLI session via a `SessionStart` hook (so each
  session can see the others)
- Spawns new Claude sessions in PTYs
- Relays input (keystrokes, commands) into existing tmux-hosted sessions
- Mirrors live output over WebSocket
- Persists events to SQLite with full-text search

If you are this Claude session, you yourself are probably registered with
it. Other sessions running on this Mac — including ones the user is
driving from their iPhone via the PWA — are visible to you through the
HTTP API documented below.

## First: is it running?

```bash
curl -fsS http://127.0.0.1:46987/health
# -> {"ok":true,"version":"0.1.0"}
```

If that fails, cb-control isn't running. Do nothing else — the user starts
it manually; don't launch it yourself. If the user asked you to interact
with cb-control and it's down, say so.

## Load the bearer token

Every API call (except `/health`) needs a bearer token at
`~/.config/cb-control/token`:

```bash
TOKEN=$(cat ~/.config/cb-control/token)
```

If the token file doesn't exist, cb-control has never been started. Tell
the user.

## Core operations

### List all live and recent sessions

```bash
curl -fsS -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:46987/api/sessions | jq
```

Returns `{sessions: [{id, label, cwd, branch, status, source, live, bridge, ...}]}`.

- `source: "daemon"` — spawned by cb-control (managed PTY; full I/O)
- `source: "external"` with `bridge: "tmux"` — user-launched CLI in a tmux pane (full I/O)
- `source: "external"` with `bridge: null` — user-launched CLI **not** in tmux (metadata-only; can't send input)

**Identify yourself:** your own `session_id` is passed to your hooks; you
won't usually know it directly, but you can match by `cwd` (current
working directory) to find your row.

### Read another session's recent output

```bash
SESSION_ID=...
curl -fsS -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:46987/api/sessions/$SESSION_ID" | jq -r .snapshot
```

The `snapshot` field contains the last ~200KB of that session's pane
output — what the other Claude just said/did.

### Relay a command to another session

**Only do this when the user has clearly authorized cross-session action.**
Injecting input into another Claude is equivalent to the user typing at
that Claude — it has full permission to edit files, run commands, etc.

```bash
curl -fsS -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"data":"please rebase onto main and rerun the benchmarks","enter":true}' \
  http://127.0.0.1:46987/api/sessions/$SESSION_ID/input
```

`enter: true` appends a carriage return so the message submits. If
`enter: false`, you just push characters into the prompt buffer — useful
for appending to what the user is already typing, rarely what you want.

### Spawn a fresh session

```bash
curl -fsS -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"cwd":"/Users/you/developer/crystalball","label":"parallel-test","args":[]}' \
  http://127.0.0.1:46987/api/sessions
```

Use this for fan-out work the user has asked for: parallel branch
refactors, multi-repo edits, etc. Spawned sessions boot into whatever
working state the `cwd` has — so check that `cwd` is the right branch
before spawning.

### Search across every session's transcript

```bash
curl -fsS -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:46987/api/search?q=migration+0042&limit=20" | jq
```

Useful for answering "what did the other session already try?" before you
redo the work.

### Compose (relay to many at once)

```bash
curl -fsS -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"ids":["id1","id2","id3"],"data":"git fetch origin && git status","enter":true}' \
  http://127.0.0.1:46987/api/compose
```

## When to use this vs. not

**Use it when:**
- The user asked to coordinate across sessions
- The user asked what another session is doing
- You need context another session built and you can search for it

**Don't use it when:**
- The user hasn't mentioned other sessions — don't freelance and start
  chattering at them
- You'd be saying anything secret (tokens, keys, passwords) — the
  transcript is persisted to SQLite

**Never:**
- Mass-kill sessions (`DELETE /api/sessions/:id`) without explicit user approval
- Spawn sessions with `--dangerously-skip-permissions` via the `args` field
- Loop automated retries against another session — a human review gate
  between agent actions matters

## Workflow patterns

### Pattern 1: "what did the other session find?"

```bash
TOKEN=$(cat ~/.config/cb-control/token)
curl -fsS -H "Authorization: Bearer $TOKEN" http://127.0.0.1:46987/api/sessions \
  | jq -r '.sessions[] | select(.live) | "\(.id)\t\(.label)\t\(.cwd)"'
# pick the relevant session id, then:
curl -fsS -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:46987/api/sessions/$ID" \
  | jq -r .snapshot | tail -200
```

### Pattern 2: "hand off a task"

After you've prepared context, ask the user to confirm, then:

```bash
curl -fsS -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d "$(jq -nc --arg msg "Session A (perf-review) prepared benchmarks at /tmp/bench.json. Please review and decide whether to merge." '{data:$msg, enter:true}')" \
  http://127.0.0.1:46987/api/sessions/$TARGET/input
```

### Pattern 3: "parallel exploration"

```bash
# spawn three sessions investigating three different hypotheses
for q in "redis-cache" "eager-load" "denormalize"; do
  curl -fsS -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
    -d "$(jq -nc --arg cwd "$PWD" --arg label "$q" '{cwd:$cwd, label:$label}')" \
    http://127.0.0.1:46987/api/sessions | jq .id
done
```

Then relay the initial prompt into each with `POST /api/sessions/:id/input`.

## Full API / setup docs

See `README.md` in this directory. TL;DR: PWA lives at the daemon root
(e.g. `https://<mac>.tailnet.ts.net/`), PWA gives the user full remote
control from iPhone.

## Source layout

```
server/       # HTTP + WebSocket daemon
  config.mjs  # host/port/token/paths
  storage.mjs # SQLite + FTS5
  sessions.mjs# managed PTY + external tmux session classes
  tmux-bridge.mjs # send-keys / pipe-pane / capture-pane helpers
  api.mjs     # HTTP routes
  ws.mjs      # WebSocket streaming
  index.mjs   # entrypoint
web/          # PWA (vanilla ESM, no build step)
hooks/        # SessionStart + Stop, installed into ~/.claude/settings.json
scripts/      # install-hooks, install-launchd, setup-tailscale-https
```

## Don't break things

- Before editing `sessions.mjs` or `storage.mjs`, read them fully. Both
  have non-obvious invariants (sessionBus contract; FTS5 triggers).
- Every managed and external session must expose the same shape
  (`write`, `snapshot`, `kill`, `status`) so HTTP and WS layers stay
  shape-polymorphic.
- Keep zero-build-step for the PWA: no bundlers, no transpiling, no
  framework runtime. Vanilla ESM is a hard requirement.
- Keep dependencies minimal (`node-pty`, `ws`, `better-sqlite3`). Adding
  a dep requires a strong reason.

## Commit style

Same as the parent repo: trailer `Co-Authored-By: Claude Sonnet 4.6
<noreply@anthropic.com>`, develop on `claude/*` branches, never push to
`main`.
