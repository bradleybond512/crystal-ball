#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

npm run lint:conflicts
npm run lint:md
npm run secrets:scan

echo "Mechanical quality gates passed."
