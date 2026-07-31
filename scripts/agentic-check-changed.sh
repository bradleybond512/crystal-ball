#!/usr/bin/env bash
set -euo pipefail

BASE_REF="${BASE_REF:-origin/main}"
if ! git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
  BASE_REF="HEAD~1"
fi

changed="$(git diff --name-only "$BASE_REF"...HEAD)"
printf '%s\n' "$changed"

npm run lint:conflicts
npm run lint:json
npm run lint:yaml
npm run lint:md
npm run lockfile:check
npm run typecheck:all
npm run secrets:scan
npm run cross-agent:check

if grep -Eq '^(src/services/providers/|tests/data-sources|src/services/geo/)' <<<"$changed"; then npm run test:providers; fi
if grep -Eq '^(src/services/(cognition|intelligence)/|tests/intelligence/)' <<<"$changed"; then npm run test:intelligence; fi
if grep -Eq '^src/services/correlation/' <<<"$changed"; then npm run test:correlation; fi
if grep -Eq '^(src-tauri/|src/services/security/|tests/csp-)' <<<"$changed"; then npm run test:sec-hardening; fi
if grep -Eq '^(src/components/|src/.*/__tests__/)' <<<"$changed"; then npm run test:renderer; fi
if grep -Eq '^(package(-lock)?\.json|src-tauri/tauri\.conf|scripts/.*(release|install|sync))' <<<"$changed"; then
  npm run version:check
  npm run build
fi

echo "Changed-file quality gates passed."
