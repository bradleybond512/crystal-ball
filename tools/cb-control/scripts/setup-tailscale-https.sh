#!/usr/bin/env bash
# Serve cb-control over HTTPS via Tailscale.
# Requires Tailscale signed in and HTTPS enabled for your tailnet
# (https://login.tailscale.com/admin/dns → Enable HTTPS).
#
# Usage:
#   ./scripts/setup-tailscale-https.sh           # serve on :443
#   ./scripts/setup-tailscale-https.sh 8443      # alt port
#   ./scripts/setup-tailscale-https.sh --off     # tear down

set -euo pipefail

PORT_UPSTREAM="${CB_CONTROL_PORT:-46987}"
ARG="${1:-443}"

if ! command -v tailscale >/dev/null 2>&1; then
  echo "tailscale CLI not found. Install from https://tailscale.com/download" >&2
  exit 1
fi

if [[ "$ARG" == "--off" || "$ARG" == "off" ]]; then
  tailscale serve reset
  echo "Tailscale serve configuration cleared."
  exit 0
fi

PORT_HTTPS="$ARG"

tailscale serve --bg --https="$PORT_HTTPS" "http://127.0.0.1:${PORT_UPSTREAM}"

HOST="$(tailscale status --json 2>/dev/null | node -e '
  let d=""; process.stdin.on("data",c=>d+=c); process.stdin.on("end",()=>{
    try { const s=JSON.parse(d); console.log(s.Self.DNSName.replace(/\.$/,"")); } catch {}
  });' || echo "")"

echo ""
echo "HTTPS serve active."
if [[ -n "$HOST" ]]; then
  SUFFIX=""
  [[ "$PORT_HTTPS" != "443" ]] && SUFFIX=":$PORT_HTTPS"
  echo "  URL:  https://${HOST}${SUFFIX}/"
else
  echo "  URL:  https://<your-tailnet-host>${PORT_HTTPS:+:${PORT_HTTPS}}/"
fi
echo ""
echo "Paste that URL into the PWA Settings panel."
