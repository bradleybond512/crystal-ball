# cb-control handoff

**You are a Claude session being asked to learn about, set up, or
coordinate with a tool called `cb-control`. Read this file first.**

## One-paragraph summary

`cb-control` is a local daemon + PWA that lets the user drive Claude Code
CLI sessions from their iPhone over Tailscale, and lets Claude sessions
coordinate with each other on the same Mac. Work was scaffolded and fully
built out by an earlier Claude session on branch
`claude/review-cli-performance-RVsx6` of `bradleybond512/crystal-ball`.
The code exists but has not yet been installed or run on the user's Mac.

## Where the code is

- **Repo**: `bradleybond512/crystal-ball`
- **Branch**: `claude/review-cli-performance-RVsx6`
- **Not on `main`** — the user has not merged.
- **Path in the repo**: `tools/cb-control/`
- **Commit range**: `dc76658..e66c570` (three commits: scaffold → full
  feature set → Claude-session docs)

## Current state (as of handoff)

**Done:**

- Node daemon: HTTP + WebSocket + PTY spawn + SQLite + FTS5 search + tmux
  bridge for external sessions (send-keys in, pipe-pane out).
- PWA (no build step): sessions list, live terminal with ANSI coloring,
  command input bar, multi-session compose, transcript search,
  biometric (WebAuthn) unlock gate.
- SessionStart + Stop hooks + idempotent installer for
  `~/.claude/settings.json`.
- macOS launchd installer (`npm run install-launchd`).
- Tailscale HTTPS helper (`npm run setup-https`).
- Docs: `tools/cb-control/README.md` (user-facing),
  `tools/cb-control/CLAUDE.md` (session-facing), root `CLAUDE.md`
  pointer.

**Not done (three gates the user must close before any session can
actually use cb-control):**

1. **Pull the branch to the Mac**
   ```bash
   cd ~/developer/crystalball
   git fetch origin
   git checkout claude/review-cli-performance-RVsx6
   ```

2. **Install and run the daemon**
   ```bash
   cd tools/cb-control
   npm install
   npm run install-hooks
   npm run install-launchd        # or `npm start` for foreground
   ```
   After this, `curl http://127.0.0.1:46987/health` should return
   `{"ok":true,...}` and a bearer token lives at
   `~/.config/cb-control/token`.

3. **Make it discoverable machine-wide** (optional but recommended)
   Add a section to `~/.claude/CLAUDE.md` so every Claude session on
   the Mac learns to check for the daemon, regardless of cwd:
   ```
   ## cb-control (machine-wide Claude session coordination)
   Local daemon at http://127.0.0.1:46987 for cross-session coordination.
   Check on startup when the user mentions "other session", "hand off",
   "relay", "parallel session", or "the daemon":
     test -f ~/.config/cb-control/token && curl -fsS http://127.0.0.1:46987/health
   Full API: ~/developer/crystalball/tools/cb-control/CLAUDE.md
   ```

Until gates 1 and 2 close, every API call in the docs below will fail
with "Connection refused" — that is the expected state right now.

## After setup: what to read next

- **`tools/cb-control/CLAUDE.md`** — full HTTP API surface, safety
  rules, workflow patterns (hand-off, parallel exploration, "what did
  the other session find?"). Read this if you're going to *use* or
  *modify* the daemon.
- **`tools/cb-control/README.md`** — user-facing install, Tailscale
  setup, iPhone PWA install, launchd, HTTPS, uninstall. Read this if
  you're helping the user with setup.
- **`tools/cb-control/server/`** — the daemon source. Read this if
  you're debugging or extending the daemon itself. Non-obvious
  invariants live in `sessions.mjs` (sessionBus shape) and
  `storage.mjs` (FTS5 triggers).

## Never

- Don't spawn sessions with `--dangerously-skip-permissions`.
- Don't mass-kill other sessions via `DELETE /api/sessions/:id` without
  explicit user approval.
- Don't loop-retry commands against another session — always leave a
  human review gate.
- Don't relay secrets (tokens, API keys) through session input — the
  transcript is persisted to SQLite and indexed for full-text search.

## If the user asks "what did the earlier session do?"

They are probably referring to the session that built this tool. Answer
with the summary above. The full work product is the three commits on
`claude/review-cli-performance-RVsx6` and the two doc files listed.

## Machine-readable manifest

```json
{
  "repo": "bradleybond512/crystal-ball",
  "branch": "claude/review-cli-performance-RVsx6",
  "path": "tools/cb-control/",
  "daemon": {
    "url": "http://127.0.0.1:46987",
    "token_path": "~/.config/cb-control/token",
    "state_dir": "~/.config/cb-control/",
    "log_path": "~/Library/Logs/cb-control.log"
  },
  "docs": {
    "handoff": "tools/cb-control/HANDOFF.md",
    "session_guide": "tools/cb-control/CLAUDE.md",
    "user_readme": "tools/cb-control/README.md"
  },
  "install_order": [
    "git checkout claude/review-cli-performance-RVsx6",
    "cd tools/cb-control && npm install",
    "npm run install-hooks",
    "npm run install-launchd"
  ]
}
```
