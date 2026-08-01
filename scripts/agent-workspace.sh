#!/usr/bin/env bash
# One-command agent workspace bootstrap. Encodes every worktree gotcha that
# has burned a session: ~10 sessions share the canonical dir's git state, so
# work happens in .worktrees/<name>; a worktree has no node_modules (the
# cesium build plugin does path-based copies that module-resolution walking
# does not cover); a careless `ln -s` onto an existing target drops the link
# INSIDE node_modules and poisons module resolution with dual instances; and
# sidecar bundles + dist are gitignored build artifacts cargo needs.
#
# Usage: bash scripts/agent-workspace.sh <feature-name> [claude|codex]
set -euo pipefail

NAME="${1:?usage: agent-workspace.sh <feature-name> [claude|codex]}"
AGENT="${2:-claude}"
case "$AGENT" in claude|codex) ;; *) echo "agent must be claude or codex" >&2; exit 2 ;; esac

CANON_DIR=$(git rev-parse --show-toplevel)
case "$CANON_DIR" in
  */.worktrees/*) echo "run this from the canonical checkout, not a worktree" >&2; exit 2 ;;
esac

REMOTE=$(git remote -v | awk '/bradleybond512\/crystal-ball.*\(fetch\)/{print $1; exit}')
[ -n "$REMOTE" ] || { echo "no remote points at bradleybond512/crystal-ball" >&2; exit 1; }

BRANCH="$AGENT/$NAME"
WT="$CANON_DIR/.worktrees/$NAME"
[ ! -e "$WT" ] || { echo "$WT already exists" >&2; exit 1; }

git fetch "$REMOTE" --quiet
git worktree add -b "$BRANCH" "$WT" "$REMOTE/main"

# Symlink node_modules — and verify the link landed at the worktree root, not
# nested inside the target (the classic `ln -s` recurrence).
ln -s "$CANON_DIR/node_modules" "$WT/node_modules"
if [ -e "$CANON_DIR/node_modules/node_modules" ]; then
  rm -f "$CANON_DIR/node_modules/node_modules"
  echo "FATAL: nested node_modules symlink was created and removed — investigate before continuing" >&2
  exit 1
fi

# Cargo builds in worktrees need the gitignored sidecar bundles + a dist/.
for f in "$CANON_DIR"/src-tauri/sidecar/*.bundle.mjs; do
  [ -e "$f" ] && cp "$f" "$WT/src-tauri/sidecar/" || true
done
[ -d "$CANON_DIR/dist" ] && ln -s "$CANON_DIR/dist" "$WT/dist" || true

cat <<DONE
Workspace ready:
  cd $WT
Branch $BRANCH tracks $REMOTE/main @ $(git rev-parse --short "$REMOTE/main").
Reminders: rebase onto $REMOTE/main BEFORE your first commit if main moves;
finish with scripts/pr-closeout.sh (verdict + tip parity + auto-merge).
DONE
