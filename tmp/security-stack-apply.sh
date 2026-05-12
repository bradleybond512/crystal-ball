#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./tmp/security-stack-apply.sh [options]

Recommended:
  ./tmp/security-stack-apply.sh --baseline --install-little-snitch --disable-zeek

Options:
  --baseline               Enable macOS firewall and stealth mode.
  --install-little-snitch  Install Little Snitch via Homebrew cask and open it.
  --disable-zeek           Disable/stop Zeek launch daemons, keep package/config/logs.
  --uninstall-zeek         Disable Zeek, back up configs, then brew uninstall zeek.
  --disable-dnscrypt       Disable/stop dnscrypt-proxy launch daemon.
  --uninstall-dnscrypt     Disable dnscrypt-proxy, then brew uninstall dnscrypt-proxy.
  --suricata-leftovers     Disable/stop remaining custom Suricata launch jobs.
  --uninstall-suricata     Disable Suricata leftovers, then brew uninstall suricata.
  --remove-lulu            Back up LuLu rules, quit LuLu, remove LuLu app/config, uninstall lulu-cli.
  --all-recommended        Baseline + Little Snitch + disable Zeek + disable dnscrypt + Suricata leftovers.
  --help                   Show this help.

Notes:
  - Use --remove-lulu only after Little Snitch is installed and approved in System Settings.
  - Use --uninstall-zeek only if you do not want local packet-monitoring logs/tools available.
  - This script backs up configs to ~/SecurityStackBackups/<timestamp>.
EOF
}

BASELINE=0
INSTALL_LITTLE_SNITCH=0
DISABLE_ZEEK=0
UNINSTALL_ZEEK=0
DISABLE_DNSCRYPT=0
UNINSTALL_DNSCRYPT=0
SURICATA_LEFTOVERS=0
UNINSTALL_SURICATA=0
REMOVE_LULU=0

for arg in "$@"; do
  case "$arg" in
    --baseline) BASELINE=1 ;;
    --install-little-snitch) INSTALL_LITTLE_SNITCH=1 ;;
    --disable-zeek) DISABLE_ZEEK=1 ;;
    --uninstall-zeek) UNINSTALL_ZEEK=1; DISABLE_ZEEK=1 ;;
    --disable-dnscrypt) DISABLE_DNSCRYPT=1 ;;
    --uninstall-dnscrypt) UNINSTALL_DNSCRYPT=1; DISABLE_DNSCRYPT=1 ;;
    --suricata-leftovers) SURICATA_LEFTOVERS=1 ;;
    --uninstall-suricata) UNINSTALL_SURICATA=1; SURICATA_LEFTOVERS=1 ;;
    --remove-lulu) REMOVE_LULU=1 ;;
    --all-recommended)
      BASELINE=1
      INSTALL_LITTLE_SNITCH=1
      DISABLE_ZEEK=1
      DISABLE_DNSCRYPT=1
      SURICATA_LEFTOVERS=1
      ;;
    --help) usage; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; usage; exit 2 ;;
  esac
done

if [ "$#" -eq 0 ]; then
  usage
  exit 2
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$HOME/SecurityStackBackups/$STAMP"
mkdir -p "$BACKUP_DIR"

need_sudo() {
  sudo -v
}

backup_path() {
  local path="$1"
  if [ -e "$path" ]; then
    local dest="$BACKUP_DIR${path}"
    mkdir -p "$(dirname "$dest")"
    sudo cp -a "$path" "$dest"
  fi
}

bootout_system() {
  local label="$1"
  local plist="$2"
  sudo launchctl disable "system/$label" 2>/dev/null || true
  sudo launchctl bootout system "$plist" 2>/dev/null || true
  sudo launchctl bootout "system/$label" 2>/dev/null || true
}

bootout_user() {
  local label="$1"
  local plist="$2"
  launchctl disable "gui/$(id -u)/$label" 2>/dev/null || true
  launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || true
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
}

if [ "$BASELINE" -eq 1 ]; then
  echo "== Enabling macOS firewall baseline =="
  need_sudo
  sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate on
  sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setstealthmode on
  sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setallowsigned on
fi

