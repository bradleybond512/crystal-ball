# cb-control

Remote control for Claude Code CLI sessions. Runs as a local daemon on your
Mac, exposes a mobile-first PWA, and is accessed securely from your iPhone
over Tailscale.

What you get:

- **Spawn Claude sessions from your phone** — full Claude Code features, running
  on your Mac with all its tools and keys.
- **Relay commands to existing sessions** — CLI sessions you started in a
  terminal register themselves via a `SessionStart` hook and show up in the PWA.
- **Live output streaming** over WebSocket.
- **Persistent transcripts** in SQLite (searchable across sessions).

Architecture: one daemon (`~500 LOC` Node), one PWA (no build step, plain ES
modules), Tailscale for remote access. No App Store, no native iOS code, no
public internet exposure.

> Note: this tool currently lives inside the `crystal-ball` repo under
> `tools/cb-control/` but is self-contained. It can be extracted to its own
> repo any time with `git subtree split --prefix=tools/cb-control`.

## Requirements

- macOS (or Linux) with Node.js 20+
- Claude Code CLI installed on PATH as `claude`
- Tailscale on both your Mac and iPhone (free tier is fine)

## Install

```bash
cd tools/cb-control
npm install              # installs node-pty, ws, better-sqlite3
npm run install-hooks    # writes SessionStart + Stop hooks into ~/.claude/settings.json
```

## First run

```bash
npm start
```

Output will include:

```
[cb-control] listening on http://127.0.0.1:46987
[cb-control] token:     <64-hex-chars>
[cb-control] token path: /Users/you/.config/cb-control/token
```

Copy that token — you'll paste it into the PWA once.

## Exposing to your iPhone (Tailscale)

```bash
# 1. Sign in to Tailscale on Mac and iPhone (same account).
# 2. Find your Mac's Tailscale hostname:
tailscale status                         # e.g. "mac.tail-abcd.ts.net"

# 3. Restart the daemon bound to all interfaces:
CB_CONTROL_HOST=0.0.0.0 npm start
```

On your iPhone, open Safari and navigate to:

```
http://mac.tail-abcd.ts.net:46987/
```

Tap **Share → Add to Home Screen**. Launch the icon, open Settings, paste:

- **Server URL**: `http://mac.tail-abcd.ts.net:46987`
- **Bearer token**: the token printed at daemon startup
- **Default working dir**: e.g. `/Users/you/developer/crystalball`

Tap **Save**, then **Test connection** — you should see `Connected ✓`.

### Optional: HTTPS via Tailscale certs

For nicer PWA behavior (some iOS APIs require secure context), enable
Tailscale HTTPS:

```bash
tailscale serve --bg --https=443 localhost:46987
```

Then use `https://mac.tail-abcd.ts.net/` in the PWA settings.

## Using it

### Spawn a new session from the phone
Tap **+ New session** → enter `cwd`, optional label, optional extra args.
A managed `claude` process spawns in a PTY; you're dropped into the terminal view.

### Relay commands to an existing CLI session
Open a terminal on your Mac, `cd` to a repo, run `claude`. The SessionStart
hook registers it. Refresh the PWA — the session appears with an `external`
badge. Tap to open.

> External sessions are read-only for input by default (we don't own their
> stdin). To relay input into them, you need a managed session. A future
> revision will add a named-pipe bridge so external sessions accept input too.

### Send input
The input bar at the bottom sends each line as if typed. **^C** sends SIGINT
(Ctrl-C); **Esc** sends ESC. Shift-Enter inserts a newline without sending.

## Configuration

Environment variables (set before `npm start`):

| Var | Default | Purpose |
|-----|---------|---------|
| `CB_CONTROL_HOST` | `127.0.0.1` | Bind host. Set `0.0.0.0` for Tailscale. |
| `CB_CONTROL_PORT` | `46987` | Listen port. |
| `CB_CONTROL_DIR` | `~/.config/cb-control` | Token + SQLite location. |
| `CB_CONTROL_CLAUDE` | `claude` | Path to Claude CLI binary. |
| `CB_CONTROL_URL` | `http://127.0.0.1:46987` | (hooks) daemon URL. |

## Running as a launchd service (macOS)

Create `~/Library/LaunchAgents/com.cb-control.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.cb-control</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/you/developer/crystalball/tools/cb-control/server/index.mjs</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CB_CONTROL_HOST</key><string>0.0.0.0</string>
    <key>PATH</key><string>/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/you/Library/Logs/cb-control.log</string>
  <key>StandardErrorPath</key><string>/Users/you/Library/Logs/cb-control.err.log</string>
</dict>
</plist>
```

Load with:

```bash
launchctl load -w ~/Library/LaunchAgents/com.cb-control.plist
```

## Security model

- **Bearer token** (256 bits) required for every API call and WebSocket.
  Stored at `~/.config/cb-control/token` with mode 0600.
- **Tailscale** is the network boundary — nothing is ever exposed to the
  public internet. Even without Tailscale, bind stays on `127.0.0.1` by default.
- **Daemon runs as your user** and spawns `claude` with your full shell env.
  A compromised token = shell access to your Mac. Treat it like an SSH key.
- **No `--dangerously-skip-permissions`** is passed to Claude. Each session
  gets the normal Claude Code permission prompts (visible as output in the
  terminal view; respond via the input bar).

To rotate the token, delete `~/.config/cb-control/token` and restart.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET  | `/health` | Liveness (no auth) |
| GET  | `/api/sessions` | List sessions |
| POST | `/api/sessions` | Spawn new managed session `{cwd, label?, args?}` |
| GET  | `/api/sessions/:id` | Session detail + last output snapshot |
| POST | `/api/sessions/:id/input` | Send `{data, enter?}` |
| POST | `/api/sessions/:id/resize` | `{cols, rows}` |
| DELETE | `/api/sessions/:id` | Kill (managed) or mark ended (external) |
| GET  | `/api/sessions/:id/events` | Paginated events (`?after=<id>`) |
| POST | `/api/hooks/session-start` | Called by SessionStart hook |
| POST | `/api/hooks/session-stop` | Called by Stop hook |
| WS   | `/ws/sessions/:id?token=…` | Live output stream + input |

## Roadmap

- Named-pipe bridge so external sessions accept input relay
- Multi-session **compose** view (write once, send to N sessions)
- Full-text search across transcripts
- iOS push notifications when a session requests a permission prompt
- Touch-ID gate on the PWA before sending input

## License

Same as the parent repo.
