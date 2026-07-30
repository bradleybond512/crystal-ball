#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

run() {
  printf '\n==> %s\n' "$*"
  "$@"
}

# This is the repeatable agent completion gate. Domain-specific tests must run
# before this script; CI remains the final authority for the complete matrix.
run npm run lockfile:check
run npm run lint:strict
run npm run typecheck:all
run npm run secrets:scan
run npm run cross-agent:check
run npm run docs:check
run npm run build

printf '\nAgentic validation gate passed.\n'
