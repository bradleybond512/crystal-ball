# cb-control

Remote control for Claude Code CLI sessions. A daemon on your Mac +
mobile-first PWA on your iPhone, connected over Tailscale. Full Claude
features from your phone, with full command relay into any running CLI
session.

**What it does:**

- **Spawn Claude sessions from your phone** — they run on your Mac with your
  real env, keys, and tools.
- **Attach to existing CLI sessions** you started in a terminal. As long as
  the terminal is a tmux pane, you get fully bidirectional I/O (send-keys
  in, pipe-pane out).
- **Relay the same command to many sessions at once** (compose view).
- **Full-text search** across every session's transcript (SQLite FTS5).
- **Biometric gate** (Face ID / Touch ID) before any write from the phone.

**Architecture:**

- Node 20 daemon: HTTP + WebSocket + PTY + SQLite (~1000 LOC)
- Vanilla-ESM PWA: no build step
- Tailscale: secure transport, no public internet exposure

> Lives at `tools/cb-control/` in the `crystal-ball` repo but is
> self-contained. Split out any time with
> `git subtree split --prefix=tools/cb-control`.

## Requirements

- macOS (Linux works minus launchd) with Node 20+
- Claude Code CLI on PATH as `claude`
- Tailscale on Mac + iPhone (free tier)
- **tmux** for attaching to external CLI sessions (optional but strongly
  recommended — without it, external sessions are metadata-only)

## Quick start

```bash
cd tools/cb-control
npm install              # node-pty, ws, better-sqlite3
npm run install-hooks    # wires SessionStart + Stop into ~/.claude/settings.json
npm run install-launchd  # macOS: run as login-time launchd agent
npm run setup-https      # serve over HTTPS via Tailscale
```

Then on your iPhone: open `https://<mac>.your-tailnet.ts.net/` in Safari,
**Share → Add to Home Screen**, launch the icon, tap the gear, paste the
bearer token (printed in `~/Library/Logs/cb-control.log`), **Save**,
**Test connection** → should show `Connected ✓`.

## First run (manual, no launchd)

```bash
CB_CONTROL_HOST=0.0.0.0 npm start
```

Prints:

```
[cb-control] listening on http://0.0.0.0:46987
[cb-control] token:     <64-hex-chars>
```

Copy the token into the PWA once and forget it.

## Using it

### Spawn from the phone

**+ New session** → cwd + optional label + extra args. A managed `claude`
process starts in a PTY; the terminal view opens.

### Attach to a terminal session (tmux)

```bash
# in tmux
claude
```

The `SessionStart` hook registers it and captures `$TMUX_PANE`. Open the
PWA — the session appears with a `live · tmux` badge and full I/O works.

Without tmux, the session still appears in the list but is **read-only**
(metadata only; the daemon can't inject into a bare terminal's stdin).

### Compose (multi-session relay)

Tap the pencil icon. Check the sessions to target, type a command, **Relay
to N**. Each selected session receives the same input in parallel. Useful
for: "rebase all feature branches onto main", "run the test suite
everywhere", "paste the same question into three branches to compare
answers".

### Search

Tap the magnifying-glass icon. Queries FTS5-indexed events across every
session. Tap a hit to jump into that session's terminal view.

### Biometric unlock (optional but recommended)

Settings → **Enable Face ID / Touch ID**. Once enabled, every write
(spawn, input, compose) requires a platform-authenticator assertion. The
unlock is cached for 60s to avoid re-prompting on every keystroke.

This is a client-side gate on top of the server's bearer-token check — a
second wall that protects against scenarios where someone has physical
access to your unlocked phone.

### Terminal keyboard

- `Send` — relay the textarea + Enter
- `^C` — SIGINT / Ctrl-C
- `Esc` — Escape key (e.g. cancel a Claude thought)
- `Tab` — Tab key (e.g. Claude permission prompt selections)

## Configuration

Env vars (set before `npm start` or in the launchd plist):

