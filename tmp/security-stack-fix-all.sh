#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./tmp/security-stack-fix-all.sh --yes

What it fixes:
  - Enables macOS firewall and stealth mode.
  - Ensures Little Snitch is installed and opened for approval.
  - Removes LuLu after Little Snitch is present.
  - Stops, disables, backs up, and removes Zeek, Suricata, and dnscrypt-proxy.
  - Archives and removes old Zeek/Suricata logs.
  - Reinstalls Malwarebytes using its official remover plus Homebrew cask.
  - Runs the security-stack verifier at the end.

Backups:
  ~/SecurityStackBackups/<timestamp>

Notes:
  - You may need to approve Little Snitch and Malwarebytes in System Settings.
  - The script does not delete unrelated unsigned apps.
  - It keeps BlockBlock, OverSight, Tailscale, and Little Snitch.
EOF
}

if [ "${1:-}" != "--yes" ]; then
  usage
  exit 2
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$HOME/SecurityStackBackups/$STAMP"
mkdir -p "$BACKUP_DIR"

SUDO_REFRESH_PID=""

cleanup() {
  if [ -n "$SUDO_REFRESH_PID" ]; then
    kill "$SUDO_REFRESH_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

need_sudo() {
  sudo -v
  while true; do
    sleep 60
    sudo -n true >/dev/null 2>&1 || exit 0
  done &
  SUDO_REFRESH_PID="$!"
}

backup_path() {
  local path="$1"
  if [ -e "$path" ]; then
    local dest="$BACKUP_DIR${path}"
    mkdir -p "$(dirname "$dest")"
    sudo cp -a "$path" "$dest"
  fi
}

move_path() {
  local path="$1"
  if [ -e "$path" ]; then
    local dest="$BACKUP_DIR${path}"
    mkdir -p "$(dirname "$dest")"
    sudo mv "$path" "$dest"
  fi
}

bootout_system() {
  local label="$1"
  local plist="$2"
  sudo launchctl disable "system/$label" 2>/dev/null || true
  sudo launchctl bootout system "$plist" 2>/dev/null || true
  sudo launchctl bootout "system/$label" 2>/dev/null || true
}

bootout_gui() {
  local label="$1"
  local plist="$2"
  launchctl disable "gui/$(id -u)/$label" 2>/dev/null || true
  launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || true
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
}

archive_dir() {
  local src="$1"
  local name="$2"
  if [ -d "$src" ]; then
    sudo tar -czf "$BACKUP_DIR/$name.tar.gz" -C "$(dirname "$src")" "$(basename "$src")"
  fi
}

brew_uninstall_formula() {
  local formula="$1"
  if brew list --formula "$formula" >/dev/null 2>&1; then
    brew uninstall "$formula" || {
      echo "Could not uninstall $formula normally. Leaving it installed." >&2
    }
  fi
}

echo "== Preparing sudo and backups =="
need_sudo

echo
echo "== Enabling macOS firewall baseline =="
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate on
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setstealthmode on
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setallowsigned on

echo
echo "== Ensuring Little Snitch is installed =="
if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required." >&2
  exit 1
fi
if ! brew list --cask little-snitch >/dev/null 2>&1 && [ ! -d "/Applications/Little Snitch.app" ]; then
  brew install --cask little-snitch
fi
open -a "Little Snitch" || true

echo
echo "== Removing LuLu after backing up rules =="
if [ -d "/Applications/Little Snitch.app" ]; then
  backup_path /Library/Objective-See/LuLu
  osascript -e 'tell application "LuLu" to quit' 2>/dev/null || true
  sudo rm -rf /Applications/LuLu.app /Library/Objective-See/LuLu
  brew_uninstall_formula lulu-cli
else
  echo "Little Snitch app is not present; refusing to remove LuLu." >&2
  exit 1
fi

echo
echo "== Stopping Zeek, Suricata, and dnscrypt-proxy launch jobs =="
backup_path /Library/LaunchDaemons/com.bradleybond.zeek.plist
backup_path /Library/LaunchDaemons/com.bradleybond.zeek-intel-update.plist
backup_path /Library/LaunchDaemons/com.bradleybond.zeek-log-rotate.plist
backup_path /Library/LaunchDaemons/com.bradleybond.suricata.plist
backup_path /Library/LaunchDaemons/com.bradleybond.suricata-blocker.plist
backup_path /Library/LaunchDaemons/com.bradleybond.suricata-update.plist
backup_path /Library/LaunchDaemons/homebrew.mxcl.dnscrypt-proxy.plist
backup_path "$HOME/Library/LaunchAgents/com.bradleybond.suricata-alerts.plist"

bootout_system com.bradleybond.zeek /Library/LaunchDaemons/com.bradleybond.zeek.plist
bootout_system com.bradleybond.zeek-intel-update /Library/LaunchDaemons/com.bradleybond.zeek-intel-update.plist
bootout_system com.bradleybond.zeek-log-rotate /Library/LaunchDaemons/com.bradleybond.zeek-log-rotate.plist
bootout_system com.bradleybond.suricata /Library/LaunchDaemons/com.bradleybond.suricata.plist
bootout_system com.bradleybond.suricata-blocker /Library/LaunchDaemons/com.bradleybond.suricata-blocker.plist
bootout_system com.bradleybond.suricata-update /Library/LaunchDaemons/com.bradleybond.suricata-update.plist
bootout_system homebrew.mxcl.dnscrypt-proxy /Library/LaunchDaemons/homebrew.mxcl.dnscrypt-proxy.plist
bootout_gui com.bradleybond.suricata-alerts "$HOME/Library/LaunchAgents/com.bradleybond.suricata-alerts.plist"

echo
echo "== Backing up configs and logs =="
backup_path /opt/homebrew/etc/zeek
backup_path /opt/homebrew/share/zeek/site
backup_path /opt/homebrew/etc/suricata
backup_path /opt/homebrew/var/lib/suricata
backup_path /opt/homebrew/etc/dnscrypt-proxy.toml
archive_dir /opt/homebrew/var/log/zeek zeek-logs
archive_dir /opt/homebrew/var/log/suricata suricata-logs

echo
echo "== Removing stale launch plists and runtime files =="
move_path /Library/LaunchDaemons/com.bradleybond.zeek.plist
move_path /Library/LaunchDaemons/com.bradleybond.zeek-intel-update.plist
move_path /Library/LaunchDaemons/com.bradleybond.zeek-log-rotate.plist
move_path /Library/LaunchDaemons/com.bradleybond.suricata.plist
move_path /Library/LaunchDaemons/com.bradleybond.suricata-blocker.plist
move_path /Library/LaunchDaemons/com.bradleybond.suricata-update.plist
move_path /Library/LaunchDaemons/homebrew.mxcl.dnscrypt-proxy.plist
move_path "$HOME/Library/LaunchAgents/com.bradleybond.suricata-alerts.plist"
sudo rm -f /opt/homebrew/var/run/suricata.pid
sudo rm -rf /opt/homebrew/var/log/zeek /opt/homebrew/var/log/suricata

echo
echo "== Uninstalling unused network monitor packages =="
brew_uninstall_formula zeek
brew_uninstall_formula suricata
brew_uninstall_formula dnscrypt-proxy

echo
echo "== Reinstalling Malwarebytes =="
backup_path "/Library/Application Support/Malwarebytes"
if [ -f "/Library/Application Support/Malwarebytes/MBAM/Engine.bundle/Contents/Resources/Remove_Malwarebytes.pkg" ]; then
  sudo installer -pkg "/Library/Application Support/Malwarebytes/MBAM/Engine.bundle/Contents/Resources/Remove_Malwarebytes.pkg" -target /
fi
brew install --cask malwarebytes || brew reinstall --cask malwarebytes
open -a "Malwarebytes" || true

echo
echo "== Final verification =="
"$(dirname "$0")/security-stack-verify.sh"

echo
echo "Backups: $BACKUP_DIR"
echo "Approve Little Snitch and Malwarebytes in System Settings if macOS prompts."
