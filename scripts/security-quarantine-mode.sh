#!/usr/bin/env bash
set -euo pipefail

CRYSTALBALL_DIR="${CRYSTALBALL_DIR:-"$HOME/Library/Application Support/Crystal Ball"}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
EVIDENCE_DIR="$CRYSTALBALL_DIR/quarantine-$STAMP"

mkdir -p "$EVIDENCE_DIR"
chmod 0700 "$EVIDENCE_DIR"

echo "== Crystal Ball security quarantine mode =="
echo "Evidence: $EVIDENCE_DIR"

run() {
  echo "+ $*"
  "$@" || true
}

copy_if_exists() {
  local src="$1"
  local dest="$2"
  if [[ -e "$src" ]]; then
    mkdir -p "$(dirname "$dest")"
    cp -R "$src" "$dest" 2>/dev/null || true
  fi
}

echo
echo "== Preserve local evidence =="
run launchctl print system > "$EVIDENCE_DIR/launchctl-system.txt" 2>&1
run launchctl print "gui/$(id -u)" > "$EVIDENCE_DIR/launchctl-user.txt" 2>&1
run ps auxww > "$EVIDENCE_DIR/processes.txt"
run lsof -nP -iTCP -iUDP > "$EVIDENCE_DIR/network-sockets.txt"
copy_if_exists "$CRYSTALBALL_DIR/little-snitch-traffic.json" "$EVIDENCE_DIR/little-snitch-traffic.json"
copy_if_exists "$HOME/Library/LaunchAgents" "$EVIDENCE_DIR/user-launchagents"
copy_if_exists "/Library/LaunchAgents" "$EVIDENCE_DIR/library-launchagents"
copy_if_exists "/Library/LaunchDaemons" "$EVIDENCE_DIR/library-launchdaemons"

echo
echo "== Harden macOS firewall =="
run sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate on
run sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setstealthmode on
run sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setallowsigned off
run sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setallowsignedapp off

echo
echo "== Stop Crystal Ball security exporters =="
run sudo launchctl bootout system /Library/LaunchDaemons/com.crystalball.little-snitch-exporter.plist
run launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.crystalball.little-snitch-exporter.plist"

echo
echo "== Disable old Suricata/Zeek jobs if present =="
for label in \
  com.bradleybond.suricata \
  com.bradleybond.suricata-blocker \
  com.bradleybond.suricata-alerts \
  com.bradleybond.zeek \
  com.bradleybond.zee
do
  run sudo launchctl bootout system "/Library/LaunchDaemons/$label.plist"
  run launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/$label.plist"
done

echo
echo "== Current state =="
run /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate
run /usr/libexec/ApplicationFirewall/socketfilterfw --getstealthmode
run launchctl print system/com.crystalball.little-snitch-exporter

echo
echo "Quarantine mode complete."
