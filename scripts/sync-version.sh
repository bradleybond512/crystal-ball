#!/usr/bin/env bash
# sync-version.sh — Sync version from package.json to Tauri config files.
# Usage:
#   bash scripts/sync-version.sh           # Sync all files to match package.json
#   bash scripts/sync-version.sh --check   # Validate all files are in sync

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "${1:-}" = "--check" ]; then
  node "$REPO_ROOT/scripts/sync-desktop-version.mjs" --check
else
  node "$REPO_ROOT/scripts/sync-desktop-version.mjs"
fi