if [ "$INSTALL_LITTLE_SNITCH" -eq 1 ]; then
  echo "== Installing Little Snitch =="
  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew is required for --install-little-snitch." >&2
    exit 1
  fi
  brew install --cask little-snitch
  open -a "Little Snitch" || true
  echo "Approve Little Snitch's Network Extension in System Settings if macOS asks."
fi

if [ "$SURICATA_LEFTOVERS" -eq 1 ]; then
  echo "== Disabling Suricata leftovers =="
  need_sudo
  backup_path /Library/LaunchDaemons/com.bradleybond.suricata.plist
  backup_path /Library/LaunchDaemons/com.bradleybond.suricata-blocker.plist
  backup_path /Library/LaunchDaemons/com.bradleybond.suricata-update.plist
  backup_path "$HOME/Library/LaunchAgents/com.bradleybond.suricata-alerts.plist"
  bootout_system com.bradleybond.suricata /Library/LaunchDaemons/com.bradleybond.suricata.plist
  bootout_system com.bradleybond.suricata-blocker /Library/LaunchDaemons/com.bradleybond.suricata-blocker.plist
  bootout_system com.bradleybond.suricata-update /Library/LaunchDaemons/com.bradleybond.suricata-update.plist
  bootout_user com.bradleybond.suricata-alerts "$HOME/Library/LaunchAgents/com.bradleybond.suricata-alerts.plist"
  sudo rm -f /opt/homebrew/var/run/suricata.pid
fi

if [ "$DISABLE_ZEEK" -eq 1 ]; then
  echo "== Disabling Zeek daemons =="
  need_sudo
  backup_path /Library/LaunchDaemons/com.bradleybond.zeek.plist
  backup_path /Library/LaunchDaemons/com.bradleybond.zeek-intel-update.plist
  backup_path /Library/LaunchDaemons/com.bradleybond.zeek-log-rotate.plist
  backup_path /opt/homebrew/etc/zeek
  backup_path /opt/homebrew/share/zeek/site
  bootout_system com.bradleybond.zeek /Library/LaunchDaemons/com.bradleybond.zeek.plist
  bootout_system com.bradleybond.zeek-intel-update /Library/LaunchDaemons/com.bradleybond.zeek-intel-update.plist
  bootout_system com.bradleybond.zeek-log-rotate /Library/LaunchDaemons/com.bradleybond.zeek-log-rotate.plist
fi

if [ "$DISABLE_DNSCRYPT" -eq 1 ]; then
  echo "== Disabling dnscrypt-proxy =="
  need_sudo
  backup_path /Library/LaunchDaemons/homebrew.mxcl.dnscrypt-proxy.plist
  backup_path /opt/homebrew/etc/dnscrypt-proxy.toml
  bootout_system homebrew.mxcl.dnscrypt-proxy /Library/LaunchDaemons/homebrew.mxcl.dnscrypt-proxy.plist
fi

if [ "$UNINSTALL_ZEEK" -eq 1 ]; then
  echo "== Uninstalling Zeek formula =="
  brew uninstall zeek
fi

if [ "$UNINSTALL_SURICATA" -eq 1 ]; then
  echo "== Uninstalling Suricata formula =="
  brew uninstall suricata
fi

if [ "$UNINSTALL_DNSCRYPT" -eq 1 ]; then
  echo "== Uninstalling dnscrypt-proxy formula =="
  brew uninstall dnscrypt-proxy
fi

if [ "$REMOVE_LULU" -eq 1 ]; then
  echo "== Removing LuLu =="
  if ! brew list --cask little-snitch >/dev/null 2>&1 && [ ! -d "/Applications/Little Snitch.app" ]; then
    echo "Little Snitch is not installed. Install and approve it before removing LuLu." >&2
    exit 1
  fi
  need_sudo
  backup_path /Library/Objective-See/LuLu
  osascript -e 'tell application "LuLu" to quit' 2>/dev/null || true
  sudo rm -rf /Applications/LuLu.app /Library/Objective-See/LuLu
  brew uninstall lulu-cli 2>/dev/null || true
  echo "If macOS still shows the LuLu Network Extension, remove it in System Settings or reboot."
fi

echo
echo "== Current state =="
"$(dirname "$0")/security-stack-verify.sh"
echo
echo "Backups: $BACKUP_DIR"
