#!/usr/bin/env bash
# One command to finish an agent PR safely. Encodes the lessons of two lost
# auto-merge races and one mid-review merge (#1601): every commit pushed, the
# remote tip verified identical to local, the review verdict recorded for THIS
# tip, and only then auto-merge armed.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

BRANCH=$(git rev-parse --abbrev-ref HEAD)
case "$BRANCH" in
  claude/*|codex/*|copilot/*) ;;
  *) printf 'pr-closeout: %s is not an agent branch.\n' "$BRANCH" >&2; exit 2 ;;
esac

# Untracked files (worktree node_modules symlinks, evidence transcripts) do
# not affect the committed state being shipped; tracked modifications do.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  printf 'pr-closeout: tracked files have uncommitted changes — commit or discard first.\n' >&2
  exit 1
fi

# The verdict must pin THIS tip; a stale or missing verdict is the #1601 bug.
node scripts/verify-review-verdict.mjs

# Resolve the canonical remote — it is `macos` on Bradley's Mac and `origin`
# in most other clones (AGENTS.md "Branch Discipline"). Never assume the name.
CANON=$(git remote -v | awk '/bradleybond512\/crystal-ball.*\(fetch\)/{print $1; exit}')
if [ -z "$CANON" ]; then
  printf 'pr-closeout: no remote points at bradleybond512/crystal-ball.\n' >&2
  exit 1
fi
git fetch "$CANON" --quiet
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "$CANON/$BRANCH" 2>/dev/null || echo "")
if [ "$LOCAL" != "$REMOTE" ]; then
  printf 'pr-closeout: local tip %s != %s/%s tip %s — push first, then rerun.\n' \
    "${LOCAL:0:8}" "$CANON" "$BRANCH" "${REMOTE:0:8}" >&2
  exit 1
fi

PR_JSON=$(gh pr view "$BRANCH" --json number,headRefOid,state 2>/dev/null || echo "")
if [ -z "$PR_JSON" ]; then
  printf 'pr-closeout: no open PR for %s — the auto-PR workflow creates one on push; wait or open it.\n' "$BRANCH" >&2
  exit 1
fi
PR_NUMBER=$(printf '%s' "$PR_JSON" | node -e 'let d="";process.stdin.on("data",(c)=>d+=c).on("end",()=>{const j=JSON.parse(d);if(j.state!=="OPEN"){console.error(`PR #${j.number} is ${j.state}`);process.exit(1)}console.log(j.number)})')
PR_HEAD=$(printf '%s' "$PR_JSON" | node -e 'let d="";process.stdin.on("data",(c)=>d+=c).on("end",()=>console.log(JSON.parse(d).headRefOid))')
if [ "$PR_HEAD" != "$LOCAL" ]; then
  printf 'pr-closeout: PR #%s head %s != local tip %s — GitHub has not seen your last push yet.\n' \
    "$PR_NUMBER" "${PR_HEAD:0:8}" "${LOCAL:0:8}" >&2
  exit 1
fi

gh pr merge "$PR_NUMBER" --auto --rebase
printf 'pr-closeout: PR #%s tip %s verified, verdict pinned, auto-merge armed.\n' "$PR_NUMBER" "${LOCAL:0:8}"
