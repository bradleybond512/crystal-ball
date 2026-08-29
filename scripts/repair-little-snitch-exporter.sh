#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)" != 'Darwin' ]]; then
  echo 'Little Snitch setup is supported only on macOS.' >&2
  exit 64
fi
if [[ "$(id -u)" -eq 0 ]]; then
  echo 'Run this setup as the signed-in user, not root.' >&2
  exit 64
fi

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly INSTALLER="${REPO_ROOT}/scripts/install-little-snitch-exporter.mjs"
readonly NODE_PATH="${NODE_BINARY:-$(command -v node)}"

if [[ ! -f "${INSTALLER}" || ! -x "${NODE_PATH}" ]]; then
  echo 'Crystal Ball installer or Node.js runtime is unavailable.' >&2
  exit 66
fi

exec "${NODE_PATH}" "${INSTALLER}"
