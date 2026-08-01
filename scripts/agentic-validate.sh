#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# CB_DOCS_ROOT is the docs-checker's test seam. Inherited here it would point
# docs:check at an arbitrary tree — CB_DOCS_ROOT=/var/empty makes every
# structural doc check vacuously green — so the gate must never let it leak
# through to the real run.
unset CB_DOCS_ROOT

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
TEST_SCRIPTS=()

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

# Split before the emptiness check: `--tests "   "` is non-empty to `[ -n ]` but
# expands to zero words, so a whitespace-only value would otherwise run no tests
# and still print "gate passed" with a "Tests run:" line.
if [ -n "$TESTS" ]; then
  read -r -a TEST_SCRIPTS <<< "$TESTS"
fi

if [ ${#TEST_SCRIPTS[@]} -eq 0 ] && [ -z "${NO_TESTS_REASON//[[:space:]]/}" ]; then
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
if [ ${#TEST_SCRIPTS[@]} -gt 0 ]; then
  # Captured, not piped: `npm run | grep -q` makes grep exit on first match and
  # kills npm with SIGPIPE, which `set -o pipefail` then reports as exit 141.
  AVAILABLE_SCRIPTS="$(node -e 'const s=require("./package.json").scripts||{};console.log(Object.keys(s).join("\n"))')"
  # Validate every name BEFORE running any, so a typo in the last script cannot
  # burn several minutes of real test time before it is rejected.
  for script in "${TEST_SCRIPTS[@]}"; do
    if ! printf '%s\n' "$AVAILABLE_SCRIPTS" | grep -qxF "$script"; then
      printf '\nNo such npm script: %s\n' "$script" >&2
      printf 'Name real scripts from package.json; a typo must not read as coverage.\n' >&2
      exit 2
    fi
  done
  for script in "${TEST_SCRIPTS[@]}"; do
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

# Blocking, minus one heuristic. No CI workflow runs docs:check, so this gate is
# the ONLY enforcement of README panel/layer/secret/locale counts and
# docs/API_KEYS.md coverage — those must stay fatal. Only the "PR #N not in
# CHANGELOG" backlog is demoted, and it still prints: nothing writes those
# entries automatically, so it was 10 deep on a pristine `main` and failed every
# branch for work the branch did not do.
run npm run docs:check -- --changelog-advisory

run npm run build

printf '\nAgentic validation gate passed.\n'
if [ -n "$TESTS" ]; then
  printf 'Tests run: %s\n' "$TESTS"
else
  printf 'Tests waived: %s\n' "$NO_TESTS_REASON"
fi
printf 'This gate does NOT prove a new test fails without its fix — attach a mutation proof (AGENTS.md).\n'