| Var | Default | Purpose |
|-----|---------|---------|
| `CB_CONTROL_HOST` | `127.0.0.1` | Bind host. Set `0.0.0.0` for Tailscale. |
| `CB_CONTROL_PORT` | `46987` | Listen port. |
| `CB_CONTROL_DIR` | `~/.config/cb-control` | Token + SQLite + pane logs. |
| `CB_CONTROL_CLAUDE` | `claude` | Path to Claude CLI binary. |
| `CB_CONTROL_URL` | `http://127.0.0.1:46987` | (hooks) daemon URL. |

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET  | `/health` | Liveness (no auth) |
| GET  | `/api/sessions` | List sessions |
| POST | `/api/sessions` | Spawn managed session `{cwd, label?, args?}` |
| GET  | `/api/sessions/:id` | Detail + last output snapshot |
| POST | `/api/sessions/:id/input` | `{data, enter?}` |
| POST | `/api/sessions/:id/resize` | `{cols, rows}` |
| DELETE | `/api/sessions/:id` | Kill (managed) or mark ended |
| GET  | `/api/sessions/:id/events` | Paginated events (`?after=<id>`) |
| POST | `/api/hooks/session-start` | Called by hook |
| POST | `/api/hooks/session-stop` | Called by hook |
| POST | `/api/hooks/event` | Called by hook (free-form events) |
| POST | `/api/compose` | `{ids: string[], data, enter?}` — relay to many |
| GET  | `/api/search?q=…&limit=…` | FTS5 over events |
| WS   | `/ws/sessions/:id?token=…` | Live output + input |

## Security posture

- **Bearer token**: 256-bit, constant-time compared, stored 0600 at
  `~/.config/cb-control/token`. Required on every API and WS call.
- **Tailscale**: network-layer authn. Nothing is ever exposed to the
  public internet — even the default bind stays on 127.0.0.1 unless you
  explicitly set `CB_CONTROL_HOST=0.0.0.0`.
- **Biometric unlock (optional)**: WebAuthn platform authenticator on the
  PWA adds a second gate for writes. Credential lives in the phone's
  secure enclave; revoke by clearing the PWA's site data.
- **No `--dangerously-skip-permissions`**: managed sessions get Claude's
  normal permission prompts, visible in the terminal view. Answer them
  through the input bar.
- **tmux relay scope**: `tmux send-keys` can inject keystrokes into any
  pane it can see. cb-control sends only to the specific pane the hook
  reported. If someone else's account has the token, they can relay keys
  into your tmux session — treat the token like SSH access.

Rotate the token: delete `~/.config/cb-control/token` and restart the
daemon.

## Running as a launchd service (macOS)

```bash
npm run install-launchd           # writes ~/Library/LaunchAgents/com.cb-control.plist and loads it
npm run uninstall-launchd         # reverse
```

The installed agent:

- Runs at login and respawns on crash
- Binds to `0.0.0.0:46987` (override with `CB_CONTROL_HOST` / `CB_CONTROL_PORT`)
- Logs to `~/Library/Logs/cb-control.log` and `cb-control.err.log`

## Running over HTTPS (Tailscale)

```bash
npm run setup-https               # serves :443 → http://127.0.0.1:46987
npm run setup-https -- 8443       # custom port
npm run setup-https -- --off      # tear down
```

Needs Tailscale HTTPS enabled for your tailnet (one-time, in the admin
console). iOS PWAs prefer HTTPS — some APIs (notification, persistent
storage, future features) require a secure context.

## Uninstall (everything)

```bash
npm run uninstall-launchd
npm run uninstall-hooks
rm -rf ~/.config/cb-control        # token, DB, pane logs
```

## Roadmap

- Pane persistence across tmux server restarts (re-attach on pane reappearance)
- Session "handoff" primitive — tag a session, subscribe from another
- iOS push notifications on permission prompts (APNS backend required)
- Per-session transcript export (Markdown + Claude-compatible resume)

## License

Same as the parent repo.
