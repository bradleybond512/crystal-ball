#!/usr/bin/env bash
set -euo pipefail

print_header() {
  printf '\n== %s ==\n' "$1"
}

print_header "macOS firewall"
/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate || true
/usr/libexec/ApplicationFirewall/socketfilterfw --getstealthmode || true

print_header "Launch services"
for label in \
  com.bradleybond.zeek \
  com.bradleybond.zeek-intel-update \
  com.bradleybond.zeek-log-rotate \
  com.bradleybond.suricata \
  com.bradleybond.suricata-blocker \
  com.bradleybond.suricata-update \
  homebrew.mxcl.dnscrypt-proxy
do
  printf '%s: ' "$label"
  launchctl print "system/$label" >/dev/null 2>&1 && echo "loaded" || echo "not loaded"
done

printf '%s: ' "com.bradleybond.suricata-alerts"
launchctl print "gui/$(id -u)/com.bradleybond.suricata-alerts" >/dev/null 2>&1 && echo "loaded" || echo "not loaded"

print_header "Installed tools"
for formula in zeek suricata dnscrypt-proxy lulu-cli; do
  if brew list --formula "$formula" >/dev/null 2>&1; then
    printf '%s: installed ' "$formula"
    brew list --versions "$formula" | sed "s/^$formula //"
  else
    printf '%s: not installed\n' "$formula"
  fi
done

for cask in little-snitch oversight; do
  if brew list --cask "$cask" >/dev/null 2>&1; then
    printf '%s: installed ' "$cask"
    brew list --versions --cask "$cask" | sed "s/^$cask //"
  else
    printf '%s: not installed via brew\n' "$cask"
  fi
done

[ -d "/Applications/Little Snitch.app" ] && echo "Little Snitch app: present" || echo "Little Snitch app: absent"
[ -d "/Applications/LuLu.app" ] && echo "LuLu app: present" || echo "LuLu app: absent"
[ -d "/Library/Objective-See/LuLu" ] && echo "LuLu config: present" || echo "LuLu config: absent"

print_header "Network logs"
du -sh /opt/homebrew/var/log/zeek /opt/homebrew/var/log/suricata 2>/dev/null || true
ls -lh /opt/homebrew/var/log/zeek/{conn.log,dns.log,ssl.log,weird.log,notice.log,telemetry.log} 2>/dev/null || true

print_header "DNS"
scutil --dns | sed -n '1,45p'
