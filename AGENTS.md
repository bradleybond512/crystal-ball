# Crystal Ball Agent Rules

## Active Roadmap

- Prediction, calibration, correlation, or self-tuning work must start with
  `docs/PREDICTION_ACCURACY_ROADMAP.md`.
- Claim one `ACC-NNN` task through a draft PR before implementation and update
  its status and evidence in the same PR that completes the work.
- `docs/PREDICTION_UPLIFT_PLAN.md` is a reference design, not the live tracker.

## Delivery Path

- `main` is the only merge target.
- Agent branches (`claude/*`, `codex/*`, `copilot/*`) must go through PRs and GitHub auto-merge after required checks pass.
- Do not merge agent PRs directly with the REST merge endpoint or local `git merge` unless explicitly told.

## Branch Discipline (MANDATORY — start every session here)

**Never commit directly to local `main`.** Every session must start from a fresh branch:

```bash
git fetch macos
git checkout -b codex/your-feature-name macos/main  # use claude/* for Claude sessions
# ... do work, commit freely ...
git push macos codex/your-feature-name
# open PR → auto-merge lands it
```

- Local `main` is read-only — only ever fast-forward it to `macos/main`
- Committing directly to local `main` causes divergence that is painful to reconcile across sessions
- If you find yourself on `main` with changes, move to a branch before pushing: `git checkout -b codex/rescue-YYYYMMDD`

## Release And Main Sync

- Official desktop releases are tag-driven.
- Continuous install to Bradley's Mac is handled locally by `npm run main-sync:setup`, which installs a macOS LaunchAgent that polls `macos/main`.
- The sync clone lives at `~/.crystalball-main-sync/repo`. Never develop there; it is disposable and owned by the sync agent.
- The local Mac sync path must:
  - run `npm run lockfile:check`
  - run `npm ci`
  - run `npm run typecheck:all`
  - run `npm run build`
  - run `npm run desktop:build:app:full`
  - install via `node scripts/install-built-app.mjs --relaunch`
  - refuse to install unless GitHub required checks for `main` are green

## Local Sync Agent

- Bootstrap or repair the sync agent with `npm run main-sync:setup`.
- Trigger a one-off sync manually with `npm run main-sync:run`.
- The agent state lives under `~/.crystalball-main-sync/`:
  - `repo/` clean clone
  - `state.json` last installed commit
  - `status.json` last sync result
  - `logs/` LaunchAgent stdout/stderr
- If `/scripts/sync-main-to-mac.mjs` or `/scripts/setup-main-sync-agent.mjs` changes, rerun `npm run main-sync:setup`.
- Do not add any `self-hosted` jobs to PR-triggered workflows in this public repo.

## Safety

- Prefer fail-closed behavior. If signing, verification, packaging, or install checks fail, stop the sync instead of falling back to a weaker path.
- Keep `~/Applications/Crystal Ball.app` as the canonical install target.
- This is a user-owned repo on GitHub, so non-provider patterns and validity checks are unavailable. The compensating control is mandatory repo secret scan coverage in local hooks and CI; keep `npm run secrets:scan:staged` and `npm run secrets:scan` enabled and passing.
