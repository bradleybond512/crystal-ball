#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
label="com.crystalball.little-snitch-exporter"
plist="/Library/LaunchDaemons/${label}.plist"
output="/Users/bradleybond/Library/Application Support/Crystal Ball/little-snitch-traffic.json"
err_log="/var/log/crystalball-little-snitch-exporter.err"
out_log="/var/log/crystalball-little-snitch-exporter.log"
little_snitch="/Applications/Little Snitch.app/Contents/Components/littlesnitch"

echo "== Little Snitch exporter repair =="
echo "repo: ${repo_root}"

if [[ ! -x "${little_snitch}" ]]; then
  echo "ERROR: Little Snitch CLI not found at ${little_snitch}" >&2
  exit 1
fi

echo
echo "== Direct Little Snitch CLI check =="
sudo "${little_snitch}" --version || true

echo
echo "== Little Snitch preferences containing traffic/log/monitor/history =="
sudo "${little_snitch}" list-preferences 2>/tmp/crystalball-ls-preferences.err \
  | grep -Ei 'traffic|log|monitor|history|stat' || true
if [[ -s /tmp/crystalball-ls-preferences.err ]]; then
  echo "-- preferences stderr --"
  cat /tmp/crystalball-ls-preferences.err
fi

echo
echo "== log-traffic without historic range =="
if ! sudo "${little_snitch}" log-traffic >/tmp/crystalball-ls-direct-empty.csv 2>/tmp/crystalball-ls-direct-empty.err; then
  echo "-- stderr --"
  cat /tmp/crystalball-ls-direct-empty.err
fi
head -5 /tmp/crystalball-ls-direct-empty.csv || true

echo
echo "== log-traffic with 10-minute historic range =="
if ! sudo "${little_snitch}" log-traffic -b "$(date -v-10M '+%Y-%m-%d %H:%M:%S')" >/tmp/crystalball-ls-direct.csv 2>/tmp/crystalball-ls-direct.err; then
  echo "-- stderr --"
  cat /tmp/crystalball-ls-direct.err
  echo "ERROR: Little Snitch log-traffic failed even with sudo." >&2
  echo "Check Little Snitch Network Monitor logging/settings, then retry." >&2
  exit 1
fi
head -5 /tmp/crystalball-ls-direct.csv || true

echo
echo "== Regenerating LaunchDaemon plist =="
sudo node "${repo_root}/scripts/install-little-snitch-exporter.mjs" --system --output "${output}"

echo
echo "== Reloading launchd job =="
sudo launchctl bootout "system/${label}" 2>/dev/null || true
sudo launchctl bootout system "${plist}" 2>/dev/null || true
sudo launchctl bootstrap system "${plist}"
sudo launchctl kickstart -k "system/${label}"

echo
echo "== Waiting for exporter =="
sleep 3

echo
echo "== launchd status =="
launchctl print "system/${label}" | grep -E "state|runs|last exit code" || true

echo
echo "== output file =="
if [[ -f "${output}" ]]; then
  sudo chmod 0644 "${output}" || true
  ls -l "${output}"
  head -20 "${output}"
else
  echo "MISSING: ${output}"
fi

echo
echo "== logs =="
[[ -f "${out_log}" ]] && tail -40 "${out_log}" || true
[[ -f "${err_log}" ]] && tail -80 "${err_log}" || true
