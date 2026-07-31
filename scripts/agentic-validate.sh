#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

usage() {
  cat >&2 <<'EOF'
Usage:
  bash scripts/agentic-validate.sh --tests "test:providers test:weather"
  bash scripts/agentic-validate.sh --no-tests "<reason this change has no testable behavior>"

The gate below is lint/typecheck/secrets/docs/build only — it executes no tests
and proves nothing about behavior. Name the targeted npm test scripts you ran so
the gate runs them too, or state explicitly why none apply.
EOF
  exit 2
}

TESTS=""
NO_TESTS_REASON=""

while [ $# -gt 0 ]; do
  case "$1" in
    --tests)
      [ $# -ge 2 ] || usage
      TESTS="$2"
      shift 2
      ;;
    --no-tests)
      [ $# -ge 2 ] || usage
      NO_TESTS_REASON="$2"
      shift 2
      ;;
    -h|--help) usage ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; usage ;;
  esac
done

if [ -n "$TESTS" ] && [ -n "$NO_TESTS_REASON" ]; then
  printf '\n--tests and --no-tests are mutually exclusive.\n' >&2
  exit 2
fi

if [ -z "$TESTS" ] && [ -z "$NO_TESTS_REASON" ]; then
  printf '\nRefusing to pass: no tests named.\n' >&2
  usage
fi

run() {
  printf '\n==> %s\n' "$*"
  "$@"
}

# Targeted behavioral tests run FIRST. A gate that reports success without having
# executed a single test lets an agent truthfully write "validation gate passed"
# for a change whose behavior was never exercised.
if [ -n "$TESTS" ]; then
  # Captured, not piped: `npm run | grep -q` makes grep exit on first match and
  # kills npm with SIGPIPE, which `set -o pipefail` then reports as exit 141.
  AVAILABLE_SCRIPTS="$(node -e 'const s=require("./package.json").scripts||{};console.log(Object.keys(s).join("\n"))')"
  # Validate every name BEFORE running any, so a typo in the last script cannot
  # burn several minutes of real test time before it is rejected.
  for script in $TESTS; do
    if ! printf '%s\n' "$AVAILABLE_SCRIPTS" | grep -qxF "$script"; then
      printf '\nNo such npm script: %s\n' "$script" >&2
      printf 'Name real scripts from package.json; a typo must not read as coverage.\n' >&2
      exit 2
    fi
  done
  for script in $TESTS; do
    run npm run "$script"
  done
else
  printf '\n==> Tests waived: %s\n' "$NO_TESTS_REASON"
fi

# This is the repeatable agent completion gate. CI remains the final authority
# for the complete matrix.
run npm run lockfile:check
run npm run lint:strict
run npm run typecheck:all
run npm run secrets:scan
run npm run cross-agent:check

# Advisory, not blocking. `docs:check` flags "PR #N not in CHANGELOG", but
# CHANGELOG entries are written by `npm run release:prepare` at RELEASE time, so
# between releases it is red on a pristine `main` for reasons unrelated to any
# change. A gate that always fails trains agents to ignore it or to claim it
# passed. It is also not a GitHub required check, so this matches CI reality.
# Its output still prints in full — read it.
printf '\n==> npm run docs:check (advisory)\n'
if npm run docs:check; then
  DOCS_STATUS="clean"
else
  DOCS_STATUS="stale — review the list above; blocking only if your change caused it"
fi

run npm run build

printf '\nAgentic validation gate passed.\n'
if [ -n "$TESTS" ]; then
  printf 'Tests run: %s\n' "$TESTS"
else
  printf 'Tests waived: %s\n' "$NO_TESTS_REASON"
fi
printf 'This gate does NOT prove a new test fails without its fix — attach a mutation proof (AGENTS.md).\n'
