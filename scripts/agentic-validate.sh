#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

run() {
  printf '\n==> %s\n' "$*"
  "$@"
}

# Deterministic checks run before expensive model review. Domain-specific tests
# must run before this script; CI remains the final authority for the matrix.
run node scripts/check-agent-model-policy.mjs
run node scripts/agent-policy-check.mjs
run npm run agentic:pipeline:test
run npm run lockfile:check
run npm run lint:strict
run npm run typecheck:all
run npm run secrets:scan
if [[ "${GITHUB_EVENT_NAME:-}" == "pull_request" ]]; then
  run npm run cross-agent:check
else
  printf '\n==> cross-agent review marker deferred to pull-request CI\n'
fi
run npm run docs:check
run npm run build

printf '\nAgentic validation gate passed.\n'
